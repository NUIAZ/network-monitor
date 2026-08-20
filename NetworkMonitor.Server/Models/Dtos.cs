namespace NetworkMonitor.Server.Models;

// ─────────────────────────────────────────────────────────────────────────────
// API DTOs. Controllers never return entities: the EF model carries navigation
// properties in both directions, and serializing one would either cycle or drag
// half the database into a list response. Every response shape the SPA consumes
// is a record here, matching docs/API.md field for field (System.Text.Json
// camel-cases the property names on the wire).
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The one paged envelope every list endpoint uses. A single shape means the
/// client needs exactly one pagination component.
/// </summary>
/// <typeparam name="T">Row shape for this page, always a DTO from this file, never an entity.</typeparam>
/// <param name="Items">Rows for this page only, already ordered by the endpoint.</param>
/// <param name="Page">1-based page actually served, which can differ from the one requested after clamping.</param>
/// <param name="PageSize">Rows per page after clamping (1-500); also differs from the request when the caller asked for something silly.</param>
/// <param name="Total">Matching rows across every page, i.e. the count before Skip/Take.</param>
/// <param name="TotalPages">Page count derived from Total and PageSize, so no caller re-derives (and mis-rounds) it.</param>
public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total, int TotalPages)
{
    /// <summary>Computes TotalPages so no caller re-derives (and mis-rounds) it.</summary>
    public static PagedResult<T> Create(IReadOnlyList<T> items, int page, int pageSize, int total) =>
        new(items, page, pageSize, total, pageSize <= 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize));
}

/// <summary>Shared paging-parameter hygiene so every endpoint clamps identically.</summary>
public static class Paging
{
    /// <summary>
    /// Clamps page/pageSize to sane bounds instead of erroring: a UI bug that
    /// asks for page 0 or pageSize 10000 should degrade, not 400.
    /// </summary>
    public static (int Page, int PageSize) Clamp(int page, int pageSize, int defaultSize = 50, int maxSize = 500) =>
        (Math.Max(1, page), Math.Clamp(pageSize <= 0 ? defaultSize : pageSize, 1, maxSize));
}

// ── Dashboard ────────────────────────────────────────────────────────────────

/// <summary>
/// Headline counters for the landing page (GET /api/dashboard/summary). Every
/// device count here excludes operator-excluded devices, so the tiles reconcile
/// with the inventory list rather than quietly disagreeing with it.
/// </summary>
/// <param name="TotalDevices">Non-excluded devices across every site.</param>
/// <param name="OnlineDevices">Devices whose status is "online".</param>
/// <param name="OfflineDevices">Devices whose status is "offline". Devices still in the "new" state count in neither this nor OnlineDevices, so the two do not have to sum to TotalDevices.</param>
/// <param name="NewDevices24h">Devices first seen in the last 24 hours, the number worth looking at before anything else.</param>
/// <param name="OpenAlerts">Unacknowledged alerts of any severity.</param>
/// <param name="CriticalAlerts">Subset of OpenAlerts at severity "critical".</param>
/// <param name="Sites">Configured sites.</param>
/// <param name="Networks">Configured networks across all sites, enabled or not.</param>
/// <param name="LastScanAt">Start time of the most recent scan of any kind. Null on a system that has never scanned.</param>
/// <param name="OpenVulnerabilities">Vulnerabilities still in status "open" (not remediated or accepted).</param>
/// <param name="CriticalVulnerabilities">Subset of OpenVulnerabilities at severity "critical".</param>
/// <param name="ExpiringCerts">Certificates expiring inside the configured warning window. Already-expired certificates are counted here too; an expired cert is the most urgent member of the set, not a separate category.</param>
/// <param name="NmapAvailable">False when the nmap binary cannot be executed. The first screen leads with "install nmap" rather than letting every scan fail mysteriously.</param>
/// <param name="NmapVersion">First line of <c>nmap --version</c>, or null when nmap is unavailable.</param>
public record DashboardSummaryDto(
    int TotalDevices, int OnlineDevices, int OfflineDevices, int NewDevices24h,
    int OpenAlerts, int CriticalAlerts, int Sites, int Networks, DateTime? LastScanAt,
    int OpenVulnerabilities, int CriticalVulnerabilities, int ExpiringCerts,
    bool NmapAvailable, string? NmapVersion);

/// <summary>One slice of the inventory donut (GET /api/dashboard/device-types).</summary>
/// <param name="DeviceType">Classifier output: router, switch, firewall, printer, server, workstation, camera, unknown.</param>
/// <param name="Count">Non-excluded devices carrying that classification.</param>
public record DeviceTypeCountDto(string DeviceType, int Count);

/// <summary>One day of scan activity. Date is "yyyy-MM-dd" so charts sort lexically.</summary>
/// <param name="Date">Calendar day in UTC as "yyyy-MM-dd". Days with no scans are still emitted, zero-filled, so the x-axis stays continuous.</param>
/// <param name="Scans">Scans started that day.</param>
/// <param name="HostsUp">Peak hosts-up across that day's scans, not the sum: summing repeat scans of one network would multiply-count the same devices.</param>
/// <param name="NewDevices">Devices first discovered that day, summed across scans.</param>
public record ScanActivityPointDto(string Date, int Scans, int HostsUp, int NewDevices);

