import { motion } from "motion/react";
import { ArrowRight, FolderOpen, History, Lock, Moon, PencilRuler, Sun, WifiOff } from "lucide-react";
import logo from "@/assets/logo.png";
import { C } from "@/lib/core";
import { isDesktop } from "@/lib/platform";
import { clearAutosave, newProject, openExample, openProject, readAutosave, resumeAutosave } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const SPARKS = [
  [12, 22, 0], [86, 14, 0.6], [22, 70, 1.2], [78, 64, 0.3], [50, 6, 0.9], [6, 46, 1.6], [94, 40, 1.1], [64, 86, 0.2], [36, 90, 1.4],
];

function Sparkle({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <svg viewBox="0 0 24 24" className="absolute size-3 text-primary" aria-hidden
      style={{ left: x + "%", top: y + "%", animation: `twinkle ${2.6 + delay}s ease-in-out ${delay}s infinite` }}>
      <path fill="currentColor" d="M12 0c.9 6.6 4.4 10.1 12 12-7.6 1.9-11.1 5.4-12 12-.9-6.600-4.400-10.100-12-12 7.600-1.900 11.100-5.400 12-12Z" />
    </svg>
  );
}

function ActionCard({ icon, title, text, cta, onClick, primary }: {
  icon: React.ReactNode; title: string; text: string; cta: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 26 }} onClick={onClick}
      className={cn("group relative flex flex-col items-start overflow-hidden rounded-2xl border p-5 text-left shadow-card transition-shadow hover:shadow-lift",
        primary ? "border-primary/30 bg-surface" : "border-border bg-surface")}>
      {primary ? <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-primary/10 blur-2xl" /> : null}
      <span className={cn("grid size-10 place-items-center rounded-xl [&_svg]:size-5", primary ? "bg-primary text-primary-foreground" : "bg-foreground text-background")}>{icon}</span>
      <span className="mt-4 text-base font-semibold tracking-tight">{title}</span>
      <span className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{text}</span>
      <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
        {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </motion.button>
  );
}

export function Welcome({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const saved = readAutosave();
  return (
    <div className="thin-scroll relative h-full overflow-y-auto">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-18%] size-[720px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" style={{ animation: "drift 16s ease-in-out infinite" }} />
        <div className="absolute inset-0 [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_60%_55%_at_50%_30%,black,transparent)]" />
      </div>
      <Button variant="ghost" size="icon" aria-label="Switch theme" onClick={onToggleDark} className="absolute right-4 top-4 z-10">{dark ? <Sun /> : <Moon />}</Button>

      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 py-12">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex flex-col items-center text-center">
          <div className="relative grid size-32 place-items-center">
            {SPARKS.map(([x, y, d], k) => <Sparkle key={k} x={x} y={y} delay={d} />)}
            <motion.img src={logo} alt="" draggable={false} className="size-24 drop-shadow-[0_10px_18px_rgba(227,0,27,0.25)]"
              initial={{ rotate: -8, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 160, damping: 12 }} />
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">XML Wizard</h1>
          <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            See every question and skip pattern in a REDCap project at a glance, catch logic mistakes before they cost you data, and design new surveys by drag and drop.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-9 grid w-full gap-4 sm:grid-cols-2">
          <ActionCard primary icon={<FolderOpen />} title="Map an existing project" cta="Open a file"
            text="Open a REDCap project XML or data dictionary CSV and explore its instruments and branching logic as a zoomable map."
            onClick={() => openProject("map")} />
          <ActionCard icon={<PencilRuler />} title="Design a new survey" cta="Start designing"
            text="Build instruments, questions and branching on a canvas, preview it as a respondent, then export a file REDCap can upload."
            onClick={newProject} />
        </motion.div>

        {saved ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card">
            <History className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="truncate font-semibold">Continue “{saved.project.title}”</p>
              <p className="text-xs text-muted-foreground">
                {C.allFields(saved.project).length} questions, last edited {new Date(saved.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { clearAutosave(); location.reload(); }}>Discard</Button>
            <Button size="sm" onClick={resumeAutosave}>Continue</Button>
          </motion.div>
        ) : null}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-7 flex flex-wrap items-center justify-center gap-2 text-[13px]">
          <span className="text-muted-foreground">or try an example:</span>
          <button onClick={() => openExample("housing")} className="rounded-full border border-border bg-surface px-3 py-1 font-medium shadow-card hover:border-primary hover:text-primary">Housing and health survey</button>
          <button onClick={() => openExample("most")} className="rounded-full border border-border bg-surface px-3 py-1 font-medium shadow-card hover:border-primary hover:text-primary">Longitudinal study template</button>
        </motion.div>

        <p className="mt-3 text-xs text-muted-foreground">You can also drop a file anywhere in this window.</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Your files stay on this computer</span>
          <span className="inline-flex items-center gap-1.5"><WifiOff className="size-3.5" /> Works offline, nothing is uploaded</span>
          <span>Version {__APP_VERSION__}{isDesktop ? "" : " (browser)"}</span>
        </div>
      </div>
    </div>
  );
}
