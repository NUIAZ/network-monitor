// The scanner-facing half of the pipeline: run nmap, read what it said, and
// classify what was found. Everything in this file is site-local work: it
// needs a network to probe and a binary to run, but no database and no global
// state.
//
// That boundary is deliberate rather than incidental. Reconciliation (which
// devices are new, which stopped answering, which ports changed) lives in
// ScanOrchestrator because it needs the whole inventory to decide anything;
// the concerns here need only the host in front of them. Keeping the seam at
// this line is what makes the distributed-agent topology described in
// docs/ARCHITECTURE.md an incremental change rather than a rewrite: a per-site
// agent ships this file and nothing else.

using System.Diagnostics;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Helpers;

namespace NetworkMonitor.Server.Services;

// ─────────────────────────────────────────────────────────────────────────────
// Parsed scan DTOs: the boundary between "what nmap said" and "what we store".
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Everything one scan produced, before it touches the database.</summary>
public class ParsedScanResult
{
    /// <summary>Hosts that carried a usable IPv4 address. Hosts nmap listed without one are dropped during parsing.</summary>
    public List<ParsedHost> Hosts { get; } = [];

    /// <summary>Count of hosts nmap reported as up. Counted from the XML rather than derived from <see cref="Hosts"/>, which excludes unusable entries.</summary>
    public int HostsUp { get; set; }

    /// <summary>Count of hosts nmap reported as down.</summary>
    public int HostsDown { get; set; }
}

/// <summary>One host as nmap reported it.</summary>
public class ParsedHost
{
    /// <summary>IPv4 address from the host's ipv4 &lt;address&gt; element. Empty means the host is discarded.</summary>
    public string IpAddress { get; set; } = "";

    /// <summary>MAC from the mac &lt;address&gt; element. Only present when the scan ran on-subnet, since MAC resolves via ARP.</summary>
    public string? MacAddress { get; set; }

    /// <summary>First reverse-DNS name nmap resolved, if any.</summary>
    public string? Hostname { get; set; }

    /// <summary>OUI vendor nmap looked up from the MAC. Null whenever the MAC is.</summary>
    public string? Vendor { get; set; }

    /// <summary>Highest-confidence osmatch name. Only populated when the profile ran -O.</summary>
    public string? OsGuess { get; set; }

    /// <summary>Whether the host's status element said "up".</summary>
    public bool IsUp { get; set; }

    /// <summary>Smoothed round-trip time in milliseconds, converted from nmap's srtt (which is microseconds). Null when the scan reported no timing.</summary>
    public double? LatencyMs { get; set; }

    /// <summary>Ports found on this host, in XML order. Includes closed and filtered ports, not just open ones.</summary>
    public List<ParsedPort> Ports { get; } = [];

    /// <summary>NSE scripts that ran against the host rather than a specific port, e.g. SMB discovery.</summary>
    public List<ParsedScript> HostScripts { get; } = [];
}

/// <summary>One port and the service nmap identified on it.</summary>
public class ParsedPort
{
    /// <summary>Port number, 1-65535. Zero means the portid attribute was missing or unparseable.</summary>
    public int PortNumber { get; set; }

    /// <summary>"tcp" or "udp".</summary>
    public string Protocol { get; set; } = "tcp";

    /// <summary>Nmap port state: open, filtered, closed, or "unknown" when the XML carried no state element.</summary>
    public string State { get; set; } = "open";

    /// <summary>Service name nmap assigned. Inferred from the port number alone unless -sV ran.</summary>
    public string? ServiceName { get; set; }

    /// <summary>Product, version, and extra info joined into one string; null when nmap identified none of them.</summary>
    public string? ServiceVersion { get; set; }

    /// <summary>NSE scripts that ran against this specific port, e.g. ssl-cert or a vuln script.</summary>
    public List<ParsedScript> Scripts { get; } = [];
}

/// <summary>Output of one NSE script, both raw text and any structured elements.</summary>
public class ParsedScript
{
    /// <summary>Script name, e.g. "ssl-cert" or "vulners", how consumers decide whether they care about this result.</summary>
    public string Id { get; set; } = "";

    /// <summary>The script's human-readable output block, kept verbatim for scripts with no structured elements.</summary>
    public string Output { get; set; } = "";