/// <summary>One day of alert volume split by severity, zero-filled like scan activity.</summary>
/// <param name="Date">Calendar day in UTC as "yyyy-MM-dd".</param>
/// <param name="Info">Alerts raised that day at severity "info".</param>
/// <param name="Warning">Alerts raised that day at severity "warning".</param>
/// <param name="Critical">Alerts raised that day at severity "critical".</param>
public record AlertTrendPointDto(string Date, int Info, int Warning, int Critical);

// ── Sites ────────────────────────────────────────────────────────────────────

/// <summary>A site card in the site list (GET /api/sites), with its rollup counts.</summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="SiteKey">Short uppercase key shown in filters and badges (e.g. "DAL").</param>
/// <param name="Name">Human-readable site name.</param>
/// <param name="City">Free-text city; null when nobody filled it in.</param>
/// <param name="State">Two-letter state/province abbreviation, uppercased on write.</param>
/// <param name="Latitude">Decimal degrees, -90 to 90. Null keeps the site off the facility map.</param>
/// <param name="Longitude">Decimal degrees, -180 to 180. Null keeps the site off the facility map.</param>
/// <param name="CreatedAt">UTC timestamp the site row was created.</param>
/// <param name="NetworkCount">Networks belonging to this site.</param>
/// <param name="DeviceCount">Non-excluded devices across all of this site's networks.</param>
public record SiteDto(
    int Id, string SiteKey, string Name, string? City, string? State,
    double? Latitude, double? Longitude, DateTime CreatedAt, int NetworkCount, int DeviceCount);

/// <summary>One site plus its networks, for the site detail page (GET /api/sites/{id}).</summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="SiteKey">Short uppercase key shown in filters and badges.</param>
/// <param name="Name">Human-readable site name.</param>
/// <param name="City">Free-text city; null when nobody filled it in.</param>
/// <param name="State">Two-letter state/province abbreviation.</param>
/// <param name="Latitude">Decimal degrees, -90 to 90. Null keeps the site off the facility map.</param>
/// <param name="Longitude">Decimal degrees, -180 to 180. Null keeps the site off the facility map.</param>
/// <param name="CreatedAt">UTC timestamp the site row was created.</param>
/// <param name="Networks">The site's networks, name-ordered, each with its own rollups.</param>
public record SiteDetailDto(
    int Id, string SiteKey, string Name, string? City, string? State,
    double? Latitude, double? Longitude, DateTime CreatedAt, IReadOnlyList<NetworkDto> Networks);

/// <summary>
/// Body for both POST /api/sites and PUT /api/sites/{id}, one shape because
/// the two operations validate identically. Every field is nullable so a missing
/// value produces a readable validation message instead of a model-binding error.
/// </summary>
/// <param name="SiteKey">Required, 20 chars max. Uppercased and enforced unique; a collision returns 409.</param>
/// <param name="Name">Required display name.</param>
/// <param name="City">Optional; trimmed on save.</param>
/// <param name="State">Optional, but must be exactly two letters when supplied.</param>
/// <param name="Latitude">Optional decimal degrees, -90 to 90.</param>
/// <param name="Longitude">Optional decimal degrees, -180 to 180.</param>
public record SiteUpsertRequest(
    string? SiteKey, string? Name, string? City, string? State, double? Latitude, double? Longitude);

// ── Networks ─────────────────────────────────────────────────────────────────

/// <summary>A network row in list and rollup responses (GET /api/networks).</summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="SiteId">Owning site.</param>
/// <param name="SiteName">Owning site's display name, denormalized so the list needs no second request.</param>
/// <param name="Name">Human-readable network name.</param>
/// <param name="Cidr">Scan target in CIDR notation, e.g. "203.0.113.0/24".</param>
/// <param name="Description">Optional free-text note about what lives on the range.</param>
/// <param name="ScanIntervalSeconds">Cadence of the quick (host discovery) profile, in seconds.</param>
/// <param name="DeepScanIntervalSeconds">Cadence of the deep (service detection) profile, in seconds.</param>
/// <param name="IsEnabled">False parks the network: the scheduler skips it entirely but the inventory is kept.</param>
/// <param name="DeviceCount">Non-excluded devices discovered on this network.</param>
/// <param name="LastScanAt">Start time of the newest scan of this network; null when it has never been scanned.</param>
/// <param name="CreatedAt">UTC timestamp the network row was created.</param>
public record NetworkDto(
    int Id, int SiteId, string SiteName, string Name, string Cidr, string? Description,
    int ScanIntervalSeconds, int DeepScanIntervalSeconds, bool IsEnabled,
    int DeviceCount, DateTime? LastScanAt, DateTime CreatedAt);

