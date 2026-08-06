using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// The alert feed. Acknowledging is the only mutation that matters here —
/// alerts are raised by the scan pipeline, never created by hand, so this
/// controller is read + acknowledge + delete and nothing else.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class AlertsController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;

    public AlertsController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>Paged alert feed, newest first, with the usual triage filters.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<AlertDto>>> GetAll(
        [FromQuery] string? severity, [FromQuery] string? alertType, [FromQuery] bool? acknowledged,
        [FromQuery] int? siteId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        (page, pageSize) = Paging.Clamp(page, pageSize);

        var query = _db.Alerts.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(severity)) query = query.Where(a => a.Severity == severity);
        if (!string.IsNullOrWhiteSpace(alertType)) query = query.Where(a => a.AlertType == alertType);
        if (acknowledged.HasValue) query = query.Where(a => a.IsAcknowledged == acknowledged);
        // Alerts carry no site directly; resolve through the network so alerts
        // whose device was deleted still filter correctly.
        if (siteId.HasValue)
            query = query.Where(a => a.NetworkId != null &&
                _db.Networks.Any(n => n.Id == a.NetworkId && n.SiteId == siteId));

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new AlertDto(
                a.Id, a.DeviceId,
                a.Device != null ? a.Device.IpAddress : null,
                a.Device != null ? a.Device.Hostname : null,
                a.NetworkId, a.AlertType, a.Severity, a.Message, a.Details,
                a.IsAcknowledged, a.AcknowledgedBy, a.AcknowledgedAt, a.CreatedAt))
            .ToListAsync();

        return PagedResult<AlertDto>.Create(items, page, pageSize, total);
    }

    /// <summary>
    /// Acknowledges one alert. Idempotent by design: re-acknowledging keeps the
    /// original who/when, so the first responder stays on record.
    /// </summary>
    [HttpPost("{id:int}/acknowledge")]
    public async Task<ActionResult<AlertDto>> Acknowledge(int id, [FromBody] AcknowledgeRequest request)
    {
        var alert = await _db.Alerts.Include(a => a.Device).FirstOrDefaultAsync(a => a.Id == id);
        if (alert is null) return NotFound();

        if (!alert.IsAcknowledged)
        {
            alert.IsAcknowledged = true;
            alert.AcknowledgedBy = string.IsNullOrWhiteSpace(request.AcknowledgedBy) ? "operator" : request.AcknowledgedBy.Trim();
            alert.AcknowledgedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return new AlertDto(
            alert.Id, alert.DeviceId, alert.Device?.IpAddress, alert.Device?.Hostname,
            alert.NetworkId, alert.AlertType, alert.Severity, alert.Message, alert.Details,
            alert.IsAcknowledged, alert.AcknowledgedBy, alert.AcknowledgedAt, alert.CreatedAt);
    }

    /// <summary>
    /// Bulk-acknowledges open alerts, optionally one severity only ("clear all
    /// the info noise but leave the criticals"). Returns how many were affected.
    /// </summary>
    [HttpPost("acknowledge-all")]
    public async Task<ActionResult<object>> AcknowledgeAll([FromBody] AcknowledgeAllRequest request)
    {
        var who = string.IsNullOrWhiteSpace(request.AcknowledgedBy) ? "operator" : request.AcknowledgedBy.Trim();
        var now = DateTime.UtcNow;

        var query = _db.Alerts.Where(a => !a.IsAcknowledged);
        if (!string.IsNullOrWhiteSpace(request.Severity))
            query = query.Where(a => a.Severity == request.Severity);

        // Set-based update: acknowledging thousands of rows one tracked entity
        // at a time is the kind of thing that times out at exactly the wrong moment.
        var acknowledged = await query.ExecuteUpdateAsync(s => s
            .SetProperty(a => a.IsAcknowledged, true)
            .SetProperty(a => a.AcknowledgedBy, who)
            .SetProperty(a => a.AcknowledgedAt, now));

        return new { acknowledged };
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var alert = await _db.Alerts.FindAsync(id);
        if (alert is null) return NotFound();

        _db.Alerts.Remove(alert);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
