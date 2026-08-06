using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Controllers;

/// <summary>
/// Read access to the error log, plus the endpoint the browser uses to report
/// its own failures. Together these make both halves of the application
/// diagnosable from the Error Logs page.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class LogsController : ControllerBase
{
    private readonly NetworkMonitorDbContext _db;
    private readonly IErrorLogService _errorLog;

    /// <summary>Creates the controller.</summary>
    /// <param name="db">Data context.</param>
    /// <param name="errorLog">Writer used for browser-reported errors.</param>
    public LogsController(NetworkMonitorDbContext db, IErrorLogService errorLog)
    {
        _db = db;
        _errorLog = errorLog;
    }

    /// <summary>Returns logged errors, newest first.</summary>
    /// <param name="source">Optional tier filter: "server" or "client".</param>
    /// <param name="level">Optional severity filter: "warning", "error", or "fatal".</param>
    /// <param name="search">Optional case-insensitive match against message, type, path, or correlation id.</param>
    /// <param name="resolved">Optional triage filter.</param>
    /// <param name="page">1-based page number.</param>
    /// <param name="pageSize">Rows per page, capped at 200.</param>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<ErrorLogDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ErrorLogDto>>> GetLogs(
        [FromQuery] string? source,
        [FromQuery] string? level,
        [FromQuery] string? search,
        [FromQuery] bool? resolved,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.ExceptionLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(source)) query = query.Where(e => e.Source == source);
        if (!string.IsNullOrWhiteSpace(level)) query = query.Where(e => e.Level == level);
        if (resolved.HasValue) query = query.Where(e => e.IsResolved == resolved.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(e =>
                e.Message.ToLower().Contains(term) ||
                (e.ExceptionType != null && e.ExceptionType.ToLower().Contains(term)) ||
                (e.Path != null && e.Path.ToLower().Contains(term)) ||
                (e.CorrelationId != null && e.CorrelationId.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(e => e.OccurredAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(e => new ErrorLogDto(
                e.Id, e.Source, e.Level, e.Message, e.ExceptionType, e.StackTrace,
                e.Path, e.Method, e.StatusCode, e.UserAgent, e.CorrelationId,
                e.OccurredAt, e.IsResolved))
            .ToListAsync();

        return Ok(new PagedResult<ErrorLogDto>(items, page, pageSize, total,
            (int)Math.Ceiling(total / (double)pageSize)));
    }

    /// <summary>Counts by tier and severity, for the page's summary tiles.</summary>
    [HttpGet("summary")]
    [ProducesResponseType(typeof(ErrorLogSummaryDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<ErrorLogSummaryDto>> GetSummary()
    {
        var since = DateTime.UtcNow.AddHours(-24);
        var logs = _db.ExceptionLogs.AsNoTracking();

        return Ok(new ErrorLogSummaryDto(
            Total: await logs.CountAsync(),
            Last24Hours: await logs.CountAsync(e => e.OccurredAt >= since),
            ServerErrors: await logs.CountAsync(e => e.Source == "server"),
            ClientErrors: await logs.CountAsync(e => e.Source == "client"),
            Unresolved: await logs.CountAsync(e => !e.IsResolved)));
    }

    /// <summary>
    /// Records an error reported by the browser.
    ///
    /// Deliberately permissive: it accepts whatever the client managed to
    /// capture and never fails the caller. A browser that is already broken
    /// enough to be reporting an error should not have to handle an error from
    /// the error reporter.
    /// </summary>
    /// <param name="request">What the browser observed.</param>
    [HttpPost("client-error")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> LogClientError([FromBody] ClientErrorRequest request)
    {
        await _errorLog.LogClientErrorAsync(new ExceptionLog
        {
            Level = string.IsNullOrWhiteSpace(request.Level) ? "error" : request.Level,
            Message = string.IsNullOrWhiteSpace(request.Message) ? "(no message)" : request.Message,
            ExceptionType = request.ExceptionType,
            StackTrace = request.StackTrace,
            Path = request.Path,
            UserAgent = Request.Headers.UserAgent.ToString(),
            CorrelationId = request.CorrelationId,
        }, HttpContext.RequestAborted);

        return Accepted();
    }

    /// <summary>Marks an entry resolved or unresolved.</summary>
    /// <param name="id">Log entry id.</param>
    /// <param name="request">The desired state.</param>
    [HttpPut("{id:int}/resolved")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SetResolved(int id, [FromBody] ResolveLogRequest request)
    {
        var entry = await _db.ExceptionLogs.FindAsync(id);
        if (entry == null) return NotFound();

        entry.IsResolved = request.IsResolved;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Deletes entries older than the given number of days. Exposed because the
    /// error log is the one table a misbehaving deployment can grow without
    /// bound, and an operator needs a way to reclaim it.
    /// </summary>
    /// <param name="olderThanDays">Age threshold in days; must be 1 or more.</param>
    [HttpDelete]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Purge([FromQuery] int olderThanDays = 30)
    {
        if (olderThanDays < 1)
            return BadRequest(new { message = "olderThanDays must be at least 1." });

        var cutoff = DateTime.UtcNow.AddDays(-olderThanDays);
        var removed = await _db.ExceptionLogs.Where(e => e.OccurredAt < cutoff).ExecuteDeleteAsync();
        return Ok(new { removed });
    }
}

/// <summary>One row of the error log as returned by the API.</summary>
/// <param name="Id">Log entry id.</param>
/// <param name="Source">"server" or "client".</param>
/// <param name="Level">"warning", "error", or "fatal".</param>
/// <param name="Message">What went wrong.</param>
/// <param name="ExceptionType">CLR exception type, JavaScript error name, or the logging category when neither applies.</param>
/// <param name="StackTrace">Full trace including inner exceptions, capped at 8000 characters.</param>
/// <param name="Path">Request path, or the SPA route for client errors.</param>
/// <param name="Method">HTTP method; null for client errors.</param>
/// <param name="StatusCode">Response status; null for client errors, which have no response.</param>
/// <param name="UserAgent">Browser identification, recorded for client errors.</param>
/// <param name="CorrelationId">Ties a browser report to the server request that caused it.</param>
/// <param name="OccurredAt">UTC timestamp.</param>
/// <param name="IsResolved">Operator triage marker.</param>
public record ErrorLogDto(
    int Id, string Source, string Level, string Message, string? ExceptionType, string? StackTrace,
    string? Path, string? Method, int? StatusCode, string? UserAgent, string? CorrelationId,
    DateTime OccurredAt, bool IsResolved);

/// <summary>Counts shown on the Error Logs summary tiles.</summary>
/// <param name="Total">All entries retained.</param>
/// <param name="Last24Hours">Entries from the last 24 hours — the number that indicates whether something is wrong now.</param>
/// <param name="ServerErrors">Entries raised by the API.</param>
/// <param name="ClientErrors">Entries reported by browsers.</param>
/// <param name="Unresolved">Entries not yet marked resolved.</param>
public record ErrorLogSummaryDto(int Total, int Last24Hours, int ServerErrors, int ClientErrors, int Unresolved);

/// <summary>Body of a browser error report.</summary>
/// <param name="Message">The error message.</param>
/// <param name="ExceptionType">JavaScript error name, e.g. "TypeError".</param>
/// <param name="StackTrace">Stack as captured by the browser.</param>
/// <param name="Path">SPA route the user was on.</param>
/// <param name="Level">"warning", "error", or "fatal"; defaults to "error".</param>
/// <param name="CorrelationId">Correlation id from a failed API response, when the error followed one.</param>
public record ClientErrorRequest(
    string Message, string? ExceptionType, string? StackTrace,
    string? Path, string? Level, string? CorrelationId);

/// <summary>Body of a resolve/unresolve request.</summary>
/// <param name="IsResolved">Desired state.</param>
public record ResolveLogRequest(bool IsResolved);
