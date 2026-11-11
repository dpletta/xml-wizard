"""Readers for REDCap project exports.

Supported inputs:

* CDISC ODM XML ("REDCap XML") from *Project Setup > Other Functionality >
  Download metadata only (XML)* or *Other Export Options > CDISC ODM*,
  optionally including data (``<ClinicalData>``).
* The REDCap Data Dictionary CSV.
* A raw REDCap data export CSV (records), used for the data audit.
"""

from __future__ import annotations

import csv
import io
import os
import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

from .model import Event, Field, Instrument, Project, parse_choices, strip_html


class InputError(ValueError):
    """Raised for files that are not recognisable REDCap exports."""


def load_project(path: str, data_path: Optional[str] = None) -> Project:
    """Load a REDCap project from ODM XML or a data dictionary CSV."""
    with open(path, "rb") as fh:
        head = fh.read(4096).lstrip(b"\xef\xbb\xbf").lstrip()
    if head.startswith(b"<"):
        project = read_odm(path)
    else:
        project = read_data_dictionary(path)
    if data_path:
        project.data_rows = read_data_csv(data_path)
    return project


# ---------------------------------------------------------------------------
# ODM XML
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _attr(el: ET.Element, name: str, default: str = "") -> str:
    """Read an attribute regardless of namespace prefix (redcap:Variable etc.)."""
    if name in el.attrib:
        return el.attrib[name]
    suffix = "}" + name
    for k, v in el.attrib.items():
        if k.endswith(suffix):
            return v
    return default


def _children(el: ET.Element, name: str) -> List[ET.Element]:
    return [c for c in el if _local(c.tag) == name]


def _child(el: ET.Element, name: str) -> Optional[ET.Element]:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _translated(el: Optional[ET.Element]) -> str:
    if el is None:
        return ""
    for node in el.iter():
        if _local(node.tag) == "TranslatedText":
            return (node.text or "").strip()
    return (el.text or "").strip()


def read_odm(path: str) -> Project:
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        raise InputError(f"{os.path.basename(path)} is not valid XML: {exc}") from exc
    root = tree.getroot()
    if _local(root.tag) != "ODM":
        raise InputError("This XML file is not a CDISC ODM export (no <ODM> root element).")
    study = next((e for e in root.iter() if _local(e.tag) == "Study"), None)
    if study is None:
        raise InputError("No <Study> element found in the ODM file.")

    gv = _child(study, "GlobalVariables")
    title = _translated(_child(gv, "StudyName")) if gv is not None else ""
    mdv = _child(study, "MetaDataVersion")
    if mdv is None:
        raise InputError("No <MetaDataVersion> (project metadata) found in the ODM file.")
    project = Project(
        title=title or _attr(mdv, "Name") or os.path.basename(path),
        record_id_field=_attr(mdv, "RecordIdField") or "record_id",
        source_format="REDCap CDISC ODM XML",
        source_file=os.path.basename(path),
    )

    # Index definitions
    item_groups = {_attr(g, "OID"): g for g in _children(mdv, "ItemGroupDef")}
    item_defs = {_attr(i, "OID"): i for i in _children(mdv, "ItemDef")}
    code_lists = {_attr(c, "OID"): c for c in _children(mdv, "CodeList")}

    # Repeating instruments: event -> forms
    repeating: Dict[str, List[str]] = {}
    if gv is not None:
        for el in gv.iter():
            if _local(el.tag) == "RepeatingInstrument":
                repeating.setdefault(_attr(el, "UniqueEventName"), []).append(_attr(el, "RepeatInstrument"))

    order = 0
    for form in _children(mdv, "FormDef"):
        form_name = _attr(form, "FormName") or _attr(form, "OID").replace("Form.", "", 1)
        instrument = Instrument(name=form_name, label=_attr(form, "Name") or form_name)
        project.instruments.append(instrument)
        for gref in _children(form, "ItemGroupRef"):
            group = item_groups.get(_attr(gref, "ItemGroupOID"))
            if group is None:
                continue
            for iref in _children(group, "ItemRef"):
                item = item_defs.get(_attr(iref, "ItemOID"))
                if item is None:
                    continue
                var = _attr(item, "Variable") or _attr(item, "Name")
                if var in project.fields:
                    continue  # later checkbox options of an already-seen field
                ftype = _attr(item, "FieldType") or _guess_type(item)
                choices = _odm_choices(item, ftype, var, code_lists, item_defs)
                label_html = _translated(_child(item, "Question"))
                fld = Field(
                    name=var,
                    form=form_name,
                    field_type=ftype,
                    label=strip_html(label_html),
                    label_html=label_html,
                    choices=choices,
                    branching_logic=_attr(item, "BranchingLogic").strip(),
                    section_header=strip_html(_attr(item, "SectionHeader")),
                    field_note=strip_html(_attr(item, "FieldNote")),
                    validation=_attr(item, "TextValidationType"),
                    validation_min=_range(item, "GE") or _attr(item, "TextValidationMin"),
                    validation_max=_range(item, "LE") or _attr(item, "TextValidationMax"),
                    annotation=_attr(item, "FieldAnnotation"),
                    calculation=_attr(item, "Calculation"),
                    required=_attr(item, "RequiredField").lower() in ("y", "1", "yes", "true"),
                    identifier=_attr(item, "Identifier").lower() in ("y", "1", "yes", "true"),
                    matrix_group=_attr(item, "MatrixGroupName"),
                    order=order,
                )
                order += 1
                project.fields[var] = fld
                instrument.fields.append(var)

    # Events (longitudinal projects)
    for ev in _children(mdv, "StudyEventDef"):
        unique = _attr(ev, "UniqueEventName") or _attr(ev, "OID").replace("Event.", "", 1)
        forms = [_attr(fr, "FormOID").replace("Form.", "", 1) for fr in _children(ev, "FormRef")]
        project.events.append(Event(
            unique_name=unique, label=_attr(ev, "Name") or unique,
            arm=_attr(ev, "ArmNum") or "1", forms=forms,
            repeating_forms=repeating.get(unique, []),
        ))
    rep_all = {f for forms in repeating.values() for f in forms}
    for ins in project.instruments:
        ins.repeating = ins.name in rep_all

    clinical = next((e for e in root.iter() if _local(e.tag) == "ClinicalData"), None)
    if clinical is not None:
        project.data_rows = _odm_rows(clinical, project)
    return project


