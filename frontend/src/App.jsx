import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import ApplicationsPage from "./pages/ApplicationsPage";
import ComparisonReportPage from "./pages/ComparisonReportPage";
import CompaniesPage from "./pages/CompaniesPage";
import DashboardPage from "./pages/DashboardPage";
import PostingsPage from "./pages/PostingsPage";
import ResumesPage from "./pages/ResumesPage";
import SettingsPage from "./pages/SettingsPage";

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
          <NavLink to="/postings" className={navClassName}>
            Postings
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
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          <Route path="/postings" element={<PostingsPage />} />
          <Route path="/comparisons/:comparisonReportId" element={<ComparisonReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
