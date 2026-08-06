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

public record DashboardSummaryDto(
    int TotalDevices, int OnlineDevices, int OfflineDevices, int NewDevices24h,
    int OpenAlerts, int CriticalAlerts, int Sites, int Networks, DateTime? LastScanAt,
    int OpenVulnerabilities, int CriticalVulnerabilities, int ExpiringCerts,
    bool NmapAvailable, string? NmapVersion);

public record DeviceTypeCountDto(string DeviceType, int Count);

/// <summary>One day of scan activity. Date is "yyyy-MM-dd" so charts sort lexically.</summary>
public record ScanActivityPointDto(string Date, int Scans, int HostsUp, int NewDevices);

public record AlertTrendPointDto(string Date, int Info, int Warning, int Critical);

// ── Sites ────────────────────────────────────────────────────────────────────

public record SiteDto(
    int Id, string SiteKey, string Name, string? City, string? State,
    double? Latitude, double? Longitude, DateTime CreatedAt, int NetworkCount, int DeviceCount);

public record SiteDetailDto(
    int Id, string SiteKey, string Name, string? City, string? State,
    double? Latitude, double? Longitude, DateTime CreatedAt, IReadOnlyList<NetworkDto> Networks);

public record SiteUpsertRequest(
    string? SiteKey, string? Name, string? City, string? State, double? Latitude, double? Longitude);

// ── Networks ─────────────────────────────────────────────────────────────────

public record NetworkDto(
    int Id, int SiteId, string SiteName, string Name, string Cidr, string? Description,
    int ScanIntervalSeconds, int DeepScanIntervalSeconds, bool IsEnabled,
    int DeviceCount, DateTime? LastScanAt, DateTime CreatedAt);

public record NetworkDetailDto(
    int Id, int SiteId, string SiteName, string Name, string Cidr, string? Description,
    int ScanIntervalSeconds, int DeepScanIntervalSeconds, bool IsEnabled,
    int DeviceCount, DateTime? LastScanAt, DateTime CreatedAt, IReadOnlyList<ScanProfileDto> Profiles);

public record ScanProfileDto(
    int Id, string ProfileType, string NmapArgs, int IntervalSeconds, bool IsEnabled, DateTime? LastRunAt);

public record NetworkCreateRequest(
    int SiteId, string? Name, string? Cidr, string? Description,
    int? ScanIntervalSeconds, int? DeepScanIntervalSeconds);

public record NetworkUpdateRequest(
    int SiteId, string? Name, string? Cidr, string? Description,
    int? ScanIntervalSeconds, int? DeepScanIntervalSeconds, bool? IsEnabled);

public record ProfileUpdateRequest(string? NmapArgs, int? IntervalSeconds, bool? IsEnabled);

// ── Devices ──────────────────────────────────────────────────────────────────

public record DeviceListItemDto(
    int Id, int NetworkId, string NetworkName, int SiteId, string SiteName,
    string IpAddress, string? MacAddress, string? Hostname, string? Vendor, string? OsGuess,
    string DeviceType, string Status, DateTime FirstSeen, DateTime LastSeen,
    int OpenPortCount, bool IsFlagged, bool IsExcluded);

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

public record PortDto(
    int Id, int PortNumber, string Protocol, string State,
    string? ServiceName, string? ServiceVersion, DateTime FirstSeen, DateTime LastSeen);

public record DeviceHistoryPointDto(DateTime RecordedAt, string Status, int OpenPortCount, double? ResponseTimeMs);

/// <summary>
/// The operator-editable subset of a device. Discovery-owned fields (IP, MAC,
/// vendor, status) are deliberately absent — the next scan would overwrite them.
/// </summary>
public record DeviceUpdateRequest(
    string? Hostname, string? Hardware, string? PhysicalLocation, string? AssignedTo,
    string? Notes, bool? IsFlagged, bool? IsExcluded, string? DeviceType);

