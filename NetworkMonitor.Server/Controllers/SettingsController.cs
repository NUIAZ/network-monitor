using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// Key/value application settings plus the system-info panel. Setting keys are
/// fixed by the seeder/installer — PUT updates a value but never invents a key,
/// so a typo'd client call cannot litter the table with orphan settings.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SettingsController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;
    private readonly INmapExecutorService _nmap;
    private readonly IConfiguration _configuration;
    private readonly ScanningOptions _scanningOptions;
    private readonly DemoOptions _demoOptions;

    public SettingsController(
        NetworkMonitorDbContext db,
        INmapExecutorService nmap,
        IConfiguration configuration,
        IOptions<ScanningOptions> scanningOptions,
        IOptions<DemoOptions> demoOptions)
    {
        _db = db;
        _nmap = nmap;
        _configuration = configuration;
        _scanningOptions = scanningOptions.Value;
        _demoOptions = demoOptions.Value;
    }

    /// <summary>All settings, alphabetical so the settings page renders stably.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AppSettingDto>>> GetAll()
    {
        return await _db.AppSettings.AsNoTracking()
            .OrderBy(s => s.Key)
            .Select(s => new AppSettingDto(s.Key, s.Value, s.Description, s.UpdatedAt))
            .ToListAsync();
    }

    /// <summary>Updates one setting's value. Unknown keys 404 rather than upsert — see class remarks.</summary>
    [HttpPut("{key}")]
    public async Task<ActionResult<AppSettingDto>> Update(string key, [FromBody] SettingUpdateRequest request)
    {
        var setting = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting is null) return NotFound(new { message = $"No setting named '{key}'." });

        setting.Value = request.Value;
        setting.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return new AppSettingDto(setting.Key, setting.Value, setting.Description, setting.UpdatedAt);
    }

    /// <summary>
    /// Environment facts the About panel shows: version, whether nmap is usable,
    /// which database provider is live, and whether this is demo data.
    /// </summary>
    [HttpGet("system")]
    public ActionResult<SystemInfoDto> GetSystem()
    {
        var nmapAvailable = _nmap.IsNmapAvailable(out var nmapVersion);

        // InformationalVersion carries the human-readable version from the
        // csproj; AssemblyVersion would show 1.0.0.0 regardless.
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "1.0.0";

        return new SystemInfoDto(
            Version: version,
            NmapAvailable: nmapAvailable,
            NmapVersion: nmapVersion,
            SchedulerEnabled: _scanningOptions.SchedulerEnabled,
            Provider: _configuration["Database:Provider"] ?? "sqlite",
            DemoMode: _demoOptions.SeedOnFirstRun,
            CompanyName: _demoOptions.CompanyName);
    }
}
