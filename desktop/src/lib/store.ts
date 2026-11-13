import { create } from "zustand";
import { C, type Field, type Form, type Item, type Project, type Rule } from "./core";

export type Mode = "map" | "design";
export type WorkspaceView = "overview" | "canvas";
export type CanvasTool = "select" | "instrument" | "section" | "connect";

export interface SourceFile {
  name: string;
  /** The file exactly as opened. Kept in memory only, for the data check. */
  text: string;
}

interface Snapshot {
  json: string;
}

interface State {
  project: Project | null;
  /** Bumped on every change; the project object itself is edited in place. */
  rev: number;
  mode: Mode;
  view: WorkspaceView;
  compactOpen: string[];
  canvasTool: CanvasTool;
  draftStatus: "idle" | "pending" | "saving" | "saved" | "error";
  setCanvasTool(tool: CanvasTool): void;
  positionForm(id: string, point: {x: number; y: number}): void;
  addFlow(source: string, target: string): void;
  selected: string | null;
  selectedForm: string | null;
  source: SourceFile | null;
  /** True once the project differs from the opened file. */
  dirty: boolean;
  fileSavedRev: number;
  notes: string[];
  past: Snapshot[];
  future: Snapshot[];
  lastKey: string;
  lastAt: number;
  focusTick: number;
  toast: { id: number; text: string; tone?: "error" } | null;

  open(project: Project, source: SourceFile | null, mode: Mode, notes?: string[]): void;
  close(): void;
  setMode(mode: Mode): void;
  setView(view: WorkspaceView): void;
  setCompactOpen(ids: string[]): void;
  select(id: string | null): void;
  selectForm(id: string | null): void;
  reveal(id: string): void;
  /** Change the project. Edits with the same key within a second share one undo step. */
  mutate(fn: (p: Project) => void, key?: string): void;
  undo(): void;
  redo(): void;
  say(text: string, tone?: "error"): void;

  addItem(kindKey: string, formId?: string, index?: number): void;
  addForm(point?: {x: number; y: number}): void;
  /** `index` excludes the moved question, or the section and all its questions. */
  moveItem(id: string, formId: string, index: number): void;
  moveForm(id: string, index: number): void;
  deleteItem(id: string): void;
  deleteForm(id: string): void;
  duplicateItem(id: string): void;
  link(sourceId: string, code: string | null, targetId: string): void;
}

function markRecordId(project: Project) {
  const fields = C.allFields(project);
  if (fields.length && !fields.some((f) => f.rid)) fields[0].rid = true;
}

/** REDCap needs the record ID to be the very first field. */
function normalize(p: Project) {
  if (p.workspace) {
    const ids = new Set(p.forms.flatMap((f) => [f.id, ...f.items.map((i) => i.id)]));
    p.workspace.flows = p.workspace.flows.filter((f) => ids.has(f.source) && ids.has(f.target));
    for (const id of Object.keys(p.workspace.positions)) if (!p.forms.some((f) => f.id === id)) delete p.workspace.positions[id];
  }
  if (!p.forms.length) p.forms.push(C.newForm(p, "Survey"));
  let rid = C.allFields(p).find((f) => f.rid);
  if (!rid) {
    rid = C.newField({ name: C.uniqueName(p, "record_id"), autoName: false, label: "Record ID" });
    rid.rid = true;
    p.forms[0].items.unshift(rid);
  } else if (p.forms[0].items[0] !== rid) {
    const loc = C.findItem(p, rid.id)!;
    loc.form.items.splice(loc.index, 1);
    p.forms[0].items.unshift(rid);
  }
}

const snap = (p: Project): Snapshot => ({ json: JSON.stringify(p) });
let toastId = 0;

