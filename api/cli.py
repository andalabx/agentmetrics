#!/usr/bin/env python3
"""
AgentMetrics CLI

Run the server:
    agentmetrics-server               # foreground (original entry point)
    agentmetrics run                  # same

Service management (no Docker needed):
    agentmetrics install              # install as OS service, auto-starts on boot
    agentmetrics install --port 9000  # custom port
    agentmetrics install --db postgresql://user:pass@localhost/mydb
    agentmetrics uninstall            # remove service
    agentmetrics start                # start installed service
    agentmetrics stop                 # stop installed service
    agentmetrics restart              # restart installed service
    agentmetrics status               # show service state and health check
"""
import os
import sys
import webbrowser

# ── Shared server startup ─────────────────────────────────────────────────────

def _do_serve(host: str, port: int, db: str | None, open_browser: bool) -> None:
    if db:
        os.environ["DATABASE_URL"] = db
    elif not os.environ.get("DATABASE_URL"):
        os.environ["DATABASE_URL"] = "sqlite:///./agentmetrics.db"

    db_url = os.environ["DATABASE_URL"]
    print("\n  AgentMetrics Server")
    print(f"  Database : {db_url}")
    print(f"  API      : http://{host}:{port}")
    print(f"  Docs     : http://{host}:{port}/docs\n")

    if open_browser:
        import threading
        threading.Timer(2.0, lambda: webbrowser.open(f"http://localhost:{port}")).start()

    try:
        import uvicorn
    except ImportError:
        print("Error: uvicorn is required. Run: pip install uvicorn[standard]")
        sys.exit(1)

    uvicorn.run("app.main:app", host=host, port=port, reload=False)


# ── Entry points ──────────────────────────────────────────────────────────────

def serve() -> None:
    """agentmetrics-server — original foreground entry point (kept for backwards compat)."""
    import argparse

    parser = argparse.ArgumentParser(
        prog="agentmetrics-server",
        description="Start the AgentMetrics API server",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", default=8099, type=int, help="Port to bind (default: 8099)")
    parser.add_argument("--db", default=None, metavar="URL",
                        help="Database URL. Defaults to sqlite:///./agentmetrics.db")
    parser.add_argument("--open", action="store_true", dest="open_browser",
                        help="Open the dashboard in a browser after starting")
    args = parser.parse_args()
    _do_serve(args.host, args.port, args.db, args.open_browser)


def main() -> None:
    """agentmetrics — service management + foreground run."""
    import argparse

    parser = argparse.ArgumentParser(
        prog="agentmetrics",
        description="AgentMetrics — AI agent observability",
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    # run (foreground)
    p_run = sub.add_parser("run", help="Start server in foreground")
    p_run.add_argument("--host", default="0.0.0.0")
    p_run.add_argument("--port", default=8099, type=int)
    p_run.add_argument("--db", default=None, metavar="URL")
    p_run.add_argument("--open", action="store_true", dest="open_browser")

    # install
    p_install = sub.add_parser(
        "install",
        help="Install as OS service — auto-starts on boot/login, restarts on crash",
    )
    p_install.add_argument("--port", default=8099, type=int,
                           help="Port to bind (default: 8099)")
    p_install.add_argument("--db", default=None, metavar="URL",
                           help="Database URL (default: SQLite in user data directory)")

    # uninstall
    sub.add_parser("uninstall", help="Remove the installed OS service")

    # start / stop / restart
    sub.add_parser("start",   help="Start the installed service")
    sub.add_parser("stop",    help="Stop the installed service")
    sub.add_parser("restart", help="Restart the installed service")

    # status
    p_status = sub.add_parser("status", help="Show service state and HTTP health")
    p_status.add_argument("--port", default=8099, type=int)

    args = parser.parse_args()

    if args.command is None or args.command == "run":
        host = getattr(args, "host", "0.0.0.0")
        port = getattr(args, "port", 8099)
        db = getattr(args, "db", None)
        open_browser = getattr(args, "open_browser", False)
        _do_serve(host, port, db, open_browser)

    elif args.command == "install":
        from daemon import install
        install(port=args.port, db_url=args.db or "")

    elif args.command == "uninstall":
        from daemon import uninstall
        uninstall()

    elif args.command == "start":
        from daemon import start
        start()

    elif args.command == "stop":
        from daemon import stop
        stop()

    elif args.command == "restart":
        from daemon import restart
        restart()

    elif args.command == "status":
        from daemon import status
        status(port=args.port)


if __name__ == "__main__":
    serve()
