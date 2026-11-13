import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/lib/core.ts';
import { computeLayout, dropTarget, itemHeight, RESPONSE_H } from '../src/lib/layout.ts';
import { useStore } from '../src/lib/store.ts';

function fixture() {
  const p = C.sampleProject();
  const first = p.forms[0];
  const second = p.forms[1];
  first.items.push(C.newField({ name: 'cross', label: 'Across instruments', logic: "[housing_now] = '2'" }));
  second.items.push(C.newField({ name: 'mixed', label: 'Combined condition', logic: "([gender] = '4' or [housing_now] = '2') and [homeless_life] = '1'" }));
  return p;
}

test('sections contain ordered questions; branching indentation and response rows remain visible', () => {
  const p = fixture();
  const before = JSON.stringify(p);
  const layout = computeLayout(p, true);
  assert.equal(JSON.stringify(p), before, 'layout must not change exported metadata');
  assert.equal(layout.columns[0].sections[0].implicit, true);
  for (const col of layout.columns) for (const section of col.sections) {
    assert.ok(section.x + section.w < col.w);
    for (const slot of section.slots) {
      assert.equal(slot.sectionId, section.id);
      assert.ok(slot.y >= section.y + 42);
      assert.ok(slot.y + slot.h < section.y + section.h);
      assert.ok(slot.x >= section.x && slot.x + slot.w < section.x + section.w);
    }
  }
  const byName = (name: string) => layout.slotById.get(layout.index[name].field.id)!;
  assert.ok(byName('homeless_nights').x > byName('homeless_6mo').x);
  assert.ok(byName('homeless_6mo').x > byName('homeless_life').x);
  assert.equal(byName('homeless_nights').parentId, byName('homeless_6mo').item.id);
  const gender = layout.index.gender.field;
  assert.equal(itemHeight({ ...gender, choices: [...gender.choices, { code: '100', label: 'Another' }] }) - itemHeight(gender), RESPONSE_H);
});

test('every dependency is visible, with response anchors for mixed logic and both instrument directions', () => {
  const l = computeLayout(fixture(), false);
  const branchesTo = (name: string) => l.branches.filter((b) => b.target.item.id === l.index[name].field.id);
  assert.equal(branchesTo('mixed').length, 3);
  assert.equal(branchesTo('mixed').filter((b) => b.crossInstrument).length, 1);
  assert.equal(branchesTo('cross')[0].code, '2');
  assert.ok(branchesTo('cross')[0].crossInstrument);
  assert.equal(branchesTo('shelter_other')[0].code, '98');
  assert.equal(branchesTo('gender_self')[0].code, '4');
  assert.ok(l.branches.some((b) => !b.crossInstrument && b.source.sectionId !== b.target.sectionId));
  const overlapping = branchesTo('homeless_nights')[0];
  assert.notEqual(overlapping.lane, branchesTo('shelter_type')[0].lane);
});

test('complex, invalid, backward, self, and non-choice references retain honest question anchors', () => {
  const p = fixture();
  p.forms[0].items.push(C.newField({ name: 'other', logic: "[age] > 18 and [missing] = '1'" }));
  const gender = C.allFields(p).find((f) => f.name === 'gender')!;
  gender.logic = "[gender] = '99' or [gender] = '99' or [gender_self] <> ''";
  const l = computeLayout(p, false);
  const other = l.branches.filter((b) => C.isField(b.target.item) && b.target.item.name === 'other');
  assert.equal(other.length, 1);
  assert.equal(other[0].code, null);
  assert.equal(l.branches.filter((b) => b.target.item.id === gender.id).length, 2);
});

test('empty and consecutive sections have usable containers; section moves include their questions and undo', () => {
  const p = fixture();
  const empty = C.newSection('Empty');
  p.forms[1].items.push(empty, C.newSection('Also empty'));
  const l = computeLayout(p, true);
  assert.ok(l.sectionById.get(empty.id)!.h >= 86);
  const section = l.columns[1].sections[0];
  const movedIds = [section.id, ...section.slots.map((s) => s.item.id)];
  const target = dropTarget(l, 50, l.columns[0].h + 20, section.id)!;
  assert.equal(target.form.id, p.forms[0].id);
  useStore.getState().open(p, null, 'design');
  useStore.getState().moveItem(section.id, target.form.id, target.index);
  assert.deepEqual(p.forms[0].items.slice(-movedIds.length).map((it) => it.id), movedIds);
  useStore.getState().undo();
  assert.equal(useStore.getState().project!.forms[1].items[0].id, section.id);
});
