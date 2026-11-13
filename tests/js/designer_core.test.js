// Run with: node --test tests/js/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../../src/xml_wizard/designer_app/core.js");

const EX = path.join(__dirname, "..", "..", "examples", "practice_data");
const HOUSING = fs.readFileSync(path.join(EX, "housing_survey", "housing_survey_odm.xml"), "utf8");
const HOUSING_DD = fs.readFileSync(path.join(EX, "housing_survey", "housing_survey_dictionary.csv"), "utf8");
const MOST = fs.readFileSync(path.join(EX, "most_data", "most_practice_metadata.xml"), "utf8");

// A view of a project that ignores internal ids, for comparing two imports.
function shape(project) {
  return project.forms.map((form) => ({
    name: form.name, label: form.label,
    items: form.items.map((it) => it.kind === "section" ? { section: it.label.replace(/\s+/g, " ") } : {
      name: it.name, type: it.type, label: it.label.replace(/\s+/g, " "), choices: it.choices, note: it.note,
      validation: it.validation, min: it.min, max: it.max, required: it.required, identifier: it.identifier,
      logic: it.logic.replace(/\s+/g, " "), calc: it.calc, annotation: it.annotation, extra: it.extra,
    }),
  }));
}

test("XML parser reads entities, CDATA, comments and self-closing tags", () => {
  const doc = core.parseXml('<?xml version="1.0"?><!-- c --><a x="1 &lt; 2 &#039;q&#039;"><b/>t &amp; u<![CDATA[<raw>]]></a>');
  const a = doc.children[0];
  assert.equal(a.attrs[0][1], "1 < 2 'q'");
  assert.equal(a.children[0].name, "b");
  assert.equal(a.children[1] + a.children[2], "t & u<raw>");
  assert.throws(() => core.parseXml("<a><b></a>"), /not valid XML/);
});

test("imports the housing example with sections, choices and logic", () => {
  const { project, notes } = core.importOdm(HOUSING, "housing.xml");
  assert.deepEqual(project.forms.map((f) => f.name), ["demographics", "housing", "substance_use"]);
  const idx = core.fieldIndex(project);
  assert.equal(idx.gender_self.field.logic, "[gender] = '4'");
  assert.equal(idx.race.field.type, "checkbox");
  assert.equal(idx.race.field.choices.length, 6);
  assert.equal(idx.age.field.min, "18");
  assert.ok(!idx.demographics_complete, "form status fields are left to REDCap");
  assert.ok(project.forms[1].items[0].kind === "section");
  assert.ok(notes.some((n) => /participant records/.test(n)), "warns that records were not read");
});

for (const [label, xml] of [["housing", HOUSING], ["MOST", MOST]]) {
  test(`project XML round trip keeps every question (${label})`, () => {
    const first = core.importOdm(xml, "a.xml").project;
    const out = core.exportOdm(first, { now: new Date(2026, 0, 2, 3, 4, 5) });
    assert.ok(!/ClinicalData/.test(out.xml), "records are never exported");
    const second = core.importOdm(out.xml, "b.xml").project;
    assert.deepEqual(shape(second), shape(first));
    // and it is stable: exporting again gives the same file
    assert.equal(core.exportOdm(second, { now: new Date(2026, 0, 2, 3, 4, 5) }).xml, out.xml);
  });
}

test("longitudinal events and repeating instruments survive, minus deleted instruments", () => {
  const project = core.importOdm(MOST, "most.xml").project;
  const count = (xml, re) => (xml.match(re) || []).length;
  const before = core.exportOdm(project).xml;
  assert.equal(count(before, /<StudyEventDef /g), count(MOST, /<StudyEventDef /g));
  assert.equal(count(before, /<FormRef /g), count(MOST, /<FormRef /g));
  assert.match(before, /redcap:RepeatInstrument="patient_health_questionnaire_9"/);
  project.forms = project.forms.filter((f) => f.name !== "patient_health_questionnaire_9");
  const after = core.exportOdm(project).xml;
  assert.doesNotMatch(after, /patient_health_questionnaire_9/);
  assert.equal(count(after, /<StudyEventDef /g), count(MOST, /<StudyEventDef /g));
});

test("data dictionary round trip, and both formats describe the same survey", () => {
  const fromCsv = core.importDataDictionary(HOUSING_DD, "housing_survey_dictionary.csv").project;
  const again = core.importDataDictionary(core.exportDataDictionary(fromCsv), "x.csv").project;
  assert.deepEqual(shape(again), shape(fromCsv));
  const fromXml = core.importOdm(HOUSING, "housing.xml").project;
  const strip = (p) => shape(p).map((f) => f.items.map((it) => it.section ? it : { ...it, label: core.stripHtml(it.label) }));
  assert.deepEqual(strip(fromCsv), strip(fromXml));
});

