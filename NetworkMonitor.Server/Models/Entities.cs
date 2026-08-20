using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace NetworkMonitor.Server.Models;

/// <summary>
/// A physical or logical location that owns one or more networks: a plant, an
/// office, a data center. Sites are the top of the inventory hierarchy and give
/// every device a "where" for filtering, alert routing, and reporting.
/// </summary>
[Table("sites")]
public class Site
{
    /// <summary>Primary key.</summary>
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

    /// <summary>City the facility sits in. Display only, nothing keys on it.</summary>
    [MaxLength(120)]
    [Column("city")]
    public string? City { get; set; }

    /// <summary>Two-letter state/province abbreviation, uppercased on write.</summary>
    [MaxLength(2)]
    [Column("state")]
    public string? State { get; set; }

    /// <summary>Latitude for the facility map. Null hides the site from the map.</summary>
    [Column("latitude")]
    public double? Latitude { get; set; }

    /// <summary>Longitude for the facility map. Null hides the site from the map, same as a null latitude.</summary>
    [Column("longitude")]
    public double? Longitude { get; set; }

    /// <summary>UTC timestamp the row was created.</summary>
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Networks belonging to this site. Deleting the site cascades through these to their devices.</summary>
    public ICollection<Network> Networks { get; set; } = [];
}

/// <summary>
/// A scannable IP range belonging to a site, expressed in CIDR notation. Each
/// network carries its own scan cadence and owns the devices discovered inside it.
/// </summary>
[Table("networks")]
public class Network
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Owning site.</summary>
    [Column("site_id")]
    public int SiteId { get; set; }

    /// <summary>Human-readable network name (e.g., "Warehouse Floor").</summary>
    [Required, MaxLength(120)]
    [Column("name")]
    public string Name { get; set; } = "";

    /// <summary>Target range in CIDR notation (e.g., "203.0.113.0/24"). Validated before it reaches a command line.</summary>
    [Required, MaxLength(64)]
    [Column("cidr")]
    public string Cidr { get; set; } = "";

    /// <summary>Free-text note about what lives on the range. Purely for the humans reading the list.</summary>
    [MaxLength(500)]
    [Column("description")]
    public string? Description { get; set; }

    /// <summary>How often the quick (host discovery) profile runs, in seconds.</summary>
    [Column("scan_interval_seconds")]
    public int ScanIntervalSeconds { get; set; } = 300;

    /// <summary>How often the deep (service detection) profile runs, in seconds.</summary>
    [Column("deep_scan_interval_seconds")]
    public int DeepScanIntervalSeconds { get; set; } = 3600;

    /// <summary>
    /// False parks the network: the scheduler skips it entirely, but the devices
    /// and history already discovered are kept. This is the safe way to stop
    /// scanning a range without losing what is known about it.
    /// </summary>
    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    /// <summary>UTC timestamp the row was created.</summary>
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Owning site. Null unless the query included it.</summary>
    [ForeignKey(nameof(SiteId))]
    public Site? Site { get; set; }

    /// <summary>Devices discovered inside this range. Cascade-deleted with the network.</summary>
    public ICollection<Device> Devices { get; set; } = [];

    /// <summary>The five scan profiles created for every network, enabled or not.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Network the device was discovered on; half of the uniqueness key with <see cref="IpAddress"/>.</summary>
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

    /// <summary>Reverse-DNS name from the scan, or whatever an operator typed over it. See <see cref="HostnameIsManual"/>.</summary>
    [MaxLength(255)]
    [Column("hostname")]
    public string? Hostname { get; set; }

    /// <summary>
    /// True once an operator has typed a hostname by hand, which stops discovery
    /// from overwriting it.
    ///
    /// Without this flag the field is a trap: an operator renames a device whose
    /// reverse DNS is wrong or missing, the next scan resolves something and
    /// silently reverts the edit, and the only symptom is that the correction
    /// "didn't save". Discovery keeps ownership of every other identity field,
    /// so this is the one place the precedence has to be recorded.
    /// </summary>
    [Column("hostname_is_manual")]
    public bool HostnameIsManual { get; set; }

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

    /// <summary>UTC timestamp of the first scan that ever saw this address on this network.</summary>
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

    /// <summary>Operator-set follow-up marker. Nothing in the scan pipeline reads it; it exists purely to survive a shift change.</summary>
    [Column("is_flagged")]
    public bool IsFlagged { get; set; }

    /// <summary>Excluded devices are passed to nmap's --exclude and never alert.</summary>
    [Column("is_excluded")]
    public bool IsExcluded { get; set; }

    /// <summary>Free-text operator notes. The only unbounded text column on the device.</summary>
    [Column("notes")]
    public string? Notes { get; set; }

    /// <summary>Operator-entered hardware description (e.g., "Catalyst 2960X").</summary>
    [MaxLength(255)]
    [Column("hardware")]
    public string? Hardware { get; set; }

    /// <summary>Operator-entered physical location, rack, room, or closet.</summary>
    [MaxLength(255)]
    [Column("physical_location")]
    public string? PhysicalLocation { get; set; }

    /// <summary>Owning team or purpose (e.g., "Warehouse WMS", "Facilities").</summary>
    [MaxLength(255)]
    [Column("assigned_to")]
    public string? AssignedTo { get; set; }

    /// <summary>
    /// Consecutive scans in which the device did not answer. Once this reaches the
    /// configured threshold the device flips to offline; a single dropped packet
    /// should never page anyone.
    /// </summary>
    [Column("missed_scans")]
    public int MissedScans { get; set; }

    /// <summary>Owning network. Null unless the query included it.</summary>
    [ForeignKey(nameof(NetworkId))]
    public Network? Network { get; set; }

    /// <summary>Ports observed on this device, including ones that have since closed.</summary>
    public ICollection<Port> Ports { get; set; } = [];

    /// <summary>Alerts raised about this device. The link is nulled rather than cascaded on delete, so the alert history survives.</summary>
    public ICollection<Alert> Alerts { get; set; } = [];

    /// <summary>Per-scan observations of this device, the raw material for the history chart.</summary>
    public ICollection<ScanDeviceSnapshot> Snapshots { get; set; } = [];
}

