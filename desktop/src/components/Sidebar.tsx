import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CornerDownRight, Plus, Search } from "lucide-react";
import { C, type Issue } from "@/lib/core";
import { worstByItem } from "@/lib/layout";
import { lookFor, lookOf } from "@/lib/kinds";
import { useProject, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { KIND_MIME } from "./Canvas";
import { Input } from "./ui/fields";

function Palette() {
  const addItem = useStore((s) => s.addItem);
  const addForm = useStore((s) => s.addForm);
  const groups: [string, string[]][] = [
    ["Choices", ["yesno", "radio", "dropdown", "checkbox"]],
    ["Text and numbers", ["text", "notes", "integer", "number", "date", "email", "slider"]],
    ["Other", ["calc", "file", "descriptive", "section"]],
  ];
  return (
    <div className="space-y-4 p-3">
      <p className="px-1 text-[11.5px] leading-snug text-muted-foreground">Drag a type onto an instrument, or click to add it after the selected question.</p>
      {groups.map(([title, keys]) => (
        <div key={title}>
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
          <div className="space-y-1">
            {keys.map((key) => {
              const kind = C.KIND_BY_KEY[key];
              const look = lookFor(key);
              const Icon = look.icon;
              return (
                <button key={key} draggable
                  onDragStart={(e) => { e.dataTransfer.setData(KIND_MIME, key); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => addItem(key)}
                  className="group flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition-all hover:border-border hover:bg-surface hover:shadow-card active:cursor-grabbing">
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", look.tile)}><Icon className="size-3.5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium leading-4">{kind.label}</span>
                    <span className="block truncate text-[11px] leading-4 text-muted-foreground">{kind.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button onClick={() => addForm()}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-xs font-medium text-muted-foreground hover:border-primary hover:bg-primary-soft hover:text-primary">
        <Plus className="size-3.5" /> New instrument
      </button>
    </div>
  );
}

function Outline({ issues }: { issues: Issue[] }) {
  const [project, rev] = useProject();
  const selected = useStore((s) => s.selected);
  const selectedForm = useStore((s) => s.selectedForm);
  const reveal = useStore((s) => s.reveal);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const worst = useMemo(() => worstByItem(issues), [issues]);
  const q = query.trim().toLowerCase();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trees = useMemo(() => project.forms.map((form) => ({ form, depth: C.parentsInForm(form).depth })), [project, rev]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative p-3 pb-2">
        <Search className="pointer-events-none absolute left-5.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter questions" aria-label="Filter questions" className="h-8 pl-8 text-xs" />
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {trees.map(({ form, depth }, k) => {
          const rows = form.items.filter((it) => {
            if (!q) return true;
            const text = C.isField(it) ? it.name + " " + C.stripHtml(it.label) : C.stripHtml(it.label);
            return text.toLowerCase().includes(q);
          });
          if (q && !rows.length) return null;
          const open = q ? true : !closed[form.id];
          return (
            <div key={form.id} className="mb-1">
              <div className={cn("flex items-center rounded-lg", selectedForm === form.id && "bg-primary-soft")}>
                <button aria-label={open ? "Collapse" : "Expand"} onClick={() => setClosed((c) => ({ ...c, [form.id]: open }))}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                  <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                </button>
                <button onClick={() => { useStore.getState().selectForm(form.id); useStore.setState((s) => ({ focusTick: s.focusTick + 1 })); }}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left">
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground text-[10px] font-semibold text-background">{k + 1}</span>
                  <span className="truncate text-[12.5px] font-semibold">{form.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{form.items.filter(C.isField).length}</span>
                </button>
              </div>
              {open ? rows.map((it) => {
                if (!C.isField(it)) {
                  return (
                    <button key={it.id} onClick={() => reveal(it.id)}
                      className={cn("mt-1 block w-full truncate rounded-md px-2 py-1 pl-7 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:bg-muted", selected === it.id && "bg-primary-soft text-primary")}>
                      {C.stripHtml(it.label) || "Section"}
                    </button>
                  );
                }
                const Icon = lookOf(it).icon;
                const d = q ? 0 : depth[it.id] || 0;
                const w = worst.get(it.id);
                return (
                  <button key={it.id} onClick={() => reveal(it.id)} title={C.stripHtml(it.label)}
                    style={{ paddingLeft: 28 + d * 12 }}
                    className={cn("flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-muted", selected === it.id && "bg-primary-soft text-primary hover:bg-primary-soft")}>
                    {d ? <CornerDownRight className="size-3 shrink-0 text-muted-foreground/70" /> : <Icon className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{C.stripHtml(it.label) || it.name}</span>
                    {w ? <span className={cn("ml-auto size-1.5 shrink-0 rounded-full", w === "error" ? "bg-danger" : "bg-warn")} /> : null}
                  </button>
                );
              }) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({ issues }: { issues: Issue[] }) {
  const mode = useStore((s) => s.mode);
  const [tab, setTab] = useState<"outline" | "add">(mode === "design" ? "add" : "outline");
  useEffect(() => setTab(mode === "design" ? "add" : "outline"), [mode]);
  return (
    <aside aria-label="Outline and question types" className="workspace-sidebar flex w-[264px] shrink-0 flex-col border-r border-border bg-background">
      {mode === "design" ? (
        <div className="m-3 mb-0 grid grid-cols-2 rounded-lg bg-muted p-0.5 text-[12.5px] font-medium">
          {(["add", "outline"] as const).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}
              className={cn("h-7 rounded-md transition-colors", tab === t ? "bg-surface shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {t === "add" ? "Add questions" : "Outline"}
            </button>
          ))}
        </div>
      ) : null}
      {mode === "design" && tab === "add" ? <div className="thin-scroll min-h-0 flex-1 overflow-y-auto"><Palette /></div> : <Outline issues={issues} />}
    </aside>
  );
}
