using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;
using Xunit;

namespace NetworkMonitor.Tests.Tests;

/// <summary>
/// Tests for the reconciliation logic — the part that decides what actually
/// changed between two scans. nmap itself is replaced by a stub that returns
/// canned XML, so these run anywhere with no scanner installed and no packets
/// on the wire.
/// </summary>
public class ScanOrchestratorTests : IDisposable
{
    private readonly TestDb _db = new();
    private readonly StubNmap _nmap = new();
    private readonly AlertOptions _alertOptions = new() { OfflineAfterMissedScans = 3 };
    private readonly ScanningOptions _scanningOptions = new() { MaxTargetAddresses = 65536 };

    private ScanOrchestrator CreateOrchestrator() => new(
        _db.Context,
        _nmap,
        new ScanResultParserService(),
        Options.Create(_alertOptions),
        Options.Create(_scanningOptions),
        NullLogger<ScanOrchestrator>.Instance);

    /// <summary>Creates a site + network with the default profiles attached.</summary>
    private async Task<Network> SeedNetworkAsync()
    {
        var site = new Site { SiteKey = "TST", Name = "Test Site" };
        _db.Context.Sites.Add(site);
        await _db.Context.SaveChangesAsync();

        var network = new Network { SiteId = site.Id, Name = "Test Net", Cidr = "203.0.113.0/24" };
        _db.Context.Networks.Add(network);
        await _db.Context.SaveChangesAsync();

        _db.Context.ScanProfiles.AddRange(ScanProfileDefaults.ForNetwork(network));
        await _db.Context.SaveChangesAsync();
        return network;
    }

    /// <summary>Minimal nmap XML for a set of up hosts with optional open ports.</summary>
    private static string Xml(params (string Ip, int[] Ports)[] hosts)
    {
        var body = string.Join("", hosts.Select(h =>
        {
            var ports = string.Join("", h.Ports.Select(p =>
                $"""<port protocol="tcp" portid="{p}"><state state="open"/><service name="svc{p}"/></port>"""));
            return $"""
                <host><status state="up"/><address addr="{h.Ip}" addrtype="ipv4"/>
                <ports>{ports}</ports></host>
                """;
        }));
        return $"""<?xml version="1.0"?><nmaprun>{body}</nmaprun>""";
    }