/// <summary>One network plus its scan profiles, for the network detail page (GET /api/networks/{id}).</summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="SiteId">Owning site.</param>
/// <param name="SiteName">Owning site's display name, denormalized for the header.</param>
/// <param name="Name">Human-readable network name.</param>
/// <param name="Cidr">Scan target in CIDR notation.</param>
/// <param name="Description">Optional free-text note about what lives on the range.</param>
/// <param name="ScanIntervalSeconds">Cadence of the quick profile, in seconds.</param>
/// <param name="DeepScanIntervalSeconds">Cadence of the deep profile, in seconds.</param>
/// <param name="IsEnabled">False parks the network; the scheduler skips it.</param>
/// <param name="DeviceCount">Non-excluded devices discovered on this network.</param>
/// <param name="LastScanAt">Start time of the newest scan; null when never scanned.</param>
/// <param name="CreatedAt">UTC timestamp the network row was created.</param>
/// <param name="Profiles">All five scan profiles, including the ones that are switched off.</param>
public record NetworkDetailDto(
    int Id, int SiteId, string SiteName, string Name, string Cidr, string? Description,
    int ScanIntervalSeconds, int DeepScanIntervalSeconds, bool IsEnabled,
    int DeviceCount, DateTime? LastScanAt, DateTime CreatedAt, IReadOnlyList<ScanProfileDto> Profiles);

/// <summary>One network's configuration for a single scan profile.</summary>
/// <param name="Id">Surrogate key of the profile row.</param>
/// <param name="ProfileType">quick, deep, security, full_port, or udp; a fixed set, one of each per network.</param>
/// <param name="NmapArgs">Arguments handed to nmap, minus the target and output flags the executor adds.</param>
/// <param name="IntervalSeconds">How often the scheduler runs this profile, in seconds.</param>
/// <param name="IsEnabled">False leaves the profile configured but never scheduled; it can still be run on demand.</param>
/// <param name="LastRunAt">UTC start of the last run, which is what the scheduler's "is it due" check keys on. Null when it has never run.</param>
public record ScanProfileDto(
    int Id, string ProfileType, string NmapArgs, int IntervalSeconds, bool IsEnabled, DateTime? LastRunAt);

/// <summary>
/// Body for POST /api/networks. Creating a network also materializes the five
/// default scan profiles, so nothing else needs to be posted to make it scannable.
/// </summary>
/// <param name="SiteId">Required owning site; a non-existent id is rejected with a message rather than an FK error.</param>
/// <param name="Name">Required display name.</param>
/// <param name="Cidr">Required IPv4 address or CIDR block. Validated for shape and refused when it covers more addresses than the configured maximum.</param>
/// <param name="Description">Optional free-text note.</param>
/// <param name="ScanIntervalSeconds">Quick-profile cadence in seconds; omitted or non-positive keeps the default.</param>
/// <param name="DeepScanIntervalSeconds">Deep-profile cadence in seconds; omitted or non-positive keeps the default.</param>
public record NetworkCreateRequest(
    int SiteId, string? Name, string? Cidr, string? Description,
    int? ScanIntervalSeconds, int? DeepScanIntervalSeconds);

/// <summary>
/// Body for PUT /api/networks/{id}. Same fields as the create request plus the
/// enable switch, which only exists once the network does.
/// </summary>
/// <param name="SiteId">Required owning site; moving a network between sites is allowed.</param>
/// <param name="Name">Required display name.</param>
/// <param name="Cidr">Required IPv4 address or CIDR block, re-validated on every update.</param>
/// <param name="Description">Optional free-text note.</param>
/// <param name="ScanIntervalSeconds">Quick-profile cadence in seconds; omitted or non-positive leaves the current value alone.</param>
/// <param name="DeepScanIntervalSeconds">Deep-profile cadence in seconds; omitted or non-positive leaves the current value alone.</param>
/// <param name="IsEnabled">Null leaves the current setting; false parks the network without deleting its inventory.</param>
public record NetworkUpdateRequest(
    int SiteId, string? Name, string? Cidr, string? Description,
    int? ScanIntervalSeconds, int? DeepScanIntervalSeconds, bool? IsEnabled);

/// <summary>
/// Body for PUT /api/networks/{id}/profiles/{profileType}. Every field is
/// optional: null means "leave this as it is", so the UI can toggle one switch
/// without echoing back the whole profile.
/// </summary>
/// <param name="NmapArgs">Replacement argument string, 500 chars max. Blank or null keeps the existing arguments.</param>
/// <param name="IntervalSeconds">New cadence in seconds; must be positive to take effect.</param>
/// <param name="IsEnabled">Whether the scheduler should run this profile.</param>
public record ProfileUpdateRequest(string? NmapArgs, int? IntervalSeconds, bool? IsEnabled);

// ── Devices ──────────────────────────────────────────────────────────────────

