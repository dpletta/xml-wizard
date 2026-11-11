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

**Privacy.** Whatever an agent reads goes to its model provider, so redaction happens before the
bundle is written. A rule-based detector (`privacy.py`) flags likely identifiers from REDCap's
Identifier flag, validation types, field types, variable names and labels (HIPAA Safe Harbor list), and,
when data is supplied, the shape of free-text values (counts only). The researcher chooses mask, drop or
keep for each; choices are saved and reused. The bundle then holds metadata, aggregate counts and, only
if data was supplied, a redacted copy of it. The generated scripts carry the same redaction list, so their
row-level outputs are redacted too.

Why rules and not a model: the decision is per variable, and REDCap metadata already says most of what
matters (Identifier flag, `email`/`phone`/`date` validation, labels like "First name"). Rules are
transparent ("flagged because: date of birth"), deterministic, instant, and keep the tool dependency-free.
A local NER model (for example spaCy or Presidio) would add hundreds of megabytes and an install step
for little gain at the column level; it would matter for scrubbing names *inside* free-text answers,
which is a possible later, optional extra. Masking long free text by default covers that case for now.

## Possible next steps

- Publish to PyPI (`pip install redcap-xml-wizard`) and add a drag-and-drop web version of the viewer
  that runs entirely in the browser for people who do not use Python.
- Read REDCap API exports directly (token kept local).
- Cross-event logic evaluation for longitudinal projects by pivoting records across events.
- Export the tree as SVG/PDF for protocol documents and IRB submissions.
