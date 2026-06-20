"""Post-install hook: copy plugin.yaml to Hermes plugin directory."""

from __future__ import annotations

import os
import shutil

from setuptools import setup
from setuptools.command.develop import develop
from setuptools.command.install import install


def _install_plugin_files() -> None:
    hermes_home = os.environ.get("HERMES_HOME") or os.path.join(
        os.environ.get("HOME") or os.path.expanduser("~"), ".hermes"
    )
    plugin_dir = os.path.join(hermes_home, "plugins", "observability", "agentmetrics")
    try:
        os.makedirs(plugin_dir, exist_ok=True)
        src = os.path.join(os.path.dirname(__file__), "plugin.yaml")
        dst = os.path.join(plugin_dir, "plugin.yaml")
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.copy2(src, dst)
            print(f"  AgentMetrics plugin manifest → {dst}")
        print("\n  AgentMetrics Hermes plugin installed!")
        print("  Add to your Hermes config.yaml:\n")
        print("    plugins:")
        print("      agentmetrics:")
        print("        enabled: true")
        print("        endpoint: http://localhost:8099")
        print("        api_key: <your-api-key>")
        print("      enabled:")
        print("        - observability/agentmetrics\n")
    except Exception as exc:
        # Never fail the pip install because of this.
        print(f"  [agentmetrics] Could not copy plugin.yaml: {exc}")
        print("  Copy it manually from the package to ~/.hermes/plugins/observability/agentmetrics/")


class _PostInstall(install):
    def run(self) -> None:
        super().run()
        _install_plugin_files()


class _PostDevelop(develop):
    def run(self) -> None:
        super().run()
        _install_plugin_files()


setup(
    cmdclass={
        "install": _PostInstall,
        "develop": _PostDevelop,
    }
)
