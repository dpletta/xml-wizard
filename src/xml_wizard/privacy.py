"""Find variables that probably hold sensitive data and decide what to redact.

Everything here runs locally and uses only the standard library. Detection is
rule based: it reads REDCap's own Identifier flag, the validation type, the
field type, and the variable name and label (matched against the HIPAA Safe
Harbor identifier list), and, when data was supplied, the *shape* of the
values (e-mail addresses, phone numbers, SSNs, things that look like names).
Values themselves are never printed or stored; only counts are.

Each flagged variable gets an action:

``mask``  keep the column but replace every non-blank value with ``[REDACTED]``,
          so the agent can still tell answered from blank (skip logic keeps working)
``drop``  remove the column(s)
``keep``  leave it as it is

Decisions are saved to ``redaction_decisions.csv`` next to the outputs, so a
rerun only asks about variables that are new.
"""

from __future__ import annotations

import csv
import os
import re
from dataclasses import dataclass, field as dc_field
from typing import Callable, Dict, Iterable, List, Optional, TextIO

from .model import Field, Project

MASK_TOKEN = "[REDACTED]"
ACTIONS = ("mask", "drop", "keep")
LEVELS = ("high", "medium", "low")

# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

_NAME_VAR = re.compile(r"(^|_)(f|l|m|first|last|middle|full|maiden|sur|given|family|nick|pt|participant|"
                       r"patient|parent|guardian|child|contact|caregiver|emerg|emergency)_?name(s)?($|_|\d)")
_NAME_LABEL = re.compile(r"\b(first|last|middle|full|maiden|given|family|legal|nick|sur)\s*-?\s*name\b"
                         r"|\bname of (the )?(participant|respondent|patient|child|parent|guardian|contact|"
                         r"person|caregiver|partner|spouse|doctor|physician|provider)\b"
                         r"|^\s*(what is )?(your |participant'?s? |patient'?s? |child'?s? )?(full )?name\s*[:?.]?\s*$")
_BARE_NAME = re.compile(r"(^|_)names?($|_|\d)")

# (reason, level, suggested action, variable-name regex, label regex, validation types)
_RULES = [
    ("date of birth", "high", "mask",
     r"(^|_)(dob|birth_?date|date_?of_?birth|bday|birthday)($|_|\d)",
     r"\b(date of birth|birth ?date|birthday|d\.?o\.?b\.?)\b", ()),
    ("e-mail address", "high", "mask",
     r"(^|_)e_?mails?($|_|\d)", r"\be-?mail\b", ("email",)),
    ("phone or fax number", "high", "mask",
     r"(^|_)(phone|tel|telephone|cell|cellphone|mobile|fax)(s|num|number|_num|_number)?($|_|\d)",
     r"\b(phone|telephone|cell ?phone|mobile number|fax)\b", ("phone", "phone_australia")),
    ("street address or location", "high", "mask",
     r"(^|_)(address|addr|street|str_?address|apt|city|town|county|zip|zipcode|zip_?code|postal|postcode|"
     r"lat|latitude|lon|lng|longitude|gps|geo|coordinates)($|_|\d)",
     r"\b(street address|home address|mailing address|(?<!mail )(?<!e-mail )(?<!ip )(?<!web )address|zip ?code|postal code|city of residence|"
     r"gps|latitude|longitude)\b", ("zipcode", "postalcode_australia", "postalcode_canada", "postalcode_french",
                                     "postalcode_germany", "postalcode_uk")),
    ("ID number (SSN, MRN, licence, insurance, account)", "high", "mask",
     r"(^|_)(ssn|ss_?num|social_?security|mrn|med_?rec|medical_?record|license|licence|passport|"
     r"insurance_?(id|num|number)|medicaid|medicare|account_?(num|number)|acct|vin|plate|serial)($|_|\d)",
     r"\b(social security|ssn|medical record|mrn|driver'?s licen[cs]e|passport|insurance (id|number)|"
     r"medicaid|medicare|account number|license plate|serial number)\b", ("ssn", "mrn_10d", "mrn_generic")),
    ("web or IP address", "high", "mask",
     r"(^|_)(ip|ip_?address|url|website|homepage|social_?media|facebook|twitter|instagram|handle)($|_|\d)",
     r"\b(ip address|url|website|web address|social media|facebook|instagram|twitter)\b", ()),
    ("initials", "medium", "mask",
     r"(^|_)(initials|inits)($|_|\d)", r"\binitials\b", ()),
    ("emergency or other contact person", "medium", "mask",
     r"(^|_)(emerg|emergency|next_?of_?kin|nok|contact_?person)($|_|\d)",
     r"\b(emergency contact|next of kin|contact person|someone we can contact)\b", ()),
    ("employer, school or clinic name", "medium", "mask",
     r"(^|_)(employer|workplace|school_?name|clinic_?name|hospital_?name)($|_|\d)",
     r"\b(name of (your )?(employer|school|clinic|hospital|workplace))\b", ()),
]
_COMPILED = [(reason, level, action, re.compile(var), re.compile(lab, re.I), set(vals))
             for reason, level, action, var, lab, vals in _RULES]

