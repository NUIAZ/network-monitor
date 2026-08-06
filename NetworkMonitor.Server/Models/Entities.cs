using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace NetworkMonitor.Server.Models;

/// <summary>
/// A physical or logical location that owns one or more networks — a plant, an
/// office, a data center. Sites are the top of the inventory hierarchy and give
/// every device a "where" for filtering, alert routing, and reporting.
/// </summary>
[Table("sites")]
public class Site
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Short uppercase key used in UI filters and API routes (e.g., "DAL").</summary>
    [Required, MaxLength(20)]
    [Column("site_key")]
    public string SiteKey { get; set; } = "";

    /// <summary>Human-readable site name (e.g., "Dallas Distribution Center").</summary>
    [Required, MaxLength(120)]
    [Column("name")]
    public string Name { get; set; } = "";

    [MaxLength(120)]
    [Column("city")]
    public string? City { get; set; }

    [MaxLength(2)]
    [Column("state")]
    public string? State { get; set; }

    /// <summary>Latitude for the facility map. Null hides the site from the map.</summary>
    [Column("latitude")]
    public double? Latitude { get; set; }

    [Column("longitude")]
    public double? Longitude { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Network> Networks { get; set; } = [];
}

/// <summary>
/// A scannable IP range belonging to a site, expressed in CIDR notation. Each
/// network carries its own scan cadence and owns the devices discovered inside it.
/// </summary>
[Table("networks")]
public class Network
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("site_id")]
    public int SiteId { get; set; }

    [Required, MaxLength(120)]
    [Column("name")]
    public string Name { get; set; } = "";

    /// <summary>Target range in CIDR notation (e.g., "203.0.113.0/24"). Validated before it reaches a command line.</summary>
    [Required, MaxLength(64)]
    [Column("cidr")]
    public string Cidr { get; set; } = "";

    [MaxLength(500)]
    [Column("description")]
    public string? Description { get; set; }

    /// <summary>How often the quick (host discovery) profile runs, in seconds.</summary>
    [Column("scan_interval_seconds")]
    public int ScanIntervalSeconds { get; set; } = 300;

    /// <summary>How often the deep (service detection) profile runs, in seconds.</summary>
    [Column("deep_scan_interval_seconds")]
    public int DeepScanIntervalSeconds { get; set; } = 3600;

    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(SiteId))]
    public Site? Site { get; set; }

    public ICollection<Device> Devices { get; set; } = [];
    public ICollection<ScanProfile> ScanProfiles { get; set; } = [];
}

