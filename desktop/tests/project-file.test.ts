import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C } from '../src/lib/core.ts';
import { encodeProject, decodeProject } from '../src/lib/project-file.ts';
import { useStore } from '../src/lib/store.ts';
import { computeLayout, dropTarget } from '../src/lib/layout.ts';
import { compactLayout } from '../src/lib/compact-layout.ts';

test('portable projects keep incomplete designs, sections, layout and planning flows without retaining source files', () => {
  const p = C.sampleProject();
  const empty = C.newForm(p, 'Empty instrument');
  empty.items.push(C.newSection('A new section'), C.newSection('Another empty section'));
  p.forms.push(empty);
  const field = C.allFields(p)[1];
  field.logic = '[unfinished'; field.name = ''; field.choicesRaw = '0 | 100';
  p.source = { text: 'SECRET_RAW_INPUT', ClinicalData: 'SECRET_RECORD' };
  p.workspace = { positions: { [empty.id]: {x: -300, y: 450} }, flows: [{id:'flow-example', source: p.forms[0].id, target: empty.id, label:'Next visit'}] };
  const text = encodeProject(p);
  assert.ok(!text.includes('SECRET'));
  const saved = decodeProject(text);
  assert.deepEqual(saved, {...p, source:null});
  assert.equal(C.exportDataDictionary(saved), C.exportDataDictionary(p));
});

test('REDCap imports with clinical records only save design metadata, and retained events survive', () => {
  const xml = readFileSync(new URL('../../examples/practice_data/housing_survey/housing_survey_odm.xml',import.meta.url),'utf8');
  const raw = xml.replace('</ODM>', '<ClinicalData><SubjectData SubjectKey="SECRET_RECORD"/></ClinicalData></ODM>');
  const p = C.importAny(raw, 'example.xml').project;
  const text = encodeProject(p);
  assert.ok(!text.includes('SECRET_RECORD'));
  assert.ok(!text.includes('ClinicalData'));
  const saved = decodeProject(text);
  assert.deepEqual(saved.keep, p.keep);
  const date = new Date('2026-01-01T00:00:00Z');
  assert.equal(C.exportOdm(saved,{now:date}).xml, C.exportOdm(p,{now:date}).xml);
});

test('malformed project files cannot inject arbitrary fields, XML tags, invalid endpoints or positions', () => {
  const p = C.sampleProject();
  const valid = JSON.parse(encodeProject(p));
  assert.throws(() => decodeProject('{}'));
  const edit = (fn: (v: typeof valid) => void) => { const v = structuredClone(valid); fn(v); return JSON.stringify(v); };
  assert.throws(() => decodeProject(edit((v) => { v.version = 2; })));
  assert.throws(() => decodeProject(edit((v) => { v.project.forms[0].id = '__proto__'; })));
  assert.throws(() => decodeProject(edit((v) => { v.project.forms[0].items[0].choices = null; })));
  assert.throws(() => decodeProject(edit((v) => { v.project.workspace = { positions: {}, flows: [{id:'line',source:'missing',target:'missing',label:'X'}] }; })));
  assert.throws(() => decodeProject(edit((v) => { v.project.workspace = { positions: {[p.forms[0].id]:{x:'0',y:0}}, flows: [] }; })));
  assert.throws(() => decodeProject(edit((v) => { v.project.keep = {version:'1',globals:[{name:'ClinicalData',attrs:[],children:[]}],protocol:null,events:[]}; })));
  const cleaned = decodeProject(edit((v) => { v.project.records = ['PRIVATE']; v.project.forms[0].items[0].rawData = 'PRIVATE'; }));
  assert.ok(!JSON.stringify(cleaned).includes('PRIVATE'));
});

test('placing instruments preserves export order; drops use displaced instrument coordinates', () => {
  const p = C.sampleProject();
  useStore.getState().open(p, null, 'design');
  const before = C.exportDataDictionary(p), form = p.forms[1];
  useStore.getState().positionForm(form.id, {x:-800,y:900});
  assert.equal(C.exportDataDictionary(p), before);
  const l = computeLayout(p, true), col = l.columnById.get(form.id)!;
  assert.equal(col.x, -800); assert.equal(col.y, 900);
  const t = dropTarget(l, col.x + 50, col.y + col.slots[0].y + 5, null)!;
  assert.equal(t.form.id, form.id); assert.ok(t.lineY >= col.y);
  assert.equal(dropTarget(l, 100000, 100000, null), null);
  useStore.getState().undo();
  assert.equal(useStore.getState().project!.workspace, undefined);
});

test('flow annotations survive Overview, undo and save; deleting their endpoint removes them', () => {
  const p = C.sampleProject();
  const st = useStore.getState(); st.open(p, null, 'design');
  st.addFlow(p.forms[0].id,p.forms[1].id);
  st.addFlow(p.forms[0].id,p.forms[1].id);
  assert.equal(p.workspace!.flows.length,1);
  const compact = compactLayout(computeLayout(p,false),new Set(),3,p.workspace!.flows);
  assert.ok(compact.edges.some((e) => e.planning && e.source === p.forms[0].id));
  st.deleteForm(p.forms[1].id);
  assert.equal(p.workspace!.flows.length,0);
  useStore.getState().undo();
  assert.equal(useStore.getState().project!.workspace!.flows.length,1);
});

test('drawn branching changes REDCap export, while planning lines never change branching', () => {
  const p=C.sampleProject(); useStore.getState().open(p,null,'design');
  const source=C.allFields(p).find((f) => f.type==='yesno')!;
  const target=C.newField({name:'followup',label:'Follow-up'}); p.forms[0].items.push(target);
  useStore.getState().link(source.id,'1',target.id);
  assert.equal(target.logic,`[${source.name}] = '1'`);
  assert.ok(C.exportDataDictionary(p).includes(target.logic));
  const before=C.exportDataDictionary(p);
  useStore.getState().addFlow(source.id,target.id);
  assert.equal(C.exportDataDictionary(p),before);
  const rid=C.allFields(p)[0]; useStore.getState().link(source.id,'1',rid.id);
  assert.equal(rid.logic,'');
});
