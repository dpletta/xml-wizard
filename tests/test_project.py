import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from xml_wizard import analyse, load_project
from xml_wizard.cli import main
from xml_wizard.codebook import build_codebook
from xml_wizard.viewer import render_viewer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX = os.path.join(ROOT, "examples")
ODM = os.path.join(EX, "housing_survey_odm.xml")
DD = os.path.join(EX, "housing_survey_dictionary.csv")
DATA = os.path.join(EX, "housing_survey_data.csv")

LONGITUDINAL_ODM = """<?xml version="1.0" encoding="UTF-8" ?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:redcap="https://projectredcap.org" ODMVersion="1.3.1">
<Study OID="Project.Long">
<GlobalVariables>
  <StudyName>Longitudinal test</StudyName>
  <redcap:RepeatingInstrumentsAndEvents><redcap:RepeatingInstruments>
    <redcap:RepeatingInstrument redcap:UniqueEventName="followup_arm_1" redcap:RepeatInstrument="visit" redcap:CustomLabel=""/>
  </redcap:RepeatingInstruments></redcap:RepeatingInstrumentsAndEvents>
</GlobalVariables>
<MetaDataVersion OID="Metadata.Long" Name="Longitudinal test" redcap:RecordIdField="pid">
  <Protocol><StudyEventRef StudyEventOID="Event.baseline_arm_1" OrderNumber="1" Mandatory="No"/></Protocol>
  <StudyEventDef OID="Event.baseline_arm_1" Name="Baseline" Type="Common" Repeating="No" redcap:UniqueEventName="baseline_arm_1" redcap:ArmNum="1">
    <FormRef FormOID="Form.intake" OrderNumber="1" Mandatory="No" redcap:FormName="intake"/>
  </StudyEventDef>
  <StudyEventDef OID="Event.followup_arm_1" Name="Follow-up" Type="Common" Repeating="No" redcap:UniqueEventName="followup_arm_1" redcap:ArmNum="1">
    <FormRef FormOID="Form.visit" OrderNumber="1" Mandatory="No" redcap:FormName="visit"/>
  </StudyEventDef>
  <FormDef OID="Form.intake" Name="Intake" Repeating="No" redcap:FormName="intake">
    <ItemGroupRef ItemGroupOID="intake.pid" Mandatory="No"/>
  </FormDef>
  <FormDef OID="Form.visit" Name="Visit" Repeating="No" redcap:FormName="visit">
    <ItemGroupRef ItemGroupOID="visit.seen" Mandatory="No"/>
  </FormDef>
  <ItemGroupDef OID="intake.pid" Name="Intake" Repeating="No">
    <ItemRef ItemOID="pid" Mandatory="No" redcap:Variable="pid"/>
    <ItemRef ItemOID="smoker" Mandatory="No" redcap:Variable="smoker"/>
  </ItemGroupDef>
  <ItemGroupDef OID="visit.seen" Name="Visit" Repeating="No">
    <ItemRef ItemOID="seen" Mandatory="No" redcap:Variable="seen"/>
    <ItemRef ItemOID="cigs" Mandatory="No" redcap:Variable="cigs"/>
    <ItemRef ItemOID="why" Mandatory="No" redcap:Variable="why"/>
  </ItemGroupDef>
  <ItemDef OID="pid" Name="pid" DataType="text" Length="999" redcap:Variable="pid" redcap:FieldType="text"><Question><TranslatedText>ID</TranslatedText></Question></ItemDef>
  <ItemDef OID="smoker" Name="smoker" DataType="text" Length="1" redcap:Variable="smoker" redcap:FieldType="yesno"><Question><TranslatedText>Smoker?</TranslatedText></Question><CodeListRef CodeListOID="smoker.choices"/></ItemDef>
  <ItemDef OID="seen" Name="seen" DataType="text" Length="1" redcap:Variable="seen" redcap:FieldType="yesno"><Question><TranslatedText>Seen?</TranslatedText></Question><CodeListRef CodeListOID="seen.choices"/></ItemDef>
  <ItemDef OID="cigs" Name="cigs" DataType="integer" Length="999" redcap:Variable="cigs" redcap:FieldType="text" redcap:TextValidationType="integer" redcap:BranchingLogic="[baseline_arm_1][smoker] = '1'"><Question><TranslatedText>Cigarettes per day</TranslatedText></Question></ItemDef>
  <ItemDef OID="why" Name="why" DataType="text" Length="999" redcap:Variable="why" redcap:FieldType="text" redcap:BranchingLogic="[seen] = '0'"><Question><TranslatedText>Why not seen?</TranslatedText></Question></ItemDef>
  <CodeList OID="smoker.choices" Name="smoker" DataType="text" redcap:Variable="smoker"><CodeListItem CodedValue="1"><Decode><TranslatedText>Yes</TranslatedText></Decode></CodeListItem><CodeListItem CodedValue="0"><Decode><TranslatedText>No</TranslatedText></Decode></CodeListItem></CodeList>
  <CodeList OID="seen.choices" Name="seen" DataType="text" redcap:Variable="seen"><CodeListItem CodedValue="1"><Decode><TranslatedText>Yes</TranslatedText></Decode></CodeListItem><CodeListItem CodedValue="0"><Decode><TranslatedText>No</TranslatedText></Decode></CodeListItem></CodeList>
</MetaDataVersion>
</Study>
<ClinicalData StudyOID="Project.Long" MetaDataVersionOID="Metadata.Long">
  <SubjectData SubjectKey="1" redcap:RecordIdField="pid">
    <StudyEventData StudyEventOID="Event.baseline_arm_1" StudyEventRepeatKey="1" redcap:UniqueEventName="baseline_arm_1">
      <FormData FormOID="Form.intake" FormRepeatKey="1"><ItemGroupData ItemGroupOID="intake.pid" ItemGroupRepeatKey="1">
        <ItemData ItemOID="pid" Value="1"/><ItemData ItemOID="smoker" Value="1"/></ItemGroupData></FormData>
    </StudyEventData>
    <StudyEventData StudyEventOID="Event.followup_arm_1" StudyEventRepeatKey="1" redcap:UniqueEventName="followup_arm_1">
      <FormData FormOID="Form.visit" FormRepeatKey="1"><ItemGroupData ItemGroupOID="visit.seen" ItemGroupRepeatKey="1">
        <ItemData ItemOID="seen" Value="0"/><ItemData ItemOID="why" Value="Moved"/></ItemGroupData></FormData>
      <FormData FormOID="Form.visit" FormRepeatKey="2"><ItemGroupData ItemGroupOID="visit.seen" ItemGroupRepeatKey="1">
        <ItemData ItemOID="seen" Value="1"/><ItemData ItemOID="why" Value="oops"/></ItemGroupData></FormData>
    </StudyEventData>
  </SubjectData>
</ClinicalData>
</ODM>
"""


