"""Build the machine-readable codebook (codebook.json).

The same structure is embedded in the HTML viewer, so what a researcher sees
and what a coding agent reads always agree.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Dict, List, Optional

from . import __version__
from .analysis import Analysis
from .privacy import MASK_TOKEN, RedactionPlan

SCHEMA_VERSION = "1.1"

CONVENTIONS = {
    "values": "All values are raw REDCap codes as exported with 'CSV (raw data)', never labels.",
    "checkbox_columns": "A checkbox item 'x' with options 1, 2 is exported as columns x___1, x___2 "
                        "holding '1' (checked) or '0' (unchecked). For checkbox items 'blank' means no option checked.",
    "branching_logic": "An item with branching_logic is only shown (and only answerable) when the logic is true. "
                       "When hidden, REDCap leaves it blank: that blank is a legitimate skip, not missing data.",
    "skip_status": {
        "shown_answered": "Logic true and the item has a value.",
        "shown_missing": "Logic true but the item is blank: real item non-response.",
        "skipped": "Logic false and the item is blank: skipped by design (legitimate skip).",
        "skipped_but_answered": "Logic false but the item has a value: a data problem to review "
                                "(logic changed mid-study, data imported, or entered on a data-entry form).",
        "unknown": "Logic could not be evaluated automatically (cross-event reference, smart variable, "
                   "or unsupported function); review by hand.",
    },
    "implied_values": "Suggested logical fills for skipped items (e.g. never homeless implies not homeless in "
                      "the past 6 months). They are suggestions with confirmed=false and must be confirmed by "
                      "the study team before being applied.",
    "redaction": f"Variables with redaction 'mask' hold {MASK_TOKEN} instead of the answer in any data prepared "
                 "for you (blank stays blank, so answered vs skipped is still visible). Variables with "
                 "redaction 'drop' are removed. Do not try to recover redacted values.",
}


def build_codebook(analysis: Analysis, plan: Optional[RedactionPlan] = None) -> Dict[str, Any]:
    project = analysis.project
    plan = plan or RedactionPlan()
    audit_fields = (analysis.audit or {}).get("fields", {})
    fields: List[Dict[str, Any]] = []
    for fld in project.ordered_fields():
        info = analysis.fields[fld.name]
        entry: Dict[str, Any] = {
            "name": fld.name,
            "instrument": fld.form,
            "order": fld.order,
            "type": fld.field_type,
            "label": fld.label,
            "section_header": fld.section_header or None,
            "field_note": fld.field_note or None,
            "choices": [{"code": c, "label": lab} for c, lab in fld.choices] or None,
            "columns": fld.columns,
            "validation": ({"type": fld.validation or None, "min": fld.validation_min or None,
                            "max": fld.validation_max or None}
                           if (fld.validation or fld.validation_min or fld.validation_max) else None),
            "required": fld.required,
            "identifier": fld.identifier,
            "sensitive": ({"level": fl.level, "reasons": fl.reasons}
                          if (fl := plan.flag(fld.name)) else None),
            "redaction": (plan.action(fld.name) if plan.action(fld.name) != "keep" else None),
            "form_status": fld.is_form_status,
            "matrix_group": fld.matrix_group or None,
            "annotation": fld.annotation or None,
            "calculation": ({"raw": fld.calculation, "uses": info.calc_refs} if fld.calculation else None),
            "branching_logic": None,
            "dependents": info.dependents,
            "display": {"tree_parent": info.tree_parent, "condition": info.condition_chip or None},
            "issues": [i.to_dict() for i in analysis.issues_for(fld.name)],
        }
        if fld.branching_logic:
            entry["branching_logic"] = {
                "raw": fld.branching_logic,
                "text": info.logic_text,
                "parents": info.parents,
                "ast": fld.logic_ast,
                "python": info.python,
                "r": info.r,
                "auto_evaluable": fld.logic_ast is not None and info.python is not None,
                "unsupported": info.unsupported or None,
                "parse_error": fld.logic_error or None,
            }
        if fld.name in audit_fields:
            entry["data_summary"] = audit_fields[fld.name]
        fields.append(entry)

    return {
        "schema": "xml-wizard/codebook",
        "schema_version": SCHEMA_VERSION,
        "generated_by": f"xml-wizard {__version__}",
        "generated_at": _dt.datetime.now().replace(microsecond=0).isoformat(),
        "project": {
            "title": project.title,
            "source_file": project.source_file,
            "source_format": project.source_format,
            "record_id_field": project.record_id_field,
            "longitudinal": project.longitudinal,
            "instruments": [{"name": i.name, "label": i.label, "repeating": i.repeating, "fields": i.fields}
                            for i in project.instruments],
            "events": [{"unique_name": e.unique_name, "label": e.label, "arm": e.arm, "instruments": e.forms,
                        "repeating_instruments": e.repeating_forms} for e in project.events],
            "counts": {
                "instruments": len(project.instruments),
                "items": sum(1 for f in project.fields.values() if not f.is_form_status),
                "items_with_branching_logic": len(analysis.gated_fields),
                "issues": {s: sum(1 for i in analysis.issues if i.severity == s)
                           for s in ("error", "warning", "info")},
            },
        },
        "conventions": CONVENTIONS,
        "redaction": {
            "masked": [n for n, a in plan.redacted().items() if a == "mask"],
            "dropped": [n for n, a in plan.redacted().items() if a == "drop"],
            "flagged_but_kept": [f.field for f in plan.flags if plan.action(f.field) == "keep"],
            "mask_token": MASK_TOKEN,
        },
        "fields": fields,
        "issues": [i.to_dict() for i in analysis.issues],
        "implied_values": analysis.implied_values,
        "data_audit": ({"n_rows": analysis.audit["n_rows"], "totals": analysis.audit["totals"],
                        "note": "Aggregate counts only; no participant-level values are stored here."}
                       if analysis.audit else None),
    }
