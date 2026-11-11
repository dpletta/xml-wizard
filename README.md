# XML Wizard for REDCap

See the structure and branching (skip) logic of a REDCap survey at a glance,
catch logic mistakes before they cost you data, and hand your coding agent
(Claude Code, Codex, Cursor, …) everything it needs to clean and analyse the
data correctly.

```text
xml-wizard my_project.xml
```

produces

| Output | For | What it is |
|---|---|---|
| `survey_tree.html` | People | A zoomable, pannable tree of every instrument and item. Each item that has branching logic is nested under the item that controls it, with a tag saying when it appears ("if Yes"). Click any item for its full logic in plain English, answer codes, and problems. One file that works offline in any browser. |
| `agent_bundle/` | Coding agents | `AGENTS.md` (+ `CLAUDE.md`) primer, `codebook.json`, `skip_logic.csv`, `implied_values.csv`, and ready-to-run Python and R scripts that separate legitimate skips from real missing data. |

Everything runs on your computer. Nothing is uploaded, and the bundle contains
metadata and aggregate counts only, never participant-level values.

## Install

Requires Python 3.8 or newer. There are no other dependencies.

```bash
pip install git+https://github.com/dpletta/xml-wizard
```

(`pipx install git+https://github.com/dpletta/xml-wizard` also works and keeps it isolated.)

## Use

1. In REDCap, export your project:
   - **Project XML** (recommended): *Other Functionality → Copy or back up the project → Download metadata only (XML)*,
     or *Data Exports → Other Export Options → CDISC ODM (XML)* to include data, or
   - **Data Dictionary CSV**: *Project Setup → Data Dictionary → Download the current Data Dictionary*.
2. Run:

   ```bash
   xml-wizard my_project.xml --open
   ```

   Add `--data export.csv` (a *CSV / Microsoft Excel (raw data)* export) to also check your data
   against the logic. If your XML export already includes data, this happens automatically.
3. Open `my_project_xml_wizard/survey_tree.html` (or let `--open` do it).

Other options: `-o FOLDER` to choose where outputs go, `--check` to only print problems (exits
with code 1 when there are errors, handy in a pipeline), `--no-data-audit` to ignore data in the XML.

Try it on the included synthetic example:

```bash
xml-wizard examples/practice_data/housing_survey/housing_survey_odm.xml --open
```

## What it checks

Branching logic problems REDCap does not warn you about:

| Problem | Example |
|---|---|
| Answer code that does not exist | `[evicted_ever] = '2'` on a Yes/No item (coded 1/0), so the item never shows |
| Reference to a field that does not exist | `[alc_evr] = '1'` (typo), so the item never shows |
| Checkbox referenced without an option, or with an option that does not exist | `[race] = '1'`, `[race(7)] = '1'` |
| Forward reference | An item depends on a question asked *later*, so respondents have not answered it yet |
| Self reference, references to descriptive text, unknown events, unreadable logic | |

With data supplied, it also counts, per item: answers recorded although the item should have
been hidden, blanks in items that were shown (true non-response), blanks that are skips by
design, and values that are not valid answer codes.

## The agent bundle

Point your agent at the folder (or copy it into your analysis project) and ask, for example:

> Read `agent_bundle/AGENTS.md`. Run the skip-logic script on `data/export.csv`, summarise the
> problems by item, and propose implied-value rules for the housing section without applying them.

Contents:

- **`AGENTS.md`**: a project-specific primer: ground rules (never edit raw data, blanks after a skip are
  not missing, confirm before imputing, keep data local), a survey map with every skip pattern written
  out, problems found, data-check summary, suggested logical fills, and analysis starting points.
  `CLAUDE.md` simply imports it, so Claude Code, Codex and Cursor all pick it up.
- **`codebook.json`**: every item with labels, answer codes, export columns, validation, and its branching
  logic as raw text, plain English, a parsed syntax tree, and equivalent Python and R expressions.
  See [docs/codebook-format.md](docs/codebook-format.md).
- **`cleaning/apply_skip_logic.py`** and **`.R`**: no-dependency scripts that read your raw export and write a
  cleaned copy with a `<field>__skip` status column (`shown_answered`, `shown_missing`, `skipped`,
  `skipped_filled`, `skipped_but_answered`, `unknown`), a per-item report, and a list of rows to review.
  The Python and R versions produce identical output.
- **`implied_values.csv`**: suggested logical fills ("corrective coding") for skipped items, for example
  *never homeless ⇒ not homeless in the past 6 months* or *0 drinking days ⇒ binge drinking "Never"*.
  Every rule starts as `confirmed = FALSE`; the scripts only apply rules a person has set to `TRUE`, and
  log every value they fill.

Why this format: agents work best from plain files in the project folder. `AGENTS.md` is the convention
Codex and Cursor read automatically and Claude Code reads through `CLAUDE.md`; the JSON gives exact,
machine-checkable structure; and runnable scripts mean the agent's first step is deterministic and
reviewable rather than re-deriving skip logic from scratch. More in [docs/design.md](docs/design.md).

## Limitations

- Logic that depends on other events (`[baseline_arm_1][smoker]`), smart variables (`[current-instance]`)
  or unusual functions is shown and parsed, but marked `unknown` in the data check and listed in
  `AGENTS.md` for manual handling.
- Implied values are suggestions based on answer labels such as "No", "Never" and "None" and on count
  questions; they need a researcher's judgement before use.
- REDCap's form-level "survey queue" and "stop actions" are not modelled.

## Develop

```bash
pip install -e .
python -m unittest discover -s tests
python examples/build_example.py   # regenerate the synthetic example
```

MIT licensed. Contributions and real-world test cases (with no participant data) are welcome.
