using System.Diagnostics;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Helpers;

namespace NetworkMonitor.Server.Services;

// ─────────────────────────────────────────────────────────────────────────────
// Parsed scan DTOs — the boundary between "what nmap said" and "what we store".
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Everything one scan produced, before it touches the database.</summary>
public class ParsedScanResult
{
    public List<ParsedHost> Hosts { get; } = [];
    public int HostsUp { get; set; }
    public int HostsDown { get; set; }
}

/// <summary>One host as nmap reported it.</summary>
public class ParsedHost
{
    public string IpAddress { get; set; } = "";
    public string? MacAddress { get; set; }
    public string? Hostname { get; set; }
    public string? Vendor { get; set; }
    public string? OsGuess { get; set; }
    public bool IsUp { get; set; }
    public double? LatencyMs { get; set; }
    public List<ParsedPort> Ports { get; } = [];
    public List<ParsedScript> HostScripts { get; } = [];
}

/// <summary>One port and the service nmap identified on it.</summary>
public class ParsedPort
{
    public int PortNumber { get; set; }
    public string Protocol { get; set; } = "tcp";
    public string State { get; set; } = "open";
    public string? ServiceName { get; set; }
    public string? ServiceVersion { get; set; }
    public List<ParsedScript> Scripts { get; } = [];
}

