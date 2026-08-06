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
    public NetworkMonitorDbContext(DbContextOptions<NetworkMonitorDbContext> options) : base(options) { }

    public DbSet<Site> Sites => Set<Site>();
    public DbSet<Network> Networks => Set<Network>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<Port> Ports => Set<Port>();
    public DbSet<ScanResult> ScanResults => Set<ScanResult>();
    public DbSet<ScanDeviceSnapshot> ScanDeviceSnapshots => Set<ScanDeviceSnapshot>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<ScanProfile> ScanProfiles => Set<ScanProfile>();
    public DbSet<Vulnerability> Vulnerabilities => Set<Vulnerability>();
    public DbSet<SslCertificate> SslCertificates => Set<SslCertificate>();
    public DbSet<SnmpTarget> SnmpTargets => Set<SnmpTarget>();
    public DbSet<InterfaceSnapshot> InterfaceSnapshots => Set<InterfaceSnapshot>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

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