/// <summary>
/// A device row in the inventory list (GET /api/devices). Site and network names
/// are denormalized in because the list is the most-viewed page in the app and
/// should never fan out to look up its own labels.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="NetworkId">Network the device was discovered on.</param>
/// <param name="NetworkName">That network's display name.</param>
/// <param name="SiteId">Site the network belongs to.</param>
/// <param name="SiteName">That site's display name.</param>
/// <param name="IpAddress">IPv4 address, unique within the network.</param>
/// <param name="MacAddress">Colon-separated MAC. Null when the scan ran off-subnet, since MAC only resolves via ARP.</param>
/// <param name="Hostname">Reverse-DNS or operator-supplied name; null when neither is known.</param>
/// <param name="Vendor">Hardware vendor resolved from the MAC OUI prefix.</param>
/// <param name="OsGuess">Highest-confidence OS fingerprint match; only populated by profiles that run -O.</param>
/// <param name="DeviceType">router, switch, firewall, printer, server, workstation, camera, or unknown.</param>
/// <param name="Status">"new" (first sighting), "online", or "offline".</param>
/// <param name="FirstSeen">UTC timestamp of the first scan that saw this address.</param>
/// <param name="LastSeen">UTC timestamp of the last scan the device actually answered.</param>
/// <param name="OpenPortCount">Ports currently in state "open"; filtered and closed ports are excluded.</param>
/// <param name="IsFlagged">Operator-set marker for follow-up. Purely a UI signal, nothing in the pipeline reads it.</param>
/// <param name="IsExcluded">Excluded devices are passed to nmap's --exclude, never alert, and are left out of every dashboard count.</param>
public record DeviceListItemDto(
    int Id, int NetworkId, string NetworkName, int SiteId, string SiteName,
    string IpAddress, string? MacAddress, string? Hostname, string? Vendor, string? OsGuess,
    string DeviceType, string Status, DateTime FirstSeen, DateTime LastSeen,
    int OpenPortCount, bool IsFlagged, bool IsExcluded);

/// <summary>
/// Everything the device detail page shows (GET /api/devices/{id}): the record
/// itself plus its ports, recent alerts, vulnerabilities, and certificates in one
/// payload rather than four round trips.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="NetworkId">Network the device was discovered on.</param>
/// <param name="NetworkName">That network's display name.</param>
/// <param name="SiteId">Site the network belongs to.</param>
/// <param name="SiteName">That site's display name.</param>
/// <param name="IpAddress">IPv4 address, unique within the network.</param>
/// <param name="MacAddress">Colon-separated MAC; null for off-subnet scans.</param>
/// <param name="Hostname">Reverse-DNS or operator-supplied name.</param>
/// <param name="Vendor">Hardware vendor resolved from the MAC OUI prefix.</param>
/// <param name="OsGuess">Highest-confidence OS fingerprint match.</param>
/// <param name="DeviceType">router, switch, firewall, printer, server, workstation, camera, or unknown.</param>
/// <param name="Status">"new", "online", or "offline".</param>
/// <param name="FirstSeen">UTC timestamp of the first scan that saw this address.</param>
/// <param name="LastSeen">UTC timestamp of the last scan the device answered.</param>
/// <param name="LastScannedAt">UTC timestamp of the last scan that covered the device whether or not it answered. Compare against LastSeen to tell "quiet" from "not looked at".</param>
/// <param name="IsFlagged">Operator-set follow-up marker.</param>
/// <param name="IsExcluded">Excluded from scanning, alerting, and dashboard counts.</param>
/// <param name="Notes">Free-text operator notes; the only unbounded field on the record.</param>
/// <param name="Hardware">Operator-entered hardware description.</param>
/// <param name="PhysicalLocation">Operator-entered location, e.g. rack or room.</param>
/// <param name="AssignedTo">Owning team or purpose.</param>
/// <param name="MissedScans">Consecutive scans the device did not answer. Reaching the configured threshold is what flips it to offline.</param>
/// <param name="Ports">All known ports, port-number ordered, including ones no longer open.</param>
/// <param name="Alerts">The 20 newest alerts for this device; the alerts page holds the full archive.</param>
/// <param name="Vulnerabilities">Matched CVEs, worst CVSS first.</param>
/// <param name="Certificates">TLS certificates seen on this device's ports, with days-to-expiry computed server-side.</param>
public record DeviceDetailDto(
    int Id, int NetworkId, string NetworkName, int SiteId, string SiteName,
    string IpAddress, string? MacAddress, string? Hostname, string? Vendor, string? OsGuess,
    string DeviceType, string Status, DateTime FirstSeen, DateTime LastSeen, DateTime? LastScannedAt,
    bool IsFlagged, bool IsExcluded, string? Notes, string? Hardware, string? PhysicalLocation,
    string? AssignedTo, int MissedScans,
    IReadOnlyList<PortDto> Ports,
    IReadOnlyList<AlertDto> Alerts,
    IReadOnlyList<VulnerabilityDto> Vulnerabilities,
    IReadOnlyList<CertificateDto> Certificates);

/// <summary>One port on a device, as last observed.</summary>
/// <param name="Id">Surrogate key of the port row.</param>
/// <param name="PortNumber">TCP/UDP port, 1-65535.</param>
/// <param name="Protocol">"tcp" or "udp".</param>
/// <param name="State">Nmap port state: open, filtered, or closed. Rows are kept after a port closes so the history stays honest.</param>
/// <param name="ServiceName">Service nmap named on the port, e.g. "https".</param>
/// <param name="ServiceVersion">Product, version, and extra info joined, e.g. "Apache httpd 2.4.52". Only populated by profiles running -sV.</param>
/// <param name="FirstSeen">UTC timestamp the port was first observed open.</param>
/// <param name="LastSeen">UTC timestamp the port was last observed in this state.</param>
public record PortDto(
    int Id, int PortNumber, string Protocol, string State,
    string? ServiceName, string? ServiceVersion, DateTime FirstSeen, DateTime LastSeen);

