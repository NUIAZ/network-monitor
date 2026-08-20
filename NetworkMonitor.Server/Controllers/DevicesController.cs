using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// The device inventory: the page people actually live in. Reads are paged and
/// filtered server-side because a real estate outgrows "fetch everything and
/// filter in the browser" almost immediately.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DevicesController : ControllerBase
{
    /// <summary>The classifier's full vocabulary: the only values a manual re-type may use.</summary>
    private static readonly HashSet<string> ValidDeviceTypes =
        ["router", "switch", "firewall", "printer", "server", "workstation", "camera", "unknown"];

    private readonly NetworkMonitorDbContext _db;

    /// <summary>Creates the controller.</summary>
    public DevicesController(NetworkMonitorDbContext db) => _db = db;

    /// <summary>
    /// Paged, filterable device list. <paramref name="sort"/> takes a field name
    /// with an optional leading "-" for descending (e.g. "-lastSeen").
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<DeviceListItemDto>>> GetAll(
        [FromQuery] int? siteId, [FromQuery] int? networkId, [FromQuery] string? status,
        [FromQuery] string? deviceType, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? sort = null)
    {
        (page, pageSize) = Paging.Clamp(page, pageSize);

        var query = _db.Devices.AsNoTracking().AsQueryable();
        if (siteId.HasValue) query = query.Where(d => d.Network!.SiteId == siteId);
        if (networkId.HasValue) query = query.Where(d => d.NetworkId == networkId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(d => d.Status == status);
        if (!string.IsNullOrWhiteSpace(deviceType)) query = query.Where(d => d.DeviceType == deviceType);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(d =>
                d.IpAddress.Contains(term) ||
                (d.Hostname != null && d.Hostname.Contains(term)) ||
                (d.MacAddress != null && d.MacAddress.Contains(term)) ||
                (d.Vendor != null && d.Vendor.Contains(term)));
        }

        query = ApplySort(query, sort);

        var total = await query.CountAsync();
        var items = await query
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new DeviceListItemDto(
                d.Id, d.NetworkId, d.Network!.Name, d.Network!.SiteId, d.Network!.Site!.Name,
                d.IpAddress, d.MacAddress, d.Hostname, d.Vendor, d.OsGuess,
                d.DeviceType, d.Status, d.FirstSeen, d.LastSeen,
                d.Ports.Count(p => p.State == "open"), d.IsFlagged, d.IsExcluded))
            .ToListAsync();

        return PagedResult<DeviceListItemDto>.Create(items, page, pageSize, total);
    }

    /// <summary>
    /// The full site → network → device tree for the network map. One nested
    /// payload instead of three chained requests, because the map needs the whole
    /// picture before it can lay anything out.
    /// </summary>
    [HttpGet("topology")]
    public async Task<ActionResult<TopologyDto>> GetTopology([FromQuery] int? siteId)
    {
        var sites = await _db.Sites.AsNoTracking()
            .Where(s => siteId == null || s.Id == siteId)
            .OrderBy(s => s.SiteKey)
            .Select(s => new TopologySiteDto(
                s.Id, s.Name,
                s.Networks
                    .OrderBy(n => n.Name)
                    .Select(n => new TopologyNetworkDto(
                        n.Id, n.Name, n.Cidr,
                        n.Devices
                            .Where(d => !d.IsExcluded)
                            .OrderBy(d => d.IpAddress)
                            .Select(d => new TopologyDeviceDto(d.Id, d.IpAddress, d.Hostname, d.DeviceType, d.Status))
                            .ToList()))
                    .ToList()))
            .ToListAsync();

        return new TopologyDto(sites);
    }

    /// <summary>Everything about one device: ports, recent alerts, vulnerabilities, certificates.</summary>
    [HttpGet("{id:int}")]
    public async Task<ActionResult<DeviceDetailDto>> GetById(int id)
    {
        var device = await _db.Devices.AsNoTracking()
            .Include(d => d.Network!).ThenInclude(n => n.Site)
            .Include(d => d.Ports)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (device is null) return NotFound();

        // Alerts capped at the 20 newest: the detail page shows recency, and the
        // alerts page exists for the full archaeology.
        var alerts = await _db.Alerts.AsNoTracking()
            .Where(a => a.DeviceId == id)
            .OrderByDescending(a => a.CreatedAt)
            .Take(20)
            .Select(a => new AlertDto(a.Id, a.DeviceId, device.IpAddress, device.Hostname, a.NetworkId,
                a.AlertType, a.Severity, a.Message, a.Details,
                a.IsAcknowledged, a.AcknowledgedBy, a.AcknowledgedAt, a.CreatedAt))
            .ToListAsync();

        var now = DateTime.UtcNow;
        var siteName = device.Network!.Site!.Name;

        var vulnerabilities = await _db.Vulnerabilities.AsNoTracking()
            .Where(v => v.DeviceId == id)
            .OrderByDescending(v => v.CvssScore)
            .Select(v => new VulnerabilityDto(v.Id, v.DeviceId, device.IpAddress, device.Hostname, siteName,
                v.CveId, v.CvssScore, v.Severity, v.Description, v.AffectedService, v.PortNumber, v.Status, v.DetectedAt))
            .ToListAsync();

        var certificates = (await _db.SslCertificates.AsNoTracking()
                .Where(c => c.DeviceId == id)
                .ToListAsync())
            .Select(c => new CertificateDto(c.Id, c.DeviceId, device.IpAddress, device.Hostname, siteName,
                c.PortNumber, c.Subject, c.Issuer, c.ValidFrom, c.ValidTo,
                c.ValidTo == null ? null : (int)Math.Floor((c.ValidTo.Value - now).TotalDays),
                c.KeyType, c.KeyBits, c.IsSelfSigned, c.DetectedAt))
            .ToList();

        return new DeviceDetailDto(
            device.Id, device.NetworkId, device.Network!.Name, device.Network!.SiteId, siteName,
            device.IpAddress, device.MacAddress, device.Hostname, device.Vendor, device.OsGuess,
            device.DeviceType, device.Status, device.FirstSeen, device.LastSeen, device.LastScannedAt,
            device.IsFlagged, device.IsExcluded, device.Notes, device.Hardware, device.PhysicalLocation,
            device.AssignedTo, device.MissedScans,
            device.Ports.OrderBy(p => p.PortNumber)
                .Select(p => new PortDto(p.Id, p.PortNumber, p.Protocol, p.State, p.ServiceName, p.ServiceVersion, p.FirstSeen, p.LastSeen))
                .ToList(),
            alerts, vulnerabilities, certificates);
    }

    /// <summary>Per-scan snapshots for the availability/latency history chart.</summary>
    [HttpGet("{id:int}/history")]
    public async Task<ActionResult<IReadOnlyList<DeviceHistoryPointDto>>> GetHistory(int id, [FromQuery] int days = 7)
    {
        days = Math.Clamp(days, 1, 90);
        if (!await _db.Devices.AnyAsync(d => d.Id == id)) return NotFound();

        var since = DateTime.UtcNow.AddDays(-days);
        return await _db.ScanDeviceSnapshots.AsNoTracking()
            .Where(s => s.DeviceId == id && s.RecordedAt >= since)
            .OrderBy(s => s.RecordedAt)
            .Select(s => new DeviceHistoryPointDto(s.RecordedAt, s.Status, s.OpenPortCount, s.ResponseTimeMs))
            .ToListAsync();
    }

    /// <summary>
    /// Updates the operator-owned fields only. Discovery-owned fields are not
    /// accepted here on purpose: the next scan would clobber them, and a field
    /// that silently reverts is worse than one that cannot be edited.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<ActionResult<DeviceListItemDto>> Update(int id, [FromBody] DeviceUpdateRequest request)
    {
        var device = await _db.Devices
            .Include(d => d.Network!).ThenInclude(n => n.Site)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (device is null) return NotFound();

        if (request.DeviceType != null && !ValidDeviceTypes.Contains(request.DeviceType))
            return BadRequest(new { message = $"deviceType must be one of: {string.Join(", ", ValidDeviceTypes)}." });

        if (request.Hostname != null)
        {
            var hostname = request.Hostname.Trim();
            device.Hostname = hostname.Length == 0 ? null : hostname;
            // Clearing the field hands the name back to discovery; anything else
            // is an override the next scan must not clobber.
            device.HostnameIsManual = hostname.Length > 0;
        }
        if (request.Hardware != null) device.Hardware = request.Hardware.Trim();
        if (request.PhysicalLocation != null) device.PhysicalLocation = request.PhysicalLocation.Trim();
        if (request.AssignedTo != null) device.AssignedTo = request.AssignedTo.Trim();
        if (request.Notes != null) device.Notes = request.Notes;
        if (request.IsFlagged.HasValue) device.IsFlagged = request.IsFlagged.Value;
        if (request.IsExcluded.HasValue) device.IsExcluded = request.IsExcluded.Value;
        if (request.DeviceType != null) device.DeviceType = request.DeviceType;
        await _db.SaveChangesAsync();

        var openPorts = await _db.Ports.CountAsync(p => p.DeviceId == id && p.State == "open");
        return new DeviceListItemDto(
            device.Id, device.NetworkId, device.Network!.Name, device.Network!.SiteId, device.Network!.Site!.Name,
            device.IpAddress, device.MacAddress, device.Hostname, device.Vendor, device.OsGuess,
            device.DeviceType, device.Status, device.FirstSeen, device.LastSeen,
            openPorts, device.IsFlagged, device.IsExcluded);
    }

    /// <summary>Deletes a device and its ports/snapshots; its alerts survive with a null device link.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var device = await _db.Devices.FindAsync(id);
        if (device is null) return NotFound();

        _db.Devices.Remove(device);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Whitelisted sort fields. Unknown values fall back to the default rather
    /// than erroring so a stale client link still renders a list.
    /// </summary>
    private static IQueryable<Device> ApplySort(IQueryable<Device> query, string? sort)
    {
        var descending = sort?.StartsWith('-') == true;
        var field = (descending ? sort![1..] : sort)?.Trim().ToLowerInvariant();

        return (field, descending) switch
        {
            ("ip", false) => query.OrderBy(d => d.IpAddress),
            ("ip", true) => query.OrderByDescending(d => d.IpAddress),
            ("hostname", false) => query.OrderBy(d => d.Hostname),
            ("hostname", true) => query.OrderByDescending(d => d.Hostname),
            ("type", false) => query.OrderBy(d => d.DeviceType),
            ("type", true) => query.OrderByDescending(d => d.DeviceType),
            ("status", false) => query.OrderBy(d => d.Status),
            ("status", true) => query.OrderByDescending(d => d.Status),
            ("firstseen", false) => query.OrderBy(d => d.FirstSeen),
            ("firstseen", true) => query.OrderByDescending(d => d.FirstSeen),
            ("lastseen", false) => query.OrderBy(d => d.LastSeen),
            ("lastseen", true) => query.OrderByDescending(d => d.LastSeen),
            _ => query.OrderBy(d => d.Hostname).ThenBy(d => d.IpAddress)
        };
    }
}
