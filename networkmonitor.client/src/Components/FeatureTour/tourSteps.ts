/**
 * Guided-tour content, declared as data rather than JSX.
 *
 * Same discipline as the help guide: the walkthrough is a typed array of plain
 * strings, so the prose can be reviewed (and corrected) without touching the
 * overlay that renders it, and a step is cheap to add, reorder, or drop.
 *
 * Every `target` is a CSS selector resolved against the live DOM at the moment
 * the step is shown. Prefer a `[data-tour="…"]` attribute over a class name:
 * classes exist to be restyled, and a tour that breaks the first time somebody
 * renames a layout class is a tour nobody trusts. The attributes referenced
 * here are attached in Sidebar, ThemePicker, Dashboard, DeviceList, NetworkMap,
 * Vulnerabilities, Switches, ErrorLogs, and HelpGuide.
 *
 * Content rule (inherited from HelpGuide.tsx): everything below is verified
 * against the README, docs/API.md, and the components it describes. This build
 * has no authentication, no syslog, no NetFlow — do not describe features that
 * do not exist.
 */

/** Preferred side of the target for the callout. The overlay flips it when the
 *  preferred side would push the card off-screen. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/** One stop on the walkthrough: what to ring, what to say, and where to say it. */
export interface TourStep {
  /** Stable id — used for React keys and the callout's aria-labelledby. */
  id: string;
  /** CSS selector for the element to spotlight. */
  target: string;
  title: string;
  /** Plain prose, not JSX — see the file header on why the copy stays reviewable. */
  body: string;
  /**
   * Route this step lives on. The tour navigates there first and waits for the
   * target to appear; steps that point at persistent shell chrome (top bar,
   * sidebar) leave this undefined and run wherever the reader already is.
   */
  route?: string;
  /** Defaults to 'bottom' at the overlay. Only a hint — see TourPlacement. */
  placement?: TourPlacement;
}

/**
 * Version of the walkthrough. Bumping it changes the localStorage key below,
 * which makes the tour auto-play once more for *everyone* — including people
 * who already dismissed it. Bump it after a significant UI change (a page
 * added or removed, navigation restructured, steps rewritten); do not bump it
 * for a typo fix, or the tour becomes something users learn to dismiss.
 */
export const TOUR_VERSION = 1;

/** First-run gate. Versioned so a bump re-plays the tour — see TOUR_VERSION. */
export const TOUR_SEEN_KEY = `netmon_tour_seen_v${TOUR_VERSION}`;

