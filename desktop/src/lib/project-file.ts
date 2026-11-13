import { type Project, type CanvasWorkspace, type Item, type Field } from './core';
function fail(): never { throw new Error('This is not a supported XML Wizard project file.'); }
const string = (v: unknown): string => typeof v === 'string' ? v : fail();
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : fail();
const bool = (v: unknown) => typeof v === 'boolean' ? v : fail();
const pair = (v: unknown): [string, string] => { const a = array(v); if (a.length !== 2) fail(); return [string(a[0]), string(a[1])]; };
interface XmlNode { name: string; attrs: [string, string][]; children: (string | XmlNode)[] }
function xmlNode(value: unknown, depth = 0): XmlNode {
  if (depth > 40) fail();
  const node = object(value), name = string(node.name);
  if (!/^[A-Za-z_][\w.:-]*$/.test(name) || /^(ClinicalData|SubjectData|ItemData|AuditRecords|Signatures)$/i.test(name.split(':').pop()!)) fail();
  const attrs = array(node.attrs).map(pair);
  if (attrs.some(([key]) => !/^[A-Za-z_][\w.:-]*$/.test(key))) fail();
  return { name, attrs, children: array(node.children).map((c) => typeof c === 'string' ? c : xmlNode(c, depth + 1)) };
}
/** Allowlisted metadata schema. Keep incomplete designs, empty sections and invalid
 * draft logic intact; a REDCap export is not a lossless editable project format. */
function cleanProject(value: unknown): Project {
  const raw = object(value), ids = new Set<string>();
  const id = (v: unknown) => { const s = string(v); if (!s || ids.has(s) || ['__proto__', 'constructor', 'prototype'].includes(s)) fail(); ids.add(s); return s; };
  const forms = array(raw.forms).map((value) => {
    const f = object(value);
    return { id: id(f.id), name: string(f.name), label: string(f.label), autoName: bool(f.autoName), items: array(f.items).map((value): Item => {
      const i = object(value), identity = { id: id(i.id), label: string(i.label) };
      if (i.kind === 'section') return { ...identity, kind: 'section' };
      if (i.kind !== 'field') return fail();
      const field: Field = { ...identity, kind: 'field', name: string(i.name), type: string(i.type), autoName: bool(i.autoName),
        choices: array(i.choices).map((v) => { const c = object(v); return {code: string(c.code), label: string(c.label)}; }),
        note: string(i.note), validation: string(i.validation), min: string(i.min), max: string(i.max),
        required: bool(i.required), identifier: bool(i.identifier), logic: string(i.logic), calc: string(i.calc),
        annotation: string(i.annotation), extra: array(i.extra).map(pair),
      };
      if (i.rid !== undefined) field.rid = bool(i.rid);
      if (i.choicesRaw !== undefined) field.choicesRaw = string(i.choicesRaw);
      return field;
    }) };
  });
  let keep: unknown = null;
  if (raw.keep != null) {
    const k = object(raw.keep);
    keep = { version: string(k.version), globals: array(k.globals).map((v) => xmlNode(v)),
      protocol: k.protocol == null ? null : xmlNode(k.protocol), events: array(k.events).map((v) => xmlNode(v)) };
  }
  const p: Project = { title: string(raw.title), forms, keep, source: null };
  if (raw.workspace == null) return p;
  const w = object(raw.workspace), workspace: CanvasWorkspace = { positions: {}, flows: [] };
  for (const [key, value] of Object.entries(object(w.positions))) {
    if (!forms.some((f) => f.id === key)) fail();
    const point = object(value);
    if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) fail();
    workspace.positions[key] = { x: point.x, y: point.y };
  }
  workspace.flows = array(w.flows).map((value) => {
    const f = object(value), source = string(f.source), target = string(f.target);
    if (!ids.has(source) || !ids.has(target) || source === target) fail();
    return { id: id(f.id), source, target, label: string(f.label) };
  });
  p.workspace = workspace;
  return p;
}
export function encodeProject(p: Project): string {
  return JSON.stringify({format: 'xml-wizard', version: 1, project: cleanProject(p)}, null, 2);
}
export function decodeProject(text: string): Project {
  const data = object(JSON.parse(text));
  if (data.format !== 'xml-wizard' || data.version !== 1) fail();
  return cleanProject(data.project);
}
