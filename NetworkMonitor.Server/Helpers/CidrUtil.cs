using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace NetworkMonitor.Server.Helpers;

/// <summary>
/// CIDR parsing and (more importantly) validation. Every scan target is passed
/// to an external process command line, so it is validated here first. Anything
/// that is not a plain IPv4 address or IPv4/prefix is rejected outright rather
/// than escaped, which keeps the rule easy to reason about.
/// </summary>
public static partial class CidrUtil
{
    [GeneratedRegex(@"^(\d{1,3}\.){3}\d{1,3}(/\d{1,2})?$")]
    private static partial Regex CidrShape();

    /// <summary>
    /// Throws unless <paramref name="cidr"/> is a well-formed IPv4 address or
    /// IPv4 CIDR block. Call this before building any nmap command line.
    /// </summary>
    /// <exception cref="ArgumentException">The value is empty, malformed, or out of range.</exception>
    public static void ValidateForCommand(string cidr)
    {
        if (string.IsNullOrWhiteSpace(cidr))
            throw new ArgumentException("Scan target is required.", nameof(cidr));

        var value = cidr.Trim();

        // Shape check first: this alone rejects shell metacharacters, spaces,
        // semicolons, backticks, and every other injection vector.
        if (!CidrShape().IsMatch(value))
            throw new ArgumentException(
                $"Invalid scan target '{cidr}'. Expected an IPv4 address or CIDR block such as 203.0.113.0/24.",
                nameof(cidr));

        var parts = value.Split('/');

        if (!IPAddress.TryParse(parts[0], out var ip) || ip.AddressFamily != AddressFamily.InterNetwork)
            throw new ArgumentException($"Invalid IPv4 address in '{cidr}'.", nameof(cidr));

        if (parts.Length == 2)
        {
            if (!int.TryParse(parts[1], out var prefix) || prefix < 0 || prefix > 32)
                throw new ArgumentException($"Invalid prefix length in '{cidr}'. Must be 0-32.", nameof(cidr));
        }
    }

    /// <summary>
    /// Returns the number of addresses a CIDR block covers, used to warn before
    /// someone kicks off a /8 sweep by accident.
    /// </summary>
    public static long AddressCount(string cidr)
    {
        var parts = cidr.Trim().Split('/');
        if (parts.Length != 2 || !int.TryParse(parts[1], out var prefix)) return 1;
        return 1L << (32 - Math.Clamp(prefix, 0, 32));
    }

    /// <summary>True when the address falls inside the CIDR block.</summary>
    public static bool Contains(string cidr, string ipAddress)
    {
        var parts = cidr.Trim().Split('/');
        if (!IPAddress.TryParse(parts[0], out var network)) return false;
        if (!IPAddress.TryParse(ipAddress, out var target)) return false;
        if (parts.Length != 2 || !int.TryParse(parts[1], out var prefix)) return network.Equals(target);

        var networkBits = BitConverter.ToUInt32(network.GetAddressBytes().Reverse().ToArray(), 0);
        var targetBits = BitConverter.ToUInt32(target.GetAddressBytes().Reverse().ToArray(), 0);
        if (prefix == 0) return true;
        var mask = uint.MaxValue << (32 - prefix);
        return (networkBits & mask) == (targetBits & mask);
    }
}