/// <summary>
/// One point on the device availability/latency chart
/// (GET /api/devices/{id}/history), a single scan's view of the device.
/// </summary>
/// <param name="RecordedAt">UTC time the scan recorded this observation.</param>
/// <param name="Status">What the scan saw: "online" or "offline".</param>
/// <param name="OpenPortCount">Ports open at that moment; a step change here is usually the interesting part.</param>
/// <param name="ResponseTimeMs">Round-trip latency in milliseconds. Null when the scan did not measure it (host down, or a profile that reports no timing).</param>
public record DeviceHistoryPointDto(DateTime RecordedAt, string Status, int OpenPortCount, double? ResponseTimeMs);

/// <summary>
/// The operator-editable subset of a device. Discovery-owned fields (IP, MAC,
/// vendor, status) are deliberately absent; the next scan would overwrite them.
/// Null on any field means "leave it alone"; empty string clears it.
/// </summary>
/// <param name="Hostname">Overrides the discovered name. Note that a later scan with reverse DNS can still replace this.</param>
/// <param name="Hardware">Free-text hardware description.</param>
/// <param name="PhysicalLocation">Free-text location, e.g. rack or room.</param>
/// <param name="AssignedTo">Owning team or purpose.</param>
/// <param name="Notes">Free-text notes; stored verbatim, not trimmed.</param>
/// <param name="IsFlagged">Marks the device for follow-up in the UI.</param>
/// <param name="IsExcluded">True adds the device to nmap's --exclude list and silences its alerts.</param>
/// <param name="DeviceType">Manual re-type. Must be one of the classifier's own values (router, switch, firewall, printer, server, workstation, camera, unknown) or the call is rejected.</param>
public record DeviceUpdateRequest(
    string? Hostname, string? Hardware, string? PhysicalLocation, string? AssignedTo,
    string? Notes, bool? IsFlagged, bool? IsExcluded, string? DeviceType);

// Topology: the site → network → device tree the network-map page renders.

/// <summary>Root of the topology tree returned by GET /api/devices/topology.</summary>
/// <param name="Sites">Sites in site-key order; filtered to one site when the request supplied siteId.</param>
public record TopologyDto(IReadOnlyList<TopologySiteDto> Sites);

/// <summary>A site node in the topology tree.</summary>
/// <param name="Id">Site id, used as the node key by the map component.</param>
/// <param name="Name">Site display name.</param>
/// <param name="Networks">The site's networks in name order.</param>
public record TopologySiteDto(int Id, string Name, IReadOnlyList<TopologyNetworkDto> Networks);

/// <summary>A network node in the topology tree.</summary>
/// <param name="Id">Network id.</param>
/// <param name="Name">Network display name.</param>
/// <param name="Cidr">The range, shown as the node's subtitle.</param>
/// <param name="Devices">Non-excluded devices in IP order. Excluded devices are omitted entirely rather than drawn greyed out.</param>
public record TopologyNetworkDto(int Id, string Name, string Cidr, IReadOnlyList<TopologyDeviceDto> Devices);

/// <summary>
/// A device leaf in the topology tree: deliberately the four fields the map
/// draws and nothing else, since this payload is the whole estate at once.
/// </summary>
/// <param name="Id">Device id, for linking through to the detail page.</param>
/// <param name="Ip">IPv4 address, used as the node label when there is no hostname.</param>
/// <param name="Hostname">Preferred node label when known.</param>
/// <param name="DeviceType">Drives the node icon: router, switch, firewall, printer, server, workstation, camera, unknown.</param>
/// <param name="Status">Drives the node colour: "new", "online", or "offline".</param>
public record TopologyDeviceDto(int Id, string Ip, string? Hostname, string DeviceType, string Status);

// ── Scans ────────────────────────────────────────────────────────────────────

/// <summary>
/// A scan-history row (GET /api/scans), also returned by POST /api/scans/run so
/// the caller sees the finished run in the same shape the list uses.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="NetworkId">Network that was scanned.</param>
/// <param name="NetworkName">That network's display name.</param>
/// <param name="SiteName">Owning site's display name.</param>
/// <param name="ScanType">Profile that ran: quick, deep, security, full_port, or udp.</param>
/// <param name="StartedAt">UTC time the run began.</param>
/// <param name="CompletedAt">UTC time the run finished; null while it is still running.</param>
/// <param name="DurationSeconds">Wall-clock seconds, rounded to one decimal. Computed server-side because TimeSpan arithmetic translates differently per database provider.</param>
/// <param name="HostsUp">Addresses that answered.</param>
/// <param name="HostsDown">Addresses in range that did not answer.</param>
/// <param name="NewDevices">Devices seen for the first time by this run.</param>
/// <param name="Status">"running", "completed", or "failed".</param>
/// <param name="FailureReason">Why a failed run failed. Note that a failed scan still comes back over HTTP 200; the request succeeded even though the scan did not.</param>
public record ScanListItemDto(
    int Id, int NetworkId, string NetworkName, string SiteName, string ScanType,
    DateTime StartedAt, DateTime? CompletedAt, double? DurationSeconds,
    int HostsUp, int HostsDown, int NewDevices, string Status, string? FailureReason);