_DATE_VALIDATIONS = re.compile(r"^(date|datetime)(_seconds)?_(ymd|mdy|dmy)$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_PHONE = re.compile(r"^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$")
_SSN = re.compile(r"^\d{3}-\d{2}-\d{4}$")
_NAMEISH = re.compile(r"^[A-Z][A-Za-z'’.-]+( [A-Z][A-Za-z'’.-]+){0,3}$")


@dataclass
class Flag:
    """One variable that may hold sensitive data."""
    field: str
    level: str                      # high, medium, low
    reasons: List[str]
    suggested: str                  # mask, drop or keep
    group: str = ""                 # low-level flags are asked about in groups
    used_in_logic_of: List[str] = dc_field(default_factory=list)

    def add(self, reason: str, level: str, suggested: str) -> None:
        if level == "low" and self.level != "low":
            return  # a weaker reason adds nothing to a stronger flag
        if reason not in self.reasons:
            self.reasons.append(reason)
        if LEVELS.index(level) < LEVELS.index(self.level):
            self.level = level
            self.suggested = suggested
            self.group = ""


@dataclass
class RedactionPlan:
    """The decision for every flagged variable."""
    flags: List[Flag] = dc_field(default_factory=list)
    actions: Dict[str, str] = dc_field(default_factory=dict)      # field -> mask/drop/keep
    decided_by: Dict[str, str] = dc_field(default_factory=dict)   # field -> you/suggested/file/flag

    def action(self, name: str) -> str:
        return self.actions.get(name, "keep")

    def redacted(self) -> Dict[str, str]:
        """Fields that are masked or dropped, in survey order of the flags."""
        out = {f.field: self.actions[f.field] for f in self.flags
               if self.actions.get(f.field) in ("mask", "drop")}
        for k, v in self.actions.items():
            if v in ("mask", "drop") and k not in out:
                out[k] = v
        return out

    def flag(self, name: str) -> Optional[Flag]:
        return next((f for f in self.flags if f.field == name), None)


def _name_tokens(fld: Field) -> str:
    return fld.name.lower()


def _metadata_flags(project: Project) -> Dict[str, Flag]:
    flags: Dict[str, Flag] = {}

    def add(fld: Field, reason: str, level: str, suggested: str, group: str = "") -> None:
        if fld.name in flags:
            flags[fld.name].add(reason, level, suggested)
        else:
            flags[fld.name] = Flag(fld.name, level, [reason], suggested, group if level == "low" else "")

    for fld in project.ordered_fields():
        if not fld.holds_data or fld.is_form_status or fld.name == project.record_id_field:
            continue
        coded = fld.is_categorical or fld.field_type in ("calc", "slider")
        name = _name_tokens(fld)
        label = fld.label.lower()
        validation = (fld.validation or "").lower()
        if fld.identifier:
            add(fld, "marked as an Identifier in REDCap", "high", "mask")
        if fld.field_type == "file":
            add(fld, "file upload (documents, photos or signatures)", "high", "drop")
        if "signature" in fld.annotation.lower() or "signature" in name:
            add(fld, "signature", "high", "drop")
        if coded:
            # Coded answers (radio, checkbox, calc...) rarely identify anyone unless REDCap says so.
            continue
        if _NAME_VAR.search(name) or _NAME_LABEL.search(label):
            add(fld, "person's name", "high", "mask")
        elif _BARE_NAME.search(name):
            add(fld, "may be a name", "medium", "mask")
        for reason, level, action, var_re, lab_re, vals in _COMPILED:
            if validation in vals or var_re.search(name) or lab_re.search(label):
                add(fld, reason, level, action)
        if fld.field_type == "notes":
            add(fld, "long free-text answer (may contain names or other details)", "medium", "mask")
        if _DATE_VALIDATIONS.match(validation) or validation in ("time", "time_mm_ss"):
            add(fld, "date (dates linked to a person are HIPAA identifiers)", "low", "keep", "dates")
        elif fld.field_type == "text" and not validation:
            add(fld, "short free-text answer", "low", "keep", "free_text")
    return flags


def _data_flags(project: Project, flags: Dict[str, Flag]) -> None:
    """Look at the shape of values in free-text columns. Only counts are kept."""
    rows = project.data_rows or []
    if not rows:
        return
    for fld in project.ordered_fields():
        if fld.field_type not in ("text", "notes") or fld.name == project.record_id_field:
            continue
        if fld.validation and not fld.validation.lower().startswith(("alpha", "letters")):
            continue
        vals = [str(r.get(fld.name, "")).strip() for r in rows]
        vals = [v for v in vals if v]
        if not vals:
            continue
        n = len(vals)
        checks = [
            (sum(1 for v in vals if _EMAIL.match(v)), "e-mail addresses", "high"),
            (sum(1 for v in vals if _PHONE.match(v)), "phone numbers", "high"),
            (sum(1 for v in vals if _SSN.match(v)), "Social Security numbers", "high"),
        ]
        for count, what, level in checks:
            if count:
                reason = f"{count} of {n} values look like {what}"
                (flags[fld.name].add(reason, level, "mask") if fld.name in flags
                 else flags.__setitem__(fld.name, Flag(fld.name, level, [reason], "mask")))
        nameish = sum(1 for v in vals if _NAMEISH.match(v))
        distinct = len(set(v.lower() for v in vals))
        if n >= 3 and nameish / n >= 0.6 and distinct / n >= 0.4:
            reason = f"{nameish} of {n} values look like names or places (capitalised words, mostly unique)"
            if fld.name in flags:
                flags[fld.name].add(reason, "medium", "mask")
            else:
                flags[fld.name] = Flag(fld.name, "medium", [reason], "mask")


def detect_sensitive(project: Project) -> List[Flag]:
    """Return flags in survey order."""
    flags = _metadata_flags(project)
    _data_flags(project, flags)
    users: Dict[str, List[str]] = {}
    for fld in project.fields.values():
        refs = set(re.findall(r"\[([a-z0-9_]+)(?:\([^)]*\))?\]", (fld.branching_logic or "") + " " +
                              (fld.calculation or ""), re.I))
        for ref in refs:
            users.setdefault(ref, []).append(fld.name)
    order = {f.name: f.order for f in project.fields.values()}
    out = sorted(flags.values(), key=lambda f: order.get(f.field, 0))
    for f in out:
        f.used_in_logic_of = sorted(users.get(f.field, []), key=lambda n: order.get(n, 0))
    return out


# ---------------------------------------------------------------------------
# Decisions file
# ---------------------------------------------------------------------------

DECISIONS_FILE = "redaction_decisions.csv"


def load_decisions(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path or not os.path.exists(path):
        return out
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            name = (r.get("field") or "").strip()
            act = (r.get("action") or "").strip().lower()
            if name and act in ACTIONS:
                out[name] = act
    return out


def save_decisions(path: str, plan: RedactionPlan) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["field", "action", "level", "reasons", "decided_by"])
        for f in plan.flags:
            w.writerow([f.field, plan.action(f.field), f.level, "; ".join(f.reasons),
                        plan.decided_by.get(f.field, "")])
        for name, act in plan.actions.items():
            if plan.flag(name) is None:
                w.writerow([name, act, "", "added by you", plan.decided_by.get(name, "you")])


# ---------------------------------------------------------------------------
# Review (interactive or not)
# ---------------------------------------------------------------------------

_KEYS = {"m": "mask", "d": "drop", "k": "keep"}
_GROUP_TEXT = {
    "dates": "dates (visit, interview or event dates). Under HIPAA Safe Harbor, any date linked to a person "
             "is an identifier, but most analyses need them",
    "free_text": "short free-text answers (\"other, please specify\" and similar). They usually hold "
                 "harmless text but can contain names",
}


def _describe(project: Project, f: Flag) -> str:
    fld = project.get(f.field)
    label = fld.label if fld else ""
    if len(label) > 60:
        label = label[:57] + "..."
    ftype = fld.field_type if fld else "?"
    return f"{f.field} ({ftype}) \"{label}\""


def review(project: Project, mode: str = "ask", decisions_path: str = "",
           extra: Optional[Dict[str, str]] = None,
           input_fn: Callable[[str], str] = input, out: Optional[TextIO] = None) -> RedactionPlan:
    """Build a RedactionPlan.

    mode ``ask`` prompts for every new flag; ``suggested`` accepts the suggestions;
    ``none`` keeps everything. Saved decisions and ``extra`` (from --redact-fields
    / --keep-fields) always win and are never asked again.
    """
    import sys
    out = out or sys.stdout
    flags = detect_sensitive(project)
    plan = RedactionPlan(flags=flags)
    saved = load_decisions(decisions_path)
    extra = extra or {}
    for f in flags:
        if f.field in extra:
            plan.actions[f.field], plan.decided_by[f.field] = extra[f.field], "you"
        elif f.field in saved:
            plan.actions[f.field], plan.decided_by[f.field] = saved[f.field], "saved"
    for name, act in list(saved.items()) + list(extra.items()):
        if name not in plan.actions and name in project.fields:
            plan.actions[name] = act
            plan.decided_by[name] = "you" if name in extra else "saved"

    todo = [f for f in flags if f.field not in plan.actions]
    if mode == "none":
        for f in todo:
            plan.actions[f.field], plan.decided_by[f.field] = "keep", "--redact none"
        return plan
    if mode != "ask" or not todo:
        for f in todo:
            plan.actions[f.field], plan.decided_by[f.field] = f.suggested, "suggested"
        return plan

    individual = [f for f in todo if f.level != "low"]
    groups: Dict[str, List[Flag]] = {}
    for f in todo:
        if f.level == "low":
            groups.setdefault(f.group or "other", []).append(f)

    p = lambda s="": print(s, file=out)  # noqa: E731
    p()
    p(f"Privacy check: {len(individual)} variable(s) look like they may hold identifying or sensitive data"
      + (f", plus {sum(len(g) for g in groups.values())} lower-risk ones" if groups else "") + ".")
    p("Choose what the AI agent may see. This changes the agent bundle (and the redacted copy of your data),")
    p("never your original export.")
    p("  m = mask: keep the column, replace answers with [REDACTED] (skip logic still works)")
    p("  d = drop: remove the column      k = keep as is")
    p("  Enter = the suggestion in capitals, a = accept all remaining suggestions, ? = why it was flagged")
    accept_all = False
    for i, f in enumerate(individual, 1):
        if accept_all:
            plan.actions[f.field], plan.decided_by[f.field] = f.suggested, "suggested"
            continue
        p()
        p(f"[{i}/{len(individual)}] {_describe(project, f)}  {f.level} risk: {'; '.join(f.reasons)}")
        if f.used_in_logic_of:
            p(f"      used by the logic or calculation of: {', '.join(f.used_in_logic_of[:6])}"
              + (" ..." if len(f.used_in_logic_of) > 6 else "")
              + ". Their exported values stay correct, but recomputing them from redacted data will not work.")
        choice = _ask(input_fn, p, f.suggested, f)
        if choice == "all":
            accept_all = True
            choice = f.suggested
        plan.actions[f.field], plan.decided_by[f.field] = choice, ("you" if not accept_all else "suggested")

    for g, members in groups.items():
        if accept_all:
            for f in members:
                plan.actions[f.field], plan.decided_by[f.field] = f.suggested, "suggested"
            continue
        p()
        names = ", ".join(f.field for f in members[:8]) + (f", ... ({len(members)} in all)" if len(members) > 8 else "")
        p(f"{len(members)} {_GROUP_TEXT.get(g, 'other variables')}: {names}")
        ans = _ask_group(input_fn, p)
        for f in members:
            plan.actions[f.field] = ans
            plan.decided_by[f.field] = "you"
    p()
    return plan


def _ask(input_fn, p, suggested: str, f: Flag) -> str:
    prompt = "      " + "/".join(k.upper() if v == suggested else k for k, v in _KEYS.items()) + "/a/? > "
    while True:
        try:
            raw = input_fn(prompt).strip().lower()
        except EOFError:
            return suggested
        if raw == "":
            return suggested
        if raw in ("a", "all"):
            return "all"
        if raw in ("?", "h", "help"):
            p("      Reasons: " + "; ".join(f.reasons))
            continue
        if raw[:1] in _KEYS:
            return _KEYS[raw[:1]]
        p("      Please type m, d, k, a or ?")


def _ask_group(input_fn, p) -> str:
    while True:
        try:
            raw = input_fn("      Mask all of them? m/d/K > ").strip().lower()
        except EOFError:
            return "keep"
        if raw == "":
            return "keep"
        if raw[:1] in _KEYS:
            return _KEYS[raw[:1]]
        p("      Please type m, d or k")


def summary_lines(project: Project, plan: RedactionPlan) -> List[str]:
    red = plan.redacted()
    lines = []
    if red:
        masked = [n for n, a in red.items() if a == "mask"]
        dropped = [n for n, a in red.items() if a == "drop"]
        if masked:
            lines.append(f"Masked for the agent ({len(masked)}): {', '.join(masked)}")
        if dropped:
            lines.append(f"Dropped for the agent ({len(dropped)}): {', '.join(dropped)}")
    else:
        lines.append("No variables are redacted for the agent.")
    kept_high = [f.field for f in plan.flags if f.level == "high" and plan.action(f.field) == "keep"]
    if kept_high:
        lines.append(f"Kept although flagged high risk: {', '.join(kept_high)}")
    return lines


# ---------------------------------------------------------------------------
# Applying the plan to data
# ---------------------------------------------------------------------------

def redacted_columns(project: Project, plan: RedactionPlan) -> Dict[str, str]:
    """Export column -> action for every masked or dropped field."""
    out: Dict[str, str] = {}
    for name, act in plan.redacted().items():
        fld = project.get(name)
        cols = fld.columns if fld else [name]
        for c in cols or [name]:
            out[c] = act
    return out


def redact_rows(rows: Iterable[Dict[str, str]], header: List[str], columns: Dict[str, str]):
    """Return (new_header, new_rows) with masked values and dropped columns."""
    new_header = [h for h in header if columns.get(h) != "drop"]
    new_rows = []
    for row in rows:
        nr = {}
        for h in new_header:
            v = row.get(h, "")
            if columns.get(h) == "mask" and str(v).strip() != "":
                # Checkbox columns: keep 0/1 shape ("0" stays, anything else is masked)
                v = v if (h.count("___") and str(v).strip() == "0") else MASK_TOKEN
            nr[h] = v
        new_rows.append(nr)
    return new_header, new_rows


def write_redacted_csv(path: str, project: Project, plan: RedactionPlan) -> int:
    rows = project.data_rows or []
    header: List[str] = []
    for r in rows:
        for k in r:
            if k not in header:
                header.append(k)
    new_header, new_rows = redact_rows(rows, header, redacted_columns(project, plan))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=new_header, extrasaction="ignore")
        w.writeheader()
        w.writerows(new_rows)
    return len(new_rows)
