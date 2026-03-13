import { Component, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";

import { checkBackendHealth } from "./api";
import ApplicationsPage from "./pages/ApplicationsPage";
import ComparisonReportPage from "./pages/ComparisonReportPage";
import CompaniesPage from "./pages/CompaniesPage";
import CompanyPage from "./pages/CompanyPage";
import DashboardPage from "./pages/DashboardPage";
import FetchLogsPage from "./pages/FetchLogsPage";
import NotificationsPage from "./pages/NotificationsPage";
import ResumesPage from "./pages/ResumesPage";
import SettingsPage from "./pages/SettingsPage";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{ color: "#c92a2a" }}>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f8f9fa", padding: 16, borderRadius: 8, fontSize: 13 }}>
            {String(this.state.error)}
          </pre>
          {this.state.error?.stack && (
            <details style={{ marginTop: 12 }} open>
              <summary>Stack trace</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#666", maxHeight: 200, overflow: "auto" }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
          {this.state.errorInfo?.componentStack && (
            <details style={{ marginTop: 12 }}>
              <summary>Component stack</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#666" }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => { this.setState({ hasError: false, error: null, errorInfo: null }); }}
            style={{ marginTop: 16, padding: "8px 20px", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function LegacyComparisonRedirect() {
  const { comparisonReportId } = useParams();
  return <Navigate to={`/applications/application/${comparisonReportId}`} replace />;
}

function LegacyPostingsReportRedirect() {
  const { comparisonReportId } = useParams();
  return <Navigate to={`/applications/application/${comparisonReportId}`} replace />;
}

export default function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // null = unknown/checking, true = reachable, false = unreachable
  const [backendStatus, setBackendStatus] = useState(null);
  const intervalRef = useRef(null);

  const pollHealth = useCallback(async () => {
    const result = await checkBackendHealth();
    setBackendStatus(result.ok);
  }, []);

  function navClassName({ isActive }) {
    return isActive ? "nav-link nav-link--active" : "nav-link";
  }

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Poll backend health every 15s
  useEffect(() => {
    pollHealth();
    intervalRef.current = setInterval(pollHealth, 15000);
    return () => clearInterval(intervalRef.current);
  }, [pollHealth]);

  return (
    <div className="layout">
      {!isOnline && (
        <div className="offline-banner">
          Offline mode: local dashboard/history/analysis remain available. Fetch operations will be queued.
        </div>
      )}
      <header className="header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0 }}>Job Search Assistant</h1>
          <span
            className={`backend-indicator ${
              backendStatus === null ? "backend-checking" :
              backendStatus ? "backend-connected" : "backend-disconnected"
            }`}
            title={
              backendStatus === null ? "Checking backend..." :
              backendStatus ? "Backend connected" : "Backend unreachable"
            }
          />
        </div>
        <nav>
          <NavLink to="/dashboard" className={navClassName}>
            Dashboard
          </NavLink>
          <NavLink to="/companies" className={navClassName}>
            Companies
          </NavLink>
          <NavLink to="/applications" className={navClassName}>
            Applications
          </NavLink>
          <NavLink to="/resumes" className={navClassName}>
            Resumes
          </NavLink>
          <NavLink to="/notifications" className={navClassName}>
            Notifications
          </NavLink>
          <NavLink to="/settings" className={navClassName}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main>
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fetch-logs" element={<FetchLogsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:companyId" element={<CompanyPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/application/:comparisonReportId" element={<ComparisonReportPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* Legacy redirects */}
          <Route path="/postings" element={<Navigate to="/applications" replace />} />
          <Route path="/postings/reports/:comparisonReportId" element={<LegacyPostingsReportRedirect />} />
          <Route path="/comparisons/:comparisonReportId" element={<LegacyComparisonRedirect />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