class ReaderTests(unittest.TestCase):
    def test_odm_and_dictionary_agree(self):
        a, b = load_project(ODM), load_project(DD)
        self.assertEqual(list(a.fields), list(b.fields))
        for name in a.fields:
            fa, fb = a.fields[name], b.fields[name]
            self.assertEqual((fa.form, fa.field_type, fa.label, fa.choices, fa.branching_logic, fa.validation),
                             (fb.form, fb.field_type, fb.label, fb.choices, fb.branching_logic, fb.validation), name)
        self.assertEqual(a.title, "Housing and Health Survey (synthetic)")
        self.assertEqual(a.fields["race"].columns[-1], "race___98")
        self.assertEqual(a.fields["age"].validation_min, "18")

    def test_odm_clinical_data_matches_csv_export(self):
        odm_rows = load_project(ODM).data_rows
        csv_rows = load_project(DD, DATA).data_rows
        self.assertEqual(len(odm_rows), len(csv_rows))
        for r1, r2 in zip(odm_rows, csv_rows):
            for k, v in r2.items():
                self.assertEqual(r1.get(k, ""), v, k)

    def test_longitudinal_repeating(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "long.xml")
            with open(path, "w") as fh:
                fh.write(LONGITUDINAL_ODM)
            project = load_project(path)
        self.assertTrue(project.longitudinal)
        self.assertEqual(project.record_id_field, "pid")
        self.assertTrue(project.instrument("visit").repeating)
        self.assertEqual(len(project.data_rows), 3)  # baseline + two repeat instances
        a = analyse(project)
        self.assertIn("cross-event reference", a.fields["cigs"].unsupported)
        self.assertEqual(a.audit["fields"]["why"]["answered_when_hidden"], 1)
        self.assertEqual(a.audit["fields"]["why"]["rows"], 2)

    def test_rejects_non_redcap_files(self):
        from xml_wizard.readers import InputError
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.xml")
            with open(p, "w") as fh:
                fh.write("<root/>")
            with self.assertRaises(InputError):
                load_project(p)
            p = os.path.join(d, "x.csv")
            with open(p, "w") as fh:
                fh.write("a,b\n1,2\n")
            with self.assertRaises(InputError):
                load_project(p)


class AnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a = analyse(load_project(ODM))

    def codes(self, field):
        return {i.code for i in self.a.issues_for(field)}

    def test_planted_logic_bugs_found(self):
        self.assertIn("invalid_choice_code", self.codes("evicted_count"))
        self.assertIn("unknown_field", self.codes("substance_notes"))
        self.assertIn("forward_reference", self.codes("naloxone"))
        self.assertEqual(self.codes("homeless_6mo"), set())

    def test_tree_nests_under_nearest_gate(self):
        f = self.a.fields
        self.assertEqual(f["homeless_6mo"].tree_parent, "homeless_life")
        self.assertEqual(f["homeless_nights"].tree_parent, "homeless_6mo")
        self.assertEqual(f["race_other"].tree_parent, "race")
        self.assertIsNone(f["substance_notes"].tree_parent)
        self.assertEqual(f["homeless_6mo"].condition_chip, "if Yes")

    def test_implied_values(self):
        iv = {(v["field"], v["when_field"], v["when_value"]): v["implied_value"] for v in self.a.implied_values}
        self.assertEqual(iv[("homeless_6mo", "homeless_life", "0")], "0")
        self.assertEqual(iv[("homeless_nights", "homeless_6mo", "0")], "0")
        self.assertEqual(iv[("alc_binge", "alc_30d_days", "0")], "0")  # "Never"
        self.assertNotIn("evicted_count", {v["field"] for v in self.a.implied_values})  # broken logic
        self.assertTrue(all(v["confirmed"] is False for v in self.a.implied_values))

    def test_data_audit(self):
        t = self.a.audit["totals"]
        self.assertEqual(t["answered_when_hidden"], 2)
        self.assertEqual(t["invalid_codes"], 1)
        self.assertEqual(self.a.audit["fields"]["homeless_age"]["blank_when_shown"], 3)


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_cli_writes_viewer_and_bundle(self):
        out = os.path.join(self.tmp, "out")
        self.assertEqual(main([ODM, "-o", out]), 0)
        bundle = os.path.join(out, "agent_bundle")
        for rel in ("AGENTS.md", "CLAUDE.md", "codebook.json", "skip_logic.csv", "implied_values.csv",
                    "cleaning/apply_skip_logic.py", "cleaning/apply_skip_logic.R"):
            self.assertTrue(os.path.exists(os.path.join(bundle, rel)), rel)
        cb = json.load(open(os.path.join(bundle, "codebook.json")))
        self.assertEqual(cb["schema"], "xml-wizard/codebook")
        self.assertEqual(cb["project"]["counts"]["items_with_branching_logic"], 16)
        html = open(os.path.join(out, "survey_tree.html"), encoding="utf-8").read()
        self.assertEqual(html.count("</script>"), 2)
        self.assertNotIn("__XMLW_DATA__", html)

    def test_check_mode_exit_code(self):
        self.assertEqual(main([ODM, "--check"]), 1)

    def test_viewer_escapes_script_tags(self):
        cb = build_codebook(analyse(load_project(ODM)))
        cb["project"]["title"] = "</script><script>alert(1)</script>"
        html = render_viewer(cb)
        self.assertEqual(html.count("</script>"), 2)

    def _run_python_script(self, bundle, out, implied=None):
        cmd = [sys.executable, os.path.join(bundle, "cleaning", "apply_skip_logic.py"), DATA, "--out-dir", out]
        if implied:
            cmd += ["--implied-values", implied]
        subprocess.run(cmd, check=True, capture_output=True)
        with open(os.path.join(out, "skip_logic_report.csv")) as fh:
            return {r["field"]: r for r in csv.DictReader(fh)}

    def test_generated_python_script_matches_audit(self):
        main([DD, "-d", DATA, "-o", self.tmp])
        bundle = os.path.join(self.tmp, "agent_bundle")
        report = self._run_python_script(bundle, os.path.join(self.tmp, "py"))
        audit = analyse(load_project(DD, DATA)).audit["fields"]
        for field, r in report.items():
            self.assertEqual(int(r["skipped_but_answered"]), audit[field]["answered_when_hidden"], field)
            self.assertEqual(int(r["shown_missing"]), audit[field]["blank_when_shown"], field)
        # Confirm every suggested rule, rerun, and check the fills
        iv = os.path.join(self.tmp, "iv.csv")
        with open(os.path.join(bundle, "implied_values.csv")) as src, open(iv, "w") as dst:
            dst.write(src.read().replace(",FALSE,", ",TRUE,"))
        report = self._run_python_script(bundle, os.path.join(self.tmp, "py2"), iv)
        self.assertGreater(int(report["homeless_6mo"]["skipped_filled"]), 0)
        with open(os.path.join(self.tmp, "py2", "housing_survey_data_cleaned.csv")) as fh:
            rows = list(csv.DictReader(fh))
        for r in rows:
            if r["homeless_life"] == "0" and r["homeless_6mo__skip"] == "skipped_filled":
                self.assertEqual(r["homeless_6mo"], "0")
                self.assertEqual(r["homeless_nights"], "0")

    @unittest.skipUnless(shutil.which("Rscript"), "R is not installed")
    def test_generated_r_script_matches_python(self):
        main([DD, "-o", self.tmp])
        bundle = os.path.join(self.tmp, "agent_bundle")
        self._run_python_script(bundle, os.path.join(self.tmp, "py"))
        subprocess.run(["Rscript", os.path.join(bundle, "cleaning", "apply_skip_logic.R"), DATA,
                        os.path.join(self.tmp, "r")], check=True, capture_output=True)
        for name in ("skip_logic_report.csv", "skip_logic_problems.csv", "housing_survey_data_cleaned.csv"):
            with open(os.path.join(self.tmp, "py", name)) as a, open(os.path.join(self.tmp, "r", name)) as b:
                self.assertEqual(list(csv.reader(a)), list(csv.reader(b)), name)


if __name__ == "__main__":
    unittest.main()
