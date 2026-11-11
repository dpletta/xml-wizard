"""Data model shared by the readers, analysers and exporters."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional, Tuple

from . import logic

# Field types whose answers are coded choices
CATEGORICAL_TYPES = {"radio", "dropdown", "select", "yesno", "truefalse", "checkbox"}
# Field types that never hold participant answers
NON_DATA_TYPES = {"descriptive"}

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    text = re.sub(r"(?i)<br\s*/?>", " ", text)
    text = _TAG_RE.sub("", text)
    return _SPACE_RE.sub(" ", html.unescape(text)).strip()


def parse_choices(text: Optional[str]) -> List[Tuple[str, str]]:
    """Parse REDCap's '1, Yes | 0, No' choice string."""
    out: List[Tuple[str, str]] = []
    if not text:
        return out
    for part in re.split(r"\s*\|\s*|\\n|\n", text):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            code, label = part.split(",", 1)
            out.append((code.strip(), strip_html(label.strip())))
        else:
            out.append((part, part))
    return out


@dataclass
class Field:
    name: str
    form: str
    field_type: str
    label: str = ""
    label_html: str = ""
    choices: List[Tuple[str, str]] = dc_field(default_factory=list)
    branching_logic: str = ""
    section_header: str = ""
    field_note: str = ""
    validation: str = ""
    validation_min: str = ""
    validation_max: str = ""
    annotation: str = ""
    calculation: str = ""
    required: bool = False
    identifier: bool = False
    matrix_group: str = ""
    order: int = 0
    # Filled in by analysis
    logic_ast: Optional[Dict[str, Any]] = None
    logic_error: str = ""

    def __post_init__(self) -> None:
        if self.field_type == "select":
            self.field_type = "dropdown"
        elif self.field_type == "textarea":
            # ODM exports call REDCap "notes" fields "textarea".
            self.field_type = "notes"
        if not self.choices and self.field_type == "yesno":
            self.choices = [("1", "Yes"), ("0", "No")]
        if not self.choices and self.field_type == "truefalse":
            self.choices = [("1", "True"), ("0", "False")]

    @property
    def is_categorical(self) -> bool:
        return self.field_type in CATEGORICAL_TYPES

    @property
    def is_form_status(self) -> bool:
        return self.name == f"{self.form}_complete"

    @property
    def holds_data(self) -> bool:
        return self.field_type not in NON_DATA_TYPES

    @property
    def columns(self) -> List[str]:
        """Columns this field occupies in a REDCap raw CSV export."""
        if self.field_type == "checkbox":
            return [f"{self.name}___{logic._code_suffix(c)}" for c, _ in self.choices]
        if not self.holds_data:
            return []
        return [self.name]

    def choice_label(self, code: str) -> Optional[str]:
        for c, lab in self.choices:
            if c == str(code).strip():
                return lab
        return None

    @property
    def choice_codes(self) -> List[str]:
        return [c for c, _ in self.choices]


@dataclass
class Instrument:
    name: str
    label: str
    fields: List[str] = dc_field(default_factory=list)
    repeating: bool = False


@dataclass
class Event:
    unique_name: str
    label: str
    arm: str = "1"
    forms: List[str] = dc_field(default_factory=list)
    repeating_forms: List[str] = dc_field(default_factory=list)


@dataclass
class Project:
    title: str
    record_id_field: str = "record_id"
    source_format: str = ""
    source_file: str = ""
    instruments: List[Instrument] = dc_field(default_factory=list)
    fields: Dict[str, Field] = dc_field(default_factory=dict)
    events: List[Event] = dc_field(default_factory=list)
    # Rows of raw values keyed by export column (only when data was supplied)
    data_rows: Optional[List[Dict[str, str]]] = None

    @property
    def longitudinal(self) -> bool:
        return len(self.events) > 1

    def instrument(self, name: str) -> Optional[Instrument]:
        for ins in self.instruments:
            if ins.name == name:
                return ins
        return None

    def ordered_fields(self) -> List[Field]:
        return sorted(self.fields.values(), key=lambda f: f.order)

    def get(self, name: str) -> Optional[Field]:
        return self.fields.get(name)