/// <summary>One scan with its per-device snapshots (GET /api/scans/{id}).</summary>
/// <param name="Id">Surrogate key of the scan.</param>
/// <param name="NetworkId">Network that was scanned.</param>
/// <param name="NetworkName">That network's display name.</param>
/// <param name="SiteName">Owning site's display name.</param>
/// <param name="ScanType">Profile that ran: quick, deep, security, full_port, or udp.</param>
/// <param name="NmapCommand">The exact command line executed, so a result can be reproduced by hand. The raw XML is kept server-side but never returned; it runs to megabytes per row.</param>
/// <param name="StartedAt">UTC time the run began.</param>
/// <param name="CompletedAt">UTC time the run finished; null while still running.</param>
/// <param name="DurationSeconds">Wall-clock seconds, rounded to one decimal.</param>
/// <param name="HostsUp">Addresses that answered.</param>
/// <param name="HostsDown">Addresses in range that did not answer.</param>
/// <param name="NewDevices">Devices seen for the first time by this run.</param>
/// <param name="ExcludedCount">Devices skipped via --exclude, recorded so "hosts up went down" is explainable.</param>
/// <param name="Status">"running", "completed", or "failed".</param>
/// <param name="FailureReason">Why a failed run failed.</param>
/// <param name="Snapshots">Per-device observations from this run, IP-ordered.</param>
public record ScanDetailDto(
    int Id, int NetworkId, string NetworkName, string SiteName, string ScanType, string? NmapCommand,
    DateTime StartedAt, DateTime? CompletedAt, double? DurationSeconds,
    int HostsUp, int HostsDown, int NewDevices, int ExcludedCount, string Status, string? FailureReason,
    IReadOnlyList<ScanSnapshotDto> Snapshots);

/// <summary>What one scan saw of one device, the row that makes scan history reconstructable.</summary>
/// <param name="DeviceId">Device observed; links through to the detail page.</param>
/// <param name="DeviceIp">The device's IPv4 address at the time of the scan.</param>
/// <param name="Hostname">The device's hostname, when known.</param>
/// <param name="Status">What this scan saw: "online" or "offline".</param>
/// <param name="OpenPortCount">Ports open during this scan.</param>
/// <param name="ResponseTimeMs">Round-trip latency in milliseconds; null when unmeasured.</param>
/// <param name="RecordedAt">UTC time the observation was written.</param>
public record ScanSnapshotDto(
    int DeviceId, string DeviceIp, string? Hostname, string Status, int OpenPortCount,
    double? ResponseTimeMs, DateTime RecordedAt);

/// <summary>
/// Body for POST /api/scans/run. The call is synchronous: it returns once nmap
/// has finished, so a full_port run can hold the connection for a long time.
/// </summary>
/// <param name="NetworkId">Network to scan. A network that does not exist returns 404.</param>
/// <param name="ProfileType">Required; must be quick, deep, security, full_port, or udp. Anything else is rejected with the valid list in the message.</param>
public record RunScanRequest(int NetworkId, string? ProfileType);

/// <summary>A built-in profile plus the plain-English "what is this for" the UI shows.</summary>
/// <param name="ProfileType">quick, deep, security, full_port, or udp.</param>
/// <param name="NmapArgs">The default argument string for this profile.</param>
/// <param name="IntervalSeconds">Default cadence in seconds (300 for quick, 3600 for deep, 604800 for the heavy ones).</param>
/// <param name="EnabledByDefault">Whether a newly created network schedules this profile. The three heavy profiles ship off.</param>
/// <param name="Description">Plain-English purpose, so choosing a profile does not require reading nmap's man page.</param>
public record ProfileDefinitionDto(
    string ProfileType, string NmapArgs, int IntervalSeconds, bool EnabledByDefault, string Description);

// ── Alerts ───────────────────────────────────────────────────────────────────

/// <summary>
/// One alert in the feed (GET /api/alerts), and embedded in the device detail
/// response. Device identity is denormalized in because an alert outlives its
/// device: the link is nulled on delete, but the text stays readable.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="DeviceId">Device the alert concerns; null once that device has been deleted.</param>
/// <param name="DeviceIp">The device's IPv4 address, captured for display.</param>
/// <param name="DeviceHostname">The device's hostname, captured for display.</param>
/// <param name="NetworkId">Network context, set even for alerts that are not device-specific.</param>
/// <param name="AlertType">new_device, device_offline, device_online, port_opened, port_closed, cert_expiring, or vulnerability.</param>
/// <param name="Severity">"info", "warning", or "critical"; drives colour and notification routing.</param>
/// <param name="Message">One-line human-readable summary.</param>
/// <param name="Details">Optional longer body, e.g. the specific ports that changed.</param>
/// <param name="IsAcknowledged">True once someone has taken responsibility for it; acknowledged alerts drop out of the default feed.</param>
/// <param name="AcknowledgedBy">Who acknowledged it. Free text; this build has no authentication, so it is a claim, not an identity.</param>
/// <param name="AcknowledgedAt">UTC time of acknowledgement.</param>
/// <param name="CreatedAt">UTC time the scan pipeline raised the alert.</param>
public record AlertDto(
    int Id, int? DeviceId, string? DeviceIp, string? DeviceHostname, int? NetworkId,
    string AlertType, string Severity, string Message, string? Details,
    bool IsAcknowledged, string? AcknowledgedBy, DateTime? AcknowledgedAt, DateTime CreatedAt);

