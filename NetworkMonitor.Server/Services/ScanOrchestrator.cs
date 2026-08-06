using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Helpers;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Services;

/// <summary>
/// Runs a scan end to end: execute nmap, parse the XML, reconcile what changed
/// against what we already knew, and raise alerts. This is the piece that turns
/// a port scanner into a monitoring system — a raw scan tells you what is there
/// now; the reconciliation tells you what is <em>different</em>, which is the
/// only part a human needs to read.
/// </summary>
public class ScanOrchestrator
{
    private readonly NetworkMonitorDbContext _db;
    private readonly INmapExecutorService _nmap;
    private readonly IScanResultParserService _parser;
    private readonly AlertOptions _alertOptions;
    private readonly ScanningOptions _scanningOptions;
    private readonly ILogger<ScanOrchestrator> _logger;

    /// <summary>Creates the orchestrator. Scoped, because it holds a DbContext.</summary>
    /// <param name="db">Unit of work for the whole reconciliation — the scan record, device updates, snapshots, and alerts all land through this one context.</param>
    /// <param name="nmap">The process seam; substituting it is what makes this class testable without a scanner.</param>
    /// <param name="parser">Turns the XML nmap wrote into objects.</param>
    /// <param name="alertOptions">Supplies the missed-scan threshold that decides when a quiet device becomes an offline one.</param>
    /// <param name="scanningOptions">Supplies the maximum target size, checked before any packet leaves the host.</param>
    /// <param name="logger">Scan progress and failures.</param>
    public ScanOrchestrator(
        NetworkMonitorDbContext db,
        INmapExecutorService nmap,
        IScanResultParserService parser,
        IOptions<AlertOptions> alertOptions,
        IOptions<ScanningOptions> scanningOptions,
        ILogger<ScanOrchestrator> logger)
    {
        _db = db;
        _nmap = nmap;
        _parser = parser;
        _alertOptions = alertOptions.Value;
        _scanningOptions = scanningOptions.Value;
        _logger = logger;
    }

    /// <summary>
    /// Scans one network with one profile and records everything that came of it.
    /// Returns the persisted <see cref="ScanResult"/>, including the failure
    /// reason when the scan could not run.
    /// </summary>
    public async Task<ScanResult> RunScanAsync(int networkId, string profileType, CancellationToken ct = default)
    {
        var network = await _db.Networks.FirstOrDefaultAsync(n => n.Id == networkId, ct)
            ?? throw new InvalidOperationException($"Network {networkId} not found");

        // Guard against a mistyped prefix before any packets leave the host: a
        // stray /8 is 16.7 million addresses and will run for days while
        // saturating the link. Cheaper to refuse than to explain afterwards.
        var addressCount = CidrUtil.AddressCount(network.Cidr);
        if (addressCount > _scanningOptions.MaxTargetAddresses)
        {
            var scanTooLarge = new ScanResult
            {
                NetworkId = networkId,
                ScanType = profileType,
                StartedAt = DateTime.UtcNow,
                CompletedAt = DateTime.UtcNow,
                Status = "failed",
                FailureReason =
                    $"Target {network.Cidr} covers {addressCount:N0} addresses, above the configured " +
                    $"limit of {_scanningOptions.MaxTargetAddresses:N0} (Scanning:MaxTargetAddresses). " +
                    "Split the range into smaller networks or raise the limit."
            };
            _db.ScanResults.Add(scanTooLarge);
            await _db.SaveChangesAsync(ct);
            _logger.LogWarning("Refused scan of {Cidr}: {Count} addresses exceeds cap", network.Cidr, addressCount);
            return scanTooLarge;
        }

        var profile = await _db.ScanProfiles
            .FirstOrDefaultAsync(p => p.NetworkId == networkId && p.ProfileType == profileType, ct);

        var nmapArgs = profile?.NmapArgs
            ?? ScanProfileDefaults.All.First(p => p.ProfileType == profileType).NmapArgs;

        // Excluded devices are skipped at the nmap level, not filtered afterwards,
        // so we never even touch a host someone asked us to leave alone.
        var excludedIps = await _db.Devices
            .Where(d => d.NetworkId == networkId && d.IsExcluded)
            .Select(d => d.IpAddress)
            .ToListAsync(ct);

        var scan = new ScanResult
        {
            NetworkId = networkId,
            ScanType = profileType,
            StartedAt = DateTime.UtcNow,
            Status = "running",
            ExcludedCount = excludedIps.Count
        };
        _db.ScanResults.Add(scan);
        await _db.SaveChangesAsync(ct);

        try
        {
            var (xmlPath, command) = await _nmap.RunProfileScanAsync(network.Cidr, nmapArgs, excludedIps, ct);
            scan.NmapCommand = command;

            var xml = await File.ReadAllTextAsync(xmlPath, ct);
            scan.RawXml = xml;
            TryDelete(xmlPath);

            var parsed = _parser.Parse(xml);
            scan.HostsUp = parsed.HostsUp;
            scan.HostsDown = parsed.HostsDown;

            await ReconcileAsync(network, scan, parsed, ct);

            scan.Status = "completed";
            scan.CompletedAt = DateTime.UtcNow;

            if (profile != null) profile.LastRunAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "Scan {ScanId} on {Cidr} finished: {Up} up, {Down} down, {New} new",
                scan.Id, network.Cidr, scan.HostsUp, scan.HostsDown, scan.NewDevices);
        }
        catch (Exception ex)
        {
            scan.Status = "failed";
            scan.CompletedAt = DateTime.UtcNow;
            scan.FailureReason = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
            await _db.SaveChangesAsync(ct);
            _logger.LogError(ex, "Scan {ScanId} on {Cidr} failed", scan.Id, network.Cidr);
        }

