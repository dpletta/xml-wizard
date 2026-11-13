import { useEffect, useState } from "react";
import { Bot, CircleCheck, FileSpreadsheet, FolderOpen, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { C } from "@/lib/core";
import { isDesktop, openFile, revealInFolder, saveFolder, type OpenedFile } from "@/lib/platform";
import { buildBundle, scanProject, type Action, type ScanResult } from "@/lib/python";
import { useStore } from "@/lib/store";
import { cn, fileStem, plural } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, Switch } from "./ui/fields";
import { Dialog, DialogContent } from "./ui/overlays";

const ACTIONS: [Action, string, string][] = [
  ["mask", "Mask", "Keep the column; every answer becomes [REDACTED]. Blanks stay blank, so skip logic still works."],
  ["drop", "Drop", "Remove the column."],
  ["keep", "Keep", "Leave it as it is."],
];

const LEVEL_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;

/** What the Python engine should read: the file as opened if untouched, else the survey as it is now. */
function currentInput(): OpenedFile {
  const s = useStore.getState();
  if (s.source && !s.dirty) return s.source;
  const p = s.project!;
  return { name: C.formSlug(p.title) + ".xml", text: C.exportOdm(p).xml };
}

export function AgentBundleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const say = useStore((s) => s.say);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [data, setData] = useState<OpenedFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Action>>({});
  const [includeData, setIncludeData] = useState(true);
  const [busy, setBusy] = useState<"" | "scan" | "build">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ where: string; summary: string[]; dataFile: string; count: number } | null>(null);

  const runScan = async (withData: OpenedFile | null) => {
    setBusy("scan");
    setError("");
    try {
      const result = await scanProject(currentInput(), withData);
      setScan(result);
      setDecisions(Object.fromEntries(result.flags.map((f) => [f.field, f.suggested])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!open) return;
    setScan(null);
    setData(null);
    setSaved(null);
    setIncludeData(true);
    void runScan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addData = async () => {
    try {
      const file = await openFile("data");
      if (!file) return;
      setData(file);
      await runScan(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    setBusy("build");
    setError("");
    try {
      const input = currentInput();
      const result = await buildBundle(input, data, decisions, includeData);
      const where = await saveFolder(fileStem(input.name) + "_xml_wizard", result.files);
      if (where) {
        setSaved({ where, summary: result.summary, dataFile: result.dataFile, count: result.files.length });
        say("Agent bundle saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const errors = scan?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnings = scan?.issues.filter((i) => i.severity === "warning").length ?? 0;
  const redacted = Object.values(decisions).filter((a) => a !== "keep").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title="Agent bundle"
        description="A folder for Claude Code, Codex or Cursor: a codebook, the skip logic, and ready-to-run cleaning scripts in Python and R.">
        {saved ? (
          <div className="space-y-4 px-6 pb-6">
            <div className="flex items-start gap-3 rounded-xl bg-ok-soft p-4">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div className="min-w-0 text-[13px]">
                <p className="font-semibold">Saved {plural(saved.count, "file")}</p>
                <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{saved.where}</p>
              </div>
            </div>
            <ul className="space-y-1 text-[13px] text-muted-foreground">
              {saved.summary.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div className="rounded-xl border border-border p-4 text-[13px] leading-relaxed">
              <p className="font-semibold">What to do next</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted-foreground">
                {isDesktop ? null : <li>Unzip the download.</li>}
                <li>Open the <span className="font-mono text-xs">agent_bundle</span> folder with your coding agent and ask it to start with <span className="font-mono text-xs">AGENTS.md</span>.</li>
                <li>Give the agent {saved.dataFile ? <>the redacted copy at <span className="font-mono text-xs">{saved.dataFile}</span></> : "only this folder"}, never your original export, which still holds every value.</li>
                <li><span className="font-mono text-xs">survey_tree.html</span> is a copy of the map you can email or put on a shared drive.</li>
              </ol>
            </div>
            <div className="flex justify-end gap-2">
              {isDesktop ? <Button onClick={() => revealInFolder(saved.where)}><FolderOpen /> Show in folder</Button> : null}
              <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-2">
              {error ? (
                <div className="rounded-xl bg-danger-soft px-3.5 py-3 text-[13px]">
                  <p className="font-semibold text-danger">That did not work</p>
                  <p className="mt-0.5 text-foreground/85">{error}</p>
                </div>
              ) : null}
              {!scan && busy === "scan" ? (
                <div className="flex items-center gap-3 rounded-xl border border-border p-5 text-[13px] text-muted-foreground">
                  <LoaderCircle className="size-5 animate-spin text-primary" />
                  Starting the analysis engine on this computer…
                </div>
              ) : null}
              {scan ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Tile value={scan.n_items} label="Questions" />
                    <Tile value={scan.n_gated} label="With branching" />
                    <Tile value={errors + warnings} label="Logic problems" tone={errors ? "danger" : warnings ? "warn" : "ok"} />
                    <Tile value={scan.n_implied} label="Suggested logical fills" />
                  </div>

                  <section className="rounded-xl border border-border p-4">
                    <div className="flex items-start gap-3">
                      <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 text-[13px]">
                        <p className="font-semibold">Check your data against the logic <span className="font-normal text-muted-foreground">(optional)</span></p>
                        {scan.audit ? (
                          <p className="mt-0.5 text-muted-foreground">
                            {data ? <span className="font-mono text-xs">{data.name}</span> : "Data inside the project file"}: {plural(scan.audit.n_rows, "row")}.{" "}
                            <b className="font-semibold text-foreground">{scan.audit.totals.answered_when_hidden}</b> answered while hidden,{" "}
                            <b className="font-semibold text-foreground">{scan.audit.totals.blank_when_shown}</b> blank while shown,{" "}
                            <b className="font-semibold text-foreground">{scan.audit.totals.invalid_codes}</b> invalid codes,{" "}
                            {scan.audit.totals.skipped_by_design} skipped by design.
                          </p>
                        ) : (
                          <p className="mt-0.5 text-muted-foreground">
                            Add a <i>CSV / Microsoft Excel (raw data)</i> export from REDCap to count answers recorded for hidden questions, true non-response and invalid codes. It is read here, on this computer.
                          </p>
                        )}
                      </div>
                      {data ? (
                        <Button size="sm" variant="ghost" onClick={() => { setData(null); void runScan(null); }}><X /> Remove</Button>
                      ) : (
                        <Button size="sm" onClick={addData} disabled={!!busy}>Add data…</Button>
                      )}
                    </div>
                    {scan.has_data ? (
                      <div className="mt-3 border-t border-border pt-3">
                        <Switch checked={includeData} onCheckedChange={setIncludeData} label="Include a redacted copy of the data for the agent"
                          hint="Your choices below are applied to the copy. The original file is never changed." />
                      </div>
                    ) : null}
                  </section>

                  <section>
                    <div className="mb-2 flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      <h3 className="text-sm font-semibold">Privacy check</h3>
                      <span className="flex-1" />
                      {scan.flags.length ? (
                        <>
                          <button className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            onClick={() => setDecisions(Object.fromEntries(scan.flags.map((f) => [f.field, f.suggested])))}>Use suggestions</button>
                          <button className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            onClick={() => setDecisions(Object.fromEntries(scan.flags.map((f) => [f.field, "mask" as Action])))}>Mask all</button>
                        </>
                      ) : null}
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                      Anything a coding agent reads is sent to the company that runs its model. These variables may identify participants.
                      Choose what the agent may see; this changes the bundle only, never your REDCap project or your original export.
                    </p>
                    {scan.flags.length ? (
                      <div className="overflow-hidden rounded-xl border border-border">
                        {scan.flags.map((f) => (
                          <div key={f.field} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-mono text-xs font-medium">{f.field}</span>
                                <Badge tone={LEVEL_TONE[f.level]}>{f.level} risk</Badge>
                              </div>
                              <p className="truncate text-xs text-muted-foreground" title={f.label}>{f.label || f.type}</p>
                              <p className="truncate text-[11.5px] text-muted-foreground/80" title={f.reasons.join("; ")}>{f.reasons.join("; ")}</p>
                            </div>
                            <div role="radiogroup" aria-label={"What to do with " + f.field} className="grid shrink-0 grid-cols-3 rounded-lg bg-muted p-0.5 text-xs font-medium">
                              {ACTIONS.map(([act, text, hint]) => (
                                <button key={act} role="radio" aria-checked={decisions[f.field] === act} title={hint + (f.suggested === act ? " Suggested." : "")}
                                  onClick={() => setDecisions((d) => ({ ...d, [f.field]: act }))}
                                  className={cn("h-6.5 rounded-md px-2.5 transition-colors",
                                    decisions[f.field] === act
                                      ? act === "keep" ? "bg-surface shadow-card" : "bg-primary text-primary-foreground shadow-card"
                                      : "text-muted-foreground hover:text-foreground")}>
                                  {text}{f.suggested === act ? <span className="ml-0.5 opacity-60">•</span> : null}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-ok-soft px-3.5 py-3 text-[13px]">No variables look like they identify participants.</p>
                    )}
                    {scan.flags.length ? <p className="mt-2 text-[11.5px] text-muted-foreground">• marks the suggestion. The record ID is kept so rows can be linked; make sure it is an arbitrary study ID.</p> : null}
                  </section>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {scan ? (redacted ? `${plural(redacted, "variable")} will be masked or dropped.` : "Nothing will be redacted.") : ""}
              </p>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" disabled={!scan || !!busy} onClick={save}>
                {busy === "build" ? <LoaderCircle className="animate-spin" /> : <Bot />} {isDesktop ? "Save agent bundle…" : "Download agent bundle"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className={cn("text-xl font-semibold leading-6 tracking-tight tabular-nums",
        tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
