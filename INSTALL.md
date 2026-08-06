# Installing NetworkMonitor

The app is designed to run with zero configuration: SQLite, an auto-created database file, and a seeded demo dataset. This guide covers that path plus every optional step — nmap, Docker, PostgreSQL, and production deployment.

## Contents

- [Prerequisites](#prerequisites)
- [Clone](#clone)
- [Run from Visual Studio](#run-from-visual-studio)
- [Run from the CLI](#run-from-the-cli)
- [Run with Docker](#run-with-docker)
- [The SQLite database and resetting the demo](#the-sqlite-database-and-resetting-the-demo)
- [Switching to PostgreSQL](#switching-to-postgresql)
- [Configuration reference](#configuration-reference)
- [Adding your own site and running a first real scan](#adding-your-own-site-and-running-a-first-real-scan)
- [Running the tests](#running-the-tests)
- [Troubleshooting](#troubleshooting)
- [Production deployment notes](#production-deployment-notes)

## Prerequisites

| Requirement | Needed for | Notes |
|---|---|---|
| [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) | always | `dotnet --version` should print 10.x |
| [Node.js 20+](https://nodejs.org) | always (SPA build/dev server) | npm comes with it |
| [nmap](https://nmap.org/download.html) | **optional** — real scans | Without it the app runs entirely on demo data and shows an "nmap not detected" banner |
| [Docker](https://docs.docker.com/get-docker/) | optional — container path | Compose v2 (`docker compose`) |

### Installing nmap (optional)

- **Windows:** install the [official nmap installer](https://nmap.org/download.html#windows), which bundles **Npcap**. Accept the Npcap step — raw-socket scan types on Windows go through Npcap; without it only TCP connect scans work. The installer adds nmap to `PATH` (open a new terminal afterwards).
- **Debian/Ubuntu:** `sudo apt-get install nmap`
- **Fedora/RHEL:** `sudo dnf install nmap`
- **macOS:** `brew install nmap`

**Privilege caveat:** SYN scans (`-sS`), UDP scans (`-sU`), and OS detection (`-O`) need raw sockets — root/sudo on Linux and macOS, or Administrator + Npcap on Windows. The default `quick`, `deep`, `security`, and `full_port` profiles deliberately use TCP connect (`-sT`) and unprivileged discovery fallbacks so they work without elevation; only the (disabled-by-default) `udp` profile requires privileges. If you customize a profile to use `-sS`/`-sU`/`-O`, run the server elevated or grant nmap capabilities (`sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip $(which nmap)` on Linux).

## Clone

```bash
git clone https://github.com/example/network-monitor.git
cd network-monitor
```

## Run from Visual Studio

1. Open `NetworkMonitor.sln` (Visual Studio 2022 17.12+ with the ASP.NET and Node.js workloads).
2. Set **NetworkMonitor.Server** as the startup project.
3. Press **F5**. The SPA proxy starts the Vite dev server (`npm run dev`) automatically and the browser is redirected to it; the first run performs `npm install` for the client, which takes a minute.

The API and the SPA hot-reload independently — edit C# or TSX and refresh.

## Run from the CLI

Terminal 1 — the API (this also launches Vite via the SPA proxy):

```bash
npm install --prefix networkmonitor.client   # first run only
dotnet run --project NetworkMonitor.Server
```

Two URLs are in play:

- **SPA (open this one):** `https://localhost:5173` — the Vite dev server, which proxies `/api` calls to the API.
- **API:** the URL Kestrel prints at startup (from `Properties/launchSettings.json`; override with `ASPNETCORE_URLS`). Swagger UI is at `<api-url>/swagger` in Development.

If you prefer to run the pieces separately (e.g., the API under a debugger and Vite standalone), start `npm run dev` in `networkmonitor.client/` yourself — the result is the same.

## Run with Docker

```bash
docker compose up --build
```

Then open **http://localhost:8080**. The image installs nmap, so real scans work from inside the container (see the `-sS`/`-sU` privilege caveat above — the container runs as a non-root user, so the TCP-connect default profiles work, the `udp` profile does not). The SQLite file lives on the `networkmonitor-data` volume and survives rebuilds.

To reset the demo data in Docker:

```bash
docker compose down -v   # -v deletes the data volume
docker compose up
```

## The SQLite database and resetting the demo

With no configuration, the server creates `networkmonitor.db` in its working directory:

- `dotnet run` / Visual Studio: `NetworkMonitor.Server/networkmonitor.db`
- Docker: `/data/networkmonitor.db` on the compose volume

On first start the schema is created (`EnsureCreated`) and, because the database is empty and `Demo:SeedOnFirstRun` is `true`, the Northwind Logistics demo estate is seeded: 4 sites, ~120 devices, 14 days of scan history, alerts, CVEs, TLS certificates, and SNMP interface statistics. All demo IPs are RFC 5737 documentation ranges or RFC 1918 private space.

**To reset the demo:** stop the app, delete `networkmonitor.db` (and `networkmonitor.db-shm` / `networkmonitor.db-wal` if present), and restart. The schema and seed data are recreated.

**To start with an empty inventory** (for monitoring your own network): set `Demo:SeedOnFirstRun` to `false` in `appsettings.json` *before* the first run, or delete the `.db` file after setting it.

## Switching to PostgreSQL

SQLite is the default so the demo needs no server. For a real deployment, PostgreSQL is supported natively:

```jsonc
// appsettings.json (or environment variables)
{
  "Database": { "Provider": "postgres" },
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=networkmonitor;Username=netmon;Password=<your-password>"
  }
}
```

As environment variables (e.g., for Docker):

```bash
Database__Provider=postgres
ConnectionStrings__Default="Host=db;Port=5432;Database=networkmonitor;Username=netmon;Password=<your-password>"
```

`docker-compose.yml` contains a commented-out `postgres` service wired up this way.

**EF migrations note:** this build calls `EnsureCreated()` at startup, which builds the schema directly from the model on any provider — convenient for a demo, but it does not use or record EF migrations, so future schema changes cannot be applied incrementally to an existing database. Before a first production deployment, generate a baseline migration and switch startup to `Migrate()`:

```bash
dotnet tool install --global dotnet-ef
cd NetworkMonitor.Server
dotnet ef migrations add Initial
```

`EnsureCreated` and migrations do not mix on the same database — pick one before the schema holds data you care about.

## Configuration reference

All settings live in `NetworkMonitor.Server/appsettings.json` and can be overridden per environment (`appsettings.Development.json`) or by environment variables (`Section__Key=value`).

| Setting | Default | Meaning |
|---|---|---|
| `Database:Provider` | `sqlite` | `sqlite` or `postgres` |
| `ConnectionStrings:Default` | `Data Source=networkmonitor.db` | Provider-appropriate connection string |
| `Scanning:NmapPath` | *(empty)* | Path to the nmap binary; empty means "find `nmap` on `PATH`" |
| `Scanning:TempDirectory` | *(empty)* | Where scan XML files are written; empty means the system temp directory |
| `Scanning:SchedulerEnabled` | `false` *(as shipped)* | Master switch for the background scan loop. Ships **disabled** so a fresh install never scans a network you did not deliberately point it at; set it to `true` once your own sites and networks are configured. On-demand scans from the Scans page work either way. |
| `Scanning:SchedulerTickSeconds` | `60` | How often the scheduler checks for due profiles |
| `Scanning:MaxTargetAddresses` | `65536` | Refuse scan targets larger than this many addresses (a mistyped `/8` is 16.7M hosts) |
| `Alerts:OfflineAfterMissedScans` | `3` | Consecutive missed scans before a device is declared offline |
| `Alerts:CertExpiryWarningDays` | `30` | Warn this many days before a TLS certificate expires |
| `Alerts:InterfaceSaturationPercent` | `85` | SNMP interface utilization percent that counts as saturated |
| `Demo:SeedOnFirstRun` | `true` | Seed the fictional sample estate when the database is empty; set `false` for a real deployment |
| `Demo:CompanyName` | `Northwind Logistics` | Company name shown in the demo dataset and page headers |
| `Logging:LogLevel:Default` | `Information` | Standard ASP.NET Core logging; set `NetworkMonitor.Server` to `Debug` to see nmap argument adjustments and scheduler decisions |

## Adding your own site and running a first real scan

1. Install nmap (above) and confirm the banner is gone — `GET /api/settings/system` should report `nmapAvailable: true`.
2. Optionally set `Demo:SeedOnFirstRun` to `false` and reset the database for a clean inventory.
3. **Sites page** → add a site (key, name, city/state; coordinates if you want it on the map).
4. **Networks** → add a network under that site with a CIDR you are **authorized to scan** — e.g., your lab subnet `192.168.1.0/24`. Creating a network creates the five default scan profiles automatically; `quick` (every 5 min) and `deep` (hourly) are enabled out of the box.
5. Either wait for the scheduler (it ticks every 60 s) or go to **Scans** → run the `quick` profile against the network on demand.
6. Discovered hosts appear on **Devices** with status `new` and raise `new_device` alerts. Subsequent scans move them to `online`/`offline` and start tracking port changes.
7. Tune per-profile nmap arguments and intervals on the network's detail page (`PUT /api/networks/{id}/profiles/{profileType}` under the hood). Mark sensitive hosts as *excluded* on their device page — they are passed to nmap's `--exclude` and never probed.

## Running the tests

```bash
# Server: xUnit unit + integration tests
dotnet test

# Client: Vitest unit tests
cd networkmonitor.client
npm test

# End-to-end: Playwright (starts against a running app)
npx playwright install   # first run only, downloads browsers
npx playwright test
```

## Troubleshooting

**"nmap not detected" banner / scans return 503.** nmap is not on `PATH` for the *server process*. Verify with `nmap --version` in the same shell you start the server from, or set `Scanning:NmapPath` to the full binary path (e.g., `C:\\Program Files (x86)\\Nmap\\nmap.exe`). On Windows, terminals opened before the nmap install won't see the updated `PATH`.

**Scan fails with a raw-socket / permission error** (e.g., "You requested a scan type which requires root privileges"). A profile is using `-sS`, `-sU`, or `-O`. Either run the server elevated, grant nmap raw-socket capabilities (Linux `setcap`, see prerequisites), or switch the profile back to `-sT`. On Windows, make sure Npcap is installed.

**Port already in use at startup.** Another process holds the API port or 5173 (Vite). Change the API port via `ASPNETCORE_URLS=http://localhost:5080`, or Vite's via `npm run dev -- --port 5175`. For Docker, change the left side of `8080:8080` in `docker-compose.yml`.

**Browser warns about the HTTPS certificate / SPA proxy loops.** Trust the ASP.NET Core dev certificate:

```bash
dotnet dev-certs https --trust
```

then restart the browser.

**Empty database / no demo data.** Seeding only happens when the database is empty and `Demo:SeedOnFirstRun` is `true`. If you started once with seeding disabled, delete the `.db` file (and `-shm`/`-wal` siblings), set the flag back to `true`, and restart.

**API calls fail from the SPA with CORS or 404 errors.** In development the Vite dev server proxies `/api` to the API — make sure you are browsing the *Vite* URL (`https://localhost:5173`), not opening `index.html` from disk or a stale port. In production builds there is no CORS at all: the server hosts the SPA from `wwwroot` and serves `/api` same-origin.

**Scans run but find nothing.** Off-subnet scans cannot ARP, so MAC/vendor will be empty — that is expected. If even host discovery finds nothing, check that a firewall between the server and the target subnet is not dropping probes, and try the `quick` profile from a host on the same VLAN.

## Production deployment notes

This build is a demo — remember it has **no authentication** (see README, "Security model"). If you deploy anything derived from it:

- **Publish:** `dotnet publish NetworkMonitor.Server -c Release -o /opt/networkmonitor -p:SkipSpaBuild=true`, build the SPA separately (`npm run build` in `networkmonitor.client/`) and copy `dist/` into the publish folder's `wwwroot/`. Or just ship the Docker image, which does exactly that.
- **Reverse proxy + HTTPS:** put nginx/Caddy/IIS in front, terminate TLS there, and forward to Kestrel on localhost. Do not expose Kestrel directly.
- **Run as a service:** a systemd unit with `User=` a dedicated non-root account, `WorkingDirectory=` the publish folder, `ExecStart=/usr/bin/dotnet NetworkMonitor.Server.dll`, and `Restart=on-failure`. On Windows, use a Windows Service wrapper or IIS.
- **Database:** switch to PostgreSQL and to EF migrations (above) before the data matters.
- **Backups:** for SQLite, stop the service or use `sqlite3 networkmonitor.db ".backup"` — copying a live `.db` mid-write can corrupt the copy; include the `-wal` file if you copy cold. For PostgreSQL, `pg_dump` on a schedule.
- **Scan conduct:** keep `Scanning:MaxTargetAddresses` conservative, use device exclusion for fragile equipment (some embedded/industrial devices react badly to port scans), and get written authorization for every subnet you point it at.