/// <summary>An open port and its identified service on a device.</summary>
[Table("ports")]
public class Port
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Owning device; part of the (device, port, protocol) uniqueness key.</summary>
    [Column("device_id")]
    public int DeviceId { get; set; }

    /// <summary>TCP/UDP port number, 1-65535.</summary>
    [Column("port_number")]
    public int PortNumber { get; set; }

    /// <summary>"tcp" or "udp". Part of the uniqueness key, since the same number can be open on both.</summary>
    [Required, MaxLength(10)]
    [Column("protocol")]
    public string Protocol { get; set; } = "tcp";

    /// <summary>Nmap port state: open, filtered, closed.</summary>
    [Required, MaxLength(20)]
    [Column("state")]
    public string State { get; set; } = "open";

    /// <summary>Service nmap named on the port, e.g. "https". A guess from the port number alone unless -sV ran.</summary>
    [MaxLength(120)]
    [Column("service_name")]
    public string? ServiceName { get; set; }

    /// <summary>Product + version + extra info, e.g. "Apache httpd 2.4.52".</summary>
    [MaxLength(255)]
    [Column("service_version")]
    public string? ServiceVersion { get; set; }

    /// <summary>UTC timestamp the port was first observed open.</summary>
    [Column("first_seen")]
    public DateTime FirstSeen { get; set; } = DateTime.UtcNow;

    /// <summary>UTC timestamp of the most recent scan that observed this port in this state.</summary>
    [Column("last_seen")]
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;

    /// <summary>Owning device. Null unless the query included it.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Network that was scanned.</summary>
    [Column("network_id")]
    public int NetworkId { get; set; }

    /// <summary>Profile that produced this run: quick, deep, security, full_port, udp.</summary>
    [Required, MaxLength(20)]
    [Column("scan_type")]
    public string ScanType { get; set; } = "quick";

    /// <summary>The exact command line executed, kept so results are reproducible.</summary>
    [Column("nmap_command")]
    public string? NmapCommand { get; set; }

    /// <summary>UTC time the run began. Written before nmap starts, so a crashed run still leaves evidence.</summary>
    [Column("started_at")]
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;

    /// <summary>UTC time the run finished. Null while it is still running.</summary>
    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    /// <summary>Addresses that answered discovery.</summary>
    [Column("hosts_up")]
    public int HostsUp { get; set; }

    /// <summary>Addresses in range that did not answer.</summary>
    [Column("hosts_down")]
    public int HostsDown { get; set; }

    /// <summary>Devices this run saw for the first time, the number that drives "new device" alerts.</summary>
    [Column("new_devices")]
    public int NewDevices { get; set; }

    /// <summary>Raw nmap XML. JsonIgnore'd; it is far too large for list responses.</summary>
    [JsonIgnore]
    [Column("raw_xml")]
    public string? RawXml { get; set; }

    /// <summary>running, completed, or failed.</summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "running";

    /// <summary>Why a failed run failed: usually the nmap stderr text. Null on success.</summary>
    [MaxLength(1000)]
    [Column("failure_reason")]
    public string? FailureReason { get; set; }

    /// <summary>Devices skipped via --exclude. Recorded so a drop in hosts-up is explainable rather than alarming.</summary>
    [Column("excluded_count")]
    public int ExcludedCount { get; set; }

    /// <summary>Network that was scanned. Null unless the query included it.</summary>
    [ForeignKey(nameof(NetworkId))]
    public Network? Network { get; set; }

    /// <summary>Per-device observations from this run.</summary>
    public ICollection<ScanDeviceSnapshot> Snapshots { get; set; } = [];
}

