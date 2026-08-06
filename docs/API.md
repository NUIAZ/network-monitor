# API reference

All endpoints are unauthenticated in this build (see README, "Security model").
Base path `/api`. Swagger UI is served at `/swagger` in Development.

## Dashboard

| Method | Route | Returns |
|---|---|---|
| GET | `/api/dashboard/summary` | `{ totalDevices, onlineDevices, offlineDevices, newDevices24h, openAlerts, criticalAlerts, sites, networks, lastScanAt, openVulnerabilities, criticalVulnerabilities, expiringCerts, nmapAvailable, nmapVersion }` |
| GET | `/api/dashboard/device-types` | `[{ deviceType, count }]` |
| GET | `/api/dashboard/scan-activity?days=14` | `[{ date, scans, hostsUp, newDevices }]` |
| GET | `/api/dashboard/alert-trend?days=14` | `[{ date, info, warning, critical }]` |

## Sites & networks

| Method | Route | Notes |
|---|---|---|
| GET | `/api/sites` | Site list, each with `networkCount` and `deviceCount` |
| GET | `/api/sites/{id}` | Single site including its networks |
| POST | `/api/sites` | Body: `{ siteKey, name, city, state, latitude, longitude }` |
| PUT | `/api/sites/{id}` | Same body |
| DELETE | `/api/sites/{id}` | Cascades to networks and devices |
| GET | `/api/networks?siteId=` | Network list with `deviceCount`, `lastScanAt` |
| GET | `/api/networks/{id}` | Single network including scan profiles |
| POST | `/api/networks` | Body: `{ siteId, name, cidr, description, scanIntervalSeconds, deepScanIntervalSeconds }` — creates the five default scan profiles |
| PUT | `/api/networks/{id}` | Same body plus `isEnabled` |
| DELETE | `/api/networks/{id}` | |
| PUT | `/api/networks/{id}/profiles/{profileType}` | Body: `{ nmapArgs, intervalSeconds, isEnabled }` |

## Devices

| Method | Route | Notes |
|---|---|---|
| GET | `/api/devices` | Query: `siteId, networkId, status, deviceType, search, page=1, pageSize=50, sort` → `{ items, page, pageSize, total, totalPages }` |
| GET | `/api/devices/{id}` | Includes `ports`, recent `alerts`, `vulnerabilities`, `certificates` |
| GET | `/api/devices/{id}/history?days=7` | `[{ recordedAt, status, openPortCount, responseTimeMs }]` |
| PUT | `/api/devices/{id}` | Operator fields: `{ hostname, hardware, physicalLocation, assignedTo, notes, isFlagged, isExcluded, deviceType }` |
| DELETE | `/api/devices/{id}` | |
| GET | `/api/devices/topology?siteId=` | `{ sites: [{ id, name, networks: [{ id, name, cidr, devices: [{ id, ip, hostname, deviceType, status }] }] }] }` |

## Scans

| Method | Route | Notes |
|---|---|---|
| GET | `/api/scans` | Query: `networkId, status, page, pageSize` → paged `{ id, networkId, networkName, siteName, scanType, startedAt, completedAt, durationSeconds, hostsUp, hostsDown, newDevices, status, failureReason }` |
| GET | `/api/scans/{id}` | Single scan with its device snapshots |
| POST | `/api/scans/run` | Body: `{ networkId, profileType }` — runs a real nmap scan, returns the completed `ScanResult`. 503 when nmap is missing |
| GET | `/api/scans/profiles` | The five built-in profile definitions and what each is for |

## Alerts

| Method | Route | Notes |
|---|---|---|
| GET | `/api/alerts` | Query: `severity, alertType, acknowledged, siteId, page, pageSize` → paged, newest first |
| POST | `/api/alerts/{id}/acknowledge` | Body: `{ acknowledgedBy }` |
| POST | `/api/alerts/acknowledge-all` | Body: `{ severity?, acknowledgedBy }` |
| DELETE | `/api/alerts/{id}` | |

## Security

| Method | Route | Notes |
|---|---|---|
| GET | `/api/vulnerabilities` | Query: `severity, status, siteId, search, page, pageSize`; each row carries `deviceIp`, `deviceHostname`, `siteName` |
| PUT | `/api/vulnerabilities/{id}/status` | Body: `{ status }` — `open`, `remediated`, `accepted_risk` |
| GET | `/api/certificates` | Query: `expiringWithinDays, siteId, page, pageSize`; each row carries `daysUntilExpiry`, `deviceIp` |

## SNMP

| Method | Route | Notes |
|---|---|---|
| GET | `/api/snmp/targets` | Targets with latest per-interface rollup: `{ id, name, ipAddress, model, siteName, interfaceCount, upCount, maxUtilization, lastPolledAt }` |
| GET | `/api/snmp/targets/{id}/interfaces` | Latest snapshot per interface |
| GET | `/api/snmp/targets/{id}/utilization?hours=24` | Time series per interface for charting |

## Error logs

Application logging and errors from both tiers land in one table. Server-side
entries arrive two ways: the exception middleware records anything that escapes
a controller, and a custom `ILoggerProvider` persists `ILogger` calls — so any
`_logger.LogInformation/LogWarning/LogError(...)` in the codebase is reviewable
in the UI without shell access. Browser failures are posted back by the client's
error reporter.

The sink applies **two thresholds**, because "what is my application doing" and
"what is the framework saying" want very different levels:

| Setting | Default | Applies to |
|---|---|---|
| `Logging:Database:ApplicationMinimumLevel` | `Information` | Categories under `NetworkMonitor.Server` — scans starting and finishing, scheduler decisions, seeding |
| `Logging:Database:MinimumLevel` | `Warning` | Everything else — ASP.NET logs every request at Information, and persisting that makes the table unreadable |

EF Core, the SQLite/Npgsql providers, and the log writer's own categories are
excluded outright: they sit on the path that writes the row, so logging them
would feed the sink with its own output.

`level` values are `info`, `warning`, `error`, and `fatal`.

| Method | Route | Notes |
|---|---|---|
| GET | `/api/logs` | Query: `source` (`server`/`client`), `level` (`warning`/`error`/`fatal`), `search`, `resolved`, `page`, `pageSize` (max 200) → paged, newest first |
| GET | `/api/logs/summary` | `{ total, last24Hours, serverErrors, clientErrors, unresolved }` |
| POST | `/api/logs/client-error` | Body: `{ message, exceptionType, stackTrace, path, level, correlationId }` → 202. Deliberately permissive: an already-broken browser should not have to handle an error from the error reporter |
| PUT | `/api/logs/{id}/resolved` | Body: `{ isResolved }` |
| DELETE | `/api/logs?olderThanDays=30` | Purges old entries; returns `{ removed }`. The error log is the one table a misbehaving deployment can grow without bound |

Unhandled server exceptions return RFC 7807 `application/problem+json` carrying
a `correlationId`. The client sends that id back when it reports the resulting
failure, so one incident is one searchable value rather than two unlinked rows.
Exception detail appears in the response body only outside Production.

## Settings

| Method | Route | Notes |
|---|---|---|
| GET | `/api/settings` | All key/value settings |
| PUT | `/api/settings/{key}` | Body: `{ value }` |
| GET | `/api/settings/system` | `{ version, nmapAvailable, nmapVersion, schedulerEnabled, provider, demoMode, companyName }` |
