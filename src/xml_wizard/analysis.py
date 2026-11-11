"""Static checks, dependency tree, implied-value suggestions and data audit."""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional

from . import logic, runtime
from .model import Field, Project

NEGATIVE_LABEL = re.compile(
    r"^\s*(no\b|never\b|none\b|not at all\b|false\b|0\b|zero\b|no,|did not\b|have not\b)", re.I)
COUNT_LABEL = re.compile(r"\b(how many|number of|# of|times|days|nights|weeks|months|years|count)\b", re.I)
NUMERIC_VALIDATION = {"integer", "int", "number", "float", "number_1dp", "number_2dp",
                      "number_3dp", "number_4dp", "number_comma_decimal"}


@dataclass
class Issue:
    severity: str  # error | warning | info
    code: str
    field: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"severity": self.severity, "code": self.code, "field": self.field, "message": self.message}


@dataclass
class FieldAnalysis:
    parents: List[str] = dc_field(default_factory=list)
    tree_parent: Optional[str] = None
    children: List[str] = dc_field(default_factory=list)
    dependents: List[str] = dc_field(default_factory=list)
    logic_text: str = ""
    condition_chip: str = ""
    python: Optional[str] = None
    r: Optional[str] = None
    unsupported: List[str] = dc_field(default_factory=list)
    calc_refs: List[str] = dc_field(default_factory=list)


@dataclass
class Analysis:
    project: Project
    fields: Dict[str, FieldAnalysis]
    issues: List[Issue]
    implied_values: List[Dict[str, Any]]
    audit: Optional[Dict[str, Any]] = None

    def issues_for(self, name: str) -> List[Issue]:
        return [i for i in self.issues if i.field == name]

    @property
    def gated_fields(self) -> List[Field]:
        return [f for f in self.project.ordered_fields() if f.branching_logic]


def analyse(project: Project) -> Analysis:
    fa: Dict[str, FieldAnalysis] = {name: FieldAnalysis() for name in project.fields}
    issues: List[Issue] = []
    event_names = {e.unique_name for e in project.events}

    for fld in project.ordered_fields():
        info = fa[fld.name]
        if fld.calculation:
            try:
                info.calc_refs = logic.referenced_fields(logic.parse(fld.calculation))
                for ref in info.calc_refs:
                    if ref not in project.fields:
                        issues.append(Issue("warning", "calc_unknown_field", fld.name,
                                            f"Calculation uses [{ref}], which is not a field in this project."))
            except logic.LogicSyntaxError:
                pass
        if not fld.branching_logic:
            continue
        try:
            ast = logic.parse(fld.branching_logic)
        except logic.LogicSyntaxError as exc:
            fld.logic_error = str(exc)
            issues.append(Issue("error", "parse_error", fld.name,
                                f"Branching logic could not be read: {exc}. Logic: {fld.branching_logic}"))
            # Still record which fields it mentions so the tree is useful
            info.parents = list(dict.fromkeys(
                m.split("(")[0] for m in re.findall(r"\[([A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?)\]",
                                                     fld.branching_logic)))
            info.parents = [p for p in info.parents if p in project.fields]
            info.logic_text = fld.branching_logic
            continue
        fld.logic_ast = ast
        info.parents = [p for p in logic.referenced_fields(ast)]
        info.logic_text = logic.to_text(ast, project.get)
        info.unsupported = logic.unsupported_features(ast)
        try:
            info.python = logic.to_python(ast)
            info.r = logic.to_r(ast)
        except logic.Unsupported:
            info.python = info.r = None
        if info.unsupported:
            issues.append(Issue("info", "unsupported_feature", fld.name,
                                "Logic uses " + ", ".join(info.unsupported) +
                                "; generated cleaning scripts will mark this item for manual review."))
        issues.extend(_check_refs(project, fld, ast, event_names))

    # Dependents and tree placement
    for fld in project.ordered_fields():
        info = fa[fld.name]
        for p in info.parents:
            if p in fa and fld.name not in fa[p].dependents:
                fa[p].dependents.append(fld.name)
        candidates = [project.fields[p] for p in info.parents
                      if p in project.fields and p != fld.name
                      and project.fields[p].form == fld.form
                      and project.fields[p].order < fld.order]
        if candidates:
            parent = max(candidates, key=lambda f: f.order)
            info.tree_parent = parent.name
            fa[parent.name].children.append(fld.name)
        if fld.branching_logic:
            info.condition_chip = _chip(fld, info, project)

    broken = {i.field for i in issues if i.severity == "error"}
    analysis = Analysis(project, fa, issues, implied_values=_implied_values(project, fa, broken))
    if project.data_rows is not None:
        analysis.audit = audit_data(project, fa)
    return analysis


