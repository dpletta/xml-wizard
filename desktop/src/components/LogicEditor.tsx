import { useState } from "react";
import { Plus, X } from "lucide-react";
import { C, type Field, type FieldIndex, type Project, type Rule, type RuleSpec } from "@/lib/core";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Input, NativeSelect, Textarea } from "./ui/fields";

const OPS_CODED = [["=", "is"], ["<>", "is not"], ["answered", "is answered"], ["empty", "is blank"]];
const OPS_CHECK = [["checked", "includes"], ["unchecked", "does not include"]];
const OPS_OPEN = [
  ["=", "is"], ["<>", "is not"], [">", "is more than"], [">=", "is at least"], ["<", "is less than"], ["<=", "is at most"],
  ["answered", "is answered"], ["empty", "is blank"],
];

function defaultRuleFor(t: Field): Rule {
  if (t.type === "checkbox") return { field: t.name, code: t.choices.length ? t.choices[0].code : "1", op: "checked", value: "" };
  if (C.CODED_TYPES[t.type] && t.choices.length) return { field: t.name, code: null, op: "=", value: t.choices[0].code };
  return { field: t.name, code: null, op: "answered", value: "" };
}

function defaultRule(project: Project, f: Field): Rule | null {
  const all = C.allFields(project);
  const before = all.slice(0, all.indexOf(f)).filter((o) => o.type !== "descriptive" && !o.rid).reverse();
  const pick = before.find((o) => C.CODED_TYPES[o.type]) ?? before[0] ?? all.find((o) => o !== f && o.type !== "descriptive" && !o.rid);
  return pick ? defaultRuleFor(pick) : null;
}

