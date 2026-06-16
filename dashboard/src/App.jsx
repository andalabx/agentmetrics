import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Providers from "./components/Providers";
import { getStoredKey } from "./api/client";

const DashboardPage      = lazy(() => import("./views/DashboardPage"));
const AgentsPage         = lazy(() => import("./views/AgentsPage"));
const RunDetailPage      = lazy(() => import("./views/RunDetailPage"));
const ActivityPage       = lazy(() => import("./views/ActivityPage"));
const InsightsPage       = lazy(() => import("./views/InsightsPage"));
const AlertsPage         = lazy(() => import("./views/AlertsPage"));
const IntegrationsPage   = lazy(() => import("./views/IntegrationsPage"));
const AccountPage        = lazy(() => import("./views/AccountPage"));
const SetupPage          = lazy(() => import("./views/SetupPage"));

function PageShell() {
  return <div className="min-h-screen bg-bg" />;
}

// Redirect to /setup if no API key is stored
function RequireKey({ children }) {
  if (!getStoredKey()) {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <Suspense fallback={<PageShell />}>
          <Routes>
            {/* Public — no key required */}
            <Route path="/setup" element={<SetupPage />} />

            {/* All app routes require a stored API key */}
            <Route path="/" element={<RequireKey><Navigate to="/dashboard" replace /></RequireKey>} />

            <Route path="/dashboard"         element={<RequireKey><DashboardPage /></RequireKey>} />
            <Route path="/agents"            element={<RequireKey><AgentsPage /></RequireKey>} />
            <Route path="/agents/:agentId"   element={<RequireKey><AgentsPage /></RequireKey>} />
            <Route path="/runs/:traceId"     element={<RequireKey><RunDetailPage /></RequireKey>} />
            <Route path="/activity"          element={<RequireKey><ActivityPage /></RequireKey>} />
            <Route path="/live"              element={<Navigate to="/activity" replace />} />
            <Route path="/cost"              element={<RequireKey><InsightsPage /></RequireKey>} />
            <Route path="/alerts"            element={<RequireKey><AlertsPage /></RequireKey>} />
            <Route path="/connect"           element={<RequireKey><IntegrationsPage /></RequireKey>} />
            <Route path="/account"           element={<RequireKey><AccountPage /></RequireKey>} />

            {/* Legacy redirects */}
            <Route path="/insights"          element={<Navigate to="/cost" replace />} />
            <Route path="/health"            element={<Navigate to="/dashboard" replace />} />
            <Route path="/slo"               element={<Navigate to="/dashboard" replace />} />
            <Route path="/analytics"         element={<Navigate to="/cost" replace />} />
            <Route path="/cost-analysis"     element={<Navigate to="/cost" replace />} />
            <Route path="/recommendations"   element={<Navigate to="/cost" replace />} />
            <Route path="/settings"          element={<Navigate to="/account" replace />} />

            <Route path="*"                  element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </Providers>
    </BrowserRouter>
  );
}
