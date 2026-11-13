// Copies what the app needs at run time into public/, so the built app is
// complete on its own and never fetches anything from the internet:
//   public/pyodide/     the Python runtime (WebAssembly) used for the agent bundle
//   public/xml_wizard_py.json   the xml_wizard Python package, as {path: source}
//   public/examples/    the practice projects from the repository
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repo = path.resolve(desktop, "..");
const pub = path.join(desktop, "public");

const pyodideSrc = path.join(desktop, "node_modules", "pyodide");
const pyodideOut = path.join(pub, "pyodide");
fs.mkdirSync(pyodideOut, { recursive: true });
for (const name of ["pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  const from = path.join(pyodideSrc, name);
  if (!fs.existsSync(from)) throw new Error(`pyodide file missing: ${name} (run npm install)`);
  fs.copyFileSync(from, path.join(pyodideOut, name));
}

const pkgDir = path.join(repo, "src", "xml_wizard");
const sources = {};
for (const name of fs.readdirSync(pkgDir).sort()) {
  if (/\.(py|R|html)$/.test(name)) sources[name] = fs.readFileSync(path.join(pkgDir, name), "utf8");
}
fs.writeFileSync(path.join(pub, "xml_wizard_py.json"), JSON.stringify(sources));

const exOut = path.join(pub, "examples");
fs.mkdirSync(exOut, { recursive: true });
const ex = path.join(repo, "examples", "practice_data");
for (const [from, to] of [
  ["housing_survey/housing_survey_odm.xml", "housing_survey_odm.xml"],
  ["housing_survey/housing_survey_data.csv", "housing_survey_data.csv"],
  ["most_data/most_practice_metadata.xml", "most_practice_metadata.xml"],
]) {
  fs.copyFileSync(path.join(ex, from), path.join(exOut, to));
}
console.log(`prepared: pyodide runtime, ${Object.keys(sources).length} package files, examples`);
