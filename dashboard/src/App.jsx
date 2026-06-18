import { lazy, Suspense, Component, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Providers from "./components/Providers";
import { getStoredKey, clearStoredKey } from "./api/client";

const DashboardPage      = lazy(() => import("./views/DashboardPage"));
const AgentsPage         = lazy(() => import("./views/AgentsPage"));
const RunDetailPage      = lazy(() => import("./views/RunDetailPage"));
const ActivityPage       = lazy(() => import("./views/ActivityPage"));
const InsightsPage       = lazy(() => import("./views/InsightsPage"));
const AlertsPage         = lazy(() => import("./views/AlertsPage"));
const IntegrationsPage   = lazy(() => import("./views/IntegrationsPage"));
const AccountPage        = lazy(() => import("./views/AccountPage"));
const SetupPage          = lazy(() => import("./views/SetupPage"));

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
          <p className="text-2xl font-bold text-t1">Something went wrong</p>
          <p className="text-sm text-t2">{String(this.state.error.message || this.state.error)}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-txt hover:opacity-90"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageShell() {
  return <div className="min-h-screen bg-bg" />;
}

function RequireKey({ children }) {
  if (!getStoredKey()) return <Navigate to="/setup" replace />;
  return children;
}

function UnauthorizedHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => {
      clearStoredKey();
      navigate("/setup", { replace: true });
    };
    window.addEventListener("api:unauthorized", handler);
    return () => window.removeEventListener("api:unauthorized", handler);
  }, [navigate]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <ErrorBoundary>
          <UnauthorizedHandler />
          <Suspense fallback={<PageShell />}>
            <Routes>
              <Route path="/setup"                element={<SetupPage />} />

              <Route path="/"                     element={<RequireKey><Navigate to="/dashboard" replace /></RequireKey>} />
              <Route path="/dashboard"            element={<RequireKey><DashboardPage /></RequireKey>} />
              <Route path="/agents"               element={<RequireKey><AgentsPage /></RequireKey>} />
              <Route path="/agents/:agentId"      element={<RequireKey><AgentsPage /></RequireKey>} />
              <Route path="/runs/:traceId"        element={<RequireKey><RunDetailPage /></RequireKey>} />
              <Route path="/activity"             element={<RequireKey><ActivityPage /></RequireKey>} />
              <Route path="/live"                 element={<Navigate to="/activity" replace />} />
              <Route path="/cost"                 element={<RequireKey><InsightsPage /></RequireKey>} />
              <Route path="/alerts"               element={<RequireKey><AlertsPage /></RequireKey>} />
              <Route path="/connect"              element={<RequireKey><IntegrationsPage /></RequireKey>} />
              <Route path="/account"              element={<RequireKey><AccountPage /></RequireKey>} />

              <Route path="/insights"             element={<Navigate to="/cost" replace />} />
              <Route path="/health"               element={<Navigate to="/dashboard" replace />} />
              <Route path="/slo"                  element={<Navigate to="/dashboard" replace />} />
              <Route path="/analytics"            element={<Navigate to="/cost" replace />} />
              <Route path="/cost-analysis"        element={<Navigate to="/cost" replace />} />
              <Route path="/recommendations"      element={<Navigate to="/cost" replace />} />
              <Route path="/settings"             element={<Navigate to="/account" replace />} />

              <Route path="*"                     element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Providers>
    </BrowserRouter>
  );
}
