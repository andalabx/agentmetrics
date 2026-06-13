"""
agentmetrics CLI

Usage:
  agentmetrics dashboard             Start the server and open the dashboard
  agentmetrics install               Install as OS service (auto-starts on boot, restarts on crash)
  agentmetrics install --port 9000   Custom port
  agentmetrics install --db postgresql://user:pass@localhost/mydb
  agentmetrics uninstall             Remove the installed service
  agentmetrics start                 Start the installed service
  agentmetrics stop                  Stop the installed service
  agentmetrics restart               Restart the installed service
  agentmetrics status                Show service state and HTTP health check
"""
import shutil
import subprocess
import sys


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        prog="agentmetrics",
        description="AgentMetrics - AI agent observability",
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    sub.add_parser("dashboard", help="Start the server and open the dashboard")
    sub.add_parser("start",     help="Alias for dashboard")

    p_install = sub.add_parser(
        "install",
        help="Install as OS service — auto-starts on boot, restarts on crash",
    )
    p_install.add_argument("--port", default=8099, type=int,
                           help="Port to bind (default: 8099)")
    p_install.add_argument("--db", default=None, metavar="URL",
                           help="Database URL (default: SQLite in user data directory)")

    sub.add_parser("uninstall", help="Remove the installed OS service")
    sub.add_parser("stop",      help="Stop the installed service")
    sub.add_parser("restart",   help="Restart the installed service")

    p_status = sub.add_parser("status", help="Show service state and HTTP health check")
    p_status.add_argument("--port", default=8099, type=int)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return

    if args.command in ("dashboard", "start"):
        _start_dashboard()
        return

    # All service management commands require agentmetrics-server to be installed
    _require_server(args.command)

    from agentmetrics.daemon import install, restart, status, stop, uninstall

    if args.command == "install":
        install(port=args.port, db_url=args.db or "")
    elif args.command == "uninstall":
        uninstall()
    elif args.command == "stop":
        stop()
    elif args.command == "restart":
        restart()
    elif args.command == "status":
        status(port=args.port)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has_server() -> bool:
    """Return True if agentmetrics-server is available on PATH."""
    return shutil.which("agentmetrics-server") is not None


def _require_server(command: str) -> None:
    if not _has_server():
        print(f"'agentmetrics {command}' requires the server package.")
        print("  pip install agentmetrics-server")
        sys.exit(1)


def _start_dashboard() -> None:
    """Try Docker Compose first, then fall back to agentmetrics-server."""
    if _has_docker_compose():
        root = _repo_root()
        if root:
            print("Starting AgentMetrics with Docker Compose...")
            result = subprocess.run(["docker", "compose", "up"], cwd=root)
            sys.exit(result.returncode)

    if not _has_server():
        print("Installing agentmetrics-server...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "agentmetrics-server"],
            check=True,
        )

    print("Starting AgentMetrics...")
    print("  API      : http://localhost:8099")
    print("  Dashboard: http://localhost:8099  (if bundled)")
    print("  Docs     : http://localhost:8099/docs")
    print("  Press Ctrl+C to stop\n")
    result = subprocess.run(["agentmetrics-server", "--open"])
    sys.exit(result.returncode)


def _has_docker_compose() -> bool:
    try:
        subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True, check=True,
        )
        return True
    except Exception:
        return False


def _repo_root() -> str | None:
    """Walk up from this file looking for docker-compose.yml."""
    import os
    current = os.path.dirname(os.path.abspath(__file__))
    for _ in range(10):
        if os.path.exists(os.path.join(current, "docker-compose.yml")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


if __name__ == "__main__":
    main()
