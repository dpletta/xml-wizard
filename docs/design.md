# Design notes

## Goals

1. Let a researcher check the structure and skip logic of a REDCap instrument in minutes.
2. Produce a file a coding agent can rely on for cleaning, corrective coding of skipped items, and
   first analyses.
3. Be easy to adopt widely: no server, no account, no internet, nothing beyond Python, and safe to
   use with protected health information.

## Decisions

**Python, standard library only.** Python is already installed in most research settings, a
single `pip install` works on Windows, macOS and Linux, and having no dependencies avoids version
conflicts and IT-approval friction. The generated cleaning scripts follow the same rule (Python
stdlib, base R) so they run anywhere the data is.

**Inputs.** REDCap's CDISC ODM XML is the primary input because it carries the full project:
instruments, events, repeating instruments, and optionally data. The Data Dictionary CSV is also
accepted because many teams already have one. Both produce the same internal model (a test checks
this).

**A real parser for branching logic.** Logic is tokenised and parsed into a syntax tree rather than
matched with regular expressions. This lets the tool render logic in plain English, check every field
and code reference, evaluate it against data with REDCap's comparison rules (numeric when both sides
are numbers, blanks never satisfy `<`/`>`), and translate it into Python and R. Features that cannot be
evaluated from a single row (cross-event references, smart variables) evaluate to "unknown" instead of
guessing.

**The viewer is a single static HTML file.** The codebook JSON is embedded in the page and rendered
with plain SVG and JavaScript, no CDN or network calls, so it opens offline, can be emailed or put on a
shared drive, and cannot leak data. Instruments are laid out as columns; within an instrument, items
form a file-tree where each gated item sits under the nearest earlier item it depends on. Other
dependencies are drawn as arrows when an item is selected.

**Agent bundle format.** Coding agents read instructions from the repository: Codex and Cursor read
`AGENTS.md`, Claude Code reads `CLAUDE.md` (which here imports `AGENTS.md`). So the bundle is a folder of
plain files rather than a new file type:

- `AGENTS.md`: the human-readable contract (ground rules, survey map, problems, suggestions).
- `codebook.json`: precise structure for programmatic use, with a versioned schema.
- `skip_logic.csv` / `implied_values.csv`: tables a researcher can open in Excel and edit.
- Generated scripts: a deterministic, reviewable first step, so the agent does not re-implement
  skip logic (and get it subtly wrong) in every session.

**Humans confirm imputations.** Logical fills change data, so they are generated as suggestions with
`confirmed = FALSE`. Scripts apply only confirmed rules and log each filled value. Answers recorded for
hidden items are reported, never silently deleted.

**Privacy.** The bundle contains metadata and aggregate counts only. Row-level outputs
(`skip_logic_problems.csv`, cleaned data) are written next to the user's data by the scripts they run
locally.

## Possible next steps

- Publish to PyPI (`pip install redcap-xml-wizard`) and add a drag-and-drop web version of the viewer
  that runs entirely in the browser for people who do not use Python.
- Read REDCap API exports directly (token kept local).
- Cross-event logic evaluation for longitudinal projects by pivoting records across events.
- Export the tree as SVG/PDF for protocol documents and IRB submissions.
