# --- xml-wizard REDCap logic runtime (stdlib only) -------------------------
# Scalar helpers that mimic how REDCap evaluates branching logic. Values are
# raw REDCap export strings. Logic results are True, False, or None (unknown,
# e.g. an unsupported feature). This block is copied verbatim into the
# generated apply_skip_logic.py scripts, so keep it self-contained.
import math as _math
from datetime import datetime as _dt, date as _date

_NAN = float("nan")


def to_number(v):
    """Return a float for numeric-looking values, else None."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def is_blank(v):
    return v is None or (isinstance(v, str) and v.strip() == "") or (
        isinstance(v, float) and _math.isnan(v))


def to_bool(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    n = to_number(v)
    if n is not None:
        return not _math.isnan(n) and n != 0
    return not is_blank(v)


def rc_cmp(op, a, b):
    if a is None or b is None:
        return None
    if isinstance(a, bool):
        a = "1" if a else "0"
    if isinstance(b, bool):
        b = "1" if b else "0"
    na, nb = to_number(a), to_number(b)
    a_nan = isinstance(a, float) and _math.isnan(a)
    b_nan = isinstance(b, float) and _math.isnan(b)
    if a_nan or b_nan:
        return op == "<>"
    if na is not None and nb is not None:
        x, y = na, nb
    else:
        x = "" if is_blank(a) else str(a)
        y = "" if is_blank(b) else str(b)
        if op in ("<", ">", "<=", ">=") and (x == "" or y == ""):
            return False
    if op == "=":
        return x == y
    if op == "<>":
        return x != y
    if op == "<":
        return x < y
    if op == ">":
        return x > y
    if op == "<=":
        return x <= y
    if op == ">=":
        return x >= y
    return None


def rc_and(*vals):
    bools = [to_bool(v) for v in vals]
    if any(b is False for b in bools):
        return False
    if any(b is None for b in bools):
        return None
    return True


def rc_or(*vals):
    bools = [to_bool(v) for v in vals]
    if any(b is True for b in bools):
        return True
    if any(b is None for b in bools):
        return None
    return False


def rc_not(v):
    b = to_bool(v)
    return None if b is None else (not b)


def _num(v):
    if v is None:
        return None
    n = to_number(v)
    return _NAN if n is None else n


def rc_arith(op, a, b):
    x, y = _num(a), _num(b)
    if x is None or y is None:
        return None
    try:
        if op == "+":
            return x + y
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if op == "/":
            return _NAN if y == 0 else x / y
        if op == "^":
            return x ** y
    except (OverflowError, ValueError):
        return _NAN
    return None


def _nums(args):
    out = []
    for v in args:
        if v is None:
            return None
        n = to_number(v)
        if n is not None and not _math.isnan(n):
            out.append(n)
    return out


def rc_fn_sum(*args):
    ns = _nums(args)
    return None if ns is None else (sum(ns) if ns else _NAN)


def rc_fn_min(*args):
    ns = _nums(args)
    return None if ns is None else (min(ns) if ns else _NAN)


def rc_fn_max(*args):
    ns = _nums(args)
    return None if ns is None else (max(ns) if ns else _NAN)


def rc_fn_mean(*args):
    ns = _nums(args)
    return None if ns is None else (sum(ns) / len(ns) if ns else _NAN)


def rc_fn_abs(x):
    n = _num(x)
    return None if n is None else abs(n)


def rc_fn_round(x, digits="0"):
    n, d = _num(x), to_number(digits) or 0
    if n is None or _math.isnan(n):
        return n
    return float(round(n, int(d)))


def rc_fn_roundup(x, digits="0"):
    n, d = _num(x), int(to_number(digits) or 0)
    if n is None or _math.isnan(n):
        return n
    return _math.ceil(n * 10 ** d) / 10 ** d


def rc_fn_rounddown(x, digits="0"):
    n, d = _num(x), int(to_number(digits) or 0)
    if n is None or _math.isnan(n):
        return n
    return _math.floor(n * 10 ** d) / 10 ** d


def rc_fn_if(cond, a, b):
    c = to_bool(cond)
    if c is None:
        return None
    return a if c else b


def rc_fn_isblankormissingcode(x):
    return None if x is None else is_blank(x)


def rc_fn_isnumber(x):
    return None if x is None else to_number(x) is not None


def rc_fn_isinteger(x):
    n = to_number(x) if x is not None else None
    return None if x is None else (n is not None and float(n).is_integer())


def _s(x):
    return None if x is None else ("" if is_blank(x) else str(x))


def rc_fn_contains(a, b):
    a, b = _s(a), _s(b)
    return None if a is None or b is None else b.lower() in a.lower()


def rc_fn_not_contain(a, b):
    r = rc_fn_contains(a, b)
    return None if r is None else not r


def rc_fn_starts_with(a, b):
    a, b = _s(a), _s(b)
    return None if a is None or b is None else a.lower().startswith(b.lower())


def rc_fn_ends_with(a, b):
    a, b = _s(a), _s(b)
    return None if a is None or b is None else a.lower().endswith(b.lower())


def rc_fn_length(a):
    a = _s(a)
    return None if a is None else float(len(a))


def _parse_date(v):
    s = _s(v)
    if s is None:
        return None
    s = s.strip()
    if s.lower() == "today":
        return _dt.combine(_date.today(), _dt.min.time())
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%m-%d-%Y", "%d-%m-%Y"):
        try:
            return _dt.strptime(s, fmt)
        except ValueError:
            continue
    return _NAN


def rc_fn_datediff(d1, d2, units="d", fmt="ymd", signed=False):
    a, b = _parse_date(d1), _parse_date(d2)
    if a is None or b is None:
        return None
    if isinstance(a, float) or isinstance(b, float):
        return _NAN
    secs = (b - a).total_seconds()
    div = {"y": 31556952.0, "M": 2629746.0, "d": 86400.0, "h": 3600.0, "m": 60.0, "s": 1.0}
    out = secs / div.get(str(units), 86400.0)
    if isinstance(fmt, bool) or str(fmt).lower() in ("true", "false"):
        signed = fmt
    return out if to_bool(signed) else abs(out)


FUNCTIONS = {
    "sum": rc_fn_sum, "min": rc_fn_min, "max": rc_fn_max, "mean": rc_fn_mean,
    "abs": rc_fn_abs, "round": rc_fn_round, "roundup": rc_fn_roundup,
    "rounddown": rc_fn_rounddown, "if": rc_fn_if,
    "isblankormissingcode": rc_fn_isblankormissingcode, "isnumber": rc_fn_isnumber,
    "isinteger": rc_fn_isinteger, "contains": rc_fn_contains,
    "not_contain": rc_fn_not_contain, "starts_with": rc_fn_starts_with,
    "ends_with": rc_fn_ends_with, "length": rc_fn_length, "datediff": rc_fn_datediff,
}
# --- end of runtime --------------------------------------------------------