/// <summary>
/// Per-device record of what a single scan saw. This is what makes the history
/// view possible: "show me this device's state on every scan for the last week".
/// </summary>
[Table("scan_device_snapshots")]
public class ScanDeviceSnapshot
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Scan run this observation came from.</summary>
    [Column("scan_result_id")]
    public int ScanResultId { get; set; }

    /// <summary>Device observed.</summary>
    [Column("device_id")]
    public int DeviceId { get; set; }

    /// <summary>
    /// What this scan saw. Three values, not two:
    /// <list type="bullet">
    ///   <item><c>online</c>: the device answered.</item>
    ///   <item><c>missed</c>: the scan covered it and it did not answer, but it
    ///     has not yet missed enough consecutive scans to be declared down.</item>
    ///   <item><c>offline</c>: it did not answer and the device is now offline.</item>
    /// </list>
    /// A consumer switching on only online/offline silently mis-renders every
    /// <c>missed</c> row, which is most of a flaky device's history. Never
    /// <c>new</c>: that is a device-level lifecycle state, not an observation.
    /// </summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "online";

    /// <summary>Ports open at the moment of this scan.</summary>
    [Column("open_port_count")]
    public int OpenPortCount { get; set; }

    /// <summary>Round-trip latency in milliseconds when the scan measured it.</summary>
    [Column("response_time_ms")]
    public double? ResponseTimeMs { get; set; }

    /// <summary>UTC time the observation was written.</summary>
    [Column("recorded_at")]
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Scan run this observation came from. Null unless the query included it.</summary>
    [ForeignKey(nameof(ScanResultId))]
    public ScanResult? ScanResult { get; set; }

    /// <summary>Device observed. Null unless the query included it.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Device the alert concerns. Nullable, and set to null when that device is deleted, so the alert history outlives the inventory.</summary>
    [Column("device_id")]
    public int? DeviceId { get; set; }

    /// <summary>Network context. Set even for alerts that are not about one specific device.</summary>
    [Column("network_id")]
    public int? NetworkId { get; set; }

    /// <summary>new_device, device_offline, device_online, port_opened, port_closed, cert_expiring, vulnerability.</summary>
    [Required, MaxLength(50)]
    [Column("alert_type")]
    public string AlertType { get; set; } = "";

    /// <summary>info, warning, or critical; drives colour and notification routing.</summary>
    [Required, MaxLength(20)]
    [Column("severity")]
    public string Severity { get; set; } = "info";

    /// <summary>One-line summary, written to be readable on its own in a feed with no other context.</summary>
    [Required, MaxLength(500)]
    [Column("message")]
    public string Message { get; set; } = "";

    /// <summary>Optional longer body, e.g. the specific ports that changed.</summary>
    [Column("details")]
    public string? Details { get; set; }

    /// <summary>True once someone has taken it on. Acknowledged alerts drop out of the default feed but are never deleted automatically.</summary>
    [Column("is_acknowledged")]
    public bool IsAcknowledged { get; set; }

    /// <summary>Who acknowledged it. Unverified free text; this build has no authentication, so treat it as a claim, not an identity.</summary>
    [MaxLength(120)]
    [Column("acknowledged_by")]
    public string? AcknowledgedBy { get; set; }

    /// <summary>UTC time of acknowledgement. Null while the alert is open.</summary>
    [Column("acknowledged_at")]
    public DateTime? AcknowledgedAt { get; set; }

    /// <summary>UTC time the scan pipeline raised the alert.</summary>
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Device the alert concerns. Null unless the query included it, or because the device has since been deleted.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Network this profile scans.</summary>
    [Column("network_id")]
    public int NetworkId { get; set; }

    /// <summary>quick, deep, security, full_port, or udp. One row of each type per network; the client addresses profiles by this rather than by id.</summary>
    [Required, MaxLength(30)]
    [Column("profile_type")]
    public string ProfileType { get; set; } = "quick";

    /// <summary>Nmap arguments for this profile, minus target and output flags.</summary>
    [Required, MaxLength(500)]
    [Column("nmap_args")]
    public string NmapArgs { get; set; } = "";

    /// <summary>Seconds between scheduled runs. The scheduler compares this against <see cref="LastRunAt"/>.</summary>
    [Column("interval_seconds")]
    public int IntervalSeconds { get; set; } = 300;

    /// <summary>False leaves the profile configured but unscheduled; it can still be run on demand.</summary>
    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    /// <summary>UTC start of the last run. Null means "never ran", which the scheduler treats as immediately due.</summary>
    [Column("last_run_at")]
    public DateTime? LastRunAt { get; set; }

    /// <summary>Owning network. Null unless the query included it.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Affected device. Cascade-deleted with it.</summary>
    [Column("device_id")]
    public int DeviceId { get; set; }

    /// <summary>CVE identifier, e.g. "CVE-2021-44228".</summary>
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

    /// <summary>Vulnerability summary text as reported by the source.</summary>
    [MaxLength(2000)]
    [Column("description")]
    public string? Description { get; set; }

    /// <summary>The service that matched, e.g. "OpenSSH 7.4".</summary>
    [MaxLength(255)]
    [Column("affected_service")]
    public string? AffectedService { get; set; }

    /// <summary>Port the affected service was found on. Null for host-level findings.</summary>
    [Column("port_number")]
    public int? PortNumber { get; set; }

    /// <summary>open, remediated, or accepted_risk.</summary>
    [Required, MaxLength(20)]
    [Column("status")]
    public string Status { get; set; } = "open";

    /// <summary>UTC time the finding was first recorded. Not re-stamped on later confirmations, so it reads as "how long has this been open".</summary>
    [Column("detected_at")]
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Affected device. Null unless the query included it.</summary>
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
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Device that served the certificate.</summary>
    [Column("device_id")]
    public int DeviceId { get; set; }

    /// <summary>Port the certificate was served on; one device can serve several different certs.</summary>
    [Column("port_number")]
    public int PortNumber { get; set; }

    /// <summary>Certificate subject DN as nmap's ssl-cert script reported it.</summary>
    [MaxLength(500)]
    [Column("subject")]
    public string? Subject { get; set; }

    /// <summary>Certificate issuer DN. Equal to the subject on a self-signed cert.</summary>
    [MaxLength(500)]
    [Column("issuer")]
    public string? Issuer { get; set; }

    /// <summary>Start of the validity window, UTC. A future value means the cert is not valid yet.</summary>
    [Column("valid_from")]
    public DateTime? ValidFrom { get; set; }

    /// <summary>End of the validity window, UTC. This is the field the expiry warning and the dashboard tile key on.</summary>
    [Column("valid_to")]
    public DateTime? ValidTo { get; set; }

    /// <summary>Key algorithm, e.g. "rsa" or "ec".</summary>
    [MaxLength(20)]
    [Column("key_type")]
    public string? KeyType { get; set; }

    /// <summary>Key size in bits. Small values on an RSA key are the reason this is tracked at all.</summary>
    [Column("key_bits")]
    public int? KeyBits { get; set; }

    /// <summary>True when the certificate signs itself: routine on appliance management interfaces, alarming almost anywhere else.</summary>
    [Column("is_self_signed")]
    public bool IsSelfSigned { get; set; }

    /// <summary>UTC time the certificate was first observed.</summary>
    [Column("detected_at")]
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Device that served the certificate. Null unless the query included it.</summary>
    [ForeignKey(nameof(DeviceId))]
    public Device? Device { get; set; }
}

