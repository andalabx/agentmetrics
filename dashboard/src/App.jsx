import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Providers from "./components/Providers";

const DashboardPage      = lazy(() => import("./views/DashboardPage"));
const AgentsPage         = lazy(() => import("./views/AgentsPage"));
const AgentDetailPage    = lazy(() => import("./views/AgentDetailPage"));
const RunDetailPage      = lazy(() => import("./views/RunDetailPage"));
const LivePage           = lazy(() => import("./views/LivePage"));
const InsightsPage       = lazy(() => import("./views/InsightsPage"));
const AlertsPage         = lazy(() => import("./views/AlertsPage"));
const IntegrationsPage   = lazy(() => import("./views/IntegrationsPage"));
const AccountPage        = lazy(() => import("./views/AccountPage"));

function PageShell() {
  return <div className="min-h-screen bg-bg" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <Suspense fallback={<PageShell />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/dashboard"         element={<DashboardPage />} />
            <Route path="/agents"            element={<AgentsPage />} />
            <Route path="/agents/:agentId"   element={<AgentDetailPage />} />
            <Route path="/runs/:traceId"     element={<RunDetailPage />} />
            <Route path="/live"              element={<LivePage />} />
            <Route path="/cost"              element={<InsightsPage />} />
            <Route path="/alerts"            element={<AlertsPage />} />
            <Route path="/connect"           element={<IntegrationsPage />} />
            <Route path="/account"           element={<AccountPage />} />

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
