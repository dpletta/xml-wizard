import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/lib/core.ts';
import { computeLayout } from '../src/lib/layout.ts';
import { compactLayout, revealCompact, toggleCompact } from '../src/lib/compact-layout.ts';
import { useStore } from '../src/lib/store.ts';

function fixture() {
  const p = C.newProject('Example survey');
  p.forms = [];
  for (let i = 0; i < 6; i++) {
    const form = C.newForm(p, `Example instrument ${i + 1}`);
    form.items = [C.newSection('First section'), C.newField({ name: `q${i}`, label: 'Example question' }),
      C.newSection('Second section'), C.newField({ name: `follow${i}`, label: 'Example follow up', logic: `[q${i}] = '1'` })];
    p.forms.push(form);
  }
  p.forms[1].items.push(C.newField({ name: 'cross', logic: "[q0] = '1' and [follow0] <> ''" }));
  return p;
}

test('closed instruments pack independently; expanding a column leaves neighboring columns unchanged', () => {
  const p = fixture();
  const before = JSON.stringify(p);
  const l = computeLayout(p, false);
  const closed = compactLayout(l, new Set(), 3);
  assert.equal(closed.rows.length, 6);
  assert.equal(closed.rows[3].y, 72);
  const expanded = compactLayout(l, new Set([p.forms[0].id, l.columns[0].sections[0].id]), 3);
  assert.ok(expanded.byId.get(p.forms[3].id)!.y > closed.byId.get(p.forms[3].id)!.y);
  assert.equal(expanded.byId.get(p.forms[4].id)!.y, closed.byId.get(p.forms[4].id)!.y);
  assert.equal(JSON.stringify(p), before);
  for (const columns of [1, 2, 3]) {
    const all = compactLayout(l, new Set(l.columns.flatMap((c) => [c.form.id, ...c.sections.map((s) => s.id)])), columns);
    assert.equal(all.rows.filter((r) => r.kind === 'field').length, C.allFields(p).length);
    for (const col of l.columns) {
      const sectionRows = col.sections.map((s) => all.byId.get(s.id)!);
      assert.ok(sectionRows.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y)));
    }
  }
});

test('sections accordion within their instrument; reveal opens hidden questions', () => {
  const l = computeLayout(fixture(), false);
  const [a, b] = l.columns[0].sections;
  const other = l.columns[1].sections[0];
  const open = [l.columns[0].form.id, a.id, other.id];
  const next = toggleCompact(l, open, b.id);
  assert.ok(!next.includes(a.id));
  assert.ok(next.includes(b.id) && next.includes(other.id));
  const collapsed = toggleCompact(l, next, b.id);
  assert.ok(!collapsed.includes(b.id));
  const revealed = revealCompact(l, collapsed, a.slots[0].item.id);
  const visible = compactLayout(l, new Set(revealed), 3);
  assert.ok(visible.byId.has(a.slots[0].item.id));
  assert.ok(revealed.includes(other.id));
});

test('arrows aggregate on closed groups and recover every dependency when expanded', () => {
  const l = computeLayout(fixture(), false);
  const closed = compactLayout(l, new Set(), 3);
  assert.equal(closed.edges.length, 1);
  assert.equal(closed.edges[0].count, 2);
  assert.equal(closed.edges[0].source, l.columns[0].form.id);
  assert.equal(closed.edges[0].target, l.columns[1].form.id);
  const sections = compactLayout(l, new Set(l.columns.map((c) => c.form.id)), 3);
  assert.ok(sections.edges.some((e) => e.source === l.columns[0].sections[0].id && e.target === l.columns[0].sections[1].id));
  const all = compactLayout(l, new Set(l.columns.flatMap((c) => [c.form.id, ...c.sections.map((s) => s.id)])), 3);
  assert.equal(all.edges.reduce((n, e) => n + e.count, 0), l.branches.length);
  for (const e of [...closed.edges, ...sections.edges, ...all.edges]) {
    assert.ok(e.source && e.target);
  }
});

test('switching Compact, Map and Design retains edits, selection, source, expansion and undo', () => {
  const source = { name: 'example.xml', text: '<example />' };
  useStore.getState().open(fixture(), source, 'design');
  const st = useStore.getState();
  const id = C.allFields(st.project!)[1].id;
  st.select(id);
  st.mutate((p) => { p.title = 'Changed title'; });
  st.setCompactOpen([st.project!.forms[0].id]);
  const before = useStore.getState();
  const metadata = JSON.stringify(before.project);
  for (const view of ['compact', 'map', 'design', 'compact'] as const) {
    useStore.getState().setView(view);
    const after = useStore.getState();
    assert.equal(after.view, view);
    assert.equal(after.mode, view === 'design' ? 'design' : 'map');
    assert.equal(after.selected, id);
    assert.equal(after.source, source);
    assert.equal(after.rev, before.rev);
    assert.equal(after.dirty, true);
    assert.equal(after.past, before.past);
    assert.equal(after.compactOpen, before.compactOpen);
    assert.equal(JSON.stringify(after.project), metadata);
  }
  useStore.getState().undo();
  assert.equal(useStore.getState().project!.title, 'Example survey');
  useStore.getState().redo();
  assert.equal(useStore.getState().project!.title, 'Changed title');
  useStore.getState().setView('map');
  useStore.getState().open(fixture(), null, 'map');
  assert.deepEqual(useStore.getState().compactOpen, []);
  assert.equal(useStore.getState().view, 'map');
});


test('large projects start compact; opening a new file respects the compact preference', () => {
  const p = fixture();
  for (let i = 0; i < 1000; i++) p.forms[0].items.push(C.newField({ name: `example_${i}` }));
  useStore.getState().setView('map');
  useStore.getState().open(p, null, 'map');
  assert.equal(useStore.getState().view, 'compact');
  useStore.getState().open(fixture(), null, 'map');
  assert.equal(useStore.getState().view, 'compact');
  useStore.getState().open(p, null, 'design');
  assert.equal(useStore.getState().view, 'design');
});
