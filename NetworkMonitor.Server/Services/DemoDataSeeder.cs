using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Services;

/// <summary>
/// Seeds a believable, fully fictional estate for "Northwind Logistics" so the
/// app demos itself the moment it starts — every page has data, every chart has
/// a story, and none of it belongs to anyone real. IP ranges are strictly
/// RFC 5737 documentation blocks and RFC 1918 private space, hostnames and
/// people are invented, and the domain is under .example.
///
/// The generator is seeded with a fixed value, so two people running the demo
/// see the same estate — screenshots, docs, and bug reports all line up.
/// Timestamps are relative to "now" so the dashboards always look live.
/// </summary>
public class DemoDataSeeder
{
    /// <summary>Fixed seed: the demo must be deterministic, not merely random.</summary>
    private const int RandomSeed = 20260805;

    private readonly NetworkMonitorDbContext _db;
    private readonly DemoOptions _options;
    private readonly ILogger<DemoDataSeeder> _logger;
    private readonly Random _rng = new(RandomSeed);

    /// <summary>Captured once so every generated timestamp is mutually consistent.</summary>
    private DateTime _now;

    /// <summary>Creates the seeder. Seeding is decided at call time, not here.</summary>
    /// <param name="db">Context the fictional estate is written through.</param>
    /// <param name="options">Carries the first-run switch and the company name woven through the generated data.</param>
    /// <param name="logger">Reports what was seeded, or why seeding was skipped.</param>
    public DemoDataSeeder(NetworkMonitorDbContext db, IOptions<DemoOptions> options, ILogger<DemoDataSeeder> logger)
    {
        _db = db;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Seeds the demo estate when the database is empty. "Empty" is judged by
    /// Sites alone: it is the root of the hierarchy, so its presence means either
    /// a previous seed or real data — and in both cases we must not touch anything.
    /// </summary>
    public async Task SeedIfEmptyAsync()
    {
        if (!_options.SeedOnFirstRun)
        {
            _logger.LogInformation("Demo seeding disabled (Demo:SeedOnFirstRun=false)");
            return;
        }

        if (await _db.Sites.AnyAsync())
        {
            _logger.LogDebug("Database already has sites; skipping demo seed");
            return;
        }

        _now = DateTime.UtcNow;
        _logger.LogInformation("Empty database — seeding the {Company} demo estate", _options.CompanyName);

        var sites = CreateSites();
        _db.Sites.AddRange(sites);
        await _db.SaveChangesAsync(); // ids needed for networks

        var networks = CreateNetworks(sites);
        _db.Networks.AddRange(networks);
        await _db.SaveChangesAsync(); // ids needed for profiles/devices

        // Same profile bootstrap the POST /api/networks path uses, so a seeded
        // network is indistinguishable from a hand-created one.
        foreach (var network in networks)
            _db.ScanProfiles.AddRange(ScanProfileDefaults.ForNetwork(network));

        var (devices, portsByDevice) = CreateDevices(sites, networks);
        _db.Devices.AddRange(devices);
        await _db.SaveChangesAsync(); // ids needed for ports and everything below

        foreach (var (device, ports) in portsByDevice)
            _db.Ports.AddRange(ports.Select(p => MakePort(device, p)));

        var scans = CreateScanHistory(networks, devices);
        _db.ScanResults.AddRange(scans);
        await _db.SaveChangesAsync(); // ids needed for snapshots

        var snapshots = CreateDeviceSnapshots(networks, devices, portsByDevice, scans);
        _db.ScanDeviceSnapshots.AddRange(snapshots);

        var alerts = CreateAlerts(networks, devices, portsByDevice);
        _db.Alerts.AddRange(alerts);

        var vulnerabilities = CreateVulnerabilities(devices);
        _db.Vulnerabilities.AddRange(vulnerabilities);

        var certificates = CreateCertificates(devices, portsByDevice);
        _db.SslCertificates.AddRange(certificates);

        var snmpTargets = CreateSnmpTargets(networks, devices);
        _db.SnmpTargets.AddRange(snmpTargets);
        await _db.SaveChangesAsync(); // ids needed for interface snapshots

        var interfaceSnapshots = CreateInterfaceSnapshots(snmpTargets);
        _db.InterfaceSnapshots.AddRange(interfaceSnapshots);

        _db.AppSettings.AddRange(CreateAppSettings());
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Demo seed complete: {Sites} sites, {Networks} networks, {Devices} devices, {Scans} scans, " +
            "{Snapshots} device snapshots, {Alerts} alerts, {Vulns} vulnerabilities, {Certs} certificates, " +
            "{Snmp} SNMP targets, {IfSnaps} interface snapshots",
            sites.Count, networks.Count, devices.Count, scans.Count, snapshots.Count,
            alerts.Count, vulnerabilities.Count, certificates.Count, snmpTargets.Count, interfaceSnapshots.Count);
    }

    // ── Sites & networks ─────────────────────────────────────────────────────

    private List<Site> CreateSites() =>
    [
        new() { SiteKey = "DAL", Name = "Dallas Distribution Center", City = "Dallas", State = "TX", Latitude = 32.7767, Longitude = -96.7970, CreatedAt = _now.AddDays(-400) },
        new() { SiteKey = "CHI", Name = "Chicago Cold Storage", City = "Chicago", State = "IL", Latitude = 41.8781, Longitude = -87.6298, CreatedAt = _now.AddDays(-380) },
        new() { SiteKey = "ATL", Name = "Atlanta Regional Hub", City = "Atlanta", State = "GA", Latitude = 33.7490, Longitude = -84.3880, CreatedAt = _now.AddDays(-350) },
        new() { SiteKey = "PHX", Name = "Phoenix Fulfillment", City = "Phoenix", State = "AZ", Latitude = 33.4484, Longitude = -112.0740, CreatedAt = _now.AddDays(-200) },
    ];

