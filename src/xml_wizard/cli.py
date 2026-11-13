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
from . import privacy
from .readers import InputError, load_project
from .viewer import write_viewer

DESCRIPTION = """\
Visualise the items and branching logic of a REDCap project and export an
agent-ready codebook for data cleaning.

INPUT is a REDCap CDISC ODM XML export (metadata only, or with data) or a
REDCap Data Dictionary CSV. Everything runs locally; nothing is uploaded.

To build or edit a survey by drag and drop and export it back to REDCap, use
"xml-wizard design [INPUT]" (see "xml-wizard design --help").
"""

DESIGN_DESCRIPTION = """\
Open the drag-and-drop survey designer: one HTML file that runs offline in any
browser. Build instruments, questions and branching logic, preview the survey,
then download REDCap project XML (to create a project) or a data dictionary
CSV (to update one).

With INPUT (a REDCap project XML or Data Dictionary CSV) the designer opens
with that project ready to view and edit. Participant records in the XML are
left out of the HTML file.
"""


def design_main(argv: List[str]) -> int:
    from .designer import write_designer

    ap = argparse.ArgumentParser(prog="xml-wizard design", description=DESIGN_DESCRIPTION,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="optional REDCap project XML or Data Dictionary CSV to open")
    ap.add_argument("-o", "--out", help="where to write the designer (default: <input name>_designer.html "
                                        "next to the input, or xml_wizard_designer.html here)")
    ap.add_argument("--open", action="store_true", help="open the designer in a web browser when done")
    args = ap.parse_args(argv)
    if args.input:
        try:
            load_project(args.input)  # fail early, with a clear message, on files that are not REDCap exports
        except (InputError, OSError) as exc:
            print(f"xml-wizard: {exc}", file=sys.stderr)
            return 2
        stem = os.path.splitext(os.path.basename(args.input))[0]
        default = os.path.join(os.path.dirname(os.path.abspath(args.input)), stem + "_designer.html")
    else:
        default = os.path.abspath("xml_wizard_designer.html")
    out = args.out or default
    try:
        write_designer(out, args.input)
    except OSError as exc:
        print(f"xml-wizard: {exc}", file=sys.stderr)
        return 2
    print(f"Survey designer: {out}")
    print("Open it in any browser. It works offline and nothing is uploaded.")
    if args.open:
        webbrowser.open("file://" + os.path.abspath(out))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if argv and argv[0] == "design":
        return design_main(list(argv[1:]))
    ap = argparse.ArgumentParser(prog="xml-wizard", description=DESCRIPTION,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="REDCap ODM XML file or Data Dictionary CSV")
    ap.add_argument("-d", "--data", help="optional raw data export CSV to check against the logic")
    ap.add_argument("-o", "--out", help="output folder (default: <input name>_xml_wizard next to the input)")
    ap.add_argument("--check", action="store_true",
                    help="only print problems found in the branching logic (exit code 1 if any errors)")
    ap.add_argument("--no-data-audit", action="store_true",
                    help="ignore data embedded in the XML file")
    priv = ap.add_argument_group(
        "privacy", "Before writing anything for the AI agent, xml-wizard flags variables that may hold "
        "identifying data (REDCap Identifier flag, names, contact details, dates of birth, free text) and asks "
        "whether to mask, drop or keep each one. Answers are saved in redaction_decisions.csv in the output "
        "folder and reused next time.")
    priv.add_argument("--redact", choices=("ask", "suggested", "none"), default="ask",
                      help="ask (default; falls back to 'suggested' when not run in a terminal), "
                           "suggested = accept every suggestion without asking, none = redact nothing")
    priv.add_argument("--mask", metavar="FIELDS", default="",
                      help="comma-separated variables to mask, in addition to the review")
    priv.add_argument("--drop", metavar="FIELDS", default="", help="comma-separated variables to drop")
    priv.add_argument("--keep", metavar="FIELDS", default="", help="comma-separated variables to keep unredacted")
    priv.add_argument("--no-data-copy", action="store_true",
                      help="do not write a redacted copy of the data into the agent bundle")
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

    extra = {}
    for opt, act in ((args.mask, "mask"), (args.drop, "drop"), (args.keep, "keep")):
        for name in (n.strip() for n in opt.split(",")):
            if name:
                if name not in project.fields:
                    print(f"xml-wizard: --{act}: no variable called '{name}'", file=sys.stderr)
                    return 2
                extra[name] = act
    mode = args.redact
    if mode == "ask" and not sys.stdin.isatty():
        mode = "suggested"
    decisions_path = os.path.join(out_dir, privacy.DECISIONS_FILE)
    plan = privacy.review(project, mode, decisions_path, extra)
    privacy.save_decisions(decisions_path, plan)
    if args.redact == "ask" and mode == "suggested" and plan.flags:
        print("\nPrivacy check: not running in a terminal, so the suggested redactions were applied.")
    else:
        print("\nRedaction:")
    for line in privacy.summary_lines(project, plan):
        print("  " + line)
    print(f"  Change these in {decisions_path} and run again (or use --mask / --drop / --keep).")

    codebook = build_codebook(analysis, plan)
    viewer_name = "survey_tree.html"
    viewer_path = write_viewer(codebook, os.path.join(out_dir, viewer_name))
    bundle_dir = os.path.join(out_dir, "agent_bundle")
    data_name = ""
    if project.data_rows and not args.no_data_copy:
        data_stem = os.path.splitext(os.path.basename(args.data))[0] if args.data else stem
        data_name = f"data/{data_stem}_redacted.csv"
    write_bundle(analysis, codebook, bundle_dir, viewer_name, plan, data_name)
    print(f"\nTree viewer:  {viewer_path}")
    print(f"Agent bundle: {bundle_dir}{os.sep}  (start with AGENTS.md)")
    if data_name:
        print(f"Redacted data for the agent: {os.path.join(bundle_dir, data_name)}")
    print("Give the agent the agent_bundle folder, not your original export: the original still holds every value.")
    if args.open:
        webbrowser.open("file://" + os.path.abspath(viewer_path))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
