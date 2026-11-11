"""Parse, analyse, evaluate and translate REDCap branching logic.

REDCap branching logic is a small expression language, for example::

    [ever_homeless] = '1' and ([race(3)] = '1' or [age] >= 18)

This module turns that text into a JSON-serialisable abstract syntax tree
(nested dicts), and offers helpers that work on the tree:

* :func:`parse` - text to AST (raises :class:`LogicSyntaxError`)
* :func:`references` - every field reference used in an expression
* :func:`evaluate` - evaluate against one row of data (three-valued)
* :func:`to_python` / :func:`to_r` - translate to code for generated scripts
* :func:`to_text` - plain-English rendering using field labels

AST node shapes::

    {"type": "ref", "field": "x", "code": "1" | None, "event": "e" | None}
    {"type": "smart", "name": "current-instance"}
    {"type": "lit", "value": "1", "kind": "str" | "num" | "bool"}
    {"type": "cmp", "op": "=", "left": node, "right": node}
    {"type": "bool", "op": "and" | "or", "args": [node, ...]}
    {"type": "not", "arg": node}
    {"type": "arith", "op": "+", "left": node, "right": node}
    {"type": "neg", "arg": node}
    {"type": "call", "name": "sum", "args": [node, ...]}
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from . import runtime

Node = Dict[str, Any]


class LogicSyntaxError(ValueError):
    """Raised when branching logic cannot be parsed."""


class Unsupported(Exception):
    """Raised when an expression uses a feature a translator cannot express."""


# ---------------------------------------------------------------------------
# Tokeniser
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<refs>(?:\[[^\[\]]*\])+)
  | (?P<str>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")
  | (?P<num>\d+\.\d*|\.\d+|\d+)
  | (?P<op><>|!=|<=|>=|==|&&|\|\||=|<|>|\+|-|\*|/|\^|!)
  | (?P<lp>\()
  | (?P<rp>\))
  | (?P<comma>,)
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
    """,
    re.VERBOSE,
)

_REF_PART_RE = re.compile(r"\[([^\[\]]*)\]")
_CHECKBOX_RE = re.compile(r"^([A-Za-z0-9_]+)\(([^()]*)\)$")
_FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

# Functions the evaluator and code generators understand.
SUPPORTED_FUNCTIONS = {
    "if", "sum", "min", "max", "mean", "abs", "round", "roundup", "rounddown",
    "isblankormissingcode", "isnumber", "isinteger", "contains", "not_contain",
    "starts_with", "ends_with", "length", "datediff",
}