    /// <summary>
    /// One or two networks per site. Public-looking ranges use only the RFC 5737
    /// documentation blocks (203.0.113.0/24, 198.51.100.0/24) — addresses that
    /// can never collide with a real network someone might accidentally scan.
    /// </summary>
    private List<Network> CreateNetworks(List<Site> sites)
    {
        var dal = sites[0]; var chi = sites[1]; var atl = sites[2]; var phx = sites[3];
        return
        [
            new() { SiteId = dal.Id, Name = "Warehouse Floor", Cidr = "203.0.113.0/24", Description = "Conveyor, scanning, and dock equipment", CreatedAt = dal.CreatedAt.AddDays(1) },
            new() { SiteId = dal.Id, Name = "Server VLAN", Cidr = "10.10.20.0/24", Description = "WMS, database, and virtualization hosts", CreatedAt = dal.CreatedAt.AddDays(1) },
            new() { SiteId = chi.Id, Name = "Cold Storage Ops", Cidr = "198.51.100.0/24", Description = "Freezer floor equipment and monitoring", CreatedAt = chi.CreatedAt.AddDays(2) },
            new() { SiteId = chi.Id, Name = "Office", Cidr = "10.20.30.0/24", Description = "Front-office workstations and printers", CreatedAt = chi.CreatedAt.AddDays(2) },
            new() { SiteId = atl.Id, Name = "Hub Core", Cidr = "192.168.40.0/24", Description = "Regional hub — routing, servers, and yard cameras", CreatedAt = atl.CreatedAt.AddDays(1) },
            new() { SiteId = phx.Id, Name = "Fulfillment Floor", Cidr = "10.40.10.0/24", Description = "Pick/pack floor equipment", CreatedAt = phx.CreatedAt.AddDays(3) },
            new() { SiteId = phx.Id, Name = "Cameras & IoT", Cidr = "192.168.50.0/24", Description = "Dock and yard cameras, NVR", CreatedAt = phx.CreatedAt.AddDays(3) },
        ];
    }

    // ── Devices ──────────────────────────────────────────────────────────────

    /// <summary>One "kind of device" to stamp out: hostname pattern, identity, and port profile.</summary>
    private sealed record RoleSpec(string HostPattern, int Count, string? Vendor, string? Os, string Type, int[] Ports, string? LocationPattern = null);

    // Port profiles by role. These drive both the Port rows and (via the ports)
    // which devices are eligible for certificates and vulnerabilities later.
    private static readonly int[] SwitchPorts = [22, 23, 161, 443];
    private static readonly int[] RouterPorts = [22, 161, 179, 443];
    private static readonly int[] FirewallPorts = [22, 443];
    private static readonly int[] PrinterPorts = [9100, 631, 80];
    private static readonly int[] CameraPorts = [80, 554];
    private static readonly int[] LinuxSrvPorts = [22, 80, 443];
    private static readonly int[] WinSrvPorts = [443, 445, 3389];
    private static readonly int[] WmsPorts = [80, 443, 1433, 3389];
    private static readonly int[] DbPorts = [22, 3306];
    private static readonly int[] EsxPorts = [22, 80, 443, 902];
    private static readonly int[] ApPorts = [22, 443];
    private static readonly int[] UpsPorts = [80, 161];
    private static readonly int[] NvrPorts = [80, 443, 554];
    private static readonly int[] WksPorts = [445, 3389];
    private static readonly int[] NoPorts = [];

    /// <summary>MAC OUI prefixes that plausibly match each vendor name.</summary>
    private static readonly Dictionary<string, string> VendorOui = new()
    {
        ["Cisco Systems"] = "00:1B:54",
        ["Dell Inc."] = "F8:BC:12",
        ["HP Enterprise"] = "94:57:A5",
        ["Axis Communications"] = "AC:CC:8E",
        ["Zebra Technologies"] = "00:23:68",
        ["VMware"] = "00:50:56",
        ["Ubiquiti"] = "24:A4:3C",
    };

    /// <summary>Known service identities for the ports the demo uses.</summary>
    private static readonly Dictionary<int, (string Protocol, string Service, string? Version)> PortCatalog = new()
    {
        [22] = ("tcp", "ssh", "OpenSSH 8.9p1"),
        [23] = ("tcp", "telnet", null),
        [80] = ("tcp", "http", "nginx 1.24.0"),
        [161] = ("udp", "snmp", "net-snmp"),
        [179] = ("tcp", "bgp", null),
        [443] = ("tcp", "https", null),
        [445] = ("tcp", "microsoft-ds", null),
        [554] = ("tcp", "rtsp", null),
        [631] = ("tcp", "ipp", "CUPS 2.4"),
        [902] = ("tcp", "vmware-auth", "VMware Authentication Daemon 1.10"),
        [1433] = ("tcp", "ms-sql-s", "Microsoft SQL Server 2019"),
        [3306] = ("tcp", "mysql", "MySQL 8.0.32"),
        [3389] = ("tcp", "ms-wbt-server", "Microsoft Terminal Services"),
        [9100] = ("tcp", "jetdirect", null),
    };

