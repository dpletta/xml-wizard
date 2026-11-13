import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { FileDown } from "lucide-react";
import { C } from "@/lib/core";
import { readBrowserFile } from "@/lib/platform";
import { autosave, loadText, openProject } from "@/lib/session";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AgentBundleDialog } from "./components/AgentBundleDialog";
import { CompactMap } from "./components/CompactMap";
import { Canvas } from "./components/Canvas";
import { CommandPalette } from "./components/CommandPalette";
import { Inspector } from "./components/Inspector";
import { PreviewDialog } from "./components/PreviewDialog";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { CAST_MS, Welcome } from "./components/Welcome";
import { TooltipProvider } from "./components/ui/overlays";

function useDark(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("xmlw.theme");
      if (saved) return saved === "dark";
    } catch { /* ignore */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  return [dark, () => setDark((d) => {
    try { localStorage.setItem("xmlw.theme", d ? "light" : "dark"); } catch { /* ignore */ }
    return !d;
  })];
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState((s) => (s.toast?.id === toast.id ? { toast: null } : s)), toast.tone === "error" ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div key={toast.id} role="status"
      className={cn("fixed bottom-6 left-1/2 z-[70] max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-pop animate-toast",
        toast.tone === "error" ? "bg-danger text-white" : "bg-foreground text-background")}>
      {toast.text}
    </div>
  );
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function App() {
  const project = useStore((s) => s.project);
  const rev = useStore((s) => s.rev);
  const view = useStore((s) => s.view);
  const [dark, toggleDark] = useDark();
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState(false);
  const [bundle, setBundle] = useState(false);
  const [dropping, setDropping] = useState(false);

  // Opening a project from the welcome screen plays the hat shimmer first, then shows the canvas.
  const [welcome, setWelcome] = useState(!project);
  const hasProject = !!project;
  useEffect(() => {
    if (!hasProject) { setWelcome(true); return; }
    if (!welcome) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setWelcome(false), calm ? 0 : CAST_MS);
    return () => clearTimeout(timer);
  }, [hasProject, welcome]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = useMemo(() => (project ? C.validate(project) : []), [project, rev]);

  useEffect(() => {
    const t = setTimeout(autosave, 600);
    return () => clearTimeout(t);
  }, [rev]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "o") { e.preventDefault(); void openProject(st.project ? st.mode : "map"); return; }
      if (!st.project) return;
      if (mod && key === "k") { e.preventDefault(); setSearch(true); return; }
      if (typing(e.target)) return;
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); st.redo(); return; }
      if (st.mode !== "design" || !st.selected) { if (e.key === "Escape") st.select(null); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); st.deleteItem(st.selected); }
      else if (mod && key === "d") { e.preventDefault(); st.duplicateItem(st.selected); }
      else if (e.key === "Escape") st.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDropping(true); e.preventDefault(); } };
    const over = (e: DragEvent) => { if (files(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDropping(false); } };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const file = e.dataTransfer!.files[0];
      if (!file) return;
      const st = useStore.getState();
      readBrowserFile(file).then((f) => loadText(f, st.project ? st.mode : "map"), () => st.say("That file could not be read.", "error"));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={350}>
      {project && !welcome ? (
        <div className="flex h-full flex-col animate-fade">
          <TopBar issues={issues} dark={dark} onToggleDark={toggleDark} onPreview={() => setPreview(true)} onSearch={() => setSearch(true)} onBundle={() => setBundle(true)} />
          <div className="flex min-h-0 flex-1">
            <Sidebar issues={issues} />
            <main className="relative min-w-0 flex-1">
              <ReactFlowProvider key={view === "compact" ? "compact" : "canvas"}>
                {view === "compact" ? <CompactMap issues={issues} dark={dark} /> : <Canvas issues={issues} dark={dark} />}
              </ReactFlowProvider>
            </main>
            <Inspector issues={issues} />
          </div>
          <PreviewDialog open={preview} onOpenChange={setPreview} />
          <CommandPalette open={search} onOpenChange={setSearch} />
          <AgentBundleDialog open={bundle} onOpenChange={setBundle} />
        </div>
      ) : (
        <Welcome dark={dark} onToggleDark={toggleDark} casting={hasProject} />
      )}
      {dropping ? (
        <div className="pointer-events-none fixed inset-3 z-[80] grid place-items-center rounded-3xl border-2 border-dashed border-primary bg-primary-soft/85 backdrop-blur-sm animate-fade">
          <div className="flex flex-col items-center gap-2 text-primary">
            <FileDown className="size-10" />
            <p className="text-lg font-semibold">Drop your REDCap file to open it</p>
          </div>
        </div>
      ) : null}
      <Toast />
    </TooltipProvider>
  );
}
