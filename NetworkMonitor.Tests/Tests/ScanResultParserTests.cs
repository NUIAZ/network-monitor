using FluentAssertions;
using NetworkMonitor.Server.Services;
using Xunit;

namespace NetworkMonitor.Tests.Tests;

/// <summary>
/// Parser tests driven by a real nmap XML document (Fixtures/sample-scan.xml)
/// rather than hand-built strings, so the tests fail if nmap's actual output
/// shape stops matching our assumptions.
/// </summary>
public class ScanResultParserTests
{
    private readonly ScanResultParserService _parser = new();

    private static string LoadFixture() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample-scan.xml"));

    private ParsedScanResult ParseFixture() => _parser.Parse(LoadFixture());

    [Fact]
    public void Counts_hosts_up_and_down()
    {
        var result = ParseFixture();

        result.HostsUp.Should().Be(3);
        result.HostsDown.Should().Be(1);
    }

    [Fact]
    public void Only_hosts_with_an_ip_are_returned()
    {
        var result = ParseFixture();

        // The down host has an address, so all four parse; the filter exists to
        // drop malformed entries with no ipv4 element at all.
        result.Hosts.Should().OnlyContain(h => !string.IsNullOrEmpty(h.IpAddress));
    }

    [Fact]
    public void Reads_mac_address_and_vendor_when_the_scan_was_on_subnet()
    {
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.10");

        host.MacAddress.Should().Be("00:1A:2B:3C:4D:5E");
        host.Vendor.Should().Be("Cisco Systems");
        host.Hostname.Should().Be("dal-sw-core01");
        host.IsUp.Should().BeTrue();
    }

    [Fact]
    public void Leaves_mac_null_when_the_host_is_off_subnet()
    {
        // ARP only resolves on the local segment, so a routed host legitimately
        // has no MAC. It must not be treated as a parse failure.
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.25");

        host.MacAddress.Should().BeNull();
        host.Vendor.Should().BeNull();
    }

    [Fact]
    public void Takes_the_highest_confidence_os_match()
    {
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.25");

        host.OsGuess.Should().Be("Linux 5.15 - 5.19");
    }

    [Fact]
    public void Builds_a_readable_service_version_from_product_version_and_extra()
    {
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.25");
        var http = host.Ports.Single(p => p.PortNumber == 80);

        http.ServiceName.Should().Be("http");
        http.ServiceVersion.Should().Be("Apache httpd 2.4.52 (Ubuntu)");
    }

    [Fact]
    public void Keeps_non_open_ports_with_their_state()
    {
        // Filtered ports are retained by the parser; deciding what to do with
        // them is the orchestrator's job, not the parser's.
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.10");

        host.Ports.Should().Contain(p => p.PortNumber == 23 && p.State == "filtered");
        host.Ports.Where(p => p.State == "open").Should().HaveCount(2);
    }

    [Fact]
    public void Reads_per_port_and_host_level_scripts()
    {
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.10");

        host.Ports.Single(p => p.PortNumber == 22).Scripts
            .Should().Contain(s => s.Id == "ssh-hostkey");
        host.HostScripts.Should().Contain(s => s.Id == "smb-os-discovery");
    }

    [Fact]
    public void Flattens_nested_script_tables_into_dotted_keys()
    {
        // ssl-cert nests the fields we actually want one <table> deep.
        var cert = ParseFixture().Hosts
            .Single(h => h.IpAddress == "203.0.113.10")
            .Ports.Single(p => p.PortNumber == 443)
            .Scripts.Single(s => s.Id == "ssl-cert");

        cert.Elements["subject.commonName"].Should().Be("dal-sw-core01.example.com");
        cert.Elements["issuer.commonName"].Should().Be("Northwind Internal CA");
        cert.Elements["pubkey.bits"].Should().Be("2048");
    }

    [Fact]
    public void Converts_srtt_microseconds_to_milliseconds()
    {
        var host = ParseFixture().Hosts.Single(h => h.IpAddress == "203.0.113.10");

        host.LatencyMs.Should().BeApproximately(1.42, 0.01);
    }

    [Fact]
    public void Ignores_dtd_so_external_entities_cannot_be_resolved()
    {
        // An XXE payload must parse as inert text, never dereference the entity.
        var hostile = """
            <?xml version="1.0"?>
            <!DOCTYPE nmaprun [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
            <nmaprun>
              <host>
                <status state="up"/>
                <address addr="203.0.113.1" addrtype="ipv4"/>
                <hostnames><hostname name="&xxe;"/></hostnames>
              </host>
            </nmaprun>
            """;

        var act = () => _parser.Parse(hostile);

        // Either it throws on the undefined entity or it parses without ever
        // reading the file — both are safe. What must never happen is the
        // contents of a local file appearing in the result.
        try
        {
            var result = act();
            result.Hosts.Should().OnlyContain(h => h.Hostname == null || !h.Hostname.Contains("root:"));
        }
        catch (System.Xml.XmlException)
        {
            // Undefined entity rejected outright — also acceptable.
        }
    }

    [Fact]
    public void Empty_run_parses_to_an_empty_result()
    {
        var result = _parser.Parse("<?xml version=\"1.0\"?><nmaprun></nmaprun>");

        result.Hosts.Should().BeEmpty();
        result.HostsUp.Should().Be(0);
        result.HostsDown.Should().Be(0);
    }
}
