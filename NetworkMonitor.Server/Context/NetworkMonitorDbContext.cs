using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Context;

/// <summary>
/// EF Core context for the whole application. Defaults to SQLite so the demo
/// runs with no database server at all; point the connection string at
/// PostgreSQL (see INSTALL.md) for a real deployment — the model is provider
/// agnostic, with snake_case table and column names applied via attributes.
/// </summary>
public class NetworkMonitorDbContext : DbContext
{
    /// <summary>Standard EF constructor; the provider and connection string are chosen in Program.cs.</summary>
    /// <param name="options">Carries the configured provider, so nothing in this class needs to know whether it is talking to SQLite or PostgreSQL.</param>
    public NetworkMonitorDbContext(DbContextOptions<NetworkMonitorDbContext> options) : base(options) { }

    /// <summary>Facilities that own networks — the top of the inventory hierarchy.</summary>
    public DbSet<Site> Sites => Set<Site>();

    /// <summary>Scannable IP ranges, each with its own cadence and scan profiles.</summary>
    public DbSet<Network> Networks => Set<Network>();

    /// <summary>Everything discovery has ever found, one row per IP per network.</summary>
    public DbSet<Device> Devices => Set<Device>();

    /// <summary>Ports observed on devices, including ones that have since closed — a closed port is a fact worth keeping.</summary>
    public DbSet<Port> Ports => Set<Port>();

    /// <summary>The scan evidence trail: one row per run, including failures and the raw XML.</summary>
    public DbSet<ScanResult> ScanResults => Set<ScanResult>();

    /// <summary>Per-device observations from each scan; the raw material behind every history chart.</summary>
    public DbSet<ScanDeviceSnapshot> ScanDeviceSnapshots => Set<ScanDeviceSnapshot>();

    /// <summary>The alert feed. Rows are raised by the scan pipeline only, never created by hand.</summary>
    public DbSet<Alert> Alerts => Set<Alert>();

    /// <summary>Per-network scan configuration — five rows per network, one per profile type.</summary>
    public DbSet<ScanProfile> ScanProfiles => Set<ScanProfile>();

    /// <summary>CVEs matched against discovered service versions, with their triage status.</summary>
    public DbSet<Vulnerability> Vulnerabilities => Set<Vulnerability>();

    /// <summary>TLS certificates seen on open ports, tracked so none expires unnoticed.</summary>
    public DbSet<SslCertificate> SslCertificates => Set<SslCertificate>();

    /// <summary>Switches and routers polled over SNMP. Note these hang off sites, not networks.</summary>
    public DbSet<SnmpTarget> SnmpTargets => Set<SnmpTarget>();

    /// <summary>Interface counters and utilization from each SNMP poll; the highest-volume table here.</summary>
    public DbSet<InterfaceSnapshot> InterfaceSnapshots => Set<InterfaceSnapshot>();

    /// <summary>Key/value application settings shown on the Settings page.</summary>
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    /// <summary>Errors from both tiers, surfaced in the Error Logs page. Written by the logging sink and the exception middleware, never by feature code.</summary>
    public DbSet<ExceptionLog> ExceptionLogs => Set<ExceptionLog>();

    /// <summary>
    /// Declares the constraints and indexes the attributes on the entities cannot
    /// express: composite uniqueness, the query-shape indexes every list page
    /// depends on, and the cascade rules.
    /// </summary>
    /// <param name="b">Model builder; named <c>b</c> because it appears on almost every line below.</param>
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        // ── Uniqueness ────────────────────────────────────────────────────────
        // One row per IP per network: a rescan updates the device rather than
        // inserting a duplicate. This constraint is what makes the change
        // detector's "find existing by IP" lookup safe.
        b.Entity<Device>()
            .HasIndex(d => new { d.NetworkId, d.IpAddress })
            .IsUnique()
            .HasDatabaseName("uq_devices_network_ip");

        b.Entity<Site>()
            .HasIndex(s => s.SiteKey)
            .IsUnique()
            .HasDatabaseName("uq_sites_site_key");

        b.Entity<Port>()
            .HasIndex(p => new { p.DeviceId, p.PortNumber, p.Protocol })
            .IsUnique()
            .HasDatabaseName("uq_ports_device_port_proto");

        b.Entity<AppSetting>()
            .HasIndex(s => s.Key)
            .IsUnique()
            .HasDatabaseName("uq_app_settings_key");

        // ── Query-shape indexes ───────────────────────────────────────────────
        // Every list page filters or sorts on these; without them the demo is
        // fine but a real 50k-device estate is not.
        b.Entity<Device>().HasIndex(d => d.Status).HasDatabaseName("ix_devices_status");
        b.Entity<Alert>().HasIndex(a => new { a.IsAcknowledged, a.CreatedAt }).HasDatabaseName("ix_alerts_ack_created");
        b.Entity<ScanResult>().HasIndex(s => new { s.NetworkId, s.StartedAt }).HasDatabaseName("ix_scans_network_started");
        b.Entity<ScanDeviceSnapshot>().HasIndex(s => new { s.DeviceId, s.RecordedAt }).HasDatabaseName("ix_snapshots_device_recorded");
        b.Entity<Vulnerability>().HasIndex(v => new { v.Status, v.Severity }).HasDatabaseName("ix_vulns_status_severity");
        b.Entity<InterfaceSnapshot>().HasIndex(i => new { i.SnmpTargetId, i.RecordedAt }).HasDatabaseName("ix_ifsnap_target_recorded");

        // The error log is queried newest-first and filtered by tier, which is
        // exactly the shape this index serves. It also grows fastest of any
        // table when something is misbehaving — precisely when someone is
        // trying to read it.
        b.Entity<ExceptionLog>().HasIndex(e => e.OccurredAt).HasDatabaseName("ix_exception_logs_occurred");
        b.Entity<ExceptionLog>().HasIndex(e => new { e.Source, e.Level }).HasDatabaseName("ix_exception_logs_source_level");

        // ── Delete behaviour ──────────────────────────────────────────────────
        // Removing a network should take its devices and scan history with it;
        // alerts keep a nullable device link so history survives device cleanup.
        b.Entity<Device>()
            .HasOne(d => d.Network).WithMany(n => n.Devices)
            .HasForeignKey(d => d.NetworkId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<Port>()
            .HasOne(p => p.Device).WithMany(d => d.Ports)
            .HasForeignKey(p => p.DeviceId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<ScanDeviceSnapshot>()
            .HasOne(s => s.ScanResult).WithMany(r => r.Snapshots)
            .HasForeignKey(s => s.ScanResultId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<ScanDeviceSnapshot>()
            .HasOne(s => s.Device).WithMany(d => d.Snapshots)
            .HasForeignKey(s => s.DeviceId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<Alert>()
            .HasOne(a => a.Device).WithMany(d => d.Alerts)
            .HasForeignKey(a => a.DeviceId).OnDelete(DeleteBehavior.SetNull);

        b.Entity<Vulnerability>()
            .HasOne(v => v.Device).WithMany()
            .HasForeignKey(v => v.DeviceId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<SslCertificate>()
            .HasOne(c => c.Device).WithMany()
            .HasForeignKey(c => c.DeviceId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<InterfaceSnapshot>()
            .HasOne(i => i.SnmpTarget).WithMany(t => t.Interfaces)
            .HasForeignKey(i => i.SnmpTargetId).OnDelete(DeleteBehavior.Cascade);
    }
}
