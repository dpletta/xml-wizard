"""Command line interface: ``xml-wizard PROJECT.xml``."""

from __future__ import annotations

import argparse
import os
import sys
import webbrowser
from typing import List, Optional

from . import __version__
from .agent_bundle import write_bundle
from .analysis import analyse
from .codebook import build_codebook
from .readers import InputError, load_project
from .viewer import write_viewer

DESCRIPTION = """\
Visualise the items and branching logic of a REDCap project and export an
agent-ready codebook for data cleaning.

INPUT is a REDCap CDISC ODM XML export (metadata only, or with data) or a
REDCap Data Dictionary CSV. Everything runs locally; nothing is uploaded.
"""


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="xml-wizard", description=DESCRIPTION,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="REDCap ODM XML file or Data Dictionary CSV")
    ap.add_argument("-d", "--data", help="optional raw data export CSV to check against the logic")
    ap.add_argument("-o", "--out", help="output folder (default: <input name>_xml_wizard next to the input)")
    ap.add_argument("--check", action="store_true",
                    help="only print problems found in the branching logic (exit code 1 if any errors)")
    ap.add_argument("--no-data-audit", action="store_true",
                    help="ignore data embedded in the XML file")
    ap.add_argument("--open", action="store_true", help="open the tree viewer in a web browser when done")
    ap.add_argument("--version", action="version", version=f"xml-wizard {__version__}")
    args = ap.parse_args(argv)

    try:
        project = load_project(args.input, args.data)
    except (InputError, OSError) as exc:
        print(f"xml-wizard: {exc}", file=sys.stderr)
        return 2
    if args.no_data_audit:
        project.data_rows = None
    analysis = analyse(project)
    errors = [i for i in analysis.issues if i.severity == "error"]
    warnings = [i for i in analysis.issues if i.severity == "warning"]

    n_items = sum(1 for f in project.fields.values() if not f.is_form_status)
    print(f"{project.title}: {n_items} items in {len(project.instruments)} instruments, "
          f"{len(analysis.gated_fields)} with branching logic.")
    if analysis.issues:
        print(f"Branching logic check: {len(errors)} error(s), {len(warnings)} warning(s).")
        for i in analysis.issues:
            if i.severity != "info" or args.check:
                print(f"  [{i.severity}] {i.field}: {i.message}")
    else:
        print("Branching logic check: no problems found.")
    if analysis.audit:
        t = analysis.audit["totals"]
        print(f"Data check ({analysis.audit['n_rows']} rows): {t['answered_when_hidden']} answered while hidden, "
              f"{t['blank_when_shown']} blank while shown, {t['invalid_codes']} invalid codes.")
    if args.check:
        return 1 if errors else 0

    stem = os.path.splitext(os.path.basename(args.input))[0]
    out_dir = args.out or os.path.join(os.path.dirname(os.path.abspath(args.input)), stem + "_xml_wizard")
    os.makedirs(out_dir, exist_ok=True)
    codebook = build_codebook(analysis)
    viewer_name = "survey_tree.html"
    viewer_path = write_viewer(codebook, os.path.join(out_dir, viewer_name))
    bundle_dir = os.path.join(out_dir, "agent_bundle")
    write_bundle(analysis, codebook, bundle_dir, viewer_name)
    print(f"\nTree viewer:  {viewer_path}")
    print(f"Agent bundle: {bundle_dir}{os.sep}  (start with AGENTS.md)")
    if args.open:
        webbrowser.open("file://" + os.path.abspath(viewer_path))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
