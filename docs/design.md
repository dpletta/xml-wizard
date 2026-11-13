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

## The designer (REDCap in both directions)

`xml-wizard design` writes one offline HTML file: a canvas where instruments are columns and questions
are cards. People drag question types in, drag an answer onto another question to create branching,
preview the survey, and download REDCap project XML or a data dictionary CSV. It opens either file
again, so a project can go REDCap, designer, REDCap.

**Where the code lives.** `src/xml_wizard/designer_app/` holds `core.js` (model, import, export, logic;
no DOM, so it runs in Node for tests), `app.js` (canvas, inspector, preview), `app.css` and `index.html`.
`designer.py` inlines them into one page. `docs/designer.html` is a built copy for people without
Python; a test fails if it is stale (`xml-wizard design -o docs/designer.html` rebuilds it).

**Why JavaScript here.** The designer has to run where the researcher is, with no server and no
install, including on a phone. A single HTML file does that. The core is still dependency-free, and a
Python test feeds the designer's exports back through the Python reader to keep the two in agreement.

**The logic text is the source of truth.** Each question stores its branching logic as the REDCap
string. The dropdown editor is a view of that string, available when the logic is a flat list of
comparisons joined by all-and or all-or. Anything else (functions, mixed and/or, cross-event
references) is shown and edited as REDCap logic and is never rewritten, so opening and saving a
project cannot change logic the editor does not understand.

**Round trip fidelity.** On import the designer keeps what it does not model: project settings in
`GlobalVariables`, the `Protocol` and `StudyEventDef` elements (events, arms, day offsets), repeating
instruments, and any `redcap:` attribute on a field it has no control for (alignment, matrix group,
and so on). They are written back unchanged, minus references to instruments that were deleted.
Form status fields are regenerated the way REDCap does. `<ClinicalData>` is never read into the
design or exported, and `xml-wizard design INPUT` strips it before embedding the project in the page.

**Record ID.** REDCap treats the first field as the record ID, so the designer pins that card to the
top of the first instrument.

**Not yet covered.** Slider labels and matrix groups can be carried through but not created; survey
settings (titles, instructions, queue) and assigning new instruments to events are done in REDCap
after import. The export mirrors REDCap's own project XML and is checked against real exports, but it
has not been tested against every REDCap version.

## Possible next steps

- Publish to PyPI (`pip install redcap-xml-wizard`), and host `docs/designer.html` with GitHub Pages
  so researchers can use the designer from a link.
- Show the designer's canvas and the tree viewer in one app, with the logic checks and data audit
  running in the browser.
- Read REDCap API exports directly (token kept local).
- Cross-event logic evaluation for longitudinal projects by pivoting records across events.
- Export the tree as SVG/PDF for protocol documents and IRB submissions.
