using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Services;

/// <summary>
/// Writes errors to the database so they can be reviewed in the application
/// itself rather than by shelling into a host and reading log files.
/// </summary>
public interface IErrorLogService
{
    /// <summary>Records a server-side exception. Never throws.</summary>
    Task LogServerErrorAsync(Exception ex, string? path, string? method, int statusCode, string correlationId, CancellationToken ct = default);

    /// <summary>Records an error reported by the browser. Never throws.</summary>
    Task LogClientErrorAsync(ExceptionLog entry, CancellationToken ct = default);
}

/// <summary>
/// Database-backed error log.
///
/// Every method here swallows its own failures. An error logger that throws
/// turns a handled problem into an unhandled one, and a logger that cannot
/// reach the database must not be the reason a request fails — the ILogger
/// fallback means the information still reaches stdout and the container log.
/// </summary>
public class ErrorLogService : IErrorLogService
{
    /// <summary>Stack traces are capped so a crash loop cannot fill the database.</summary>
    private const int MaxStackTrace = 8000;
    private const int MaxMessage = 2000;

    private readonly NetworkMonitorDbContext _db;
    private readonly ILogger<ErrorLogService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="db">Scoped data context.</param>
    /// <param name="logger">Fallback sink used when the database write itself fails.</param>
    public ErrorLogService(NetworkMonitorDbContext db, ILogger<ErrorLogService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task LogServerErrorAsync(
        Exception ex, string? path, string? method, int statusCode, string correlationId, CancellationToken ct = default)
    {
        var entry = new ExceptionLog
        {
            Source = "server",
            Level = "fatal",
            Message = Truncate(ex.Message, MaxMessage),
            ExceptionType = ex.GetType().FullName,
            // ToString() rather than StackTrace: it includes inner exceptions,
            // which is usually where the actual cause is.
            StackTrace = Truncate(ex.ToString(), MaxStackTrace),
            Path = Truncate(path, 500),
            Method = method,
            StatusCode = statusCode,
            CorrelationId = correlationId,
            OccurredAt = DateTime.UtcNow
        };

        await SaveAsync(entry, ct);
    }

    /// <inheritdoc />
    public async Task LogClientErrorAsync(ExceptionLog entry, CancellationToken ct = default)
    {
        entry.Source = "client";
        entry.Message = Truncate(entry.Message, MaxMessage) ?? "(no message)";
        entry.StackTrace = Truncate(entry.StackTrace, MaxStackTrace);
        entry.Path = Truncate(entry.Path, 500);
        entry.UserAgent = Truncate(entry.UserAgent, 500);
        entry.OccurredAt = DateTime.UtcNow;   // never trust a client clock
        entry.StatusCode = null;              // a browser error has no response
        await SaveAsync(entry, ct);
    }

    private async Task SaveAsync(ExceptionLog entry, CancellationToken ct)
    {
        try
        {
            _db.ExceptionLogs.Add(entry);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception saveEx)
        {
            // The database is unreachable, read-only, or the row was rejected.
            // Fall back to the standard logger so the original error is not lost,
            // and never let this failure propagate.
            _logger.LogError(saveEx,
                "Could not persist {Source} error to the database. Original message: {Message}",
                entry.Source, entry.Message);
        }
    }

    /// <summary>Caps a value to <paramref name="max"/> characters. Null in, null out — stated explicitly so callers assigning to non-nullable fields flow-analyse correctly.</summary>
    [return: System.Diagnostics.CodeAnalysis.NotNullIfNotNull(nameof(value))]
    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? value
        : value.Length <= max ? value
        : value[..max];
}