/// <summary>Body for acknowledging a single alert.</summary>
/// <param name="AcknowledgedBy">Name recorded against the acknowledgement. Unverified free text, since this build has no authentication.</param>
public record AcknowledgeRequest(string? AcknowledgedBy);

/// <summary>
/// Body for the bulk acknowledge endpoint, which updates in a single set-based
/// statement rather than tracking thousands of entities.
/// </summary>
/// <param name="Severity">Restricts the sweep to one severity (info, warning, critical). Null acknowledges every open alert, which is the dangerous default the UI confirms first.</param>
/// <param name="AcknowledgedBy">Name recorded against every row the sweep touches.</param>
public record AcknowledgeAllRequest(string? Severity, string? AcknowledgedBy);

// ── Security ─────────────────────────────────────────────────────────────────

/// <summary>
/// A CVE matched against a service found on a device (GET /api/vulnerabilities),
/// also embedded in the device detail response.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="DeviceId">Affected device.</param>
/// <param name="DeviceIp">That device's IPv4 address, denormalized for the list.</param>
/// <param name="DeviceHostname">That device's hostname, when known.</param>
/// <param name="SiteName">Owning site, so security triage can be filtered by location.</param>
/// <param name="CveId">CVE identifier, e.g. "CVE-2021-44228".</param>
/// <param name="CvssScore">CVSS v3 base score, 0.0-10.0. Null when the source gave no score; lists sort worst-first on this.</param>
/// <param name="Severity">critical, high, medium, or low.</param>
/// <param name="Description">Vulnerability summary text.</param>
/// <param name="AffectedService">The service version string that matched, e.g. "OpenSSH 7.4".</param>
/// <param name="PortNumber">Port the affected service was found on; null for host-level findings.</param>
/// <param name="Status">"open", "remediated", or "accepted_risk".</param>
/// <param name="DetectedAt">UTC time the finding was first recorded.</param>
public record VulnerabilityDto(
    int Id, int DeviceId, string DeviceIp, string? DeviceHostname, string SiteName,
    string CveId, double? CvssScore, string Severity, string? Description,
    string? AffectedService, int? PortNumber, string Status, DateTime DetectedAt);

/// <summary>Body for the triage endpoint that moves a finding through its lifecycle.</summary>
/// <param name="Status">Required; one of "open", "remediated", or "accepted_risk".</param>
public record VulnerabilityStatusRequest(string? Status);

/// <summary>
/// A TLS certificate observed on a device port (GET /api/certificates), tracked
/// mainly so nothing expires unnoticed.
/// </summary>
/// <param name="Id">Surrogate key of the certificate row.</param>
/// <param name="DeviceId">Device the certificate was served from.</param>
/// <param name="DeviceIp">That device's IPv4 address.</param>
/// <param name="DeviceHostname">That device's hostname, when known.</param>
/// <param name="SiteName">Owning site.</param>
/// <param name="PortNumber">Port the certificate was served on.</param>
/// <param name="Subject">Certificate subject DN.</param>
/// <param name="Issuer">Certificate issuer DN. Compare with Subject to spot self-signed certs the flag missed.</param>
/// <param name="ValidFrom">Start of the validity window, UTC.</param>
/// <param name="ValidTo">End of the validity window, UTC.</param>
/// <param name="DaysUntilExpiry">Whole days remaining, computed server-side against request time so every client agrees. Negative means already expired; null when ValidTo is unknown.</param>
/// <param name="KeyType">Key algorithm, e.g. "rsa" or "ec".</param>
/// <param name="KeyBits">Key size in bits; small values on an RSA key are the reason this field is surfaced at all.</param>
/// <param name="IsSelfSigned">True when the certificate signs itself, which is normal for appliance management interfaces and alarming almost everywhere else.</param>
/// <param name="DetectedAt">UTC time the certificate was first observed.</param>
public record CertificateDto(
    int Id, int DeviceId, string DeviceIp, string? DeviceHostname, string SiteName, int PortNumber,
    string? Subject, string? Issuer, DateTime? ValidFrom, DateTime? ValidTo, int? DaysUntilExpiry,
    string? KeyType, int? KeyBits, bool IsSelfSigned, DateTime DetectedAt);

// ── SNMP ─────────────────────────────────────────────────────────────────────

