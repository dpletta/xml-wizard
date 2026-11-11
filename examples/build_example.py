"""Build the synthetic example project in this folder.

Writes three files that describe the same fake survey, the way REDCap
exports them:

* housing_survey_odm.xml        CDISC ODM XML with metadata and data
* housing_survey_dictionary.csv Data Dictionary CSV
* housing_survey_data.csv       Raw data export CSV

All participants are simulated. The survey deliberately contains a few
branching-logic bugs and data-entry problems so the tool has something to
find. Run:  python examples/build_example.py
"""

import csv
import os
import random
from xml.sax.saxutils import escape, quoteattr

HERE = os.path.dirname(os.path.abspath(__file__))

YN = "1, Yes | 0, No"
# (name, form, section, type, label, choices/calc, validation, min, max, logic, required, note)
FIELDS = [
    ("record_id", "demographics", "", "text", "Record ID", "", "", "", "", "", "", ""),
    ("age", "demographics", "", "text", "What is your age in years?", "", "integer", "18", "99", "", "y", ""),
    ("gender", "demographics", "", "radio", "What is your gender?",
     "1, Woman | 2, Man | 3, Non-binary | 4, Prefer to self-describe | 99, Prefer not to answer", "", "", "", "", "y", ""),
    ("gender_self", "demographics", "", "text", "Please describe your gender:", "", "", "", "", "[gender] = '4'", "", ""),
    ("race", "demographics", "", "checkbox", "What is your race? (Select all that apply)",
     "1, American Indian or Alaska Native | 2, Asian | 3, Black or African American | "
     "4, Native Hawaiian or Other Pacific Islander | 5, White | 98, Another race", "", "", "", "", "", ""),
    ("race_other", "demographics", "", "text", "Please specify your race:", "", "", "", "", "[race(98)] = '1'", "", ""),

    ("homeless_life", "housing", "Housing history", "yesno",
     "Have you <b>ever</b> been homeless in your lifetime?", "", "", "", "", "", "y", ""),
    ("homeless_age", "housing", "", "text", "How old were you the first time you were homeless?",
     "", "integer", "0", "99", "[homeless_life] = '1'", "", ""),
    ("homeless_6mo", "housing", "", "yesno", "In the <b>past 6 months</b>, have you been homeless?",
     "", "", "", "", "[homeless_life] = '1'", "", ""),
    ("homeless_nights", "housing", "", "text",
     "In the past 6 months, how many nights did you sleep outside or in a shelter?",
     "", "integer", "0", "183", "[homeless_life] = '1' and [homeless_6mo] = '1'", "", ""),
    ("shelter_type", "housing", "", "checkbox", "In the past 6 months, where did you stay? (Select all that apply)",
     "1, Emergency shelter | 2, Car or vehicle | 3, Outdoors | 4, A friend's couch", "", "", "",
     "[homeless_6mo] = '1'", "", ""),
    ("housing_now", "housing", "Current housing", "radio", "Where do you live now?",
     "1, Own or rent | 2, With family or friends | 3, Shelter | 4, Unsheltered | 5, Other", "", "", "", "", "y", ""),
    ("housing_now_other", "housing", "", "text", "Please describe where you live now:", "", "", "", "",
     "[housing_now] = '5'", "", ""),
    ("evicted_ever", "housing", "", "yesno", "Have you ever been evicted?", "", "", "", "", "", "", ""),
    # BUG: yes/no items are coded 1/0, so '2' never matches and this item is never shown
    ("evicted_count", "housing", "", "text", "How many times have you been evicted?", "", "integer", "1", "50",
     "[evicted_ever] = '2'", "", ""),

    ("alc_ever", "substance_use", "Alcohol", "yesno", "Have you ever had a drink of alcohol?", "", "", "", "", "", "y", ""),
    ("alc_30d_days", "substance_use", "", "text",
     "During the past 30 days, on how many days did you have at least one drink?",
     "", "integer", "0", "30", "[alc_ever] = '1'", "", ""),
    ("alc_binge", "substance_use", "", "radio",
     "During the past 30 days, how often did you have 5 or more drinks on one occasion?",
     "0, Never | 1, 1-2 times | 2, 3 or more times", "", "", "", "[alc_ever] = '1' and [alc_30d_days] > 0", "", ""),
    ("drug_ever", "substance_use", "Drug use", "checkbox", "Which of these have you ever used? (Select all that apply)",
     "1, Cannabis | 2, Cocaine | 3, Opioids not prescribed to you | 4, Methamphetamine | 0, None of these",
     "", "", "", "", "", ""),
    ("drug_30d", "substance_use", "", "checkbox", "Which have you used in the past 30 days?",
     "1, Cannabis | 2, Cocaine | 3, Opioids not prescribed to you | 4, Methamphetamine", "", "", "",
     "[drug_ever(1)] = '1' or [drug_ever(2)] = '1' or [drug_ever(3)] = '1' or [drug_ever(4)] = '1'", "", ""),
    ("inject_ever", "substance_use", "", "yesno", "Have you ever injected drugs?", "", "", "", "",
     "[drug_ever(2)] = '1' or [drug_ever(3)] = '1' or [drug_ever(4)] = '1'", "", ""),
    # BUG: depends on opioid_od, which is asked after this item
    ("naloxone", "substance_use", "", "yesno", "Do you carry naloxone (Narcan)?", "", "", "", "",
     "[drug_ever(3)] = '1' or [opioid_od] = '1'", "", ""),
    ("opioid_od", "substance_use", "", "yesno", "Have you ever overdosed on opioids?", "", "", "", "",
     "[drug_ever(3)] = '1'", "", ""),
    ("tx_info", "substance_use", "", "descriptive",
     "If you would like information about treatment or harm reduction, ask a staff member.", "", "", "", "",
     "[inject_ever] = '1'", "", ""),
    ("alc_score", "substance_use", "", "calc", "Alcohol risk score (auto-calculated)",
     "sum([alc_binge], if([alc_ever] = '1', 1, 0))", "", "", "", "", "", ""),
    # BUG: typo in the field name ([alc_evr]) so REDCap never shows this item
    ("substance_notes", "substance_use", "", "notes", "Interviewer notes on substance use", "", "", "", "",
     "[alc_evr] = '1'", "", ""),
]
FORMS = [("demographics", "Demographics"), ("housing", "Housing"), ("substance_use", "Substance Use")]


