// Opening projects, saving exports, and keeping unsaved design work safe.
import { C, type Project } from "./core";
import { openFile, saveFile, type OpenedFile } from "./platform";
import { useStore, type Mode } from "./store";

const AUTOSAVE = "xmlw.autosave.v1";

export function loadText(file: OpenedFile, mode: Mode = "map"): boolean {
  const st = useStore.getState();
  try {
    const { project, notes } = C.importAny(file.text, file.name);
    st.open(project, file, mode, notes);
    const n = C.allFields(project).length;
    st.say(`Opened ${file.name}: ${n} question${n === 1 ? "" : "s"} in ${project.forms.length} instrument${project.forms.length === 1 ? "" : "s"}.`);
    return true;
  } catch (e) {
    const err = e as Error;
    st.say(
      err && err.name === "InputError"
        ? err.message
        : `${file.name} could not be opened. Use a REDCap project XML (Other Functionality, Download metadata only) or a Data Dictionary CSV.`,
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

interface Saved {
  project: Project;
  name: string;
  at: number;
}

/** Unsaved design work is kept on this computer so closing the app loses nothing. It holds no participant data. */
export function autosave() {
  const s = useStore.getState();
  try {
    if (s.project && s.dirty) {
      const saved: Saved = { project: s.project, name: s.source?.name ?? "", at: Date.now() };
      localStorage.setItem(AUTOSAVE, JSON.stringify(saved));
    }
  } catch {
    /* storage full or unavailable: carry on */
  }
}

export function readAutosave(): Saved | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && saved.project && Array.isArray(saved.project.forms) ? saved : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE);
  } catch {
    /* ignore */
  }
}

export function resumeAutosave() {
  const saved = readAutosave();
  if (!saved) return;
  const st = useStore.getState();
  st.open(saved.project, null, "design");
  useStore.setState({ dirty: true });
}
