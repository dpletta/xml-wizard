// Survey containment determines position; branching is drawn independently.
import { C, type Field, type FieldIndex, type Form, type Issue, type Item, type Project } from "./core";

export const COL_W = 440;
export const COL_GAP = 180;
export const HEAD_H = 76;
export const PAD = 14;
export const GAP = 12;
export const CARD_H = 72;
export const COND_H = 24;
export const RESPONSE_H = 30;
export const SECTION_H = 42;
export const FOOT_H = 52;
export const QUESTION_W = 340;

export interface Slot {
  item: Item;
  form: Form;
  index: number;
  sectionId: string;
  depth: number;
  parentId: string | null;
  /** Coordinates relative to the instrument, including for nested questions. */
  x: number;
  y: number;
  w: number;
  h: number;
  cond: string;
  condFull: string;
}

export interface SectionBox {
  id: string;
  label: string;
  implicit: boolean;
  form: Form;
  x: number;
  y: number;
  w: number;
  h: number;
  slots: Slot[];
}

export interface Column {
  form: Form;
  x: number;
  w: number;
  h: number;
  slots: Slot[];
  sections: SectionBox[];
}

export interface Branch {
  id: string;
  source: Slot;
  target: Slot;
  code: string | null;
  crossInstrument: boolean;
  lane: number;
  label: string;
}

export interface Layout {
  columns: Column[];
  slotById: Map<string, Slot>;
  sectionById: Map<string, SectionBox>;
  columnById: Map<string, Column>;
  index: FieldIndex;
  branches: Branch[];
}

export function hasChips(item: Item): item is Field {
  return C.isField(item) && !!C.CODED_TYPES[item.type] && item.choices.length > 0;
}

export function itemHeight(item: Item): number {
  if (!C.isField(item)) return SECTION_H;
  return CARD_H + (item.logic.trim() ? COND_H : 0)
    + (hasChips(item) ? 24 + item.choices.length * RESPONSE_H : 0);
}

/** Preserve the full expression; anchors only identify the inputs it references. */
export function branchSources(logic: string): { name: string; code: string | null }[] {
  type Ast = { k: string; name?: string; code?: string | null; op?: string; v?: string; a?: Ast; b?: Ast; args?: Ast[] };
  const refs: { name: string; code: string | null }[] = [];
  function visit(n: Ast) {
    if (n.k === "cmp" && (n.op === "=" || n.op === "<>")) {
      const ref = n.a?.k === "ref" ? n.a : n.b?.k === "ref" ? n.b : null;
      const value = ref === n.a ? n.b : n.a;
      if (ref && value && (value.k === "str" || value.k === "num")) {
        refs.push({ name: ref.name!, code: ref.code ?? (value.v === "" ? null : String(value.v)) });
        return;
      }
    }
    if (n.k === "ref") refs.push({ name: n.name!, code: n.code ?? null });
    if (n.a) visit(n.a);
    if (n.b) visit(n.b);
    n.args?.forEach(visit);
  }
  try { if (logic.trim()) visit(C.parseLogic(logic) as Ast); }
  catch { return C.logicRefs(logic); }
  return refs;
}

const OPS: Record<string, string> = { "=": "", "<>": "not ", ">": "> ", ">=": "≥ ", "<": "< ", "<=": "≤ " };

/** The short tag on a card: "if Yes" when it hangs under its parent, else the whole condition in words. */
export function condText(field: Field, index: FieldIndex, parent: Field | null): { short: string; full: string } {
  const full = C.describeLogic(field.logic, index);
  const spec = C.simpleRules(field.logic);
  if (spec && spec.rules.length === 1 && parent && spec.rules[0].field === parent.name) {
    const r = spec.rules[0];
    let short: string;
    if (r.op === "checked" || r.op === "unchecked") {
      short = (r.op === "checked" ? "" : "not ") + (C.choiceLabel(parent, r.code ?? "") ?? r.code);
    } else if (r.op === "empty") short = "blank";
    else if (r.op === "answered") short = "answered";
    else {
      const lab = C.CODED_TYPES[parent.type] ? C.choiceLabel(parent, r.value) : null;
      short = (OPS[r.op] ?? r.op + " ") + (lab ?? r.value);
    }
    return { short: "if " + short, full };
  }
  return { short: "if " + full, full };
}