def _guess_type(item: ET.Element) -> str:
    if _child(item, "CodeListRef") is not None:
        return "radio"
    return "text"


def _range(item: ET.Element, comparator: str) -> str:
    for rc in _children(item, "RangeCheck"):
        if _attr(rc, "Comparator") == comparator:
            cv = _child(rc, "CheckValue")
            if cv is not None and cv.text:
                return cv.text.strip()
    return ""


def _odm_choices(item, ftype, var, code_lists, item_defs):
    ref = _child(item, "CodeListRef")
    cl = code_lists.get(_attr(ref, "CodeListOID")) if ref is not None else None
    if ftype == "checkbox":
        if cl is not None and _attr(cl, "CheckboxChoices"):
            return parse_choices(_attr(cl, "CheckboxChoices"))
        for c in code_lists.values():
            if _attr(c, "Variable") == var and _attr(c, "CheckboxChoices"):
                return parse_choices(_attr(c, "CheckboxChoices"))
        # Fall back to option codes from the item OIDs (var___1, var___2 ...)
        codes = [oid.split("___", 1)[1] for oid in item_defs if oid.startswith(var + "___")]
        return [(c, c) for c in codes]
    if cl is None:
        return []
    out = []
    for cli in _children(cl, "CodeListItem"):
        out.append((_attr(cli, "CodedValue"), strip_html(_translated(_child(cli, "Decode")))))
    return out


def _odm_rows(clinical: ET.Element, project: Project) -> List[Dict[str, str]]:
    """Flatten <ClinicalData> into rows shaped like a REDCap raw CSV export."""
    rows: Dict[tuple, Dict[str, str]] = {}
    rec_field = project.record_id_field
    rep_forms = {i.name for i in project.instruments if i.repeating}

    def row_for(record: str, event: str, form: str, instance: str) -> Dict[str, str]:
        if form in rep_forms:
            key = (record, event, form, instance)
        else:
            key = (record, event, "", "")
        if key not in rows:
            r = {rec_field: record}
            if event:
                r["redcap_event_name"] = event
            r["redcap_repeat_instrument"] = key[2]
            r["redcap_repeat_instance"] = key[3]
            rows[key] = r
        return rows[key]

    for subj in _children(clinical, "SubjectData"):
        record = _attr(subj, "SubjectKey")
        containers = _children(subj, "StudyEventData") or [subj]
        for cont in containers:
            event = _attr(cont, "UniqueEventName") or _attr(cont, "StudyEventOID").replace("Event.", "", 1)
            for fd in _children(cont, "FormData"):
                form = _attr(fd, "FormOID").replace("Form.", "", 1)
                inst = _attr(fd, "FormRepeatKey") or "1"
                row = row_for(record, event, form, inst)
                for ig in _children(fd, "ItemGroupData"):
                    for idata in _children(ig, "ItemData"):
                        row[_attr(idata, "ItemOID")] = _attr(idata, "Value")
    # Checkbox columns missing from the XML are unchecked
    for row in rows.values():
        for fld in project.fields.values():
            if fld.field_type == "checkbox":
                for col in fld.columns:
                    row.setdefault(col, "0")
    return list(rows.values())


