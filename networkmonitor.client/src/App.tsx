/**
 * Application root: providers, shell layout, and the route table.
 *
 * Every page is React.lazy-loaded so the initial bundle carries only the
 * shell; recharts (the heaviest dependency) is pulled in on demand by the
 * pages that actually chart. The ErrorBoundary is keyed on the pathname so
 * a crash on one page never bricks navigation to the others.
 */
import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AlertCountProvider } from './context/AlertCountContext';
import Sidebar from './Components/Sidebar/Sidebar';
import NavMenu from './Components/NavMenu/NavMenu';
import ErrorBoundary from './Components/Shared/ErrorBoundary';
import LoadingSpinner from './Components/Shared/LoadingSpinner';

const Dashboard = lazy(() => import('./Components/Dashboard/Dashboard'));
const DeviceList = lazy(() => import('./Components/DeviceList/DeviceList'));
const DeviceDetail = lazy(() => import('./Components/DeviceDetail/DeviceDetail'));
const ScanHistory = lazy(() => import('./Components/ScanHistory/ScanHistory'));
const AlertsList = lazy(() => import('./Components/AlertsList/AlertsList'));
const NetworkMap = lazy(() => import('./Components/NetworkMap/NetworkMap'));
const Vulnerabilities = lazy(() => import('./Components/Vulnerabilities/Vulnerabilities'));
const Certificates = lazy(() => import('./Components/Certificates/Certificates'));
const Switches = lazy(() => import('./Components/Switches/Switches'));
const Settings = lazy(() => import('./Components/Settings/Settings'));
const NotFound = lazy(() => import('./Components/NotFound/NotFound'));

/** Shell + routes; separated from App so hooks can use the router context. */
function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-main">
        <NavMenu onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <main className="page-content">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<LoadingSpinner label="Loading…" />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/devices" element={<DeviceList />} />
                <Route path="/devices/:id" element={<DeviceDetail />} />
                <Route path="/scans" element={<ScanHistory />} />
                <Route path="/alerts" element={<AlertsList />} />
                <Route path="/map" element={<NetworkMap />} />
                <Route path="/security/vulnerabilities" element={<Vulnerabilities />} />
                <Route path="/security/certificates" element={<Certificates />} />
                <Route path="/network/switches" element={<Switches />} />
                <Route path="/admin/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AlertCountProvider>
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      </AlertCountProvider>
    </ThemeProvider>
  );
}
