using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NetworkMonitor.Server.Context;

namespace NetworkMonitor.Tests;

/// <summary>
/// A throwaway database for one test class.
///
/// SQLite in-memory rather than the EF in-memory provider on purpose: the EF
/// provider is not a relational database and will happily accept duplicate keys,
/// ignore cascade rules, and let broken queries pass. Several behaviours under
/// test here, the unique (network, ip) device constraint and cascade deletes,
/// only exist at the relational layer, so the tests have to run against one.
///
/// The connection is held open for the lifetime of the instance because SQLite
/// discards an in-memory database the moment its last connection closes.
/// </summary>
public sealed class TestDb : IDisposable
{
    private readonly SqliteConnection _connection;

    public NetworkMonitorDbContext Context { get; }

    public TestDb()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<NetworkMonitorDbContext>()
            .UseSqlite(_connection)
            .Options;

        Context = new NetworkMonitorDbContext(options);
        Context.Database.EnsureCreated();
    }

    /// <summary>
    /// Returns a second context over the same database. Use this to assert on
    /// state without EF's change tracker handing back the same cached instances
    /// the code under test just mutated.
    /// </summary>
    public NetworkMonitorDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<NetworkMonitorDbContext>()
            .UseSqlite(_connection)
            .Options;
        return new NetworkMonitorDbContext(options);
    }

    public void Dispose()
    {
        Context.Dispose();
        _connection.Dispose();
    }
}
