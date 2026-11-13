import json
import os
import tempfile
import unittest

from xml_wizard import app_bridge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX = os.path.join(ROOT, "examples", "practice_data", "housing_survey")
ODM = os.path.join(EX, "housing_survey_odm.xml")
DICT = os.path.join(EX, "housing_survey_dictionary.csv")
DATA = os.path.join(EX, "housing_survey_data.csv")


class AppBridgeTests(unittest.TestCase):
    def test_scan_is_json_and_reports_issues_flags_and_data(self):
        result = app_bridge.scan(DICT, DATA)
        json.dumps(result)  # the app receives it as JSON
        self.assertTrue(result["has_data"])
        self.assertGreater(result["audit"]["n_rows"], 0)
        self.assertTrue(any(i["severity"] == "error" for i in result["issues"]))
        self.assertGreater(result["n_gated"], 0)
        for flag in result["flags"]:
            self.assertIn(flag["suggested"], ("mask", "drop", "keep"))
            self.assertIn(flag["level"], ("high", "medium", "low"))
            self.assertTrue(flag["reasons"])

    def test_scan_without_data(self):
        result = app_bridge.scan(DICT)
        self.assertFalse(result["has_data"])
        self.assertIsNone(result["audit"])

    def test_build_writes_bundle_and_applies_decisions(self):
        flags = app_bridge.scan(DICT, DATA)["flags"]
        self.assertTrue(flags, "the housing example has variables the privacy check flags")
        target = flags[0]["field"]
        with tempfile.TemporaryDirectory() as out:
            result = app_bridge.build(DICT, out, DATA, {target: "drop"}, data_stem="export")
            json.dumps(result)
            for rel in ("survey_tree.html", "redaction_decisions.csv", "agent_bundle/AGENTS.md",
                        "agent_bundle/CLAUDE.md", "agent_bundle/codebook.json", "agent_bundle/skip_logic.csv",
                        "agent_bundle/cleaning/apply_skip_logic.py", "agent_bundle/data/export_redacted.csv"):
                self.assertIn(rel, result["files"])
                self.assertTrue(os.path.exists(os.path.join(out, *rel.split("/"))))
            self.assertEqual(result["data_file"], "agent_bundle/data/export_redacted.csv")
            with open(os.path.join(out, "agent_bundle", "data", "export_redacted.csv"), encoding="utf-8") as fh:
                header = fh.readline().strip().split(",")
            self.assertNotIn(target, header)
            with open(os.path.join(out, "redaction_decisions.csv"), encoding="utf-8") as fh:
                self.assertIn(f"{target},drop", fh.read())

    def test_build_can_leave_the_data_copy_out(self):
        with tempfile.TemporaryDirectory() as out:
            result = app_bridge.build(ODM, out, include_data=False)
            self.assertEqual(result["data_file"], "")
            self.assertFalse(any(f.startswith("agent_bundle/data/") for f in result["files"]))

    def test_build_rejects_unknown_variables_and_actions(self):
        with tempfile.TemporaryDirectory() as out:
            with self.assertRaises(ValueError):
                app_bridge.build(DICT, out, decisions={"not_a_field": "mask"})
            with self.assertRaises(ValueError):
                app_bridge.build(DICT, out, decisions={"age": "shred"})


if __name__ == "__main__":
    unittest.main()
