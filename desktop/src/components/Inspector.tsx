import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, CircleAlert, Copy, CornerDownRight, Fingerprint, GitBranch, Info, PencilRuler, Trash2, TriangleAlert, X,
} from "lucide-react";
import { C, type Field, type Form, type Issue, type Project, type Section } from "@/lib/core";
import { dependentsOf } from "@/lib/layout";
import { lookFor, lookOf } from "@/lib/kinds";
import { useProject, useStore } from "@/lib/store";
import { cn, plural } from "@/lib/utils";
import { ChoiceEditor } from "./ChoiceEditor";
import { LogicEditor } from "./LogicEditor";
import { Button } from "./ui/button";
import { Badge, Field as Labelled, Input, NativeSelect, Switch, Textarea } from "./ui/fields";

function Head({ icon, tile, title, onClose }: { icon: ReactNode; tile?: string; title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", tile ?? "bg-muted text-muted-foreground")}>{icon}</span>
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</h2>
      {onClose ? (
        <button aria-label="Close details" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function IssueNote({ issue, onClick, who }: { issue: Issue; onClick?: () => void; who?: string }) {
  const tone = issue.severity === "error" ? "bg-danger-soft text-danger" : issue.severity === "warning" ? "bg-warn-soft text-warn" : "bg-info-soft text-info";
  const Icon = issue.severity === "error" ? CircleAlert : issue.severity === "warning" ? TriangleAlert : Info;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs leading-snug", tone, onClick && "hover:brightness-95")}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="text-foreground/90">{who ? <b className="font-semibold">{who}: </b> : null}{issue.message}</span>
    </Tag>
  );
}

function Jump({ field, label }: { field: Field; label?: string }) {
  const reveal = useStore((s) => s.reveal);
  const Icon = lookOf(field).icon;
  return (
    <button onClick={() => reveal(field.id)} title={field.logic || undefined}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs shadow-card hover:border-primary hover:text-primary">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label ?? C.shortLabel(field)}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{field.name}</span>
    </button>
  );
}

function Relations({ project, field }: { project: Project; field: Field }) {
  const index = C.fieldIndex(project);
  const seen = new Set<string>();
  const needs = C.logicRefs(field.logic || "").map((r) => index[r.name]?.field).filter((f): f is Field => {
    if (!f || f === field || seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  const controls = dependentsOf(project, field);
  if (!needs.length && !controls.length) return null;
  return (
    <>
      {needs.length ? (
        <Group title="Depends on">
          <div className="space-y-1.5">{needs.map((f) => <Jump key={f.id} field={f} />)}</div>
        </Group>
      ) : null}
      {controls.length ? (
        <Group title={`Controls ${plural(controls.length, "question")}`}>
          <div className="space-y-1.5">{controls.map((f) => <Jump key={f.id} field={f} />)}</div>
        </Group>
      ) : null}
    </>
  );
}

function validationLabel(v: string) {
  return C.VALIDATIONS.find((p) => p[0] === v)?.[1] ?? v;
}

/** Map mode: everything about a question, read only. */
function FieldDetails({ project, field, issues }: { project: Project; field: Field; issues: Issue[] }) {
  const index = C.fieldIndex(project);
  const setMode = useStore((s) => s.setMode);
  const say = useStore((s) => s.say);
  const has = !!field.logic.trim();
  const simple = has && !!C.simpleRules(field.logic);
  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="text-[15px] font-medium leading-snug">{C.stripHtml(field.label) || <i className="text-muted-foreground">No question text</i>}</p>
        {field.note ? <p className="mt-1 text-xs text-muted-foreground">{C.stripHtml(field.note)}</p> : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button title="Copy the variable name"
            onClick={() => { navigator.clipboard?.writeText(field.name).then(() => say("Copied " + field.name), () => undefined); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 font-mono text-[11.5px] hover:bg-border">
            {field.name} <Copy className="size-3 text-muted-foreground" />
          </button>
          {field.required ? <Badge tone="primary">Required</Badge> : null}
          {field.identifier ? <Badge tone="warn"><Fingerprint className="size-3" /> Identifier</Badge> : null}
          {field.validation ? <Badge>{validationLabel(field.validation)}</Badge> : null}
          {field.min !== "" || field.max !== "" ? <Badge>{field.min || "…"} to {field.max || "…"}</Badge> : null}
        </div>
      </div>

      {issues.length ? <div className="space-y-1.5">{issues.map((i, k) => <IssueNote key={k} issue={i} />)}</div> : null}

      <Group title="When it is shown">
        {has ? (
          <div className="rounded-xl border border-primary/25 bg-primary-soft p-3">
            {simple ? (
              <p className="flex gap-1.5 text-[13px] font-medium leading-snug text-primary">
                <CornerDownRight className="mt-0.5 size-3.5 shrink-0" /> Only if {C.describeLogic(field.logic, index)}
              </p>
            ) : (
              <p className="text-xs text-primary">Shown only when this REDCap logic is true:</p>
            )}
            <code className="mt-2 block whitespace-pre-wrap break-words rounded-lg bg-surface/80 px-2 py-1.5 font-mono text-[11.5px] text-foreground/80">{field.logic.trim()}</code>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">Always shown to every respondent.</p>
        )}
      </Group>

      {field.choices.length ? (
        <Group title={`Answer choices (${field.choices.length})`}>
          <div className="thin-scroll max-h-64 overflow-y-auto rounded-xl border border-border">
            {field.choices.map((c, k) => (
              <div key={k} className="flex items-baseline gap-2.5 border-b border-border px-2.5 py-1.5 text-[13px] last:border-b-0">
                <span className="min-w-7 shrink-0 rounded bg-muted px-1 text-center font-mono text-[11px] text-muted-foreground">{c.code}</span>
                <span className="min-w-0">{C.stripHtml(c.label)}</span>
              </div>
            ))}
          </div>
          {field.type === "checkbox" ? (
            <p className="text-[11.5px] text-muted-foreground">
              Exported as one column per choice, for example <span className="font-mono">{field.name}___{field.choices[0].code}</span>.
            </p>
          ) : null}
        </Group>
      ) : null}

      {field.type === "calc" && field.calc ? (
        <Group title="Equation">
          <code className="block whitespace-pre-wrap break-words rounded-lg bg-muted px-2.5 py-2 font-mono text-[11.5px]">{field.calc}</code>
        </Group>
      ) : null}

      <Relations project={project} field={field} />

      {field.annotation ? (
        <Group title="Action tags">
          <code className="block whitespace-pre-wrap break-words rounded-lg bg-muted px-2.5 py-2 font-mono text-[11.5px]">{field.annotation}</code>
        </Group>
      ) : null}

      <Button variant="secondary" className="w-full" onClick={() => setMode("design")}>
        <PencilRuler /> Edit this question
      </Button>
    </div>
  );
}

/** Design mode: the same question, editable. */
function FieldEditor({ project, field, form, issues, focusTick }: { project: Project; field: Field; form: Form; issues: Issue[]; focusTick: number }) {
  const mutate = useStore((s) => s.mutate);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const labelRef = useRef<HTMLTextAreaElement>(null);
  const nameWas = useRef(field.name);
  const kind = C.kindOf(field);
  const known = C.KINDS.some((k) => k.type === field.type && (k.validation || "") === (field.validation || ""));

  useEffect(() => {
    if (focusTick && !C.stripHtml(field.label)) labelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, field.id]);

  const applyKind = (key: string) => mutate(() => {
    const k = C.KIND_BY_KEY[key];
    if (!k || !k.type) return;
    const wasChoice = !!C.CHOICE_TYPES[field.type];
    field.type = k.type;
    field.validation = k.validation || "";
    if (C.CHOICE_TYPES[field.type]) {
      if (!wasChoice || !field.choices.length) {
        field.choices = [{ code: "1", label: "Option 1" }, { code: "2", label: "Option 2" }, { code: "3", label: "Option 3" }];
      }
    } else if (field.type === "yesno") field.choices = [{ code: "1", label: "Yes" }, { code: "0", label: "No" }];
    else field.choices = [];
    if (field.type !== "text") { field.min = ""; field.max = ""; }
    if (field.type !== "calc") field.calc = "";
    if (field.type === "descriptive") field.required = false;
  });

  return (
    <div className="space-y-5 p-4">
      {field.rid ? (
        <p className="rounded-lg bg-info-soft px-2.5 py-2 text-xs leading-snug text-foreground/90">
          REDCap needs this first field to tell records apart. It stays at the top; you can rename it.
        </p>
      ) : null}
      {issues.length ? <div className="space-y-1.5">{issues.map((i, k) => <IssueNote key={k} issue={i} />)}</div> : null}

      <div className="space-y-3">
        <Labelled label={field.type === "descriptive" ? "Text to show" : "Question"}>
          <Textarea ref={labelRef} rows={3} value={field.label}
            placeholder={field.type === "descriptive" ? "Instructions or information for the respondent" : "Type the question as respondents will see it"}
            onChange={(e) => mutate((p) => {
              field.label = e.target.value;
              if (field.autoName) {
                const old = field.name;
                field.name = C.uniqueName(p, C.slugify(field.label, "question"), field.id);
                C.renameVariable(p, old, field.name);
              }
            }, "label:" + field.id)} />
        </Labelled>

        {!field.rid ? (
          <Labelled label="Answer type">
            <NativeSelect value={known ? kind.key : ""} onChange={(e) => applyKind(e.target.value)}>
              {!known ? <option value="">{kind.label}</option> : null}
              {C.KINDS.filter((k) => k.type).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </NativeSelect>
          </Labelled>
        ) : null}

        {field.type === "yesno" ? <p className="text-[11.5px] text-muted-foreground">Stored as 1 = Yes and 0 = No.</p> : null}
        {field.type === "truefalse" ? <p className="text-[11.5px] text-muted-foreground">Stored as 1 = True and 0 = False.</p> : null}

        {field.type === "text" ? (
          <>
            <Labelled label="Check that the answer is">
              <NativeSelect value={field.validation}
                onChange={(e) => mutate(() => { field.validation = e.target.value; if (!field.validation) { field.min = ""; field.max = ""; } })}>
                {C.VALIDATIONS.some((v) => v[0] === field.validation) ? null : <option value={field.validation}>{field.validation}</option>}
                {C.VALIDATIONS.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
              </NativeSelect>
            </Labelled>
            {/^(integer|number|date|datetime|time)/.test(field.validation) ? (
              <div className="grid grid-cols-2 gap-2">
                <Labelled label="Smallest allowed">
                  <Input value={field.min} placeholder="none" onChange={(e) => mutate(() => { field.min = e.target.value.trim(); }, "min:" + field.id)} />
                </Labelled>
                <Labelled label="Largest allowed">
                  <Input value={field.max} placeholder="none" onChange={(e) => mutate(() => { field.max = e.target.value.trim(); }, "max:" + field.id)} />
                </Labelled>
              </div>
            ) : null}
          </>
        ) : null}

        {field.type === "calc" ? (
          <Labelled label="Equation" hint="Use variable names in square brackets, as in REDCap.">
            <Textarea rows={3} spellCheck={false} className="font-mono text-xs" value={field.calc} placeholder="[weight] / ([height] * [height])"
              onChange={(e) => mutate(() => { field.calc = e.target.value; }, "calc:" + field.id)} />
          </Labelled>
        ) : null}
      </div>

      {C.CHOICE_TYPES[field.type] ? <Group title="Answer choices"><ChoiceEditor field={field} /></Group> : null}

      {!field.rid ? <Group title="When to show this"><LogicEditor project={project} field={field} /></Group> : null}

      <Group title="Details">
        <div className="space-y-3">
          <Labelled label="Variable name" hint={field.autoName ? "Suggested from the question. This is the column name in your data." : "The column name in your data."}>
            <Input value={field.name} spellCheck={false} autoCapitalize="off" className="font-mono text-xs"
              onFocus={() => { nameWas.current = field.name; }}
              onChange={(e) => mutate(() => {
                field.name = e.target.value.trim().toLowerCase().replace(/[\s-]+/g, "_");
                field.autoName = false;
              }, "name:" + field.id)}
              onBlur={() => {
                const was = nameWas.current;
                const taken = C.allFields(project).some((o) => o !== field && o.name === field.name);
                if (was && field.name && was !== field.name && !taken && /^[a-z][a-z0-9_]*$/.test(field.name)) {
                  mutate((p) => C.renameVariable(p, was, field.name), "name:" + field.id);
                }
                nameWas.current = field.name;
              }} />
          </Labelled>
          {field.type !== "descriptive" ? (
            <>
              <Labelled label="Help text (optional)">
                <Input value={field.note} placeholder="Shown in small print under the question"
                  onChange={(e) => mutate(() => { field.note = e.target.value; }, "note:" + field.id)} />
              </Labelled>
              {!field.rid && field.type !== "calc" ? (
                <Switch checked={field.required} onCheckedChange={(v) => mutate(() => { field.required = v; })}
                  label="Required" hint="Respondents must answer before moving on." />
              ) : null}
              <Switch checked={field.identifier} onCheckedChange={(v) => mutate(() => { field.identifier = v; })}
                label="Identifies the participant" hint="Names, contact details, dates of birth. REDCap can leave these out of exports." />
            </>
          ) : null}
          <Labelled label="Action tags (optional)" hint="REDCap field annotation. Leave blank if unsure.">
            <Input value={field.annotation} spellCheck={false} placeholder="@HIDDEN, @DEFAULT=…" className="font-mono text-xs"
              onChange={(e) => mutate(() => { field.annotation = e.target.value; }, "ann:" + field.id)} />
          </Labelled>
          {field.extra.length ? (
            <div className="rounded-lg bg-muted/60 px-2.5 py-2 text-[11.5px] text-muted-foreground">
              <p className="mb-1 font-medium">Kept from the imported project</p>
              {field.extra.map(([k, v]) => <p key={k} className="truncate"><span className="font-mono">{k}</span>: {v}</p>)}
            </div>
          ) : null}
          <p className="text-[11.5px] text-muted-foreground">Instrument: {form.label} <span className="font-mono">({form.name})</span></p>
        </div>
      </Group>

      <Relations project={project} field={field} />

      {!field.rid ? (
        <div className="flex gap-2 border-t border-border pt-4">
          <Button className="flex-1" onClick={() => duplicateItem(field.id)}><Copy /> Duplicate</Button>
          <Button variant="danger" className="flex-1" onClick={() => deleteItem(field.id)}><Trash2 /> Delete</Button>
        </div>
      ) : null}
    </div>
  );
}

function SectionPanel({ section, editable, issues }: { section: Section; editable: boolean; issues: Issue[] }) {
  const mutate = useStore((s) => s.mutate);
  const deleteItem = useStore((s) => s.deleteItem);
  return (
    <div className="space-y-4 p-4">
      {issues.map((i, k) => <IssueNote key={k} issue={i} />)}
      {editable ? (
        <>
          <Labelled label="Heading" hint="Shown as a band above the question that follows it.">
            <Textarea rows={2} autoFocus={!section.label} value={section.label}
              onChange={(e) => mutate(() => { section.label = e.target.value; }, "section:" + section.id)} />
          </Labelled>
          <Button variant="danger" onClick={() => deleteItem(section.id)}><Trash2 /> Delete</Button>
        </>
      ) : (
        <p className="text-[15px] font-medium">{C.stripHtml(section.label) || "Section"}</p>
      )}
    </div>
  );
}

function FormPanel({ project, form, editable, issues }: { project: Project; form: Form; editable: boolean; issues: Issue[] }) {
  const mutate = useStore((s) => s.mutate);
  const moveForm = useStore((s) => s.moveForm);
  const deleteForm = useStore((s) => s.deleteForm);
  const at = project.forms.indexOf(form);
  const fields = form.items.filter(C.isField);
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs leading-snug text-muted-foreground">An instrument is one page or form in REDCap. Each can be a survey or a data entry form.</p>
      {issues.map((i, k) => <IssueNote key={k} issue={i} />)}
      {editable ? (
        <Labelled label="Name" hint={<>Name inside REDCap: <span className="font-mono">{form.name}</span></>}>
          <Input value={form.label}
            onChange={(e) => mutate((p) => {
              form.label = e.target.value;
              if (form.autoName) form.name = C.uniqueFormName(p, C.formSlug(form.label), form.id);
            }, "form:" + form.id)} />
        </Labelled>
      ) : (
        <div>
          <p className="text-[15px] font-medium">{form.label}</p>
          <p className="font-mono text-[11.5px] text-muted-foreground">{form.name}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Questions" value={fields.length} />
        <Stat label="With branching" value={fields.filter((f) => f.logic.trim()).length} />
      </div>
      {editable ? (
        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex gap-2">
            <Button className="flex-1" disabled={at === 0} onClick={() => moveForm(form.id, at - 1)}><ArrowLeft /> Move left</Button>
            <Button className="flex-1" disabled={at === project.forms.length - 1} onClick={() => moveForm(form.id, at + 1)}>Move right <ArrowRight /></Button>
          </div>
          <Button variant="danger" className="w-full" disabled={project.forms.length < 2} onClick={() => deleteForm(form.id)}>
            <Trash2 /> Delete instrument
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
      <div className="text-lg font-semibold leading-6 tracking-tight tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ProjectPanel({ project, issues, editable }: { project: Project; issues: Issue[]; editable: boolean }) {
  const reveal = useStore((s) => s.reveal);
  const selectForm = useStore((s) => s.selectForm);
  const source = useStore((s) => s.source);
  const fields = C.allFields(project);
  const real = issues.filter((i) => i.severity !== "info");
  return (
    <div className="space-y-5 p-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Questions" value={fields.length} />
        <Stat label="Instruments" value={project.forms.length} />
        <Stat label="Branching" value={fields.filter((f) => f.logic.trim()).length} />
      </div>
      {source ? <p className="truncate text-[11.5px] text-muted-foreground">Opened from <span className="font-mono">{source.name}</span></p> : null}
      <Group title={real.length ? `${plural(real.length, "thing")} to check` : "Checks"}>
        {real.length ? (
          <div className="space-y-1.5">
            {real.map((i, k) => {
              const loc = i.itemId ? C.findItem(project, i.itemId) : null;
              const who = loc ? (C.isField(loc.item) ? loc.item.name : "Section") : undefined;
              return <IssueNote key={k} issue={i} who={who} onClick={() => { if (i.itemId) reveal(i.itemId); else if (i.formId) selectForm(i.formId); }} />;
            })}
          </div>
        ) : (
          <p className="rounded-lg bg-ok-soft px-2.5 py-2 text-xs text-foreground/90">No problems found in the branching logic.</p>
        )}
      </Group>
      <Group title="How it works">
        <ol className="space-y-2 text-[12.5px] leading-snug text-muted-foreground">
          {(editable ? [
            "Drag a question type from the left onto an instrument, then type the question.",
            "To add branching, drag an answer (like Yes) onto the question that should appear for it.",
            "Press Preview to answer the survey yourself and watch questions appear and disappear.",
            "Press Export for a file REDCap can upload.",
          ] : [
            "Each column is an instrument. Questions run top to bottom in survey order.",
            "A question that only appears for certain answers sits indented under the question that controls it.",
            "Click a question to see its logic in plain words, its answer codes and what depends on it.",
            "Switch to Design to change anything, or Export an agent bundle for data cleaning.",
          ]).map((t, k) => (
            <li key={k} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground">{k + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </Group>
    </div>
  );
}

export function Inspector({ issues }: { issues: Issue[] }) {
  const [project] = useProject();
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selected);
  const selectedForm = useStore((s) => s.selectedForm);
  const focusTick = useStore((s) => s.focusTick);
  const select = useStore((s) => s.select);
  const editable = mode === "design";
  const loc = selected ? C.findItem(project, selected) : null;
  const form = selectedForm ? project.forms.find((f) => f.id === selectedForm) : null;

  let head: ReactNode;
  let body: ReactNode;
  if (loc && C.isField(loc.item)) {
    const look = lookOf(loc.item);
    const Icon = look.icon;
    const mine = issues.filter((i) => i.itemId === loc.item.id);
    head = <Head icon={<Icon />} tile={look.tile} title={look.label} onClose={() => select(null)} />;
    body = editable
      ? <FieldEditor key={loc.item.id} project={project} field={loc.item} form={loc.form} issues={mine} focusTick={focusTick} />
      : <FieldDetails project={project} field={loc.item} issues={mine} />;
  } else if (loc) {
    const Icon = lookFor("section").icon;
    head = <Head icon={<Icon />} title="Section heading" onClose={() => select(null)} />;
    body = <SectionPanel key={loc.item.id} section={loc.item as Section} editable={editable} issues={issues.filter((i) => i.itemId === loc.item.id)} />;
  } else if (form) {
    head = <Head icon={<span className="text-xs font-semibold">{project.forms.indexOf(form) + 1}</span>} tile="bg-foreground text-background" title="Instrument" onClose={() => select(null)} />;
    body = <FormPanel project={project} form={form} editable={editable} issues={issues.filter((i) => i.formId === form.id && !i.itemId)} />;
  } else {
    head = <Head icon={<GitBranch />} title={editable ? "Your survey" : "Project overview"} />;
    body = <ProjectPanel project={project} issues={issues} editable={editable} />;
  }

  return (
    <aside aria-label="Details" className="flex w-[340px] shrink-0 flex-col border-l border-border bg-background">
      {head}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}