def _check_refs(project: Project, fld: Field, ast, event_names) -> List[Issue]:
    out: List[Issue] = []
    seen = set()
    for ref in logic.references(ast):
        key = (ref["field"], ref.get("code"), ref.get("event"))
        if key in seen:
            continue
        seen.add(key)
        name = ref["field"]
        target = project.get(name)
        if ref.get("event") and event_names and ref["event"] not in event_names:
            out.append(Issue("warning", "unknown_event", fld.name,
                             f"Logic refers to event '{ref['event']}', which is not defined in this project."))
        if target is None:
            out.append(Issue("error", "unknown_field", fld.name,
                             f"Logic refers to [{name}], which is not a field in this project "
                             "(typo or deleted field?). REDCap will never show this item as intended."))
            continue
        if name == fld.name:
            out.append(Issue("error", "self_reference", fld.name, "Logic refers to the item itself, so it can never be shown."))
        if target.field_type == "descriptive":
            out.append(Issue("warning", "descriptive_reference", fld.name,
                             f"Logic refers to [{name}], a descriptive text item that never holds an answer."))
        if target.field_type == "checkbox" and ref.get("code") is None:
            out.append(Issue("error", "checkbox_without_code", fld.name,
                             f"[{name}] is a checkbox; logic must name an option, e.g. [{name}(1)] = '1'."))
        if ref.get("code") is not None:
            if target.field_type != "checkbox":
                out.append(Issue("error", "code_on_non_checkbox", fld.name,
                                 f"[{name}({ref['code']})] uses checkbox syntax, but {name} is a {target.field_type} item."))
            elif ref["code"] not in target.choice_codes:
                out.append(Issue("error", "unknown_checkbox_code", fld.name,
                                 f"[{name}({ref['code']})] refers to option {ref['code']}, but {name} only has options "
                                 f"{', '.join(target.choice_codes)}."))
        if not ref.get("event") and target.order > fld.order:
            where = "later in the same instrument" if target.form == fld.form else f"in a later instrument ({target.form})"
            out.append(Issue("warning", "forward_reference", fld.name,
                             f"Shown based on [{name}], which is asked {where}. Respondents will not have answered it yet."))
    # Compare categorical fields against codes that exist
    for node in logic.walk(ast):
        if node["type"] != "cmp" or node["op"] not in ("=", "<>"):
            continue
        pair = _ref_lit(node)
        if not pair:
            continue
        ref, value = pair
        target = project.get(ref["field"])
        if target is None or ref.get("code") is not None or target.field_type == "checkbox":
            continue
        if target.is_categorical and value != "" and target.choices and value not in target.choice_codes:
            label_hit = [c for c, lab in target.choices if lab.lower() == value.lower()]
            hint = f" Did you mean '{label_hit[0]}' (the code for \"{value}\")?" if label_hit else ""
            out.append(Issue("error", "invalid_choice_code", fld.name,
                             f"Logic tests [{ref['field']}] {node['op']} '{value}', but {ref['field']} has no answer coded "
                             f"'{value}' (codes: {', '.join(target.choice_codes)}).{hint}"))
    return out


def _ref_lit(node):
    l, r = node["left"], node["right"]
    if l["type"] == "ref" and r["type"] == "lit":
        return l, r["value"]
    if r["type"] == "ref" and l["type"] == "lit":
        return r, l["value"]
    return None


def _cond_chip(ref, op, value, project: Project) -> str:
    parent = project.get(ref["field"])
    if ref.get("code") is not None:
        lab = parent.choice_label(ref["code"]) if parent else None
        checked = (value == "1") == (op == "=")
        return f"{'' if checked else 'not '}{lab or ref['code']}"
    if value == "" and op in ("=", "<>"):
        return "blank" if op == "=" else "answered"
    lab = parent.choice_label(value) if parent and op in ("=", "<>") else None
    word = {"=": "", "<>": "not ", "<": "< ", ">": "> ", "<=": "≤ ", ">=": "≥ "}[op]
    return f"{word}{lab or value}"


def _chip(fld: Field, info: FieldAnalysis, project: Project) -> str:
    """Short label for the tree edge, e.g. 'if Yes' or 'if Yes +1 more'."""
    ast = fld.logic_ast
    if ast is not None:
        conds = logic.simple_conditions(ast)
        if conds:
            mine = [c for c in conds if c[0]["field"] == info.tree_parent]
            if len(mine) == 1:
                extra = len(conds) - 1
                return "if " + _cond_chip(*mine[0], project) + (f" +{extra} more" if extra else "")
        # [x(1)] = '1' or [x(2)] = '1' ... on one checkbox field
        if ast["type"] == "bool" and ast["op"] == "or":
            parts = []
            for a in ast["args"]:
                if (a["type"] == "cmp" and a["op"] == "=" and a["left"]["type"] == "ref"
                        and a["left"].get("code") is not None and a["right"]["type"] == "lit"
                        and a["right"]["value"] == "1" and a["left"]["field"] == info.tree_parent):
                    parts.append(_cond_chip(a["left"], "=", "1", project))
                else:
                    parts = []
                    break
            if parts:
                text = ", ".join(parts)
                return "if any: " + (text if len(text) <= 40 else text[:37] + "…")
    text = info.logic_text
    return "if " + (text if len(text) <= 44 else text[:41] + "…")


# ---------------------------------------------------------------------------
# Implied values ("logical imputation") suggestions
# ---------------------------------------------------------------------------