/**
 * The walkthrough, in reading order — array position *is* the step order, and
 * the progress pips count entries here.
 *
 * The route sequence is intentionally a tour of the app rather than the
 * shortest path: dashboard → devices → map → security → switches → logs → help,
 * ending back on shell chrome that is reachable from anywhere. Reordering these
 * changes what the reader is navigated through, not just the words, so a step
 * moved across routes should be re-walked rather than assumed to still work.
 * Adding, removing or rewriting steps warrants a TOUR_VERSION bump.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="brand"]',
    route: '/',
    placement: 'right',
    title: 'Welcome to NetworkMonitor',
    body:
      'This app runs nmap scans on a schedule, keeps state between runs, and turns the difference between one scan and the next into an asset inventory, a change feed, and a vulnerability queue. It ships seeded with a fictional demo estate — four sites and roughly 120 devices with 14 days of history — so every screen has real-looking data before you scan anything. nmap itself is optional: without it the app runs entirely on stored data. There is no sign-in in this build.',
  },
  {
    id: 'stat-tiles',
    target: '[data-tour="stat-tiles"]',
    route: '/',
    placement: 'bottom',
    title: 'The numbers that matter first',
    body:
      'Six tiles: total devices, online, offline, open alerts, open vulnerabilities, and TLS certificates expiring within 30 days. Each tile is a link rather than a readout — clicking one opens the filtered list behind its number, so it is a starting point instead of a dead end.',
  },
  {
    id: 'dashboard-charts',
    target: '[data-tour="dash-charts"]',
    route: '/',
    placement: 'top',
    title: 'What the fleet looks like, and what it has been doing',
    body:
      'The donut breaks the estate down by device type, with the fleet total in the middle and exact counts in the legend. Beside it, scan activity plots the last 14 days as two overlaid areas: scans run per day and new devices discovered per day. The row below charts the alert trend as bars stacked by severity, next to the newest unacknowledged alerts.',
  },
  {
    id: 'sidebar-nav',
    target: '[data-tour="sidebar-nav"]',
    route: '/',
    placement: 'right',
    title: 'Everything else lives here',
    body:
      'Navigation is grouped: Overview, Inventory (devices and scan history), Security (alerts, vulnerabilities, certificates), Network (map and switches), Admin (settings and error logs), and Help. Groups collapse to shorten the list, and the group holding the page you are on always re-expands so the active item is never hidden. The badge beside Alerts counts unacknowledged alerts.',
  },
  {
    id: 'devices',
    target: '[data-tour="device-table"]',
    route: '/devices',
    placement: 'top',
    title: 'The inventory, and the drill-through',
    body:
      'Devices are paged and sorted on the server, so clicking a column header reorders every result rather than just the page on screen. Click any row to open that device: what the scanner discovered, the operator fields a human owns, its open ports, seven days of availability and latency, and its own alerts, CVEs and certificates. The filters above this table live in the URL, so a filtered view can be bookmarked or pasted to someone else.',
  },
  {
    id: 'map',
    target: '[data-tour="network-map"]',
    route: '/map',
    placement: 'top',
    title: 'Site, network, device — as one picture',
    body:
      'The topology view draws the whole estate as a diagram: sites containing networks containing devices, colored by device type and status. Scroll to zoom, drag to pan, hover a node for its details, and click a device to jump to its page. The site filter narrows the drawing to one location.',
  },
  {
    id: 'security',
    target: '[data-tour="vuln-table"]',
    route: '/security/vulnerabilities',
    placement: 'top',
    title: 'A triage queue, not a report',
    body:
      'Vulnerabilities come from matching the service versions scans discovered against CVE records, ranked by CVSS score descending. Set a finding to open, remediated or accepted risk inline from its row, so the list shrinks over time instead of scrolling forever. The Certificates page beside it lists every TLS certificate seen on an open port, soonest expiry first. Both are fed by the security scan profile, which ships disabled — on a fresh install the demo data stands in for it.',
  },
  {
    id: 'switches',
    target: '[data-tour="snmp-targets"]',
    route: '/network/switches',
    placement: 'right',
    title: 'The one thing a port scan cannot tell you',
    body:
      'Switches and routers are polled over SNMP for per-interface counters — how much traffic a link is actually carrying. Pick a target from this rail to load its interface table (status, negotiated speed, utilization, error counters) and a 24-hour chart of its busiest interfaces. Errors climbing while utilization stays low usually means a physical problem rather than load.',
  },
  {
    id: 'error-logs',
    target: '[data-tour="error-log-stats"]',
    route: '/admin/error-logs',
    placement: 'bottom',
    title: 'Both halves of a failure, in one table',
    body:
      'Server exceptions and warnings land here alongside the browser errors the client posts back, so diagnosing a problem does not need shell access to the host. A correlation id ties a browser report to the request that caused it, so both sides of one incident share a single searchable value. An empty page is the correct state.',
  },
  {
    id: 'help',
    target: '[data-tour="tour-replay"]',
    route: '/help',
    placement: 'bottom',
    title: 'The long version',
    body:
      'This guide documents every page, how change detection works, and the safety rules — searchable, with a stable anchor per section so /help#change-detection deep-links straight to it. This button replays the tour whenever you want it, and so does the signpost button in the top bar.',
  },
  {
    id: 'theme',
    target: '[data-tour="theme-picker"]',
    placement: 'bottom',
    title: 'Make it yours, then go explore',
    body:
      'Eight themes, four light and four dark, remembered in this browser. Every color in the interface comes from one design-token set, so switching theme re-skins the charts, status pills and scrollbars along with the page instead of leaving them stranded. That is the tour — press Finish and have a look around.',
  },
];
