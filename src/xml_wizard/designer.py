"""Build the self-contained, offline survey designer (one HTML file).

The designer is a browser app: people drag question types onto a canvas, draw
branching by dragging an answer onto another question, preview the survey, and
download REDCap project XML or a data dictionary CSV. It can open either file
again, so a project can go REDCap -> designer -> REDCap.
"""

from __future__ import annotations

import json
import os
import re
from typing import Optional

_APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "designer_app")
_CLINICAL_RE = re.compile(r"<ClinicalData\b.*?</ClinicalData\s*>", re.DOTALL)


def _read(name: str) -> str:
    with open(os.path.join(_APP_DIR, name), encoding="utf-8") as fh:
        return fh.read()


def strip_records(text: str) -> str:
    """Remove participant records (<ClinicalData>) from REDCap project XML."""
    return _CLINICAL_RE.sub("", text)


def _json_safe(text: str) -> str:
    # Keep embedded JSON from closing the <script> element it sits in.
    return text.replace("</", "<\\/").replace("<!--", "<\\!--")


def _code_safe(text: str) -> str:
    # The same for JavaScript, where only a literal "</script" could do it.
    return re.sub(r"</(script)", r"<\\/\1", text, flags=re.IGNORECASE)


def render_designer(project_text: Optional[str] = None, project_name: str = "") -> str:
    """Return the designer as one HTML document.

    ``project_text`` (REDCap project XML or a data dictionary CSV) is opened
    when the page loads. Records in the XML are removed first, so the HTML
    never carries participant data.
    """
    preload = "null"
    if project_text is not None:
        preload = json.dumps({"name": project_name, "text": strip_records(project_text)}, ensure_ascii=False)
    html = _read("index.html")
    # Function replacements so backslashes in the sources are kept as they are.
    for marker, content in (
        ("/*__XMLW_CSS__*/", _read("app.css")),
        ("/*__XMLW_CORE__*/", _code_safe(_read("core.js"))),
        ("/*__XMLW_APP__*/", _code_safe(_read("app.js"))),
        ("__XMLW_PRELOAD__", _json_safe(preload)),
    ):
        html = html.replace(marker, content, 1)
    return html


def write_designer(path: str, project_path: Optional[str] = None) -> str:
    text = None
    name = ""
    if project_path:
        with open(project_path, "rb") as fh:
            raw = fh.read()
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        name = os.path.basename(project_path)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_designer(text, name))
    return path
