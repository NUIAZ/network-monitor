using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Helpers;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// CRUD for networks (scan targets). The CIDR is the one field that eventually
/// reaches an external command line, so it is validated here with the same
/// <see cref="CidrUtil"/> rule the executor enforces, rejecting bad input at
/// the API keeps the failure visible to the person who typed it.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class NetworksController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;
    private readonly ScanningOptions _scanningOptions;

    /// <summary>Creates the controller.</summary>
    /// <param name="db">Inventory context.</param>
    /// <param name="scanningOptions">Supplies the maximum target size, which is enforced here at configuration time rather than only when a scan runs.</param>
    public NetworksController(NetworkMonitorDbContext db, IOptions<ScanningOptions> scanningOptions)
    {
        _db = db;
        _scanningOptions = scanningOptions.Value;
    }

    /// <summary>Network list, optionally scoped to one site.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<NetworkDto>>> GetAll([FromQuery] int? siteId)
    {
        return await _db.Networks.AsNoTracking()
            .Where(n => siteId == null || n.SiteId == siteId)
            .OrderBy(n => n.Site!.SiteKey).ThenBy(n => n.Name)
            .Select(n => new NetworkDto(
                n.Id, n.SiteId, n.Site!.Name, n.Name, n.Cidr, n.Description,
                n.ScanIntervalSeconds, n.DeepScanIntervalSeconds, n.IsEnabled,
                n.Devices.Count(d => !d.IsExcluded),
                _db.ScanResults.Where(r => r.NetworkId == n.Id).Max(r => (DateTime?)r.StartedAt),
                n.CreatedAt))
            .ToListAsync();
    }

    /// <summary>One network with its scan profiles, for the network settings page.</summary>
    [HttpGet("{id:int}")]
    public async Task<ActionResult<NetworkDetailDto>> GetById(int id)
    {
        var network = await _db.Networks.AsNoTracking()
            .Where(n => n.Id == id)
            .Select(n => new NetworkDetailDto(
                n.Id, n.SiteId, n.Site!.Name, n.Name, n.Cidr, n.Description,
                n.ScanIntervalSeconds, n.DeepScanIntervalSeconds, n.IsEnabled,
                n.Devices.Count(d => !d.IsExcluded),
                _db.ScanResults.Where(r => r.NetworkId == n.Id).Max(r => (DateTime?)r.StartedAt),
                n.CreatedAt,
                n.ScanProfiles
                    .OrderBy(p => p.Id)
                    .Select(p => new ScanProfileDto(p.Id, p.ProfileType, p.NmapArgs, p.IntervalSeconds, p.IsEnabled, p.LastRunAt))
                    .ToList()))
            .FirstOrDefaultAsync();

        return network is null ? NotFound() : network;
    }

    /// <summary>
    /// Creates a network and its five default scan profiles in one step, so a
    /// freshly added network is scannable immediately without a second setup call.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<NetworkDto>> Create([FromBody] NetworkCreateRequest request)
    {
        var error = await ValidateAsync(request.SiteId, request.Name, request.Cidr);
        if (error != null) return BadRequest(new { message = error });

        var network = new Network
        {
            SiteId = request.SiteId,
            Name = request.Name!.Trim(),
            Cidr = request.Cidr!.Trim(),
            Description = request.Description?.Trim(),
            ScanIntervalSeconds = request.ScanIntervalSeconds is > 0 ? request.ScanIntervalSeconds.Value : 300,
            DeepScanIntervalSeconds = request.DeepScanIntervalSeconds is > 0 ? request.DeepScanIntervalSeconds.Value : 3600
        };
        _db.Networks.Add(network);
        await _db.SaveChangesAsync(); // profiles need the generated network id

        _db.ScanProfiles.AddRange(ScanProfileDefaults.ForNetwork(network));
        await _db.SaveChangesAsync();

        var siteName = await _db.Sites.Where(s => s.Id == network.SiteId).Select(s => s.Name).FirstAsync();
        return CreatedAtAction(nameof(GetById), new { id = network.Id },
            new NetworkDto(network.Id, network.SiteId, siteName, network.Name, network.Cidr,
                network.Description, network.ScanIntervalSeconds, network.DeepScanIntervalSeconds,
                network.IsEnabled, 0, null, network.CreatedAt));
    }

    /// <summary>
    /// Updates a network's site, name, range, and cadence. The CIDR is
    /// re-validated (including the address-count guard) on every call, since
    /// widening a prefix is exactly how a harmless network becomes a huge one.
    /// </summary>
    /// <param name="id">Network to update.</param>
    /// <param name="request">Interval fields are only applied when positive; IsEnabled is only applied when supplied.</param>
    /// <returns>The updated network with recounted devices and its last scan time, 404 when it does not exist, or 400 with a message when validation fails.</returns>
    [HttpPut("{id:int}")]
    public async Task<ActionResult<NetworkDto>> Update(int id, [FromBody] NetworkUpdateRequest request)
    {
        var network = await _db.Networks.FindAsync(id);
        if (network is null) return NotFound();

        var error = await ValidateAsync(request.SiteId, request.Name, request.Cidr);
        if (error != null) return BadRequest(new { message = error });

        network.SiteId = request.SiteId;
        network.Name = request.Name!.Trim();
        network.Cidr = request.Cidr!.Trim();
        network.Description = request.Description?.Trim();
        if (request.ScanIntervalSeconds is > 0) network.ScanIntervalSeconds = request.ScanIntervalSeconds.Value;
        if (request.DeepScanIntervalSeconds is > 0) network.DeepScanIntervalSeconds = request.DeepScanIntervalSeconds.Value;
        if (request.IsEnabled.HasValue) network.IsEnabled = request.IsEnabled.Value;
        await _db.SaveChangesAsync();

        var siteName = await _db.Sites.Where(s => s.Id == network.SiteId).Select(s => s.Name).FirstAsync();
        var deviceCount = await _db.Devices.CountAsync(d => d.NetworkId == id && !d.IsExcluded);
        var lastScanAt = await _db.ScanResults.Where(r => r.NetworkId == id).MaxAsync(r => (DateTime?)r.StartedAt);
        return new NetworkDto(network.Id, network.SiteId, siteName, network.Name, network.Cidr,
            network.Description, network.ScanIntervalSeconds, network.DeepScanIntervalSeconds,
            network.IsEnabled, deviceCount, lastScanAt, network.CreatedAt);
    }

    /// <summary>
    /// Deletes a network and, via cascade, its devices, ports, scan history, and
    /// profiles. To stop scanning without losing the inventory, set IsEnabled
    /// false instead.
    /// </summary>
    /// <param name="id">Network to delete.</param>
    /// <returns>204 on success, 404 when the network does not exist.</returns>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var network = await _db.Networks.FindAsync(id);
        if (network is null) return NotFound();

        _db.Networks.Remove(network);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Tunes one scan profile in place. Profiles are keyed by type rather than id
    /// in the route because the client thinks in terms of "the deep profile", and
    /// the five types are fixed per network.
    /// </summary>
    [HttpPut("{id:int}/profiles/{profileType}")]
    public async Task<ActionResult<ScanProfileDto>> UpdateProfile(int id, string profileType, [FromBody] ProfileUpdateRequest request)
    {
        var profile = await _db.ScanProfiles
            .FirstOrDefaultAsync(p => p.NetworkId == id && p.ProfileType == profileType);
        if (profile is null) return NotFound(new { message = $"Network {id} has no '{profileType}' profile." });

        if (!string.IsNullOrWhiteSpace(request.NmapArgs))
        {
            if (request.NmapArgs.Length > 500) return BadRequest(new { message = "nmapArgs must be 500 characters or fewer." });
            profile.NmapArgs = request.NmapArgs.Trim();
        }
        if (request.IntervalSeconds is > 0) profile.IntervalSeconds = request.IntervalSeconds.Value;
        if (request.IsEnabled.HasValue) profile.IsEnabled = request.IsEnabled.Value;
        await _db.SaveChangesAsync();

        return new ScanProfileDto(profile.Id, profile.ProfileType, profile.NmapArgs,
            profile.IntervalSeconds, profile.IsEnabled, profile.LastRunAt);
    }

    /// <summary>
    /// Shared create/update validation, including the address-count guard: a
    /// mistyped /8 is a sixteen-million-host scan and is stopped here, not after
    /// the scheduler has been grinding on it for a day.
    /// </summary>
    private async Task<string?> ValidateAsync(int siteId, string? name, string? cidr)
    {
        if (string.IsNullOrWhiteSpace(name)) return "name is required.";
        if (string.IsNullOrWhiteSpace(cidr)) return "cidr is required.";
        if (!await _db.Sites.AnyAsync(s => s.Id == siteId)) return $"Site {siteId} does not exist.";

        try
        {
            CidrUtil.ValidateForCommand(cidr.Trim());
        }
        catch (ArgumentException ex)
        {
            return ex.Message;
        }

        var addresses = CidrUtil.AddressCount(cidr.Trim());
        if (addresses > _scanningOptions.MaxTargetAddresses)
            return $"'{cidr.Trim()}' covers {addresses:N0} addresses, above the configured maximum of {_scanningOptions.MaxTargetAddresses:N0}.";

        return null;
    }
}
