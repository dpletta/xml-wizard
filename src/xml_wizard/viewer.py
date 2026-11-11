"""Write the self-contained, offline HTML tree viewer."""

from __future__ import annotations

import html
import json
import os
from typing import Any, Dict

_TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "viewer_template.html")


def render_viewer(codebook: Dict[str, Any]) -> str:
    with open(_TEMPLATE, encoding="utf-8") as fh:
        template = fh.read()
    payload = json.dumps(codebook, ensure_ascii=False, separators=(",", ":"))
    # Keep the JSON from closing the <script> element early
    payload = payload.replace("</", "<\\/").replace("<!--", "<\\!--")
    title = html.escape(f"{codebook['project']['title']} · XML Wizard")
    return template.replace("__XMLW_TITLE__", title, 1).replace("__XMLW_DATA__", payload, 1)


def write_viewer(codebook: Dict[str, Any], path: str) -> str:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_viewer(codebook))
    return path