/// <summary>
/// A network device discovered during a scan. Tracks addressing, identity, the
/// classified device type, and the online/offline lifecycle. Unique on
/// (NetworkId, IpAddress) so a repeat scan updates rather than duplicates.
/// </summary>
[Table("devices")]
public class Device
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("network_id")]
    public int NetworkId { get; set; }

    /// <summary>IPv4 address. Sized at 45 chars to leave room for IPv6 later.</summary>
    [Required, MaxLength(45)]
    [Column("ip_address")]
    public string IpAddress { get; set; } = "";

    /// <summary>MAC address in colon-separated form. Null when the scan was off-subnet (no ARP).</summary>
    [MaxLength(17)]
    [Column("mac_address")]
    public string? MacAddress { get; set; }

    [MaxLength(255)]
    [Column("hostname")]
    public string? Hostname { get; set; }

    /// <summary>Hardware vendor resolved from the MAC OUI prefix (e.g., "Cisco Systems").</summary>
    [MaxLength(255)]
    [Column("vendor")]
    public string? Vendor { get; set; }

    /// <summary>Best-guess OS from Nmap fingerprinting or an SMB discovery script.</summary>
    [MaxLength(255)]
    [Column("os_guess")]
    public string? OsGuess { get; set; }

    /// <summary>
    /// Classification inferred from OS, vendor, open ports, and hostname:
    /// router, switch, firewall, printer, server, workstation, camera, unknown.
    /// </summary>
    [MaxLength(50)]
    [Column("device_type")]
    public string DeviceType { get; set; } = "unknown";

    /// <summary>Lifecycle status: "new" (first sighting), "online", or "offline".</summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "new";

    [Column("first_seen")]
    public DateTime FirstSeen { get; set; } = DateTime.UtcNow;

    /// <summary>Last scan in which the device actually responded.</summary>
    [Column("last_seen")]
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Last scan that *covered* this device, whether or not it answered. Differs
    /// from <see cref="LastSeen"/> and is what "stale" checks key on.
    /// </summary>
    [Column("last_scanned_at")]
    public DateTime? LastScannedAt { get; set; }

    [Column("is_flagged")]
    public bool IsFlagged { get; set; }

    /// <summary>Excluded devices are passed to nmap's --exclude and never alert.</summary>
    [Column("is_excluded")]
    public bool IsExcluded { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    /// <summary>Operator-entered hardware description (e.g., "Catalyst 2960X").</summary>
    [MaxLength(255)]
    [Column("hardware")]
    public string? Hardware { get; set; }

    [MaxLength(255)]
    [Column("physical_location")]
    public string? PhysicalLocation { get; set; }

    /// <summary>Owning team or purpose (e.g., "Warehouse WMS", "Facilities").</summary>
    [MaxLength(255)]
    [Column("assigned_to")]
    public string? AssignedTo { get; set; }

    /// <summary>
    /// Consecutive scans in which the device did not answer. Once this reaches the
    /// configured threshold the device flips to offline — a single dropped packet
    /// should never page anyone.
    /// </summary>
    [Column("missed_scans")]
    public int MissedScans { get; set; }

    [ForeignKey(nameof(NetworkId))]
    public Network? Network { get; set; }

    public ICollection<Port> Ports { get; set; } = [];
    public ICollection<Alert> Alerts { get; set; } = [];
    public ICollection<ScanDeviceSnapshot> Snapshots { get; set; } = [];
}

/// <summary>An open port and its identified service on a device.</summary>
[Table("ports")]
public class Port
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("device_id")]
    public int DeviceId { get; set; }

    [Column("port_number")]
    public int PortNumber { get; set; }

    [Required, MaxLength(10)]
    [Column("protocol")]
    public string Protocol { get; set; } = "tcp";

    /// <summary>Nmap port state: open, filtered, closed.</summary>
    [Required, MaxLength(20)]
    [Column("state")]
    public string State { get; set; } = "open";

    [MaxLength(120)]
    [Column("service_name")]
    public string? ServiceName { get; set; }

    /// <summary>Product + version + extra info, e.g. "Apache httpd 2.4.52".</summary>
    [MaxLength(255)]
    [Column("service_version")]
    public string? ServiceVersion { get; set; }

    [Column("first_seen")]
    public DateTime FirstSeen { get; set; } = DateTime.UtcNow;

    [Column("last_seen")]
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// One execution of a scan profile against a network: what ran, when, how it
/// went, and the raw XML kept for forensics.
/// </summary>
[Table("scan_results")]
public class ScanResult
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("network_id")]
    public int NetworkId { get; set; }

    /// <summary>Profile that produced this run: quick, deep, security, full_port, udp.</summary>
    [Required, MaxLength(20)]
    [Column("scan_type")]
    public string ScanType { get; set; } = "quick";

    /// <summary>The exact command line executed, kept so results are reproducible.</summary>
    [Column("nmap_command")]
    public string? NmapCommand { get; set; }

    [Column("started_at")]
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    [Column("hosts_up")]
    public int HostsUp { get; set; }

    [Column("hosts_down")]
    public int HostsDown { get; set; }

    [Column("new_devices")]
    public int NewDevices { get; set; }

    /// <summary>Raw nmap XML. JsonIgnore'd — it is far too large for list responses.</summary>
    [JsonIgnore]
    [Column("raw_xml")]
    public string? RawXml { get; set; }

    /// <summary>running, completed, or failed.</summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "running";

    [MaxLength(1000)]
    [Column("failure_reason")]
    public string? FailureReason { get; set; }

    [Column("excluded_count")]
    public int ExcludedCount { get; set; }

    [ForeignKey(nameof(NetworkId))]
    public Network? Network { get; set; }

    public ICollection<ScanDeviceSnapshot> Snapshots { get; set; } = [];
}

