using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Models;

namespace NetworkMonitor.Server.Logging;

/// <summary>Settings for the database logging sink, bound from "Logging:Database".</summary>
public class DatabaseLoggingOptions
{
    /// <summary>appsettings.json section this class binds to.</summary>
    public const string SectionName = "Logging:Database";

    /// <summary>Turns the sink off entirely without removing it from the pipeline.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Lowest level persisted for third-party categories, the framework, the
    /// hosting layer, anything not this application. Defaults to Warning,
    /// because ASP.NET logs every single request at Information and persisting
    /// that turns the log table into a firehose nobody reads.
    /// </summary>
    public LogLevel MinimumLevel { get; set; } = LogLevel.Warning;

    /// <summary>
    /// Lowest level persisted for the application's own categories (those under
    /// <see cref="ApplicationCategoryPrefix"/>). Defaults to Information, so
    /// what the application itself is doing, scans starting and finishing,
    /// scheduler decisions, seeding, is visible in the UI, while framework
    /// chatter still has to clear the higher bar above.
    ///
    /// This split is the whole point: "what is my application doing" and "what
    /// is the framework saying" want very different thresholds, and a single
    /// level forces you to choose between an empty log and an unreadable one.
    /// </summary>
    public LogLevel ApplicationMinimumLevel { get; set; } = LogLevel.Information;

    /// <summary>Category prefix treated as "this application" for the level split above.</summary>
    public string ApplicationCategoryPrefix { get; set; } = "NetworkMonitor.Server";

    /// <summary>
    /// Maximum entries held in memory awaiting a write. When the queue is full
    /// the oldest entry is dropped rather than blocking the caller; logging must
    /// never become the reason a request stalls.
    /// </summary>
    public int QueueCapacity { get; set; } = 1000;
}

/// <summary>
/// An <see cref="ILoggerProvider"/> that persists log entries to the application
/// database, so anything written through the standard
/// <c>_logger.LogError(...)</c> API is reviewable in the Error Logs page without
/// shell access to the host.
///
/// Three things make this safe to leave switched on:
///
/// 1. <b>It cannot recurse.</b> Writing a log row uses EF Core, and EF Core logs.
///    Left unguarded, one log entry produces a database write, which produces
///    more log entries, which produce more writes. Categories that participate
///    in persistence are excluded outright, and a per-thread reentrancy flag
///    catches anything the exclusion list misses.
/// 2. <b>It never blocks the caller.</b> Entries go onto a bounded channel and a
///    background reader writes them. A logging sink that awaits a database round
///    trip on the request thread turns a slow database into a slow application.
/// 3. <b>It never throws.</b> A logger that raises exceptions converts handled
///    problems into unhandled ones.
/// </summary>
public sealed class DatabaseLoggerProvider : ILoggerProvider
{
    /// <summary>
    /// Categories never persisted. EF Core and the database-facing services are
    /// on the path that writes the row, so logging them would feed the sink with
    /// its own output.
    /// </summary>
    private static readonly string[] ExcludedCategoryPrefixes =
    [
        "Microsoft.EntityFrameworkCore",
        "Microsoft.Data.Sqlite",
        "Npgsql",
        typeof(DatabaseLoggerProvider).FullName!,
        "NetworkMonitor.Server.Services.ErrorLogService",
        // The exception middleware writes its own richer row through
        // IErrorLogService; persisting its ILogger call as well would store the
        // same incident twice.
        "NetworkMonitor.Server.Middleware.ExceptionLoggingMiddleware",
    ];

    /// <summary>
    /// Guards against re-entering the sink on the same thread. Belt and braces
    /// alongside the category exclusions: a provider we do not control could log
    /// from inside the write path under a category we did not anticipate.
    /// </summary>
    [ThreadStatic]
    private static bool _writing;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly DatabaseLoggingOptions _options;
    private readonly Channel<ExceptionLog> _queue;
    private readonly ConcurrentDictionary<string, DatabaseLogger> _loggers = new();
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Task _drainTask;

