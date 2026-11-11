import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from xml_wizard import load_project
from xml_wizard import privacy
from xml_wizard.cli import main
from xml_wizard.model import Field, Instrument, Project

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX = os.path.join(ROOT, "examples", "practice_data", "housing_survey")
ODM = os.path.join(EX, "housing_survey_odm.xml")
DATA = os.path.join(EX, "housing_survey_data.csv")
MOST = os.path.join(ROOT, "examples", "practice_data", "most_data", "most_practice_metadata.xml")

NAMES = ["Maria Lopez", "James Smith", "Aisha Khan", "John Doe", "Wei Chen", "Fatima Ali", "Carlos Ruiz",
         "Grace Park", "Omar Haddad", "Lena Novak", "Ravi Patel", "Sara Berg"]


def _project(fields):
    p = Project(title="t", record_id_field="record_id")
    p.instruments = [Instrument("f", "F", [f.name for f in fields])]
    for i, f in enumerate(fields):
        f.order = i
        p.fields[f.name] = f
    return p


def _flags(project):
    return {f.field: f for f in privacy.detect_sensitive(project)}


class DetectTests(unittest.TestCase):
    def test_most_identifiers_flagged(self):
        flags = _flags(load_project(MOST))
        for name in ("loc_fname", "loc_lname", "loc_dob", "cellphone", "email", "scr1_dob"):
            self.assertEqual(flags[name].level, "high", name)
            self.assertEqual(flags[name].suggested, "mask", name)
        # Not marked as an Identifier in REDCap, caught by the date-of-birth rule
        self.assertIn("date of birth", flags["bl_dob"].reasons)
        self.assertEqual(flags["core_notes"].level, "medium")
        self.assertEqual(flags["bl_date"].level, "low")
        self.assertEqual(flags["bl_date"].suggested, "keep")
        # Coded answers and the record ID are never flagged
        for name in ("phq9_1", "gad_q1", "scr1_gender", "unique_id", "scr1_auto_age"):
            self.assertNotIn(name, flags)
        self.assertEqual(flags["scr1_dob"].used_in_logic_of, ["scr1_auto_age"])
        self.assertNotIn("street address or location", flags["email"].reasons)

    def test_name_and_label_rules(self):
        flags = _flags(_project([
            Field("record_id", "f", "text"),
            Field("pt_first", "f", "text", label="Participant's first name"),
            Field("q_lastname", "f", "text", label="Surname"),
            Field("addr1", "f", "text", label="Street"),
            Field("zip", "f", "text", validation="zipcode"),
            Field("med_name", "f", "text", label="Name of medication"),
            Field("how_many", "f", "text", label="How many times?", validation="integer"),
            Field("upload", "f", "file", label="Consent form"),
            Field("ip_addr", "f", "text", label="IP address"),
            Field("fav", "f", "radio", label="Your first name starts with", choices=[("1", "A")]),
        ]))
        self.assertEqual(flags["pt_first"].level, "high")
        self.assertEqual(flags["q_lastname"].level, "high")
        self.assertEqual(flags["addr1"].level, "high")
        self.assertEqual(flags["zip"].level, "high")
        self.assertEqual(flags["upload"].suggested, "drop")
        self.assertEqual(flags["ip_addr"].level, "high")
        self.assertNotEqual(flags["med_name"].level, "high")
        self.assertNotIn("how_many", flags)
        self.assertNotIn("fav", flags)

    def test_values_that_look_like_names_or_contacts(self):
        p = _project([Field("record_id", "f", "text"), Field("other", "f", "text", label="Other, specify"),
                      Field("contact", "f", "text", label="Best way to reach you"),
                      Field("place", "f", "text", label="Where do you sleep?")])
        p.data_rows = [{"record_id": str(i), "other": NAMES[i], "contact": f"p{i}@example.org",
                        "place": ["Shelter", "Car", "Street"][i % 3]} for i in range(12)]
        flags = _flags(p)
        self.assertEqual(flags["other"].level, "medium")
        self.assertTrue(any("look like names" in r for r in flags["other"].reasons))
        self.assertEqual(flags["contact"].level, "high")
        self.assertEqual(flags["place"].level, "low")  # repeated categories are not names
        # Reasons hold counts only, never values
        self.assertFalse(any("Maria" in r or "@" in r for f in flags.values() for r in f.reasons))


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.project = load_project(MOST)
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _answers(self, *answers):
        it = iter(answers)
        return lambda prompt: next(it)

    def test_interactive_choices_and_accept_all(self):
        out = io.StringIO()
        plan = privacy.review(self.project, "ask", input_fn=self._answers("", "?", "k", "d", "nonsense", "a"),
                              out=out)
        self.assertEqual(plan.action("scr1_dob"), "mask")
        self.assertEqual(plan.action("bl_dob"), "keep")
        self.assertEqual(plan.action("brief_staff_initials"), "drop")
        self.assertEqual(plan.action("loc_fname"), "mask")   # accepted with "a"
        self.assertEqual(plan.action("bl_date"), "keep")     # low-risk suggestion is keep
        text = out.getvalue()
        self.assertIn("Please type", text)
        self.assertIn("Reasons:", text)
        self.assertIn("scr1_auto_age", text)

    def test_group_question_for_dates(self):
        n_individual = sum(1 for f in privacy.detect_sensitive(self.project) if f.level != "low")
        plan = privacy.review(self.project, "ask", input_fn=self._answers(*([""] * n_individual + ["m", "k"])),
                              out=io.StringIO())
        self.assertEqual(plan.action("bl_date"), "mask")
        self.assertEqual(plan.action("rand_date"), "mask")
        self.assertEqual(plan.action("bl_birthplace_other"), "keep")

    def test_modes_and_saved_decisions(self):
        path = os.path.join(self.tmp, privacy.DECISIONS_FILE)
        plan = privacy.review(self.project, "none")
        self.assertEqual(plan.redacted(), {})
        plan = privacy.review(self.project, "suggested", extra={"loc_fname": "drop", "phq9_1": "mask"})
        self.assertEqual(plan.action("loc_fname"), "drop")
        self.assertEqual(plan.action("phq9_1"), "mask")
        self.assertEqual(plan.action("email"), "mask")
        privacy.save_decisions(path, plan)
        # A rerun asks nothing: every flag already has a saved decision
        again = privacy.review(self.project, "ask", path, input_fn=lambda p: self.fail("asked again"),
                               out=io.StringIO())
        self.assertEqual(again.actions, plan.actions)


class RedactedOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(DATA, newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        header = list(rows[0].keys())
        for i, r in enumerate(rows):
            if i % 3 == 0:
                k = i // 3
                r["housing_now_other"] = f"{NAMES[k % 5].split()[0]} {NAMES[5 + k // 5].split()[1]}"
        self.data = os.path.join(self.tmp, "export.csv")
        with open(self.data, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=header)
            w.writeheader()
            w.writerows(rows)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_cli_writes_redacted_data_and_scripts_respect_it(self):
        out = os.path.join(self.tmp, "out")
        self.assertEqual(main([ODM, "-d", self.data, "-o", out, "--redact", "suggested",
                               "--drop", "gender_self"]), 0)
        bundle = os.path.join(out, "agent_bundle")
        red = os.path.join(bundle, "data", "export_redacted.csv")
        with open(red, encoding="utf-8") as fh:
            text = fh.read()
        self.assertNotIn("Maria ", text)
        self.assertIn(privacy.MASK_TOKEN, text)
        header = next(csv.reader(io.StringIO(text)))
        self.assertNotIn("gender_self", header)
        self.assertIn("housing_now_other", header)

        cb = json.load(open(os.path.join(bundle, "codebook.json"), encoding="utf-8"))
        self.assertEqual(cb["schema_version"], "1.1")
        by = {f["name"]: f for f in cb["fields"]}
        self.assertEqual(by["housing_now_other"]["redaction"], "mask")
        self.assertEqual(by["gender_self"]["redaction"], "drop")
        self.assertIn("housing_now_other", cb["redaction"]["masked"])
        agents = open(os.path.join(bundle, "AGENTS.md"), encoding="utf-8").read()
        self.assertIn("## Privacy", agents)
        self.assertIn("data/export_redacted.csv", agents)
        decisions = privacy.load_decisions(os.path.join(out, privacy.DECISIONS_FILE))
        self.assertEqual(decisions["gender_self"], "drop")

        # The generated script, run on the ORIGINAL export, still redacts what it writes
        sk = os.path.join(self.tmp, "sk")
        subprocess.run([sys.executable, os.path.join(bundle, "cleaning", "apply_skip_logic.py"), self.data,
                        "--out-dir", sk], check=True, capture_output=True)
        for name in os.listdir(sk):
            body = open(os.path.join(sk, name), encoding="utf-8").read()
            self.assertNotIn("Maria ", body, name)
        cleaned_header = next(csv.reader(open(os.path.join(sk, "export_cleaned.csv"), encoding="utf-8")))
        self.assertNotIn("gender_self", cleaned_header)

        # ...and running it on the redacted copy gives the same skip statuses
        sk2 = os.path.join(self.tmp, "sk2")
        subprocess.run([sys.executable, os.path.join(bundle, "cleaning", "apply_skip_logic.py"), red,
                        "--out-dir", sk2], check=True, capture_output=True)
        # (except the dropped item, whose answers are gone)
        def report(folder):
            with open(os.path.join(folder, "skip_logic_report.csv"), encoding="utf-8") as fh:
                return [r for r in csv.reader(fh) if r[0] != "gender_self"]
        self.assertEqual(report(sk), report(sk2))

    def test_no_data_copy_and_redact_none(self):
        out = os.path.join(self.tmp, "out")
        self.assertEqual(main([ODM, "-d", self.data, "-o", out, "--redact", "none", "--no-data-copy"]), 0)
        self.assertFalse(os.path.exists(os.path.join(out, "agent_bundle", "data")))
        with open(os.path.join(out, "agent_bundle", "AGENTS.md"), encoding="utf-8") as fh:
            agents = fh.read()
        self.assertIn("No variables were redacted", agents)

    def test_unknown_field_is_an_error(self):
        self.assertEqual(main([ODM, "-o", os.path.join(self.tmp, "o"), "--mask", "no_such_item"]), 2)

    @unittest.skipUnless(shutil.which("Rscript"), "R not installed")
    def test_r_script_redacts_like_python(self):
        out = os.path.join(self.tmp, "out")
        main([ODM, "-d", self.data, "-o", out, "--redact", "suggested", "--drop", "gender_self"])
        cleaning = os.path.join(out, "agent_bundle", "cleaning")
        py, r = os.path.join(self.tmp, "py"), os.path.join(self.tmp, "r")
        subprocess.run([sys.executable, os.path.join(cleaning, "apply_skip_logic.py"), self.data, "--out-dir", py],
                       check=True, capture_output=True)
        subprocess.run(["Rscript", os.path.join(cleaning, "apply_skip_logic.R"), self.data, r],
                       check=True, capture_output=True)
        for name in ("export_cleaned.csv", "skip_logic_problems.csv"):
            with open(os.path.join(py, name), encoding="utf-8") as a, open(os.path.join(r, name), encoding="utf-8") as b:
                self.assertEqual(list(csv.reader(a)), list(csv.reader(b)), name)


if __name__ == "__main__":
    unittest.main()
