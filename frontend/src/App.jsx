import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";

import ApplicationsPage from "./pages/ApplicationsPage";
import ComparisonReportPage from "./pages/ComparisonReportPage";
import CompaniesPage from "./pages/CompaniesPage";
import CompanyPage from "./pages/CompanyPage";
import DashboardPage from "./pages/DashboardPage";
import FetchLogsPage from "./pages/FetchLogsPage";
import ResumesPage from "./pages/ResumesPage";
import SettingsPage from "./pages/SettingsPage";

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

  return (
    <div className="layout">
      {!isOnline && (
        <div className="offline-banner">
          Offline mode: local dashboard/history/analysis remain available. Fetch operations will be queued.
        </div>
      )}
      <header className="header">
        <h1>Job Search Assistant</h1>
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
          <NavLink to="/settings" className={navClassName}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fetch-logs" element={<FetchLogsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:companyId" element={<CompanyPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/application/:comparisonReportId" element={<ComparisonReportPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          {/* Legacy redirects */}
          <Route path="/postings" element={<Navigate to="/applications" replace />} />
          <Route path="/postings/reports/:comparisonReportId" element={<LegacyPostingsReportRedirect />} />
          <Route path="/comparisons/:comparisonReportId" element={<LegacyComparisonRedirect />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