export function LogicEditor({ project, field }: { project: Project; field: Field }) {
  const mutate = useStore((s) => s.mutate);
  const say = useStore((s) => s.say);
  const [rawFor, setRawFor] = useState<string | null>(null);
  const has = !!field.logic.trim();
  const spec = has ? C.simpleRules(field.logic) : null;
  const raw = has && (rawFor === field.id || !spec);
  const index = C.fieldIndex(project);

  const write = (next: RuleSpec, key = "") => mutate(() => { field.logic = C.rulesToLogic(next); }, key);

  return (
    <div>
      <div className="grid grid-cols-2 rounded-lg bg-muted p-0.5 text-[13px] font-medium">
        {([["Always", false], ["Only if…", true]] as const).map(([text, on]) => (
          <button key={text} aria-pressed={has === on}
            className={cn("h-7 rounded-md transition-colors", has === on ? "bg-surface shadow-card" : "text-muted-foreground hover:text-foreground")}
            onClick={() => {
              if (has === on) return;
              if (!on) { setRawFor(null); mutate(() => { field.logic = ""; }); return; }
              const rule = defaultRule(project, field);
              if (!rule) return say("Add another question first, then make this one depend on it.");
              mutate(() => { field.logic = C.ruleToLogic(rule); });
            }}>
            {text}
          </button>
        ))}
      </div>
      {!has ? (
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          Tip: on the canvas, drag an answer from another question onto this one.
        </p>
      ) : raw ? (
        <div className="mt-2.5 space-y-2">
          {C.simpleRules(field.logic) ? (
            <p className="rounded-lg bg-primary-soft px-2.5 py-1.5 text-xs text-primary">Shows if {C.describeLogic(field.logic, index)}</p>
          ) : null}
          <Textarea rows={4} spellCheck={false} className="font-mono text-xs" value={field.logic} aria-label="REDCap branching logic"
            onChange={(e) => mutate(() => { field.logic = e.target.value; }, "logic:" + field.id)} />
          {spec ? (
            <button className="text-xs font-medium text-primary hover:underline" onClick={() => setRawFor(null)}>Back to the simple editor</button>
          ) : (
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              This rule is more detailed than the simple editor can show, so it is kept exactly as REDCap logic.
            </p>
          )}
        </div>
      ) : spec ? (
        <div className="mt-2.5 space-y-2">
          {spec.rules.length > 1 ? (
            <NativeSelect value={spec.join} aria-label="How conditions combine"
              onChange={(e) => write({ ...spec, join: e.target.value as "and" | "or" })}>
              <option value="and">Show when ALL of these are true</option>
              <option value="or">Show when ANY of these is true</option>
            </NativeSelect>
          ) : null}
          {spec.rules.map((r, k) => (
            <RuleRow key={k} project={project} self={field} rule={r} index={index}
              onChange={(next, key) => write({ ...spec, rules: spec.rules.map((x, i) => (i === k ? next : x)) }, key)}
              onRemove={() => write({ ...spec, rules: spec.rules.filter((_, i) => i !== k) })} />
          ))}
          <div className="flex items-center justify-between pt-0.5">
            <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={() => { const rule = defaultRule(project, field); if (rule) write({ ...spec, rules: [...spec.rules, rule] }); }}>
              <Plus className="size-3.5" /> Add a condition
            </button>
            <button className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setRawFor(field.id)}>
              Edit as REDCap logic
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RuleRow({ project, self, rule, index, onChange, onRemove }: {
  project: Project; self: Field; rule: Rule; index: FieldIndex; onChange: (r: Rule, key?: string) => void; onRemove: () => void;
}) {
  const t = index[rule.field]?.field ?? null;
  const checkbox = t?.type === "checkbox";
  const coded = !!t && !!C.CODED_TYPES[t.type] && !checkbox;
  const ops = checkbox ? OPS_CHECK : coded ? OPS_CODED : OPS_OPEN;
  const needsValue = rule.op !== "answered" && rule.op !== "empty";
  const current = checkbox ? rule.code ?? "" : rule.value;
  return (
    <div className="relative space-y-1.5 rounded-xl border border-border bg-muted/40 p-2 pr-8">
      <NativeSelect aria-label="Question" value={rule.field}
        onChange={(e) => { const next = index[e.target.value]; if (next) onChange(defaultRuleFor(next.field)); }}>
        {!t ? <option value={rule.field}>[{rule.field}] (missing)</option> : null}
        {project.forms.map((form) => {
          const opts = form.items.filter((o): o is Field => C.isField(o) && o !== self && o.type !== "descriptive");
          return opts.length ? (
            <optgroup key={form.id} label={form.label}>
              {opts.map((o) => <option key={o.id} value={o.name}>{C.shortLabel(o)}</option>)}
            </optgroup>
          ) : null;
        })}
      </NativeSelect>
      <div className="flex gap-1.5">
        <NativeSelect aria-label="Comparison" value={rule.op} className={needsValue ? "w-[46%]" : undefined}
          onChange={(e) => {
            const op = e.target.value;
            const wasValue = rule.op !== "answered" && rule.op !== "empty";
            const nowValue = op !== "answered" && op !== "empty";
            const value = nowValue && !wasValue ? (coded && t!.choices.length ? t!.choices[0].code : "1") : rule.value;
            onChange({ ...rule, op, value });
          }}>
          {ops.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </NativeSelect>
        {needsValue ? (
          checkbox || coded ? (
            <NativeSelect aria-label="Answer" value={current} className="min-w-0 flex-1"
              onChange={(e) => onChange(checkbox ? { ...rule, code: e.target.value } : { ...rule, value: e.target.value })}>
              {t!.choices.some((c) => c.code === current) ? null : <option value={current}>{current} (not an answer)</option>}
              {t!.choices.map((c) => <option key={c.code} value={c.code}>{C.stripHtml(c.label) || c.code}</option>)}
            </NativeSelect>
          ) : (
            <Input aria-label="Value" placeholder="value" value={rule.value} className="min-w-0 flex-1"
              onChange={(e) => onChange({ ...rule, value: e.target.value.trim() }, "rule-value:" + self.id)} />
          )
        ) : null}
      </div>
      <button aria-label="Remove this condition" title="Remove this condition" onClick={onRemove}
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