def choices_of(f):
    if f[3] == "yesno":
        return [("1", "Yes"), ("0", "No")]
    if f[3] in ("radio", "checkbox", "dropdown"):
        return [tuple(x.strip() for x in c.split(",", 1)) for c in f[5].split("|")]
    return []


def simulate(n=60, seed=7):
    rng = random.Random(seed)
    rows = []
    for rid in range(1, n + 1):
        r = {"record_id": str(rid), "age": str(rng.randint(18, 75))}
        r["gender"] = rng.choice(["1", "1", "2", "2", "3", "4", "99"])
        r["gender_self"] = "Two-spirit" if r["gender"] == "4" else ""
        races = {c for c in ["1", "2", "3", "4", "5", "98"] if rng.random() < 0.22} or {"5"}
        for c in ["1", "2", "3", "4", "5", "98"]:
            r[f"race___{c}"] = "1" if c in races else "0"
        r["race_other"] = "Middle Eastern" if "98" in races else ""
        r["demographics_complete"] = "2"

        life = rng.random() < 0.45
        r["homeless_life"] = "1" if life else "0"
        r["homeless_age"] = str(rng.randint(12, 50)) if life else ""
        six = life and rng.random() < 0.5
        r["homeless_6mo"] = ("1" if six else "0") if life else ""
        r["homeless_nights"] = str(rng.randint(1, 180)) if six else ""
        for c in ["1", "2", "3", "4"]:
            r[f"shelter_type___{c}"] = "1" if six and rng.random() < 0.4 else "0"
        r["housing_now"] = rng.choice(["1", "1", "2", "3", "4", "5"])
        r["housing_now_other"] = "Hotel" if r["housing_now"] == "5" else ""
        r["evicted_ever"] = rng.choice(["1", "0", "0"])
        r["evicted_count"] = ""
        r["housing_complete"] = "2"

        alc = rng.random() < 0.8
        r["alc_ever"] = "1" if alc else "0"
        days = rng.choice([0, 0, 2, 5, 10, 20]) if alc else None
        r["alc_30d_days"] = "" if days is None else str(days)
        r["alc_binge"] = rng.choice(["0", "1", "2"]) if alc and days else ""
        used = {c for c in ["1", "2", "3", "4"] if rng.random() < 0.25}
        for c in ["1", "2", "3", "4"]:
            r[f"drug_ever___{c}"] = "1" if c in used else "0"
        r["drug_ever___0"] = "0" if used else "1"
        for c in ["1", "2", "3", "4"]:
            r[f"drug_30d___{c}"] = "1" if c in used and rng.random() < 0.5 else "0"
        hard = used & {"2", "3", "4"}
        r["inject_ever"] = rng.choice(["1", "0", "0"]) if hard else ""
        r["opioid_od"] = rng.choice(["1", "0", "0"]) if "3" in used else ""
        r["naloxone"] = rng.choice(["1", "0"]) if ("3" in used or r["opioid_od"] == "1") else ""
        score = (int(r["alc_binge"]) if r["alc_binge"] else 0) + (1 if alc else 0)
        r["alc_score"] = str(score)
        r["substance_notes"] = ""
        r["substance_use_complete"] = "2"
        rows.append(r)

    # Data problems a cleaning pass should catch
    rows[2]["homeless_6mo"] = "0"          # answered although lifetime = No
    rows[2]["homeless_life"] = "0"
    rows[2]["homeless_age"] = ""
    rows[4]["gender_self"] = "Woman"       # self-description entered although gender = Woman
    rows[4]["gender"] = "1"
    for i in (5, 9, 13):                   # shown but left blank
        rows[i]["homeless_life"] = "1"
        rows[i]["homeless_age"] = ""
        rows[i]["homeless_6mo"] = rows[i]["homeless_6mo"] or "0"
    rows[7]["housing_now"] = "7"           # code that is not one of the answers
    return rows


