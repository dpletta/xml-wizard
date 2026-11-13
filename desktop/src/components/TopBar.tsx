import { motion } from "motion/react";
import {
  Bot, CircleCheck, Download, FileCode2, FilePlus2, FileSpreadsheet, FolderOpen, House, PanelsTopLeft, Map as MapIcon, Moon, PencilRuler, Play, Redo2,
  Search, Sun, TriangleAlert, Undo2,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { C, type Issue } from "@/lib/core";
import { exportProject, newProject, openProject } from "@/lib/session";
import { useProject, useStore, type WorkspaceView } from "@/lib/store";
import { cn, plural } from "@/lib/utils";
import { IssueNote } from "./Inspector";
import { Button } from "./ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "./ui/overlays";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = mac ? "⌘" : "Ctrl+";

function ModeSwitch() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const modes: [WorkspaceView, string, typeof MapIcon, string][] = [
    ["compact", "Compact", PanelsTopLeft, "Browse a compact accordion overview"],
    ["map", "Map", MapIcon, "See the survey and its branching logic"],
    ["design", "Design", PencilRuler, "Build or change the survey"],
  ];
  return (
    <div role="group" aria-label="Workspace view" className="relative grid grid-cols-3 rounded-xl bg-muted p-1">
      {modes.map(([key, label, Icon, hint]) => (
        <Tip key={key} text={hint}>
          <button aria-pressed={view === key} onClick={() => setView(key)}
            className={cn("relative z-10 flex h-7.5 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors",
              view === key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {view === key ? (
              <motion.span layoutId="mode-pill" className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-card"
                transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            ) : null}
            <Icon className={cn("size-4", view === key && "text-primary")} /> {label}
          </button>
        </Tip>
      ))}
    </div>
  );
}

function Problems({ issues }: { issues: Issue[] }) {
  const [project] = useProject();
  const reveal = useStore((s) => s.reveal);
  const selectForm = useStore((s) => s.selectForm);
  const real = issues.filter((i) => i.severity !== "info");
  const errors = real.filter((i) => i.severity === "error").length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("inline-flex h-8.5 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
          !real.length ? "bg-ok-soft text-ok" : errors ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
          {real.length ? <TriangleAlert className="size-3.5" /> : <CircleCheck className="size-3.5" />}
          {real.length ? plural(real.length, "problem") : "No problems"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Branching logic check</p>
          <p className="text-xs text-muted-foreground">
            {real.length ? "Mistakes REDCap does not warn you about. Click one to go to the question." : "No problems found. Every reference and answer code checks out."}
          </p>
        </div>
        {real.length ? (
          <div className="thin-scroll max-h-96 space-y-1.5 overflow-y-auto p-3">
            {real.map((i, k) => {
              const loc = i.itemId ? C.findItem(project, i.itemId) : null;
              return (
                <IssueNote key={k} issue={i} who={loc ? (C.isField(loc.item) ? loc.item.name : "Section") : undefined}
                  onClick={() => { if (i.itemId) reveal(i.itemId); else if (i.formId) selectForm(i.formId); }} />
              );
            })}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function TopBar({ issues, dark, onToggleDark, onPreview, onSearch, onBundle }: {
  issues: Issue[]; dark: boolean; onToggleDark: () => void; onPreview: () => void; onSearch: () => void; onBundle: () => void;
}) {
  const [project] = useProject();
  const mode = useStore((s) => s.mode);
  const mutate = useStore((s) => s.mutate);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const source = useStore((s) => s.source);
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Tip text="Back to the start screen">
        <button onClick={() => useStore.getState().close()} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted" aria-label="Start screen">
          <img src={logo} alt="" className="size-7" draggable={false} />
          <House className="size-3.5 text-muted-foreground" />
        </button>
      </Tip>
      <div className="mx-1 h-6 w-px bg-border" />
      <div className="min-w-0 flex-1">
        {mode === "design" ? (
          <input value={project.title} aria-label="Survey title" placeholder="Survey title"
            onChange={(e) => mutate((p) => { p.title = e.target.value; }, "title")}
            className="w-full max-w-md truncate rounded-md bg-transparent px-1.5 py-0.5 text-sm font-semibold tracking-tight outline-none hover:bg-muted focus:bg-muted" />
        ) : (
          <p className="truncate px-1.5 text-sm font-semibold tracking-tight">{project.title}</p>
        )}
        <p className="truncate px-1.5 text-[11px] text-muted-foreground">
          {source ? source.name : "New survey"}{dirty ? " · edited, kept on this computer" : ""}
        </p>
      </div>

      <ModeSwitch />

      <div className="flex flex-1 items-center justify-end gap-1.5">
        {mode === "design" ? (
          <>
            <Tip text={`Undo (${modKey}Z)`}><Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={() => useStore.getState().undo()}><Undo2 /></Button></Tip>
            <Tip text={`Redo (${modKey}${mac ? "⇧Z" : "Y"})`}><Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={() => useStore.getState().redo()}><Redo2 /></Button></Tip>
          </>
        ) : null}
        <Tip text={`Find a question (${modKey}K)`}>
          <Button variant="ghost" size="icon" aria-label="Find a question" onClick={onSearch}><Search /></Button>
        </Tip>
        <Problems issues={issues} />
        <Tip text="Answer the survey yourself to test the branching">
          <Button onClick={onPreview}><Play /> Preview</Button>
        </Tip>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="primary"><Download /> Export</Button>
          </MenuTrigger>
          <MenuContent className="w-80">
            <MenuLabel>For REDCap</MenuLabel>
            <MenuItem icon={<FileCode2 />} hint="Creates a new project: New Project, Upload a REDCap project XML file." onSelect={() => exportProject("xml")}>Project XML</MenuItem>
            <MenuItem icon={<FileSpreadsheet />} hint="Updates a project you already have: Project Setup, Data Dictionary." onSelect={() => exportProject("csv")}>Data dictionary CSV</MenuItem>
            <MenuSeparator />
            <MenuLabel>For data cleaning</MenuLabel>
            <MenuItem icon={<Bot />} hint="Codebook, skip logic and cleaning scripts for Claude Code, Codex or Cursor, after a privacy check." onSelect={onBundle}>Agent bundle…</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<FolderOpen />} onSelect={() => openProject(mode)}>Open another file…</MenuItem>
            <MenuItem icon={<FilePlus2 />} onSelect={newProject}>New survey</MenuItem>
          </MenuContent>
        </Menu>
        <Tip text={dark ? "Light theme" : "Dark theme"}>
          <Button variant="ghost" size="icon" aria-label="Switch theme" onClick={onToggleDark}>{dark ? <Sun /> : <Moon />}</Button>
        </Tip>
      </div>
    </header>
  );
}
