/**
 * Application sidebar: brand header, grouped navigation, unacknowledged-alert
 * badge, and a footer with the running server version.
 *
 * Groups collapse manually but auto-expand whenever the current route lives
 * inside them: deep-linking into /security/certificates must never land the
 * user in a sidebar where the active item is hidden. On mobile the sidebar
 * becomes an overlay drawer; the hamburger in NavMenu opens it and any
 * navigation closes it.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAlertCount } from '../../context/AlertCountContext';
import { api } from '../../services/api';
import type { SystemInfo } from '../../types';
import logo from '../../logo.png';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Marks the item that renders the alert-count badge. */
  showAlertBadge?: boolean;
  /** NavLink `end` matching: true for "/" so it isn't active everywhere. */
  end?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: 'bi-speedometer2', end: true }],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { to: '/devices', label: 'Devices', icon: 'bi-hdd-network' },
      { to: '/scans', label: 'Scan History', icon: 'bi-clock-history' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { to: '/alerts', label: 'Alerts', icon: 'bi-bell', showAlertBadge: true },
      { to: '/security/vulnerabilities', label: 'Vulnerabilities', icon: 'bi-bug' },
      { to: '/security/certificates', label: 'Certificates', icon: 'bi-patch-check' },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    items: [
      { to: '/map', label: 'Network Map', icon: 'bi-diagram-3' },
      { to: '/network/switches', label: 'Switches', icon: 'bi-ethernet' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: 'bi-gear' },
      { to: '/admin/error-logs', label: 'Error Logs', icon: 'bi-bug-fill' },
    ],
  },
  // Its own group at the very bottom: the guide documents every other group,
  // so filing it under one of them would be arbitrary.
  {
    id: 'help',
    label: 'Help',
    items: [{ to: '/help', label: 'Help guide', icon: 'bi-question-circle' }],
  },
];

/** Which group owns a pathname (prefix match on its items). */
function groupForPath(pathname: string): string | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.end ? pathname === item.to : pathname.startsWith(item.to)) return group.id;
    }
  }
  return undefined;
}

interface SidebarProps {
  /** Mobile drawer state; ignored on desktop where the sidebar is fixed. */
  open: boolean;
  onClose: () => void;
}

/**
 * Owns which groups are collapsed and the server version in the footer. Neither
 * is persisted: collapse state is a within-session convenience, and persisting
 * it would fight the route-based auto-expand on every reload.
 *
 * Must be rendered under both the router and AlertCountProvider, it reads the
 * current pathname to decide what to highlight and re-expand, and the badge
 * count comes from context rather than its own request.
 */
export default function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { count: alertCount } = useAlertCount();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState<string | null>(null);

  // Route-based auto-expand: entering a route re-opens its (possibly
  // manually collapsed) group so the active highlight is always visible.
  useEffect(() => {
    const active = groupForPath(location.pathname);
    if (!active) return;
    setCollapsed((prev) => {
      if (!prev.has(active)) return prev;
      const next = new Set(prev);
      next.delete(active);
      return next;
    });
  }, [location.pathname]);

  // Version for the footer: best-effort; the sidebar renders fine without it.
  useEffect(() => {
    api
      .get<SystemInfo>('/api/settings/system')
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(null));
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {open && <div className="sidebar-overlay d-lg-none" onClick={onClose} data-testid="sidebar-overlay" />}
      <aside className={`sidebar${open ? ' open' : ''}`} data-testid="sidebar">
        <div className="sidebar-brand" data-tour="brand">
          <img src={logo} alt="NetworkMonitor" className="sidebar-logo" />
          <div>
            <div className="brand-name">NetworkMonitor</div>
            <div className="brand-tagline">nmap-powered visibility</div>
          </div>
        </div>

        <nav className="sidebar-nav" data-tour="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            return (
              <div className="nav-group" key={group.id}>
                <button
                  type="button"
                  className="nav-group-header"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isCollapsed}
                  data-testid={`nav-group-${group.id}`}
                >
                  <span>{group.label}</span>
                  <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} />
                </button>
                {!isCollapsed &&
                  group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                      onClick={onClose}
                      data-testid={`nav-link-${item.label.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      <i className={`bi ${item.icon}`} />
                      <span className="flex-grow-1">{item.label}</span>
                      {item.showAlertBadge && alertCount > 0 && (
                        <span className="alert-badge" data-testid="sidebar-alert-badge">
                          {alertCount > 99 ? '99+' : alertCount}
                        </span>
                      )}
                    </NavLink>
                  ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer" data-testid="sidebar-version">
          <i className="bi bi-broadcast-pin me-2" />
          {version ? `NetworkMonitor v${version}` : 'NetworkMonitor'}
        </div>
      </aside>
    </>
  );
}
