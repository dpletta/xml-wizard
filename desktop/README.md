# XML Wizard desktop app

The downloadable app: map an existing REDCap project, design a new one, and export an agent bundle.
People who only want to use it should download an installer from the
[releases page](https://github.com/dpletta/xml-wizard/releases); this page is for building it.

## Layout

| Path | What it is |
|---|---|
| `src/` | The interface: React, React Flow (canvas), Tailwind, Radix components in `src/components/ui/` |
| `src/lib/core.ts` | Typed door to `../src/xml_wizard/designer_app/core.js`, the engine shared with the single-file designer |
| `src/lib/python.ts` | Runs the `xml_wizard` Python package in the window (Pyodide) for the privacy check and agent bundle |
| `src/lib/platform.ts` | Opening and saving files: native dialogs in the app, file input and downloads in a browser |
| `src-tauri/` | The desktop shell (Rust, Tauri 2): window, dialogs, three file commands, icons |
| `scripts/prepare-assets.mjs` | Copies the Python runtime, the Python package and the examples into `public/` before each build |

## Build and run

You need Node.js 20 or newer and [Rust](https://rustup.rs). On Linux also install the
[Tauri system libraries](https://tauri.app/start/prerequisites/#linux).

```bash
cd desktop
npm install
npm run tauri dev      # run the app with live reload
npm run tauri build    # build the installer for this computer (in src-tauri/target/release/bundle/)
```

`npm run dev` runs the same interface in a browser at http://localhost:1420, which is the quickest way
to work on it. `npm run build` type-checks and builds the web files only.

Tests: `cargo test` in `src-tauri/` covers the file commands; `python -m unittest discover -s tests`
at the repository root covers the engine, the Python bridge (`app_bridge.py`) and the checks that the
version numbers and the content security policy stay in step.

## Releasing

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
   `src/xml_wizard/__init__.py` (a test fails if they differ).
2. Push a tag such as `v0.3.0-alpha`, or run the **desktop app** workflow by hand from the Actions tab.
3. The workflow builds the macOS .dmg, Windows installers and Linux packages and attaches them to a
   draft release. Check it under Releases and press **Publish**.

The builds are not signed with a paid certificate. To remove the first-launch warning on macOS, add an
Apple Developer ID certificate and notarization credentials as repository secrets
(see the [Tauri signing guide](https://tauri.app/distribute/sign/macos/)) and delete
`"signingIdentity": "-"` from `tauri.conf.json`.
