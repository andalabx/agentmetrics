"""
AgentMetrics daemon management.

Installs, starts, stops, and queries the server as a persistent OS-level service
so it survives reboots, laptop sleep/wake cycles, and crashes without Docker.

Platform support:
  Linux   - systemd user service (~/.config/systemd/user/) or system service (/etc/systemd/)
  macOS   - launchd user agent (~/Library/LaunchAgents/)
  Windows - Task Scheduler (runs at logon, highest privileges)
"""
import os
import platform
import shlex
import shutil
import subprocess
import sys
import textwrap
import urllib.request
from pathlib import Path


_SERVICE_NAME = "agentmetrics"
_PLIST_LABEL = "com.agentmetrics.server"


# ── Paths ─────────────────────────────────────────────────────────────────────

def _data_dir() -> Path:
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home()))
        d = base / "AgentMetrics"
    elif system == "Darwin":
        d = Path.home() / "Library" / "Application Support" / "AgentMetrics"
    else:
        xdg = os.environ.get("XDG_DATA_HOME", "")
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
        d = base / "agentmetrics"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log_dir() -> Path:
    system = platform.system()
    if system == "Darwin":
        d = Path.home() / "Library" / "Logs" / "AgentMetrics"
    elif system == "Windows":
        d = _data_dir() / "logs"
    else:
        xdg = os.environ.get("XDG_STATE_HOME", "")
        base = Path(xdg) if xdg else Path.home() / ".local" / "state"
        d = base / "agentmetrics"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _systemd_system_path() -> Path:
    return Path("/etc/systemd/system") / f"{_SERVICE_NAME}.service"


def _systemd_user_path() -> Path:
    return Path.home() / ".config" / "systemd" / "user" / f"{_SERVICE_NAME}.service"


def _plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{_PLIST_LABEL}.plist"


# ── Server binary detection ───────────────────────────────────────────────────

def server_exe() -> str | None:
    """Return the absolute path to agentmetrics-server, or None if not installed."""
    found = shutil.which("agentmetrics-server")
    if found:
        return found
    # Check alongside the current interpreter (useful in venvs)
    candidate = Path(sys.executable).parent / "agentmetrics-server"
    if candidate.exists():
        return str(candidate)
    candidate_exe = Path(sys.executable).parent / "agentmetrics-server.exe"
    if candidate_exe.exists():
        return str(candidate_exe)
    return None


def _default_db_url() -> str:
    return f"sqlite:///{_data_dir() / 'agentmetrics.db'}"


# ── Service definition generators ────────────────────────────────────────────

def _systemd_unit(exe: str, port: int, db_url: str) -> str:
    user = os.environ.get("USER", os.environ.get("LOGNAME", ""))
    user_line = f"User={user}\n" if user else ""
    return textwrap.dedent(f"""\
        [Unit]
        Description=AgentMetrics Server
        Documentation=https://github.com/andalabx/agentmetrics
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=simple
        {user_line}Environment=DATABASE_URL={db_url}
        ExecStart={exe} --port {port}
        Restart=always
        RestartSec=5
        StandardOutput=journal
        StandardError=journal

        [Install]
        WantedBy=multi-user.target
    """).strip()


