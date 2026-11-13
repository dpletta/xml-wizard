"""Checks that keep the desktop app (desktop/) in step with the Python package."""

import json
import os
import re
import unittest

import xml_wizard

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESKTOP = os.path.join(ROOT, "desktop")


def _read(*parts):
    with open(os.path.join(DESKTOP, *parts), encoding="utf-8") as fh:
        return fh.read()


class DesktopTests(unittest.TestCase):
    def test_versions_agree(self):
        # The release tag, the installer names and "Version x" in the app all come from these.
        versions = {
            "src/xml_wizard/__init__.py": xml_wizard.__version__,
            "desktop/package.json": json.loads(_read("package.json"))["version"],
            "desktop/src-tauri/tauri.conf.json": json.loads(_read("src-tauri", "tauri.conf.json"))["version"],
            "desktop/src-tauri/Cargo.toml": re.search(r'^version = "([^"]+)"', _read("src-tauri", "Cargo.toml"), re.M).group(1),
        }
        self.assertEqual(len(set(versions.values())), 1, f"version numbers differ: {versions}")

    def test_app_and_web_build_share_one_content_security_policy(self):
        # The policy is what stops the window from loading or sending anything over the network.
        shell = json.loads(_read("src-tauri", "tauri.conf.json"))["app"]["security"]["csp"]
        web = "".join(re.findall(r'"([^"]*)"', _read("vite.config.ts").split("const CSP =")[1].split(";\n\n")[0]))
        self.assertEqual(shell, web)
        self.assertIn("default-src 'self'", shell)
        self.assertNotIn("http://", shell.replace("http://ipc.localhost", ""))
        self.assertNotIn("https:", shell)

    def test_app_ships_the_python_files_it_calls(self):
        # scripts/prepare-assets.mjs copies every .py, .R and .html file at the top of the package.
        names = set(os.listdir(os.path.join(ROOT, "src", "xml_wizard")))
        for needed in ("app_bridge.py", "viewer_template.html", "r_runtime.R"):
            self.assertIn(needed, names)


if __name__ == "__main__":
    unittest.main()
