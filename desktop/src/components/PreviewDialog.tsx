import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { C, type Field, type Project } from "@/lib/core";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, Input, NativeSelect, Switch, Textarea } from "./ui/fields";
import { Dialog, DialogContent } from "./ui/overlays";

type Answers = Record<string, string | Record<string, boolean>>;

/** Apply branching until it settles: a hidden question loses its answer, which may hide others. */
function settle(project: Project, answers: Answers) {
  const all = C.allFields(project);
  const next: Answers = { ...answers };
  const shown: Record<string, boolean | null> = {};
  for (let guard = 0, again = true; again && guard < 25; guard++) {
    again = false;
    for (const f of all) {
      const s = C.isShown(f, next);
      shown[f.id] = s;
      if (s === false && next[f.name] != null) { delete next[f.name]; again = true; }
    }
  }
  return { answers: next, shown };
}

function Control({ field, value, set }: { field: Field; value: Answers[string] | undefined; set: (v: Answers[string] | "") => void }) {
  const f = field;
  if (C.CODED_TYPES[f.type] && f.type !== "dropdown") {
    const box = f.type === "checkbox";
    const picked = (box && value && typeof value === "object" ? value : {}) as Record<string, boolean>;
    return (
      <div className="space-y-1">
        {f.choices.map((c) => {
          const on = box ? !!picked[c.code] : value === c.code;
          return (
            <label key={c.code} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors",
              on ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong")}>
              <input type={box ? "checkbox" : "radio"} name={"pv_" + f.name} checked={on} className="accent-[var(--primary)]"
                onChange={(e) => {
                  if (!box) return set(c.code);
                  const next = { ...picked };
                  if (e.target.checked) next[c.code] = true; else delete next[c.code];
                  set(Object.keys(next).length ? next : "");
                }} />
              {C.stripHtml(c.label) || c.code}
            </label>
          );
        })}
        {!box && value ? <button className="text-xs text-muted-foreground hover:underline" onClick={() => set("")}>clear</button> : null}
      </div>
    );
  }
  const text = typeof value === "string" ? value : "";
  if (f.type === "dropdown") {
    return (
      <NativeSelect value={text} onChange={(e) => set(e.target.value)} className="max-w-sm">
        <option value="" />
        {f.choices.map((c) => <option key={c.code} value={c.code}>{C.stripHtml(c.label) || c.code}</option>)}
      </NativeSelect>
    );
  }
  if (f.type === "notes") return <Textarea rows={3} value={text} onChange={(e) => set(e.target.value)} />;
  if (f.type === "slider") {
    return <input type="range" min={0} max={100} value={text || "50"} onChange={(e) => set(e.target.value)} className="w-full max-w-sm accent-[var(--primary)]" />;
  }
  if (f.type === "calc") return <Input disabled placeholder="REDCap works this out" className="max-w-sm" />;
  if (f.type === "file") return <Input disabled placeholder="File upload" className="max-w-sm" />;
  const v = f.validation || "";
  const type = /^(integer|number)/.test(v) ? "number" : /^date_/.test(v) ? "date" : v === "email" ? "email" : "text";
  return <Input type={type} value={text} onChange={(e) => set(e.target.value)} className="max-w-sm" />;
}

export function PreviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const project = useStore((s) => s.project);
  const rev = useStore((s) => s.rev);
  const selected = useStore((s) => s.selected);
  const [raw, setRaw] = useState<Answers>({});
  const [formIdx, setFormIdx] = useState<number | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { answers, shown } = useMemo(() => (project ? settle(project, raw) : { answers: {}, shown: {} }), [project, rev, raw]);
  if (!project) return null;
  const startAt = selected ? Math.max(0, project.forms.findIndex((f) => f.items.some((i) => i.id === selected))) : 0;
  const current = Math.min(formIdx ?? startAt, project.forms.length - 1);
  const form = project.forms[current];
  const rows = form.items.filter((it) => !(C.isField(it) && it.rid));
  const fields = rows.filter(C.isField);
  const visible = fields.filter((f) => shown[f.id] !== false).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setFormIdx(null); } }}>
      <DialogContent wide title="Preview" description="Answer as a respondent would. Questions appear and disappear according to the branching logic.">
        <div className="flex flex-wrap items-center gap-3 border-y border-border bg-muted/40 px-6 py-2.5">
          <NativeSelect aria-label="Instrument" value={String(current)} onChange={(e) => setFormIdx(Number(e.target.value))} className="w-56">
            {project.forms.map((f, k) => <option key={f.id} value={k}>{f.label}</option>)}
          </NativeSelect>
          <span className="text-xs tabular-nums text-muted-foreground">{visible} of {fields.length} showing</span>
          <span className="flex-1" />
          <Switch checked={showSkipped} onCheckedChange={setShowSkipped} label="Show skipped" />
          <Button size="sm" onClick={() => setRaw({})}><RotateCcw /> Start over</Button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">This instrument has no questions for respondents yet.</p> : null}
          {rows.map((it) => {
            if (!C.isField(it)) {
              return <h3 key={it.id} className="border-b border-border pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{C.stripHtml(it.label)}</h3>;
            }
            const s = shown[it.id];
            if (s === false && !showSkipped) return null;
            const gated = !!it.logic.trim();
            return (
              <div key={it.id} className={cn("rounded-xl transition-opacity", s === false && "pointer-events-none opacity-40")}>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <span className={cn("text-sm", it.type === "descriptive" ? "text-muted-foreground" : "font-medium")}>
                    {C.stripHtml(it.label) || it.name}{it.required ? <span className="text-primary"> *</span> : null}
                  </span>
                  {s === false ? <Badge>skipped</Badge>
                    : s === null ? <Badge tone="warn" title={"This logic uses REDCap features the preview cannot run: " + it.logic}>always shown here</Badge>
                    : gated ? <Badge tone="primary" title={it.logic}>shown by branching</Badge> : null}
                </div>
                {it.type !== "descriptive" ? (
                  <Control field={it} value={answers[it.name]}
                    set={(v) => setRaw(() => {
                      const next = { ...answers };
                      if (v === "" || v == null) delete next[it.name]; else next[it.name] = v;
                      return next;
                    })} />
                ) : null}
                {it.note ? <p className="mt-1 text-xs text-muted-foreground">{C.stripHtml(it.note)}</p> : null}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
