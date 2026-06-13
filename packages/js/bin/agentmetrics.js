#!/usr/bin/env node
"use strict";

const { execSync, spawnSync } = require("child_process");
const path = require("path");

const [,, command = "help"] = process.argv;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasDockerCompose() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pythonBin() {
  for (const py of ["python3", "python"]) {
    try {
      execSync(`${py} --version`, { stdio: "ignore" });
      return py;
    } catch { /* keep trying */ }
  }
  return null;
}

function hasServerBin() {
  try {
    execSync("agentmetrics-server --help", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureServer(py) {
  if (!hasServerBin()) {
    console.log("Installing agentmetrics-server...");
    execSync(`${py} -m pip install agentmetrics-server`, { stdio: "inherit" });
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdDashboard() {
  console.log("AgentMetrics\n");

  if (hasDockerCompose()) {
    console.log("Starting with Docker Compose...");
    const result = spawnSync("docker", ["compose", "up"], {
      stdio: "inherit",
      cwd: path.resolve(__dirname, "../../.."),
    });
    process.exit(result.status ?? 0);
  }

  const py = pythonBin();
  if (!py) {
    console.error(
      "Neither Docker nor Python found.\n\n" +
      "Install Docker: https://docs.docker.com/get-docker/\n" +
      "  then run:     docker compose up\n\n" +
      "Install Python: https://python.org\n" +
      "  then run:     pip install agentmetrics-server && agentmetrics-server"
    );
    process.exit(1);
  }

  ensureServer(py);
  console.log("  API      : http://localhost:8099");
  console.log("  Dashboard: http://localhost:8099  (if bundled)");
  console.log("  Press Ctrl+C to stop\n");
  const result = spawnSync("agentmetrics-server", ["--open"], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

// Service management commands delegate to the Python agentmetrics CLI,
// which handles install/start/stop/restart/status via OS-native service managers.
function cmdService(subcmd) {
  const py = pythonBin();
  if (!py) {
    console.error("Python is required for service management. Install from https://python.org");
    process.exit(1);
  }

  // Pass through any extra args (e.g. --port, --db)
  const extraArgs = process.argv.slice(3);

  // Prefer the Python agentmetrics CLI if available
  try {
    execSync("agentmetrics --help", { stdio: "ignore" });
    const result = spawnSync("agentmetrics", [subcmd, ...extraArgs], { stdio: "inherit" });
    process.exit(result.status ?? 0);
  } catch { /* fall through to python -m */ }

  // Fallback: run via python -m agentmetrics
  const result = spawnSync(py, ["-m", "agentmetrics", subcmd, ...extraArgs], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

function cmdHelp() {
  console.log(
    "AgentMetrics CLI\n\n" +
    "Server commands:\n" +
    "  agentmetrics dashboard            Start the server and open the dashboard\n\n" +
    "Service management (keeps server running 24/7):\n" +
    "  agentmetrics install              Install as OS service (auto-starts on boot)\n" +
    "  agentmetrics install --port 9000  Custom port\n" +
    "  agentmetrics install --db <url>   Custom database URL\n" +
    "  agentmetrics uninstall            Remove the installed service\n" +
    "  agentmetrics start                Start the installed service\n" +
    "  agentmetrics stop                 Stop the installed service\n" +
    "  agentmetrics restart              Restart the installed service\n" +
    "  agentmetrics status               Show service state and health check\n\n" +
    "Or with Docker directly:\n" +
    "  docker compose up\n"
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

switch (command) {
  case "dashboard":
  case "start":
    cmdDashboard();
    break;
  case "install":
  case "uninstall":
  case "stop":
  case "restart":
  case "status":
    cmdService(command);
    break;
  default:
    cmdHelp();
}
