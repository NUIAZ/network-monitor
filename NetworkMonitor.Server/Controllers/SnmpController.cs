using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// SNMP-polled switch/router interface data for the utilization page. Snapshot
/// volume per target is bounded by the poll interval and retention, so the
/// "latest per interface" rollups are computed in memory; a windowed SQL query
/// would translate differently on SQLite vs PostgreSQL for no practical gain
/// at this scale.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SnmpController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;

    /// <summary>Creates the controller.</summary>
    public SnmpController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>
    /// All targets with a one-line health rollup (interface count, ports up,
    /// worst utilization) so the list page can flag a hot switch at a glance.
    /// </summary>
    [HttpGet("targets")]
    public async Task<ActionResult<IReadOnlyList<SnmpTargetDto>>> GetTargets()
    {
        var targets = await _db.SnmpTargets.AsNoTracking()
            .Include(t => t.Site)
            .OrderBy(t => t.Name)
            .ToListAsync();

        // One query for the recent snapshots of every target beats N queries;
        // the 48h window bounds the in-memory set regardless of retention.
        var since = DateTime.UtcNow.AddHours(-48);
        var snapshots = await _db.InterfaceSnapshots.AsNoTracking()
            .Where(s => s.RecordedAt >= since)
            .ToListAsync();
        var byTarget = snapshots.GroupBy(s => s.SnmpTargetId).ToDictionary(g => g.Key, g => g.ToList());

        return targets.Select(t =>
        {
            var latest = LatestPerInterface(byTarget.TryGetValue(t.Id, out var list) ? list : []);
            return new SnmpTargetDto(
                t.Id, t.Name, t.IpAddress, t.Model, t.Site?.Name ?? "",
                latest.Count,
                latest.Count(s => s.OperStatus == "up"),
                latest.Count > 0 ? Math.Round(latest.Max(s => s.UtilizationPercent), 1) : 0,
                t.LastPolledAt);
        }).ToList();
    }

    /// <summary>The most recent snapshot of every interface on one target.</summary>
    [HttpGet("targets/{id:int}/interfaces")]
    public async Task<ActionResult<IReadOnlyList<InterfaceDto>>> GetInterfaces(int id)
    {
        if (!await _db.SnmpTargets.AnyAsync(t => t.Id == id)) return NotFound();

        var snapshots = await _db.InterfaceSnapshots.AsNoTracking()
            .Where(s => s.SnmpTargetId == id)
            .ToListAsync();

        return LatestPerInterface(snapshots)
            .OrderBy(s => s.IfIndex)
            .Select(s => new InterfaceDto(
                s.IfIndex, s.IfName, s.IfAlias, s.SpeedBps, s.OperStatus,
                s.InOctets, s.OutOctets, s.InErrors, s.OutErrors,
                s.UtilizationPercent, s.RecordedAt))
            .ToList();
    }

    /// <summary>
    /// Utilization time series per interface for charting. Grouped server-side
    /// so the chart component receives one ready-to-plot series per line.
    /// </summary>
    [HttpGet("targets/{id:int}/utilization")]
    public async Task<ActionResult<IReadOnlyList<UtilizationSeriesDto>>> GetUtilization(int id, [FromQuery] int hours = 24)
    {
        hours = Math.Clamp(hours, 1, 168);
        if (!await _db.SnmpTargets.AnyAsync(t => t.Id == id)) return NotFound();

        var since = DateTime.UtcNow.AddHours(-hours);
        var snapshots = await _db.InterfaceSnapshots.AsNoTracking()
            .Where(s => s.SnmpTargetId == id && s.RecordedAt >= since)
            .OrderBy(s => s.RecordedAt)
            .Select(s => new { s.IfIndex, s.IfName, s.RecordedAt, s.UtilizationPercent })
            .ToListAsync();

        return snapshots
            .GroupBy(s => new { s.IfIndex, s.IfName })
            .OrderBy(g => g.Key.IfIndex)
            .Select(g => new UtilizationSeriesDto(
                g.Key.IfIndex, g.Key.IfName,
                g.Select(s => new UtilizationPointDto(s.RecordedAt, s.UtilizationPercent)).ToList()))
            .ToList();
    }

    /// <summary>Reduces a snapshot list to the newest row per interface index.</summary>
    private static List<InterfaceSnapshot> LatestPerInterface(IEnumerable<InterfaceSnapshot> snapshots) =>
        snapshots
            .GroupBy(s => s.IfIndex)
            .Select(g => g.OrderByDescending(s => s.RecordedAt).First())
            .ToList();
}
