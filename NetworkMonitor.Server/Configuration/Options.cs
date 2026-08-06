namespace NetworkMonitor.Server.Configuration;

/// <summary>Scan execution and scheduling settings, bound from the "Scanning" section.</summary>
public class ScanningOptions
{
    public const string SectionName = "Scanning";

    /// <summary>Path to the nmap binary. Empty means "find nmap on PATH".</summary>
    public string NmapPath { get; set; } = "";

    /// <summary>Where scan XML is written. Empty means the system temp directory.</summary>
    public string TempDirectory { get; set; } = "";

    /// <summary>
    /// Master switch for the background scan loop. Note that appsettings.json
    /// ships this as <c>false</c>: a freshly cloned demo must never start
    /// probing whatever network it happens to land on. Turn it on deliberately,
    /// once the configured networks are ones you are authorized to scan.
    /// </summary>
    public bool SchedulerEnabled { get; set; } = true;

    /// <summary>How often the scheduler looks for profiles that are due.</summary>
    public int SchedulerTickSeconds { get; set; } = 60;

    /// <summary>
    /// Refuse targets larger than this many addresses. A mistyped /8 is 16.7M
    /// hosts and will take days; the guard is cheaper than the incident.
    /// </summary>
    public long MaxTargetAddresses { get; set; } = 65536;
}

/// <summary>Alerting thresholds, bound from the "Alerts" section.</summary>
public class AlertOptions
{
    public const string SectionName = "Alerts";

    /// <summary>
    /// Consecutive missed scans before a device is declared offline. Above 1 so
    /// a single dropped probe does not page anyone.
    /// </summary>
    public int OfflineAfterMissedScans { get; set; } = 3;

    /// <summary>Warn this many days before a TLS certificate expires.</summary>
    public int CertExpiryWarningDays { get; set; } = 30;

    /// <summary>Interface utilization percent that counts as saturated.</summary>
    public double InterfaceSaturationPercent { get; set; } = 85;
}

/// <summary>Demo-data settings, bound from the "Demo" section.</summary>
public class DemoOptions
{
    public const string SectionName = "Demo";

    /// <summary>
    /// Seed the fictional sample estate on first run when the database is empty.
    /// Turn this off for a real deployment so you start with a clean inventory.
    /// </summary>
    public bool SeedOnFirstRun { get; set; } = true;

    /// <summary>Company name shown in the demo dataset and page headers.</summary>
    public string CompanyName { get; set; } = "Northwind Logistics";
}
