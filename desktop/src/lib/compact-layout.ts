import { C } from "./core";
import type { Layout } from "./layout";

export const COMPACT_W = 350;
export const COMPACT_GAP = 88;
export interface CompactRow {
  id: string;
  kind: "form" | "section" | "field";
  label: string;
  detail: string;
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  implicit?: boolean;
}

/** Layout is presentation only: never change the survey or its export order. */
export function compactLayout(layout: Layout, open: ReadonlySet<string>, columns: number) {
  const count = Math.max(1, Math.min(3, Math.floor(columns)));
  const bottoms = Array<number>(count).fill(0);
  const rows: CompactRow[] = [];
  const representative = new Map<string, string>();
  for (const [i, col] of layout.columns.entries()) {
    const lane = i % count;
    const x = lane * (COMPACT_W + COMPACT_GAP);
    let y = bottoms[lane];
    const fields = col.sections.flatMap((s) => s.slots);
    rows.push({ id: col.form.id, kind: "form", label: C.stripHtml(col.form.label) || col.form.name,
      detail: `${fields.length} questions · ${col.sections.length} sections · ${fields.filter((s) => C.isField(s.item) && s.item.logic.trim()).length} with logic`,
      x, y, w: COMPACT_W, h: 56, open: open.has(col.form.id) });
    y += 60;
    for (const section of col.sections) {
      representative.set(section.id, open.has(col.form.id) ? section.id : col.form.id);
      if (open.has(col.form.id)) {
        rows.push({ id: section.id, kind: "section", label: C.stripHtml(section.label) || "Untitled section",
          detail: `${section.slots.length} questions`, implicit: section.implicit,
          x: x + 10, y, w: COMPACT_W - 10, h: 38, open: open.has(section.id) });
        y += 42;
      }
      for (const slot of section.slots) {
        const visible = open.has(col.form.id) && open.has(section.id);
        representative.set(slot.item.id, visible ? slot.item.id : open.has(col.form.id) ? section.id : col.form.id);
        if (!visible) continue;
        const field = slot.item;
        const indent = Math.min(slot.depth, 4) * 12;
        rows.push({ id: field.id, kind: "field", label: C.stripHtml(field.label) || "Untitled question",
          detail: C.isField(field) ? `${field.name}${slot.cond ? ` · ${slot.cond}` : ""}` : "",
          x: x + 20 + indent, y, w: COMPACT_W - 20 - indent, h: 52, open: false });
        y += 56;
      }
    }
    bottoms[lane] = y + 12;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const edges = new Map<string, { id: string; source: string; target: string; count: number; label: string; lane: number }>();
  for (const branch of layout.branches) {
    const source = representative.get(branch.source.item.id)!;
    const target = representative.get(branch.target.item.id)!;
    // Hidden dependencies inside a group are summarized in its header.
    if (source === target && source !== branch.source.item.id) continue;
    const id = JSON.stringify([source, target]);
    const existing = edges.get(id);
    if (existing) { existing.count++; continue; }
    edges.set(id, { id, source, target, count: 1, label: branch.label, lane: 0 });
  }
  // Give overlapping brackets their own gutter lane; keep the grid compact.
  const lanes = new Map<number, number[]>();
  for (const edge of [...edges.values()].sort((a, b) =>
    Math.min(byId.get(a.source)!.y, byId.get(a.target)!.y) - Math.min(byId.get(b.source)!.y, byId.get(b.target)!.y))) {
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    if (Math.abs(source.x - target.x) > COMPACT_W) continue;
    const column = Math.floor(source.x / (COMPACT_W + COMPACT_GAP));
    const ends = lanes.get(column) ?? [];
    const start = Math.min(source.y, target.y);
    let lane = ends.findIndex((end) => end < start);
    if (lane < 0) lane = ends.length;
    ends[lane] = Math.max(source.y + source.h, target.y + target.h);
    lanes.set(column, ends);
    edge.lane = lane % 5;
  }
  return { rows, byId, edges: [...edges.values()], representative };
}

/** Opening a section folds its siblings, without affecting other instruments. */
export function toggleCompact(layout: Layout, current: readonly string[], id: string): string[] {
  const open = new Set(current);
  if (open.has(id)) { open.delete(id); return [...open]; }
  const section = layout.sectionById.get(id);
  if (section) for (const sibling of layout.columnById.get(section.form.id)!.sections) open.delete(sibling.id);
  open.add(id);
  return [...open];
}

/** Search/outline navigation unfolds the destination without editing metadata. */
export function revealCompact(layout: Layout, current: readonly string[], id: string): string[] {
  const slot = layout.slotById.get(id);
  if (!slot) return [...current];
  const open = new Set(current);
  open.add(slot.form.id);
  for (const sibling of layout.columnById.get(slot.form.id)!.sections) open.delete(sibling.id);
  open.add(slot.sectionId);
  return [...open];
}