    /// <summary>
    /// The role mix for each network. Counts are tuned so the whole estate lands
    /// at 120 devices with a distribution that looks like a real logistics floor:
    /// heavy on printers, scanners, and cameras; light on servers.
    /// </summary>
    private static List<RoleSpec> SpecsFor(string siteKey, string networkName) => (siteKey, networkName) switch
    {
        ("DAL", "Warehouse Floor") =>
        [
            new("dal-sw-core{0:00}", 2, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "MDF rack {0}"),
            new("dal-sw-acc{0:00}", 4, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "IDF {0}"),
            new("dal-prn-ship{0:00}", 4, "Zebra Technologies", "Zebra Link-OS", "printer", PrinterPorts, "Ship station {0}"),
            new("dal-cam-dock{0:00}", 5, "Axis Communications", "Axis OS 10.12 (Linux 4.9)", "camera", CameraPorts, "Dock door {0}"),
            new("dal-hh-scan{0:00}", 8, "Zebra Technologies", "Android 11 (Linux 4.14)", "workstation", NoPorts),
            new("dal-ap-wh{0:00}", 2, "Ubiquiti", "Linux 4.4 (UniFi)", "unknown", ApPorts, "Ceiling zone {0}"),
        ],
        ("DAL", "Server VLAN") =>
        [
            new("dal-fw-edge{0:00}", 1, "Cisco Systems", "Cisco ASA 9.16", "firewall", FirewallPorts, "MDF rack 1"),
            new("dal-srv-wms{0:00}", 3, "Dell Inc.", "Microsoft Windows Server 2019", "server", WmsPorts, "MDF rack 2"),
            new("dal-srv-dc{0:00}", 2, "Dell Inc.", "Microsoft Windows Server 2022", "server", WinSrvPorts, "MDF rack 2"),
            new("dal-esx{0:00}", 3, "VMware", "VMware ESXi 7.0.3", "server", EsxPorts, "MDF rack 3"),
            new("dal-srv-web{0:00}", 2, "HP Enterprise", "Ubuntu Linux 22.04", "server", LinuxSrvPorts, "MDF rack 3"),
            new("dal-srv-db{0:00}", 1, "Dell Inc.", "Ubuntu Linux 20.04", "server", DbPorts, "MDF rack 2"),
            new("dal-srv-file{0:00}", 1, "HP Enterprise", "Microsoft Windows Server 2019", "server", WinSrvPorts, "MDF rack 3"),
            new("dal-ups-{0:00}", 2, null, null, "unknown", UpsPorts, "MDF rack {0}"),
            new("dal-wks-eng{0:00}", 3, "Dell Inc.", "Microsoft Windows 11 23H2", "workstation", WksPorts),
        ],
        ("CHI", "Cold Storage Ops") =>
        [
            new("chi-sw-core{0:00}", 1, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "MDF rack 1"),
            new("chi-sw-acc{0:00}", 3, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "Freezer IDF {0}"),
            new("chi-srv-wms{0:00}", 2, "Dell Inc.", "Microsoft Windows Server 2019", "server", WmsPorts, "MDF rack 1"),
            new("chi-prn-ship{0:00}", 3, "Zebra Technologies", "Zebra Link-OS", "printer", PrinterPorts, "Ship station {0}"),
            new("chi-cam-cold{0:00}", 4, "Axis Communications", "Axis OS 10.12 (Linux 4.9)", "camera", CameraPorts, "Freezer aisle {0}"),
            new("chi-hh-scan{0:00}", 5, "Zebra Technologies", "Android 11 (Linux 4.14)", "workstation", NoPorts),
            new("chi-temp-mon{0:00}", 2, null, null, "unknown", [80], "Freezer zone {0}"),
        ],
        ("CHI", "Office") =>
        [
            new("chi-sw-off{0:00}", 1, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "Office closet"),
            new("chi-fw-edge{0:00}", 1, "Cisco Systems", "Cisco ASA 9.16", "firewall", FirewallPorts, "Office closet"),
            new("chi-prn-off{0:00}", 2, "HP Enterprise", null, "printer", PrinterPorts, "Copy room"),
            new("chi-wks-ops{0:00}", 6, "Dell Inc.", "Microsoft Windows 11 23H2", "workstation", WksPorts),
            new("chi-srv-print{0:00}", 1, "Dell Inc.", "Microsoft Windows Server 2019", "server", WinSrvPorts, "Office closet"),
            new("chi-ap-off{0:00}", 1, "Ubiquiti", "Linux 4.4 (UniFi)", "unknown", ApPorts),
        ],
        ("ATL", "Hub Core") =>
        [
            new("atl-rtr-edge{0:00}", 1, "Cisco Systems", "Cisco IOS-XE 17.6", "router", RouterPorts, "MDF rack 1"),
            new("atl-sw-core{0:00}", 2, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "MDF rack 1"),
            new("atl-fw-edge{0:00}", 1, "Cisco Systems", "Cisco ASA 9.16", "firewall", FirewallPorts, "MDF rack 1"),
            new("atl-srv-wms{0:00}", 2, "Dell Inc.", "Microsoft Windows Server 2019", "server", WmsPorts, "MDF rack 2"),
            new("atl-srv-tms{0:00}", 1, "Dell Inc.", "Ubuntu Linux 22.04", "server", LinuxSrvPorts, "MDF rack 2"),
            new("atl-esx{0:00}", 2, "VMware", "VMware ESXi 7.0.3", "server", EsxPorts, "MDF rack 2"),
            new("atl-prn-ship{0:00}", 3, "Zebra Technologies", "Zebra Link-OS", "printer", PrinterPorts, "Ship station {0}"),
            new("atl-cam-yard{0:00}", 3, "Axis Communications", "Axis OS 10.12 (Linux 4.9)", "camera", CameraPorts, "Yard pole {0}"),
            new("atl-wks-disp{0:00}", 3, "Dell Inc.", "Microsoft Windows 11 23H2", "workstation", WksPorts),
        ],
        ("PHX", "Fulfillment Floor") =>
        [
            new("phx-sw-core{0:00}", 1, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "MDF rack 1"),
            new("phx-sw-acc{0:00}", 3, "Cisco Systems", "Cisco IOS 15.2", "switch", SwitchPorts, "IDF {0}"),
            new("phx-srv-wms{0:00}", 2, "Dell Inc.", "Microsoft Windows Server 2019", "server", WmsPorts, "MDF rack 1"),
            new("phx-srv-sort{0:00}", 1, "HP Enterprise", "Ubuntu Linux 22.04", "server", LinuxSrvPorts, "MDF rack 1"),
            new("phx-prn-ship{0:00}", 4, "Zebra Technologies", "Zebra Link-OS", "printer", PrinterPorts, "Ship station {0}"),
            new("phx-hh-scan{0:00}", 5, "Zebra Technologies", "Android 11 (Linux 4.14)", "workstation", NoPorts),
            new("phx-ap-wh{0:00}", 1, "Ubiquiti", "Linux 4.4 (UniFi)", "unknown", ApPorts),
        ],
        ("PHX", "Cameras & IoT") =>
        [
            new("phx-cam-dock{0:00}", 6, "Axis Communications", "Axis OS 10.12 (Linux 4.9)", "camera", CameraPorts, "Dock door {0}"),
            new("phx-cam-yard{0:00}", 3, "Axis Communications", "Axis OS 10.12 (Linux 4.9)", "camera", CameraPorts, "Yard pole {0}"),
            new("phx-nvr{0:00}", 1, "Dell Inc.", "Microsoft Windows Server 2019", "server", NvrPorts, "Security office"),
        ],
        _ => [],
    };