def _negative_code(fld: Field) -> Optional[str]:
    if not fld.is_categorical or fld.field_type == "checkbox":
        return None
    for code, label in fld.choices:
        if NEGATIVE_LABEL.match(label):
            return code
    return None


def _is_numeric(fld: Field) -> bool:
    return fld.field_type in ("text", "calc", "slider") and (
        fld.validation in NUMERIC_VALIDATION or fld.field_type == "slider")


def _implied_values(project: Project, fa: Dict[str, FieldAnalysis], broken=frozenset()) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for fld in project.ordered_fields():
        if fld.logic_ast is None or fld.is_form_status or fld.name in broken:
            continue
        conds = logic.simple_conditions(fld.logic_ast)
        if not conds:
            continue
        # What value would the hidden item logically take?
        neg = _negative_code(fld)
        if neg is not None:
            implied, why_value = neg, f'"{fld.choice_label(neg)}"'
        elif _is_numeric(fld) and COUNT_LABEL.search(fld.label):
            implied, why_value = "0", "0"
        else:
            continue
        for ref, op, value in conds:
            parent = project.get(ref["field"])
            if parent is None or ref.get("code") is not None:
                continue
            when_value = None
            if op == "=" and parent.is_categorical:
                pneg = _negative_code(parent)
                if pneg is not None and pneg != value:
                    when_value = pneg
            elif op in (">", ">=") and _is_numeric(parent) and runtime.to_number(value) is not None:
                v = runtime.to_number(value)
                if (op == ">" and v >= 0) or (op == ">=" and v > 0):
                    when_value = "0"
            if when_value is None:
                continue
            plabel = parent.choice_label(when_value)
            when_text = f'{parent.name} = "{plabel}" ({when_value})' if plabel else f"{parent.name} = {when_value}"
            out.append({
                "field": fld.name,
                "implied_value": implied,
                "when_field": parent.name,
                "when_value": when_value,
                "confirmed": False,
                "rationale": (f"{fld.name} is only asked when {fa[fld.name].logic_text}. "
                              f"If {when_text}, the item was skipped by design and the answer is "
                              f"probably {why_value}. Confirm with the study team before applying."),
            })
    return out


# ---------------------------------------------------------------------------
# Data audit (aggregate counts only)
# ---------------------------------------------------------------------------

def _answered(fld: Field, row: Dict[str, str]) -> bool:
    if fld.field_type == "checkbox":
        return any(row.get(c, "") == "1" for c in fld.columns)
    return any(row.get(c, "").strip() != "" for c in fld.columns)


def audit_data(project: Project, fa: Dict[str, FieldAnalysis]) -> Dict[str, Any]:
    rows = project.data_rows or []
    event_forms = {e.unique_name: set(e.forms) for e in project.events}
    result: Dict[str, Any] = {"n_rows": len(rows), "fields": {}}
    # instrument -> data fields used to decide "started"
    started_cols: Dict[str, List[Field]] = {}
    for ins in project.instruments:
        started_cols[ins.name] = [project.fields[n] for n in ins.fields
                                  if n in project.fields and project.fields[n].holds_data
                                  and not project.fields[n].is_form_status
                                  and n != project.record_id_field]

    def applies(ins_name: str, row: Dict[str, str]) -> bool:
        ins = project.instrument(ins_name)
        ev = row.get("redcap_event_name", "")
        if ev and event_forms and ins_name not in event_forms.get(ev, {ins_name}):
            return False
        rep = row.get("redcap_repeat_instrument", "")
        if ins is not None and ins.repeating:
            if rep and rep != ins_name:
                return False
        elif rep:
            return False
        return any(_answered(f, row) for f in started_cols.get(ins_name, []))

    totals = {"answered_when_hidden": 0, "blank_when_shown": 0, "skipped_by_design": 0,
              "invalid_codes": 0}
    for fld in project.ordered_fields():
        if not fld.holds_data or fld.is_form_status:
            continue
        stats = {"rows": 0, "answered": 0, "blank": 0, "invalid_codes": 0}
        gated = fld.logic_ast is not None
        if gated:
            stats.update({"shown": 0, "hidden": 0, "unknown": 0, "answered_when_hidden": 0,
                          "blank_when_shown": 0, "skipped_by_design": 0})
        codes = set(fld.choice_codes) if fld.is_categorical and fld.field_type != "checkbox" else None
        for row in rows:
            if not applies(fld.form, row):
                continue
            stats["rows"] += 1
            ans = _answered(fld, row)
            stats["answered" if ans else "blank"] += 1
            if codes and ans and row.get(fld.name, "").strip() not in codes:
                stats["invalid_codes"] += 1
            if gated:
                shown = runtime.to_bool(logic.evaluate(fld.logic_ast, row))
                if shown is None:
                    stats["unknown"] += 1
                elif shown:
                    stats["shown"] += 1
                    if not ans:
                        stats["blank_when_shown"] += 1
                else:
                    stats["hidden"] += 1
                    if ans:
                        stats["answered_when_hidden"] += 1
                    else:
                        stats["skipped_by_design"] += 1
        for k in totals:
            totals[k] += stats.get(k, 0)
        result["fields"][fld.name] = stats
    result["totals"] = totals
    return result