def _tokenise(text: str) -> List[Tuple[str, str]]:
    tokens: List[Tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        m = _TOKEN_RE.match(text, pos)
        if not m:
            raise LogicSyntaxError(f"Unexpected character {text[pos]!r} at position {pos}")
        kind = m.lastgroup or ""
        if kind != "ws":
            tokens.append((kind, m.group(0)))
        pos = m.end()
    return tokens


def _ref_node(raw: str) -> Node:
    parts = [p.strip() for p in _REF_PART_RE.findall(raw)]
    if not parts:
        raise LogicSyntaxError(f"Empty field reference {raw!r}")
    event: Optional[str] = None
    # [event][field] or [event][field][instance]
    if len(parts) >= 2 and _looks_like_field(parts[1]):
        event, field_part = parts[0], parts[1]
    else:
        field_part = parts[0]
    # Strip ":value", ":checked" style modifiers
    modifier = None
    if ":" in field_part:
        field_part, modifier = field_part.split(":", 1)
    m = _CHECKBOX_RE.match(field_part)
    if m:
        node: Node = {"type": "ref", "field": m.group(1), "code": m.group(2).strip(), "event": event}
    elif _FIELD_NAME_RE.match(field_part):
        node = {"type": "ref", "field": field_part, "code": None, "event": event}
    else:
        # Smart variable such as [current-instance] or [event-name]
        return {"type": "smart", "name": raw.strip("[]")}
    if modifier:
        node["modifier"] = modifier
    return node


def _looks_like_field(part: str) -> bool:
    part = part.split(":", 1)[0]
    return bool(_FIELD_NAME_RE.match(part) or _CHECKBOX_RE.match(part))


# ---------------------------------------------------------------------------
# Parser (precedence climbing)
# ---------------------------------------------------------------------------

_CMP_OPS = {"=": "=", "==": "=", "<>": "<>", "!=": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">="}


class _Parser:
    def __init__(self, tokens: List[Tuple[str, str]]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> Tuple[str, str]:
        return self.toks[self.i] if self.i < len(self.toks) else ("eof", "")

    def take(self) -> Tuple[str, str]:
        tok = self.peek()
        self.i += 1
        return tok

    def expect(self, kind: str) -> Tuple[str, str]:
        tok = self.take()
        if tok[0] != kind:
            raise LogicSyntaxError(f"Expected {kind} but found {tok[1] or 'end of logic'!r}")
        return tok

    def _is_word(self, word: str) -> bool:
        kind, val = self.peek()
        return kind == "ident" and val.lower() == word

    def parse(self) -> Node:
        node = self.parse_or()
        if self.peek()[0] != "eof":
            raise LogicSyntaxError(f"Unexpected {self.peek()[1]!r}")
        return node

    def parse_or(self) -> Node:
        args = [self.parse_and()]
        while self._is_word("or") or self.peek() == ("op", "||"):
            self.take()
            args.append(self.parse_and())
        return args[0] if len(args) == 1 else {"type": "bool", "op": "or", "args": args}

    def parse_and(self) -> Node:
        args = [self.parse_not()]
        while self._is_word("and") or self.peek() == ("op", "&&"):
            self.take()
            args.append(self.parse_not())
        return args[0] if len(args) == 1 else {"type": "bool", "op": "and", "args": args}

    def parse_not(self) -> Node:
        if self._is_word("not") or self.peek() == ("op", "!"):
            self.take()
            return {"type": "not", "arg": self.parse_not()}
        return self.parse_cmp()

    def parse_cmp(self) -> Node:
        left = self.parse_add()
        kind, val = self.peek()
        if kind == "op" and val in _CMP_OPS:
            self.take()
            right = self.parse_add()
            return {"type": "cmp", "op": _CMP_OPS[val], "left": left, "right": right}
        return left

    def parse_add(self) -> Node:
        left = self.parse_mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.take()[1]
            left = {"type": "arith", "op": op, "left": left, "right": self.parse_mul()}
        return left

    def parse_mul(self) -> Node:
        left = self.parse_pow()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.take()[1]
            left = {"type": "arith", "op": op, "left": left, "right": self.parse_pow()}
        return left

    def parse_pow(self) -> Node:
        base = self.parse_unary()
        if self.peek() == ("op", "^"):
            self.take()
            return {"type": "arith", "op": "^", "left": base, "right": self.parse_pow()}
        return base

    def parse_unary(self) -> Node:
        if self.peek() == ("op", "-"):
            self.take()
            arg = self.parse_unary()
            if arg["type"] == "lit" and arg["kind"] == "num":
                return {"type": "lit", "value": "-" + arg["value"], "kind": "num"}
            return {"type": "neg", "arg": arg}
        if self.peek() == ("op", "+"):
            self.take()
            return self.parse_unary()
        return self.parse_atom()

    def parse_atom(self) -> Node:
        kind, val = self.take()
        if kind == "refs":
            return _ref_node(val)
        if kind == "str":
            body = val[1:-1]
            body = re.sub(r"\\(.)", r"\1", body)
            return {"type": "lit", "value": body, "kind": "str"}
        if kind == "num":
            return {"type": "lit", "value": val, "kind": "num"}
        if kind == "lp":
            node = self.parse_or()
            self.expect("rp")
            return node
        if kind == "ident":
            low = val.lower()
            if low in ("true", "false"):
                return {"type": "lit", "value": "1" if low == "true" else "0", "kind": "bool"}
            if self.peek()[0] == "lp":
                self.take()
                args: List[Node] = []
                if self.peek()[0] != "rp":
                    args.append(self.parse_or())
                    while self.peek()[0] == "comma":
                        self.take()
                        args.append(self.parse_or())
                self.expect("rp")
                return {"type": "call", "name": low, "args": args}
            raise LogicSyntaxError(f"Unknown word {val!r} (missing brackets around a field name?)")
        if kind == "eof":
            raise LogicSyntaxError("Logic ends unexpectedly")
        raise LogicSyntaxError(f"Unexpected {val!r}")


def parse(text: str) -> Node:
    """Parse REDCap logic text into an AST. Raises LogicSyntaxError."""
    text = (text or "").strip()
    if not text:
        raise LogicSyntaxError("Empty logic")
    # REDCap allows line breaks and HTML entities in logic exported via XML
    text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    return _Parser(_tokenise(text)).parse()


# ---------------------------------------------------------------------------
# Tree utilities
# ---------------------------------------------------------------------------

def walk(node: Node) -> Iterator[Node]:
    yield node
    t = node["type"]
    if t in ("cmp", "arith"):
        yield from walk(node["left"])
        yield from walk(node["right"])
    elif t in ("bool", "call"):
        for a in node["args"]:
            yield from walk(a)
    elif t in ("not", "neg"):
        yield from walk(node["arg"])


def references(node: Node) -> List[Node]:
    return [n for n in walk(node) if n["type"] == "ref"]


def referenced_fields(node: Node) -> List[str]:
    seen: List[str] = []
    for r in references(node):
        if r["field"] not in seen:
            seen.append(r["field"])
    return seen


def functions_used(node: Node) -> List[str]:
    return sorted({n["name"] for n in walk(node) if n["type"] == "call"})


def unsupported_features(node: Node) -> List[str]:
    out = set()
    for n in walk(node):
        if n["type"] == "call" and n["name"] not in SUPPORTED_FUNCTIONS:
            out.add(f"function {n['name']}()")
        elif n["type"] == "smart":
            out.add(f"smart variable [{n['name']}]")
        elif n["type"] == "ref" and n.get("event"):
            out.add("cross-event reference")
    return sorted(out)


def column_for(ref: Node) -> str:
    """Name of the export column a reference reads."""
    if ref.get("code") is not None:
        return f"{ref['field']}___{_code_suffix(ref['code'])}"
    return ref["field"]


def _code_suffix(code: str) -> str:
    # REDCap exports checkbox code "-1" as "____1" and "1.5" as "___1_5"
    return re.sub(r"[^A-Za-z0-9_]", "_", code).lower()


# ---------------------------------------------------------------------------
# Evaluation (row of string values -> True / False / None for unknown)
# ---------------------------------------------------------------------------

def evaluate(node: Node, row: Dict[str, str]) -> Any:
    """Evaluate against a row of raw REDCap values (strings).

    Returns True/False for boolean logic, a value for arithmetic, or None
    when the result cannot be determined (unsupported feature).
    """
    t = node["type"]
    if t == "ref":
        if node.get("event"):
            # We only see the current row; cross-event values are unknown.
            col = column_for(node)
            return row.get(col, None) if col in row else None
        return row.get(column_for(node), "")
    if t == "lit":
        return node["value"]
    if t == "smart":
        return None
    if t == "cmp":
        return runtime.rc_cmp(node["op"], evaluate(node["left"], row), evaluate(node["right"], row))
    if t == "bool":
        vals = [evaluate(a, row) for a in node["args"]]
        return runtime.rc_and(*vals) if node["op"] == "and" else runtime.rc_or(*vals)
    if t == "not":
        return runtime.rc_not(evaluate(node["arg"], row))
    if t == "arith":
        return runtime.rc_arith(node["op"], evaluate(node["left"], row), evaluate(node["right"], row))
    if t == "neg":
        return runtime.rc_arith("-", "0", evaluate(node["arg"], row))
    if t == "call":
        fn = runtime.FUNCTIONS.get(node["name"])
        if fn is None:
            return None
        return fn(*[evaluate(a, row) for a in node["args"]])
    return None


# ---------------------------------------------------------------------------
# Code generation
# ---------------------------------------------------------------------------

def _gen(node: Node, ref: Callable[[Node], str], lit: Callable[[str], str], fn_prefix: str,
         list_open: str = "", list_close: str = "") -> str:
    t = node["type"]
    g = lambda n: _gen(n, ref, lit, fn_prefix, list_open, list_close)  # noqa: E731
    if t == "ref":
        if node.get("event"):
            raise Unsupported("cross-event reference")
        return ref(node)
    if t == "lit":
        return lit(node["value"])
    if t == "smart":
        raise Unsupported(f"smart variable [{node['name']}]")
    if t == "cmp":
        return f'{fn_prefix}cmp("{node["op"]}", {g(node["left"])}, {g(node["right"])})'
    if t == "bool":
        return f"{fn_prefix}{node['op']}({', '.join(g(a) for a in node['args'])})"
    if t == "not":
        return f"{fn_prefix}not({g(node['arg'])})"
    if t == "arith":
        return f'{fn_prefix}arith("{node["op"]}", {g(node["left"])}, {g(node["right"])})'
    if t == "neg":
        return f'{fn_prefix}arith("-", {lit("0")}, {g(node["arg"])})'
    if t == "call":
        if node["name"] not in SUPPORTED_FUNCTIONS:
            raise Unsupported(f"function {node['name']}()")
        return f"{fn_prefix}fn_{node['name']}({', '.join(g(a) for a in node['args'])})"
    raise Unsupported(t)


def _py_str(s: str) -> str:
    return repr(str(s))


def _r_str(s: str) -> str:
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def to_python(node: Node) -> str:
    """Translate to a Python expression over a dict ``r`` using runtime helpers."""
    return _gen(node, lambda n: f"r.get({_py_str(column_for(n))}, '')", _py_str, "rc_")


def to_r(node: Node) -> str:
    """Translate to an R expression over a named character vector ``r``."""
    return _gen(node, lambda n: f"rc_get(r, {_r_str(column_for(n))})", _r_str, "rc_")


# ---------------------------------------------------------------------------
# Plain-English rendering
# ---------------------------------------------------------------------------

_OP_WORDS = {"=": "is", "<>": "is not", "<": "is less than", ">": "is greater than",
             "<=": "is at most", ">=": "is at least"}


def to_text(node: Node, lookup: Optional[Callable[[str], Any]] = None, _top: bool = True) -> str:
    """Render logic as readable English.

    ``lookup(field_name)`` may return an object with ``label`` and
    ``choice_label(code)`` used to show answer labels instead of codes.
    """
    t = node["type"]
    rec = lambda n: to_text(n, lookup, False)  # noqa: E731
    if t == "bool":
        joiner = f" {node['op'].upper()} "
        inner = joiner.join(rec(a) for a in node["args"])
        return inner if _top else f"({inner})"
    if t == "not":
        return f"NOT {rec(node['arg'])}"
    if t == "cmp":
        left, right, op = node["left"], node["right"], node["op"]
        if right["type"] == "ref" and left["type"] == "lit":
            left, right = right, left
            op = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}.get(op, op)
        if left["type"] == "ref" and right["type"] == "lit":
            return _ref_cmp_text(left, op, right["value"], lookup)
        return f"{rec(left)} {_OP_WORDS[op]} {rec(right)}"
    if t == "ref":
        return _ref_name(node)
    if t == "lit":
        return f"'{node['value']}'" if node["kind"] == "str" else node["value"]
    if t == "smart":
        return f"[{node['name']}]"
    if t == "arith":
        return f"{rec(node['left'])} {node['op']} {rec(node['right'])}"
    if t == "neg":
        return f"-{rec(node['arg'])}"
    if t == "call":
        return f"{node['name']}({', '.join(rec(a) for a in node['args'])})"
    return "?"


def _ref_name(ref: Node) -> str:
    base = ref["field"] if ref.get("code") is None else f"{ref['field']}({ref['code']})"
    return f"{ref['event']}:{base}" if ref.get("event") else base


def _ref_cmp_text(ref: Node, op: str, value: str, lookup) -> str:
    name = _ref_name(ref)
    field = lookup(ref["field"]) if lookup else None
    if ref.get("code") is not None:
        option = field.choice_label(ref["code"]) if field else None
        opt = f'"{option}"' if option else f"option {ref['code']}"
        name = f"{ref['field']}: {opt}"
        if op in ("=", "<>") and value in ("1", "0"):
            checked = (value == "1") == (op == "=")
            return f"{name} is {'checked' if checked else 'not checked'}"
    if value == "" and op in ("=", "<>"):
        return f"{name} is {'blank' if op == '=' else 'answered'}"
    label = field.choice_label(value) if field and op in ("=", "<>") else None
    shown = f'"{label}" ({value})' if label else (value if _is_num(value) else f"'{value}'")
    return f"{name} {_OP_WORDS[op]} {shown}"


def _is_num(s: str) -> bool:
    return runtime.to_number(s) is not None


def simple_conditions(node: Node) -> Optional[List[Tuple[Node, str, str]]]:
    """If logic is a conjunction of `[ref] op 'literal'` tests, return them.

    Used to derive implied values: e.g. ``[ever_homeless] = '1'``.
    """
    items = node["args"] if node["type"] == "bool" and node["op"] == "and" else [node]
    out = []
    for it in items:
        if it["type"] != "cmp":
            return None
        left, right = it["left"], it["right"]
        if left["type"] == "ref" and right["type"] == "lit" and not left.get("event"):
            out.append((left, it["op"], right["value"]))
        else:
            return None
    return out
