using System.Diagnostics;
using System.Text.Json;
using NetworkMonitor.Server.Services;

namespace NetworkMonitor.Server.Middleware;

/// <summary>
/// Catches anything that escapes a controller, records it, and returns a
/// consistent JSON error body.
///
/// Without this, an unhandled exception produces an empty 500 with no body: the
/// client's fetch wrapper has nothing to show the user beyond "request failed",
/// and the failure exists only in whatever console the process happened to be
/// writing to. Every response also carries a correlation id, so a user reporting
/// "it said error 8f3c2a" gives an operator an exact row to look up.
/// </summary>
public class ExceptionLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionLoggingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    /// <summary>Creates the middleware.</summary>
    /// <param name="next">Next component in the pipeline.</param>
    /// <param name="logger">Console/standard sink; the database row is written separately.</param>
    /// <param name="environment">Used to decide whether the response may include exception detail.</param>
    public ExceptionLoggingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionLoggingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    /// <summary>Runs the rest of the pipeline, converting any escaped exception into a logged, structured error response.</summary>
    /// <param name="context">The current request.</param>
    /// <param name="errorLog">Scoped error log writer, resolved per request rather than captured in the constructor.</param>
    public async Task InvokeAsync(HttpContext context, IErrorLogService errorLog)
    {
        // Reuse the framework's trace identifier so the id in the response body
        // matches anything correlated by tracing infrastructure.
        var correlationId = Activity.Current?.Id ?? context.TraceIdentifier;

        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Unhandled exception on {Method} {Path} (correlation {CorrelationId})",
                context.Request.Method, context.Request.Path, correlationId);

            await errorLog.LogServerErrorAsync(
                ex, context.Request.Path, context.Request.Method,
                StatusCodes.Status500InternalServerError, correlationId, context.RequestAborted);

            // If the response has already started there is nothing left to write;
            // attempting it would throw a second exception on top of the first.
            if (context.Response.HasStarted)
            {
                _logger.LogWarning("Response already started; could not write an error body");
                return;
            }

            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";

            // RFC 7807 shape, which is what the client's fetch wrapper reads.
            // Exception detail is included only outside production: it is
            // invaluable while developing and an information leak in the wild.
            var problem = new
            {
                type = "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                title = "An unexpected error occurred.",
                status = 500,
                detail = _environment.IsDevelopment()
                    ? ex.Message
                    : "The error has been logged. Quote the correlation id when reporting it.",
                instance = context.Request.Path.Value,
                correlationId,
                exceptionType = _environment.IsDevelopment() ? ex.GetType().FullName : null,
            };

            await context.Response.WriteAsync(JsonSerializer.Serialize(problem,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        }
    }
}

/// <summary>Registration helper for <see cref="ExceptionLoggingMiddleware"/>.</summary>
public static class ExceptionLoggingMiddlewareExtensions
{
    /// <summary>
    /// Adds the handler to the pipeline. Register it first, so it wraps
    /// everything downstream of it.
    /// </summary>
    public static IApplicationBuilder UseExceptionLogging(this IApplicationBuilder app) =>
        app.UseMiddleware<ExceptionLoggingMiddleware>();
}
