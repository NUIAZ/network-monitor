using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// CRUD for sites: the top of the inventory hierarchy. Deleting a site is the
/// most destructive single call in the API (it cascades through networks to
/// devices and their history), which is why the client confirms it twice.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SitesController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;

    /// <summary>Creates the controller.</summary>
    public SitesController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>All sites with rolled-up network/device counts for the site cards.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SiteDto>>> GetAll()
    {
        return await _db.Sites.AsNoTracking()
            .OrderBy(s => s.SiteKey)
            .Select(s => new SiteDto(
                s.Id, s.SiteKey, s.Name, s.City, s.State, s.Latitude, s.Longitude, s.CreatedAt,
                s.Networks.Count,
                s.Networks.SelectMany(n => n.Devices).Count(d => !d.IsExcluded)))
            .ToListAsync();
    }

    /// <summary>One site with its networks, for the site detail page.</summary>
    [HttpGet("{id:int}")]
    public async Task<ActionResult<SiteDetailDto>> GetById(int id)
    {
        var site = await _db.Sites.AsNoTracking()
            .Where(s => s.Id == id)
            .Select(s => new SiteDetailDto(
                s.Id, s.SiteKey, s.Name, s.City, s.State, s.Latitude, s.Longitude, s.CreatedAt,
                s.Networks
                    .OrderBy(n => n.Name)
                    .Select(n => new NetworkDto(
                        n.Id, n.SiteId, s.Name, n.Name, n.Cidr, n.Description,
                        n.ScanIntervalSeconds, n.DeepScanIntervalSeconds, n.IsEnabled,
                        n.Devices.Count(d => !d.IsExcluded),
                        _db.ScanResults.Where(r => r.NetworkId == n.Id).Max(r => (DateTime?)r.StartedAt),
                        n.CreatedAt))
                    .ToList()))
            .FirstOrDefaultAsync();

        return site is null ? NotFound() : site;
    }

    /// <summary>Creates a site.</summary>
    /// <param name="request">Site key and name are required; the key is uppercased before the uniqueness check.</param>
    /// <returns>201 with the new site (counts zero), 400 with a message when validation fails, or 409 when the site key is already taken.</returns>
    [HttpPost]
    public async Task<ActionResult<SiteDto>> Create([FromBody] SiteUpsertRequest request)
    {
        var error = Validate(request);
        if (error != null) return BadRequest(new { message = error });

        var siteKey = request.SiteKey!.Trim().ToUpperInvariant();
        if (await _db.Sites.AnyAsync(s => s.SiteKey == siteKey))
            return Conflict(new { message = $"A site with key '{siteKey}' already exists." });

        var site = new Site
        {
            SiteKey = siteKey,
            Name = request.Name!.Trim(),
            City = request.City?.Trim(),
            State = request.State?.Trim().ToUpperInvariant(),
            Latitude = request.Latitude,
            Longitude = request.Longitude
        };
        _db.Sites.Add(site);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = site.Id },
            new SiteDto(site.Id, site.SiteKey, site.Name, site.City, site.State,
                site.Latitude, site.Longitude, site.CreatedAt, 0, 0));
    }

    /// <summary>
    /// Replaces a site's editable fields. This is a full replace, not a patch;
    /// omitting City clears it rather than leaving it alone.
    /// </summary>
    /// <param name="id">Site to update.</param>
    /// <param name="request">Same shape and validation as create.</param>
    /// <returns>The updated site with freshly counted networks and devices, 404 when it does not exist, or 409 when the new key belongs to another site.</returns>
    [HttpPut("{id:int}")]
    public async Task<ActionResult<SiteDto>> Update(int id, [FromBody] SiteUpsertRequest request)
    {
        var error = Validate(request);
        if (error != null) return BadRequest(new { message = error });

        var site = await _db.Sites.FindAsync(id);
        if (site is null) return NotFound();

        var siteKey = request.SiteKey!.Trim().ToUpperInvariant();
        if (await _db.Sites.AnyAsync(s => s.SiteKey == siteKey && s.Id != id))
            return Conflict(new { message = $"A site with key '{siteKey}' already exists." });

        site.SiteKey = siteKey;
        site.Name = request.Name!.Trim();
        site.City = request.City?.Trim();
        site.State = request.State?.Trim().ToUpperInvariant();
        site.Latitude = request.Latitude;
        site.Longitude = request.Longitude;
        await _db.SaveChangesAsync();

        var networkCount = await _db.Networks.CountAsync(n => n.SiteId == id);
        var deviceCount = await _db.Devices.CountAsync(d => d.Network!.SiteId == id && !d.IsExcluded);
        return new SiteDto(site.Id, site.SiteKey, site.Name, site.City, site.State,
            site.Latitude, site.Longitude, site.CreatedAt, networkCount, deviceCount);
    }

    /// <summary>Deletes a site and, via cascade, every network, device, and scan under it.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var site = await _db.Sites.FindAsync(id);
        if (site is null) return NotFound();

        _db.Sites.Remove(site);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Shared create/update validation; returns a message or null when valid.</summary>
    private static string? Validate(SiteUpsertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.SiteKey)) return "siteKey is required.";
        if (request.SiteKey.Trim().Length > 20) return "siteKey must be 20 characters or fewer.";
        if (string.IsNullOrWhiteSpace(request.Name)) return "name is required.";
        if (request.State is { Length: > 0 } state && state.Trim().Length != 2)
            return "state must be a two-letter abbreviation.";
        if (request.Latitude is < -90 or > 90) return "latitude must be between -90 and 90.";
        if (request.Longitude is < -180 or > 180) return "longitude must be between -180 and 180.";
        return null;
    }
}
