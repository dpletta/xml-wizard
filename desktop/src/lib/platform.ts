// Opening and saving files. In the desktop app this goes through native dialogs
// and three small Rust commands; in a plain browser (npm run dev, or the web
// build) it falls back to a file input and downloads. Nothing here uses the network.
import { zipSync, strToU8 } from "fflate";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface OpenedFile {
  name: string;
  text: string;
}

export interface OutFile {
  path: string;
  contents: string;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Decode a file the way REDCap users produce them: UTF-8, else Windows-1252. */
export async function readBrowserFile(file: File): Promise<OpenedFile> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf);
  }
  return { name: file.name, text: text.replace(/^﻿/, "") };
}

function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export async function openFile(kind: "project" | "data"): Promise<OpenedFile | null> {
  const extensions = kind === "project" ? ["xml", "csv", "json"] : ["csv"];
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const picked = await open({
      multiple: false,
      directory: false,
      title: kind === "project" ? "Open a REDCap project XML or data dictionary" : "Choose a REDCap data export (CSV, raw)",
      filters: [{ name: kind === "project" ? "REDCap export" : "CSV data", extensions }],
    });
    if (!picked || Array.isArray(picked)) return null;
    const text = await invoke<string>("read_text_file", { path: picked });
    return { name: baseName(picked), text };
  }
  const file = await pickBrowserFile(extensions.map((e) => "." + e).join(","));
  return file ? readBrowserFile(file) : null;
}

function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save one text file. Returns where it went, or null if the person cancelled. */
export async function saveFile(name: string, contents: string, mime: string): Promise<string | null> {
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const ext = name.split(".").pop() || "txt";
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await invoke("write_text_file", { path, contents });
    return path;
  }
  download(name, contents, mime);
  return name;
}

/** Save a folder of files: into a folder the person picks (desktop) or as one zip (browser). */
export async function saveFolder(folderName: string, files: OutFile[]): Promise<string | null> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const parent = await open({ directory: true, multiple: false, title: "Choose where to save the " + folderName + " folder" });
    if (!parent || Array.isArray(parent)) return null;
    const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
    const dir = parent.replace(/[\\/]+$/, "") + sep + folderName;
    await invoke("write_files", { dir, files });
    return dir;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[folderName + "/" + f.path] = strToU8(f.contents);
  download(folderName + ".zip", zipSync(entries) as BlobPart, "application/zip");
  return folderName + ".zip";
}

export async function revealInFolder(path: string) {
  if (!isDesktop) return;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch {
    /* showing the folder is a nicety; the files are saved either way */
  }
}