export function computeLayout(project: Project, footer: boolean): Layout {
  const index = C.fieldIndex(project);
  const slotById = new Map<string, Slot>();
  const sectionById = new Map<string, SectionBox>();
  const columnById = new Map<string, Column>();
  const columns = project.forms.map((form) => {
    const { parents, depth } = C.parentsInForm(form);
    const sections: SectionBox[] = [];
    const slots: Slot[] = [];
    let y = HEAD_H;
    let section: SectionBox | undefined;
    const finish = () => {
      if (!section) return;
      section.h = Math.max(SECTION_H + 44, y - section.y + PAD - GAP);
      y = section.y + section.h + GAP;
    };
    const start = (id: string, label: string, implicit: boolean) => {
      section = { id, label, implicit, form, x: PAD, y, w: COL_W - 2 * PAD, h: 0, slots: [] };
      sections.push(section);
      sectionById.set(id, section);
      y += SECTION_H;
    };
    form.items.forEach((item, i) => {
      if (!C.isField(item)) {
        finish();
        start(item.id, item.label, false);
        const slot: Slot = { item, form, index: i, sectionId: item.id, depth: 0, parentId: null, x: PAD, y: section!.y,
          w: COL_W - 2 * PAD, h: SECTION_H, cond: "", condFull: "" };
        slots.push(slot);
        slotById.set(item.id, slot);
        return;
      }
      if (!section) start(`section:${form.id}`, "General", true);
      const cond = item.logic.trim() ? condText(item, index, (form.items.find((it) => it.id === parents[item.id]) as Field) ?? null) : { short: "", full: "" };
      const slot: Slot = { item, form, index: i, sectionId: section!.id, depth: depth[item.id] || 0, parentId: parents[item.id] ?? null,
        x: 2 * PAD + (depth[item.id] || 0) * 20, y, w: QUESTION_W - (depth[item.id] || 0) * 20, h: itemHeight(item), cond: cond.short, condFull: cond.full };
      section!.slots.push(slot);
      slots.push(slot);
      slotById.set(item.id, slot);
      y += slot.h + GAP;
    });
    if (!section) start(`section:${form.id}`, "General", true);
    finish();
    const col: Column = { form, x: 0, w: COL_W, h: y + (footer ? FOOT_H : PAD - GAP), slots, sections };
    columnById.set(form.id, col);
    return col;
  });
  const branches: Branch[] = [];
  for (const col of columns) {
    for (const target of col.slots) {
      if (!C.isField(target.item)) continue;
      const seen = new Set<string>();
      for (const ref of branchSources(target.item.logic)) {
        const field = index[ref.name]?.field;
        const source = field && slotById.get(field.id);
        if (!source || !field) continue;
        const code = hasChips(field) && field.choices.some((c) => c.code === ref.code) ? ref.code : null;
        const id = JSON.stringify([source.item.id, target.item.id, code]);
        if (seen.has(id)) continue;
        seen.add(id);
        branches.push({ id, source, target, code, crossInstrument: source.form.id !== target.form.id,
          lane: 0, label: target.condFull });
      }
    }
  }
  // Reserve a separate bracket lane for overlapping spans, inside the instrument.
  let x = 0;
  for (const col of columns) {
    const ends: number[] = [];
    const local = branches.filter((b) => !b.crossInstrument && b.source.form.id === col.form.id)
      .sort((a, b) => Math.min(a.source.y, a.target.y) - Math.min(b.source.y, b.target.y));
    for (const branch of local) {
      const start = Math.min(branch.source.y, branch.target.y);
      let lane = ends.findIndex((end) => end + GAP < start);
      if (lane < 0) lane = ends.length;
      ends[lane] = Math.max(branch.source.y + branch.source.h, branch.target.y + branch.target.h);
      branch.lane = lane;
    }
    col.w = Math.max(COL_W, 2 * PAD + QUESTION_W + 32 + ends.length * 12 + PAD);
    col.x = x;
    x += col.w + COL_GAP;
    for (const section of col.sections) section.w = col.w - 2 * PAD;
    for (const slot of col.slots) if (!C.isField(slot.item)) slot.w = col.w - 2 * PAD;
  }
  return { columns, slotById, sectionById, columnById, index, branches };
}

/** Where a card dropped at a canvas point would land. */
export function dropTarget(layout: Layout, cx: number, cy: number, movingId: string | null): { form: Form; index: number; lineY: number; x: number; w: number } | null {
  if (!layout.columns.length) return null;
  let col = layout.columns[0];
  let best = Infinity;
  for (const c of layout.columns) {
    const d = cx < c.x ? c.x - cx : cx > c.x + c.w ? cx - (c.x + c.w) : 0;
    if (d < best) { best = d; col = c; }
  }
  if (best > COL_GAP) return null;
  const movingSection = movingId ? layout.sectionById.get(movingId) : null;
  const others = col.slots.filter((s) => s.item.id !== movingId && (!movingSection || s.sectionId !== movingId));
  let index = 0;
  let lineY = HEAD_H - GAP / 2;
  for (const s of others) {
    if (cy > s.y + s.h / 2) { index++; lineY = s.y + s.h + GAP / 2; }
  }
  // The record ID always stays first.
  if (col === layout.columns[0] && index === 0 && others.length) { index = 1; lineY = others[0].y + others[0].h + GAP / 2; }
  return { form: col.form, index, lineY, x: col.x, w: col.w };
}

export function worstByItem(issues: Issue[]): Map<string, "error" | "warning"> {
  const out = new Map<string, "error" | "warning">();
  for (const i of issues) {
    if (!i.itemId || i.severity === "info") continue;
    if (i.severity === "error" || !out.has(i.itemId)) out.set(i.itemId, i.severity);
  }
  return out;
}

/** Questions whose logic mentions this one. */
export function dependentsOf(project: Project, field: Field): Field[] {
  return C.allFields(project).filter(
    (o) => o !== field && o.logic && C.logicRefs(o.logic).some((r) => r.name === field.name),
  );
}
