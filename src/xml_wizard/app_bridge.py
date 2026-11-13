"""The two calls the desktop app makes into this package.

The app (``desktop/``) runs this same Python package inside the window, on the
person's computer, so the privacy check and the agent bundle are exactly what
the command line produces. ``scan`` reports what was found and which variables
look sensitive; ``build`` writes the outputs once the person has chosen what to
mask, drop or keep. Both return plain dictionaries that convert to JSON.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from . import privacy
from .agent_bundle import write_bundle
from .analysis import analyse
from .codebook import build_codebook
from .readers import load_project
from .viewer import write_viewer

VIEWER_NAME = "survey_tree.html"
BUNDLE_DIR = "agent_bundle"


def scan(input_path: str, data_path: Optional[str] = None) -> Dict[str, Any]:
    """Check a project (and its data, if any) and list variables that may identify people."""
    project = load_project(input_path, data_path)
    analysis = analyse(project)
    plan = privacy.review(project, "suggested")
    flags: List[Dict[str, Any]] = []
    for f in plan.flags:
        fld = project.fields[f.field]
        flags.append({
            "field": f.field, "label": fld.label, "type": fld.field_type, "level": f.level,
            "reasons": list(f.reasons), "suggested": f.suggested, "group": f.group,
            "used_in_logic_of": list(f.used_in_logic_of),
        })
    audit = None
    if analysis.audit:
        audit = {"n_rows": analysis.audit["n_rows"], "totals": analysis.audit["totals"]}
    return {
        "title": project.title,
        "n_items": sum(1 for f in project.fields.values() if not f.is_form_status),
        "n_instruments": len(project.instruments),
        "n_gated": len(analysis.gated_fields),
        "n_implied": len(analysis.implied_values),
        "issues": [i.to_dict() for i in analysis.issues],
        "has_data": bool(project.data_rows),
        "audit": audit,
        "flags": flags,
    }


def build(input_path: str, out_dir: str, data_path: Optional[str] = None,
          decisions: Optional[Dict[str, str]] = None, data_stem: str = "",
          include_data: bool = True) -> Dict[str, Any]:
    """Write the tree viewer, the redaction decisions and the agent bundle into ``out_dir``.

    ``decisions`` maps variable names to mask, drop or keep; flagged variables
    that are not listed get their suggested action.
    """
    project = load_project(input_path, data_path)
    analysis = analyse(project)
    for name, act in (decisions or {}).items():
        if name not in project.fields:
            raise ValueError(f"no variable called '{name}'")
        if act not in privacy.ACTIONS:
            raise ValueError(f"unknown action '{act}' for {name}")
    plan = privacy.review(project, "suggested", "", dict(decisions or {}))
    os.makedirs(out_dir, exist_ok=True)
    privacy.save_decisions(os.path.join(out_dir, privacy.DECISIONS_FILE), plan)
    codebook = build_codebook(analysis, plan)
    write_viewer(codebook, os.path.join(out_dir, VIEWER_NAME))
    data_name = ""
    if project.data_rows and include_data:
        stem = data_stem or os.path.splitext(os.path.basename(data_path or input_path))[0]
        data_name = f"data/{stem}_redacted.csv"
    write_bundle(analysis, codebook, os.path.join(out_dir, BUNDLE_DIR), VIEWER_NAME, plan, data_name)
    files = []
    for root, _dirs, names in os.walk(out_dir):
        for name in names:
            files.append(os.path.relpath(os.path.join(root, name), out_dir).replace(os.sep, "/"))
    return {
        "files": sorted(files),
        "summary": privacy.summary_lines(project, plan),
        "data_file": f"{BUNDLE_DIR}/{data_name}" if data_name else "",
    }