/// <summary>
/// Per-device record of what a single scan saw. This is what makes the history
/// view possible: "show me this device's state on every scan for the last week".
/// </summary>
[Table("scan_device_snapshots")]
public class ScanDeviceSnapshot
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("scan_result_id")]
    public int ScanResultId { get; set; }

    [Column("device_id")]
    public int DeviceId { get; set; }

    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "online";

    [Column("open_port_count")]
    public int OpenPortCount { get; set; }

    /// <summary>Round-trip latency in milliseconds when the scan measured it.</summary>
    [Column("response_time_ms")]
    public double? ResponseTimeMs { get; set; }

    [Column("recorded_at")]
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(ScanResultId))]
    public ScanResult? ScanResult { get; set; }

    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// Something a human should look at: a new device appeared, a device went
/// offline, a port opened or closed, a certificate is expiring.
/// </summary>
[Table("alerts")]
public class Alert
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("device_id")]
    public int? DeviceId { get; set; }

    [Column("network_id")]
    public int? NetworkId { get; set; }

    /// <summary>new_device, device_offline, device_online, port_opened, port_closed, cert_expiring, vulnerability.</summary>
    [Required, MaxLength(50)]
    [Column("alert_type")]
    public string AlertType { get; set; } = "";

    /// <summary>info, warning, or critical — drives colour and notification routing.</summary>
    [Required, MaxLength(20)]
    [Column("severity")]
    public string Severity { get; set; } = "info";

    [Required, MaxLength(500)]
    [Column("message")]
    public string Message { get; set; } = "";

    [Column("details")]
    public string? Details { get; set; }

    [Column("is_acknowledged")]
    public bool IsAcknowledged { get; set; }

    [MaxLength(120)]
    [Column("acknowledged_by")]
    public string? AcknowledgedBy { get; set; }

    [Column("acknowledged_at")]
    public DateTime? AcknowledgedAt { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// A named scan configuration attached to a network: which nmap arguments to
/// run, how often, and whether it is turned on.
/// </summary>
[Table("scan_profiles")]
public class ScanProfile
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("network_id")]
    public int NetworkId { get; set; }

    [Required, MaxLength(30)]
    [Column("profile_type")]
    public string ProfileType { get; set; } = "quick";

    /// <summary>Nmap arguments for this profile, minus target and output flags.</summary>
    [Required, MaxLength(500)]
    [Column("nmap_args")]
    public string NmapArgs { get; set; } = "";

    [Column("interval_seconds")]
    public int IntervalSeconds { get; set; } = 300;

    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    [Column("last_run_at")]
    public DateTime? LastRunAt { get; set; }

    [ForeignKey(nameof(NetworkId))]
    public Network? Network { get; set; }
}