test("a survey designed from scratch exports as REDCap project XML", () => {
  const p = core.newProject("Sleep study");
  const form = p.forms[0];
  const q1 = core.createFromKind(p, "yesno"); q1.label = "Do you nap?"; q1.name = "nap"; form.items.push(q1);
  form.items.push(core.newSection("Details"));
  const q2 = core.createFromKind(p, "checkbox"); q2.label = "When? <b>pick</b> any"; q2.name = "nap_when";
  q2.logic = core.addCondition("", { field: "nap", code: null, op: "=", value: "1" }); form.items.push(q2);
  const q3 = core.createFromKind(p, "integer"); q3.name = "nap_min"; q3.label = "Minutes"; q3.min = "1"; q3.required = true;
  q3.logic = core.addCondition(q2.logic, { field: "nap_when", code: "2", op: "checked", value: "" }); form.items.push(q3);
  assert.deepEqual(core.validate(p), []);
  const xml = core.exportOdm(p).xml;
  assert.match(xml, /redcap:RecordIdField="record_id"/);
  assert.match(xml, /<ItemDef OID="nap_when___2" Name="nap_when___2" DataType="boolean" Length="1" redcap:Variable="nap_when" redcap:FieldType="checkbox" redcap:SectionHeader="Details"/);
  assert.match(xml, /redcap:BranchingLogic="\[nap\] = &#039;1&#039; and \[nap_when\(2\)\] = &#039;1&#039;"/);
  assert.match(xml, /<TranslatedText>When\? pick any<\/TranslatedText><redcap:FormattedTranslatedText>When\? &lt;b&gt;pick&lt;\/b&gt; any</);
  assert.match(xml, /<ItemDef OID="survey_complete"/);
  const back = core.importOdm(xml, "sleep.xml").project;
  assert.deepEqual(shape(back), shape(p));
  const dd = core.parseCsv(core.exportDataDictionary(p));
  assert.equal(dd[0].length, 18);
  assert.deepEqual(dd[3].slice(0, 6), ["nap_when", "survey", "Details", "checkbox", "When? <b>pick</b> any", "1, Option 1 | 2, Option 2 | 3, Option 3"]);
});

test("rules: logic text to editable conditions and back", () => {
  assert.deepEqual(core.simpleRules("[a] = '1' and [b(2)] = '1' and [c] >= 18"), { join: "and", rules: [
    { field: "a", code: null, op: "=", value: "1" }, { field: "b", code: "2", op: "checked", value: "" },
    { field: "c", code: null, op: ">=", value: "18" }] });
  assert.equal(core.simpleRules("[a] != '1' or [b] <> ''").rules[1].op, "answered");
  assert.equal(core.simpleRules("([a] = '1' or [b] = '2') and [c] = '3'"), null);
  assert.equal(core.simpleRules("[visit_arm_1][a] = '1'"), null);
  assert.equal(core.simpleRules("datediff([a], [b], 'd') > 3"), null);
  const logic = "[a] = '1' and [b(2)] = '0' and [c] >= 18 and [d] = ''";
  assert.equal(core.rulesToLogic(core.simpleRules(logic)), logic);
  assert.equal(core.addCondition("[a] = '1' or [b] = '1'", { field: "c", code: null, op: "=", value: "2" }), "([a] = '1' or [b] = '1') and [c] = '2'");
});

test("evaluating logic for the preview", () => {
  const show = (logic, answers) => core.isShown({ logic }, answers);
  assert.equal(show("", {}), true);
  assert.equal(show("[a] = '1'", { a: "1" }), true);
  assert.equal(show("[a] = '1'", {}), false);
  assert.equal(show("[age] >= 18 and [age] <= 65", { age: "40" }), true);
  assert.equal(show("[age] > 9", { age: "10" }), true, "numbers compare as numbers");
  assert.equal(show("[r(98)] = '1' or [x] <> ''", { r: { 98: true } }), true);
  assert.equal(show("!([a] = '1')", { a: "1" }), false);
  assert.equal(show("datediff([a], 'today', 'd') > 3", {}), null, "functions are flagged, not guessed");
  assert.equal(show("[a] = = 1", {}), null);
});

test("checks catch the mistakes REDCap does not", () => {
  const p = core.sampleProject();
  assert.deepEqual(core.validate(p), []);
  const idx = core.fieldIndex(p);
  idx.gender_self.field.logic = "[gender] = '7'";
  idx.shelter_other.field.logic = "[shelter_type] = '98'";
  idx.age.field.logic = "[homeless_life] = '1' and [nope] = '1'";
  idx.rent_burden.field.name = "age";
  const msgs = core.validate(p).map((i) => i.severity + ": " + i.message).join("\n");
  assert.match(msgs, /error: .*no answer coded 7/);
  assert.match(msgs, /error: .*checkbox question, so the logic must name one option/);
  assert.match(msgs, /warning: .*asked later/);
  assert.match(msgs, /error: .*\[nope\], which does not exist/);
  assert.match(msgs, /error: .*'age' is used by more than one question/);
});

test("renaming a variable updates the logic that mentions it", () => {
  const p = core.sampleProject();
  core.renameVariable(p, "shelter_type", "stayed");
  core.renameVariable(p, "homeless_6mo", "recent");
  const idx = core.fieldIndex(p);
  assert.equal(idx.shelter_other.field.logic, "[stayed(98)] = '1'");
  assert.equal(idx.homeless_nights.field.logic, "[recent] = '1'");
});

test("variable names suggested from question text", () => {
  assert.equal(core.slugify("What is your age in years?"), "age_years");
  assert.equal(core.slugify("Have you ever been homeless in your lifetime?"), "ever_homeless_lifetime");
  assert.equal(core.slugify("9 to 5?"), "q_9_5");
  assert.equal(core.slugify(""), "question");
  const p = core.sampleProject();
  assert.equal(core.uniqueName(p, "age"), "age_2");
});
