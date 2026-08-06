using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// CVE findings from security scans. The only mutation is the triage status —
/// findings themselves come from the scan pipeline, and "remediated" rows are
/// kept rather than deleted so the security page can show progress over time.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class VulnerabilitiesController : ControllerBase
{
    private static readonly HashSet<string> ValidStatuses = ["open", "remediated", "accepted_risk"];

    private readonly NetworkMonitorDbContext _db;

    /// <summary>Creates the controller.</summary>
    public VulnerabilitiesController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>Paged findings, highest CVSS first — triage order is the default order.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<VulnerabilityDto>>> GetAll(
        [FromQuery] string? severity, [FromQuery] string? status, [FromQuery] int? siteId,
        [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        (page, pageSize) = Paging.Clamp(page, pageSize);

        var query = _db.Vulnerabilities.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(severity)) query = query.Where(v => v.Severity == severity);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(v => v.Status == status);
        if (siteId.HasValue) query = query.Where(v => v.Device!.Network!.SiteId == siteId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(v =>
                v.CveId.Contains(term) ||
                (v.Description != null && v.Description.Contains(term)) ||
                (v.AffectedService != null && v.AffectedService.Contains(term)) ||
                v.Device!.IpAddress.Contains(term) ||
                (v.Device!.Hostname != null && v.Device!.Hostname.Contains(term)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(v => v.CvssScore).ThenByDescending(v => v.DetectedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(v => new VulnerabilityDto(
                v.Id, v.DeviceId, v.Device!.IpAddress, v.Device!.Hostname, v.Device!.Network!.Site!.Name,
                v.CveId, v.CvssScore, v.Severity, v.Description, v.AffectedService,
                v.PortNumber, v.Status, v.DetectedAt))
            .ToListAsync();

        return PagedResult<VulnerabilityDto>.Create(items, page, pageSize, total);
    }

    /// <summary>Moves a finding through triage: open → remediated / accepted_risk (and back).</summary>
    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<VulnerabilityDto>> UpdateStatus(int id, [FromBody] VulnerabilityStatusRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Status) || !ValidStatuses.Contains(request.Status))
            return BadRequest(new { message = $"status must be one of: {string.Join(", ", ValidStatuses)}." });

        var vuln = await _db.Vulnerabilities
            .Include(v => v.Device!).ThenInclude(d => d.Network!).ThenInclude(n => n.Site)
            .FirstOrDefaultAsync(v => v.Id == id);
        if (vuln is null) return NotFound();

        vuln.Status = request.Status;
        await _db.SaveChangesAsync();

        return new VulnerabilityDto(
            vuln.Id, vuln.DeviceId, vuln.Device!.IpAddress, vuln.Device!.Hostname,
            vuln.Device!.Network!.Site!.Name, vuln.CveId, vuln.CvssScore, vuln.Severity,
            vuln.Description, vuln.AffectedService, vuln.PortNumber, vuln.Status, vuln.DetectedAt);
    }
}