    /// <summary>
    /// Structured &lt;elem&gt; values keyed by name. Elements nested one table deep
    /// are flattened to "tableKey.elemKey", which is how ssl-cert exposes the
    /// fields that matter.
    /// </summary>
    public Dictionary<string, string> Elements { get; } = [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Nmap execution
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The seam between the application and the nmap binary. Everything that shells
/// out lives behind this interface, which is what lets the tests exercise the
/// whole pipeline without a scanner installed.
/// </summary>
public interface INmapExecutorService
{
    /// <summary>Runs one scan and returns the XML output path plus the exact command that produced it.</summary>
    /// <param name="cidr">Target IPv4 address or CIDR block. Validated before it can reach a command line.</param>
    /// <param name="nmapArgs">Profile arguments, minus target and output flags. The implementation may adjust these, see the remarks on the concrete method.</param>
    /// <param name="excludeIps">Addresses to skip via --exclude. Each is validated the same way as the target.</param>
    /// <param name="ct">Cancels the wait on the nmap process.</param>
    /// <returns>The path to the XML nmap wrote, and the full command line, which the caller stores on the scan record.</returns>
    Task<(string xmlPath, string command)> RunProfileScanAsync(string cidr, string nmapArgs, IEnumerable<string>? excludeIps = null, CancellationToken ct = default);

    /// <summary>Whether the configured nmap binary can actually be executed on this host.</summary>
    /// <param name="version">Receives the first line of <c>nmap --version</c>, or null when nmap could not be run.</param>
    /// <returns>True when nmap exited cleanly.</returns>
    bool IsNmapAvailable(out string? version);
}

/// <summary>
/// Runs nmap as an external process and hands back the XML it produced.
/// Targets are validated before they reach the command line, and the argument
/// string is adjusted for two behaviours that bite every nmap integration;
/// see the comments in <see cref="RunProfileScanAsync"/>.
/// </summary>
public class NmapExecutorService : INmapExecutorService
{
    private readonly ScanningOptions _options;
    private readonly ILogger<NmapExecutorService> _logger;

    /// <summary>Creates the executor.</summary>
    /// <param name="options">Supplies the nmap binary path and the temp directory scan XML is written to; both fall back to sensible defaults when blank.</param>
    /// <param name="logger">Receives the full command line of every scan, which is the first thing anyone wants when a scan misbehaves.</param>
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

        // Drain both pipes concurrently: reading them in sequence deadlocks on
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

/// <summary>
/// Turns nmap's XML into plain objects. Split from the executor so scan
/// reconciliation can be tested against captured XML fixtures with no process
/// launching anywhere in the picture.
/// </summary>
public interface IScanResultParserService
{
    /// <summary>Parses one nmap XML document.</summary>
    /// <param name="xmlContent">The complete XML text nmap wrote. Its DOCTYPE is ignored rather than resolved.</param>
    /// <returns>Hosts, ports, and script output; hosts with no IPv4 address are omitted.</returns>
    ParsedScanResult Parse(string xmlContent);
}

/// <summary>
/// Turns nmap XML into <see cref="ParsedScanResult"/>. DTD processing is
/// disabled: nmap output carries a DOCTYPE, and honouring it would open an XXE
/// hole on any file an operator could influence.
/// </summary>
public class ScanResultParserService : IScanResultParserService
{
    /// <summary>
    /// Reads one nmap XML document into <see cref="ParsedScanResult"/>. Hosts
    /// without an IPv4 address are dropped, but they still count toward the
    /// up/down totals: those are taken from the XML's own status elements.
    /// </summary>
    /// <param name="xmlContent">The complete XML text nmap wrote.</param>
    /// <returns>The parsed hosts plus the up/down counts nmap reported.</returns>
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
    /// <summary>
    /// Picks the single best device type for a host. The checks are ordered
    /// deliberately: the first one that matches wins, so a printer that also
    /// serves a web UI is still a printer rather than a server.
    /// </summary>
    /// <param name="osGuess">OS fingerprint, when the profile ran -O. Matched case-insensitively.</param>
    /// <param name="vendor">OUI vendor name. The weakest signal, checked last within each rule.</param>
    /// <param name="hostname">Hostname, which in practice is the most reliable signal on a well-named estate ("rtr-", "sw-", "-fw").</param>
    /// <param name="openPorts">Open port numbers. Management ports are the strongest signal available.</param>
    /// <returns>router, switch, firewall, printer, server, workstation, camera, or unknown when nothing matched.</returns>
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
