using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// Aggregate numbers for the landing page. Everything here is derived; the
/// dashboard owns no state of its own, it just counts what the rest of the
/// system recorded, so it can never disagree with the detail pages.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DashboardController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;
    private readonly INmapExecutorService _nmap;
    private readonly AlertOptions _alertOptions;

    /// <summary>Creates the controller.</summary>
    /// <param name="db">Everything on this page is counted straight out of this context; the dashboard caches nothing.</param>
    /// <param name="nmap">Queried per request so the "install nmap" banner reflects the host as it is now, not as it was at startup.</param>
    /// <param name="alertOptions">Supplies the certificate expiry warning window used for the expiring-certs tile.</param>
    public DashboardController(NetworkMonitorDbContext db, INmapExecutorService nmap, IOptions<AlertOptions> alertOptions)
    {
        _db = db;
        _nmap = nmap;
        _alertOptions = alertOptions.Value;
    }

    /// <summary>
    /// Headline counters plus nmap availability, so the very first screen can
    /// tell a new user "install nmap" instead of showing scans that silently fail.
    /// </summary>
    [HttpGet("summary")]
    public async Task<ActionResult<DashboardSummaryDto>> GetSummary()
    {
        var now = DateTime.UtcNow;
        var certHorizon = now.AddDays(_alertOptions.CertExpiryWarningDays);
        var devices = _db.Devices.AsNoTracking().Where(d => !d.IsExcluded);

        var nmapAvailable = _nmap.IsNmapAvailable(out var nmapVersion);

        return new DashboardSummaryDto(
            TotalDevices: await devices.CountAsync(),
            OnlineDevices: await devices.CountAsync(d => d.Status == "online"),
            OfflineDevices: await devices.CountAsync(d => d.Status == "offline"),
            NewDevices24h: await devices.CountAsync(d => d.FirstSeen >= now.AddDays(-1)),
            OpenAlerts: await _db.Alerts.AsNoTracking().CountAsync(a => !a.IsAcknowledged),
            CriticalAlerts: await _db.Alerts.AsNoTracking().CountAsync(a => !a.IsAcknowledged && a.Severity == "critical"),
            Sites: await _db.Sites.AsNoTracking().CountAsync(),
            Networks: await _db.Networks.AsNoTracking().CountAsync(),
            LastScanAt: await _db.ScanResults.AsNoTracking().MaxAsync(s => (DateTime?)s.StartedAt),
            OpenVulnerabilities: await _db.Vulnerabilities.AsNoTracking().CountAsync(v => v.Status == "open"),
            CriticalVulnerabilities: await _db.Vulnerabilities.AsNoTracking().CountAsync(v => v.Status == "open" && v.Severity == "critical"),
            // "Expiring" includes already-expired: an expired cert is the most
            // urgent member of the set, not a separate category.
            ExpiringCerts: await _db.SslCertificates.AsNoTracking().CountAsync(c => c.ValidTo != null && c.ValidTo <= certHorizon),
            NmapAvailable: nmapAvailable,
            NmapVersion: nmapVersion);
    }

    /// <summary>Device counts by classified type, for the inventory donut chart.</summary>
    [HttpGet("device-types")]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeCountDto>>> GetDeviceTypes()
    {
        var counts = await _db.Devices.AsNoTracking()
            .Where(d => !d.IsExcluded)
            .GroupBy(d => d.DeviceType)
            .Select(g => new DeviceTypeCountDto(g.Key, g.Count()))
            .ToListAsync();

        return counts.OrderByDescending(c => c.Count).ToList();
    }

    /// <summary>
    /// Scans per day for the activity chart. Days with no scans are filled with
    /// zeros server-side so the chart's x-axis is continuous without the client
    /// having to reconstruct the calendar.
    /// </summary>
    [HttpGet("scan-activity")]
    public async Task<ActionResult<IReadOnlyList<ScanActivityPointDto>>> GetScanActivity([FromQuery] int days = 14)
    {
        days = Math.Clamp(days, 1, 90);
        var start = DateTime.UtcNow.Date.AddDays(-(days - 1));

        // Group in memory: date-truncation inside a GroupBy translates
        // differently per provider, and the window is small by construction.
        var rows = await _db.ScanResults.AsNoTracking()
            .Where(s => s.StartedAt >= start)
            .Select(s => new { s.StartedAt, s.HostsUp, s.NewDevices })
            .ToListAsync();

        var byDay = rows.GroupBy(r => r.StartedAt.Date)
            .ToDictionary(g => g.Key, g => g);

        return Enumerable.Range(0, days)
            .Select(i =>
            {
                var day = start.AddDays(i);
                var scans = byDay.TryGetValue(day, out var g) ? g.ToList() : [];
                return new ScanActivityPointDto(
                    day.ToString("yyyy-MM-dd"),
                    scans.Count,
                    // Peak, not sum: summing host counts across six scans of the
                    // same network would sextuple-count every device.
                    scans.Count > 0 ? scans.Max(s => s.HostsUp) : 0,
                    scans.Sum(s => s.NewDevices));
            })
            .ToList();
    }

    /// <summary>Alerts raised per day split by severity, zero-filled like scan-activity.</summary>
    [HttpGet("alert-trend")]
    public async Task<ActionResult<IReadOnlyList<AlertTrendPointDto>>> GetAlertTrend([FromQuery] int days = 14)
    {
        days = Math.Clamp(days, 1, 90);
        var start = DateTime.UtcNow.Date.AddDays(-(days - 1));

        var rows = await _db.Alerts.AsNoTracking()
            .Where(a => a.CreatedAt >= start)
            .Select(a => new { a.CreatedAt, a.Severity })
            .ToListAsync();

        var byDay = rows.GroupBy(r => r.CreatedAt.Date)
            .ToDictionary(g => g.Key, g => g.ToList());

        return Enumerable.Range(0, days)
            .Select(i =>
            {
                var day = start.AddDays(i);
                var alerts = byDay.TryGetValue(day, out var list) ? list : [];
                return new AlertTrendPointDto(
                    day.ToString("yyyy-MM-dd"),
                    alerts.Count(a => a.Severity == "info"),
                    alerts.Count(a => a.Severity == "warning"),
                    alerts.Count(a => a.Severity == "critical"));
            })
            .ToList();
    }
}
