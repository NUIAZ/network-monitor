using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace NetworkMonitor.Server.Models;

/// <summary>
/// A recorded error, from either half of the application.
///
/// Both tiers write here on purpose. A server stack trace explains what broke;
/// a browser error explains what the user actually saw. Investigating a report
/// of "the devices page went blank" with only server logs means guessing, so
/// client failures are shipped back and stored alongside server ones, sharing a
/// correlation id where the two are the same incident.
/// </summary>
[Table("exception_logs")]
public class ExceptionLog
{
    /// <summary>Primary key.</summary>
    [Key]
    [Column("id")]
    public int Id { get; set; }

    /// <summary>Which tier raised it: "server" or "client".</summary>
    [Required, MaxLength(10)]
    [Column("source")]
    public string Source { get; set; } = "server";

    /// <summary>Severity: "error", "warning", or "fatal" (an unhandled failure that took a page or request down).</summary>
    [Required, MaxLength(20)]
    [Column("level")]
    public string Level { get; set; } = "error";

    /// <summary>The exception message, or the browser's error message. Truncated on write rather than rejected.</summary>
    [Required, MaxLength(2000)]
    [Column("message")]
    public string Message { get; set; } = "";

    /// <summary>CLR exception type, or the JavaScript error name. Null when the source reported none.</summary>
    [MaxLength(255)]
    [Column("exception_type")]
    public string? ExceptionType { get; set; }

    /// <summary>
    /// Stack trace, capped at 8000 characters. Long enough for any frame that
    /// matters, short enough that a crash loop cannot fill the database.
    /// </summary>
    [Column("stack_trace")]
    public string? StackTrace { get; set; }

    /// <summary>Request path for server errors; the SPA route for client errors.</summary>
    [MaxLength(500)]
    [Column("path")]
    public string? Path { get; set; }

    /// <summary>HTTP method for server errors. Null for client errors.</summary>
    [MaxLength(10)]
    [Column("method")]
    public string? Method { get; set; }

    /// <summary>Status code returned to the caller. Null for client-side errors, which have no response.</summary>
    [Column("status_code")]
    public int? StatusCode { get; set; }

    /// <summary>Browser user agent, recorded for client errors so version-specific failures are identifiable.</summary>
    [MaxLength(500)]
    [Column("user_agent")]
    public string? UserAgent { get; set; }

    /// <summary>
    /// Ties a client report to the server request that caused it. The API returns
    /// this id in its error responses; the client sends it back when it logs the
    /// failure, so one incident is one searchable value rather than two entries
    /// nobody connects.
    /// </summary>
    [MaxLength(64)]
    [Column("correlation_id")]
    public string? CorrelationId { get; set; }

    /// <summary>UTC timestamp the error occurred.</summary>
    [Column("occurred_at")]
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;

    /// <summary>Operator marker for triage; nothing in the pipeline reads it.</summary>
    [Column("is_resolved")]
    public bool IsResolved { get; set; }
}
