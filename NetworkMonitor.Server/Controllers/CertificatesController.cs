using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// TLS certificates observed by security scans. Read-only: certificates are
/// facts about the network, not records anyone should edit. The whole page
/// exists to answer one question: "what expires next?", so the default sort
/// is soonest-expiry-first.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class CertificatesController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;

    /// <summary>Creates the controller.</summary>
    public CertificatesController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>
    /// Paged certificate list. <paramref name="expiringWithinDays"/> keeps
    /// already-expired certificates in the result on purpose; filtering them
    /// out would hide exactly the rows that most need attention.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<CertificateDto>>> GetAll(
        [FromQuery] int? expiringWithinDays, [FromQuery] int? siteId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        (page, pageSize) = Paging.Clamp(page, pageSize);
        if (expiringWithinDays is < 0)
            return BadRequest(new { message = "expiringWithinDays must be zero or greater." });

        var now = DateTime.UtcNow;
        var query = _db.SslCertificates.AsNoTracking().AsQueryable();
        if (siteId.HasValue) query = query.Where(c => c.Device!.Network!.SiteId == siteId);
        if (expiringWithinDays.HasValue)
        {
            var horizon = now.AddDays(expiringWithinDays.Value);
            query = query.Where(c => c.ValidTo != null && c.ValidTo <= horizon);
        }

        var total = await query.CountAsync();

        // Slim projection first, DaysUntilExpiry computed in memory: date math
        // in the projection translates differently per provider, and clamping
        // pageSize keeps this loop trivially small.
        var rows = await query
            .OrderBy(c => c.ValidTo == null).ThenBy(c => c.ValidTo)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new
            {
                c.Id, c.DeviceId, DeviceIp = c.Device!.IpAddress, DeviceHostname = c.Device!.Hostname,
                SiteName = c.Device!.Network!.Site!.Name, c.PortNumber, c.Subject, c.Issuer,
                c.ValidFrom, c.ValidTo, c.KeyType, c.KeyBits, c.IsSelfSigned, c.DetectedAt
            })
            .ToListAsync();

        var items = rows.Select(c => new CertificateDto(
                c.Id, c.DeviceId, c.DeviceIp, c.DeviceHostname, c.SiteName, c.PortNumber,
                c.Subject, c.Issuer, c.ValidFrom, c.ValidTo,
                c.ValidTo == null ? null : (int)Math.Floor((c.ValidTo.Value - now).TotalDays),
                c.KeyType, c.KeyBits, c.IsSelfSigned, c.DetectedAt))
            .ToList();

        return PagedResult<CertificateDto>.Create(items, page, pageSize, total);
    }
}
