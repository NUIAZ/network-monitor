/**
 * TypeScript mirrors of every response shape in docs/API.md.
 *
 * The server serializes with System.Text.Json defaults (camelCase), so these
 * interfaces are the entity/DTO shapes with camelCased keys. Fields the API
 * only sometimes includes (list-row denormalizations like `siteName`, or
 * navigation collections that only appear on detail endpoints) are optional so
 * a component can never assume data the endpoint it called doesn't send.
 */

/** Standard paged envelope: `{ items, page, pageSize, total, totalPages }`. */
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Every headline number on the dashboard, in one round trip.
 *
 * All device counts exclude devices marked `isExcluded`, so the tiles reconcile
 * with what the inventory list shows. Worth knowing before you try to make the
 * arithmetic work: `onlineDevices + offlineDevices` need not equal
 * `totalDevices`, because a device still in the `new` state counts in neither.
 */
export interface DashboardSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  /** First seen within a rolling 24 hours, not "since midnight". */
  newDevices24h: number;
  /** Unacknowledged, any severity. */
  openAlerts: number;
  /** Subset of openAlerts at severity 'critical'. */
  criticalAlerts: number;
  sites: number;
  /** Configured networks, counted whether or not they are enabled. */
  networks: number;
  /** Start time of the newest scan of any type. Null until something has scanned. */
  lastScanAt: string | null;
  /** Status 'open' only; remediated and accepted-risk findings are excluded. */
  openVulnerabilities: number;
  criticalVulnerabilities: number;
  /**
   * Certificates inside the expiry warning window (30 days by default).
   * Already-expired certificates are counted here too; an expired cert is the
   * most urgent member of the set, not a separate category.
   */
  expiringCerts: number;
  /**
   * Whether the server can execute nmap *right now*; re-checked per request
   * rather than cached at startup, so the "install nmap" banner reflects the
   * host as it currently is. False is not fatal; every screen still works off
   * stored data, only new scans are unavailable.
   */
  nmapAvailable: boolean;
  /** First line of `nmap --version`. Null whenever nmapAvailable is false. */
  nmapVersion: string | null;
}

/** One slice of the device-type donut. Sorted by count descending by the server. */
export interface DeviceTypeCount {
  /** One of DEVICE_TYPES: the classifier's own vocabulary, not free text. */
  deviceType: string;
  count: number;
}

/** A day in the scan-activity chart. */
export interface ScanActivityPoint {
  /** Calendar day in UTC as 'yyyy-MM-dd', chosen so points sort lexically. */
  date: string;
  /** Scans started that day. Days with no scans are still emitted, zero-filled,
   *  so the x-axis stays continuous rather than skipping over quiet days. */
  scans: number;
  /**
   * The *peak* hosts-up across that day's scans, deliberately not the sum:
   * adding up repeat scans of one network would count the same devices over
   * and over and make a busy schedule look like a growing estate.
   */
  hostsUp: number;
  /** Genuinely a daily total: a device is only ever discovered once. */
  newDevices: number;
}

/** A day in the alert-trend chart, split into the stacked bar's three segments. */
export interface AlertTrendPoint {
  /** Calendar day in UTC as 'yyyy-MM-dd'; zero-filled like ScanActivityPoint. */
  date: string;
  info: number;
  warning: number;
  critical: number;
}

// ---------------------------------------------------------------------------
// Sites & networks
// ---------------------------------------------------------------------------

/** A physical location. Deleting one cascades through its networks to their devices. */
export interface Site {
  id: number;
  /**
   * Short uppercase key shown in filters and badges (e.g. 'DAL'). Max 20 chars,
   * uppercased on write, and unique; a collision is rejected with a 409 rather
   * than silently renamed.
   */
  siteKey: string;
  name: string;
  /** Display only; nothing keys on it. */
  city: string | null;
  /** Two-letter abbreviation, uppercased on write. */
  state: string | null;
  /** Null keeps the site off the facility map. Range -90..90. */
  latitude: number | null;
  /** Null hides the site from the map, same as a null latitude. Range -180..180. */
  longitude: number | null;
  createdAt?: string;
  /** List-endpoint rollups. */
  networkCount?: number;
  deviceCount?: number;
  /** Present on GET /api/sites/{id}. */
  networks?: NetworkInfo[];
}