/// <summary>Output of one NSE script, both raw text and any structured elements.</summary>
public class ParsedScript
{
    public string Id { get; set; } = "";
    public string Output { get; set; } = "";
    public Dictionary<string, string> Elements { get; } = [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Nmap execution
// ─────────────────────────────────────────────────────────────────────────────

public interface INmapExecutorService
{
    Task<(string xmlPath, string command)> RunProfileScanAsync(string cidr, string nmapArgs, IEnumerable<string>? excludeIps = null, CancellationToken ct = default);
    bool IsNmapAvailable(out string? version);
}

/// <summary>
/// Runs nmap as an external process and hands back the XML it produced.
/// Targets are validated before they reach the command line, and the argument
/// string is adjusted for two behaviours that bite every nmap integration —
/// see the comments in <see cref="RunProfileScanAsync"/>.
/// </summary>
public class NmapExecutorService : INmapExecutorService
{
    private readonly ScanningOptions _options;
    private readonly ILogger<NmapExecutorService> _logger;

    public NmapExecutorService(IOptions<ScanningOptions> options, ILogger<NmapExecutorService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Reports whether the configured nmap binary can be executed, so the UI can
    /// say "nmap not installed" instead of failing every scan mysteriously.
    /// </summary>
    public bool IsNmapAvailable(out string? version)
    {
        version = null;
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = string.IsNullOrEmpty(_options.NmapPath) ? "nmap" : _options.NmapPath,
                Arguments = "--version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            version = output.Split('\n').FirstOrDefault()?.Trim();
            return p.ExitCode == 0;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "nmap is not available on this host");
            return false;
        }
    }

    /// <summary>
    /// Executes one scan and returns the path to its XML output plus the exact
    /// command that ran (stored on the scan record so results are reproducible).
    /// </summary>
    public async Task<(string xmlPath, string command)> RunProfileScanAsync(
        string cidr, string nmapArgs, IEnumerable<string>? excludeIps = null, CancellationToken ct = default)
    {
        // Validate before the value can reach a command line.
        CidrUtil.ValidateForCommand(cidr);

        var scanArgs = nmapArgs;

        // Nmap's host discovery is all-or-nothing: specifying ANY -P* flag
        // replaces the entire default probe set. A profile that says "-sV" with
        // no -P therefore silently loses TCP discovery. Inject the full default
        // set when the profile expresses no opinion.
        if (!scanArgs.Contains("-PE") && !scanArgs.Contains("-PP") &&
            !scanArgs.Contains("-PS") && !scanArgs.Contains("-PA") &&
            !scanArgs.Contains("-PU") && !scanArgs.Contains("-Pn"))
        {
            scanArgs = $"-PE -PP -PS443 -PA80 {scanArgs}";
            _logger.LogDebug("Injected default discovery probes for reliable host detection");
        }

        // --open omits hosts with no open ports from the XML entirely, even when
        // they answered discovery. That reads downstream as "host disappeared"
        // and produces false offline alerts, so it is always stripped.
        if (scanArgs.Contains("--open"))
        {
            scanArgs = scanArgs.Replace("--open", "").Trim();
            _logger.LogDebug("Stripped --open so alive-but-filtered hosts still appear in results");
        }

        // Devices flagged as excluded are skipped without editing the CIDR.
        var excludeArg = "";
        var excluded = excludeIps?.Where(ip => !string.IsNullOrWhiteSpace(ip)).ToList() ?? [];
        if (excluded.Count > 0)
        {
            foreach (var ip in excluded) CidrUtil.ValidateForCommand(ip);
            excludeArg = $" --exclude {string.Join(",", excluded)}";
        }

        var tempDir = string.IsNullOrEmpty(_options.TempDirectory) ? Path.GetTempPath() : _options.TempDirectory;
        Directory.CreateDirectory(tempDir);

        // GUID filename so parallel scans never collide.
        var xmlPath = Path.Combine(tempDir, $"nmap_{Guid.NewGuid():N}.xml");
        var nmapPath = string.IsNullOrEmpty(_options.NmapPath) ? "nmap" : _options.NmapPath;
        var fullArgs = $"{scanArgs}{excludeArg} -oX \"{xmlPath}\" {cidr}";
        var command = $"{nmapPath} {fullArgs}";

        _logger.LogInformation("Running: {Command}", command);

        var psi = new ProcessStartInfo
        {
            FileName = nmapPath,
            Arguments = fullArgs,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi };
        process.Start();

        // Drain both pipes concurrently — reading them in sequence deadlocks on
        // scans that write a lot to stderr.
        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        await Task.WhenAll(stdoutTask, stderrTask);
        await process.WaitForExitAsync(ct);

        if (process.ExitCode != 0)
        {
            var stderr = await stderrTask;
            _logger.LogError("Nmap failed (exit {Code}): {Stderr}", process.ExitCode, stderr);
            throw new InvalidOperationException($"Nmap exited with code {process.ExitCode}: {stderr}");
        }

        if (!File.Exists(xmlPath))
            throw new FileNotFoundException("Nmap produced no XML output", xmlPath);

        _logger.LogInformation("Scan complete: {XmlPath}", xmlPath);
        return (xmlPath, command);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// XML parsing
// ─────────────────────────────────────────────────────────────────────────────

public interface IScanResultParserService
{
    ParsedScanResult Parse(string xmlContent);
}

/// <summary>
/// Turns nmap XML into <see cref="ParsedScanResult"/>. DTD processing is
/// disabled: nmap output carries a DOCTYPE, and honouring it would open an XXE
/// hole on any file an operator could influence.
/// </summary>
public class ScanResultParserService : IScanResultParserService
{
    public ParsedScanResult Parse(string xmlContent)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(xmlContent), settings);
        var doc = XDocument.Load(reader);
        var result = new ParsedScanResult();

        foreach (var host in doc.Descendants("host"))
        {
            var isUp = host.Element("status")?.Attribute("state")?.Value == "up";
            if (isUp) result.HostsUp++; else result.HostsDown++;

            var parsed = new ParsedHost { IsUp = isUp };

            // A host carries one <address> per address type: ipv4, and mac when
            // the scan was on-subnet (MAC only resolves via ARP).
            foreach (var addr in host.Elements("address"))
            {
                var value = addr.Attribute("addr")?.Value ?? "";
                switch (addr.Attribute("addrtype")?.Value)
                {
                    case "ipv4":
                        parsed.IpAddress = value;
                        break;
                    case "mac":
                        parsed.MacAddress = value;
                        // OUI lookup nmap already did for us.
                        parsed.Vendor = addr.Attribute("vendor")?.Value;
                        break;
                }
            }

            parsed.Hostname = host.Descendants("hostname").FirstOrDefault()?.Attribute("name")?.Value;

            // Only present when the profile ran -O; take the highest-confidence match.
            parsed.OsGuess = host.Descendants("osmatch").FirstOrDefault()?.Attribute("name")?.Value;

            // srtt is microseconds; the UI wants milliseconds.
            var srtt = host.Element("times")?.Attribute("srtt")?.Value;
            if (double.TryParse(srtt, out var srttUs)) parsed.LatencyMs = Math.Round(srttUs / 1000.0, 2);

            foreach (var port in host.Descendants("port"))
            {
                var service = port.Element("service");
                var parsedPort = new ParsedPort
                {
                    PortNumber = int.TryParse(port.Attribute("portid")?.Value, out var p) ? p : 0,
                    Protocol = port.Attribute("protocol")?.Value ?? "tcp",
                    State = port.Element("state")?.Attribute("state")?.Value ?? "unknown",
                    ServiceName = service?.Attribute("name")?.Value,
                    ServiceVersion = BuildVersionString(service)
                };

                foreach (var script in port.Elements("script"))
                    parsedPort.Scripts.Add(ParseScript(script));

                parsed.Ports.Add(parsedPort);
            }

            var hostScriptEl = host.Element("hostscript");
            if (hostScriptEl != null)
                foreach (var script in hostScriptEl.Elements("script"))
                    parsed.HostScripts.Add(ParseScript(script));

            if (!string.IsNullOrEmpty(parsed.IpAddress))
                result.Hosts.Add(parsed);
        }

        return result;
    }

    /// <summary>Reads an NSE &lt;script&gt; node: its id, text output, and flattened elements.</summary>
    private static ParsedScript ParseScript(XElement script)
    {
        var parsed = new ParsedScript
        {
            Id = script.Attribute("id")?.Value ?? "",
            Output = script.Attribute("output")?.Value ?? ""
        };

        foreach (var elem in script.Elements("elem"))
        {
            var key = elem.Attribute("key")?.Value;
            if (!string.IsNullOrEmpty(key)) parsed.Elements[key] = elem.Value;
        }

        // ssl-cert and friends nest their useful fields one table deep.
        foreach (var table in script.Elements("table"))
        {
            var tableKey = table.Attribute("key")?.Value ?? "";
            foreach (var elem in table.Elements("elem"))
            {
                var key = elem.Attribute("key")?.Value;
                if (!string.IsNullOrEmpty(key)) parsed.Elements[$"{tableKey}.{key}"] = elem.Value;
            }
        }

        return parsed;
    }

    /// <summary>Joins product/version/extrainfo into "Apache httpd 2.4.52 ((Ubuntu))".</summary>
    private static string? BuildVersionString(XElement? service)
    {
        if (service == null) return null;
        var parts = new[]
        {
            service.Attribute("product")?.Value,
            service.Attribute("version")?.Value,
            service.Attribute("extrainfo")?.Value
        }.Where(s => !string.IsNullOrEmpty(s));
        var combined = string.Join(" ", parts);
        return string.IsNullOrEmpty(combined) ? null : combined;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Device classification
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Best-effort device typing from the signals a scan actually returns. Order
/// matters: the most specific signal (open management ports) wins over the
/// vaguest (vendor name).
/// </summary>
public static class DeviceClassifier
{
    public static string Classify(string? osGuess, string? vendor, string? hostname, IEnumerable<int> openPorts)
    {
        var ports = openPorts.ToHashSet();
        var os = osGuess?.ToLowerInvariant() ?? "";
        var vend = vendor?.ToLowerInvariant() ?? "";
        var host = hostname?.ToLowerInvariant() ?? "";

        // Printers announce themselves loudly on 9100/631.
        if (ports.Contains(9100) || ports.Contains(515) || ports.Contains(631)
            || vend.Contains("hewlett") || vend.Contains("lexmark") || vend.Contains("zebra")
            || host.Contains("print") || host.Contains("prn"))
            return "printer";

        if (os.Contains("ios") || os.Contains("routeros") || vend.Contains("cisco") || vend.Contains("juniper")
            || host.StartsWith("rtr") || host.Contains("router") || host.Contains("gw"))
            return ports.Contains(179) || host.Contains("router") || host.StartsWith("rtr") ? "router" : "switch";

        if (vend.Contains("aruba") || vend.Contains("ubiquiti") || vend.Contains("netgear")
            || host.StartsWith("sw") || host.Contains("switch"))
            return "switch";

        if (vend.Contains("fortinet") || vend.Contains("palo alto") || vend.Contains("sonicwall")
            || host.Contains("fw") || host.Contains("firewall"))
            return "firewall";

        if (vend.Contains("axis") || vend.Contains("hikvision") || vend.Contains("hanwha")
            || host.Contains("cam") || ports.Contains(554))
            return "camera";

        // Server vs workstation: listening services is the practical divider.
        if (ports.Contains(3306) || ports.Contains(1433) || ports.Contains(5432) || ports.Contains(1521)
            || ports.Contains(80) || ports.Contains(443) || ports.Contains(22) || ports.Contains(25)
            || os.Contains("server") || host.Contains("srv") || host.Contains("server"))
            return "server";

        if (os.Contains("windows") && (ports.Contains(3389) || ports.Contains(445)))
            return "workstation";

        return "unknown";
    }
}