    /// <summary>
    /// Stamps out every device and remembers each one's port profile — the port
    /// list is reused by snapshots (open port counts), certificates (443 only),
    /// and alerts, so it is returned alongside rather than re-derived.
    /// </summary>
    private (List<Device> Devices, Dictionary<Device, int[]> PortsByDevice) CreateDevices(List<Site> sites, List<Network> networks)
    {
        var devices = new List<Device>();
        var portsByDevice = new Dictionary<Device, int[]>();
        var siteKeyById = sites.ToDictionary(s => s.Id, s => s.SiteKey);

        foreach (var network in networks)
        {
            var siteKey = siteKeyById[network.SiteId];
            var prefix = network.Cidr[..network.Cidr.LastIndexOf('.')];
            var hostNum = 1; // infra roles are listed first, so cores land on the low addresses

            foreach (var spec in SpecsFor(siteKey, network.Name))
            {
                for (var i = 1; i <= spec.Count; i++)
                {
                    var hostname = string.Format(spec.HostPattern, i);

                    // Core infrastructure never goes offline in the demo — the
                    // SNMP page polls the core switches and a dead core would
                    // make every chart on it empty.
                    var isInfra = hostname.Contains("core") || hostname.Contains("-fw-") || hostname.Contains("-rtr-");
                    var roll = _rng.NextDouble();
                    var status = !isInfra && roll < 0.08 ? "offline"
                               : !isInfra && roll < 0.105 ? "new"
                               : "online";

                    var firstSeen = status == "new"
                        ? _now.AddHours(-(2 + _rng.NextDouble() * 18))
                        : _now.AddDays(-(30 + _rng.NextDouble() * 320));
                    var lastSeen = status == "offline"
                        ? _now.AddHours(-(4 + _rng.NextDouble() * 68))
                        : _now.AddMinutes(-_rng.Next(2, 28));

                    var device = new Device
                    {
                        NetworkId = network.Id,
                        IpAddress = $"{prefix}.{hostNum++}",
                        MacAddress = MakeMac(spec.Vendor),
                        Hostname = hostname,
                        Vendor = spec.Vendor,
                        OsGuess = spec.Os,
                        DeviceType = spec.Type,
                        Status = status,
                        FirstSeen = firstSeen,
                        LastSeen = lastSeen,
                        LastScannedAt = _now.AddMinutes(-_rng.Next(2, 28)),
                        MissedScans = status == "offline" ? _rng.Next(3, 9) : 0,
                        PhysicalLocation = spec.LocationPattern == null ? null : string.Format(spec.LocationPattern, i),
                        Hardware = null,
                        AssignedTo = spec.Type switch
                        {
                            "printer" or "workstation" => "Warehouse Ops",
                            "camera" => "Facilities",
                            "server" => "IT Infrastructure",
                            _ => null,
                        },
                    };

                    devices.Add(device);
                    portsByDevice[device] = spec.Ports;
                }
            }
        }

        return (devices, portsByDevice);
    }

    /// <summary>Vendor-consistent MAC: real-looking OUI prefix, random NIC half.</summary>
    private string MakeMac(string? vendor)
    {
        var prefix = vendor != null && VendorOui.TryGetValue(vendor, out var oui)
            ? oui
            : "02:42:AC"; // locally administered — the "no real vendor" lane
        return $"{prefix}:{_rng.Next(256):X2}:{_rng.Next(256):X2}:{_rng.Next(256):X2}";
    }

    private Port MakePort(Device device, int portNumber)
    {
        var (protocol, service, version) = PortCatalog.TryGetValue(portNumber, out var known)
            ? known
            : ("tcp", "unknown", null);
        return new Port
        {
            DeviceId = device.Id,
            PortNumber = portNumber,
            Protocol = protocol,
            State = "open",
            ServiceName = service,
            ServiceVersion = version,
            FirstSeen = device.FirstSeen,
            LastSeen = device.LastSeen,
        };
    }

    // ── Scan history ─────────────────────────────────────────────────────────