        return scan;
    }

    /// <summary>
    /// Diffs a parsed scan against stored state: inserts new devices, updates
    /// existing ones, ages out non-responders, tracks port changes, and writes
    /// one snapshot per device so history is queryable.
    /// </summary>
    private async Task ReconcileAsync(Network network, ScanResult scan, ParsedScanResult parsed, CancellationToken ct)
    {
        var existing = await _db.Devices
            .Include(d => d.Ports)
            .Where(d => d.NetworkId == network.Id)
            .ToListAsync(ct);

        var byIp = existing.ToDictionary(d => d.IpAddress, StringComparer.OrdinalIgnoreCase);
        var seenIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var now = DateTime.UtcNow;

        foreach (var host in parsed.Hosts.Where(h => h.IsUp))
        {
            seenIps.Add(host.IpAddress);
            var openPorts = host.Ports.Where(p => p.State == "open").ToList();

            if (!byIp.TryGetValue(host.IpAddress, out var device))
            {
                // ── First sighting ────────────────────────────────────────────
                device = new Device
                {
                    NetworkId = network.Id,
                    IpAddress = host.IpAddress,
                    MacAddress = host.MacAddress,
                    Hostname = host.Hostname,
                    Vendor = host.Vendor,
                    OsGuess = host.OsGuess,
                    Status = "new",
                    FirstSeen = now,
                    LastSeen = now,
                    LastScannedAt = now,
                    DeviceType = DeviceClassifier.Classify(
                        host.OsGuess, host.Vendor, host.Hostname, openPorts.Select(p => p.PortNumber))
                };
                _db.Devices.Add(device);
                await _db.SaveChangesAsync(ct); // need the id for ports/alerts
                byIp[device.IpAddress] = device;
                scan.NewDevices++;

                AddAlert(device, network.Id, "new_device", "warning",
                    $"New device {host.IpAddress}{Describe(host)} appeared on {network.Name}",
                    $"MAC: {host.MacAddress ?? "unknown"}\nVendor: {host.Vendor ?? "unknown"}\nOpen ports: {openPorts.Count}");
            }
            else
            {
                // ── Known device: refresh identity, note a return from offline ──
                var wasOffline = device.Status == "offline";

                device.MacAddress = host.MacAddress ?? device.MacAddress;
                // Discovery owns the hostname unless an operator overrode it.
                // Overwriting a hand-entered name silently undoes the
                // correction, and the operator's only clue is that their edit
                // "didn't save".
                if (!device.HostnameIsManual)
                    device.Hostname = host.Hostname ?? device.Hostname;
                device.Vendor = host.Vendor ?? device.Vendor;
                device.OsGuess = host.OsGuess ?? device.OsGuess;
                device.LastSeen = now;
                device.LastScannedAt = now;
                device.MissedScans = 0;
                device.Status = "online";

                // Only re-classify when this scan actually learned something new;
                // a quick ping sweep must not downgrade a device typed by a deep scan.
                if (openPorts.Count > 0 || host.OsGuess != null)
                {
                    device.DeviceType = DeviceClassifier.Classify(
                        device.OsGuess, device.Vendor, device.Hostname, openPorts.Select(p => p.PortNumber));
                }

                if (wasOffline)
                {
                    AddAlert(device, network.Id, "device_online", "info",
                        $"{Label(device)} is back online", null);
                }
            }

            if (openPorts.Count > 0)
                await ReconcilePortsAsync(device, network.Id, openPorts, now, ct);

            _db.ScanDeviceSnapshots.Add(new ScanDeviceSnapshot
            {
                ScanResultId = scan.Id,
                DeviceId = device.Id,
                Status = "online",
                OpenPortCount = openPorts.Count,
                ResponseTimeMs = host.LatencyMs,
                RecordedAt = now
            });
        }

        // ── Devices the scan covered but did not hear from ────────────────────
        // One missed scan is noise (a laptop slept, a packet dropped). Only after
        // the configured number of consecutive misses does a device go offline.
        foreach (var device in existing.Where(d => !seenIps.Contains(d.IpAddress) && !d.IsExcluded))
        {
            device.LastScannedAt = now;
            device.MissedScans++;

            if (device.Status != "offline" && device.MissedScans >= _alertOptions.OfflineAfterMissedScans)
            {
                device.Status = "offline";
                AddAlert(device, network.Id, "device_offline", "critical",
                    $"{Label(device)} is offline",
                    $"Missed {device.MissedScans} consecutive scans. Last seen {device.LastSeen:u}.");
            }

            _db.ScanDeviceSnapshots.Add(new ScanDeviceSnapshot
            {
                ScanResultId = scan.Id,
                DeviceId = device.Id,
                Status = device.Status == "offline" ? "offline" : "missed",
                OpenPortCount = 0,
                RecordedAt = now
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Updates the port list for a device and alerts on the two changes that
    /// matter operationally: a service that appeared, and one that vanished.
    /// </summary>
    private async Task ReconcilePortsAsync(Device device, int networkId, List<ParsedPort> openPorts, DateTime now, CancellationToken ct)
    {
        var stored = await _db.Ports.Where(p => p.DeviceId == device.Id).ToListAsync(ct);
        var storedKeys = stored.ToDictionary(p => (p.PortNumber, p.Protocol));
        var scannedKeys = openPorts.Select(p => (p.PortNumber, p.Protocol)).ToHashSet();

        foreach (var port in openPorts)
        {
            if (storedKeys.TryGetValue((port.PortNumber, port.Protocol), out var existingPort))
            {
                existingPort.State = port.State;
                existingPort.ServiceName = port.ServiceName ?? existingPort.ServiceName;
                existingPort.ServiceVersion = port.ServiceVersion ?? existingPort.ServiceVersion;
                existingPort.LastSeen = now;
            }
            else
            {
                _db.Ports.Add(new Port
                {
                    DeviceId = device.Id,
                    PortNumber = port.PortNumber,
                    Protocol = port.Protocol,
                    State = port.State,
                    ServiceName = port.ServiceName,
                    ServiceVersion = port.ServiceVersion,
                    FirstSeen = now,
                    LastSeen = now
                });

                // A newly listening service on an established host is exactly the
                // kind of drift that deserves a look.
                AddAlert(device, networkId, "port_opened", "warning",
                    $"Port {port.PortNumber}/{port.Protocol} opened on {Label(device)}",
                    $"Service: {port.ServiceName ?? "unknown"} {port.ServiceVersion}".TrimEnd());
            }
        }

        // Only treat ports as closed when the scan actually probed ports at all —
        // a ping sweep returns none and must not close everything.
        foreach (var gone in stored.Where(p => !scannedKeys.Contains((p.PortNumber, p.Protocol))))
        {
            _db.Ports.Remove(gone);
            AddAlert(device, networkId, "port_closed", "info",
                $"Port {gone.PortNumber}/{gone.Protocol} closed on {Label(device)}",
                $"Was: {gone.ServiceName ?? "unknown"}");
        }
    }

    private void AddAlert(Device device, int networkId, string type, string severity, string message, string? details)
    {
        _db.Alerts.Add(new Alert
        {
            DeviceId = device.Id,
            NetworkId = networkId,
            AlertType = type,
            Severity = severity,
            Message = message,
            Details = details,
            CreatedAt = DateTime.UtcNow
        });
    }

    private static string Label(Device d) =>
        string.IsNullOrWhiteSpace(d.Hostname) ? d.IpAddress : $"{d.Hostname} ({d.IpAddress})";

    private static string Describe(ParsedHost h) =>
        string.IsNullOrWhiteSpace(h.Hostname) ? "" : $" ({h.Hostname})";

    private void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) { _logger.LogDebug(ex, "Could not delete temp file {Path}", path); }
    }
}

/// <summary>
/// The default scan profiles created for every new network. Keeping them in one
/// place stops the create path and the backfill path from drifting apart.
/// </summary>
public static class ScanProfileDefaults
{
    /// <summary>
    /// The five profile types, in the order the UI lists them. This collection is
    /// also the validation whitelist for the run endpoint, so adding a profile
    /// here is all it takes to make it runnable.
    /// </summary>
    public static IReadOnlyList<DefaultProfile> All { get; } =
    [
        // Host discovery only — cheap enough to run every few minutes.
        new("quick", "-sn -PE -PP -PS22,80,443,3389,445 -PA80,445 -T4", 300, true),

        // Service detection. Carries the same discovery probes as quick on
        // purpose: without them nmap falls back to a narrow default set and deep
        // reports a fraction of the hosts quick found. -sT rather than -sS so it
        // works without raw-socket privileges.
        new("deep", "-sT -sV -T3 -PE -PP -PS22,80,443,3389,445 -PA80,445 --host-timeout 10m --max-retries 2 --top-ports 50", 3600, true),

        // NSE vulnerability and TLS scripts. Heavier and noisier — weekly, off by default.
        new("security", "-sT -sV --script \"(vuln or ssl-cert or ssl-enum-ciphers) and not (auth or brute or dos)\" -T3 --top-ports 100 --host-timeout 4m", 604800, false),

        // Every TCP port. Slow; run it deliberately.
        new("full_port", "-sT -sV -p- -T3", 604800, false),

        // UDP needs raw sockets — requires elevated privileges (or Npcap on Windows).
        new("udp", "-sU -sV --top-ports 100 -T3 --host-timeout 5m --version-intensity 2", 604800, false),
    ];

    /// <summary>Materializes the default profile set for a specific network.</summary>
    public static IEnumerable<ScanProfile> ForNetwork(Network network)
    {
        foreach (var d in All)
        {
            var interval = d.ProfileType switch
            {
                "quick" => network.ScanIntervalSeconds > 0 ? network.ScanIntervalSeconds : 300,
                "deep" => network.DeepScanIntervalSeconds > 0 ? network.DeepScanIntervalSeconds : 3600,
                _ => d.IntervalSeconds
            };
            yield return new ScanProfile
            {
                NetworkId = network.Id,
                ProfileType = d.ProfileType,
                NmapArgs = d.NmapArgs,
                IntervalSeconds = interval,
                IsEnabled = d.IsEnabled
            };
        }
    }

    /// <summary>One entry in the built-in profile table.</summary>
    /// <param name="ProfileType">quick, deep, security, full_port, or udp. Doubles as the route segment for per-profile updates.</param>
    /// <param name="NmapArgs">Default arguments, minus the target and output flags the executor appends.</param>
    /// <param name="IntervalSeconds">Default cadence in seconds. The quick and deep values are overridden per network by the network's own interval fields.</param>
    /// <param name="IsEnabled">Whether a newly created network schedules this profile. The three heavy profiles ship off, so a new network cannot start a week-long full-port sweep by itself.</param>
    public sealed record DefaultProfile(string ProfileType, string NmapArgs, int IntervalSeconds, bool IsEnabled);
}

/// <summary>
/// Background loop that runs due scan profiles. In this build scanning happens
/// in-process, which is the right shape for one site; docs/ARCHITECTURE.md
/// describes how the same design distributes to per-site agents when one host
/// can no longer reach (or keep up with) every network.
/// </summary>
public class ScanSchedulerService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ScanningOptions _options;
    private readonly ILogger<ScanSchedulerService> _logger;

    /// <summary>Creates the scheduler.</summary>
    /// <param name="scopeFactory">The service is a singleton but the orchestrator it drives is scoped, so every tick opens its own scope rather than capturing a DbContext.</param>
    /// <param name="options">Supplies the master enable switch and the tick interval.</param>
    /// <param name="logger">Tick-level progress and per-profile failures.</param>
    public ScanSchedulerService(
        IServiceScopeFactory scopeFactory,
        IOptions<ScanningOptions> options,
        ILogger<ScanSchedulerService> logger)
    {
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// The scheduling loop. Returns immediately without scanning anything when
    /// Scanning:SchedulerEnabled is false, which is how the shipped configuration
    /// leaves it — a freshly cloned demo must not start probing the network it
    /// happens to be sitting on.
    /// </summary>
    /// <param name="stoppingToken">Signalled on host shutdown; ends the loop.</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.SchedulerEnabled)
        {
            _logger.LogInformation("Scan scheduler is disabled (Scanning:SchedulerEnabled=false)");
            return;
        }

        _logger.LogInformation("Scan scheduler started; checking for due profiles every {Seconds}s",
            _options.SchedulerTickSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunDueProfilesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                // Never let one bad cycle kill the loop.
                _logger.LogError(ex, "Scheduler cycle failed");
            }

            await Task.Delay(TimeSpan.FromSeconds(_options.SchedulerTickSeconds), stoppingToken);
        }
    }

    private async Task RunDueProfilesAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NetworkMonitorDbContext>();

        var now = DateTime.UtcNow;
        var due = await db.ScanProfiles
            .Include(p => p.Network)
            .Where(p => p.IsEnabled && p.Network!.IsEnabled)
            .ToListAsync(ct);

        foreach (var profile in due)
        {
            if (profile.LastRunAt.HasValue &&
                profile.LastRunAt.Value.AddSeconds(profile.IntervalSeconds) > now)
                continue;

            // One scan at a time: nmap is happy to saturate a link, and a
            // monitoring tool that degrades the network it watches is worse
            // than no monitoring at all.
            using var runScope = _scopeFactory.CreateScope();
            var orchestrator = runScope.ServiceProvider.GetRequiredService<ScanOrchestrator>();
            await orchestrator.RunScanAsync(profile.NetworkId, profile.ProfileType, ct);
        }
    }
}
