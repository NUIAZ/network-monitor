using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Configuration;
using NetworkMonitor.Server.Context;
using NetworkMonitor.Server.Logging;
using NetworkMonitor.Server.Middleware;
using NetworkMonitor.Server.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Logging ───────────────────────────────────────────────────────────────────
// Adds a database sink alongside the console one, so anything written through
// the standard ILogger API at Warning or above is reviewable in the Error Logs
// page without shell access to the host. See DatabaseLoggerProvider for how it
// avoids recursing through EF Core's own logging.
builder.Logging.AddDatabaseLogging(builder.Configuration);

// ── Options ───────────────────────────────────────────────────────────────────
builder.Services.Configure<ScanningOptions>(builder.Configuration.GetSection(ScanningOptions.SectionName));
builder.Services.Configure<AlertOptions>(builder.Configuration.GetSection(AlertOptions.SectionName));
builder.Services.Configure<DemoOptions>(builder.Configuration.GetSection(DemoOptions.SectionName));

// ── Database ──────────────────────────────────────────────────────────────────
// SQLite by default so the app runs with zero setup — the file is created and
// seeded with demo data on first start. Set Database:Provider to "postgres"
// (and a matching connection string) for a real deployment; see INSTALL.md.
var provider = builder.Configuration["Database:Provider"] ?? "sqlite";
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=networkmonitor.db";

builder.Services.AddDbContext<NetworkMonitorDbContext>(options =>
{
    if (provider.Equals("postgres", StringComparison.OrdinalIgnoreCase))
        options.UseNpgsql(connectionString);
    else
        options.UseSqlite(connectionString);
});

// ── Application services ──────────────────────────────────────────────────────
builder.Services.AddSingleton<INmapExecutorService, NmapExecutorService>();
builder.Services.AddSingleton<IScanResultParserService, ScanResultParserService>();
builder.Services.AddScoped<ScanOrchestrator>();
builder.Services.AddScoped<DemoDataSeeder>();
builder.Services.AddScoped<IErrorLogService, ErrorLogService>();
builder.Services.AddHostedService<ScanSchedulerService>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new()
    {
        Title = "NetworkMonitor API",
        Version = "v1",
        Description = "Nmap-driven network discovery, inventory, and monitoring."
    });
    // Ship XML doc comments into Swagger so the API browser is self-documenting.
    var xml = Path.Combine(AppContext.BaseDirectory, "NetworkMonitor.Server.xml");
    if (File.Exists(xml)) c.IncludeXmlComments(xml);
});

var app = builder.Build();

// ── Database bootstrap ────────────────────────────────────────────────────────
// EnsureCreated (not Migrate) keeps the demo provider-agnostic: the same model
// builds a fresh SQLite file or a Postgres schema without per-provider
// migration histories. Generate migrations before your first production deploy.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<NetworkMonitorDbContext>();
    await db.Database.EnsureCreatedAsync();

    var seeder = scope.ServiceProvider.GetRequiredService<DemoDataSeeder>();
    await seeder.SeedIfEmptyAsync();
}

// First in the pipeline so it wraps everything downstream: an exception raised
// anywhere below becomes a logged row and a structured problem+json response
// rather than an empty 500.
app.UseExceptionLogging();

app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers();

// SPA fallback: any non-API route is handled by the React router.
app.MapFallbackToFile("/index.html");

app.Run();

/// <summary>Exposed so the integration tests can spin up the real pipeline.</summary>
public partial class Program { }