    /// <summary>
    /// 14 days of scan results per network: five quicks and one deep per day,
    /// with a few believable failures sprinkled in. Volume is enough to make the
    /// activity chart interesting without bloating the SQLite file.
    /// </summary>
    private List<ScanResult> CreateScanHistory(List<Network> networks, List<Device> devices)
    {
        // A handful of specific (network index, day, slot) runs fail so the demo
        // shows the failure path without looking unreliable.
        var failures = new Dictionary<(int Net, int Day, int Slot), string>
        {
            [(1, 9, 2)] = "Nmap exited with code 1: dnet: Failed to open device eth0",
            [(4, 4, 5)] = "Scan aborted: --host-timeout 10m elapsed before any hosts completed",
            [(6, 1, 0)] = "Nmap exited with code 137: process killed (out of memory)",
        };

        var quickArgs = ScanProfileDefaults.All.First(p => p.ProfileType == "quick").NmapArgs;
        var deepArgs = ScanProfileDefaults.All.First(p => p.ProfileType == "deep").NmapArgs;

        var scans = new List<ScanResult>();
        for (var n = 0; n < networks.Count; n++)
        {
            var network = networks[n];
            var deviceCount = devices.Count(d => d.NetworkId == network.Id);
            var onlineCount = devices.Count(d => d.NetworkId == network.Id && d.Status != "offline");

            // Networks are not all as old as the history window. Staggering when
            // each one came under monitoring gives the activity chart an upward
            // shape instead of a flat line, which is both more realistic and the
            // difference between a chart that looks alive and one that looks
            // broken.
            var onboardedDaysAgo = n switch
            {
                0 or 1 or 2 => 14,   // the original estate
                3 or 4 => 11,        // second site brought online
                _ => 7,              // most recent additions
            };

            for (var day = 13; day >= 0; day--)
            {
                if (day >= onboardedDaysAgo) continue;

                // Cadence is not identical every day: maintenance windows,
                // restarts and paused schedules all reduce a day's run count in
                // practice. Vary it so the series has texture.
                var slotsToday = _rng.NextDouble() switch
                {
                    < 0.10 => 3,   // a long maintenance window
                    < 0.28 => 5,
                    < 0.80 => 6,   // the usual day
                    _ => 7,        // an extra ad-hoc run
                };

                for (var slot = 0; slot < slotsToday; slot++)
                {
                    // Runs spread across the day at ~4h spacing with jitter.
                    var startedAt = _now.Date.AddDays(-day)
                        .AddHours(slot * 4)
                        .AddMinutes(_rng.Next(0, 50));
                    if (startedAt > _now) continue; // today's later slots haven't happened yet

                    var isDeep = slot == 3; // one deep scan per day, mid-day
                    var scan = new ScanResult
                    {
                        NetworkId = network.Id,
                        ScanType = isDeep ? "deep" : "quick",
                        NmapCommand = $"nmap {(isDeep ? deepArgs : quickArgs)} -oX /tmp/nmap_demo.xml {network.Cidr}",
                        StartedAt = startedAt,
                    };

                    if (failures.TryGetValue((n, day, slot), out var reason))
                    {
                        scan.Status = "failed";
                        scan.FailureReason = reason;
                        scan.CompletedAt = startedAt.AddSeconds(_rng.Next(20, 120));
                    }
                    else
                    {
                        scan.Status = "completed";
                        scan.CompletedAt = startedAt.AddSeconds(isDeep ? _rng.Next(300, 900) : _rng.Next(25, 70));
                        scan.HostsUp = Math.Max(1, onlineCount - _rng.Next(0, 3));
                        scan.HostsDown = deviceCount - scan.HostsUp + _rng.Next(0, 3);
                        scan.NewDevices = _rng.NextDouble() < 0.03 ? 1 : 0;
                    }

                    scans.Add(scan);
                }
            }
        }
        return scans;
    }

    /// <summary>
    /// Hourly-ish per-device history for four devices per network over the last
    /// seven days — enough for the device history chart to show availability and
    /// latency texture, including short offline blips, without seeding a
    /// snapshot for all 120 devices on every one of ~580 scans.
    /// </summary>
    private List<ScanDeviceSnapshot> CreateDeviceSnapshots(
        List<Network> networks, List<Device> devices,
        Dictionary<Device, int[]> portsByDevice, List<ScanResult> scans)
    {
        var snapshots = new List<ScanDeviceSnapshot>();

        foreach (var network in networks)
        {
            var netDevices = devices.Where(d => d.NetworkId == network.Id).Take(4).ToList();
            var netScans = scans
                .Where(s => s.NetworkId == network.Id && s.Status == "completed")
                .OrderBy(s => s.StartedAt)
                .ToList();
            if (netScans.Count == 0) continue;

            foreach (var device in netDevices)
            {
                // Latency envelope by role: switches answer in fractions of a
                // millisecond, workstations wander all over the place.
                var (latMin, latMax) = device.DeviceType switch
                {
                    "switch" or "router" or "firewall" => (0.4, 2.0),
                    "server" => (0.4, 4.0),
                    "printer" => (1.0, 8.0),
                    "camera" => (2.0, 15.0),
                    _ => (1.0, 25.0),
                };
                var baseLatency = latMin + _rng.NextDouble() * (latMax - latMin);
                var portCount = portsByDevice[device].Length;

                var t = _now.AddDays(-7);
                var scanIdx = 0;
                var offlineRemaining = 0;

                while (t <= _now)
                {
                    // Attach each sample to the nearest scan that had already
                    // started — snapshots must reference a real scan row.
                    while (scanIdx + 1 < netScans.Count && netScans[scanIdx + 1].StartedAt <= t) scanIdx++;

                    bool offline;
                    if (device.Status == "offline" && t > device.LastSeen)
                    {
                        offline = true; // a currently-offline device stays down after its last sighting
                    }
                    else if (offlineRemaining > 0)
                    {
                        offline = true;
                        offlineRemaining--;
                    }
                    else if (_rng.NextDouble() < 0.015)
                    {
                        offline = true;
                        offlineRemaining = _rng.Next(1, 4); // a blip lasts a couple of samples
                    }
                    else
                    {
                        offline = false;
                    }

                    var latency = baseLatency * (0.8 + _rng.NextDouble() * 0.5);
                    if (_rng.NextDouble() < 0.03) latency *= 4; // the occasional spike every real chart has

                    snapshots.Add(new ScanDeviceSnapshot
                    {
                        ScanResultId = netScans[scanIdx].Id,
                        DeviceId = device.Id,
                        Status = offline ? "offline" : "online",
                        OpenPortCount = offline ? 0 : portCount,
                        ResponseTimeMs = offline ? null : Math.Round(Math.Clamp(latency, 0.4, 40), 2),
                        RecordedAt = t,
                    });

                    t = t.AddMinutes(55 + _rng.Next(0, 21));
                }
            }
        }
        return snapshots;
    }

