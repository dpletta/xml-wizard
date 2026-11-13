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

Tests: `npm test` (Node.js 22.15+ for TypeScript and module hooks) covers canvas containment, branching anchors, section moves, compact accordion spacing, grouped arrows, and shared project state when switching views. `cargo test` in `src-tauri/` covers the file commands; `python -m unittest discover -s tests`
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

## Reading the flow map

The canvas shows green instruments containing purple sections, orange question cards,
and individual response options. Questions keep their branching-based indentation.
Questions before the first section heading appear in a display-only “General” section;
this does not add a heading to your exported REDCap file.

All branching references are visible: blue brackets within a section, purple brackets
between sections of the same instrument, and blue Sankey-style curves between instruments.
Arrows point to the question whose visibility depends on the source. Curves have equal
widths; they show dependencies, not respondent counts. Select a question, section, or
instrument to emphasize its connections. Full conditions remain on question cards and
in the inspector; response anchors also represent negative comparisons when present.

In Design mode, drag a response option onto a question to add a condition. Dragging a
section by its header moves its questions together. REDCap branching conditions remain
attached to questions; the containers show the section and instrument boundaries they cross.
