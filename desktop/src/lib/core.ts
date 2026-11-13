// Typed door to the survey engine shared with the single-file designer:
// src/xml_wizard/designer_app/core.js (model, REDCap import and export, logic).
// That file is plain JavaScript in the UMD style: a bundler hands back its
// exports, and loaded as a plain script it registers the global XMLWCore.
import * as loaded from "@core";

export interface Choice {
  code: string;
  label: string;
}

export interface Field {
  id: string;
  kind: "field";
  name: string;
  autoName: boolean;
  type: string;
  label: string;
  choices: Choice[];
  choicesRaw?: string;
  note: string;
  validation: string;
  min: string;
  max: string;
  required: boolean;
  identifier: boolean;
  logic: string;
  calc: string;
  annotation: string;
  extra: [string, string][];
  /** The record ID field, which REDCap needs first. */
  rid?: boolean;
}

export interface Section {
  id: string;
  kind: "section";
  label: string;
}

export type Item = Field | Section;

export interface Form {
  id: string;
  name: string;
  autoName: boolean;
  label: string;
  items: Item[];
}

export interface CanvasWorkspace {
  positions: Record<string, { x: number; y: number }>;
  flows: { id: string; source: string; target: string; label: string }[];
}

export interface Project {
  workspace?: CanvasWorkspace;
  title: string;
  forms: Form[];
  keep: unknown;
  source: unknown;
}

export interface Kind {
  key: string;
  label: string;
  glyph: string;
  type?: string;
  validation?: string;
  hint?: string;
  layout?: boolean;
}

export interface Rule {
  field: string;
  code: string | null;
  op: string;
  value: string;
}

export interface RuleSpec {
  join: "and" | "or";
  rules: Rule[];
}

export interface Issue {
  severity: "error" | "warning" | "info";
  itemId: string | null;
  formId: string | null;
  message: string;
}

export interface IndexEntry {
  field: Field;
  form: Form;
  order: number;
}

export type FieldIndex = Record<string, IndexEntry>;

export interface LogicRef {
  name: string;
  code: string | null;
  event: string | null;
}

interface Core {
  KINDS: Kind[];
  KIND_BY_KEY: Record<string, Kind>;
  VALIDATIONS: [string, string][];
  CHOICE_TYPES: Record<string, number>;
  CODED_TYPES: Record<string, number>;
  uid(): string;
  stripHtml(s: string): string;
  slugify(label: string, fallback?: string): string;
  formSlug(label: string): string;
  isField(item: Item): item is Field;
  allFields(project: Project): Field[];
  fieldIndex(project: Project): FieldIndex;
  findItem(project: Project, id: string): { item: Item; form: Form; index: number } | null;
  uniqueName(project: Project, base: string, exceptId?: string): string;
  uniqueFormName(project: Project, base: string, exceptId?: string): string;
  newField(props: Partial<Field>): Field;
  newSection(label?: string): Section;
  newForm(project: Project, label?: string): Form;
  newProject(title?: string): Project;
  createFromKind(project: Project, key: string): Item;
  kindOf(item: Item): Kind;
  nextCode(choices: Choice[]): string;
  parseLogic(src: string): unknown;
  logicRefs(src: string): LogicRef[];
  simpleRules(src: string): RuleSpec | null;
  rulesToLogic(spec: RuleSpec): string;
  ruleToLogic(rule: Rule): string;
  addCondition(logic: string, rule: Rule): string;
  describeLogic(src: string, index: FieldIndex): string;
  shortLabel(field: Field): string;
  choiceLabel(field: Field, code: string): string | null;
  isShown(field: Field, answers: Record<string, unknown>): boolean | null;
  renameVariable(project: Project, oldName: string, newName: string): void;
  parentsInForm(form: Form): { parents: Record<string, string>; depth: Record<string, number> };
  validate(project: Project): Issue[];
  importAny(text: string, fileName: string): { project: Project; notes: string[] };
  exportOdm(project: Project, opts?: { now?: Date }): { xml: string; notes: string[] };
  exportDataDictionary(project: Project): string;
  sampleProject(): Project;
}

const mod = loaded as unknown as { default?: Partial<Core> } & Partial<Core>;
const found = [mod.default, mod, (globalThis as unknown as { XMLWCore?: Core }).XMLWCore].find((c) => c && typeof c.importAny === "function");
export const C = found as Core;
if (!C) throw new Error("The survey engine (core.js) did not load.");