    // ── Alerts ───────────────────────────────────────────────────────────────

    /// <summary>
    /// ~60 alerts over the 14-day window, weighted toward the types a real floor
    /// produces. Older alerts are mostly acknowledged, recent ones mostly not —
    /// that gradient is what makes the feed read as "in use" rather than staged.
    /// </summary>
    private List<Alert> CreateAlerts(List<Network> networks, List<Device> devices, Dictionary<Device, int[]> portsByDevice)
    {
        var networkNames = networks.ToDictionary(n => n.Id, n => n.Name);
        var operators = new[] { "j.moreno", "s.patel", "d.okafor" };
        var certCandidates = devices.Where(d => portsByDevice[d].Contains(443)).ToList();

        // (type, severity, count) — severity is fixed per type, matching what the
        // orchestrator raises at runtime.
        var plan = new (string Type, string Severity, int Count)[]
        {
            ("new_device", "warning", 10),
            ("device_offline", "critical", 12),
            ("device_online", "info", 10),
            ("port_opened", "warning", 12),
            ("port_closed", "info", 8),
            ("cert_expiring", "warning", 8),
        };

        var alerts = new List<Alert>();
        foreach (var (type, severity, count) in plan)
        {
            for (var i = 0; i < count; i++)
            {
                var device = type == "cert_expiring"
                    ? certCandidates[_rng.Next(certCandidates.Count)]
                    : devices[_rng.Next(devices.Count)];
                var label = $"{device.Hostname} ({device.IpAddress})";
                var networkName = networkNames[device.NetworkId];
                var createdAt = _now.AddHours(-_rng.NextDouble() * 14 * 24);

                var (message, details) = type switch
                {
                    "new_device" => ($"New device {device.IpAddress} ({device.Hostname}) appeared on {networkName}",
                        $"MAC: {device.MacAddress}\nVendor: {device.Vendor ?? "unknown"}\nOpen ports: {portsByDevice[device].Length}"),
                    "device_offline" => ($"{label} is offline",
                        $"Missed {_rng.Next(3, 7)} consecutive scans. Last seen {createdAt.AddHours(-_rng.Next(2, 10)):u}."),
                    "device_online" => ($"{label} is back online", (string?)null),
                    "port_opened" => PortChange(device, portsByDevice, label, opened: true),
                    "port_closed" => PortChange(device, portsByDevice, label, opened: false),
                    _ => ($"TLS certificate on {label}:443 expires in {_rng.Next(3, 29)} days",
                        "Renew or replace the certificate before it expires."),
                };

                // Acknowledgment gradient: 3+ days old → probably handled.
                var acknowledged = _rng.NextDouble() < (createdAt < _now.AddDays(-3) ? 0.75 : 0.25);
                var ackAt = createdAt.AddHours(1 + _rng.NextDouble() * 24);

                alerts.Add(new Alert
                {
                    DeviceId = device.Id,
                    NetworkId = device.NetworkId,
                    AlertType = type,
                    Severity = severity,
                    Message = message,
                    Details = details,
                    CreatedAt = createdAt,
                    IsAcknowledged = acknowledged,
                    AcknowledgedBy = acknowledged ? operators[_rng.Next(operators.Length)] : null,
                    AcknowledgedAt = acknowledged ? (ackAt > _now ? _now : ackAt) : null,
                });
            }
        }
        return alerts;
    }

    /// <summary>Builds a port_opened/port_closed message from a port the device actually has.</summary>
    private (string Message, string? Details) PortChange(Device device, Dictionary<Device, int[]> portsByDevice, string label, bool opened)
    {
        var ports = portsByDevice[device];
        var port = ports.Length > 0 ? ports[_rng.Next(ports.Length)] : 8080;
        var service = PortCatalog.TryGetValue(port, out var known) ? known.Service : "unknown";
        return opened
            ? ($"Port {port}/tcp opened on {label}", $"Service: {service}")
            : ($"Port {port}/tcp closed on {label}", $"Was: {service}");
    }

    // ── Vulnerabilities ──────────────────────────────────────────────────────

    /// <summary>A real, well-known CVE and the device types it plausibly appears on.</summary>
    private sealed record CveDef(string Cve, double Cvss, string Severity, string Description, string Service, int Port, string[] Types);