/**
 * Body for both POST and PUT /api/sites, the two operations validate
 * identically, so there is one shape rather than two that drift apart.
 */
export interface SitePayload {
  siteKey: string;
  name: string;
  city: string;
  /** Two letters, or empty. Anything else is rejected. */
  state: string;
  latitude: number | null;
  longitude: number | null;
}

/** A scannable address range belonging to a site. */
export interface NetworkInfo {
  id: number;
  siteId: number;
  name: string;
  /**
   * Target range in CIDR notation (e.g. '203.0.113.0/24'), or a bare IPv4
   * address. This string reaches an external process's command line, so
   * anything that is not one of those two forms is rejected outright rather
   * than escaped. A range covering more than 65,536 addresses is also refused:
   * a mistyped /8 is 16.7M hosts and would scan for days.
   */
  cidr: string;
  description: string | null;
  /** Cadence of the quick host-discovery profile, in seconds. Defaults to 300. */
  scanIntervalSeconds: number;
  /** Cadence of the deep service-detection profile, in seconds. Defaults to 3600. */
  deepScanIntervalSeconds: number;
  /**
   * False parks the network: the scheduler skips it entirely, but everything
   * already discovered is kept. This is the safe way to stop scanning a range
   * without losing what is known about it.
   */
  isEnabled: boolean;
  createdAt?: string;
  siteName?: string;
  /** List-endpoint rollups. */
  deviceCount?: number;
  lastScanAt?: string | null;
  /** Present on GET /api/networks/{id}. */
  scanProfiles?: ScanProfile[];
}

/**
 * Body for POST and PUT /api/networks. Creating a network also materializes its
 * five scan profiles server-side, so nothing else has to be posted to make the
 * range scannable.
 */
export interface NetworkPayload {
  siteId: number;
  name: string;
  cidr: string;
  description: string;
  /** Omitted or non-positive means 300 on create, "leave as-is" on update. */
  scanIntervalSeconds: number;
  /** Omitted or non-positive means 3600 on create, "leave as-is" on update. */
  deepScanIntervalSeconds: number;
  /** Omitted on update leaves the current setting rather than re-enabling. */
  isEnabled?: boolean;
}

/**
 * One of the five scan profiles attached to a network. The set is fixed (one
 * of each type per network), so profiles are addressed by `profileType` rather
 * than by id (it is the route segment for PUT /api/networks/{id}/profiles/{type}).
 */
export interface ScanProfile {
  id: number;
  networkId: number;
  /**
   * One of 'quick', 'deep', 'security', 'full_port', 'udp'. The three heavy
   * ones ship disabled so a new network cannot start a week-long full-port
   * sweep on its own.
   */
  profileType: string;
  /** nmap flags, minus the target and output flags the executor appends. */
  nmapArgs: string;
  /** Seconds between scheduled runs. */
  intervalSeconds: number;
  /** False leaves the profile configured but never scheduled; it can still be run on demand. */
  isEnabled: boolean;
  /**
   * When the last run *started*, not when it finished; that is what the
   * scheduler's "is it due" check keys on. Null means never ran, which the
   * scheduler treats as immediately due.
   */
  lastRunAt: string | null;
}

