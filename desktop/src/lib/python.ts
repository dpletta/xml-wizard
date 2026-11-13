// Runs the xml_wizard Python package inside the window (Pyodide: Python compiled
// to WebAssembly), so the privacy check and the agent bundle are produced by the
// same code as the command line tool. The runtime and the package ship with the
// app; nothing is downloaded and nothing leaves this computer.
import type { PyodideInterface } from "pyodide";
import type { OpenedFile, OutFile } from "./platform";

export interface ScanFlag {
  field: string;
  label: string;
  type: string;
  level: "high" | "medium" | "low";
  reasons: string[];
  suggested: Action;
  group: string;
  used_in_logic_of: string[];
}

export type Action = "mask" | "drop" | "keep";

export interface ScanResult {
  title: string;
  n_items: number;
  n_instruments: number;
  n_gated: number;
  n_implied: number;
  issues: { severity: "error" | "warning" | "info"; code: string; field: string; message: string }[];
  has_data: boolean;
  audit: null | {
    n_rows: number;
    totals: { answered_when_hidden: number; blank_when_shown: number; skipped_by_design: number; invalid_codes: number };
  };
  flags: ScanFlag[];
}

export interface BuildResult {
  files: OutFile[];
  summary: string[];
  dataFile: string;
}

let booting: Promise<PyodideInterface> | null = null;

async function boot(): Promise<PyodideInterface> {
  const { loadPyodide } = await import("pyodide");
  const py = await loadPyodide({ indexURL: new URL("./pyodide/", document.baseURI).href });
  const res = await fetch(new URL("./xml_wizard_py.json", document.baseURI));
  if (!res.ok) throw new Error("The analysis engine is missing from this build.");
  const sources = (await res.json()) as Record<string, string>;
  py.FS.mkdirTree("/app/xml_wizard");
  for (const [name, text] of Object.entries(sources)) py.FS.writeFile("/app/xml_wizard/" + name, text);
  py.runPython("import sys\nsys.path.insert(0, '/app')\nfrom xml_wizard import app_bridge");
  return py;
}

function engine() {
  booting ??= boot().catch((e) => {
    booting = null;
    throw e;
  });
  return booting;
}

const safeName = (name: string, fallback: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || fallback;

function stage(py: PyodideInterface, input: OpenedFile, data: OpenedFile | null) {
  py.runPython("import shutil\nshutil.rmtree('/work', ignore_errors=True)");
  py.FS.mkdirTree("/work/in");
  py.FS.mkdirTree("/work/data");
  const inputPath = "/work/in/" + safeName(input.name, "project.xml");
  py.FS.writeFile(inputPath, input.text);
  let dataPath: string | null = null;
  if (data) {
    dataPath = "/work/data/" + safeName(data.name, "data.csv");
    py.FS.writeFile(dataPath, data.text);
  }
  return { inputPath, dataPath };
}

/** The last line of a Python traceback is the message meant for people. */
function friendly(e: unknown): Error {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.trim().split("\n");
  const last = lines[lines.length - 1] || text;
  return new Error(last.replace(/^[\w.]*(Error|Exception):\s*/, ""));
}

async function call<T>(fn: "scan" | "build", args: Record<string, unknown>): Promise<T> {
  const py = await engine();
  py.globals.set("_xmlw_args", JSON.stringify(args));
  try {
    const out = py.runPython(`import json\njson.dumps(app_bridge.${fn}(**json.loads(_xmlw_args)))`) as string;
    return JSON.parse(out) as T;
  } catch (e) {
    throw friendly(e);
  }
}

export async function scanProject(input: OpenedFile, data: OpenedFile | null): Promise<ScanResult> {
  const py = await engine();
  const { inputPath, dataPath } = stage(py, input, data);
  return call<ScanResult>("scan", { input_path: inputPath, data_path: dataPath });
}

export async function buildBundle(
  input: OpenedFile, data: OpenedFile | null, decisions: Record<string, Action>, includeData: boolean,
): Promise<BuildResult> {
  const py = await engine();
  const { inputPath, dataPath } = stage(py, input, data);
  const result = await call<{ files: string[]; summary: string[]; data_file: string }>("build", {
    input_path: inputPath, out_dir: "/work/out", data_path: dataPath, decisions, include_data: includeData,
  });
  const files = result.files.map((path) => ({ path, contents: py.FS.readFile("/work/out/" + path, { encoding: "utf8" }) as string }));
  py.runPython("shutil.rmtree('/work', ignore_errors=True)");
  return { files, summary: result.summary, dataFile: result.data_file };
}