    /// <summary>
    /// Real CVE ids with correct-ish scores: recognizable names make the security
    /// page immediately legible to anyone who has worked a vuln queue, and no
    /// fictional CVE can be mistaken for a disclosure.
    /// </summary>
    private static readonly CveDef[] CveCatalog =
    [
        new("CVE-2021-44228", 10.0, "critical", "Log4Shell: Apache Log4j2 JNDI lookup allows unauthenticated remote code execution via crafted log messages.", "Apache Log4j 2.14.1", 8080, ["server"]),
        new("CVE-2020-1472", 10.0, "critical", "Zerologon: Netlogon elevation of privilege lets an attacker on the network become domain admin.", "Microsoft Netlogon (SMB)", 445, ["server"]),
        new("CVE-2017-5638", 10.0, "critical", "Apache Struts 2 Jakarta multipart parser remote code execution via crafted Content-Type header.", "Apache Struts 2.5.10", 8080, ["server"]),
        new("CVE-2019-0708", 9.8, "critical", "BlueKeep: pre-authentication remote code execution in Remote Desktop Services.", "Microsoft Remote Desktop Services", 3389, ["server", "workstation"]),
        new("CVE-2018-10933", 9.1, "critical", "libssh authentication bypass: a client can present SSH2_MSG_USERAUTH_SUCCESS and skip authentication entirely.", "libssh 0.8.3", 22, ["camera", "unknown"]),
        new("CVE-2021-34527", 8.8, "high", "PrintNightmare: Windows Print Spooler remote code execution via crafted printer driver installation.", "Windows Print Spooler", 445, ["server", "workstation"]),
        new("CVE-2017-0144", 8.1, "high", "EternalBlue: SMBv1 remote code execution used by WannaCry; exploitable over port 445.", "Microsoft SMBv1", 445, ["server", "workstation"]),
        new("CVE-2014-0160", 7.5, "high", "Heartbleed: OpenSSL TLS heartbeat read overrun leaks process memory including private keys.", "OpenSSL 1.0.1f", 443, ["server", "camera"]),
        new("CVE-2016-2183", 7.5, "high", "SWEET32: 64-bit block ciphers (3DES) in TLS are vulnerable to birthday attacks on long-lived connections.", "TLS with 3DES cipher suites", 443, ["server", "switch", "firewall", "printer"]),
        new("CVE-2013-2566", 5.9, "medium", "RC4 keystream biases in TLS allow plaintext recovery over many connections.", "TLS with RC4 cipher suites", 443, ["switch", "printer", "camera"]),
        new("CVE-2018-15473", 5.3, "medium", "OpenSSH username enumeration: malformed authentication requests reveal whether a user exists.", "OpenSSH 7.4", 22, ["server", "switch", "camera"]),
        new("CVE-2015-0204", 4.3, "medium", "FREAK: OpenSSL clients accept weak export-grade RSA keys, enabling TLS downgrade.", "OpenSSL 1.0.1j", 443, ["printer", "camera", "unknown"]),
    ];

    /// <summary>
    /// ~35 findings mapped to devices whose type plausibly runs the affected
    /// service. Mostly open, with a few remediated/accepted so the triage
    /// filters have something to show.
    /// </summary>
    private List<Vulnerability> CreateVulnerabilities(List<Device> devices)
    {
        const int target = 35;
        var vulnerabilities = new List<Vulnerability>();
        var used = new HashSet<(int DeviceId, string Cve)>();

        // Round-robin the catalog so severity stays spread rather than exhausting
        // the criticals on the first few devices.
        var catalogIdx = 0;
        var guard = 0;
        while (vulnerabilities.Count < target && guard++ < 500)
        {
            var def = CveCatalog[catalogIdx++ % CveCatalog.Length];
            var candidates = devices.Where(d => def.Types.Contains(d.DeviceType)).ToList();
            if (candidates.Count == 0) continue;

            var device = candidates[_rng.Next(candidates.Count)];
            if (!used.Add((device.Id, def.Cve))) continue;

            var n = vulnerabilities.Count;
            vulnerabilities.Add(new Vulnerability
            {
                DeviceId = device.Id,
                CveId = def.Cve,
                CvssScore = def.Cvss,
                Severity = def.Severity,
                Description = def.Description,
                AffectedService = def.Service,
                PortNumber = def.Port,
                Status = n % 11 == 10 ? "accepted_risk" : n % 7 == 6 ? "remediated" : "open",
                DetectedAt = _now.AddDays(-_rng.NextDouble() * 13),
            });
        }
        return vulnerabilities;
    }

    // ── Certificates ─────────────────────────────────────────────────────────

    /// <summary>
    /// ~25 certificates on devices that actually serve TLS: a few already
    /// expired, several inside the warning window, and self-signed ones on the
    /// gear that always has them (cameras, switch management pages).
    /// </summary>
    private List<SslCertificate> CreateCertificates(List<Device> devices, Dictionary<Device, int[]> portsByDevice)
    {
        var issuers = new[]
        {
            "CN=Northwind Internal CA, O=Northwind Logistics",
            "CN=R3, O=Let's Encrypt, C=US",
            "CN=E1, O=Let's Encrypt, C=US",
        };

        var candidates = devices.Where(d => portsByDevice[d].Contains(443)).ToList();
        var certificates = new List<SslCertificate>();

        for (var i = 0; i < Math.Min(25, candidates.Count); i++)
        {
            var device = candidates[i];
            var subject = $"CN={device.Hostname}.corp.northwind.example";

            // Bucket by index so the mix is guaranteed, not merely probable:
            // 3 expired, 5 expiring soon, the rest comfortably valid.
            var validTo = i switch
            {
                < 3 => _now.AddDays(-(4 + _rng.Next(0, 32))),
                < 8 => _now.AddDays(2 + _rng.Next(0, 27)),
                _ => _now.AddDays(40 + _rng.Next(0, 680)),
            };

            var selfSigned = device.DeviceType is "camera" or "switch" or "unknown";
            var lifetimeDays = selfSigned ? 3650 : _rng.NextDouble() < 0.4 ? 90 : 398;
            var isEc = !selfSigned && _rng.NextDouble() < 0.3;

            certificates.Add(new SslCertificate
            {
                DeviceId = device.Id,
                PortNumber = 443,
                Subject = subject,
                Issuer = selfSigned ? subject : issuers[_rng.Next(issuers.Length)],
                ValidFrom = validTo.AddDays(-lifetimeDays),
                ValidTo = validTo,
                KeyType = isEc ? "EC" : "RSA",
                KeyBits = isEc ? 256 : _rng.NextDouble() < 0.7 ? 2048 : 4096,
                IsSelfSigned = selfSigned,
                DetectedAt = _now.AddDays(-_rng.NextDouble() * 7),
            });
        }
        return certificates;
    }

