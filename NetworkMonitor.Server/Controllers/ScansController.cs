using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// Scan history plus the "run one now" trigger. History is read-only — scan
/// records are the system's evidence trail and nothing is allowed to edit them.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ScansController : ControllerBase
{
    /// <summary>
    /// Plain-English purpose of each built-in profile, shown next to the raw
    /// nmap arguments so choosing one does not require reading nmap's man page.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> ProfileDescriptions =
        new Dictionary<string, string>
        {
            ["quick"] = "Host discovery only. Finds which addresses answer without probing any ports — cheap enough to run every few minutes.",
            ["deep"] = "Service detection on the 50 most common TCP ports. Identifies what each host is running; the hourly default.",
            ["security"] = "NSE vulnerability and TLS scripts. Heavier and noisier; run weekly or on demand.",
            ["full_port"] = "Every TCP port (1-65535) with service detection. Slow — run it deliberately, not on a schedule.",
            ["udp"] = "Top 100 UDP services. Requires raw-socket privileges (root, or Npcap on Windows).",
        };

    private readonly NetworkMonitorDbContext _db;
    private readonly ScanOrchestrator _orchestrator;
    private readonly INmapExecutorService _nmap;

    /// <summary>Creates the controller.</summary>
    /// <param name="db">Scan history.</param>
    /// <param name="orchestrator">Runs the scan and persists its outcome, including failures.</param>
    /// <param name="nmap">Consulted before a run so a missing binary comes back as a 503 with instructions rather than a mysterious failed scan.</param>
    public ScansController(NetworkMonitorDbContext db, ScanOrchestrator orchestrator, INmapExecutorService nmap)
    {
        _db = db;
        _orchestrator = orchestrator;
        _nmap = nmap;
    }

    /// <summary>Paged scan history, newest first.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<ScanListItemDto>>> GetAll(
        [FromQuery] int? networkId, [FromQuery] string? status,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        (page, pageSize) = Paging.Clamp(page, pageSize);

        var query = _db.ScanResults.AsNoTracking().AsQueryable();
        if (networkId.HasValue) query = query.Where(s => s.NetworkId == networkId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(s => s.Status == status);

        var total = await query.CountAsync();

        // Project to a slim shape first (never the entity — RawXml can be
        // megabytes per row), then compute duration in memory where TimeSpan
        // arithmetic works the same on every provider.
        var rows = await query
            .OrderByDescending(s => s.StartedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(s => new
            {
                s.Id, s.NetworkId, NetworkName = s.Network!.Name, SiteName = s.Network!.Site!.Name,
                s.ScanType, s.StartedAt, s.CompletedAt, s.HostsUp, s.HostsDown, s.NewDevices,
                s.Status, s.FailureReason
            })
            .ToListAsync();

        var items = rows.Select(s => new ScanListItemDto(
                s.Id, s.NetworkId, s.NetworkName, s.SiteName, s.ScanType,
                s.StartedAt, s.CompletedAt, Duration(s.StartedAt, s.CompletedAt),
                s.HostsUp, s.HostsDown, s.NewDevices, s.Status, s.FailureReason))
            .ToList();

        return PagedResult<ScanListItemDto>.Create(items, page, pageSize, total);
    }

    /// <summary>The five built-in profile definitions with their default cadence.</summary>
    [HttpGet("profiles")]
    public ActionResult<IReadOnlyList<ProfileDefinitionDto>> GetProfiles()
    {
        return ScanProfileDefaults.All
            .Select(p => new ProfileDefinitionDto(
                p.ProfileType, p.NmapArgs, p.IntervalSeconds, p.IsEnabled,
                ProfileDescriptions.GetValueOrDefault(p.ProfileType, "")))
            .ToList();
    }

    /// <summary>One scan with its per-device snapshots.</summary>
    [HttpGet("{id:int}")]
    public async Task<ActionResult<ScanDetailDto>> GetById(int id)
    {
        var scan = await _db.ScanResults.AsNoTracking()
            .Where(s => s.Id == id)
            .Select(s => new
            {
                s.Id, s.NetworkId, NetworkName = s.Network!.Name, SiteName = s.Network!.Site!.Name,
                s.ScanType, s.NmapCommand, s.StartedAt, s.CompletedAt,
                s.HostsUp, s.HostsDown, s.NewDevices, s.ExcludedCount, s.Status, s.FailureReason,
                Snapshots = s.Snapshots
                    .OrderBy(n => n.Device!.IpAddress)
                    .Select(n => new ScanSnapshotDto(
                        n.DeviceId, n.Device!.IpAddress, n.Device!.Hostname,
                        n.Status, n.OpenPortCount, n.ResponseTimeMs, n.RecordedAt))
                    .ToList()
            })
            .FirstOrDefaultAsync();
        if (scan is null) return NotFound();

        return new ScanDetailDto(
            scan.Id, scan.NetworkId, scan.NetworkName, scan.SiteName, scan.ScanType, scan.NmapCommand,
            scan.StartedAt, scan.CompletedAt, Duration(scan.StartedAt, scan.CompletedAt),
            scan.HostsUp, scan.HostsDown, scan.NewDevices, scan.ExcludedCount, scan.Status,
            scan.FailureReason, scan.Snapshots);
    }

    /// <summary>
    /// Runs a real nmap scan synchronously and returns the finished result.
    /// Fails fast with 503 when nmap is not installed — the alternative is a
    /// "failed" scan record whose root cause the user has to go digging for.
    /// </summary>
    [HttpPost("run")]
    public async Task<ActionResult<ScanListItemDto>> Run([FromBody] RunScanRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.ProfileType))
            return BadRequest(new { message = "profileType is required." });

        var profileType = request.ProfileType.Trim();
        if (!ScanProfileDefaults.All.Any(p => p.ProfileType == profileType))
            return BadRequest(new
            {
                message = $"Unknown profileType '{profileType}'. Valid values: {string.Join(", ", ScanProfileDefaults.All.Select(p => p.ProfileType))}."
            });

        var network = await _db.Networks.AsNoTracking()
            .Include(n => n.Site)
            .FirstOrDefaultAsync(n => n.Id == request.NetworkId, ct);
        if (network is null) return NotFound(new { message = $"Network {request.NetworkId} does not exist." });

        if (!_nmap.IsNmapAvailable(out _))
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Nmap is not installed or not on PATH. Install nmap (https://nmap.org/download.html) " +
                          "or set Scanning:NmapPath in appsettings.json, then try again."
            });

        // The orchestrator persists the outcome either way, so a failed scan
        // still comes back 200 with status "failed" — the run itself succeeded
        // as an operation even when the scan did not.
        var scan = await _orchestrator.RunScanAsync(network.Id, profileType, ct);

        return new ScanListItemDto(
            scan.Id, scan.NetworkId, network.Name, network.Site?.Name ?? "", scan.ScanType,
            scan.StartedAt, scan.CompletedAt, Duration(scan.StartedAt, scan.CompletedAt),
            scan.HostsUp, scan.HostsDown, scan.NewDevices, scan.Status, scan.FailureReason);
    }

    private static double? Duration(DateTime started, DateTime? completed) =>
        completed is null ? null : Math.Round((completed.Value - started).TotalSeconds, 1);
}