    [Fact]
    public async Task First_scan_inserts_devices_and_raises_new_device_alerts()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22, 443]), ("203.0.113.11", [80]));

        var scan = await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        scan.Status.Should().Be("completed");
        scan.HostsUp.Should().Be(2);
        scan.NewDevices.Should().Be(2);

        using var verify = _db.NewContext();
        verify.Devices.Should().HaveCount(2);
        verify.Devices.Should().OnlyContain(d => d.Status == "new");
        verify.Alerts.Count(a => a.AlertType == "new_device").Should().Be(2);
        verify.Ports.Should().HaveCount(3);
    }

    [Fact]
    public async Task Rescanning_the_same_hosts_updates_rather_than_duplicates()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        // Same host again: the unique (network, ip) index means this must update.
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        var second = await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        second.NewDevices.Should().Be(0);
        using var verify = _db.NewContext();
        verify.Devices.Should().HaveCount(1);
        verify.Devices.Single().Status.Should().Be("online");
    }

    [Fact]
    public async Task A_single_missed_scan_does_not_take_a_device_offline()
    {
        // One dropped probe is noise. Paging on it is how monitoring tools get
        // ignored, so the device must stay online until the threshold is hit.
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _nmap.Xml = Xml();
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        using var verify = _db.NewContext();
        var device = verify.Devices.Single();
        device.Status.Should().NotBe("offline");
        device.MissedScans.Should().Be(1);
        verify.Alerts.Should().NotContain(a => a.AlertType == "device_offline");
    }

    [Fact]
    public async Task Device_goes_offline_once_the_missed_scan_threshold_is_reached()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _nmap.Xml = Xml();
        for (var i = 0; i < _alertOptions.OfflineAfterMissedScans; i++)
            await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        using var verify = _db.NewContext();
        verify.Devices.Single().Status.Should().Be("offline");
        verify.Alerts.Count(a => a.AlertType == "device_offline").Should().Be(1);
    }

    [Fact]
    public async Task Returning_device_flips_back_online_and_resets_the_miss_counter()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _nmap.Xml = Xml();
        for (var i = 0; i < 3; i++) await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        using var verify = _db.NewContext();
        var device = verify.Devices.Single();
        device.Status.Should().Be("online");
        device.MissedScans.Should().Be(0);
        verify.Alerts.Should().Contain(a => a.AlertType == "device_online");
    }

    [Fact]
    public async Task A_newly_listening_service_raises_a_port_opened_alert()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "deep");

        _nmap.Xml = Xml(("203.0.113.10", [22, 3389]));
        await CreateOrchestrator().RunScanAsync(network.Id, "deep");

        using var verify = _db.NewContext();
        verify.Alerts.Should().Contain(a => a.AlertType == "port_opened" && a.Message.Contains("3389"));
        verify.Ports.Should().HaveCount(2);
    }

    [Fact]
    public async Task A_service_that_disappears_raises_a_port_closed_alert()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22, 3389]));
        await CreateOrchestrator().RunScanAsync(network.Id, "deep");

        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "deep");

        using var verify = _db.NewContext();
        verify.Alerts.Should().Contain(a => a.AlertType == "port_closed" && a.Message.Contains("3389"));
        verify.Ports.Should().HaveCount(1);
    }

    [Fact]
    public async Task Every_scan_writes_one_snapshot_per_device_for_the_history_view()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]), ("203.0.113.11", [80]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        // Second host drops out; both devices must still be represented in the
        // second scan, otherwise the history chart would show a gap that is
        // indistinguishable from "never scanned".
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        using var verify = _db.NewContext();

        // 2 devices x 2 scans — one row per device per scan, no gaps.
        verify.ScanDeviceSnapshots.Should().HaveCount(4);
        verify.ScanDeviceSnapshots.Count(s => s.Status == "online").Should().Be(3);
        verify.ScanDeviceSnapshots.Count(s => s.Status == "missed").Should().Be(1);
    }

    [Fact]
    public async Task Excluded_devices_are_passed_to_nmap_and_never_alert()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        var device = _db.Context.Devices.Single();
        device.IsExcluded = true;
        await _db.Context.SaveChangesAsync();

        _nmap.Xml = Xml();
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _nmap.LastExcluded.Should().Contain("203.0.113.10");
        using var verify = _db.NewContext();
        verify.Alerts.Should().NotContain(a => a.AlertType == "device_offline");
        verify.Devices.Single().MissedScans.Should().Be(0);
    }

    [Fact]
    public async Task A_scan_failure_is_recorded_rather_than_thrown()
    {
        // A scanner that cannot run is an expected operational state (nmap not
        // installed, no privileges, host unreachable) and must land in the scan
        // history as a failure, not bubble up and kill the scheduler loop.
        var network = await SeedNetworkAsync();
        _nmap.Throw = new InvalidOperationException("Nmap exited with code 1: permission denied");

        var scan = await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        scan.Status.Should().Be("failed");
        scan.FailureReason.Should().Contain("permission denied");
        scan.CompletedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task An_oversized_target_is_refused_before_any_packets_are_sent()
    {
        // A mistyped /8 is 16.7M addresses. The guard must reject it, record the
        // reason, and — critically — never invoke the scanner at all.
        var site = new Site { SiteKey = "BIG", Name = "Oversized" };
        _db.Context.Sites.Add(site);
        await _db.Context.SaveChangesAsync();

        var network = new Network { SiteId = site.Id, Name = "Too big", Cidr = "10.0.0.0/8" };
        _db.Context.Networks.Add(network);
        await _db.Context.SaveChangesAsync();

        _nmap.Throw = new InvalidOperationException("scanner must not be called");

        var scan = await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        scan.Status.Should().Be("failed");
        scan.FailureReason.Should().Contain("MaxTargetAddresses");
        _nmap.LastExcluded.Should().BeEmpty("the scanner should never have run");
    }

    [Fact]
    public async Task Device_type_is_classified_from_the_ports_that_were_found()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.60", [9100, 631]));

        await CreateOrchestrator().RunScanAsync(network.Id, "deep");

        using var verify = _db.NewContext();
        verify.Devices.Single().DeviceType.Should().Be("printer");
    }

    [Fact]
    public async Task Deleting_a_network_cascades_to_its_devices()
    {
        var network = await SeedNetworkAsync();
        _nmap.Xml = Xml(("203.0.113.10", [22]));
        await CreateOrchestrator().RunScanAsync(network.Id, "quick");

        _db.Context.Networks.Remove(_db.Context.Networks.Single(n => n.Id == network.Id));
        await _db.Context.SaveChangesAsync();

        using var verify = _db.NewContext();
        verify.Devices.Should().BeEmpty();
        verify.Ports.Should().BeEmpty();
    }

    public void Dispose() => _db.Dispose();

    /// <summary>
    /// Stands in for the real scanner: returns whatever XML the test set, records
    /// the exclusion list it was handed, and can be told to fail.
    /// </summary>
    private sealed class StubNmap : INmapExecutorService
    {
        public string Xml { get; set; } = """<?xml version="1.0"?><nmaprun></nmaprun>""";
        public Exception? Throw { get; set; }
        public List<string> LastExcluded { get; private set; } = [];

        public bool IsNmapAvailable(out string? version)
        {
            version = "Nmap version 7.95 (stub)";
            return true;
        }

        public Task<(string xmlPath, string command)> RunProfileScanAsync(
            string cidr, string nmapArgs, IEnumerable<string>? excludeIps = null, CancellationToken ct = default)
        {
            if (Throw != null) throw Throw;

            LastExcluded = excludeIps?.ToList() ?? [];

            // The orchestrator reads the XML back off disk, so write a real file.
            var path = Path.Combine(Path.GetTempPath(), $"stub_{Guid.NewGuid():N}.xml");
            File.WriteAllText(path, Xml);
            return Task.FromResult((path, $"nmap {nmapArgs} {cidr}"));
        }
    }
}

