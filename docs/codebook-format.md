# `codebook.json` format (schema `xml-wizard/codebook`, version 1.1)

Top level:

| Key | Type | Description |
|---|---|---|
| `schema`, `schema_version` | string | `"xml-wizard/codebook"`, `"1.1"` |
| `generated_by`, `generated_at` | string | Tool version and local timestamp |
| `project` | object | Title, source file and format, `record_id_field`, `longitudinal`, `instruments[]`, `events[]`, `counts` |
| `conventions` | object | How values, checkbox columns, skip statuses and implied values are defined |
| `redaction` | object | `{masked[], dropped[], flagged_but_kept[], mask_token}`: the privacy choices made before the bundle was written (added in 1.1) |
| `fields` | array | One entry per item, in survey order (below) |
| `issues` | array | `{severity, code, field, message}`; severity is `error`, `warning` or `info` |
| `implied_values` | array | `{field, implied_value, when_field, when_value, confirmed, rationale}` |
| `data_audit` | object or null | `{n_rows, totals, note}` when data was supplied; aggregate counts only |

Each `fields[]` entry:

| Key | Description |
|---|---|
| `name`, `instrument`, `order`, `type` | REDCap variable name, instrument, position, field type (`text`, `radio`, `dropdown`, `checkbox`, `yesno`, `truefalse`, `calc`, `notes`, `descriptive`, `slider`, `file`, …) |
| `label`, `section_header`, `field_note` | Text with HTML removed |
| `choices` | `[{code, label}]` or null |
| `columns` | Column names in a raw CSV export (`x___1`, `x___2` for checkboxes) |
| `validation` | `{type, min, max}` or null |
| `required`, `identifier`, `form_status` | Booleans (`identifier` marks PHI; `form_status` marks `<instrument>_complete`) |
| `sensitive` | null, or `{level, reasons[]}` when the privacy check flagged the item; `level` is `high`, `medium` or `low` (1.1) |
| `redaction` | null, `"mask"` (answers replaced by `[REDACTED]` in data prepared for the agent) or `"drop"` (column removed) (1.1) |
| `annotation`, `matrix_group` | Action tags / annotation and matrix group |
| `calculation` | `{raw, uses[]}` for calculated fields |
| `branching_logic` | null, or `{raw, text, parents[], ast, python, r, auto_evaluable, unsupported, parse_error}` |
| `dependents` | Items whose logic refers to this one |
| `display` | `{tree_parent, condition}` used by the viewer |
| `issues` | Problems for this item |
| `data_summary` | Per-item counts when data was supplied |

`branching_logic.ast` nodes:

```text
{"type": "ref",   "field": "x", "code": "1"|null, "event": "e"|null}
{"type": "smart", "name": "current-instance"}
{"type": "lit",   "value": "1", "kind": "str"|"num"|"bool"}
{"type": "cmp",   "op": "="|"<>"|"<"|">"|"<="|">=", "left": node, "right": node}
{"type": "bool",  "op": "and"|"or", "args": [node, ...]}
{"type": "not",   "arg": node}
{"type": "arith", "op": "+"|"-"|"*"|"/"|"^", "left": node, "right": node}
{"type": "neg",   "arg": node}
{"type": "call",  "name": "sum", "args": [node, ...]}
```

`branching_logic.python` is an expression over a dict `r` of raw string values using the `rc_*`
helpers defined at the top of `cleaning/apply_skip_logic.py`; `branching_logic.r` is the equivalent R
expression using the helpers in `cleaning/apply_skip_logic.R`. Both return TRUE/FALSE, or None/NULL when
the result cannot be determined.