/// <summary>
/// An SNMP-polled switch or router with a one-line health rollup
/// (GET /api/snmp/targets), enough to spot a hot device without opening it.
/// </summary>
/// <param name="Id">Surrogate key used in routes.</param>
/// <param name="Name">Display name of the target.</param>
/// <param name="IpAddress">Management IPv4 address polled over SNMP.</param>
/// <param name="Model">Hardware model string, when recorded.</param>
/// <param name="SiteName">Owning site.</param>
/// <param name="InterfaceCount">Interfaces seen in the last 48 hours of polls, not the device's lifetime total.</param>
/// <param name="UpCount">How many of those interfaces last reported ifOperStatus "up".</param>
/// <param name="MaxUtilization">Worst interface utilization on the device, percent 0-100, rounded to one decimal.</param>
/// <param name="LastPolledAt">UTC time of the last successful poll; null when the target has never been polled.</param>
public record SnmpTargetDto(
    int Id, string Name, string IpAddress, string? Model, string SiteName,
    int InterfaceCount, int UpCount, double MaxUtilization, DateTime? LastPolledAt);

/// <summary>
/// The newest snapshot of one interface
/// (GET /api/snmp/targets/{id}/interfaces).
/// </summary>
/// <param name="IfIndex">SNMP ifIndex, the identity of an interface within its device, stable only until the device reboots.</param>
/// <param name="IfName">ifName as reported, e.g. "GigabitEthernet1/0/24".</param>
/// <param name="IfAlias">ifAlias, i.e. whatever description the network team configured. Usually the most useful label on this record.</param>
/// <param name="SpeedBps">Link speed in bits per second, from ifSpeed/ifHighSpeed. It is the denominator for UtilizationPercent, so a wrong value makes utilization meaningless.</param>
/// <param name="OperStatus">ifOperStatus: "up", "down", or "testing".</param>
/// <param name="InOctets">Raw inbound octet counter at poll time. A wrapping or reset counter shows up here as a drop.</param>
/// <param name="OutOctets">Raw outbound octet counter at poll time.</param>
/// <param name="InErrors">Cumulative inbound error counter.</param>
/// <param name="OutErrors">Cumulative outbound error counter.</param>
/// <param name="UtilizationPercent">Percent 0-100, derived from the octet delta against the previous poll and the interface speed.</param>
/// <param name="RecordedAt">UTC time of the poll this snapshot came from.</param>
public record InterfaceDto(
    int IfIndex, string IfName, string? IfAlias, long SpeedBps, string OperStatus,
    long InOctets, long OutOctets, long InErrors, long OutErrors,
    double UtilizationPercent, DateTime RecordedAt);

/// <summary>
/// One plottable line for the utilization chart
/// (GET /api/snmp/targets/{id}/utilization). Grouped server-side so the chart
/// component receives ready-to-draw series instead of a flat snapshot list.
/// </summary>
/// <param name="IfIndex">SNMP ifIndex identifying the interface this series belongs to.</param>
/// <param name="IfName">Interface name, used as the series label.</param>
/// <param name="Points">Samples in chronological order. Gaps are real (a missed poll) and are not filled in.</param>
public record UtilizationSeriesDto(int IfIndex, string IfName, IReadOnlyList<UtilizationPointDto> Points);

/// <summary>A single sample in a utilization series.</summary>
/// <param name="RecordedAt">UTC time of the poll.</param>
/// <param name="UtilizationPercent">Percent 0-100 of the interface's rated speed.</param>
public record UtilizationPointDto(DateTime RecordedAt, double UtilizationPercent);

// ── Settings ─────────────────────────────────────────────────────────────────

/// <summary>
/// One row of the key/value settings table (GET /api/settings). The id is not
/// exposed because callers address settings by key.
/// </summary>
/// <param name="Key">Stable setting name; also the route segment for the update call.</param>
/// <param name="Value">Current value, always stored as a string regardless of how it is interpreted.</param>
/// <param name="Description">What the setting does, rendered as help text next to the field.</param>
/// <param name="UpdatedAt">UTC time the value last changed.</param>
public record AppSettingDto(string Key, string? Value, string? Description, DateTime UpdatedAt);

/// <summary>Body for PUT /api/settings/{key}.</summary>
/// <param name="Value">New value. Null is accepted and stored as null; that is how a setting gets cleared. Unknown keys 404 rather than upsert, so a typo cannot litter the table.</param>
public record SettingUpdateRequest(string? Value);

/// <summary>Environment facts for the About panel (GET /api/settings/system).</summary>
/// <param name="Version">InformationalVersion from the assembly, the human-readable version, not the 1.0.0.0 AssemblyVersion.</param>
/// <param name="NmapAvailable">Whether the configured nmap binary can actually be executed on this host.</param>
/// <param name="NmapVersion">First line of <c>nmap --version</c>; null when unavailable.</param>
/// <param name="SchedulerEnabled">Whether the background scan loop is running. Ships false so a freshly cloned demo never probes whatever network it landed on.</param>
/// <param name="Provider">Live database provider, "sqlite" or "postgres".</param>
/// <param name="DemoMode">True when first-run demo seeding is enabled, i.e. the inventory may be fictional sample data rather than a real estate.</param>
/// <param name="CompanyName">Organisation name shown in headers and in the demo dataset.</param>
public record SystemInfoDto(
    string Version, bool NmapAvailable, string? NmapVersion, bool SchedulerEnabled,
    string Provider, bool DemoMode, string CompanyName);