/// <summary>
/// A switch or router polled over SNMP for per-interface throughput and errors.
/// </summary>
[Table("snmp_targets")]
public class SnmpTarget
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Site the device sits at. SNMP targets hang off sites, not networks; a core switch often carries every VLAN at once.</summary>
    [Column("site_id")]
    public int SiteId { get; set; }

    /// <summary>Management IPv4 address polled over SNMP. Sized at 45 chars for future IPv6, same as <see cref="Device.IpAddress"/>.</summary>
    [Required, MaxLength(45)]
    [Column("ip_address")]
    public string IpAddress { get; set; } = "";

    /// <summary>Human-readable target name shown in the utilization list.</summary>
    [Required, MaxLength(120)]
    [Column("name")]
    public string Name { get; set; } = "";

    /// <summary>Hardware model string, when someone recorded it.</summary>
    [MaxLength(255)]
    [Column("model")]
    public string? Model { get; set; }

    /// <summary>
    /// SNMP v2c community string. In a real deployment supply this via
    /// configuration or a secret store: never commit a production community.
    /// </summary>
    [MaxLength(120)]
    [Column("community")]
    [JsonIgnore]
    public string Community { get; set; } = "public";

    /// <summary>Seconds between polls of this target.</summary>
    [Column("poll_interval_seconds")]
    public int PollIntervalSeconds { get; set; } = 300;

    /// <summary>False stops polling without losing the interface history already collected.</summary>
    [Column("is_enabled")]
    public bool IsEnabled { get; set; } = true;

    /// <summary>UTC time of the last successful poll. Null when the target has never been reached.</summary>
    [Column("last_polled_at")]
    public DateTime? LastPolledAt { get; set; }

    /// <summary>Site the target sits at. Null unless the query included it.</summary>
    [ForeignKey(nameof(SiteId))]
    public Site? Site { get; set; }

    /// <summary>Every interface snapshot ever taken of this target, not just the latest set.</summary>
    public ICollection<InterfaceSnapshot> Interfaces { get; set; } = [];
}