def _launchd_plist(exe: str, port: int, db_url: str) -> str:
    args = shlex.split(exe) + ["--port", str(port)]
    args_xml = "\n".join(f"        <string>{a}</string>" for a in args)
    logs = _log_dir()
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
         "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>{_PLIST_LABEL}</string>
            <key>ProgramArguments</key>
            <array>
        {args_xml}
            </array>
            <key>EnvironmentVariables</key>
            <dict>
                <key>DATABASE_URL</key>
                <string>{db_url}</string>
            </dict>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>StandardOutPath</key>
            <string>{logs}/stdout.log</string>
            <key>StandardErrorPath</key>
            <string>{logs}/stderr.log</string>
        </dict>
        </plist>
    """).strip()


# ── Installers ────────────────────────────────────────────────────────────────

def _install_linux(exe: str, port: int, db_url: str) -> None:
    unit_content = _systemd_unit(exe, port, db_url)
    is_root = os.geteuid() == 0
    service_path = _systemd_system_path() if is_root else _systemd_user_path()
    scope: list[str] = [] if is_root else ["--user"]
    tier = "system" if is_root else "user"

    service_path.parent.mkdir(parents=True, exist_ok=True)
    service_path.write_text(unit_content)
    subprocess.run(["systemctl", *scope, "daemon-reload"], check=True)
    subprocess.run(["systemctl", *scope, "enable", _SERVICE_NAME], check=True)
    subprocess.run(["systemctl", *scope, "start", _SERVICE_NAME], check=True)

    print(f"AgentMetrics installed as {tier} systemd service and started.")
    print(f"  Service file : {service_path}")
    print(f"  Logs         : journalctl {' '.join(scope)} -u {_SERVICE_NAME} -f")
    print(f"  Database     : {db_url}")


def _install_macos(exe: str, port: int, db_url: str) -> None:
    plist_content = _launchd_plist(exe, port, db_url)
    plist = _plist_path()
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text(plist_content)
    subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
    subprocess.run(["launchctl", "load", "-w", str(plist)], check=True)

    logs = _log_dir()
    print("AgentMetrics installed as launchd agent and started.")
    print(f"  Plist file : {plist}")
    print(f"  Logs       : {logs}/stdout.log")
    print(f"  Database   : {db_url}")


def _install_windows(exe: str, port: int, db_url: str) -> None:
    data = _data_dir()
    bat = data / "run.bat"
    bat.write_text(
        f"@echo off\nset DATABASE_URL={db_url}\n\"{exe}\" --port {port}\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        ["schtasks", "/create", "/tn", "AgentMetrics", "/tr", str(bat),
         "/sc", "ONLOGON", "/rl", "HIGHEST", "/f"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"Error: {result.stderr.strip()}", file=sys.stderr)
        print("Try running as Administrator.", file=sys.stderr)
        sys.exit(1)
    subprocess.run(["schtasks", "/run", "/tn", "AgentMetrics"], capture_output=True)
    print("AgentMetrics installed as a Windows Scheduled Task (runs at logon).")
    print(f"  Wrapper script : {bat}")
    print(f"  Database       : {db_url}")


# ── Public API ────────────────────────────────────────────────────────────────

def install(port: int = 8099, db_url: str = "") -> None:
    exe = server_exe()
    if not exe:
        print("agentmetrics-server is not installed.", file=sys.stderr)
        print("  pip install agentmetrics-server", file=sys.stderr)
        sys.exit(1)
    resolved_db = db_url or _default_db_url()
    system = platform.system()
    if system == "Linux":
        _install_linux(exe, port, resolved_db)
    elif system == "Darwin":
        _install_macos(exe, port, resolved_db)
    elif system == "Windows":
        _install_windows(exe, port, resolved_db)
    else:
        print(f"Unsupported platform: {system}", file=sys.stderr)
        sys.exit(1)


def uninstall() -> None:
    system = platform.system()
    if system == "Linux":
        is_root = os.geteuid() == 0
        scope: list[str] = [] if is_root else ["--user"]
        subprocess.run(["systemctl", *scope, "stop", _SERVICE_NAME], capture_output=True)
        subprocess.run(["systemctl", *scope, "disable", _SERVICE_NAME], capture_output=True)
        for path in (_systemd_system_path(), _systemd_user_path()):
            if path.exists():
                path.unlink()
        subprocess.run(["systemctl", *scope, "daemon-reload"], capture_output=True)
        print("AgentMetrics service removed.")
    elif system == "Darwin":
        plist = _plist_path()
        subprocess.run(["launchctl", "unload", "-w", str(plist)], capture_output=True)
        if plist.exists():
            plist.unlink()
        print("AgentMetrics launchd agent removed.")
    elif system == "Windows":
        subprocess.run(["schtasks", "/end", "/tn", "AgentMetrics"], capture_output=True)
        subprocess.run(["schtasks", "/delete", "/tn", "AgentMetrics", "/f"], capture_output=True)
        print("AgentMetrics scheduled task removed.")
    else:
        print(f"Unsupported platform: {platform.system()}", file=sys.stderr)
        sys.exit(1)


def start() -> None:
    system = platform.system()
    if system == "Linux":
        scope: list[str] = [] if os.geteuid() == 0 else ["--user"]
        subprocess.run(["systemctl", *scope, "start", _SERVICE_NAME], check=True)
    elif system == "Darwin":
        subprocess.run(["launchctl", "load", "-w", str(_plist_path())], check=True)
    elif system == "Windows":
        subprocess.run(["schtasks", "/run", "/tn", "AgentMetrics"],
                       check=True, capture_output=True)
    print("AgentMetrics started.")


def stop() -> None:
    system = platform.system()
    if system == "Linux":
        scope: list[str] = [] if os.geteuid() == 0 else ["--user"]
        subprocess.run(["systemctl", *scope, "stop", _SERVICE_NAME], check=True)
    elif system == "Darwin":
        subprocess.run(["launchctl", "unload", str(_plist_path())], check=True)
    elif system == "Windows":
        subprocess.run(["schtasks", "/end", "/tn", "AgentMetrics"],
                       check=True, capture_output=True)
    print("AgentMetrics stopped.")


def restart() -> None:
    system = platform.system()
    if system == "Linux":
        scope: list[str] = [] if os.geteuid() == 0 else ["--user"]
        subprocess.run(["systemctl", *scope, "restart", _SERVICE_NAME], check=True)
    elif system == "Darwin":
        plist = str(_plist_path())
        subprocess.run(["launchctl", "unload", plist], capture_output=True)
        subprocess.run(["launchctl", "load", "-w", plist], check=True)
    elif system == "Windows":
        subprocess.run(["schtasks", "/end", "/tn", "AgentMetrics"], capture_output=True)
        subprocess.run(["schtasks", "/run", "/tn", "AgentMetrics"],
                       check=True, capture_output=True)
    print("AgentMetrics restarted.")


def status(port: int = 8099) -> None:
    system = platform.system()
    sep = "=" * 42
    print(sep)
    print("  AgentMetrics Status")
    print(sep)

    if system == "Linux":
        is_root = os.geteuid() == 0
        scope: list[str] = [] if is_root else ["--user"]
        installed = _systemd_system_path().exists() or _systemd_user_path().exists()
        print(f"  Service (systemd) : {'installed' if installed else 'not installed'}")
        if installed:
            r = subprocess.run(["systemctl", *scope, "is-active", _SERVICE_NAME],
                               capture_output=True, text=True)
            print(f"  State             : {r.stdout.strip()}")
    elif system == "Darwin":
        plist = _plist_path()
        installed = plist.exists()
        print(f"  Service (launchd) : {'installed' if installed else 'not installed'}")
        if installed:
            r = subprocess.run(["launchctl", "list", _PLIST_LABEL],
                               capture_output=True, text=True)
            print(f"  State             : {'running' if r.returncode == 0 else 'stopped'}")
            print(f"  Logs              : {_log_dir()}/stdout.log")
    elif system == "Windows":
        r = subprocess.run(
            ["schtasks", "/query", "/tn", "AgentMetrics", "/fo", "LIST"],
            capture_output=True, text=True,
        )
        print(f"  Service (schtasks): {'installed' if r.returncode == 0 else 'not installed'}")

    url = f"http://localhost:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            resp.read()
        print(f"  Health            : OK ({url})")
    except Exception as exc:
        print(f"  Health            : UNREACHABLE ({url})")
        print(f"                      {exc}")
    print(sep)
