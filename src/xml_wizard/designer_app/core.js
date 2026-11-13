/* XML Wizard designer core: survey model, REDCap import/export, branching logic.
 *
 * No DOM and no dependencies, so the same file runs in the browser (inlined
 * into designer.html as the global XMLWCore) and in Node (for the tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XMLWCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function InputError(message) {
    this.name = "InputError";
    this.message = message;
  }
  InputError.prototype = Object.create(Error.prototype);

  // -------------------------------------------------------------------------
  // XML (a small parser: ODM files are plain elements, attributes and text)
  // -------------------------------------------------------------------------

  var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

  function decodeEntities(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === "#") {
        var hex = e.charAt(1) === "x" || e.charAt(1) === "X";
        var cp = hex ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch (err) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
    });
  }

  function escText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escAttr(s) {
    return escText(s).replace(/"/g, "&quot;").replace(/'/g, "&#039;")
      .replace(/\r\n?|\n/g, "&#10;").replace(/\t/g, "&#9;");
  }

  function parseXml(text) {
    var i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    var n = text.length;
    var doc = { name: "#document", attrs: [], children: [] };
    var stack = [doc];
    var nameRe = /[^\s\/>=]+/y;
    var wsRe = /\s*/y;

    function fail(msg) { throw new InputError("This file is not valid XML (" + msg + ")."); }
    function skipWs() { wsRe.lastIndex = i; wsRe.exec(text); i = wsRe.lastIndex; }

    while (i < n) {
      var lt = text.indexOf("<", i);
      var top = stack[stack.length - 1];
      if (lt < 0) { top.children.push(decodeEntities(text.slice(i))); break; }
      if (lt > i) top.children.push(decodeEntities(text.slice(i, lt)));
      var end;
      if (text.startsWith("<!--", lt)) {
        end = text.indexOf("-->", lt + 4);
        if (end < 0) fail("unclosed comment");
        i = end + 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        end = text.indexOf("]]>", lt + 9);
        if (end < 0) fail("unclosed CDATA section");
        top.children.push(text.slice(lt + 9, end));
        i = end + 3;
      } else if (text.startsWith("<?", lt)) {
        end = text.indexOf("?>", lt + 2);
        if (end < 0) fail("unclosed processing instruction");
        i = end + 2;
      } else if (text.startsWith("<!", lt)) {
        var depth = 0;
        for (end = lt; end < n; end++) {
          var ch = text.charAt(end);
          if (ch === "[") depth++;
          else if (ch === "]") depth--;
          else if (ch === ">" && depth <= 0) break;
        }
        i = end + 1;
      } else if (text.charAt(lt + 1) === "/") {
        end = text.indexOf(">", lt);
        if (end < 0) fail("unclosed tag");
        var closing = text.slice(lt + 2, end).trim();
        if (stack.length < 2 || top.name !== closing) fail("unexpected </" + closing + ">");
        stack.pop();
        i = end + 1;
      } else {
        nameRe.lastIndex = lt + 1;
        var m = nameRe.exec(text);
        if (!m) fail("stray '<'");
        var node = { name: m[0], attrs: [], children: [] };
        i = nameRe.lastIndex;
        var selfClosing = false;
        for (;;) {
          skipWs();
          if (i >= n) fail("unclosed <" + node.name + ">");
          if (text.charAt(i) === ">") { i++; break; }
          if (text.charAt(i) === "/" && text.charAt(i + 1) === ">") { i += 2; selfClosing = true; break; }
          nameRe.lastIndex = i;
          var am = nameRe.exec(text);
          if (!am) fail("bad attribute in <" + node.name + ">");
          i = nameRe.lastIndex;
          skipWs();
          if (text.charAt(i) !== "=") fail("attribute without a value in <" + node.name + ">");
          i++;
          skipWs();
          var q = text.charAt(i);
          if (q !== '"' && q !== "'") fail("unquoted attribute in <" + node.name + ">");
          var close = text.indexOf(q, i + 1);
          if (close < 0) fail("unclosed attribute in <" + node.name + ">");
          node.attrs.push([am[0], decodeEntities(text.slice(i + 1, close))]);
          i = close + 1;
        }
        top.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
    if (stack.length > 1) fail("<" + stack[stack.length - 1].name + "> is never closed");
    return doc;
  }

  function serializeXml(node) {
    var a = node.attrs.map(function (kv) { return " " + kv[0] + '="' + escAttr(kv[1]) + '"'; }).join("");
    if (!node.children.length) return "<" + node.name + a + "/>";
    return "<" + node.name + a + ">" + node.children.map(function (c) {
      return typeof c === "string" ? escText(c) : serializeXml(c);
    }).join("") + "</" + node.name + ">";
  }

  function local(name) { var k = name.indexOf(":"); return k < 0 ? name : name.slice(k + 1); }
  function elements(node) { return node.children.filter(function (c) { return typeof c !== "string"; }); }
  function kids(node, name) { return elements(node).filter(function (c) { return local(c.name) === name; }); }
  function kid(node, name) { return node ? kids(node, name)[0] || null : null; }
  function attr(node, name, dflt) {
    for (var k = 0; k < node.attrs.length; k++) {
      if (node.attrs[k][0] === name || local(node.attrs[k][0]) === name) return node.attrs[k][1];
    }
    return dflt === undefined ? "" : dflt;
  }
  function textOf(node) {
    if (!node) return "";
    return node.children.map(function (c) { return typeof c === "string" ? c : textOf(c); }).join("");
  }
  function findDeep(node, name) {
    var els = elements(node);
    for (var k = 0; k < els.length; k++) {
      if (local(els[k].name) === name) return els[k];
      var hit = findDeep(els[k], name);
      if (hit) return hit;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // CSV
  // -------------------------------------------------------------------------

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], cell = "", inQ = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = ""; i++; continue;
      }
      cell += ch; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function csvCell(v) {
    v = v == null ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // -------------------------------------------------------------------------
  // Model
  // -------------------------------------------------------------------------

  var CHOICE_TYPES = { radio: 1, dropdown: 1, checkbox: 1 };
  var CODED_TYPES = { radio: 1, dropdown: 1, checkbox: 1, yesno: 1, truefalse: 1 };

  // What people drag from the palette. `type` and `validation` are REDCap's.
  var KINDS = [
    { key: "text", label: "Short answer", glyph: "Aa", type: "text", hint: "A word or a line of text" },
    { key: "notes", label: "Long answer", glyph: "¶", type: "notes", hint: "A paragraph of free text" },
    { key: "integer", label: "Whole number", glyph: "123", type: "text", validation: "integer", hint: "Age, counts" },
    { key: "number", label: "Decimal number", glyph: "1.5", type: "text", validation: "number", hint: "Weight, lab values" },
    { key: "date", label: "Date", glyph: "31", type: "text", validation: "date_ymd", hint: "A calendar date" },
    { key: "yesno", label: "Yes / No", glyph: "Y/N", type: "yesno", hint: "Coded 1 = Yes, 0 = No" },
    { key: "radio", label: "Pick one", glyph: "◉", type: "radio", hint: "Radio buttons, one answer" },
    { key: "dropdown", label: "Dropdown", glyph: "▾", type: "dropdown", hint: "One answer from a long list" },
    { key: "checkbox", label: "Pick any", glyph: "☑", type: "checkbox", hint: "Checkboxes, several answers" },
    { key: "slider", label: "Slider", glyph: "⟷", type: "slider", validation: "number", hint: "A 0 to 100 scale" },
    { key: "email", label: "Email", glyph: "@", type: "text", validation: "email", hint: "Checked as an email address" },
    { key: "calc", label: "Calculated", glyph: "ƒx", type: "calc", hint: "Worked out from other answers" },
    { key: "file", label: "File upload", glyph: "⇪", type: "file", hint: "A document or image" },
    { key: "descriptive", label: "Text block", glyph: "T", type: "descriptive", hint: "Instructions, no answer", layout: true },
    { key: "section", label: "Section heading", glyph: "§", hint: "A heading between questions", layout: true }
  ];
  var KIND_BY_KEY = {};
  KINDS.forEach(function (k) { KIND_BY_KEY[k.key] = k; });

  var TYPE_LABELS = {
    text: "Short answer", notes: "Long answer", radio: "Pick one", dropdown: "Dropdown", checkbox: "Pick any",
    yesno: "Yes / No", truefalse: "True / False", calc: "Calculated", descriptive: "Text block",
    slider: "Slider", file: "File upload", sql: "SQL dropdown"
  };

  var VALIDATIONS = [
    ["", "Any text"], ["integer", "Whole number"], ["number", "Decimal number"],
    ["date_ymd", "Date (Y-M-D)"], ["date_mdy", "Date (M-D-Y)"], ["date_dmy", "Date (D-M-Y)"],
    ["datetime_ymd", "Date and time (Y-M-D)"], ["datetime_mdy", "Date and time (M-D-Y)"],
    ["datetime_dmy", "Date and time (D-M-Y)"], ["time", "Time (HH:MM)"], ["email", "Email"],
    ["phone", "Phone (North America)"], ["zipcode", "Zip code (US)"], ["alpha_only", "Letters only"]
  ];

  var uidCounter = 0;
  function uid() {
    uidCounter += 1;
    return "i" + Date.now().toString(36) + uidCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function stripHtml(s) {
    if (!s) return "";
    return decodeEntities(String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")).replace(/\s+/g, " ").trim();
  }

  var STOP_WORDS = {};
  ("a an the of in on at to for with and or is are was were be been do does did have has had you your yours " +
   "what which who when where how please this that it its as by from if any there their they we our us i my " +
   "me would could should will can").split(" ").forEach(function (w) { STOP_WORDS[w] = 1; });

  function slugify(label, fallback) {
    var words = stripHtml(label).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ")
      .filter(Boolean);
    var kept = words.filter(function (w) { return !STOP_WORDS[w]; });
    if (!kept.length) kept = words;
    var s = "";
    for (var k = 0; k < kept.length; k++) {
      var next = s ? s + "_" + kept[k] : kept[k];
      if (next.length > 26) { if (!s) s = kept[k].slice(0, 26); break; }
      s = next;
    }
    if (!s) s = fallback || "question";
    if (!/^[a-z]/.test(s)) s = (fallback && /^[a-z]/.test(fallback) ? fallback.charAt(0) : "q") + "_" + s;
    return s.slice(0, 26).replace(/_+$/, "");
  }

  function isField(item) { return item.kind === "field"; }

  function allFields(project) {
    var out = [];
    project.forms.forEach(function (form) {
      form.items.forEach(function (it) { if (isField(it)) out.push(it); });
    });
    return out;
  }

  function fieldIndex(project) {
    var idx = {}, order = 0;
    project.forms.forEach(function (form) {
      form.items.forEach(function (it) {
        if (isField(it) && !idx[it.name]) idx[it.name] = { field: it, form: form, order: order };
        if (isField(it)) order++;
      });
    });
    return idx;
  }

  function findItem(project, id) {
    for (var f = 0; f < project.forms.length; f++) {
      var items = project.forms[f].items;
      for (var k = 0; k < items.length; k++) {
        if (items[k].id === id) return { item: items[k], form: project.forms[f], index: k };
      }
    }
    return null;
  }

  function takenNames(project, exceptId) {
    var taken = {};
    project.forms.forEach(function (form) {
      taken[form.name + "_complete"] = 1;
      form.items.forEach(function (it) { if (isField(it) && it.id !== exceptId) taken[it.name] = 1; });
    });
    return taken;
  }

  function uniqueName(project, base, exceptId) {
    var taken = takenNames(project, exceptId);
    if (!taken[base]) return base;
    for (var k = 2; ; k++) {
      var suffix = "_" + k;
      var cand = base.slice(0, 26 - suffix.length).replace(/_+$/, "") + suffix;
      if (!taken[cand]) return cand;
    }
  }

  function uniqueFormName(project, base, exceptId) {
    var taken = {};
    project.forms.forEach(function (f) { if (f.id !== exceptId) taken[f.name] = 1; });
    if (!taken[base]) return base;
    for (var k = 2; ; k++) if (!taken[base + "_" + k]) return base + "_" + k;
  }

  function formSlug(label) {
    var s = stripHtml(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    if (!s) s = "instrument";
    if (!/^[a-z]/.test(s)) s = "form_" + s;
    return s;
  }

  function newField(props) {
    var f = {
      id: uid(), kind: "field", name: "", autoName: true, type: "text", label: "", choices: [],
      note: "", validation: "", min: "", max: "", required: false, identifier: false,
      logic: "", calc: "", annotation: "", extra: []
    };
    for (var k in props) f[k] = props[k];
    if (f.type === "yesno" && !f.choices.length) f.choices = [{ code: "1", label: "Yes" }, { code: "0", label: "No" }];
    if (f.type === "truefalse" && !f.choices.length) f.choices = [{ code: "1", label: "True" }, { code: "0", label: "False" }];
    return f;
  }

  function newSection(label) { return { id: uid(), kind: "section", label: label || "" }; }

  function newForm(project, label) {
    label = label || "New instrument";
    return { id: uid(), name: uniqueFormName(project, formSlug(label)), autoName: true, label: label, items: [] };
  }

  function newProject(title) {
    var project = { title: title || "My survey", forms: [], keep: null, source: null };
    var form = newForm(project, "Survey");
    form.items.push(newField({ name: "record_id", autoName: false, label: "Record ID" }));
    project.forms.push(form);
    return project;
  }

  // Create an item from a palette kind, named so it does not clash.
  function createFromKind(project, key) {
    var kind = KIND_BY_KEY[key];
    if (!kind) throw new Error("Unknown kind " + key);
    if (key === "section") return newSection("New section");
    var f = newField({ type: kind.type, validation: kind.validation || "" });
    if (CHOICE_TYPES[kind.type]) {
      f.choices = [{ code: "1", label: "Option 1" }, { code: "2", label: "Option 2" }, { code: "3", label: "Option 3" }];
    }
    f.name = uniqueName(project, key === "descriptive" ? "info" : "question");
    return f;
  }

  function kindOf(field) {
    if (field.kind === "section") return KIND_BY_KEY.section;
    for (var k = 0; k < KINDS.length; k++) {
      if (KINDS[k].type === field.type && (KINDS[k].validation || "") === (field.validation || "")) return KINDS[k];
    }
    if (field.type === "text") {
      var v = field.validation || "";
      var base = /^date/.test(v) ? KIND_BY_KEY.date : /^(number|integer)/.test(v) ? KIND_BY_KEY.number : KIND_BY_KEY.text;
      var lab = null;
      VALIDATIONS.forEach(function (p) { if (p[0] === v) lab = p[1]; });
      return { key: base.key, label: lab || "Short answer (" + v + ")", glyph: base.glyph, type: "text", validation: v };
    }
    return { key: field.type, label: TYPE_LABELS[field.type] || field.type, glyph: field.type === "truefalse" ? "T/F" : "?", type: field.type };
  }

  function parseChoices(text) {
    var out = [];
    String(text || "").split(/\s*\|\s*|\\n|\r?\n/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var k = part.indexOf(",");
      if (k >= 0) out.push({ code: part.slice(0, k).trim(), label: part.slice(k + 1).trim() });
      else out.push({ code: part, label: part });
    });
    return out;
  }

  function choicesText(choices) {
    return choices.map(function (c) { return c.code + ", " + c.label; }).join(" | ");
  }

  function nextCode(choices) {
    var max = 0;
    choices.forEach(function (c) { if (/^\d+$/.test(c.code)) max = Math.max(max, parseInt(c.code, 10)); });
    return String(max + 1);
  }

  // -------------------------------------------------------------------------
  // Branching logic: tokens, a small parser, plain rules, evaluation
  // -------------------------------------------------------------------------

  function tokenize(src) {
    var toks = [], i = 0, n = src.length, m;
    var numRe = /\d+(\.\d+)?|\.\d+/y, idRe = /[A-Za-z_][A-Za-z0-9_]*/y;
    while (i < n) {
      var ch = src.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "[") {
        var close = src.indexOf("]", i);
        if (close < 0) throw new Error("A '[' is never closed");
        toks.push({ t: "ref", v: src.slice(i + 1, close).trim() });
        i = close + 1; continue;
      }
      if (ch === "'" || ch === '"') {
        var endq = src.indexOf(ch, i + 1);
        if (endq < 0) throw new Error("A quote is never closed");
        toks.push({ t: "str", v: src.slice(i + 1, endq) });
        i = endq + 1; continue;
      }
      numRe.lastIndex = i;
      if ((m = numRe.exec(src))) { toks.push({ t: "num", v: m[0] }); i = numRe.lastIndex; continue; }
      idRe.lastIndex = i;
      if ((m = idRe.exec(src))) {
        var w = m[0].toLowerCase();
        toks.push(w === "and" || w === "or" || w === "not" ? { t: "op", v: w } : { t: "id", v: m[0] });
        i = idRe.lastIndex; continue;
      }
      var two = src.substr(i, 2);
      if (two === "<>" || two === "!=" || two === ">=" || two === "<=" || two === "&&" || two === "||") {
        toks.push({ t: "op", v: two === "!=" ? "<>" : two === "&&" ? "and" : two === "||" ? "or" : two });
        i += 2; continue;
      }
      if ("=<>+-*/(),!".indexOf(ch) >= 0) { toks.push({ t: "op", v: ch === "!" ? "not" : ch }); i++; continue; }
      throw new Error("Unexpected character '" + ch + "'");
    }
    return toks;
  }

  var CMP = { "=": 1, "<>": 1, ">": 1, ">=": 1, "<": 1, "<=": 1 };

  function parseLogic(src) {
    var toks = tokenize(src), p = 0;
    function peek(v) { return p < toks.length && toks[p].t === "op" && toks[p].v === v; }
    function parseOr() {
      var left = parseAnd();
      while (peek("or")) { p++; left = { k: "or", a: left, b: parseAnd() }; }
      return left;
    }
    function parseAnd() {
      var left = parseNot();
      while (peek("and")) { p++; left = { k: "and", a: left, b: parseNot() }; }
      return left;
    }
    function parseNot() {
      if (peek("not")) { p++; return { k: "not", a: parseNot() }; }
      return parseCmp();
    }
    function parseCmp() {
      var left = parseAdd();
      if (p < toks.length && toks[p].t === "op" && CMP[toks[p].v]) {
        var op = toks[p++].v;
        return { k: "cmp", op: op, a: left, b: parseAdd() };
      }
      return left;
    }
    function parseAdd() {
      var left = parseMul();
      while (peek("+") || peek("-")) { var op = toks[p++].v; left = { k: "math", op: op, a: left, b: parseMul() }; }
      return left;
    }
    function parseMul() {
      var left = parseUnary();
      while (peek("*") || peek("/")) { var op = toks[p++].v; left = { k: "math", op: op, a: left, b: parseUnary() }; }
      return left;
    }
    function parseUnary() {
      if (peek("-")) { p++; return { k: "math", op: "-", a: { k: "num", v: "0" }, b: parseUnary() }; }
      if (peek("+")) { p++; return parseUnary(); }
      return parsePrimary();
    }
    function parsePrimary() {
      var t = toks[p];
      if (!t) throw new Error("The logic ends too early");
      if (t.t === "num") { p++; return { k: "num", v: t.v }; }
      if (t.t === "str") { p++; return { k: "str", v: t.v }; }
      if (t.t === "ref") {
        p++;
        var ref = { k: "ref", name: t.v, code: null, event: null };
        if (toks[p] && toks[p].t === "ref") { ref.event = t.v; ref.name = toks[p].v; p++; }
        var cm = /^([^()]+)\(([^()]*)\)$/.exec(ref.name);
        if (cm) { ref.name = cm[1].trim(); ref.code = cm[2].trim(); }
        return ref;
      }
      if (t.t === "id") {
        p++;
        if (!peek("(")) throw new Error("Unexpected word '" + t.v + "'");
        p++;
        var args = [];
        if (!peek(")")) {
          args.push(parseOr());
          while (peek(",")) { p++; args.push(parseOr()); }
        }
        if (!peek(")")) throw new Error("A '(' is never closed");
        p++;
        return { k: "fn", name: t.v, args: args };
      }
      if (peek("(")) {
        p++;
        var inner = parseOr();
        if (!peek(")")) throw new Error("A '(' is never closed");
        p++;
        return inner;
      }
      throw new Error("Unexpected '" + t.v + "'");
    }
    var ast = parseOr();
    if (p < toks.length) throw new Error("Unexpected '" + toks[p].v + "'");
    return ast;
  }

  function tryParse(src) {
    if (!src || !src.trim()) return null;
    try { return parseLogic(src); } catch (e) { return null; }
  }

  function walk(ast, fn) {
    if (!ast) return;
    fn(ast);
    if (ast.a) walk(ast.a, fn);
    if (ast.b) walk(ast.b, fn);
    if (ast.args) ast.args.forEach(function (x) { walk(x, fn); });
  }

  // Fields mentioned in a logic or calculation string: [{name, code, event}]
  function logicRefs(src) {
    var refs = [];
    var ast = tryParse(src);
    if (ast) {
      walk(ast, function (node) { if (node.k === "ref") refs.push({ name: node.name, code: node.code, event: node.event }); });
      return refs;
    }
    var re = /\[([a-z][a-z0-9_]*)(?:\(([^()\]]*)\))?\]/g, m;
    while ((m = re.exec(src || ""))) refs.push({ name: m[1], code: m[2] == null ? null : m[2], event: null });
    return refs;
  }

  // "[a] = '1' and [b(2)] = '1'" -> {join, rules} when the logic is a flat list
  // of comparisons a person can edit with dropdowns; null when it is not.
  function simpleRules(src) {
    var ast = tryParse(src);
    if (!ast) return null;
    var join = ast.k === "or" ? "or" : "and";
    var terms = [];
    (function flatten(node) {
      if (node.k === join && (node.k === "and" || node.k === "or")) { flatten(node.a); flatten(node.b); }
      else terms.push(node);
    })(ast);
    var rules = [];
    for (var k = 0; k < terms.length; k++) {
      var t = terms[k];
      if (t.k !== "cmp" || t.a.k !== "ref" || t.a.event || (t.b.k !== "str" && t.b.k !== "num")) return null;
      if (t.a.code != null) {
        if (t.b.v !== "1" && t.b.v !== "0") return null;
        if (t.op !== "=" && t.op !== "<>") return null;
        var checked = (t.b.v === "1") === (t.op === "=");
        rules.push({ field: t.a.name, code: t.a.code, op: checked ? "checked" : "unchecked", value: "" });
      } else if (t.b.v === "" && (t.op === "=" || t.op === "<>")) {
        rules.push({ field: t.a.name, code: null, op: t.op === "=" ? "empty" : "answered", value: "" });
      } else {
        rules.push({ field: t.a.name, code: null, op: t.op, value: t.b.v });
      }
    }
    return { join: join, rules: rules };
  }

  function ruleToLogic(r) {
    if (r.op === "checked" || r.op === "unchecked") return "[" + r.field + "(" + r.code + ")] = '" + (r.op === "checked" ? "1" : "0") + "'";
    if (r.op === "empty") return "[" + r.field + "] = ''";
    if (r.op === "answered") return "[" + r.field + "] <> ''";
    var numeric = /^-?\d+(\.\d+)?$/.test(r.value);
    var bare = numeric && r.op !== "=" && r.op !== "<>";
    return "[" + r.field + "] " + r.op + " " + (bare ? r.value : "'" + String(r.value).replace(/'/g, "") + "'");
  }

  function rulesToLogic(spec) {
    return spec.rules.filter(function (r) { return r.field; }).map(ruleToLogic).join(spec.join === "or" ? " or " : " and ");
  }

  // Add one more condition to whatever logic a field already has.
  function addCondition(logic, rule) {
    var extra = ruleToLogic(rule);
    if (!logic || !logic.trim()) return extra;
    var spec = simpleRules(logic);
    if (spec && (spec.join === "and" || spec.rules.length === 1)) {
      var dup = spec.rules.some(function (r) { return ruleToLogic(r) === extra; });
      return dup ? logic : logic.trim() + " and " + extra;
    }
    return "(" + logic.trim() + ") and " + extra;
  }

  var OP_WORDS = { "=": "is", "<>": "is not", ">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most" };

  function shortLabel(field) {
    var s = stripHtml(field.label) || field.name;
    return s.length > 38 ? s.slice(0, 36).trim() + "…" : s;
  }

  function choiceLabel(field, code) {
    for (var k = 0; k < field.choices.length; k++) if (field.choices[k].code === String(code)) return stripHtml(field.choices[k].label);
    return null;
  }

  // Plain English for a card: "Ever homeless? is Yes". Falls back to the raw text.
  function describeLogic(src, index) {
    var spec = simpleRules(src);
    if (!spec) return src.trim();
    return spec.rules.map(function (r) {
      var hit = index[r.field];
      var who = hit ? shortLabel(hit.field) : "[" + r.field + "]";
      if (r.op === "checked" || r.op === "unchecked") {
        var lab = hit ? choiceLabel(hit.field, r.code) : null;
        return who + (r.op === "checked" ? " includes " : " does not include ") + "“" + (lab || r.code) + "”";
      }
      if (r.op === "empty") return who + " is blank";
      if (r.op === "answered") return who + " is answered";
      var val = hit && CODED_TYPES[hit.field.type] ? choiceLabel(hit.field, r.value) : null;
      return who + " " + OP_WORDS[r.op] + " " + (val ? "“" + val + "”" : r.value);
    }).join(spec.join === "or" ? "  or  " : "  and  ");
  }

  function Unsupported(what) { this.what = what; }

  function isNumeric(s) { return typeof s === "string" && s.trim() !== "" && isFinite(Number(s)); }

  // answers: {name: "value"} and for checkboxes {name: {code: true}}
  function evaluate(ast, answers) {
    function val(node) {
      switch (node.k) {
        case "num": case "str": return node.v;
        case "ref":
          if (node.event) throw new Unsupported("logic across events");
          var a = answers[node.name];
          if (node.code != null) return a && typeof a === "object" && a[node.code] ? "1" : "0";
          return a == null || typeof a === "object" ? "" : String(a);
        case "math":
          var x = val(node.a), y = val(node.b);
          if (!isNumeric(x) || !isNumeric(y)) return "";
          x = Number(x); y = Number(y);
          return String(node.op === "+" ? x + y : node.op === "-" ? x - y : node.op === "*" ? x * y : x / y);
        case "fn": throw new Unsupported("the function " + node.name + "()");
        default: return truth(node) ? "1" : "0";
      }
    }
    function truth(node) {
      switch (node.k) {
        case "and": return truth(node.a) && truth(node.b);
        case "or": return truth(node.a) || truth(node.b);
        case "not": return !truth(node.a);
        case "cmp":
          var x = val(node.a), y = val(node.b);
          var num = isNumeric(x) && isNumeric(y);
          if (num) { x = Number(x); y = Number(y); }
          switch (node.op) {
            case "=": return x === y;
            case "<>": return x !== y;
            case ">": return num ? x > y : x !== "" && y !== "" && x > y;
            case ">=": return num ? x >= y : x !== "" && y !== "" && x >= y;
            case "<": return num ? x < y : x !== "" && y !== "" && x < y;
            default: return num ? x <= y : x !== "" && y !== "" && x <= y;
          }
        default:
          var v = val(node);
          return v !== "" && v !== "0";
      }
    }
    return truth(ast);
  }

  // true = show, false = hide, null = cannot be worked out here (shown, flagged)
  function isShown(field, answers) {
    if (!field.logic || !field.logic.trim()) return true;
    var ast = tryParse(field.logic);
    if (!ast) return null;
    try { return evaluate(ast, answers); } catch (e) { return null; }
  }

  // Rename a variable everywhere it is referenced in logic and calculations.
  function renameVariable(project, oldName, newName) {
    if (!oldName || oldName === newName) return;
    var re = new RegExp("\\[" + oldName.replace(/[^a-z0-9_]/gi, "") + "(?=[\\](])", "g");
    allFields(project).forEach(function (f) {
      if (f.logic) f.logic = f.logic.replace(re, "[" + newName);
      if (f.calc) f.calc = f.calc.replace(re, "[" + newName);
    });
  }

  // The field a card hangs under on the canvas: the latest earlier field in
  // the same instrument that its logic mentions.
  function parentsInForm(form) {
    var pos = {}, parents = {}, depth = {};
    form.items.forEach(function (it, k) { if (isField(it)) pos[it.name] = k; });
    form.items.forEach(function (it, k) {
      if (!isField(it) || !it.logic) return;
      var best = -1;
      logicRefs(it.logic).forEach(function (r) {
        var at = pos[r.name];
        if (at != null && at < k && at > best && !r.event) best = at;
      });
      if (best >= 0) {
        var parent = form.items[best];
        parents[it.id] = parent.id;
        depth[it.id] = Math.min((depth[parent.id] || 0) + 1, 5);
      }
    });
    return { parents: parents, depth: depth };
  }

  // -------------------------------------------------------------------------
  // Checks
  // -------------------------------------------------------------------------

  function validate(project) {
    var issues = [];
    function add(severity, item, message, form) {
      issues.push({ severity: severity, itemId: item ? item.id : null, formId: form ? form.id : null, message: message });
    }
    var index = fieldIndex(project);
    var seen = {}, formNames = {};
    var fields = allFields(project);
    if (!fields.length) add("error", null, "The project has no questions yet.");
    project.forms.forEach(function (form) {
      if (formNames[form.name]) add("error", null, "Two instruments are both named '" + form.name + "'.", form);
      formNames[form.name] = 1;
      if (!form.items.some(isField)) add("warning", null, "'" + form.label + "' has no questions, so it will be left out of the export.", form);
      var last = form.items[form.items.length - 1];
      if (last && last.kind === "section") add("warning", last, "This section heading has no question after it, so REDCap cannot keep it.", form);
    });
    fields.forEach(function (f) {
      var where = index[f.name];
      if (!f.name) add("error", f, "This question needs a variable name.");
      else if (!/^[a-z][a-z0-9_]*$/.test(f.name)) add("error", f, "Variable name '" + f.name + "' may only use lowercase letters, numbers and underscores, and must start with a letter.");
      else if (/_$|__/.test(f.name)) add("error", f, "Variable name '" + f.name + "' cannot end with an underscore or contain two in a row.");
      else if (f.name.length > 100) add("error", f, "Variable name '" + f.name + "' is too long for REDCap.");
      if (f.name) {
        if (seen[f.name]) add("error", f, "Variable name '" + f.name + "' is used by more than one question.");
        seen[f.name] = 1;
        if (formNames[f.name.replace(/_complete$/, "")] && /_complete$/.test(f.name)) {
          add("error", f, "'" + f.name + "' is reserved by REDCap for the instrument's status.");
        }
      }
      if (!stripHtml(f.label) && f.type !== "descriptive") add("warning", f, "This question has no text yet.");
      if (CHOICE_TYPES[f.type]) {
        if (!f.choices.length) add("error", f, "Add at least one answer choice.");
        var codes = {};
        f.choices.forEach(function (c) {
          if (c.code === "") add("error", f, "An answer choice is missing its code.");
          else if (codes[c.code]) add("error", f, "Answer code '" + c.code + "' is used twice.");
          else if (!/^-?[A-Za-z0-9._]+$/.test(c.code)) add("warning", f, "Answer code '" + c.code + "' has characters REDCap may reject. Letters and numbers are safest.");
          codes[c.code] = 1;
          if (!stripHtml(c.label)) add("warning", f, "Answer choice '" + c.code + "' has no label.");
        });
      }
      if (f.type === "calc" && !f.calc.trim()) add("warning", f, "This calculated field has no equation yet.");
      if (f.logic && f.logic.trim()) checkLogic(f, where);
    });

    function checkLogic(f, where) {
      var ast = tryParse(f.logic);
      if (!ast) {
        var why = "";
        try { parseLogic(f.logic); } catch (e) { why = e.message; }
        add("warning", f, "The branching logic could not be read (" + why + "). Check it before uploading.");
        return;
      }
      var flagged = {};
      function once(key, sev, msg) { if (!flagged[key]) { flagged[key] = 1; add(sev, f, msg); } }
      walk(ast, function (node) {
        if (node.k === "ref") {
          if (node.event && !index[node.name]) once("m" + node.name, "error", "The logic mentions [" + node.name + "], which does not exist.");
          if (node.event) return;
          if (/^[a-z]+(-[a-z]+)+$/.test(node.name)) return; // smart variables such as [event-name]
          var hit = index[node.name];
          if (!hit) return once("m" + node.name, "error", "The logic mentions [" + node.name + "], which does not exist, so this question would never show.");
          var t = hit.field;
          if (t === f) once("self", "error", "The logic refers to the question itself.");
          else if (hit.order > where.order) once("fwd" + t.name, "warning", "This depends on '" + shortLabel(t) + "', which is asked later. Move it below that question.");
          if (t.type === "descriptive") once("d" + t.name, "error", "The logic refers to '" + t.name + "', a text block that holds no answer.");
          if (t.type === "checkbox" && node.code == null) once("cb" + t.name, "error", "'" + t.name + "' is a checkbox question, so the logic must name one option, like [" + t.name + "(1)] = '1'.");
          if (t.type === "checkbox" && node.code != null && choiceLabel(t, node.code) == null) once("cc" + t.name + node.code, "error", "'" + t.name + "' has no answer coded " + node.code + ".");
          if (t.type !== "checkbox" && node.code != null) once("nc" + t.name, "error", "'" + t.name + "' is not a checkbox question, so [" + t.name + "(" + node.code + ")] will not work.");
        }
        if (node.k === "cmp") {
          [[node.a, node.b], [node.b, node.a]].forEach(function (pair) {
            var ref = pair[0], lit = pair[1];
            if (ref.k !== "ref" || ref.event || ref.code != null || (lit.k !== "str" && lit.k !== "num")) return;
            var hit = index[ref.name];
            if (!hit || !CODED_TYPES[hit.field.type] || hit.field.type === "checkbox" || lit.v === "") return;
            if (choiceLabel(hit.field, lit.v) == null) {
              once("code" + ref.name + lit.v, "error", "'" + shortLabel(hit.field) + "' has no answer coded " + lit.v + ", so this condition can never be true.");
            }
          });
        }
      });
    }
    return issues;
  }

  // -------------------------------------------------------------------------
  // Import: REDCap project XML (CDISC ODM)
  // -------------------------------------------------------------------------

  var KNOWN_ITEM_ATTRS = {
    Variable: 1, FieldType: 1, TextValidationType: 1, SectionHeader: 1, FieldNote: 1, Calculation: 1,
    Identifier: 1, RequiredField: 1, BranchingLogic: 1, FieldAnnotation: 1,
    TextValidationMin: 1, TextValidationMax: 1
  };
  var TITLE_GLOBALS = { StudyName: 1, StudyDescription: 1, ProtocolName: 1 };

  function yes(v) { return /^(y|yes|1|true)$/i.test(String(v || "").trim()); }

  function translated(node) {
    if (!node) return "";
    var tt = findDeep(node, "TranslatedText");
    return (tt ? textOf(tt) : textOf(node)).trim();
  }

  function importOdm(text, fileName) {
    var doc = parseXml(text);
    var odm = elements(doc)[0];
    if (!odm || local(odm.name) !== "ODM") {
      throw new InputError("This XML file is not a REDCap project export. In REDCap, use Project Setup, Other Functionality, then Download metadata only (XML).");
    }
    var study = findDeep(odm, "Study");
    var mdv = study && kid(study, "MetaDataVersion");
    if (!mdv) throw new InputError("This file has no project design in it (no <MetaDataVersion> element).");
    var gv = kid(study, "GlobalVariables");
    var title = (gv && translated(kid(gv, "StudyName"))) || attr(mdv, "Name") || String(fileName || "Imported project").replace(/\.[^.]+$/, "");
    var notes = [];
    var project = { title: title, forms: [], keep: null, source: { format: "REDCap project XML", file: fileName || "" } };

    var groups = {}, items = {}, lists = {};
    kids(mdv, "ItemGroupDef").forEach(function (g) { groups[attr(g, "OID")] = g; });
    kids(mdv, "ItemDef").forEach(function (it) { items[attr(it, "OID")] = it; });
    kids(mdv, "CodeList").forEach(function (c) { lists[attr(c, "OID")] = c; });

    var seen = {};
    kids(mdv, "FormDef").forEach(function (fd) {
      var formName = attr(fd, "FormName") || attr(fd, "OID").replace(/^Form\./, "");
      var form = { id: uid(), name: formName, autoName: false, label: attr(fd, "Name") || formName, items: [] };
      project.forms.push(form);
      kids(fd, "ItemGroupRef").forEach(function (gref) {
        var group = groups[attr(gref, "ItemGroupOID")];
        if (!group) return;
        kids(group, "ItemRef").forEach(function (iref) {
          var item = items[attr(iref, "ItemOID")];
          if (!item) return;
          var name = attr(item, "Variable") || attr(item, "Name");
          if (seen[name]) return; // later options of a checkbox already read
          seen[name] = 1;
          if (name === formName + "_complete") return; // REDCap adds the status field itself
          var type = attr(item, "FieldType") || (kid(item, "CodeListRef") ? "radio" : "text");
          if (type === "select") type = "dropdown";
          if (type === "textarea") type = "notes";
          var q = kid(item, "Question");
          var formatted = q && kid(q, "FormattedTranslatedText");
          var label = formatted ? textOf(formatted).trim() : translated(q);
          var header = attr(item, "SectionHeader");
          if (header.trim()) form.items.push(newSection(header.trim()));
          var f = newField({
            name: name, autoName: false, type: type, label: label,
            choices: odmChoices(item, type, name, lists, items),
            note: attr(item, "FieldNote"), validation: attr(item, "TextValidationType"),
            min: rangeValue(item, "GE") || attr(item, "TextValidationMin"),
            max: rangeValue(item, "LE") || attr(item, "TextValidationMax"),
            required: yes(attr(item, "RequiredField")), identifier: yes(attr(item, "Identifier")),
            logic: attr(item, "BranchingLogic").trim(), calc: attr(item, "Calculation"),
            annotation: attr(item, "FieldAnnotation")
          });
          item.attrs.forEach(function (kv) {
            var k = kv[0].indexOf(":");
            if (k > 0 && kv[0].slice(0, 5) !== "xmlns" && !KNOWN_ITEM_ATTRS[kv[0].slice(k + 1)]) f.extra.push([kv[0].slice(k + 1), kv[1]]);
          });
          form.items.push(f);
        });
      });
    });
    if (!allFields(project).length) throw new InputError("No questions were found in this file.");

    var recordId = attr(mdv, "RecordIdField");
    var first = allFields(project)[0];
    if (recordId && first.name !== recordId) notes.push("The record ID field '" + recordId + "' is not the first field. REDCap treats the first field as the record ID.");

    var events = kids(mdv, "StudyEventDef");
    project.keep = {
      version: attr(odm, "SourceSystemVersion"),
      globals: gv ? elements(gv).filter(function (el) { return !TITLE_GLOBALS[local(el.name)]; }) : [],
      protocol: kid(mdv, "Protocol"),
      events: events
    };
    if (events.length > 1) notes.push("This is a longitudinal project with " + events.length + " events. Events and arms are kept as they are; new instruments need to be assigned to events in REDCap.");
    if (findDeep(odm, "ClinicalData")) notes.push("This file also contains participant records. Only the survey design was read; records are never kept or exported here.");
    return { project: project, notes: notes };
  }

  function rangeValue(item, comparator) {
    var checks = kids(item, "RangeCheck");
    for (var k = 0; k < checks.length; k++) {
      if (attr(checks[k], "Comparator") === comparator) return textOf(kid(checks[k], "CheckValue")).trim();
    }
    return "";
  }

  function odmChoices(item, type, name, lists, items) {
    var ref = kid(item, "CodeListRef");
    var cl = ref ? lists[attr(ref, "CodeListOID")] : null;
    if (type === "checkbox") {
      if (cl && attr(cl, "CheckboxChoices")) return parseChoices(attr(cl, "CheckboxChoices"));
      for (var oid in lists) {
        if (attr(lists[oid], "Variable") === name && attr(lists[oid], "CheckboxChoices")) return parseChoices(attr(lists[oid], "CheckboxChoices"));
      }
      var out = [];
      Object.keys(items).forEach(function (o) {
        if (o.indexOf(name + "___") === 0) out.push({ code: o.slice(name.length + 3), label: o.slice(name.length + 3) });
      });
      return out;
    }
    if (!cl) return [];
    return kids(cl, "CodeListItem").map(function (cli) {
      return { code: attr(cli, "CodedValue"), label: translated(kid(cli, "Decode")) };
    });
  }

  // -------------------------------------------------------------------------
  // Import: Data Dictionary CSV
  // -------------------------------------------------------------------------

  var DD_COLUMNS = [
    ["variable", "name"], ["form name", "form"], ["section header", "section"], ["field type", "type"],
    ["field label", "label"], ["choices", "choices"], ["field note", "note"],
    ["text validation type", "validation"], ["text validation min", "min"], ["text validation max", "max"],
    ["identifier", "identifier"], ["branching logic", "logic"], ["required field", "required"],
    ["custom alignment", "CustomAlignment"], ["question number", "QuestionNumber"],
    ["matrix group name", "MatrixGroupName"], ["matrix ranking", "MatrixRanking"], ["field annotation", "annotation"]
  ];
  var DD_EXTRA = ["CustomAlignment", "QuestionNumber", "MatrixGroupName", "MatrixRanking"];

  function titleCase(s) {
    return s.replace(/_+/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function importDataDictionary(text, fileName) {
    var rows = parseCsv(text);
    if (!rows.length) throw new InputError("The data dictionary file is empty.");
    var map = {}, used = {};
    rows[0].forEach(function (col, idx) {
      var low = col.trim().toLowerCase();
      for (var k = 0; k < DD_COLUMNS.length; k++) {
        if (low.indexOf(DD_COLUMNS[k][0]) === 0 && !used[DD_COLUMNS[k][1]]) { map[idx] = DD_COLUMNS[k][1]; used[DD_COLUMNS[k][1]] = 1; break; }
      }
    });
    if (!used.name || !used.type) {
      throw new InputError("This CSV does not look like a REDCap data dictionary (it needs 'Variable / Field Name' and 'Field Type' columns).");
    }
    var project = {
      title: titleCase(String(fileName || "Imported survey").replace(/\.[^.]+$/, "").replace(/[-_]?(data)?[-_]?dictionary.*$/i, "")) || "Imported survey",
      forms: [], keep: null, source: { format: "REDCap data dictionary", file: fileName || "" }
    };
    var byName = {};
    rows.slice(1).forEach(function (raw) {
      var v = {};
      raw.forEach(function (cell, idx) { if (map[idx]) v[map[idx]] = cell; });
      var name = (v.name || "").trim();
      if (!name) return;
      var formName = (v.form || "").trim() || "survey";
      var form = byName[formName];
      if (!form) {
        form = byName[formName] = { id: uid(), name: formName, autoName: false, label: titleCase(formName), items: [] };
        project.forms.push(form);
      }
      var type = (v.type || "text").trim().toLowerCase();
      if (type === "select") type = "dropdown";
      if (type === "textarea") type = "notes";
      if ((v.section || "").trim()) form.items.push(newSection(v.section.trim()));
      var f = newField({
        name: name, autoName: false, type: type, label: v.label || "",
        choices: CHOICE_TYPES[type] ? parseChoices(v.choices) : [],
        note: v.note || "", validation: (v.validation || "").trim(), min: (v.min || "").trim(), max: (v.max || "").trim(),
        required: yes(v.required), identifier: yes(v.identifier), logic: (v.logic || "").trim(),
        calc: type === "calc" ? (v.choices || "") : "", annotation: v.annotation || ""
      });
      if ((type === "slider" || type === "sql") && (v.choices || "").trim()) f.choicesRaw = v.choices;
      DD_EXTRA.forEach(function (k) { if ((v[k] || "").trim()) f.extra.push([k, v[k].trim()]); });
      form.items.push(f);
    });
    if (!allFields(project).length) throw new InputError("No questions were found in this data dictionary.");
    return { project: project, notes: [] };
  }

  function importAny(text, fileName) {
    var head = text.slice(0, 2000).replace(/^﻿/, "").trim();
    if (head.charAt(0) === "<") return importOdm(text, fileName);
    return importDataDictionary(text, fileName);
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  // Fields per instrument, each with the section heading that precedes it.
  function exportRows(project) {
    var out = [];
    project.forms.forEach(function (form) {
      var rows = [], pending = "";
      form.items.forEach(function (it) {
        if (it.kind === "section") { pending = pending ? pending + " " + it.label : it.label; return; }
        rows.push({ field: it, section: pending });
        pending = "";
      });
      if (rows.length) out.push({ form: form, rows: rows });
    });
    return out;
  }

  function extraValue(field, key) {
    for (var k = 0; k < field.extra.length; k++) if (field.extra[k][0] === key) return field.extra[k][1];
    return "";
  }

  var DD_HEADER = [
    "Variable / Field Name", "Form Name", "Section Header", "Field Type", "Field Label",
    "Choices, Calculations, OR Slider Labels", "Field Note", "Text Validation Type OR Show Slider Number",
    "Text Validation Min", "Text Validation Max", "Identifier?", "Branching Logic (Show field only if...)",
    "Required Field?", "Custom Alignment", "Question Number (surveys only)", "Matrix Group Name",
    "Matrix Ranking?", "Field Annotation"
  ];

  function exportDataDictionary(project) {
    var lines = [DD_HEADER.map(csvCell).join(",")];
    exportRows(project).forEach(function (entry) {
      entry.rows.forEach(function (row) {
        var f = row.field;
        var third = CHOICE_TYPES[f.type] ? choicesText(f.choices) : f.type === "calc" ? f.calc : (f.choicesRaw || "");
        lines.push([
          f.name, entry.form.name, row.section, f.type, f.label, third, f.note, f.validation, f.min, f.max,
          f.identifier ? "y" : "", f.logic, f.required ? "y" : "", extraValue(f, "CustomAlignment"),
          extraValue(f, "QuestionNumber"), extraValue(f, "MatrixGroupName"), extraValue(f, "MatrixRanking"), f.annotation
        ].map(csvCell).join(","));
      });
    });
    return lines.join("\r\n") + "\r\n";
  }

  function odmDataType(f) {
    var v = f.validation || "";
    if (f.type === "checkbox" || f.type === "yesno" || f.type === "truefalse") return "boolean";
    if (f.type === "calc") return "float";
    if (f.type === "slider") return "integer";
    if (f.type !== "text") return "text";
    if (v === "integer") return "integer";
    if (/^number/.test(v)) return "float";
    if (/^date_/.test(v)) return "date";
    if (/^datetime_seconds/.test(v)) return "datetime";
    if (/^datetime_/.test(v)) return "partialDatetime";
    if (v === "time") return "partialTime";
    return "text";
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function exportOdm(project, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var stamp = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) + "T" +
      pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
    var title = project.title.trim() || "My survey";
    var camel = title.replace(/[^A-Za-z0-9 ]+/g, "").split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join("").slice(0, 60) || "Project";
    var entries = exportRows(project);
    if (!entries.length) throw new InputError("Add at least one question before exporting.");
    var keep = project.keep || {};
    var formNames = {};
    entries.forEach(function (e) { formNames[e.form.name] = 1; });
    var recordId = entries[0].rows[0].field.name;
    var notes = [];
    var L = [];

    L.push('<?xml version="1.0" encoding="UTF-8" ?>');
    L.push('<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:redcap="https://projectredcap.org" ' +
      'xsi:schemaLocation="http://www.cdisc.org/ns/odm/v1.3 schema/odm/ODM1-3-1.xsd" ODMVersion="1.3.1" ' +
      'FileOID="000-00-0000" FileType="Snapshot" Description="' + escAttr(title) + '" AsOfDateTime="' + stamp +
      '" CreationDateTime="' + stamp + '" SourceSystem="REDCap" SourceSystemVersion="' + escAttr(keep.version || "14.5.0") + '">');
    L.push('<Study OID="Project.' + camel + '">');
    L.push("<GlobalVariables>");
    L.push("\t<StudyName>" + escText(title) + "</StudyName>");
    L.push("\t<StudyDescription>This file contains the metadata, events, and data for REDCap project \"" + escText(title) + "\".</StudyDescription>");
    L.push("\t<ProtocolName>" + escText(title) + "</ProtocolName>");
    if (keep.globals && keep.globals.length) {
      keep.globals.forEach(function (node) { L.push("\t" + serializeXml(pruneForms(node, formNames))); });
    } else {
      [["RecordAutonumberingEnabled", "1"], ["CustomRecordLabel", ""], ["SecondaryUniqueField", ""],
        ["SchedulingEnabled", "0"], ["SurveysEnabled", "1"], ["Purpose", "0"], ["PurposeOther", ""], ["ProjectNotes", ""]
      ].forEach(function (g) { L.push("\t<redcap:" + g[0] + ">" + escText(g[1]) + "</redcap:" + g[0] + ">"); });
    }
    L.push("</GlobalVariables>");
    L.push('<MetaDataVersion OID="Metadata.' + camel + "_" + stamp.slice(0, 16).replace("T", "_").replace(":", "") +
      '" Name="' + escAttr(title) + '" redcap:RecordIdField="' + escAttr(recordId) + '">');

    var events = (keep.events || []).map(function (ev) { return pruneForms(ev, formNames); });
    if (events.length) {
      var assigned = {};
      events.forEach(function (ev) { kids(ev, "FormRef").forEach(function (fr) { assigned[attr(fr, "FormName")] = 1; }); });
      var unassigned = entries.filter(function (e) { return !assigned[e.form.name]; });
      if (unassigned.length && events.length === 1) {
        unassigned.forEach(function (e) {
          events[0].children.push({ name: "FormRef", children: [], attrs: [["FormOID", "Form." + e.form.name],
            ["OrderNumber", String(kids(events[0], "FormRef").length + 1)], ["Mandatory", "No"], ["redcap:FormName", e.form.name]] });
        });
      } else if (unassigned.length) {
        notes.push("Assign these new instruments to events in REDCap after import: " +
          unassigned.map(function (e) { return e.form.label; }).join(", ") + ".");
      }
      if (keep.protocol) L.push("\t" + serializeXml(keep.protocol));
      events.forEach(function (ev) { L.push("\t" + serializeXml(ev)); });
    }

    // Item groups: REDCap starts a new group at every section heading.
    var groupLines = [], itemLines = [], listLines = [];
    entries.forEach(function (entry) {
      var form = entry.form, groupsOut = [], current = null;
      entry.rows.forEach(function (row, k) {
        if (k === 0 || row.section) {
          current = { oid: form.name + "." + row.field.name, name: row.section || form.label, refs: [] };
          groupsOut.push(current);
        }
        itemOids(row.field).forEach(function (oid) {
          current.refs.push('\t\t<ItemRef ItemOID="' + escAttr(oid) + '" Mandatory="' + (row.field.required ? "Yes" : "No") +
            '" redcap:Variable="' + escAttr(row.field.name) + '"/>');
        });
        writeItem(row.field, row.section);
      });
      var status = form.name + "_complete";
      groupsOut.push({ oid: form.name + "." + status, name: "Form Status",
        refs: ['\t\t<ItemRef ItemOID="' + status + '" Mandatory="No" redcap:Variable="' + status + '"/>'] });
      itemLines.push('\t<ItemDef OID="' + status + '" Name="' + status + '" DataType="text" Length="1" redcap:Variable="' + status +
        '" redcap:FieldType="select" redcap:SectionHeader="Form Status">');
      itemLines.push("\t\t<Question><TranslatedText>Complete?</TranslatedText></Question>");
      itemLines.push('\t\t<CodeListRef CodeListOID="' + status + '.choices"/>');
      itemLines.push("\t</ItemDef>");
      writeList(status + ".choices", status, "text", status, "",
        [{ code: "0", label: "Incomplete" }, { code: "1", label: "Unverified" }, { code: "2", label: "Complete" }]);

      L.push('\t<FormDef OID="Form.' + escAttr(form.name) + '" Name="' + escAttr(form.label) + '" Repeating="No" redcap:FormName="' + escAttr(form.name) + '">');
      groupsOut.forEach(function (g) { L.push('\t\t<ItemGroupRef ItemGroupOID="' + escAttr(g.oid) + '" Mandatory="No"/>'); });
      L.push("\t</FormDef>");
      groupsOut.forEach(function (g) {
        groupLines.push('\t<ItemGroupDef OID="' + escAttr(g.oid) + '" Name="' + escAttr(g.name) + '" Repeating="No">');
        groupLines.push.apply(groupLines, g.refs);
        groupLines.push("\t</ItemGroupDef>");
      });
    });

    function itemOids(f) {
      if (f.type !== "checkbox") return [f.name];
      return f.choices.map(function (c) { return f.name + "___" + checkboxSuffix(c.code); });
    }

    function writeItem(f, section) {
      var odmType = f.type === "dropdown" ? "select" : f.type === "notes" ? "textarea" : f.type;
      var length = "999";
      if (f.type === "checkbox" || f.type === "yesno" || f.type === "truefalse") length = "1";
      else if (CHOICE_TYPES[f.type] && f.choices.length) length = String(Math.max.apply(null, f.choices.map(function (c) { return c.code.length; })));
      var stripped = stripHtml(f.label);
      var hasHtml = /<[a-z!\/][^>]*>/i.test(f.label);
      itemOids(f).forEach(function (oid) {
        var a = ' OID="' + escAttr(oid) + '" Name="' + escAttr(oid) + '" DataType="' + odmDataType(f) + '" Length="' + length + '"' +
          ' redcap:Variable="' + escAttr(f.name) + '" redcap:FieldType="' + escAttr(odmType) + '"';
        function add(key, value) { if (value !== "" && value != null) a += " redcap:" + key + '="' + escAttr(value) + '"'; }
        add("TextValidationType", f.validation);
        add("SectionHeader", section);
        add("FieldNote", f.note);
        if (f.type === "calc") add("Calculation", f.calc);
        add("Identifier", f.identifier ? "y" : "");
        add("RequiredField", f.required ? "y" : "");
        add("BranchingLogic", f.logic.trim());
        f.extra.forEach(function (kv) { add(kv[0], kv[1]); });
        add("FieldAnnotation", f.annotation);
        itemLines.push("\t<ItemDef" + a + ">");
        itemLines.push("\t\t<Question><TranslatedText>" + escText(hasHtml ? stripped : f.label) + "</TranslatedText>" +
          (hasHtml ? "<redcap:FormattedTranslatedText>" + escText(f.label) + "</redcap:FormattedTranslatedText>" : "") + "</Question>");
        if (CODED_TYPES[f.type]) itemLines.push('\t\t<CodeListRef CodeListOID="' + escAttr(oid) + '.choices"/>');
        [["GE", f.min], ["LE", f.max]].forEach(function (rc) {
          if (rc[1] === "" || rc[1] == null) return;
          itemLines.push('\t\t<RangeCheck Comparator="' + rc[0] + '" SoftHard="Soft"><CheckValue>' + escText(rc[1]) +
            "</CheckValue><ErrorMessage><TranslatedText>The value you provided is outside the suggested range.</TranslatedText></ErrorMessage></RangeCheck>");
        });
        itemLines.push("\t</ItemDef>");
        if (f.type === "checkbox") {
          writeList(oid + ".choices", oid, "boolean", f.name, choicesText(f.choices),
            [{ code: "1", label: "Checked" }, { code: "0", label: "Unchecked" }]);
        } else if (CODED_TYPES[f.type]) {
          writeList(oid + ".choices", oid, odmDataType(f) === "boolean" ? "boolean" : "text", f.name, "", f.choices);
        }
      });
    }

    function writeList(oid, name, dataType, variable, checkboxChoices, choices) {
      listLines.push('\t<CodeList OID="' + escAttr(oid) + '" Name="' + escAttr(name) + '" DataType="' + dataType + '" redcap:Variable="' +
        escAttr(variable) + '"' + (checkboxChoices ? ' redcap:CheckboxChoices="' + escAttr(checkboxChoices) + '"' : "") + ">");
      choices.forEach(function (c) {
        listLines.push('\t\t<CodeListItem CodedValue="' + escAttr(c.code) + '"><Decode><TranslatedText>' + escText(c.label) +
          "</TranslatedText></Decode></CodeListItem>");
      });
      listLines.push("\t</CodeList>");
    }

    L.push.apply(L, groupLines);
    L.push.apply(L, itemLines);
    L.push.apply(L, listLines);
    L.push("</MetaDataVersion>");
    L.push("</Study>");
    L.push("</ODM>");
    return { xml: L.join("\n") + "\n", notes: notes };
  }

  // REDCap writes checkbox columns as name___code, lowercased, with a minus as "_".
  function checkboxSuffix(code) { return String(code).toLowerCase().replace(/-/g, "_").replace(/[^a-z0-9_]/g, ""); }

  // Drop references to instruments that no longer exist from kept nodes.
  function pruneForms(node, formNames) {
    var copy = { name: node.name, attrs: node.attrs.slice(), children: [] };
    node.children.forEach(function (c) {
      if (typeof c === "string") { copy.children.push(c); return; }
      var ln = local(c.name);
      if (ln === "FormRef" && !formNames[attr(c, "FormName") || attr(c, "FormOID").replace(/^Form\./, "")]) return;
      if (ln === "RepeatingInstrument" && !formNames[attr(c, "RepeatInstrument")]) return;
      copy.children.push(pruneForms(c, formNames));
    });
    return copy;
  }

  // -------------------------------------------------------------------------
  // A small example to explore
  // -------------------------------------------------------------------------

  function sampleProject() {
    var p = { title: "Housing and Health Survey (example)", forms: [], keep: null, source: null };
    function form(label) { var f = newForm(p, label); p.forms.push(f); return f; }
    function field(f, props) { props.autoName = false; f.items.push(newField(props)); }
    function yn() { return [{ code: "1", label: "Yes" }, { code: "0", label: "No" }]; }
    var demo = form("Demographics");
    field(demo, { name: "record_id", label: "Record ID" });
    field(demo, { name: "age", label: "What is your age in years?", validation: "integer", min: "18", max: "99", required: true });
    field(demo, { name: "gender", type: "radio", label: "What is your gender?", required: true, choices: [
      { code: "1", label: "Woman" }, { code: "2", label: "Man" }, { code: "3", label: "Non-binary" },
      { code: "4", label: "Prefer to self-describe" }, { code: "99", label: "Prefer not to answer" }] });
    field(demo, { name: "gender_self", label: "Please describe your gender:", logic: "[gender] = '4'" });
    var housing = form("Housing");
    housing.items.push(newSection("Housing history"));
    field(housing, { name: "homeless_life", type: "yesno", label: "Have you ever been homeless in your lifetime?", required: true, choices: yn() });
    field(housing, { name: "homeless_6mo", type: "yesno", label: "In the past 6 months, have you been homeless?", logic: "[homeless_life] = '1'", choices: yn() });
    field(housing, { name: "homeless_nights", label: "In the past 6 months, how many nights did you sleep outside or in a shelter?",
      validation: "integer", min: "0", max: "183", logic: "[homeless_6mo] = '1'" });
    field(housing, { name: "shelter_type", type: "checkbox", label: "In the past 6 months, where did you stay? (Select all that apply)",
      logic: "[homeless_6mo] = '1'", choices: [{ code: "1", label: "Emergency shelter" }, { code: "2", label: "Outdoors" },
        { code: "3", label: "Vehicle" }, { code: "4", label: "With friends or family" }, { code: "98", label: "Somewhere else" }] });
    field(housing, { name: "shelter_other", label: "Where else did you stay?", logic: "[shelter_type(98)] = '1'" });
    housing.items.push(newSection("Current housing"));
    field(housing, { name: "housing_now", type: "dropdown", label: "Where do you live now?", choices: [
      { code: "1", label: "Own home or apartment" }, { code: "2", label: "Renting" }, { code: "3", label: "Staying with others" },
      { code: "4", label: "Shelter" }, { code: "5", label: "No stable housing" }] });
    field(housing, { name: "rent_burden", type: "yesno", label: "Do you spend more than half your income on rent?", logic: "[housing_now] = '2'", choices: yn() });
    return p;
  }

  return {
    InputError: InputError, parseXml: parseXml, serializeXml: serializeXml, parseCsv: parseCsv,
    KINDS: KINDS, KIND_BY_KEY: KIND_BY_KEY, VALIDATIONS: VALIDATIONS, CHOICE_TYPES: CHOICE_TYPES, CODED_TYPES: CODED_TYPES,
    uid: uid, stripHtml: stripHtml, slugify: slugify, formSlug: formSlug, isField: isField, allFields: allFields,
    fieldIndex: fieldIndex, findItem: findItem, uniqueName: uniqueName, uniqueFormName: uniqueFormName,
    newField: newField, newSection: newSection, newForm: newForm, newProject: newProject, createFromKind: createFromKind,
    kindOf: kindOf, parseChoices: parseChoices, choicesText: choicesText, nextCode: nextCode,
    parseLogic: parseLogic, logicRefs: logicRefs, simpleRules: simpleRules, rulesToLogic: rulesToLogic,
    ruleToLogic: ruleToLogic, addCondition: addCondition, describeLogic: describeLogic, shortLabel: shortLabel,
    choiceLabel: choiceLabel, evaluate: evaluate, isShown: isShown, renameVariable: renameVariable,
    parentsInForm: parentsInForm, validate: validate, importOdm: importOdm, importDataDictionary: importDataDictionary,
    importAny: importAny, exportOdm: exportOdm, exportDataDictionary: exportDataDictionary, sampleProject: sampleProject
  };
});