export const useStore = create<State>((set, get) => ({
  project: null,
  rev: 0,
  mode: "map",
  view: "overview",
  canvasTool: "select",
  draftStatus: "idle",
  setCanvasTool(canvasTool) { set({ canvasTool }); },
  positionForm(id, point) {
    get().mutate((p) => {
      if (!p.forms.some((f) => f.id === id)) return;
      p.workspace ??= { positions: {}, flows: [] };
      p.workspace.positions[id] = { x: point.x, y: point.y };
    });
  },
  addFlow(source, target) {
    const p = get().project;
    const exists = (id: string) => p?.forms.some((f) => f.id === id || f.items.some((i) => i.id === id));
    if (!p || source === target || !exists(source) || !exists(target) || p.workspace?.flows.some((f) => f.source === source && f.target === target)) return;
    get().mutate((p) => {
      p.workspace ??= { positions: {}, flows: [] };
      p.workspace.flows.push({ id: C.uid(), source, target, label: "Flow" });
    });
    get().say("Flow added to the plan. REDCap branching is edited on the question.");
  },
  compactOpen: [],
  selected: null,
  selectedForm: null,
  source: null,
  dirty: false,
  fileSavedRev: -1,
  notes: [],
  past: [],
  future: [],
  lastKey: "",
  lastAt: 0,
  focusTick: 0,
  toast: null,

  open(project, source, mode, notes = []) {
    markRecordId(project);
    normalize(project);
    set({
      project, source, mode,
      view: mode === "design" ? "canvas" : "overview",
      canvasTool: "select", draftStatus: "pending",
      compactOpen: [], notes, rev: get().rev + 1, selected: null, selectedForm: null,
      dirty: false, fileSavedRev: -1, past: [], future: [], lastKey: "",
    });
  },
  close() {
    set({ project: null, source: null, selected: null, selectedForm: null, past: [], future: [], notes: [] });
  },
  setMode(mode) {
    get().setView(mode === "design" ? "canvas" : "overview");
  },
  setView(view) {
    set({ view, mode: view === "canvas" ? "design" : "map",
      focusTick: get().focusTick + (view !== get().view && get().selected ? 1 : 0) });
  },
  setCompactOpen(compactOpen) {
    set({ compactOpen });
  },
  select(id) {
    set({ selected: id, selectedForm: null });
  },
  selectForm(id) {
    set({ selectedForm: id, selected: null });
  },
  reveal(id) {
    set({ selected: id, selectedForm: null, focusTick: get().focusTick + 1 });
  },

  mutate(fn, key = "") {
    const s = get();
    if (!s.project) return;
    const now = Date.now();
    const merge = key !== "" && key === s.lastKey && now - s.lastAt < 1200;
    const before = merge ? null : snap(s.project);
    fn(s.project);
    normalize(s.project);
    const sel = s.selected && C.findItem(s.project, s.selected) ? s.selected : null;
    set({
      rev: s.rev + 1,
      dirty: true, draftStatus: "pending",
      selected: get().selected === s.selected ? sel : get().selected,
      past: before ? [...s.past.slice(-99), before] : s.past,
      future: [],
      lastKey: key,
      lastAt: now,
    });
  },
  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev || !s.project) return;
    const project = JSON.parse(prev.json) as Project;
    set({
      project, dirty: true, draftStatus: "pending", rev: s.rev + 1, past: s.past.slice(0, -1), future: [...s.future, snap(s.project)], lastKey: "",
      selected: s.selected && C.findItem(project, s.selected) ? s.selected : null,
      selectedForm: s.selectedForm && project.forms.some((f) => f.id === s.selectedForm) ? s.selectedForm : null,
    });
  },
  redo() {
    const s = get();
    const next = s.future[s.future.length - 1];
    if (!next || !s.project) return;
    const project = JSON.parse(next.json) as Project;
    set({
      project, dirty: true, draftStatus: "pending", rev: s.rev + 1, future: s.future.slice(0, -1), past: [...s.past, snap(s.project)], lastKey: "",
      selected: s.selected && C.findItem(project, s.selected) ? s.selected : null,
      selectedForm: s.selectedForm && project.forms.some((f) => f.id === s.selectedForm) ? s.selectedForm : null,
    });
  },
  say(text, tone) {
    set({ toast: { id: ++toastId, text, tone } });
  },

  addItem(kindKey, formId, index) {
    const s = get();
    const p = s.project;
    if (!p) return;
    const loc = s.selected ? C.findItem(p, s.selected) : null;
    const form: Form =
      p.forms.find((f) => f.id === formId) ?? loc?.form ?? p.forms.find((f) => f.id === s.selectedForm) ?? p.forms[0];
    let at = index ?? (loc && loc.form === form ? loc.index + 1 : form.items.length);
    if (form === p.forms[0]) at = Math.max(at, 1);
    let made: Item | null = null;
    s.mutate((proj) => {
      made = C.createFromKind(proj, kindKey);
      form.items.splice(Math.min(at, form.items.length), 0, made);
    });
    if (made) set({ selected: (made as Item).id, selectedForm: null, focusTick: get().focusTick + 1 });
  },
  addForm(point) {
    const s = get();
    let id = "";
    s.mutate((p) => {
      const form = C.newForm(p, "Instrument " + (p.forms.length + 1));
      p.forms.push(form);
      id = form.id;
      if (point) {
        p.workspace ??= { positions: {}, flows: [] };
        p.workspace.positions[id] = point;
      }
    });
    set({ selectedForm: id, selected: null, focusTick: get().focusTick + 1 });
  },
  moveItem(id, formId, index) {
    get().mutate((p) => {
      const loc = C.findItem(p, id);
      const target = p.forms.find((f) => f.id === formId);
      if (!loc || !target) return;
      let count = 1;
      if (!C.isField(loc.item)) {
        while (loc.index + count < loc.form.items.length && C.isField(loc.form.items[loc.index + count])) count++;
      }
      const moved = loc.form.items.splice(loc.index, count);
      target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, ...moved);
    });
    set({ selected: id, selectedForm: null });
  },
  moveForm(id, index) {
    get().mutate((p) => {
      const from = p.forms.findIndex((f) => f.id === id);
      if (from < 0) return;
      const [form] = p.forms.splice(from, 1);
      p.forms.splice(Math.max(0, Math.min(index, p.forms.length)), 0, form);
    });
  },
  deleteItem(id) {
    const s = get();
    const loc = s.project ? C.findItem(s.project, id) : null;
    if (!loc || (C.isField(loc.item) && loc.item.rid)) return;
    s.mutate(() => {
      loc.form.items.splice(loc.index, 1);
    });
    set({ selected: null });
    s.say("Deleted. Undo brings it back.");
  },
  deleteForm(id) {
    const s = get();
    if (!s.project || s.project.forms.length < 2) return;
    s.mutate((p) => {
      p.forms = p.forms.filter((f) => f.id !== id);
    });
    set({ selectedForm: null });
    s.say("Instrument deleted. Undo brings it back.");
  },
  duplicateItem(id) {
    const s = get();
    const loc = s.project ? C.findItem(s.project, id) : null;
    if (!loc || (C.isField(loc.item) && loc.item.rid)) return;
    const copy = JSON.parse(JSON.stringify(loc.item)) as Item;
    copy.id = C.uid();
    s.mutate((p) => {
      if (C.isField(copy)) {
        copy.name = C.uniqueName(p, copy.name);
        copy.autoName = false;
      }
      loc.form.items.splice(loc.index + 1, 0, copy);
    });
    set({ selected: copy.id });
  },
  link(sourceId, code, targetId) {
    const s = get();
    const p = s.project;
    if (!p) return;
    const src = C.findItem(p, sourceId);
    const tgt = C.findItem(p, targetId);
    if (!src || !tgt || src.item === tgt.item || !C.isField(src.item) || !C.isField(tgt.item) || tgt.item.rid) return;
    const from: Field = src.item;
    const to: Field = tgt.item;
    const rule: Rule =
      code == null
        ? { field: from.name, code: null, op: "answered", value: "" }
        : from.type === "checkbox"
          ? { field: from.name, code, op: "checked", value: "" }
          : { field: from.name, code: null, op: "=", value: code };
    s.mutate(() => {
      to.logic = C.addCondition(to.logic, rule);
    });
    set({ selected: to.id, selectedForm: null });
    s.say(`“${C.shortLabel(to)}” now shows only if ${C.describeLogic(C.ruleToLogic(rule), C.fieldIndex(p))}.`);
  },
}));

/** The project plus a value that changes whenever it does, for memo dependencies. */
export function useProject(): [Project, number] {
  const project = useStore((s) => s.project)!;
  const rev = useStore((s) => s.rev);
  return [project, rev];
}
