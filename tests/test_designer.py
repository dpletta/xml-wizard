import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from xml_wizard.cli import main
from xml_wizard.designer import render_designer, strip_records
from xml_wizard.readers import read_data_dictionary, read_odm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX = os.path.join(ROOT, "examples", "practice_data")
HOUSING = os.path.join(EX, "housing_survey", "housing_survey_odm.xml")
MOST = os.path.join(EX, "most_data", "most_practice_metadata.xml")
CORE = os.path.join(ROOT, "src", "xml_wizard", "designer_app", "core.js")
BUILT = os.path.join(ROOT, "docs", "designer.html")

# Opens a REDCap file with the designer's own code and writes back what its Export button would.
NODE_EXPORT = """
const [corePath, source, xmlOut, csvOut] = process.argv.slice(-4);
const core = require(corePath);
const fs = require("fs");
const project = core.importAny(fs.readFileSync(source, "utf8"), "in").project;
fs.writeFileSync(xmlOut, core.exportOdm(project).xml);
fs.writeFileSync(csvOut, core.exportDataDictionary(project));
"""


def _squash(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _shape(project, with_events=True):
    fields = []
    for f in project.ordered_fields():
        fields.append((f.name, f.form, f.field_type, _squash(f.label), tuple(f.choices), _squash(f.branching_logic),
                       _squash(f.section_header), f.field_note, f.validation, f.validation_min, f.validation_max,
                       f.annotation, f.calculation, f.required, f.identifier))
    forms = [(i.name, i.label, i.repeating) for i in project.instruments]
    events = [(e.unique_name, e.label, e.arm, tuple(e.forms), tuple(e.repeating_forms)) for e in project.events]
    return {"record_id": project.record_id_field, "forms": forms, "fields": fields,
            "events": events if with_events else None}


class DesignerPageTests(unittest.TestCase):
    def test_page_is_self_contained(self):
        page = render_designer()
        self.assertNotIn("__XMLW_", page)
        self.assertNotRegex(page, r"""(src|href)=["']https?://""")
        self.assertIn("XMLWCore", page)
        self.assertIn('id="xmlw-preload">null</script>', page)
        self.assertEqual(page.count("</script>"), 3)

    def test_preloaded_project_carries_no_records(self):
        with open(HOUSING, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("<SubjectData", text)
        page = render_designer(text, "housing.xml")
        self.assertNotIn("SubjectData", page)
        self.assertNotIn("ItemData", page)
        payload = re.search(r'id="xmlw-preload">(.*?)</script>', page, re.S).group(1)
        loaded = json.loads(payload)
        self.assertEqual(loaded["name"], "housing.xml")
        self.assertIn('redcap:Variable="homeless_6mo"', loaded["text"])
        self.assertEqual(strip_records("<ODM><ClinicalData a='1'>\n<x/></ClinicalData ></ODM>"), "<ODM></ODM>")

    def test_published_copy_is_current(self):
        # docs/designer.html is the copy people download without installing Python.
        with open(BUILT, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), render_designer(),
                             "Rebuild it with: xml-wizard design -o docs/designer.html")

    def test_design_command(self):
        tmp = tempfile.mkdtemp()
        try:
            out = os.path.join(tmp, "d.html")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["design", MOST, "-o", out]), 0)
                self.assertEqual(main(["design", os.path.join(ROOT, "README.md"), "-o", out]), 2)
            with open(out, encoding="utf-8") as fh:
                self.assertIn("scr1_livingin", fh.read())
        finally:
            shutil.rmtree(tmp)


@unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
class DesignerExportTests(unittest.TestCase):
    """What the designer exports must read back as the same project in the Python reader."""

    def _export(self, source):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        xml, dd = os.path.join(tmp, "out.xml"), os.path.join(tmp, "out.csv")
        subprocess.run(["node", "-e", NODE_EXPORT, CORE, source, xml, dd], check=True)
        return xml, dd

    def test_housing_survives_the_round_trip(self):
        xml, dd = self._export(HOUSING)
        original = read_odm(HOUSING)
        self.assertEqual(_shape(read_odm(xml)), _shape(original))
        self.assertIsNone(read_odm(xml).data_rows, "records must never be exported")
        # The data dictionary carries no events or instrument labels, so compare the fields.
        self.assertEqual(_shape(read_data_dictionary(dd))["fields"], _shape(original)["fields"])

    def test_longitudinal_project_survives_the_round_trip(self):
        xml, _ = self._export(MOST)
        original = read_odm(MOST)
        self.assertEqual(len(original.events), 41)
        self.assertEqual(_shape(read_odm(xml)), _shape(original))

    def test_core_tests(self):
        tests = os.path.join(ROOT, "tests", "js", "designer_core.test.js")
        done = subprocess.run(["node", "--test", tests], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stdout[-3000:] + done.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
