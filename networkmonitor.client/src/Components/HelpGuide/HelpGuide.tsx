/**
 * In-app help guide: the documentation a visitor needs without leaving the app.
 *
 * The content is *data*, not JSX. Every section is a list of typed blocks
 * (paragraph, list, definition list, table, callout) whose text lives in plain
 * strings — which is what makes the search box genuinely useful rather than
 * decorative: one flat index per section is built at module load, filtering is
 * a substring test against it, and every rendered string is passed through
 * `highlight()` so the matched run is marked wherever it appears. Rendering
 * hand-written JSX instead would mean the search could only ever match titles.
 *
 * Layout is a sticky section index beside the content column, collapsing to a
 * single column under 900px. Scroll-spy uses IntersectionObserver (guarded —
 * jsdom doesn't ship one, and the page must still render in unit tests) and
 * every section carries a stable id so `/help#change-detection` deep-links.
 *
 * Content rule: everything here is verified against the README, docs/API.md,
 * and the components it describes. This app has no authentication, no syslog,
 * no NetFlow — do not document features that do not exist.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { startTour } from '../FeatureTour/FeatureTour';
import './HelpGuide.css';

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

/** A paragraph of prose. */
interface ParagraphBlock {
  kind: 'p';
  text: string;
}

/** A bulleted list. */
interface ListBlock {
  kind: 'list';
  items: string[];
}

/** Term/description pairs — used for "what each field means" runs. */
interface DefsBlock {
  kind: 'defs';
  items: Array<{ term: string; text: string }>;
}

/** A small reference table (scan profiles, alert types). */
interface TableBlock {
  kind: 'table';
  headers: string[];
  rows: string[][];
}

/** A callout. `warning` is reserved for things that can hurt you. */
interface NoteBlock {
  kind: 'note';
  tone: 'info' | 'warning';
  text: string;
}

type HelpBlock = ParagraphBlock | ListBlock | DefsBlock | TableBlock | NoteBlock;