/// <summary>
/// One SNMP poll of one interface. Octet counters are converted to a utilization
/// percentage against the interface speed so the UI can chart it directly.
/// </summary>
[Table("interface_snapshots")]
public class InterfaceSnapshot
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Target this poll came from.</summary>
    [Column("snmp_target_id")]
    public int SnmpTargetId { get; set; }

    /// <summary>SNMP ifIndex: an interface's identity within its device, and stable only until the device reboots or is re-carded.</summary>
    [Column("if_index")]
    public int IfIndex { get; set; }

    /// <summary>ifName as reported, e.g. "GigabitEthernet1/0/24".</summary>
    [Required, MaxLength(120)]
    [Column("if_name")]
    public string IfName { get; set; } = "";

    /// <summary>ifAlias: whatever description the network team configured. Usually the most useful label on the row.</summary>
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

    /// <summary>Raw inbound octet counter at poll time. Cumulative and wrapping, so only deltas are meaningful.</summary>
    [Column("in_octets")]
    public long InOctets { get; set; }

    /// <summary>Raw outbound octet counter at poll time. Cumulative and wrapping, same caveat as <see cref="InOctets"/>.</summary>
    [Column("out_octets")]
    public long OutOctets { get; set; }

    /// <summary>Cumulative inbound error counter. A rising delta usually means a cable or duplex problem.</summary>
    [Column("in_errors")]
    public long InErrors { get; set; }

    /// <summary>Cumulative outbound error counter.</summary>
    [Column("out_errors")]
    public long OutErrors { get; set; }

    /// <summary>Computed utilization percent (0–100) from the delta against the prior poll.</summary>
    [Column("utilization_percent")]
    public double UtilizationPercent { get; set; }

    /// <summary>UTC time of the poll. The delta window is the gap to the previous row for the same interface.</summary>
    [Column("recorded_at")]
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Target this poll came from. Null unless the query included it.</summary>
    [ForeignKey(nameof(SnmpTargetId))]
    public SnmpTarget? SnmpTarget { get; set; }
}

/// <summary>Simple key/value application settings editable from the Settings page.</summary>
[Table("app_settings")]
public class AppSetting
{
    /// <summary>Primary key. Callers address settings by <see cref="Key"/>, so this is never exposed over the API.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Unique setting name, also the route segment for the update call. Keys are created by the seeder/installer, never by a client PUT.</summary>
    [Required, MaxLength(120)]
    [Column("key")]
    public string Key { get; set; } = "";

    /// <summary>Current value, always stored as a string no matter how it is interpreted. Null is a legitimate "cleared" state.</summary>
    [Column("value")]
    public string? Value { get; set; }

    /// <summary>What the setting does; rendered as help text beside the field.</summary>
    [MaxLength(500)]
    [Column("description")]
    public string? Description { get; set; }

    /// <summary>UTC time the value last changed.</summary>
    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