/// <summary>
/// A CVE matched against a service version found on a device, with the CVSS
/// score that drives triage order.
/// </summary>
[Table("vulnerabilities")]
public class Vulnerability
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("device_id")]
    public int DeviceId { get; set; }

    [Required, MaxLength(40)]
    [Column("cve_id")]
    public string CveId { get; set; } = "";

    /// <summary>CVSS v3 base score, 0.0–10.0.</summary>
    [Column("cvss_score")]
    public double? CvssScore { get; set; }

    /// <summary>critical, high, medium, low.</summary>
    [Required, MaxLength(20)]
    [Column("severity")]
    public string Severity { get; set; } = "medium";

    [MaxLength(2000)]
    [Column("description")]
    public string? Description { get; set; }

    /// <summary>The service that matched, e.g. "OpenSSH 7.4".</summary>
    [MaxLength(255)]
    [Column("affected_service")]
    public string? AffectedService { get; set; }

    [Column("port_number")]
    public int? PortNumber { get; set; }

    /// <summary>open, remediated, or accepted_risk.</summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "open";

    [Column("detected_at")]
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// A TLS certificate observed on an open port, tracked mainly so nothing
/// expires unnoticed.
/// </summary>
[Table("ssl_certificates")]
public class SslCertificate
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("device_id")]
    public int DeviceId { get; set; }

    [Column("port_number")]
    public int PortNumber { get; set; }

    [MaxLength(500)]
    [Column("subject")]
    public string? Subject { get; set; }

    [MaxLength(500)]
    [Column("issuer")]
    public string? Issuer { get; set; }

    [Column("valid_from")]
    public DateTime? ValidFrom { get; set; }

    [Column("valid_to")]
    public DateTime? ValidTo { get; set; }

    [MaxLength(20)]
    [Column("key_type")]
    public string? KeyType { get; set; }

    [Column("key_bits")]
    public int? KeyBits { get; set; }

    [Column("is_self_signed")]
    public bool IsSelfSigned { get; set; }

    [Column("detected_at")]
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// A switch or router polled over SNMP for per-interface throughput and errors.
/// </summary>
[Table("snmp_targets")]
public class SnmpTarget
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("site_id")]
    public int SiteId { get; set; }

    [Required, MaxLength(45)]
    [Column("ip_address")]
    public string IpAddress { get; set; } = "";

    [Required, MaxLength(120)]
    [Column("name")]
    public string Name { get; set; } = "";

    [MaxLength(255)]
    [Column("model")]
    public string? Model { get; set; }

    /// <summary>
    /// SNMP v2c community string. In a real deployment supply this via
    /// configuration or a secret store — never commit a production community.
    /// </summary>
    [MaxLength(120)]
    [Column("community")]
    [JsonIgnore]
    public string Community { get; set; } = "public";

    [Column("poll_interval_seconds")]
    public int PollIntervalSeconds { get; set; } = 300;

    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    [Column("last_polled_at")]
    public DateTime? LastPolledAt { get; set; }

    [ForeignKey(nameof(SiteId))]
    public Site? Site { get; set; }

    public ICollection<InterfaceSnapshot> Interfaces { get; set; } = [];
}

/// <summary>
/// One SNMP poll of one interface. Octet counters are converted to a utilization
/// percentage against the interface speed so the UI can chart it directly.
/// </summary>
[Table("interface_snapshots")]
public class InterfaceSnapshot
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Column("snmp_target_id")]
    public int SnmpTargetId { get; set; }

    [Column("if_index")]
    public int IfIndex { get; set; }

    [Required, MaxLength(120)]
    [Column("if_name")]
    public string IfName { get; set; } = "";

    [MaxLength(255)]
    [Column("if_alias")]
    public string? IfAlias { get; set; }

    /// <summary>Interface speed in bits per second, from ifSpeed/ifHighSpeed.</summary>
    [Column("speed_bps")]
    public long SpeedBps { get; set; }

    /// <summary>up, down, or testing (ifOperStatus).</summary>
    [Required, MaxLength(20)]
    [Column("oper_status")]
    public string OperStatus { get; set; } = "up";

    [Column("in_octets")]
    public long InOctets { get; set; }

    [Column("out_octets")]
    public long OutOctets { get; set; }

    [Column("in_errors")]
    public long InErrors { get; set; }

    [Column("out_errors")]
    public long OutErrors { get; set; }

    /// <summary>Computed utilization percent (0–100) from the delta against the prior poll.</summary>
    [Column("utilization_percent")]
    public double UtilizationPercent { get; set; }

    [Column("recorded_at")]
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(SnmpTargetId))]
    public SnmpTarget? SnmpTarget { get; set; }
}

/// <summary>Simple key/value application settings editable from the Settings page.</summary>
[Table("app_settings")]
public class AppSetting
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Required, MaxLength(120)]
    [Column("key")]
    public string Key { get; set; } = "";

    [Column("value")]
    public string? Value { get; set; }

    [MaxLength(500)]
    [Column("description")]
    public string? Description { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