interface HelpSection {
  /** Stable anchor id — `/help#devices` must keep working. */
  id: string;
  title: string;
  /** bootstrap-icons class, matching the icon the page uses in the sidebar. */
  icon: string;
  blocks: HelpBlock[];
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: 'bi-rocket-takeoff',
    blocks: [
      {
        kind: 'p',
        text:
          'NetworkMonitor runs nmap scans against the networks you define, keeps state between runs, and turns the difference between one scan and the next into an asset inventory, a change feed, and a vulnerability queue. A raw scan tells you what is on the network right now; this app answers what is new, what stopped answering, and what started listening. Every screen is built from that stored history rather than from a live probe, so the UI is fast and works even when nmap is not installed.',
      },
      {
        kind: 'p',
        text:
          'Out of the box the database is seeded with a fictional demo estate called Northwind Logistics: four sites (Dallas, Chicago, Atlanta, Phoenix), roughly 120 devices, and 14 days of scan history, alerts, CVEs, TLS certificates, and SNMP interface samples. Every address in the demo data comes from the RFC 5737 documentation ranges or RFC 1918 private space, so nothing in it points at a real host. You can click through the entire application without scanning anything.',
      },
      {
        kind: 'p',
        text:
          'nmap itself is optional. Without it the app runs entirely on stored data, the Dashboard shows an "nmap not detected" banner, and on-demand scans return HTTP 503. Install nmap on the API host and put it on the PATH and it is picked up automatically — the Settings system panel then reports the detected version, the Dashboard banner disappears, and scans of your own networks work from the Scans page.',
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'The background scan scheduler also ships disabled (Scanning:SchedulerEnabled = false), so a freshly cloned copy never starts probing whatever network it happens to have landed on. Enable it once you have pointed it at networks you are authorized to scan. On-demand scans from the Scans page work either way.',
      },
    ],
  },
  {
    id: 'tour',
    title: 'Guided tour',
    icon: 'bi-signpost-split',
    blocks: [
      {
        kind: 'p',
        text:
          'A spotlight walkthrough introduces the application in eleven steps: what it is and where its data comes from, the Dashboard tiles and charts, the sidebar groups, the device inventory and its drill-through, the network map, vulnerabilities and certificates, the SNMP switch view, the error log, this guide, and the theme picker. Each step dims the page, rings the element it is describing, and explains it in a couple of sentences.',
      },
      {
        kind: 'p',
        text:
          'It plays by itself the first time you open the app — once the Dashboard has finished loading, so the first spotlight lands on real content rather than on a loading placeholder — and then never again, because the fact that you have seen it is remembered in this browser. It never starts on its own when you arrive on a deep link to some other page: a bookmarked device list is somebody who already knows their way around.',
      },
      {
        kind: 'p',
        text:
          'Replay it whenever you like. The Take the tour button at the top of this page and the signpost button in the top bar, next to the question mark, both start it again from the beginning. A step whose target the current window cannot show — an element hidden at a narrow width, a panel with no data behind it — is skipped rather than stalling the walkthrough.',
      },
      {
        kind: 'defs',
        items: [
          { term: 'Next step', text: 'Right arrow, Enter, or the Next button. On the last step the button reads Finish.' },
          { term: 'Previous step', text: 'Left arrow, or the Back button. Both are inert on the first step.' },
          {
            term: 'Leave early',
            text:
              'Escape, or the Skip link in the corner of the card. Leaving counts as having seen the tour, so it will not reappear by itself on your next visit — use either replay button to bring it back.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'Motion is optional: when your system asks for reduced motion the spotlight jumps between targets instead of sliding, and scrolling a target into view is instant.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'bi-speedometer2',
    blocks: [
      {
        kind: 'p',
        text:
          'The Dashboard is the "is anything on fire" screen: six stat tiles across the top, two chart rows, and the newest unacknowledged alerts. Every tile is clickable and drills through to the list behind its number, so the tile is a starting point rather than a dead end.',
      },
      {
        kind: 'defs',
        items: [
          {
            term: 'Total devices',
            text:
              'Every device on record across all sites, with a sub-line counting first sightings in the last 24 hours. Opens the unfiltered device list.',
          },
          {
            term: 'Online',
            text: 'Devices that answered the most recent scan covering them. Opens the device list filtered to status online.',
          },
          {
            term: 'Offline',
            text:
              'Devices that have missed enough consecutive scans to be aged out (see change detection). Opens the device list filtered to status offline.',
          },
          {
            term: 'Open alerts',
            text: 'Unacknowledged alerts, with the critical count on the sub-line. Opens the alert queue.',
          },
          {
            term: 'Open vulns',
            text: 'Findings still in the open status, with the critical count on the sub-line. Opens the vulnerability list.',
          },
          {
            term: 'Expiring certs',
            text: 'TLS certificates expiring within 30 days. Opens the certificate inventory.',
          },
        ],
      },
      {
        kind: 'p',
        text:
          'The device-type donut breaks the fleet down by classification — one arc per type, colored consistently with the icons used elsewhere, with the fleet total in the middle and a legend listing exact counts. It answers "what kind of estate is this" at a glance; a sudden slice of unknown devices usually means a scan profile stopped collecting port or OS data.',
      },
      {
        kind: 'p',
        text:
          'Scan activity charts the last 14 days as two overlaid areas: scans run per day and new devices discovered per day. A flat scans line means the scheduler is off or a network was disabled; a spike in the new-devices series is the shape of either a genuine onboarding event or a subnet that just came into range.',
      },
      {
        kind: 'p',
        text:
          'Alert trend charts the same 14 days as bars stacked by severity — info, warning, then critical on top. Read the stack height for total noise and the critical band for what actually mattered. Below it, the recent-alerts panel lists the newest unacknowledged alerts; clicking one jumps straight to the device it concerns.',
      },
      {
        kind: 'p',
        text:
          'The footer line under the charts carries the site and network counts, the timestamp of the most recent scan, and the detected nmap version when one is present.',
      },
    ],
  },
  {
    id: 'devices',
    title: 'Devices',
    icon: 'bi-hdd-network',
    blocks: [
      {
        kind: 'p',
        text:
          'The device list is the inventory: a server-paged, server-sorted table across all sites. Click any sortable column header to change the ordering, and click a row to open the device detail page.',
      },
      {
        kind: 'p',
        text:
          'Five filters narrow the list: a free-text search over IP address, hostname, MAC address and vendor (debounced so typing does not fire a request per keystroke), plus site, network, status, and device type. Choosing a site narrows the network dropdown to that site. All filter state lives in the URL, which means a filtered view can be bookmarked or pasted to a colleague, refreshing keeps your place, and the header search box and the Dashboard tiles can deep-link into it.',
      },
      {
        kind: 'defs',
        items: [
          {
            term: 'new',
            text:
              'The device was seen for the first time by the scan that created it. It stays new until the next scan that finds it, which promotes it to online. Every first sighting also raises a new_device alert.',
          },
          {
            term: 'online',
            text: 'The device answered the most recent scan that covered it. Its missed-scan counter is zero.',
          },
          {
            term: 'offline',
            text:
              'The device has missed the configured number of consecutive scans (default 3) and has been aged out, raising a critical device_offline alert. It flips straight back to online the moment a scan hears from it again.',
          },
        ],
      },
      {
        kind: 'p',
        text:
          'Device type is classified automatically from the strongest signal available: open management ports, the OS fingerprint, the MAC address vendor (OUI), and hostname conventions. The rules are ordered and the first match wins, so a printer that also serves a web interface is still a printer. Ports 9100, 515 and 631 mean printer; 554 suggests a camera; database, web, SSH and mail ports mean server; vendor names and prefixes like "rtr-", "sw-" or "-fw" resolve routers, switches and firewalls. Anything nothing matched is left as unknown. The classification is a starting point, not a verdict — you can override it by hand on the device page.',
      },
      {
        kind: 'p',
        text:
          'Alongside what the scanner discovered, every device carries operator fields that a human owns: hardware model, physical location, assigned-to (owning team or purpose), free-text notes, a flag for attention, and an exclude switch. These are stored separately from discovered facts so a save can never fight the scanner over an IP or a MAC.',
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'Excluding a device does more than hide it: excluded addresses are passed to nmap\'s --exclude argument, so they are never probed at all rather than being filtered out of the results afterwards. Excluded devices are also skipped by the missed-scan aging, so they never drift to offline just because you stopped scanning them.',
      },
    ],
  },
  {
    id: 'device-detail',
    title: 'Device detail',
    icon: 'bi-pc-display',
    blocks: [
      {
        kind: 'p',
        text:
          'The detail page separates the two kinds of truth about a device. The Identity card is read-only and holds what scans discovered: IP address, MAC address, vendor, OS guess, first seen, last seen, last scanned, and the current missed-scan count. The Operator fields card next to it is the editable half — hostname, device type, hardware, physical location, assigned-to, notes, and the flag and exclude switches. Saving sends only the operator fields.',
      },
      {
        kind: 'p',
        text:
          'The open-ports table lists every port currently recorded as listening, with protocol, state, service name, service version and when the port was last seen. It is populated by a scan that actually probes ports — a quick ping sweep leaves it untouched, so an empty table on a live host usually means only quick scans have run.',
      },
      {
        kind: 'p',
        text:
          'Availability and latency for the last 7 days render as two stacked charts sharing one time axis. The top chart is a step showing up or down; the bottom is response time in milliseconds. They are deliberately not combined onto a dual axis — the scales are unrelated, and overlaying them would invite reading a slope that is not there. History appears once the device has been covered by a few scans.',
      },
      {
        kind: 'p',
        text:
          'Below that, three panels tie the device to the rest of the app: its recent alerts, its known vulnerabilities with CVE id and CVSS score, and every TLS certificate observed on its ports with subject, issuer, validity, key type and a self-signed badge. Deleting a device removes it along with its ports, history, alerts, vulnerabilities and certificates — it will reappear as new if a future scan finds it again.',
      },
    ],
  },
  {
    id: 'scans',
    title: 'Scans & profiles',
    icon: 'bi-clock-history',
    blocks: [
      {
        kind: 'p',
        text:
          'Every network gets five scan profiles. A profile is an nmap argument set with its own interval and enabled flag, editable per network from Settings. Two ship enabled because they are cheap; the other three are heavier and are opt-in.',
      },
      {
        kind: 'table',
        headers: ['Profile', 'What it is for', 'Default interval', 'Ships enabled'],
        rows: [
          [
            'quick',
            'Host discovery only — a ping and TCP-probe sweep cheap enough to run constantly. Returns no port data.',
            '5 minutes',
            'Yes',
          ],
          ['deep', 'Service and version detection across the top 50 ports. This is what fills the port tables.', '1 hour', 'Yes'],
          [
            'security',
            'NSE vulnerability and TLS scripts (vuln, ssl-cert, ssl-enum-ciphers) over the top 100 ports. Heavier and noisier; this is what populates CVEs and certificates.',
            'Weekly',
            'No',
          ],
          ['full_port', 'Every TCP port with version detection. Slow — run it deliberately.', 'Weekly', 'No'],
          ['udp', 'UDP services on the top 100 ports. Requires raw-socket privileges on the host.', 'Weekly', 'No'],
        ],
      },
      {
        kind: 'p',
        text:
          'To run a scan on demand, pick a network and a profile in the "Run a scan now" panel at the top of the Scans page and press Run scan. The endpoint executes nmap synchronously and returns the completed result, so the button shows a live elapsed-time counter while it works; a deep or full-port profile against a large range can take a while. The panel prints the selected profile\'s description and the exact nmap arguments it will use before you commit to it.',
      },
      {
        kind: 'p',
        text:
          'A run that comes back as 503 means nmap is not installed on the API host. That is a server configuration problem rather than a failed scan, so it gets its own banner instead of an error — install nmap on the machine running the API and it will be picked up on the next attempt without a restart of the app.',
      },
      {
        kind: 'p',
        text:
          'The history table below lists every scan with its network, profile, duration, hosts up, hosts down, new devices, and status. A failed row carries an info icon whose tooltip is the exact failure reason recorded by the server. Every scan record also stores the precise command line that ran and the raw nmap XML, so a surprising result can always be reproduced by hand. The scheduler checks every 60 seconds for profiles that are due and runs them one at a time — nmap will happily saturate a link, and a monitoring tool that degrades the network it watches is worse than no monitoring at all.',
      },
    ],
  },
  {
    id: 'change-detection',
    title: 'How change detection works',
    icon: 'bi-shuffle',
    blocks: [
      {
        kind: 'p',
        text:
          'This is the part that makes the app more than an nmap front end. After every scan the orchestrator diffs the parsed results against stored state and records what changed, rather than replacing the previous picture with a new one.',
      },
      {
        kind: 'defs',
        items: [
          {
            term: 'First sighting',
            text:
              'An address that has never been seen on that network becomes a device with status new, classified from whatever the scan learned, and raises a new_device alert at warning severity carrying its MAC vendor, hostname and open-port count. Shadow devices — an unauthorized access point, a forgotten test box, a personal laptop — surface within one scan interval instead of at the next audit.',
          },
          {
            term: 'Known device seen again',
            text:
              'Identity fields are refreshed from the new data, the missed-scan counter resets to zero, and status becomes online. A device that had been offline additionally raises a device_online alert at info severity, so a recovery is visible in the feed and not just an absence of complaints.',
          },
          {
            term: 'Port drift',
            text:
              'Ports are compared individually, not as a bulk replacement. A port that is now listening and was not before raises a port_opened warning alert with the service name and version; a port that has stopped listening raises a port_closed info alert recording what used to be there. "Who opened RDP on the warehouse server?" becomes a timestamped record instead of an argument.',
          },
          {
            term: 'Missed-scan debounce',
            text:
              'A device that does not answer is not immediately offline. Its missed-scan counter increments, and only when it reaches the configured threshold (Alerts:OfflineAfterMissedScans, default 3 consecutive misses) does the status flip to offline and raise a device_offline alert at critical severity. A laptop went to sleep, a probe got dropped, a switch was busy — one unanswered scan is noise, and one dropped packet should never page anyone.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'A quick ping sweep returns no port information at all. The reconciler knows this: ports are only ever closed by a scan that actually probed ports, and a device is only re-classified when the scan genuinely learned something new (open ports were found, or an OS fingerprint came back). A cheap five-minute sweep can therefore never close a port table or downgrade a classification that an hourly deep scan established.',
      },
      {
        kind: 'p',
        text:
          'One snapshot row is written per device per scan — status, open-port count and response time — including for devices that were covered but did not answer. That is what makes the availability and latency history on the device page continuous: there are no gaps to interpolate across, because a non-response is recorded as explicitly as a response.',
      },
      {
        kind: 'p',
        text:
          'Two nmap details are handled in the executor because both would otherwise corrupt the diff. Nmap\'s host discovery is all-or-nothing — naming any -P flag replaces the entire default probe set — so when a profile expresses no discovery opinion the default probe set is injected, and every profile sees the same hosts instead of the deep scan reporting a fraction of what the quick scan found. And --open is always stripped from profile arguments, because it omits hosts with no open ports from the XML entirely; downstream that reads as "the host disappeared" and manufactures false offline alerts.',
      },
    ],
  },
  {
    id: 'alerts',
    title: 'Alerts',
    icon: 'bi-bell',
    blocks: [
      {
        kind: 'p',
        text:
          'The alerts page is the triage queue: newest first, one row per event, with the message, a detail line, the type, and when it happened. Clicking a row opens the device the alert concerns.',
      },
      {
        kind: 'table',
        headers: ['Alert type', 'Severity', 'Raised when'],
        rows: [
          ['new_device', 'warning', 'An address is seen on a monitored network for the first time.'],
          ['device_offline', 'critical', 'A device has missed the configured number of consecutive scans.'],
          ['device_online', 'info', 'A device that was offline answers a scan again.'],
          ['port_opened', 'warning', 'A service is listening on a port where it was not before.'],
          ['port_closed', 'info', 'A previously listening service has stopped answering on that port.'],
          ['cert_expiring', 'warning', 'A tracked TLS certificate is inside the expiry warning window.'],
          ['vulnerability', 'varies', 'A CVE is matched against a discovered service version.'],
        ],
      },
      {
        kind: 'p',
        text:
          'Severities are info, warning and critical, and they are fixed per type by the reconciler rather than being editable — the severity of "a device went offline" is not a matter of taste. Three filters narrow the queue: acknowledgment state (unacknowledged, acknowledged, or all), severity, and alert type.',
      },
      {
        kind: 'p',
        text:
          'Acknowledge a single alert from the button in its row. The Acknowledge all button handles the bulk case and is scoped to the active severity filter when one is set — "acknowledge all criticals" is a deliberate workflow, while clearing the entire queue is opt-in — and it sits behind a confirmation, because it is exactly the kind of button people hit by accident. Acknowledgments are recorded against the identity "operator", since this build has no user accounts. The unacknowledged count in the sidebar drops immediately when you acknowledge rather than waiting for its next poll.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Vulnerabilities & certificates',
    icon: 'bi-shield-check',
    blocks: [
      {
        kind: 'p',
        text:
          'Vulnerabilities are produced by matching the service versions that scans discovered against CVE records. The list is ordered by CVSS score descending by default, because a triage queue sorted any other way is a list you scroll rather than a list you finish. The score chip is banded on the CVSS v3 boundaries: 9.0 and above critical, 7.0 and above high, 4.0 and above medium, anything lower low.',
      },
      {
        kind: 'p',
        text:
          'Each finding carries a workflow status you set inline from the row: open, remediated, or accepted_risk. Those are the three outcomes a finding eventually gets, and having all three means the queue shrinks over time instead of scrolling forever — accepted risk is a decision that was made, not an item that was ignored. Filter by severity, by status, or search across CVE id, service and device. CVE ids link out to the matching NVD entry for the full write-up.',
      },
      {
        kind: 'p',
        text:
          'The certificate inventory lists every TLS certificate observed on an open port, sorted by soonest expiry, because the certificate expiring next is the only one that matters on that screen. Days-until-expiry is banded: already expired is called out in red with how long ago, 30 days or fewer is amber, and anything further out is plain text. Self-signed certificates get their own badge next to the issuer. The horizon filter narrows to certificates expiring within 90, 30 or 7 days, and the Dashboard "Expiring certs" tile counts the 30-day window (Alerts:CertExpiryWarningDays).',
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'Both pages are fed by the security scan profile, which ships disabled because its NSE scripts are heavier and noisier than routine discovery. On a fresh install the demo data fills both lists; on your own networks they stay empty until you enable and run the security profile.',
      },
    ],
  },
  {
    id: 'switches',
    title: 'Switches (SNMP)',
    icon: 'bi-ethernet',
    blocks: [
      {
        kind: 'p',
        text:
          'Switches and routers are polled over SNMP for per-interface counters, which is the one thing a port scan cannot tell you: how much traffic a link is actually carrying. The page is a master-detail — a rail of polled targets on the left, the selected target\'s data on the right.',
      },
      {
        kind: 'p',
        text:
          'Each target card shows the device name, IP address, model, site, how many of its interfaces are up out of the total, a bar for its busiest interface, and when it was last polled. Selecting one loads its interface table: interface name and alias, operational status, negotiated speed, a utilization bar with the exact percentage, in and out error counters, and the sample timestamp.',
      },
      {
        kind: 'p',
        text:
          'Utilization is the share of an interface\'s negotiated speed actually in use over the sample period. The bar is green below 60 percent, switches to the warning color at 60, and to the error color at 85. A brief touch of the top band is normal — a backup window, a large file copy. Sustained time above it is saturation: the link has no headroom left, which is where queueing, latency and drops begin, and the fix is either more capacity or less traffic rather than more monitoring.',
      },
      {
        kind: 'p',
        text:
          'Error counters are cumulative since the interface last reset and are highlighted when non-zero. Errors climbing while utilization stays low usually points at a physical problem — a duplex mismatch, a bad cable or transceiver — rather than at load. The 24-hour chart plots one line per interface and caps itself at the six busiest, because a 48-port switch drawn as 48 lines is noise and six is where the categorical color palette stays honest.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'bi-gear',
    blocks: [
      {
        kind: 'p',
        text:
          'Settings holds the system panel, the key/value application settings, the sites and networks inventory, and the per-network scan-profile editor.',
      },
      {
        kind: 'p',
        text:
          'The system panel is the fastest way to answer "why is nothing scanning": it reports the running version, whether nmap was detected and at what version, whether the scheduler is enabled, which data provider is in use (SQLite by default, PostgreSQL via configuration), whether the demo data was seeded, and the instance name.',
      },
      {
        kind: 'p',
        text:
          'A site is a place that owns networks: a short key, a name, optional city and state, and optional latitude and longitude that let it be placed on the facility map. A network is a CIDR range under a site, with its quick and deep scan cadences and an enabled switch. Creating a network also creates its five default scan profiles. Both are edited through modal forms rather than inline grids, because creating a scan target is a deliberate act that deserves validation.',
      },
      {
        kind: 'note',
        tone: 'warning',
        text:
          'Deleting a site cascades: every network under it, and every device, scan and alert under those networks, goes with it. Deleting a network takes its devices and scan history. Both actions ask for confirmation first and neither can be undone.',
      },
      {
        kind: 'p',
        text:
          'The CIDR field is validated as you type and again on the server, and the server\'s objection is surfaced verbatim if it still refuses — a bad CIDR here becomes a bad nmap command line later, and the range you enter is exactly what nmap will target. Ranges above the configured maximum address count are rejected outright.',
      },
      {
        kind: 'p',
        text:
          'The scan-profile editor at the bottom takes a network and lets you edit each of its five profiles: the raw nmap arguments, the interval in seconds, and whether the scheduler should run it. Changes save per profile, so you can enable the security profile on one network without touching the others.',
      },
    ],
  },
  {
    id: 'error-logs',
    title: 'Error logs',
    icon: 'bi-bug',
    blocks: [
      {
        kind: 'p',
        text:
          'Failures from both halves of the application land in one table, so diagnosing a problem does not require shell access to the host. A server stack trace explains what broke; a browser error explains what the user actually saw. Investigating "the devices page went blank" with only server logs means guessing.',
      },
      {
        kind: 'defs',
        items: [
          {
            term: 'Server',
            text: 'Two sources. Anything that escapes a controller is caught by the exception middleware, and any call to the standard logging API at Warning or above is persisted by a database logging sink — so existing log statements throughout the codebase appear here without extra work.',
          },
          {
            term: 'Client',
            text: 'The browser reports its own failures: unhandled errors, unhandled promise rejections, and React render errors caught by the error boundary. Repeated identical errors are collapsed, so a component throwing on every render produces one entry rather than thousands.',
          },
          {
            term: 'Correlation id',
            text: 'When an API call fails, the server returns an id with the error. The browser sends that same id back when it reports the resulting failure, so both halves of one incident share a single searchable value. Search for it to see both sides.',
          },
        ],
      },
      {
        kind: 'p',
        text:
          'Filter by tier, severity, or triage state, and search across message, exception type, path, and correlation id. Expanding a row shows the full stack trace, the request path and method, the browser user agent, and a copy button for the correlation id. Entries can be marked resolved to keep the working set small.',
      },
      {
        kind: 'note',
        tone: 'info',
        text:
          'An empty page is the correct state. This is also the one table a misbehaving deployment can grow without bound, so a purge control removes entries older than a chosen number of days.',
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety & scope',
    icon: 'bi-exclamation-octagon',
    blocks: [
      {
        kind: 'note',
        tone: 'warning',
        text:
          'This build has NO authentication. Every endpoint is open to anyone who can reach the port. Run it on localhost or an isolated lab network only — do not expose it to an untrusted network, and especially not to the internet. An unauthenticated tool that can launch port scans and edit inventory is a liability, not a feature.',
      },
      {
        kind: 'p',
        text:
          'The seam where authentication plugs in is deliberately clean — standard ASP.NET Core authentication middleware plus authorization policies or a global action filter, with mutating endpoints restricted to an operator role and read endpoints left to viewers. Nothing in the request pipeline assumes anonymity. But until that is wired up, treat the deployment as trusted-network-only.',
      },
      {
        kind: 'p',
        text:
          'Scanning itself is guarded in ways that matter even in a demo. Every scan target and every exclusion must match a strict IPv4 address-or-prefix shape and parse as a real address before it is placed on the nmap command line. Anything else is rejected outright rather than escaped, which eliminates argument injection by construction rather than by careful quoting.',
      },
      {
        kind: 'list',
        items: [
          'Maximum target size: a target covering more addresses than Scanning:MaxTargetAddresses (default 65,536) is refused. A mistyped /8 is 16.7 million hosts and will take days; the guard is cheaper than the incident.',
          'Devices marked excluded are passed to nmap\'s --exclude, so they are never probed rather than being filtered out of the results afterwards.',
          'Scan XML is parsed with DTD processing disabled, so a malformed or hostile results file cannot become an XXE hole.',
          'Scans run one at a time, so the monitoring tool cannot saturate the link it is supposed to be watching.',
          'The scheduler ships disabled, so nothing is scanned until you deliberately turn it on.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        text:
          'Only scan networks you are authorized to scan. Port scanning networks you do not own or administer may violate law or policy regardless of intent. The Northwind Logistics demo dataset exists precisely so you can evaluate every feature of this application without scanning anything at all.',
      },
    ],
  },
  {
    id: 'tips',
    title: 'Keyboard & tips',
    icon: 'bi-lightbulb',
    blocks: [
      {
        kind: 'p',
        text:
          'The search box in the header always routes to the device list filtered by what you typed — IP address, hostname, MAC or vendor — because "find this address" is the query people actually type into a network monitor. It does not search alerts or CVEs; those pages have their own filters.',
      },
      {
        kind: 'p',
        text:
          'The theme picker beside it offers eight themes, four light and four dark, and remembers your choice in the browser. Every color in the interface — including the chart series, the status pills and the scrollbars — comes from a single design-token set, so switching theme re-skins the charts along with the page instead of leaving them stranded on a light background.',
      },
      {
        kind: 'list',
        items: [
          'The only custom keyboard shortcuts belong to the guided tour, which takes the arrow keys, Enter and Escape while it is on screen. Otherwise: Escape closes a confirmation dialog, Enter activates a focused Dashboard tile, and everything else is standard browser navigation — Tab to move focus, Enter to follow a link, and browser back and forward through your history.',
          'Device-list filters live in the URL, so any filtered view can be bookmarked, refreshed, or pasted to someone else and land exactly as you left it.',
          'Dashboard stat tiles drill through to the filtered list behind their number rather than being read-only figures.',
          'Sidebar groups collapse to shorten the nav, and the group containing the page you are on always re-expands so the active item is never hidden.',
          'Table headers marked as sortable toggle ascending and descending on click; the device list sorts on the server, so sorting applies across every page of results and not just the one on screen.',
          'Sections of this guide have stable anchors — /help#change-detection or /help#safety will open the page scrolled to that section.',
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Search index + highlighting
// ---------------------------------------------------------------------------

/** Flattens one block to the plain text the search index should see. */
function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case 'p':
    case 'note':
      return block.text;
    case 'list':
      return block.items.join(' ');
    case 'defs':
      return block.items.map((item) => `${item.term} ${item.text}`).join(' ');
    case 'table':
      return [...block.headers, ...block.rows.flat()].join(' ');
  }
}

/**
 * One lowercased haystack per section, built once at module load. Filtering is
 * then a substring test — cheap enough to run on every keystroke without any
 * debouncing, which is what makes the box feel instant.
 */
const SEARCH_INDEX: Record<string, string> = Object.fromEntries(
  HELP_SECTIONS.map((section) => [
    section.id,
    `${section.title} ${section.blocks.map(blockText).join(' ')}`.toLowerCase(),
  ]),
);

/**
 * Wraps every occurrence of `query` in the given text with a <mark>. Uses
 * indexOf rather than a RegExp so the user's query needs no escaping — a
 * search for "9100/tcp" or "--exclude" must not blow up the page.
 */
function highlight(text: string, query: string): ReactNode {
  if (query.length === 0) return text;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let cursor = 0;
  let hit = haystack.indexOf(needle, cursor);
  if (hit === -1) return text;

  const parts: ReactNode[] = [];
  let key = 0;
  while (hit !== -1) {
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    parts.push(
      <mark className="help-hit" key={`hit-${key++}`}>
        {text.slice(hit, hit + needle.length)}
      </mark>,
    );
    cursor = hit + needle.length;
    hit = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function BlockView({ block, query }: { block: HelpBlock; query: string }) {
  switch (block.kind) {
    case 'p':
      return <p className="help-p">{highlight(block.text, query)}</p>;

    case 'list':
      return (
        <ul className="help-list">
          {block.items.map((item) => (
            <li key={item}>{highlight(item, query)}</li>
          ))}
        </ul>
      );

    case 'defs':
      return (
        <dl className="help-defs">
          {block.items.map((item) => (
            <div className="help-def" key={item.term}>
              <dt>{highlight(item.term, query)}</dt>
              <dd>{highlight(item.text, query)}</dd>
            </div>
          ))}
        </dl>
      );

    case 'table':
      return (
        <div className="nm-table-wrap help-table-wrap">
          <table className="nm-table help-table">
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header}>{highlight(header, query)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={`${row[0]}-${i}`} className={i === 0 ? 'cell-primary cell-mono' : undefined}>
                      {highlight(cell, query)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note':
      return (
        <div className={`help-note help-note-${block.tone}`}>
          <i className={`bi ${block.tone === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill'}`} />
          <div>{highlight(block.text, query)}</div>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Purely local: it fetches nothing, so the guide is readable even when the API
 * is down — which is exactly when someone is most likely to open it.
 *
 * Searching filters whole sections rather than individual blocks, so a hit
 * keeps its surrounding context instead of stranding one matched sentence.
 * Note that filtering also removes sections from the DOM, so a `/help#anchor`
 * deep link will not scroll anywhere while a query is active.
 */
export default function HelpGuide() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  const [rawQuery, setRawQuery] = useState('');
  const query = rawQuery.trim();

  const visible = useMemo(() => {
    if (query.length === 0) return HELP_SECTIONS;
    const needle = query.toLowerCase();
    return HELP_SECTIONS.filter((section) => SEARCH_INDEX[section.id].includes(needle));
  }, [query]);

  const [activeId, setActiveId] = useState<string>(HELP_SECTIONS[0].id);

  // Joined ids rather than the array itself: the effect below must re-run when
  // the *set* of rendered sections changes, not on every re-render.
  const visibleIds = visible.map((section) => section.id).join(',');

  // Scroll-spy. Guarded because jsdom has no IntersectionObserver — the page
  // still has to render (and be testable) without one, just without spying.
  useEffect(() => {
    const ids = visibleIds.length > 0 ? visibleIds.split(',') : [];
    if (ids.length === 0) return;
    setActiveId((current) => (ids.includes(current) ? current : ids[0]));
    if (typeof IntersectionObserver === 'undefined') return;

    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inView.add(entry.target.id);
          else inView.delete(entry.target.id);
        }
        // Topmost intersecting section wins, so the marker moves down the index
        // as you scroll rather than jumping to whichever entry fired last.
        const first = ids.find((id) => inView.has(id));
        if (first !== undefined) setActiveId(first);
      },
      // Discounts the sticky header at the top and most of the viewport at the
      // bottom, so "active" means "at the top of the reading area".
      { rootMargin: '-80px 0px -65% 0px' },
    );

    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [visibleIds]);

  // Deep-link support: /help#devices scrolls to that section on arrival, and
  // again whenever the hash changes from the index buttons.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (id.length === 0) return;
    const element = document.getElementById(id);
    if (!element) return;
    setActiveId(id);
    // Optional-called: jsdom does not implement scrollIntoView.
    element.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  const jumpTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    // Keeps the address bar shareable; replace so the guide does not fill up
    // the back stack with one entry per section the reader visited.
    navigate({ hash: `#${id}` }, { replace: true });
  };

  return (
    <div className="help-page" data-testid="help-page">
      <div className="page-title-row">
        <div>
          <h2>Help &amp; documentation</h2>
          <div className="page-subtitle">
            What every page does, how the scanning works, and what this build will and will not do.
          </div>
        </div>
        {/* Top of the page on purpose: someone who opened the guide because
            they are lost is better served by the tour than by 5,000 words. */}
        <button
          type="button"
          className="btn btn-accent help-tour-button"
          onClick={() => startTour()}
          data-testid="help-tour-button"
          data-tour="tour-replay"
        >
          <i className="bi bi-signpost-split me-2" />
          Take the tour
        </button>
      </div>

      <div className="help-layout">
        {/* ---- section index ---- */}
        <nav className="help-index" aria-label="Help sections">
          <div className="help-search-wrap">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control help-search"
              placeholder="Search the guide…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              aria-label="Search help"
              data-testid="help-search"
            />
          </div>

          {query.length > 0 && (
            <div className="help-search-meta" data-testid="help-search-meta">
              {visible.length} of {HELP_SECTIONS.length} sections match “{query}”
            </div>
          )}

          <ul className="help-index-list">
            {HELP_SECTIONS.map((section) => {
              const matched = visible.some((s) => s.id === section.id);
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`help-index-item${section.id === activeId && matched ? ' active' : ''}${matched ? '' : ' dimmed'}`}
                    onClick={() => jumpTo(section.id)}
                    disabled={!matched}
                    data-testid={`help-nav-${section.id}`}
                  >
                    <i className={`bi ${section.icon}`} />
                    <span>{section.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ---- content ---- */}
        <div className="help-content">
          {visible.length === 0 ? (
            <div className="nm-card">
              <div className="nm-card-body help-empty" data-testid="help-empty">
                <i className="bi bi-search" />
                <h3>Nothing in the guide matches “{query}”</h3>
                <p className="text-muted-token">
                  Try a shorter phrase, or a term from the app itself — “offline”, “profile”, “CVSS”, “SNMP”.
                </p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRawQuery('')}>
                  Clear search
                </button>
              </div>
            </div>
          ) : (
            visible.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="nm-card help-section"
                aria-labelledby={`${section.id}-title`}
                data-testid={`help-section-${section.id}`}
              >
                <div className="nm-card-header">
                  <span className="help-section-title" id={`${section.id}-title`}>
                    <i className={`bi ${section.icon}`} />
                    {highlight(section.title, query)}
                  </span>
                  <a className="help-anchor" href={`#${section.id}`} aria-label={`Link to ${section.title}`}>
                    <i className="bi bi-link-45deg" />
                  </a>
                </div>
                <div className="nm-card-body">
                  {section.blocks.map((block, i) => (
                    <BlockView key={`${section.id}-${i}`} block={block} query={query} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