# ---------------------------------------------------------------------------
# Data dictionary CSV
# ---------------------------------------------------------------------------

_DD_COLUMNS = {
    "variable": "name", "form name": "form", "section header": "section_header",
    "field type": "field_type", "field label": "label", "choices": "choices",
    "field note": "field_note", "text validation type": "validation",
    "text validation min": "validation_min", "text validation max": "validation_max",
    "identifier": "identifier", "branching logic": "branching_logic",
    "required field": "required", "matrix group name": "matrix_group",
    "field annotation": "annotation",
}


def _read_csv_text(path: str) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def read_data_dictionary(path: str) -> Project:
    reader = csv.reader(io.StringIO(_read_csv_text(path)))
    try:
        header = next(reader)
    except StopIteration:
        raise InputError("The data dictionary file is empty.")
    mapping: Dict[int, str] = {}
    for idx, col in enumerate(header):
        low = col.strip().lower()
        for prefix, attr in _DD_COLUMNS.items():
            if low.startswith(prefix) and attr not in mapping.values():
                mapping[idx] = attr
                break
    if "name" not in mapping.values() or "field_type" not in mapping.values():
        raise InputError(
            "This CSV does not look like a REDCap data dictionary "
            "(expected 'Variable / Field Name' and 'Field Type' columns).")
    project = Project(title=os.path.splitext(os.path.basename(path))[0],
                      source_format="REDCap Data Dictionary CSV",
                      source_file=os.path.basename(path))
    order = 0
    for raw_row in reader:
        if not any(c.strip() for c in raw_row):
            continue
        vals = {attr: (raw_row[i] if i < len(raw_row) else "") for i, attr in mapping.items()}
        name = vals.get("name", "").strip()
        if not name:
            continue
        ftype = vals.get("field_type", "text").strip().lower()
        form = vals.get("form", "").strip()
        if order == 0:
            project.record_id_field = name
        ins = project.instrument(form)
        if ins is None:
            ins = Instrument(name=form, label=form.replace("_", " ").title())
            project.instruments.append(ins)
        choices_raw = vals.get("choices", "")
        is_coded = ftype in ("radio", "dropdown", "checkbox", "select")
        fld = Field(
            name=name, form=form, field_type=ftype,
            label=strip_html(vals.get("label", "")), label_html=vals.get("label", ""),
            choices=parse_choices(choices_raw) if is_coded else [],
            branching_logic=vals.get("branching_logic", "").strip(),
            section_header=strip_html(vals.get("section_header", "")),
            field_note=strip_html(vals.get("field_note", "")),
            validation=vals.get("validation", "").strip(),
            validation_min=vals.get("validation_min", "").strip(),
            validation_max=vals.get("validation_max", "").strip(),
            annotation=vals.get("annotation", ""),
            calculation=choices_raw if ftype == "calc" else "",
            required=vals.get("required", "").strip().lower() in ("y", "yes", "1"),
            identifier=vals.get("identifier", "").strip().lower() in ("y", "yes", "1"),
            matrix_group=vals.get("matrix_group", "").strip(),
            order=order,
        )
        order += 1
        project.fields[name] = fld
        ins.fields.append(name)
    # The dictionary omits form status fields; add them like REDCap does
    for ins in project.instruments:
        status = f"{ins.name}_complete"
        if status not in project.fields:
            project.fields[status] = Field(
                name=status, form=ins.name, field_type="dropdown", label="Complete?",
                choices=[("0", "Incomplete"), ("1", "Unverified"), ("2", "Complete")],
                section_header="Form Status")
            ins.fields.append(status)
    # Number fields in instrument order, as REDCap does
    ordered = {}
    for ins in project.instruments:
        for n in ins.fields:
            project.fields[n].order = len(ordered)
            ordered[n] = project.fields[n]
    project.fields = ordered
    return project


# ---------------------------------------------------------------------------
# Raw data export CSV
# ---------------------------------------------------------------------------

def read_data_csv(path: str) -> List[Dict[str, str]]:
    reader = csv.DictReader(io.StringIO(_read_csv_text(path)))
    rows = [{(k or "").strip(): (v or "") for k, v in r.items()} for r in reader]
    if rows and any(re.search(r"\s", k) for k in rows[0]):
        raise InputError(
            "The data CSV has column headers with spaces. Export it from REDCap with "
            "'CSV / Microsoft Excel (raw data)' and variable names as headers, not labels.")
    return rows
