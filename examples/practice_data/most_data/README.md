# MOST practice project

**Source:** ["REDCap with Most"](https://cadio.org/redcap-with-most/), published by the Center for
Advancement and Dissemination of Intervention Optimization (CADIO). The page offers an example
REDCap project (XML) for a study using the Multiphase Optimization Strategy (MOST) framework, as a
supplemental file to its manual by Chuck Cleland.

## What is committed here

- `most_practice_metadata.xml`: the REDCap CDISC ODM export of that project with all record data
  removed (every `<ClinicalData>` element stripped; metadata only). It was exported from REDCap
  8.1.11 and is longitudinal, with 41 events and 13 instruments.

The original export, `most_practice_data.xml`, includes record data. It is kept only locally and is
listed in the repository's `.gitignore`, so it is never committed.

## Run it

```bash
xml-wizard examples/practice_data/most_data/most_practice_metadata.xml --open
```

The few branching-logic rules that refer to another event (for example
`[randomization_arm_2][rand_scond]`) are flagged as "cross-event reference" and are not evaluated.
