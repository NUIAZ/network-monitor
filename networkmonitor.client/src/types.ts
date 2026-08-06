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

export interface DashboardSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  newDevices24h: number;
  openAlerts: number;
  criticalAlerts: number;
  sites: number;
  networks: number;
  lastScanAt: string | null;
  openVulnerabilities: number;
  criticalVulnerabilities: number;
  expiringCerts: number;
  nmapAvailable: boolean;
  nmapVersion: string | null;
}

export interface DeviceTypeCount {
  deviceType: string;
  count: number;
}

export interface ScanActivityPoint {
  date: string;
  scans: number;
  hostsUp: number;
  newDevices: number;
}

export interface AlertTrendPoint {
  date: string;
  info: number;
  warning: number;
  critical: number;
}

// ---------------------------------------------------------------------------
// Sites & networks
// ---------------------------------------------------------------------------

export interface Site {
  id: number;
  siteKey: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt?: string;
  /** List-endpoint rollups. */
  networkCount?: number;
  deviceCount?: number;
  /** Present on GET /api/sites/{id}. */
  networks?: NetworkInfo[];
}

export interface SitePayload {
  siteKey: string;
  name: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}

export interface NetworkInfo {
  id: number;
  siteId: number;
  name: string;
  cidr: string;
  description: string | null;
  scanIntervalSeconds: number;
  deepScanIntervalSeconds: number;
  isEnabled: boolean;
  createdAt?: string;
  siteName?: string;
  /** List-endpoint rollups. */
  deviceCount?: number;
  lastScanAt?: string | null;
  /** Present on GET /api/networks/{id}. */
  scanProfiles?: ScanProfile[];
}

export interface NetworkPayload {
  siteId: number;
  name: string;
  cidr: string;
  description: string;
  scanIntervalSeconds: number;
  deepScanIntervalSeconds: number;
  isEnabled?: boolean;
}

export interface ScanProfile {
  id: number;
  networkId: number;
  profileType: string;
  nmapArgs: string;
  intervalSeconds: number;
  isEnabled: boolean;
  lastRunAt: string | null;
}

export interface ScanProfilePayload {
  nmapArgs: string;
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

export interface Device {
  id: number;
  networkId: number;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  vendor: string | null;
  osGuess: string | null;
  deviceType: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
  lastScannedAt: string | null;
  isFlagged: boolean;
  isExcluded: boolean;
  notes: string | null;
  hardware: string | null;
  physicalLocation: string | null;
  assignedTo: string | null;
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

/** Body for PUT /api/devices/{id} — only the operator-owned fields. */
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

export interface DevicePort {
  id: number;
  deviceId: number;
  portNumber: number;
  protocol: string;
  state: string;
  serviceName: string | null;
  serviceVersion: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface DeviceHistoryPoint {
  recordedAt: string;
  status: string;
  openPortCount: number;
  responseTimeMs: number | null;
}

// ---------------------------------------------------------------------------
// Topology (GET /api/devices/topology)
// ---------------------------------------------------------------------------

export interface TopologyDevice {
  id: number;
  ip: string;
  hostname: string | null;
  deviceType: string;
  status: string;
}

export interface TopologyNetwork {
  id: number;
  name: string;
  cidr: string;
  devices: TopologyDevice[];
}

export interface TopologySite {
  id: number;
  name: string;
  networks: TopologyNetwork[];
}

export interface TopologyResponse {
  sites: TopologySite[];
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export interface ScanResult {
  id: number;
  networkId: number;
  networkName?: string;
  siteName?: string;
  scanType: string;
  nmapCommand?: string | null;
  startedAt: string;
  completedAt: string | null;
  durationSeconds?: number | null;
  hostsUp: number;
  hostsDown: number;
  newDevices: number;
  status: string;
  failureReason: string | null;
  excludedCount?: number;
  snapshots?: ScanDeviceSnapshot[];
}

export interface ScanDeviceSnapshot {
  id: number;
  scanResultId: number;
  deviceId: number;
  status: string;
  openPortCount: number;
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

export type AlertSeverity = 'info' | 'warning' | 'critical';

export const ALERT_TYPES = [
  'new_device',
  'device_offline',
  'device_online',
  'port_opened',
  'port_closed',
  'cert_expiring',
  'vulnerability',
] as const;

export interface Alert {
  id: number;
  deviceId: number | null;
  networkId: number | null;
  alertType: string;
  severity: string;
  message: string;
  details: string | null;
  isAcknowledged: boolean;
  acknowledgedBy: string | null;
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

export type VulnerabilityStatus = 'open' | 'remediated' | 'accepted_risk';

export interface Vulnerability {
  id: number;
  deviceId: number;
  cveId: string;
  cvssScore: number | null;
  severity: string;
  description: string | null;
  affectedService: string | null;
  portNumber: number | null;
  status: string;
  detectedAt: string;
  /** Denormalized rows from the list endpoint. */
  deviceIp?: string;
  deviceHostname?: string | null;
  siteName?: string;
}

export interface SslCertificate {
  id: number;
  deviceId: number;
  portNumber: number;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  keyType: string | null;
  keyBits: number | null;
  isSelfSigned: boolean;
  detectedAt: string;
  /** Denormalized rows from the list endpoint. */
  daysUntilExpiry?: number;
  deviceIp?: string;
  deviceHostname?: string | null;
  siteName?: string;
}

// ---------------------------------------------------------------------------
// SNMP
// ---------------------------------------------------------------------------

export interface SnmpTargetSummary {
  id: number;
  name: string;
  ipAddress: string;
  model: string | null;
  siteName: string | null;
  interfaceCount: number;
  upCount: number;
  maxUtilization: number;
  lastPolledAt: string | null;
}

export interface InterfaceSnapshot {
  id?: number;
  snmpTargetId?: number;
  ifIndex: number;
  ifName: string;
  ifAlias: string | null;
  speedBps: number;
  operStatus: string;
  inOctets: number;
  outOctets: number;
  inErrors: number;
  outErrors: number;
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
// Settings
// ---------------------------------------------------------------------------

export interface AppSetting {
  id: number;
  key: string;
  value: string | null;
  description: string | null;
  updatedAt: string;
}

export interface SystemInfo {
  version: string;
  nmapAvailable: boolean;
  nmapVersion: string | null;
  schedulerEnabled: boolean;
  provider: string;
  demoMode: boolean;
  companyName: string;
}