    // ── SNMP ─────────────────────────────────────────────────────────────────

    /// <summary>The core switches and the edge router become SNMP targets.</summary>
    private List<SnmpTarget> CreateSnmpTargets(List<Network> networks, List<Device> devices)
    {
        var siteByNetwork = networks.ToDictionary(n => n.Id, n => n.SiteId);
        var picks = new (string Hostname, string Model)[]
        {
            ("dal-sw-core01", "Catalyst 9300-48T"),
            ("dal-sw-core02", "Catalyst 9300-48T"),
            ("chi-sw-core01", "Catalyst 9200-24P"),
            ("atl-sw-core01", "Catalyst 9500-16X"),
            ("atl-rtr-edge01", "ISR 4451-X"),
            ("phx-sw-core01", "Catalyst 9300-24T"),
        };

        var targets = new List<SnmpTarget>();
        foreach (var (hostname, model) in picks)
        {
            var device = devices.First(d => d.Hostname == hostname);
            targets.Add(new SnmpTarget
            {
                SiteId = siteByNetwork[device.NetworkId],
                IpAddress = device.IpAddress,
                Name = hostname,
                Model = model,
                Community = "public", // demo-only; a real deployment configures its own
                PollIntervalSeconds = 300,
                LastPolledAt = _now.AddMinutes(-_rng.Next(1, 6)),
            });
        }
        return targets;
    }

    /// <summary>
    /// Five polls of four interfaces per target across the last 24 hours (20
    /// rows each) — enough points for the utilization chart to draw real lines.
    /// The Dallas core's 10G uplink runs saturated so the page has its "there's
    /// the problem" moment, and one Chicago access port is down.
    /// </summary>
    private List<InterfaceSnapshot> CreateInterfaceSnapshots(List<SnmpTarget> targets)
    {
        const long OneGbps = 1_000_000_000L;
        const long TenGbps = 10_000_000_000L;
        const int pollSpacingSeconds = 5 * 3600;

        var snapshots = new List<InterfaceSnapshot>();
        foreach (var target in targets)
        {
            var interfaces = new (int IfIndex, string Name, string? Alias, long Speed)[]
            {
                (1, "GigabitEthernet1/0/1", "Access — floor equipment", OneGbps),
                (2, "GigabitEthernet1/0/2", "Access — floor equipment", OneGbps),
                (3, "GigabitEthernet1/0/3", "Access — floor equipment", OneGbps),
                (49, "TenGigabitEthernet1/1/1", "Uplink to distribution", TenGbps),
            };

            foreach (var (ifIndex, ifName, ifAlias, speed) in interfaces)
            {
                var saturated = target.Name == "dal-sw-core01" && ifIndex == 49;
                var down = target.Name == "chi-sw-core01" && ifIndex == 3;
                var baseUtil = saturated ? 90.0 : 2 + _rng.NextDouble() * 55;

                // Octet counters are cumulative, so start each interface at a
                // plausible uptime-worth of traffic and grow it per poll.
                var inOctets = (long)(_rng.NextDouble() * 4e11) + 1_000_000_000;
                var outOctets = (long)(_rng.NextDouble() * 4e11) + 1_000_000_000;
                var inErrors = down ? 0 : _rng.NextDouble() < 0.2 ? _rng.Next(1, 40) : 0;

                for (var poll = 0; poll < 5; poll++)
                {
                    var recordedAt = _now.AddHours(-24)
                        .AddSeconds(poll * pollSpacingSeconds + _rng.Next(0, 600));

                    var utilization = down ? 0
                        : Math.Clamp(baseUtil + (_rng.NextDouble() - 0.5) * (saturated ? 6 : 14),
                                     saturated ? 88 : 2, saturated ? 96 : 95);

                    // Grow counters by roughly what that utilization moves in one
                    // poll interval, so the numbers cross-check if anyone looks.
                    var bytesMoved = (long)(utilization / 100.0 * (speed / 8.0) * pollSpacingSeconds);
                    inOctets += (long)(bytesMoved * 0.6);
                    outOctets += (long)(bytesMoved * 0.4);

                    snapshots.Add(new InterfaceSnapshot
                    {
                        SnmpTargetId = target.Id,
                        IfIndex = ifIndex,
                        IfName = ifName,
                        IfAlias = ifAlias,
                        SpeedBps = speed,
                        OperStatus = down ? "down" : "up",
                        InOctets = inOctets,
                        OutOctets = outOctets,
                        InErrors = inErrors,
                        OutErrors = 0,
                        UtilizationPercent = Math.Round(utilization, 1),
                        RecordedAt = recordedAt,
                    });
                }
            }
        }
        return snapshots;
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    private List<AppSetting> CreateAppSettings() =>
    [
        new() { Key = "company.display_name", Value = _options.CompanyName, Description = "Company name shown in the header and reports.", UpdatedAt = _now },
        new() { Key = "retention.scan_days", Value = "90", Description = "Days of scan history to keep before pruning.", UpdatedAt = _now },
        new() { Key = "alerts.email_recipients", Value = "netops@northwind.example", Description = "Comma-separated recipients for critical alert email.", UpdatedAt = _now },
        new() { Key = "alerts.cert_expiry_warning_days", Value = "30", Description = "Warn this many days before a TLS certificate expires.", UpdatedAt = _now },
        new() { Key = "ui.default_theme", Value = "dark", Description = "Theme applied for first-time visitors.", UpdatedAt = _now },
        new() { Key = "scan.max_concurrent", Value = "1", Description = "Maximum scans allowed to run at once.", UpdatedAt = _now },
    ];
}
