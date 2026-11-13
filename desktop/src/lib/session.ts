// Opening projects, saving exports, and keeping unsaved design work safe.
import { C, type Project } from "./core";
import { openFile, saveFile, type OpenedFile } from "./platform";
import { useStore, type Mode } from "./store";

import { encodeProject, decodeProject } from "./project-file";
import { writeDraft, readDraft, deleteDraft } from "./drafts";

const AUTOSAVE = "xmlw.autosave.v1";

export function loadText(file: OpenedFile, mode: Mode = "map"): boolean {
  const st = useStore.getState();
  try {
    const { project, notes } = file.name.toLowerCase().endsWith(".json")
      ? { project: decodeProject(file.text), notes: [] } : C.importAny(file.text, file.name);
    if (st.project) void autosave();
    st.open(project, file, mode, notes);
    const n = C.allFields(project).length;
    st.say(`Opened ${file.name}: ${n} question${n === 1 ? "" : "s"} in ${project.forms.length} instrument${project.forms.length === 1 ? "" : "s"}.`);
    return true;
  } catch (e) {
    const err = e as Error;
    st.say(
      err && err.name === "InputError"
        ? err.message
        : `${file.name} could not be opened. Use an XML Wizard project, REDCap project XML (Other Functionality, Download metadata only) or a Data Dictionary CSV.`,
      "error",
    );
    return false;
  }
}

export async function openProject(mode: Mode = "map") {
  try {
    const file = await openFile("project");
    if (file) loadText(file, mode);
  } catch (e) {
    useStore.getState().say(e instanceof Error ? e.message : String(e), "error");
  }
}

export async function openExample(name: "housing" | "most") {
  const file = name === "housing" ? "housing_survey_odm.xml" : "most_practice_metadata.xml";
  try {
    const res = await fetch(new URL("./examples/" + file, document.baseURI));
    if (!res.ok) throw new Error("missing");
    loadText({ name: file, text: await res.text() }, "map");
  } catch {
    // The built-in sample needs no file at all.
    useStore.getState().open(C.sampleProject(), null, "map");
  }
}

export function newProject() {
  void autosave();
  useStore.getState().open(C.newProject("My survey"), null, "design");
}

export async function exportProject(kind: "xml" | "csv") {
  const st = useStore.getState();
  const p = st.project;
  if (!p) return;
  try {
    const stem = C.formSlug(p.title);
    let notes: string[] = [];
    let where: string | null;
    if (kind === "xml") {
      const out = C.exportOdm(p);
      notes = out.notes;
      where = await saveFile(stem + ".REDCap.xml", out.xml, "application/xml");
    } else {
      where = await saveFile(stem + "_DataDictionary.csv", C.exportDataDictionary(p), "text/csv");
    }
    if (!where) return;
    const errors = C.validate(p).filter((i) => i.severity === "error").length;
    st.say(errors
      ? `Saved. ${errors} problem${errors === 1 ? "" : "s"} should be fixed before uploading to REDCap.`
      : notes.length ? "Saved. " + notes.join(" ")
      : kind === "xml" ? "Saved. In REDCap: New Project, then Upload a REDCap project XML file." : "Saved. In REDCap: Project Setup, Data Dictionary, Upload.");
  } catch (e) {
    st.say(e instanceof Error ? e.message : String(e), "error");
  }
}

export interface Saved { project: Project; at: number }

/** Persist only a metadata design snapshot; never the original source file. */
export async function autosave(): Promise<boolean> {
  const s = useStore.getState();
  if (!s.project || s.draftStatus === "saved") return true;
  const rev = s.rev;
  useStore.setState({ draftStatus: "saving" });
  try {
    const text = encodeProject(s.project);
    await writeDraft({ text, at: Date.now() });
    const current = useStore.getState().rev === rev && useStore.getState().project === s.project;
    if (current) useStore.setState({ draftStatus: "saved" });
    return current;
  } catch {
    if (useStore.getState().rev === rev) useStore.setState({ draftStatus: "error" });
    s.say("The local draft could not be saved. Use Save to download a project copy before closing.", "error");
    return false;
  }
}

export async function readAutosave(): Promise<Saved | null> {
  try {
    const draft = await readDraft();
    if (draft) return { project: decodeProject(draft.text), at: draft.at };
    const raw = localStorage.getItem(AUTOSAVE);
    if (!raw) return null;
    const old = JSON.parse(raw) as Saved;
    // Migration writes a metadata-only portable snapshot before removing the old copy.
    const text = encodeProject(old.project), project = decodeProject(text);
    await writeDraft({ text, at: old.at });
    localStorage.removeItem(AUTOSAVE);
    return { project, at: old.at };
  } catch {
    useStore.getState().say("The local draft could not be opened. Open your saved project file to recover your work.", "error");
    return null;
  }
}

export async function clearAutosave(): Promise<boolean> {
  try { await deleteDraft(); localStorage.removeItem(AUTOSAVE); return true; }
  catch { useStore.getState().say("The draft could not be removed. Check browser storage permissions.", "error"); return false; }
}

export async function resumeAutosave() {
  const saved = await readAutosave();
  if (!saved) return;
  useStore.getState().open(saved.project, null, "design");
  useStore.setState({ dirty: true, draftStatus: "saved" });
}

export async function saveProject(): Promise<boolean> {
  const st = useStore.getState();
  if (!st.project) return false;
  try {
    const where = await saveFile(C.formSlug(st.project.title) + ".xmlw.json", encodeProject(st.project), "application/json");
    if (!where) return false;
    useStore.setState({ fileSavedRev: st.rev });
    void autosave();
    void navigator.storage?.persist?.().catch(() => false);
    st.say("Project file saved with your layout and flow lines. Keep this copy as a backup; browser drafts can be cleared.");
    return true;
  } catch {
    st.say("The project file could not be saved. Please try again.", "error");
    return false;
  }
}
