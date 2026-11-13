// Where everything sits on the canvas. Instruments are columns; questions are
// cards stacked in survey order, indented under the question that controls them.
import { C, type Field, type FieldIndex, type Form, type Issue, type Item, type Project } from "./core";

export const COL_W = 372;
export const COL_GAP = 84;
export const HEAD_H = 68;
export const PAD = 14;
export const INDENT = 24;
export const GAP = 10;
export const CARD_H = 60;
export const COND_H = 24;
export const CHIPS_H = 30;
export const SECTION_H = 36;
export const FOOT_H = 52;
export const MAX_CHIPS = 6;

export interface Slot {
  item: Item;
  form: Form;
  index: number;
  depth: number;
  parentId: string | null;
  /** Relative to the instrument column. */
  x: number;
  y: number;
  w: number;
  h: number;
  cond: string;
  condFull: string;
}

export interface Column {
  form: Form;
  x: number;
  h: number;
  slots: Slot[];
}

export interface Layout {
  columns: Column[];
  slotById: Map<string, Slot>;
  columnById: Map<string, Column>;
  index: FieldIndex;
}

export function hasChips(item: Item): item is Field {
  return C.isField(item) && !!C.CODED_TYPES[item.type] && item.choices.length > 0;
}

export function itemHeight(item: Item): number {
  if (!C.isField(item)) return SECTION_H;
  let h = CARD_H;
  if (item.logic && item.logic.trim()) h += COND_H;
  if (hasChips(item)) h += CHIPS_H;
  return h;
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
  const columnById = new Map<string, Column>();
  const columns = project.forms.map((form, k) => {
    const { parents, depth } = C.parentsInForm(form);
    const byId = new Map(form.items.map((it) => [it.id, it]));
    let y = HEAD_H;
    const slots = form.items.map((item, i) => {
      const d = depth[item.id] || 0;
      const parentId = parents[item.id] ?? null;
      const parent = parentId ? (byId.get(parentId) as Field) : null;
      const h = itemHeight(item);
      const cond = C.isField(item) && item.logic.trim() ? condText(item, index, parent) : { short: "", full: "" };
      const slot: Slot = {
        item, form, index: i, depth: d, parentId, x: PAD + d * INDENT, y, w: COL_W - 2 * PAD - d * INDENT, h,
        cond: cond.short, condFull: cond.full,
      };
      y += h + GAP;
      slotById.set(item.id, slot);
      return slot;
    });
    const col: Column = { form, x: k * (COL_W + COL_GAP), h: y + (footer ? FOOT_H : PAD - GAP), slots };
    columnById.set(form.id, col);
    return col;
  });
  return { columns, slotById, columnById, index };
}

/** Where a card dropped at a canvas point would land. */
export function dropTarget(layout: Layout, cx: number, cy: number, movingId: string | null): { form: Form; index: number; lineY: number; x: number } | null {
  if (!layout.columns.length) return null;
  let col = layout.columns[0];
  let best = Infinity;
  for (const c of layout.columns) {
    const d = cx < c.x ? c.x - cx : cx > c.x + COL_W ? cx - (c.x + COL_W) : 0;
    if (d < best) { best = d; col = c; }
  }
  if (best > COL_GAP) return null;
  const others = col.slots.filter((s) => s.item.id !== movingId);
  let index = 0;
  let lineY = HEAD_H - GAP / 2;
  for (const s of others) {
    if (cy > s.y + s.h / 2) { index++; lineY = s.y + s.h + GAP / 2; }
  }
  // The record ID always stays first.
  if (col === layout.columns[0] && index === 0 && others.length) { index = 1; lineY = others[0].y + others[0].h + GAP / 2; }
  return { form: col.form, index, lineY, x: col.x };
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