/// <summary>Classification rules, checked directly rather than through a scan.</summary>
public class DeviceClassifierTests
{
    [Theory]
    [InlineData(null, "Hewlett-Packard", "dal-prn-01", new[] { 9100 }, "printer")]
    [InlineData(null, "Zebra Technologies", "label01", new[] { 9100, 631 }, "printer")]
    [InlineData("Cisco IOS 15.2", "Cisco Systems", "dal-sw-core01", new[] { 22, 161 }, "switch")]
    [InlineData("Cisco IOS 15.2", "Cisco Systems", "dal-rtr-edge01", new[] { 22, 179 }, "router")]
    [InlineData(null, "Fortinet", "chi-fw-01", new[] { 443 }, "firewall")]
    [InlineData(null, "Axis Communications", "dock-cam-03", new[] { 80, 554 }, "camera")]
    [InlineData("Ubuntu Linux 22.04 server", null, "atl-srv-app01", new[] { 22, 80, 443 }, "server")]
    [InlineData("Microsoft Windows 11", null, "phx-wks-114", new[] { 3389, 445 }, "workstation")]
    [InlineData(null, null, null, new int[0], "unknown")]
    public void Classify_uses_the_most_specific_signal_available(
        string? os, string? vendor, string? hostname, int[] ports, string expected)
    {
        DeviceClassifier.Classify(os, vendor, hostname, ports).Should().Be(expected);
    }
}