/** Body for PUT /api/networks/{id}/profiles/{profileType}. */
export interface ScanProfilePayload {
  /** Blank keeps the existing args rather than clearing them. */
  nmapArgs: string;
  /** Must be positive to take effect. */
  intervalSeconds: number;
  isEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Lifecycle values the server assigns to a device. */
export type DeviceStatus = 'new' | 'online' | 'offline';

/** The classifier's known device types, used for filters and icon mapping. */
export const DEVICE_TYPES = [
  'router',
  'switch',
  'firewall',
  'printer',
  'server',
  'workstation',
  'camera',
  'unknown',
] as const;

/**
 * A single discovered host.
 *
 * The fields split into two halves that must not be confused: the discovery
 * half (IP, MAC, vendor, status, the seen-timestamps) is owned by the scanner
 * and overwritten on every run, while the operator half (hostname, hardware,
 * physicalLocation, assignedTo, notes, the two flags) is owned by a human and
 * is what DeviceUpdatePayload is allowed to touch.
 */
export interface Device {
  id: number;
  networkId: number;
  /** Unique per network, so a repeat scan updates this row rather than duplicating it. */
  ipAddress: string;
  /** Colon-separated. Null when the scan ran off-subnet, since MAC only resolves via ARP. */
  macAddress: string | null;
  hostname: string | null;
  /** Resolved from the MAC OUI prefix (e.g. 'Cisco Systems'). Null whenever the MAC is. */
  vendor: string | null;
  /** Best-guess OS fingerprint; only populated by profiles that run OS detection. */
  osGuess: string | null;
  /**
   * One of DEVICE_TYPES. Inferred from OS, vendor, open ports and hostname by
   * an ordered rule set where the first match wins, so a printer that also
   * serves a web UI is still a printer. Re-classification only happens when a
   * scan actually learned something: a quick ping sweep must not downgrade a
   * device that a deep scan had already typed.
   */
  deviceType: string;
  /** One of DeviceStatus: 'new', 'online' or 'offline'. */
  status: string;
  /** The first scan that ever saw this address on this network. */
  firstSeen: string;
  /** The last scan in which the device actually answered. */
  lastSeen: string;
  /**
   * The last scan that *covered* this device, whether or not it answered.
   * Compare against lastSeen to tell "quiet" apart from "not looked at";
   * they look identical if you only read one of the two.
   */
  lastScannedAt: string | null;
  /**
   * Operator marker for follow-up. Purely a UI signal: nothing in the scanning
   * pipeline reads it. It exists to survive a shift change.
   */
  isFlagged: boolean;
  /**
   * Unlike isFlagged, this one has teeth. The address is passed to nmap's
   * --exclude, so the host is never probed at all rather than probed and then
   * filtered out; it also raises no alerts and is left out of every dashboard
   * count, list and topology response.
   */
  isExcluded: boolean;
  notes: string | null;
  hardware: string | null;
  physicalLocation: string | null;
  assignedTo: string | null;
  /**
   * Consecutive scans that covered this device and got no answer; reset to 0 on
   * any successful sighting. At 3 the device flips to 'offline' and raises a
   * critical alert: the threshold is above 1 so one dropped probe cannot page
   * anyone.
   */
  missedScans: number;
  /** Denormalized names, when the endpoint includes them. */
  networkName?: string;
  siteName?: string;
  network?: NetworkInfo | null;
  /** Detail-endpoint collections. */
  ports?: DevicePort[];
  alerts?: Alert[];
  vulnerabilities?: Vulnerability[];
  certificates?: SslCertificate[];
}

/** Body for PUT /api/devices/{id}, only the operator-owned fields. */
export interface DeviceUpdatePayload {
  hostname: string | null;
  hardware: string | null;
  physicalLocation: string | null;
  assignedTo: string | null;
  notes: string | null;
  isFlagged: boolean;
  isExcluded: boolean;
  deviceType: string;
}

/**
 * One port observed on a device.
 *
 * Reconciliation only runs when a scan actually probed ports: a ping sweep
 * returns none, and must not be read as "everything closed".
 */
export interface DevicePort {
  id: number;
  deviceId: number;
  /** 1-65535. */
  portNumber: number;
  /**
   * 'tcp' or 'udp'. Part of the identity of a port alongside the number, since
   * the same number can be open on both at once.
   */
  protocol: string;
  /** 'open', 'filtered' or 'closed', and 'unknown' when the scan reported no state. */
  state: string;
  /** A guess from the port number alone unless the profile ran version detection. */
  serviceName: string | null;
  /** Product, version and extra info. Only populated by profiles running version detection. */
  serviceVersion: string | null;
  /** When the port was first observed open. */
  firstSeen: string;
  /** The last scan that observed it in this state. */
  lastSeen: string;
}

/**
 * One point in a device's availability chart, sourced from the per-scan
 * snapshots rather than from the device row, which only holds current state.
 */
export interface DeviceHistoryPoint {
  recordedAt: string;
  /** 'online' or 'offline'. */
  status: string;
  /** A step change here is usually the interesting part of the chart. */
  openPortCount: number;
  /**
   * Round-trip latency in milliseconds. Null when the scan did not measure it:
   * either the host was down, or the profile reports no timing at all.
   */
  responseTimeMs: number | null;
}

// ---------------------------------------------------------------------------
// Topology (GET /api/devices/topology)
// ---------------------------------------------------------------------------

/**
 * A device as the map draws it: deliberately the four fields a node needs and
 * nothing else, because this payload carries the whole estate at once.
 */
export interface TopologyDevice {
  id: number;
  /** The node label when there is no hostname. */
  ip: string;
  /** Preferred node label. */
  hostname: string | null;
  /** Drives the node icon. */
  deviceType: string;
  /** Drives the node colour. */
  status: string;
}

/** Networks are ordered by name; their devices by IP. */
export interface TopologyNetwork {
  id: number;
  name: string;
  cidr: string;
  /** Excluded devices are omitted entirely rather than drawn greyed out. */
  devices: TopologyDevice[];
}

/** Sites are ordered by siteKey, not by name. */
export interface TopologySite {
  id: number;
  name: string;
  networks: TopologyNetwork[];
}

/**
 * The whole site → network → device tree in one nested payload, rather than
 * three chained requests: the map cannot lay anything out until it has the
 * complete picture. The `siteId` query parameter narrows it to one site.
 */
export interface TopologyResponse {
  sites: TopologySite[];
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

/**
 * One run of one scan profile against one network.
 *
 * A failed scan still arrives over HTTP 200; the request succeeded even though
 * the scan did not, so callers must check `status` rather than trusting the
 * status code.
 */
export interface ScanResult {
  id: number;
  networkId: number;
  networkName?: string;
  siteName?: string;
  /** The profile that ran: 'quick', 'deep', 'security', 'full_port' or 'udp'. */
  scanType: string;
  /** The exact command line executed, so a result can be reproduced by hand.
   *  Detail endpoint only. */
  nmapCommand?: string | null;
  /** Written before nmap starts, so a crashed run still leaves evidence. */
  startedAt: string;
  /** Null while the scan is still running. */
  completedAt: string | null;
  /**
   * Wall-clock seconds to one decimal, computed server-side because timespan
   * arithmetic translates differently on each database provider.
   */
  durationSeconds?: number | null;
  /** Addresses that answered discovery. */
  hostsUp: number;
  /** Addresses in range that did not answer. */
  hostsDown: number;
  newDevices: number;
  /** 'running', 'completed' or 'failed'. */
  status: string;
  /** Usually nmap's stderr text. Null on success. */
  failureReason: string | null;
  /**
   * Devices skipped via --exclude, captured at scan start. Recorded so that a
   * drop in hostsUp is explainable rather than alarming.
   */
  excludedCount?: number;
  snapshots?: ScanDeviceSnapshot[];
}

/**
 * What one scan saw of one device. These rows are what make the history view
 * possible at all: the device row only ever holds current state, so without a
 * per-scan record there would be nothing to plot.
 */
export interface ScanDeviceSnapshot {
  id: number;
  scanResultId: number;
  deviceId: number;
  /**
   * An observation, not a lifecycle state: 'online' when the device answered,
   * otherwise 'offline' or 'missed' depending on what the device was already
   * marked as. Never 'new'; that belongs to the device, not to a sighting.
   */
  status: string;
  openPortCount: number;
  /** Milliseconds. Null when the scan measured no timing. */
  responseTimeMs: number | null;
  recordedAt: string;
  device?: Device | null;
}

/** One of the five built-in profile definitions from GET /api/scans/profiles. */
export interface ScanProfileDefinition {
  profileType: string;
  nmapArgs?: string;
  intervalSeconds?: number;
  isEnabled?: boolean;
  name?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** Drives colour and notification routing, not just presentation. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Every alert the change detector can raise; also the filter list on the alerts page. */
export const ALERT_TYPES = [
  'new_device',
  'device_offline',
  'device_online',
  'port_opened',
  'port_closed',
  'cert_expiring',
  'vulnerability',
] as const;

/** One entry in the change feed, something the scanner noticed differed from last time. */
export interface Alert {
  id: number;
  /**
   * Nulled when the device is deleted, so alert history outlives the inventory.
   * The denormalized deviceIp/deviceHostname below are what keep the row
   * readable after that happens.
   */
  deviceId: number | null;
  /** Set even for alerts that are not about one specific device. */
  networkId: number | null;
  /** One of ALERT_TYPES. */
  alertType: string;
  /** One of AlertSeverity. */
  severity: string;
  /** Written to stand on its own in a feed with no surrounding context. */
  message: string;
  details: string | null;
  /** Acknowledged alerts drop out of the default feed but are never deleted automatically. */
  isAcknowledged: boolean;
  /**
   * Unverified free text. This build has no authentication, so treat it as a
   * claim about who acknowledged the alert, not as an identity.
   */
  acknowledgedBy: string | null;
  /** Null while the alert is still open. */
  acknowledgedAt: string | null;
  createdAt: string;
  /** Denormalized device identity when the list endpoint includes it. */
  deviceIp?: string | null;
  deviceHostname?: string | null;
  siteName?: string | null;
  device?: Device | null;
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/**
 * Triage state. 'accepted_risk' is a decision someone made, not a lesser form
 * of 'open', which is why the queue counts only 'open' as outstanding.
 */
export type VulnerabilityStatus = 'open' | 'remediated' | 'accepted_risk';

/** A CVE matched against a service version that a scan discovered. */
export interface Vulnerability {
  id: number;
  deviceId: number;
  /** e.g. 'CVE-2021-44228'. */
  cveId: string;
  /** CVSS v3 base score, 0.0-10.0. Null when the source gave no score; lists sort worst-first on it. */
  cvssScore: number | null;
  /** 'critical', 'high', 'medium' or 'low'. */
  severity: string;
  description: string | null;
  /** The service version string that matched, e.g. 'OpenSSH 7.4'. */
  affectedService: string | null;
  /** Null for host-level findings that are not tied to one port. */
  portNumber: number | null;
  /** One of VulnerabilityStatus. */
  status: string;
  /**
   * Not re-stamped when a later scan confirms the finding again, so this reads
   * as "how long has this been open" rather than "when did we last see it".
   */
  detectedAt: string;
  /** Denormalized rows from the list endpoint. */
  deviceIp?: string;
  deviceHostname?: string | null;
  siteName?: string;
}

/** A TLS certificate seen on an open port. One device can serve several, keyed by port. */
export interface SslCertificate {
  id: number;
  deviceId: number;
  portNumber: number;
  subject: string | null;
  /** Compare with subject to spot self-signed certs that isSelfSigned missed. */
  issuer: string | null;
  /** A future value means the certificate is not valid yet. */
  validFrom: string | null;
  /** What the expiry warning and the dashboard tile key on. Nulls sort last. */
  validTo: string | null;
  /** e.g. 'rsa' or 'ec'. */
  keyType: string | null;
  /** Key size in bits. Small values on an RSA key are the reason this is surfaced at all. */
  keyBits: number | null;
  /** Normal for appliance management interfaces, and alarming almost everywhere else. */
  isSelfSigned: boolean;
  detectedAt: string;
  /**
   * Not stored: computed server-side against request time so every client
   * agrees on it. Negative means already expired; absent when validTo is unknown.
   */
  daysUntilExpiry?: number;
  /** Denormalized rows from the list endpoint. */
  deviceIp?: string;
  deviceHostname?: string | null;
  siteName?: string;
}

// ---------------------------------------------------------------------------
// SNMP
// ---------------------------------------------------------------------------

/**
 * A row in the switch rail. SNMP targets hang off sites rather than networks,
 * because a core switch often carries every VLAN at once and belongs to no one
 * range. The community string is never sent to the client.
 */
export interface SnmpTargetSummary {
  id: number;
  name: string;
  ipAddress: string;
  model: string | null;
  siteName: string | null;
  /**
   * Interfaces seen in the last 48 hours of polling, not the device's lifetime
   * total: the window bounds the work regardless of how long history is kept.
   */
  interfaceCount: number;
  /** Of those interfaces, how many are currently 'up'. */
  upCount: number;
  /** Worst interface utilization on the device, percent 0-100. Zero when never polled. */
  maxUtilization: number;
  lastPolledAt: string | null;
}

/** One interface as of one poll. */
export interface InterfaceSnapshot {
  id?: number;
  snmpTargetId?: number;
  /**
   * SNMP ifIndex: an interface's identity within its device, but stable only
   * until the device reboots or is re-carded, so it is not a durable key.
   */
  ifIndex: number;
  ifName: string;
  ifAlias: string | null;
  /**
   * Negotiated speed in bits per second. This is the denominator for
   * utilizationPercent, so a wrong value here makes utilization meaningless.
   */
  speedBps: number;
  /** ifOperStatus: 'up', 'down' or 'testing'. */
  operStatus: string;
  /** Raw cumulative counter at poll time. Wraps, so only deltas mean anything;
   *  a wrapping or reset counter shows up here as a drop. */
  inOctets: number;
  /** Same wrapping caveat as inOctets. */
  outOctets: number;
  /** Cumulative error counter. A rising delta usually means a cable or duplex problem. */
  inErrors: number;
  outErrors: number;
  /**
   * 0-100, derived from the octet delta since the previous poll for this same
   * interface against speedBps. The delta window is therefore the gap between
   * consecutive rows, not a fixed interval.
   */
  utilizationPercent: number;
  recordedAt: string;
}

/**
 * A single utilization sample. The /utilization endpoint returns a time series
 * per interface; the client groups samples by interface name for charting.
 */
export interface UtilizationSample {
  ifIndex: number;
  ifName: string;
  recordedAt: string;
  utilizationPercent: number;
}

// ---------------------------------------------------------------------------
// Error logs
// ---------------------------------------------------------------------------

/** Which tier produced the entry, the API host or a browser session. */
export type ErrorLogSource = 'server' | 'client';

/**
 * Severity the server persists.
 *
 * `info` is routine application activity (a scan starting, the scheduler
 * deciding what is due), captured because the database sink applies a lower
 * threshold to the application's own log categories than to the framework's.
 * `fatal` is reserved for failures that took a request or a screen down.
 */
export type ErrorLogLevel = 'info' | 'warning' | 'error' | 'fatal';

/** Filter options rendered by the Activity & Errors page, most severe first. */
export const ERROR_LOG_LEVELS: ErrorLogLevel[] = ['fatal', 'error', 'warning', 'info'];

/**
 * One row of `exception_logs`. Most fields are request-scoped and therefore
 * only present on server entries (`method`, `statusCode`) or only on browser
 * entries (`userAgent`), so everything optional on the wire is nullable here.
 */
export interface ErrorLogEntry {
  id: number;
  source: string;
  level: string;
  message: string;
  exceptionType: string | null;
  stackTrace: string | null;
  path: string | null;
  method: string | null;
  statusCode: number | null;
  userAgent: string | null;
  /** Ties a browser report to the server exception that caused it. */
  correlationId: string | null;
  occurredAt: string;
  isResolved: boolean;
}

/** GET /api/logs/summary: the five numbers the page tiles. */
export interface ErrorLogSummary {
  total: number;
  last24Hours: number;
  serverErrors: number;
  clientErrors: number;
  unresolved: number;
}

/** Body of POST /api/logs/client-error, built by services/errorLogger.ts. */
export interface ClientErrorReport {
  message: string;
  exceptionType: string;
  stackTrace: string | null;
  path: string;
  level: ErrorLogLevel;
  correlationId: string | null;
}

/** DELETE /api/logs?olderThanDays=: how many rows the purge removed. */
export interface ErrorLogPurgeResult {
  removed: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * One editable row on the settings page. Rows are created by the installer, not
 * by clients: PUT addresses a setting by `key` and an unknown key 404s rather
 * than upserting, so a typo cannot litter the table with orphan settings.
 */
export interface AppSetting {
  id: number;
  /** Unique, and the route segment for PUT /api/settings/{key}. */
  key: string;
  /** Always a string on the wire however it is interpreted. Null is a valid,
   *  stored value: it is how a setting gets cleared. */
  value: string | null;
  /** Rendered as help text beside the field. */
  description: string | null;
  updatedAt: string;
}

/** Build and host facts for the settings page footer. */
export interface SystemInfo {
  /** Informational version with the git-sha suffix already trimmed server-side,
   *  because the full 40-char suffix overflows the sidebar footer it renders into. */
  version: string;
  /** Live check, same as the dashboard's, not a startup snapshot. */
  nmapAvailable: boolean;
  nmapVersion: string | null;
  /**
   * Ships off. A freshly cloned install must never start probing whatever
   * network it happens to land on; scanning is turned on deliberately, once the
   * configured ranges are ones you are authorized to scan.
   */
  schedulerEnabled: boolean;
  /** Database provider in use: 'sqlite' or 'postgres'. */
  provider: string;
  /** True when first-run seeding is enabled, i.e. the inventory on screen may be
   *  fictional sample data rather than a real estate. */
  demoMode: boolean;
  /** Organisation name shown in headers, so the demo can be rebranded from config. */
  companyName: string;
}