def columns():
    cols = []
    for f in FIELDS:
        if f[3] == "descriptive":
            continue
        if f[3] == "checkbox":
            cols += [f"{f[0]}___{c}" for c, _ in choices_of(f)]
        else:
            cols.append(f[0])
        if f is [x for x in FIELDS if x[1] == f[1]][-1]:
            cols.append(f"{f[1]}_complete")
    return cols


def write_csvs(rows):
    with open(os.path.join(HERE, "housing_survey_dictionary.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Variable / Field Name", "Form Name", "Section Header", "Field Type", "Field Label",
                    "Choices, Calculations, OR Slider Labels", "Field Note",
                    "Text Validation Type OR Show Slider Number", "Text Validation Min", "Text Validation Max",
                    "Identifier?", "Branching Logic (Show field only if...)", "Required Field?",
                    "Custom Alignment", "Question Number (surveys only)", "Matrix Group Name", "Matrix Ranking?",
                    "Field Annotation"])
        for f in FIELDS:
            w.writerow([f[0], f[1], f[2], f[3], f[4], f[5], f[11], f[6], f[7], f[8], "", f[9], f[10],
                        "", "", "", "", ""])
    cols = columns()
    with open(os.path.join(HERE, "housing_survey_data.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])


def write_odm(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" ?>',
           '<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" '
           'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:redcap="https://projectredcap.org" '
           'xsi:schemaLocation="http://www.cdisc.org/ns/odm/v1.3 schema/odm/ODM1-3-1.xsd" ODMVersion="1.3.1" '
           'FileOID="000-00-0000" FileType="Snapshot" Description="Housing and Health Survey (synthetic)" '
           'AsOfDateTime="2026-11-11T12:00:00" CreationDateTime="2026-11-11T12:00:00" SourceSystem="REDCap" '
           'SourceSystemVersion="14.5.0">',
           '<Study OID="Project.HousingAndHealthSurvey">',
           '<GlobalVariables>',
           '\t<StudyName>Housing and Health Survey (synthetic)</StudyName>',
           '\t<StudyDescription>This file contains the metadata, events, and data for REDCap project '
           '"Housing and Health Survey (synthetic)".</StudyDescription>',
           '\t<ProtocolName>Housing and Health Survey (synthetic)</ProtocolName>',
           '\t<redcap:RecordAutonumberingEnabled>1</redcap:RecordAutonumberingEnabled>',
           '\t<redcap:SurveysEnabled>1</redcap:SurveysEnabled>',
           '</GlobalVariables>',
           '<MetaDataVersion OID="Metadata.HousingAndHealthSurvey_2026-11-11_1200" '
           'Name="Housing and Health Survey (synthetic)" redcap:RecordIdField="record_id">']
    groups = {}
    for form, _ in FORMS:
        fs = [f for f in FIELDS if f[1] == form]
        cur = None
        for f in fs:
            if cur is None or f[2]:
                cur = f"{form}.{f[0]}"
                groups[cur] = (f[2] or dict(FORMS)[form], [])
            groups[cur][1].append(f)
        groups[f"{form}.{form}_complete"] = ("Form Status", [(f"{form}_complete", form, "Form Status", "select",
                                                              "Complete?", "0, Incomplete | 1, Unverified | 2, Complete",
                                                              "", "", "", "", "", "")])
    for form, label in FORMS:
        out.append(f'\t<FormDef OID="Form.{form}" Name={quoteattr(label)} Repeating="No" redcap:FormName="{form}">')
        for oid in groups:
            if oid.startswith(form + "."):
                out.append(f'\t\t<ItemGroupRef ItemGroupOID="{oid}" Mandatory="No"/>')
        out.append('\t</FormDef>')
    for oid, (name, fs) in groups.items():
        out.append(f'\t<ItemGroupDef OID="{oid}" Name={quoteattr(name)} Repeating="No">')
        for f in fs:
            if f[3] == "checkbox":
                for c, _ in choices_of(f):
                    out.append(f'\t\t<ItemRef ItemOID="{f[0]}___{c}" Mandatory="No" redcap:Variable="{f[0]}"/>')
            else:
                out.append(f'\t\t<ItemRef ItemOID="{f[0]}" Mandatory="{"Yes" if f[10] else "No"}" redcap:Variable="{f[0]}"/>')
        out.append('\t</ItemGroupDef>')
    all_fields = [f for _, (_, fs) in groups.items() for f in fs]
    for f in all_fields:
        name, ftype = f[0], f[3]
        attrs = ""
        if f[2] and f[2] != "Form Status":
            attrs += f" redcap:SectionHeader={quoteattr(f[2])}"
        elif f[2] == "Form Status":
            attrs += ' redcap:SectionHeader="Form Status"'
        if f[6]:
            attrs += f' redcap:TextValidationType="{f[6]}"'
        if f[9]:
            attrs += f" redcap:BranchingLogic={quoteattr(f[9])}"
        if f[10]:
            attrs += ' redcap:RequiredField="y"'
        if ftype == "calc":
            attrs += f" redcap:Calculation={quoteattr(f[5])}"
        dtype = "integer" if f[6] == "integer" else "text"
        if ftype == "checkbox":
            for c, _ in choices_of(f):
                out.append(f'\t<ItemDef OID="{name}___{c}" Name="{name}___{c}" DataType="boolean" Length="1" '
                           f'redcap:Variable="{name}" redcap:FieldType="checkbox"{attrs}>')
                out.append(f'\t\t<Question><TranslatedText>{escape(f[4])}</TranslatedText></Question>')
                out.append(f'\t\t<CodeListRef CodeListOID="{name}___{c}.choices"/>')
                out.append('\t</ItemDef>')
            continue
        out.append(f'\t<ItemDef OID="{name}" Name="{name}" DataType="{dtype}" Length="999" '
                   f'redcap:Variable="{name}" redcap:FieldType="{ftype}"{attrs}>')
        out.append(f'\t\t<Question><TranslatedText>{escape(f[4])}</TranslatedText></Question>')
        if choices_of(f) or ftype == "select":
            out.append(f'\t\t<CodeListRef CodeListOID="{name}.choices"/>')
        if f[7] or f[8]:
            for comp, val in (("GE", f[7]), ("LE", f[8])):
                if val:
                    out.append(f'\t\t<RangeCheck Comparator="{comp}" SoftHard="Soft"><CheckValue>{val}</CheckValue>'
                               f'<ErrorMessage><TranslatedText>The value you provided is outside the suggested range.'
                               f'</TranslatedText></ErrorMessage></RangeCheck>')
        out.append('\t</ItemDef>')
    for f in all_fields:
        name, ftype = f[0], f[3]
        if ftype == "checkbox":
            for c, _ in choices_of(f):
                out.append(f'\t<CodeList OID="{name}___{c}.choices" Name="{name}___{c}" DataType="boolean" '
                           f'redcap:Variable="{name}" redcap:CheckboxChoices={quoteattr(f[5])}>')
                out.append('\t\t<CodeListItem CodedValue="1"><Decode><TranslatedText>Checked</TranslatedText></Decode></CodeListItem>')
                out.append('\t\t<CodeListItem CodedValue="0"><Decode><TranslatedText>Unchecked</TranslatedText></Decode></CodeListItem>')
                out.append('\t</CodeList>')
        elif choices_of(f) or ftype == "select":
            ch = choices_of(f) or [tuple(x.strip() for x in c.split(",", 1)) for c in f[5].split("|")]
            out.append(f'\t<CodeList OID="{name}.choices" Name="{name}" DataType="text" redcap:Variable="{name}">')
            for c, lab in ch:
                out.append(f'\t\t<CodeListItem CodedValue="{c}"><Decode><TranslatedText>{escape(lab)}'
                           f'</TranslatedText></Decode></CodeListItem>')
            out.append('\t</CodeList>')
    out.append('</MetaDataVersion>')
    out.append('</Study>')
    out.append('<ClinicalData StudyOID="Project.HousingAndHealthSurvey" '
               'MetaDataVersionOID="Metadata.HousingAndHealthSurvey_2026-11-11_1200">')
    for r in rows:
        out.append(f'\t<SubjectData SubjectKey="{r["record_id"]}" redcap:RecordIdField="record_id">')
        for form, _ in FORMS:
            out.append(f'\t\t\t<FormData FormOID="Form.{form}" FormRepeatKey="1">')
            for oid, (_, fs) in groups.items():
                if not oid.startswith(form + "."):
                    continue
                items = []
                for f in fs:
                    cols = [f"{f[0]}___{c}" for c, _ in choices_of(f)] if f[3] == "checkbox" else [f[0]]
                    for col in cols:
                        v = r.get(col, "")
                        if v != "" and f[3] != "descriptive":
                            items.append(f'\t\t\t\t\t<ItemData ItemOID="{col}" Value={quoteattr(v)}/>')
                if items:
                    out.append(f'\t\t\t\t<ItemGroupData ItemGroupOID="{oid}" ItemGroupRepeatKey="1">')
                    out.extend(items)
                    out.append('\t\t\t\t</ItemGroupData>')
            out.append('\t\t\t</FormData>')
        out.append('\t</SubjectData>')
    out.append('</ClinicalData>')
    out.append('</ODM>')
    with open(os.path.join(HERE, "housing_survey_odm.xml"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")


if __name__ == "__main__":
    data = simulate()
    write_csvs(data)
    write_odm(data)
    print("Wrote housing_survey_odm.xml, housing_survey_dictionary.csv, housing_survey_data.csv")
