import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The same policy the desktop shell enforces (src-tauri/tauri.conf.json): the
// page may only load what ships with it, so nothing can be sent anywhere.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

function cspMeta(): Plugin {
  return {
    name: "xmlw-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<!--csp-->", `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    },
  };
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), cspMeta()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@core": path.resolve(import.meta.dirname, "../src/xml_wizard/designer_app/core.js"),
    },
  },
  optimizeDeps: { exclude: ["pyodide"] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [".."] },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