    /// <summary>Creates the provider and starts the background writer.</summary>
    /// <param name="scopeFactory">Used to resolve a scoped data context per batch; the provider itself is a singleton.</param>
    /// <param name="options">Sink configuration.</param>
    public DatabaseLoggerProvider(IServiceScopeFactory scopeFactory, IOptions<DatabaseLoggingOptions> options)
    {
        _scopeFactory = scopeFactory;
        _options = options.Value;

        _queue = Channel.CreateBounded<ExceptionLog>(new BoundedChannelOptions(_options.QueueCapacity)
        {
            // Under a log storm, losing the oldest entries is better than
            // stalling request threads or exhausting memory.
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

        _drainTask = Task.Run(DrainAsync);
    }

    /// <summary>Returns the logger for a category, creating it on first use.</summary>
    /// <param name="categoryName">Standard logging category, normally the owning type's full name.</param>
    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, name => new DatabaseLogger(this, name));

    /// <summary>True when this category and level should be persisted.</summary>
    private bool ShouldPersist(string category, LogLevel level)
    {
        if (!_options.Enabled || level == LogLevel.None) return false;
        if (_writing) return false;

        foreach (var prefix in ExcludedCategoryPrefixes)
            if (category.StartsWith(prefix, StringComparison.Ordinal)) return false;

        // The application gets a lower bar than the framework; see the comments
        // on the two level options.
        var threshold = category.StartsWith(_options.ApplicationCategoryPrefix, StringComparison.Ordinal)
            ? _options.ApplicationMinimumLevel
            : _options.MinimumLevel;

        return level >= threshold;
    }

    /// <summary>Queues an entry. Returns immediately; the write happens on the background reader.</summary>
    private void Enqueue(ExceptionLog entry) => _queue.Writer.TryWrite(entry);

    /// <summary>
    /// Background reader. Batches whatever is currently queued into one save so a
    /// burst of entries is a single round trip rather than one per line.
    /// </summary>
    private async Task DrainAsync()
    {
        var batch = new List<ExceptionLog>(64);

        try
        {
            while (await _queue.Reader.WaitToReadAsync(_shutdown.Token))
            {
                batch.Clear();
                while (batch.Count < 64 && _queue.Reader.TryRead(out var entry))
                    batch.Add(entry);

                if (batch.Count == 0) continue;

                _writing = true;
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<NetworkMonitorDbContext>();
                    db.ExceptionLogs.AddRange(batch);
                    await db.SaveChangesAsync(_shutdown.Token);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch
                {
                    // Nowhere left to report this: writing to the log is what
                    // just failed. Dropping the batch is the only safe action,
                    // and the console sink still has the original entries.
                }
                finally
                {
                    _writing = false;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }

    /// <summary>Stops accepting entries and gives the writer a moment to flush.</summary>
    public void Dispose()
    {
        _queue.Writer.TryComplete();
        try
        {
            // Bounded wait: shutdown should not hang because the database is slow.
            _drainTask.Wait(TimeSpan.FromSeconds(3));
        }
        catch
        {
            // Ignored: the process is going away regardless.
        }
        _shutdown.Cancel();
        _shutdown.Dispose();
    }

    /// <summary>The per-category logger handed to callers.</summary>
    private sealed class DatabaseLogger : ILogger
    {
        private readonly DatabaseLoggerProvider _provider;
        private readonly string _category;

        /// <summary>Created by the provider; callers obtain one via <see cref="CreateLogger"/>.</summary>
        /// <param name="provider">Owning provider, which holds the queue and the filtering rules.</param>
        /// <param name="category">Logging category this instance writes under.</param>
        internal DatabaseLogger(DatabaseLoggerProvider provider, string category)
        {
            _provider = provider;
            _category = category;
        }

        /// <summary>Scopes are not persisted; the message and exception carry what matters here.</summary>
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        /// <inheritdoc />
        public bool IsEnabled(LogLevel logLevel) => _provider.ShouldPersist(_category, logLevel);

        /// <inheritdoc />
        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;

            try
            {
                var message = formatter(state, exception);
                if (string.IsNullOrWhiteSpace(message) && exception == null) return;

                _provider.Enqueue(new ExceptionLog
                {
                    Source = "server",
                    Level = logLevel switch
                    {
                        LogLevel.Critical => "fatal",
                        LogLevel.Error => "error",
                        LogLevel.Warning => "warning",
                        _ => "info",   // Information, Debug, Trace
                    },
                    Message = Cap(message, 2000),
                    // The category is the practical way to find "everything the
                    // scan scheduler complained about", so it is kept even when
                    // there is no exception type to record.
                    ExceptionType = exception?.GetType().FullName ?? _category,
                    StackTrace = exception == null ? null : Cap(exception.ToString(), 8000),
                    OccurredAt = DateTime.UtcNow,
                });
            }
            catch
            {
                // A logger must not throw.
            }
        }

        private static string Cap(string value, int max) =>
            value.Length <= max ? value : value[..max];
    }
}

/// <summary>Registration helpers for the database logging sink.</summary>
public static class DatabaseLoggerExtensions
{
    /// <summary>
    /// Adds the database sink to the logging pipeline. Registered as a singleton
    /// because <see cref="ILoggerProvider"/> outlives any request scope; the
    /// provider resolves a scoped data context per batch internally.
    /// </summary>
    /// <param name="builder">The host's logging builder.</param>
    /// <param name="configuration">Root configuration, used to bind "Logging:Database".</param>
    public static ILoggingBuilder AddDatabaseLogging(this ILoggingBuilder builder, IConfiguration configuration)
    {
        builder.Services.Configure<DatabaseLoggingOptions>(
            configuration.GetSection(DatabaseLoggingOptions.SectionName));
        builder.Services.AddSingleton<ILoggerProvider, DatabaseLoggerProvider>();
        return builder;
    }
}