// Topology: the site → network → device tree the network-map page renders.
public record TopologyDto(IReadOnlyList<TopologySiteDto> Sites);
public record TopologySiteDto(int Id, string Name, IReadOnlyList<TopologyNetworkDto> Networks);
public record TopologyNetworkDto(int Id, string Name, string Cidr, IReadOnlyList<TopologyDeviceDto> Devices);
public record TopologyDeviceDto(int Id, string Ip, string? Hostname, string DeviceType, string Status);

// ── Scans ────────────────────────────────────────────────────────────────────

public record ScanListItemDto(
    int Id, int NetworkId, string NetworkName, string SiteName, string ScanType,
    DateTime StartedAt, DateTime? CompletedAt, double? DurationSeconds,
    int HostsUp, int HostsDown, int NewDevices, string Status, string? FailureReason);

public record ScanDetailDto(
    int Id, int NetworkId, string NetworkName, string SiteName, string ScanType, string? NmapCommand,
    DateTime StartedAt, DateTime? CompletedAt, double? DurationSeconds,
    int HostsUp, int HostsDown, int NewDevices, int ExcludedCount, string Status, string? FailureReason,
    IReadOnlyList<ScanSnapshotDto> Snapshots);

public record ScanSnapshotDto(
    int DeviceId, string DeviceIp, string? Hostname, string Status, int OpenPortCount,
    double? ResponseTimeMs, DateTime RecordedAt);

public record RunScanRequest(int NetworkId, string? ProfileType);

/// <summary>A built-in profile plus the plain-English "what is this for" the UI shows.</summary>
public record ProfileDefinitionDto(
    string ProfileType, string NmapArgs, int IntervalSeconds, bool EnabledByDefault, string Description);

// ── Alerts ───────────────────────────────────────────────────────────────────

public record AlertDto(
    int Id, int? DeviceId, string? DeviceIp, string? DeviceHostname, int? NetworkId,
    string AlertType, string Severity, string Message, string? Details,
    bool IsAcknowledged, string? AcknowledgedBy, DateTime? AcknowledgedAt, DateTime CreatedAt);

public record AcknowledgeRequest(string? AcknowledgedBy);

public record AcknowledgeAllRequest(string? Severity, string? AcknowledgedBy);

// ── Security ─────────────────────────────────────────────────────────────────

public record VulnerabilityDto(
    int Id, int DeviceId, string DeviceIp, string? DeviceHostname, string SiteName,
    string CveId, double? CvssScore, string Severity, string? Description,
    string? AffectedService, int? PortNumber, string Status, DateTime DetectedAt);

public record VulnerabilityStatusRequest(string? Status);

public record CertificateDto(
    int Id, int DeviceId, string DeviceIp, string? DeviceHostname, string SiteName, int PortNumber,
    string? Subject, string? Issuer, DateTime? ValidFrom, DateTime? ValidTo, int? DaysUntilExpiry,
    string? KeyType, int? KeyBits, bool IsSelfSigned, DateTime DetectedAt);

// ── SNMP ─────────────────────────────────────────────────────────────────────

public record SnmpTargetDto(
    int Id, string Name, string IpAddress, string? Model, string SiteName,
    int InterfaceCount, int UpCount, double MaxUtilization, DateTime? LastPolledAt);

public record InterfaceDto(
    int IfIndex, string IfName, string? IfAlias, long SpeedBps, string OperStatus,
    long InOctets, long OutOctets, long InErrors, long OutErrors,
    double UtilizationPercent, DateTime RecordedAt);

public record UtilizationSeriesDto(int IfIndex, string IfName, IReadOnlyList<UtilizationPointDto> Points);

public record UtilizationPointDto(DateTime RecordedAt, double UtilizationPercent);

// ── Settings ─────────────────────────────────────────────────────────────────

public record AppSettingDto(string Key, string? Value, string? Description, DateTime UpdatedAt);

public record SettingUpdateRequest(string? Value);

public record SystemInfoDto(
    string Version, bool NmapAvailable, string? NmapVersion, bool SchedulerEnabled,
    string Provider, bool DemoMode, string CompanyName);
