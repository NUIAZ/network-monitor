/**
 * Top bar: hamburger (mobile), current page title, global device search,
 * live clock, and the theme picker.
 *
 * The search box is intentionally simple — it always routes to the device
 * list with ?search=, because "find this IP/hostname" is the query people
 * actually type into a network monitor.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ThemePicker from '../ThemePicker/ThemePicker';
import './NavMenu.css';

/** Longest-prefix-wins page titles for the header. */
const TITLES: Array<[prefix: string, title: string]> = [
  ['/devices', 'Devices'],
  ['/scans', 'Scan History'],
  ['/alerts', 'Alerts'],
  ['/map', 'Network Map'],
  ['/security/vulnerabilities', 'Vulnerabilities'],
  ['/security/certificates', 'Certificates'],
  ['/network/switches', 'Switches'],
  ['/admin/settings', 'Settings'],
];

function titleForPath(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  // Sort longest-first so /security/certificates beats a hypothetical /security.
  const match = [...TITLES].sort((a, b) => b[0].length - a[0].length).find(([p]) => pathname.startsWith(p));
  return match ? match[1] : 'NetworkMonitor';
}

export default function NavMenu({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());

  // Live clock — a monitoring screen without the current time makes every
  // "last seen 5m ago" hard to trust on a wall display.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/devices?search=${encodeURIComponent(q)}` : '/devices');
  };

  return (
    <header className="nav-menu" data-testid="nav-menu">
      <button
        type="button"
        className="btn btn-ghost d-lg-none hamburger"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
        data-testid="hamburger"
      >
        <i className="bi bi-list" />
      </button>

      <h1 className="page-title" data-testid="page-title">{titleForPath(location.pathname)}</h1>

      <form className="global-search" onSubmit={submitSearch} role="search">
        <i className="bi bi-search" />
        <input
          type="search"
          className="form-control"
          placeholder="Search devices by IP, hostname, vendor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search devices"
          data-testid="global-search"
        />
      </form>

      <div className="nav-right">
        <span className="live-clock d-none d-md-inline-flex" data-testid="live-clock">
          <i className="bi bi-clock me-2" />
          {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </span>
        <ThemePicker />
      </div>
    </header>
  );
}
