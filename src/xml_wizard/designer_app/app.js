/* XML Wizard designer: the drag-and-drop canvas, inspector, preview and export screens. */
(function () {
  "use strict";
  var C = window.XMLWCore;
  var STORE_KEY = "xmlw-designer-v1";
  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), world = $("world"), insp = $("inspector"), palette = $("palette"), linkLayer = $("linkLayer");

  var state = { project: null, sel: null, selForm: null, view: { x: 28, y: 24, k: 1 }, history: [], hi: -1, rawMode: {}, issues: [], pendingFocus: null };
  var commitTimer = 0;

  // ---------------------------------------------------------------- helpers

  function h(spec, props) {
    var parts = spec.split(".");
    var el = document.createElement(parts[0] || "div");
    if (parts.length > 1) el.className = parts.slice(1).join(" ");
    var i = 1, value;
    if (props && typeof props === "object" && !(props instanceof Node) && !Array.isArray(props)) {
      i = 2;
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === "spellcheck") { el.setAttribute(k, String(v)); return; }
        if (v == null || v === false) return;
        if (k === "value") value = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (k in el && k.indexOf("-") < 0) el[k] = v;
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (; i < arguments.length; i++) append(el, arguments[i]);
    if (value !== undefined) el.value = value;
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  function svgEl(name, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function find(id) { return id ? C.findItem(state.project, id) : null; }
  function formById(id) { return state.project.forms.filter(function (f) { return f.id === id; })[0] || null; }
  function isNarrow() { return window.matchMedia("(max-width: 820px)").matches; }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, ms || 3600);
  }

  // ---------------------------------------------------------------- state

  function markRecordId(project) {
    var fields = C.allFields(project);
    if (fields.length && !fields.some(function (f) { return f.rid; })) fields[0].rid = true;
  }

  // REDCap needs the record ID to be the very first field.
  function normalize() {
    var p = state.project;
    if (!p.forms.length) p.forms.push(C.newForm(p, "Survey"));
    var rid = C.allFields(p).filter(function (f) { return f.rid; })[0];
    if (!rid) {
      rid = C.newField({ name: C.uniqueName(p, "record_id"), autoName: false, label: "Record ID" });
      rid.rid = true;
      p.forms[0].items.unshift(rid);
    } else if (p.forms[0].items[0] !== rid) {
      var loc = C.findItem(p, rid.id);
      loc.form.items.splice(loc.index, 1);
      p.forms[0].items.unshift(rid);
    }
  }

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = 0;
    var snap = JSON.stringify(state.project);
    if (state.history[state.hi] !== snap) {
      state.history = state.history.slice(0, state.hi + 1);
      state.history.push(snap);
      if (state.history.length > 120) state.history.shift();
      state.hi = state.history.length - 1;
    }
    try { localStorage.setItem(STORE_KEY, snap); } catch (e) { /* private window or full: carry on */ }
    updateTop();
  }

  function changed(opts) {
    opts = opts || {};
    normalize();
    renderCanvas();
    if (opts.inspector) renderInspector();
    else {
      var box = $("issue-box");
      if (box) { box.textContent = ""; append(box, issueNotes(function (i) { return i.itemId === state.sel; })); }
    }
    updateTop();
    if (opts.now) commit();
    else { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 500); }
  }

  function travel(step) {
    if (commitTimer) commit();
    var next = state.hi + step;
    if (next < 0 || next >= state.history.length) return;
    state.hi = next;
    state.project = JSON.parse(state.history[next]);
    if (state.sel && !find(state.sel)) state.sel = null;
    if (state.selForm && !formById(state.selForm)) state.selForm = null;
    try { localStorage.setItem(STORE_KEY, state.history[next]); } catch (e) { /* ignore */ }
    renderAll();
  }

  function setProject(project, keepHistory) {
    markRecordId(project);
    state.project = project;
    state.sel = null;
    state.selForm = null;
    state.rawMode = {};
    if (!keepHistory) { state.history = []; state.hi = -1; }
    normalize();
    commit();
    state.view = { x: 28, y: 24, k: 1 };
    renderAll();
  }

  function select(id, opts) {
    state.sel = id;
    state.selForm = null;
    palette.classList.remove("open");
    renderCanvas();
    renderInspector();
    if (opts && opts.reveal) reveal(id);
  }
  function selectForm(id) {
    state.sel = null;
    state.selForm = id;
    renderCanvas();
    renderInspector();
  }

  // ---------------------------------------------------------------- top bar

  function updateTop() {
    var errors = state.issues.filter(function (i) { return i.severity === "error"; }).length;
    var warnings = state.issues.length - errors;
    var pill = $("problems");
    pill.className = "pill " + (errors ? "err" : warnings ? "warn" : "ok");
    pill.textContent = errors ? plural(errors, "problem") + (warnings ? " +" + warnings : "") : warnings ? plural(warnings, "warning") : "✓ No problems";
    $("undo").disabled = state.hi <= 0 && !commitTimer;
    $("redo").disabled = state.hi >= state.history.length - 1;
    var title = $("title");
    if (document.activeElement !== title) title.value = state.project.title;
    document.title = state.project.title + " · XML Wizard Designer";
  }

  // ---------------------------------------------------------------- canvas

  function applyView() {
    var v = state.view;
    world.style.transform = "translate(" + v.x + "px," + v.y + "px) scale(" + v.k + ")";
    stage.style.backgroundPosition = v.x + "px " + v.y + "px";
    stage.style.backgroundSize = 22 * v.k + "px " + 22 * v.k + "px";
    $("zoom-level").textContent = Math.round(v.k * 100) + "%";
  }

  function zoomAt(cx, cy, k) {
    var v = state.view, r = stage.getBoundingClientRect();
    k = Math.max(0.2, Math.min(1.8, k));
    var px = cx - r.left, py = cy - r.top;
    v.x = px - (px - v.x) * (k / v.k);
    v.y = py - (py - v.y) * (k / v.k);
    v.k = k;
    applyView();
  }

  function fitView() {
    var r = stage.getBoundingClientRect();
    var w = world.offsetWidth, hgt = world.offsetHeight;
    var k = Math.max(0.2, Math.min(1, (r.width - 40) / w, (r.height - 40) / hgt));
    state.view = { x: Math.max(20, (r.width - w * k) / 2), y: 20, k: k };
    applyView();
  }

  function reveal(id) {
    var el = world.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    var bottom = s.bottom - (isNarrow() ? s.height * 0.55 : 0);
    if (r.left < s.left + 8 || r.right > s.right - 8) state.view.x += s.left + (s.width - r.width) / 2 - r.left;
    if (r.top < s.top + 8 || r.bottom > bottom - 8) state.view.y += s.top + (bottom - s.top - r.height) / 2 - r.top;
    applyView();
  }

  function flash(id) {
    var el = world.querySelector('[data-id="' + id + '"]');
    if (el) el.classList.add("flash");
  }

  function relations() {
    var rel = { ctl: {}, dep: {} };
    var loc = find(state.sel);
    if (!loc || !C.isField(loc.item)) return rel;
    var index = C.fieldIndex(state.project);
    C.logicRefs(loc.item.logic).forEach(function (r) { if (index[r.name]) rel.ctl[index[r.name].field.id] = 1; });
    C.allFields(state.project).forEach(function (f) {
      if (f !== loc.item && f.logic && C.logicRefs(f.logic).some(function (r) { return r.name === loc.item.name; })) rel.dep[f.id] = 1;
    });
    return rel;
  }

  function renderCanvas() {
    var p = state.project;
    state.issues = C.validate(p);
    var worst = {};
    state.issues.forEach(function (i) {
      if (i.itemId && worst[i.itemId] !== "error") worst[i.itemId] = i.severity;
    });
    var index = C.fieldIndex(p), rel = relations();
    world.textContent = "";
    p.forms.forEach(function (form) {
      var info = C.parentsInForm(form);
      var body = h("div.form-body", svgEl("svg", { "class": "wires" }));
      form.items.forEach(function (item) { body.appendChild(cardFor(item, info, index, worst, rel)); });
      var n = form.items.filter(C.isField).length;
      world.appendChild(h("section.form" + (state.selForm === form.id ? ".selected" : ""), { "data-form": form.id },
        h("header.form-head", { title: "Drag to reorder instruments. Click to rename." },
          h("span.grip"), h("span.name", { text: form.label || "Untitled instrument" }), h("span.count", { text: plural(n, "question") })),
        body,
        h("div.form-foot", h("button", { text: "+ Add a question", onclick: function (e) { addMenu(e.currentTarget, form.id); } }))));
    });
    world.appendChild(h("button.form-add", { text: "+ Add an instrument", title: "Instruments are the pages or forms of a REDCap project",
      onclick: function () { addForm(); } }));
    applyView();
    drawWires();
    var hint = $("canvas-hint");
    var count = C.allFields(p).length;
    hint.textContent = count <= 1 ? "Drag a question type from the left onto the instrument, or click it"
      : !C.allFields(p).some(function (f) { return f.logic; }) ? "Drag an answer (like Yes) onto another question to show that question only for that answer"
        : "";
    hint.hidden = !hint.textContent;
  }

  function cardFor(item, info, index, worst, rel) {
    var cls = state.sel === item.id ? ".selected" : "";
    if (item.kind === "section") {
      return h("article.card.section" + cls, { "data-id": item.id, "data-kind": "section" },
        h("span.grip"), h("div.card-label" + (item.label ? "" : ".empty"), { text: C.stripHtml(item.label) || "Section heading" }));
    }
    var kind = C.kindOf(item);
    if (rel.ctl[item.id]) cls += ".ctl";
    if (rel.dep[item.id]) cls += ".dep";
    var el = h("article.card" + cls, { "data-id": item.id, "data-kind": "field" });
    var depth = info.depth[item.id] || 0;
    if (depth) el.style.marginLeft = depth * 18 + "px";
    var label = C.stripHtml(item.label);
    el.appendChild(h("div.card-top",
      item.rid ? null : h("span.grip"),
      h("span.glyph", { text: kind.glyph }), h("span.kind", { text: kind.label }),
      item.rid ? h("span.badge.rid", { text: "Record ID", title: "REDCap uses the first field to tell records apart" }) : null,
      item.required ? h("span.badge.req", { text: "Required" }) : null,
      worst[item.id] ? h("span.badge.issue-" + worst[item.id], { text: "!", title: "Needs attention" }) : null,
      h("code.var", { text: item.name, title: item.name })));
    el.appendChild(h("div.card-label" + (label ? "" : ".empty"), { text: label || (item.type === "descriptive" ? "Text block" : "Type the question…") }));
    if (C.CODED_TYPES[item.type] && item.choices.length) {
      var chips = h("div.chips");
      item.choices.slice(0, 7).forEach(function (c) {
        chips.appendChild(h("span.chip", { "data-code": c.code, text: C.stripHtml(c.label) || c.code,
          title: "Drag onto another question to show it only when the answer is “" + (C.stripHtml(c.label) || c.code) + "”" }));
      });
      if (item.choices.length > 7) chips.appendChild(h("span.chip.more", { text: "+" + (item.choices.length - 7) + " more" }));
      el.appendChild(chips);
    } else if (!item.rid && item.type !== "descriptive" && item.type !== "file") {
      el.appendChild(h("button.branch", { text: "⤷", title: "Drag onto another question to make it depend on this one" }));
    }
    if (item.logic && item.logic.trim()) {
      el.appendChild(h("div.gate", { title: item.logic }, h("b", { text: "Shows if " }), C.describeLogic(item.logic, index)));
    }
    return el;
  }

  function drawWires() {
    var bodies = world.querySelectorAll(".form-body");
    state.project.forms.forEach(function (form, k) {
      var body = bodies[k];
      if (!body) return;
      var svg = body.querySelector(".wires");
      var info = C.parentsInForm(form);
      Object.keys(info.parents).forEach(function (id) {
        var child = body.querySelector('[data-id="' + id + '"]');
        var parent = body.querySelector('[data-id="' + info.parents[id] + '"]');
        if (!child || !parent) return;
        var x1 = parent.offsetLeft + 9, y1 = parent.offsetTop + parent.offsetHeight;
        var x2 = child.offsetLeft, y2 = child.offsetTop + Math.min(17, child.offsetHeight / 2);
        var hot = state.sel === id || state.sel === info.parents[id];
        svg.appendChild(svgEl("path", { d: "M" + x1 + " " + y1 + " V" + (y2 - 6) + " Q" + x1 + " " + y2 + " " + (x1 + 6) + " " + y2 + " H" + x2,
          "class": hot ? "hot" : "" }));
      });
    });
  }

  // ---------------------------------------------------------------- editing actions

  function addForm(firstItem) {
    var p = state.project;
    var form = C.newForm(p, "Instrument " + (p.forms.length + 1));
    if (firstItem) form.items.push(firstItem);
    p.forms.push(form);
    if (firstItem) { state.sel = firstItem.id; state.selForm = null; } else { state.sel = null; state.selForm = form.id; }
    state.pendingFocus = firstItem ? "label" : "form-label";
    changed({ inspector: true, now: true });
    reveal(firstItem ? firstItem.id : null);
    if (!firstItem) {
      var el = world.querySelector('[data-form="' + form.id + '"]');
      if (el) { var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (r.right > s.right) { state.view.x -= r.right - s.right + 30; applyView(); } }
    }
    return form;
  }

  function insertNew(key, formId, index) {
    var p = state.project;
    var item = C.createFromKind(p, key);
    var form = formById(formId) || p.forms[0];
    if (form === p.forms[0]) index = Math.max(index, 1);
    form.items.splice(Math.min(index, form.items.length), 0, item);
    state.sel = item.id;
    state.selForm = null;
    state.pendingFocus = "label";
    palette.classList.remove("open");
    changed({ inspector: true, now: true });
    reveal(item.id);
  }

  function addAtEnd(key, formId) {
    var p = state.project, loc = find(state.sel);
    var form = formById(formId) || (loc ? loc.form : formById(state.selForm)) || p.forms[0];
    var index = !formId && loc && loc.form === form ? loc.index + 1 : form.items.length;
    insertNew(key, form.id, index);
  }

  function moveItem(id, formId, index) {
    var loc = find(id), target = formById(formId);
    if (!loc || !target) return;
    loc.form.items.splice(loc.index, 1);
    target.items.splice(Math.min(index, target.items.length), 0, loc.item);
    state.sel = id;
    state.selForm = null;
    changed({ inspector: true, now: true });
  }

  function deleteItem(id) {
    var loc = find(id);
    if (!loc || loc.item.rid) return;
    loc.form.items.splice(loc.index, 1);
    state.sel = null;
    changed({ inspector: true, now: true });
    toast("Deleted. Press Undo to bring it back.");
  }

  function duplicateItem(id) {
    var loc = find(id);
    if (!loc || loc.item.rid) return;
    var copy = JSON.parse(JSON.stringify(loc.item));
    copy.id = C.uid();
    if (C.isField(copy)) { copy.name = C.uniqueName(state.project, copy.name); copy.autoName = false; }
    loc.form.items.splice(loc.index + 1, 0, copy);
    state.sel = copy.id;
    changed({ inspector: true, now: true });
  }

  function applyLink(sourceId, code, targetId) {
    var src = find(sourceId), tgt = find(targetId);
    if (!src || !tgt || src.item === tgt.item || tgt.item.rid) return;
    var s = src.item;
    var rule = code == null ? { field: s.name, code: null, op: "answered", value: "" }
      : s.type === "checkbox" ? { field: s.name, code: code, op: "checked", value: "" }
        : { field: s.name, code: null, op: "=", value: code };
    tgt.item.logic = C.addCondition(tgt.item.logic, rule);
    delete state.rawMode[tgt.item.id];
    state.sel = tgt.item.id;
    state.selForm = null;
    changed({ inspector: true, now: true });
    flash(tgt.item.id);
    toast("“" + C.shortLabel(tgt.item) + "” now shows only if " + C.describeLogic(C.ruleToLogic(rule), C.fieldIndex(state.project)) + ".");
  }

  function applyKind(f, key) {
    var kind = C.KIND_BY_KEY[key];
    if (!kind || !kind.type) return;
    var wasChoice = C.CHOICE_TYPES[f.type];
    f.type = kind.type;
    f.validation = kind.validation || "";
    if (C.CHOICE_TYPES[f.type]) {
      if (!wasChoice || !f.choices.length) f.choices = [{ code: "1", label: "Option 1" }, { code: "2", label: "Option 2" }, { code: "3", label: "Option 3" }];
    } else if (f.type === "yesno") f.choices = [{ code: "1", label: "Yes" }, { code: "0", label: "No" }];
    else f.choices = [];
    if (f.type !== "text") { f.min = ""; f.max = ""; }
    if (f.type !== "calc") f.calc = "";
    if (f.type === "descriptive") f.required = false;
  }

  // ---------------------------------------------------------------- gestures (mouse, touch and pen)

  var gesture = null, touches = {}, pinch = null, panRaf = 0;

  function startGesture(spec, e) {
    gesture = { spec: spec, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, pointer: e.pointerId,
      vx: state.view.x, vy: state.view.y, ghost: null, drop: null, target: null };
  }

  function endGesture(apply) {
    var g = gesture;
    if (!g) return;
    gesture = null;
    cancelAnimationFrame(panRaf);
    panRaf = 0;
    stage.classList.remove("panning");
    if (g.ghost) g.ghost.remove();
    clearSlots();
    linkLayer.textContent = "";
    [].forEach.call(document.querySelectorAll(".dragging, .link-target"), function (el) { el.classList.remove("dragging", "link-target"); });
    if (!apply) return;
    if (g.active) finishGesture(g);
    else tapGesture(g);
  }

  function clearSlots() {
    [].forEach.call(world.querySelectorAll(".drop-slot, .form-slot"), function (el) { el.remove(); });
    var add = world.querySelector(".form-add");
    if (add) add.classList.remove("drop-hot");
  }

  function beginGesture(g) {
    var t = g.spec.type, src;
    if (t === "pan") { stage.classList.add("panning"); return; }
    if (t === "move") {
      src = world.querySelector('[data-id="' + g.spec.id + '"]');
      var r = src.getBoundingClientRect();
      g.ghost = src.cloneNode(true);
      g.ghost.classList.add("drag-ghost");
      g.ghost.classList.remove("selected");
      g.ghost.style.width = src.offsetWidth + "px";
      g.ghost.style.transform = "scale(" + state.view.k + ")";
      g.dx = g.x0 - r.left; g.dy = g.y0 - r.top;
      src.classList.add("dragging");
    } else if (t === "new") {
      g.ghost = g.spec.el.cloneNode(true);
      g.ghost.classList.add("drag-ghost");
      g.dx = 24; g.dy = 16;
    } else if (t === "form") {
      src = world.querySelector('[data-form="' + g.spec.formId + '"]');
      var fr = src.getBoundingClientRect();
      g.ghost = src.querySelector(".form-head").cloneNode(true);
      g.ghost.classList.add("drag-ghost");
      g.ghost.style.width = src.offsetWidth + "px";
      g.ghost.style.borderRadius = "13px";
      g.ghost.style.transform = "scale(" + state.view.k + ")";
      g.dx = g.x0 - fr.left; g.dy = g.y0 - fr.top;
      src.classList.add("dragging");
    }
    if (g.ghost) document.body.appendChild(g.ghost);
    panRaf = requestAnimationFrame(autoPan);
  }

  function stepGesture(g) {
    var t = g.spec.type;
    if (t === "pan") {
      state.view.x = g.vx + g.x - g.x0;
      state.view.y = g.vy + g.y - g.y0;
      applyView();
      return;
    }
    if (g.ghost) { g.ghost.style.left = g.x - g.dx + "px"; g.ghost.style.top = g.y - g.dy + "px"; }
    if (t === "move" || t === "new") computeDrop(g);
    else if (t === "form") computeFormDrop(g);
    else if (t === "link") stepLink(g);
  }

  function inStage(g) {
    var r = stage.getBoundingClientRect();
    return g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;
  }

  function autoPan() {
    var g = gesture;
    if (!g || !g.active || g.spec.type === "pan") return;
    if (inStage(g)) {
      var r = stage.getBoundingClientRect(), m = 48, dx = 0, dy = 0;
      if (g.x < r.left + m) dx = 1; else if (g.x > r.right - m) dx = -1;
      if (g.y < r.top + m) dy = 1; else if (g.y > r.bottom - m) dy = -1;
      if (dx || dy) { state.view.x += dx * 10; state.view.y += dy * 10; applyView(); stepGesture(g); }
    }
    panRaf = requestAnimationFrame(autoPan);
  }

  function computeDrop(g) {
    clearSlots();
    g.drop = null;
    if (!inStage(g)) return;
    var pad = 14 * state.view.k, hit = null;
    [].forEach.call(world.querySelectorAll(".form"), function (el) {
      var r = el.getBoundingClientRect();
      if (g.x >= r.left - pad && g.x <= r.right + pad) hit = el;
    });
    if (!hit) {
      var add = world.querySelector(".form-add");
      if (g.x >= add.getBoundingClientRect().left - pad) { add.classList.add("drop-hot"); g.drop = { newForm: true }; }
      return;
    }
    var body = hit.querySelector(".form-body");
    var cards = [].slice.call(body.querySelectorAll(".card:not(.dragging)"));
    var idx = 0;
    cards.forEach(function (c) { var r = c.getBoundingClientRect(); if (g.y > r.top + r.height / 2) idx++; });
    if (hit.dataset.form === state.project.forms[0].id) idx = Math.max(idx, 1);
    body.insertBefore(h("div.drop-slot"), cards[idx] || null);
    g.drop = { formId: hit.dataset.form, index: idx };
  }

  function computeFormDrop(g) {
    clearSlots();
    var forms = [].slice.call(world.querySelectorAll(".form:not(.dragging)"));
    var idx = 0;
    forms.forEach(function (el) { var r = el.getBoundingClientRect(); if (g.x > r.left + r.width / 2) idx++; });
    world.insertBefore(h("div.form-slot"), forms[idx] || world.querySelector(".form-add"));
    g.drop = { index: idx };
  }

  function stepLink(g) {
    var from = world.querySelector('[data-id="' + g.spec.id + '"]');
    if (!from) return;
    var anchor = g.spec.code != null ? from.querySelector('.chip[data-code="' + g.spec.code.replace(/["\\]/g, "") + '"]') || from : from.querySelector(".branch") || from;
    var a = anchor.getBoundingClientRect();
    var x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
    linkLayer.textContent = "";
    var mid = (y1 + g.y) / 2;
    linkLayer.appendChild(svgEl("path", { d: "M" + x1 + " " + y1 + " C" + x1 + " " + mid + " " + g.x + " " + mid + " " + g.x + " " + g.y }));
    linkLayer.appendChild(svgEl("circle", { cx: g.x, cy: g.y, r: 5 }));
    var under = document.elementFromPoint(g.x, g.y);
    var card = under && under.closest ? under.closest('.card[data-kind="field"]') : null;
    [].forEach.call(world.querySelectorAll(".link-target"), function (el) { el.classList.remove("link-target"); });
    g.target = null;
    if (card && card.dataset.id !== g.spec.id) {
      var loc = find(card.dataset.id);
      if (loc && !loc.item.rid) { card.classList.add("link-target"); g.target = card.dataset.id; }
    }
  }

  function finishGesture(g) {
    var t = g.spec.type, p = state.project;
    if (t === "move" && g.drop) {
      if (g.drop.newForm) {
        var loc = find(g.spec.id);
        loc.form.items.splice(loc.index, 1);
        addForm(loc.item);
      } else moveItem(g.spec.id, g.drop.formId, g.drop.index);
    } else if (t === "new" && g.drop) {
      if (g.drop.newForm) addForm(C.createFromKind(p, g.spec.key));
      else insertNew(g.spec.key, g.drop.formId, g.drop.index);
    } else if (t === "form" && g.drop) {
      var from = p.forms.indexOf(formById(g.spec.formId));
      var form = p.forms.splice(from, 1)[0];
      p.forms.splice(g.drop.index, 0, form);
      changed({ inspector: true, now: true });
    } else if (t === "link") {
      if (g.target) applyLink(g.spec.id, g.spec.code, g.target);
      else toast("Drop it on the question that should depend on this answer.");
    } else renderCanvas();
  }

  function tapGesture(g) {
    var s = g.spec;
    if (s.type === "new") addAtEnd(s.key);
    else if (s.type === "link") { select(s.id); if (!s.touch) toast("Drag this onto another question to show that question only for this answer."); }
    else if (s.type === "move" || s.tapId) select(s.id || s.tapId);
    else if (s.type === "form" || s.tapForm) selectForm(s.formId || s.tapForm);
    else if (state.sel || state.selForm) { state.sel = null; state.selForm = null; renderCanvas(); renderInspector(); }
    else if (isNarrow()) { palette.classList.remove("open"); insp.classList.remove("open"); }
  }

  stage.addEventListener("pointerdown", function (e) {
    if (e.button) return;
    var t = e.target;
    if (t.closest("#zoom") || t.closest("#fab")) return;
    var touch = e.pointerType === "touch";
    if (touch) {
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        endGesture(false);
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: state.view.k };
        return;
      }
    }
    if (t.closest("button:not(.branch)")) return;
    var card = t.closest(".card"), head = t.closest(".form-head");
    if (card) {
      var id = card.dataset.id, loc = find(id), chip = t.closest(".chip:not(.more)");
      if (chip || t.closest(".branch")) startGesture({ type: "link", id: id, code: chip ? chip.dataset.code : null, touch: touch }, e);
      else if (loc && loc.item.rid) startGesture({ type: "pan", tapId: id }, e);
      else if (!touch || t.closest(".grip")) startGesture({ type: "move", id: id }, e);
      else startGesture({ type: "pan", tapId: id }, e);
    } else if (head) {
      var formId = head.parentNode.dataset.form;
      if (!touch || t.closest(".grip")) startGesture({ type: "form", formId: formId }, e);
      else startGesture({ type: "pan", tapForm: formId }, e);
    } else startGesture({ type: "pan" }, e);
  });

  window.addEventListener("pointermove", function (e) {
    if (touches[e.pointerId]) {
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(touches);
      if (pinch && ids.length >= 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        return;
      }
    }
    var g = gesture;
    if (!g || e.pointerId !== g.pointer) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.active) {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) < 5) return;
      g.active = true;
      beginGesture(g);
    }
    stepGesture(g);
  });

  function pointerDone(e, apply) {
    if (touches[e.pointerId]) { delete touches[e.pointerId]; if (Object.keys(touches).length < 2) pinch = null; }
    if (gesture && e.pointerId === gesture.pointer) endGesture(apply);
  }
  window.addEventListener("pointerup", function (e) { pointerDone(e, true); });
  window.addEventListener("pointercancel", function (e) { pointerDone(e, false); });

  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, state.view.k * Math.exp(-e.deltaY * 0.01));
    else { state.view.x -= e.deltaX; state.view.y -= e.deltaY; applyView(); }
  }, { passive: false });

  // ---------------------------------------------------------------- palette

  function renderPalette() {
    palette.textContent = "";
    var questions = h("div.tiles"), layout = h("div.tiles");
    C.KINDS.forEach(function (kind) {
      var tile = h("div.tile", { role: "button", tabindex: "0", title: kind.hint, "data-kind": kind.key },
        h("span.glyph", { text: kind.glyph }), h("span", kind.label, h("small", { text: kind.hint })));
      tile.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        e.preventDefault(); // keep keyboard focus where it was, so typing never lands on the tile
        startGesture({ type: "new", key: kind.key, el: tile }, e);
      });
      tile.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addAtEnd(kind.key); } });
      (kind.layout ? layout : questions).appendChild(tile);
    });
    append(palette, [h("h2", { text: "Questions" }), questions, h("h2", { text: "Layout" }), layout,
      h("p.palette-tip", { text: "Drag onto the canvas, or click to add below the selected question." })]);
  }

  function addMenu(anchor, formId) {
    openMenu(anchor, C.KINDS.map(function (kind) {
      return { glyph: kind.glyph, label: kind.label, run: function () { addAtEnd(kind.key, formId); } };
    }));
  }

  // ---------------------------------------------------------------- inspector

  function labelled(text, control, hint) {
    return h("label.f", text, control, hint ? h("small", { text: hint, style: "display:block;margin-top:2px" }) : null);
  }

  function renderInspector() {
    var p = state.project, loc = find(state.sel), form = formById(state.selForm);
    var scroll = insp.scrollTop;
    insp.textContent = "";
    insp.classList.toggle("open", !!(loc || form));
    if (loc && loc.item.kind === "section") sectionPanel(loc.item);
    else if (loc) fieldPanel(loc.item, loc.form);
    else if (form) formPanel(form);
    else projectPanel(p);
    insp.scrollTop = state.pendingFocus ? 0 : scroll;
    if (state.pendingFocus) {
      var target = insp.querySelector('[data-focus="' + state.pendingFocus + '"]');
      state.pendingFocus = null;
      if (target && !isNarrow()) { target.focus(); if (target.select) target.select(); }
    }
  }

  function closeButton() {
    return h("button.quiet.sheet-close", { text: "Done", onclick: function () { state.sel = null; state.selForm = null; renderCanvas(); renderInspector(); } });
  }

  function issueNotes(filter) {
    return state.issues.filter(filter).map(function (i) {
      return h("div.note." + i.severity, { text: i.message });
    });
  }

  function fieldPanel(f, form) {
    var p = state.project, kind = C.kindOf(f);
    append(insp, h("h2", h("span.glyph", { text: kind.glyph }), f.rid ? "Record ID" : kind.label, closeButton()));
    if (f.rid) append(insp, h("p.lead", { text: "REDCap needs this first field to tell records apart. It stays at the top; you can rename it." }));
    append(insp, h("div", { id: "issue-box" }, issueNotes(function (i) { return i.itemId === f.id; })));

    var nameInput = h("input.mono", { type: "text", value: f.name, spellcheck: false, autocapitalize: "off",
      onfocus: function () { nameInput.dataset.was = f.name; },
      oninput: function () {
        f.name = nameInput.value.trim().toLowerCase().replace(/[\s-]+/g, "_");
        f.autoName = false;
        changed();
      },
      onchange: function () {
        var was = nameInput.dataset.was, taken = C.allFields(p).some(function (o) { return o !== f && o.name === f.name; });
        if (was && f.name && was !== f.name && !taken && /^[a-z][a-z0-9_]*$/.test(f.name)) C.renameVariable(p, was, f.name);
        nameInput.dataset.was = f.name;
        changed({ inspector: true, now: true });
      } });

    append(insp, labelled(f.type === "descriptive" ? "Text to show" : "Question", h("textarea", { rows: 3, value: f.label, "data-focus": "label",
      placeholder: f.type === "descriptive" ? "Instructions or information for the respondent" : "Type the question as respondents will see it",
      oninput: function (e) {
        f.label = e.target.value;
        if (f.autoName) {
          var old = f.name;
          f.name = C.uniqueName(p, C.slugify(f.label, "question"), f.id);
          C.renameVariable(p, old, f.name);
          nameInput.value = f.name;
        }
        changed();
      } })));

    if (!f.rid) {
      var typeSel = h("select", { onchange: function () { applyKind(f, typeSel.value); changed({ inspector: true, now: true }); } });
      var known = false;
      C.KINDS.forEach(function (k) {
        if (!k.type) return;
        var same = k.type === f.type && (k.validation || "") === (f.validation || "");
        known = known || same;
        typeSel.appendChild(h("option", { value: k.key, text: k.label, selected: same }));
      });
      if (!known) typeSel.appendChild(h("option", { value: "", text: kind.label, selected: true }));
      append(insp, labelled("Answer type", typeSel));
    }

    if (C.CHOICE_TYPES[f.type]) choiceEditor(f);
    else if (f.type === "yesno") append(insp, h("p.lead", { text: "Stored as 1 = Yes and 0 = No." }));
    else if (f.type === "truefalse") append(insp, h("p.lead", { text: "Stored as 1 = True and 0 = False." }));

    if (f.type === "text") {
      var valSel = h("select", { onchange: function () { f.validation = valSel.value; if (!f.validation) { f.min = ""; f.max = ""; } changed({ inspector: true, now: true }); } });
      var has = false;
      C.VALIDATIONS.forEach(function (v) { has = has || v[0] === f.validation; valSel.appendChild(h("option", { value: v[0], text: v[1], selected: v[0] === f.validation })); });
      if (!has) valSel.appendChild(h("option", { value: f.validation, text: f.validation, selected: true }));
      append(insp, labelled("Check that the answer is", valSel));
      if (/^(integer|number|date|datetime|time)/.test(f.validation)) {
        append(insp, h("div.row",
          labelled("Smallest allowed", h("input", { type: "text", value: f.min, placeholder: "none", oninput: function (e) { f.min = e.target.value.trim(); changed(); } })),
          labelled("Largest allowed", h("input", { type: "text", value: f.max, placeholder: "none", oninput: function (e) { f.max = e.target.value.trim(); changed(); } }))));
      }
    }
    if (f.type === "calc") {
      append(insp, labelled("Equation", h("textarea.mono", { rows: 3, value: f.calc, spellcheck: false, placeholder: "[weight] / ([height] * [height])",
        oninput: function (e) { f.calc = e.target.value; changed(); } }), "Use variable names in square brackets, as in REDCap."));
    }

    append(insp, labelled("Variable name", nameInput, f.autoName ? "Suggested from the question. This is the column name in your data." : "The column name in your data."));
    if (f.type !== "descriptive") {
      append(insp, labelled("Help text (optional)", h("input", { type: "text", value: f.note, placeholder: "Shown in small print under the question",
        oninput: function (e) { f.note = e.target.value; changed(); } })));
      if (!f.rid && f.type !== "calc") {
        append(insp, h("label.check", h("input", { type: "checkbox", checked: f.required, onchange: function (e) { f.required = e.target.checked; changed({ now: true }); } }),
          h("span", "Required", h("small", { text: "Respondents must answer before moving on." }))));
      }
      append(insp, h("label.check", h("input", { type: "checkbox", checked: f.identifier, onchange: function (e) { f.identifier = e.target.checked; changed({ now: true }); } }),
        h("span", "Identifies the participant", h("small", { text: "Names, contact details, dates of birth. REDCap can leave these out of exports." }))));
    }

    if (!f.rid) {
      append(insp, h("h3", { text: "When to show this" }));
      logicEditor(f);
    }

    var dependents = C.allFields(p).filter(function (o) {
      return o !== f && o.logic && C.logicRefs(o.logic).some(function (r) { return r.name === f.name; });
    });
    if (dependents.length) {
      append(insp, h("h3", { text: "Questions that depend on this" }));
      dependents.forEach(function (o) {
        append(insp, h("div.note.info.click", { text: C.shortLabel(o), title: o.logic, onclick: function () { select(o.id, { reveal: true }); } }));
      });
    }

    var adv = h("details.adv", h("summary", { text: "More options" }),
      labelled("Action tags", h("input.mono", { type: "text", value: f.annotation, placeholder: "@HIDDEN, @DEFAULT=…", spellcheck: false,
        oninput: function (e) { f.annotation = e.target.value; changed(); } }), "REDCap field annotation. Leave blank if unsure."));
    if (f.extra.length) {
      var dl = h("dl.dl");
      f.extra.forEach(function (kv) { append(dl, [h("dt", { text: kv[0] }), h("dd", { text: kv[1] })]); });
      append(adv, [h("p.lead", { text: "Kept from the imported project:" }), dl]);
    }
    append(adv, h("p.lead", { text: "Instrument: " + form.label + " (" + form.name + ")" }));
    insp.appendChild(adv);

    if (!f.rid) {
      append(insp, h("div.actions",
        h("button", { text: "Duplicate", onclick: function () { duplicateItem(f.id); } }),
        h("button.danger", { text: "Delete", onclick: function () { deleteItem(f.id); } })));
    }
  }

  function choiceEditor(f) {
    append(insp, h("h3", { text: "Answer choices" }));
    var list = h("div");
    f.choices.forEach(function (c, k) {
      list.appendChild(h("div.choice-row",
        h("input", { type: "text", value: c.code, title: "The value stored in your data", "aria-label": "Code", spellcheck: false,
          oninput: function (e) { c.code = e.target.value.trim(); changed(); } }),
        h("input", { type: "text", value: c.label, placeholder: "Answer " + (k + 1), "aria-label": "Answer", "data-focus": "choice-" + k,
          oninput: function (e) { c.label = e.target.value; changed(); },
          onkeydown: function (e) { if (e.key === "Enter") { e.preventDefault(); addChoice(); } } }),
        h("button.icon-btn", { text: "×", title: "Remove this answer", disabled: f.choices.length < 2,
          onclick: function () { f.choices.splice(k, 1); changed({ inspector: true, now: true }); } })));
    });
    function addChoice() {
      f.choices.push({ code: C.nextCode(f.choices), label: "" });
      state.pendingFocus = "choice-" + (f.choices.length - 1);
      changed({ inspector: true, now: true });
    }
    var bulk = h("div", { hidden: true });
    var area = h("textarea", { rows: 5, placeholder: "One answer per line", value: f.choices.map(function (c) { return c.label; }).join("\n") });
    append(bulk, [area, h("div.actions", { style: "margin-top:6px" },
      h("button.primary", { text: "Use this list", onclick: function () {
        var lines = area.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!lines.length) return;
        var coded = lines.every(function (s) { return /^-?[A-Za-z0-9_.]+\s*,\s*\S/.test(s); });
        f.choices = coded ? C.parseChoices(lines.join("\n")) : lines.map(function (s, k) { return { code: String(k + 1), label: s }; });
        changed({ inspector: true, now: true });
      } }),
      h("button", { text: "Cancel", onclick: function () { bulk.hidden = true; } }))]);
    append(insp, [list,
      h("div.row", h("button.link-btn", { text: "+ Add an answer", onclick: addChoice }),
        h("button.link-btn", { text: "Paste a list", style: "text-align:right", onclick: function () { bulk.hidden = !bulk.hidden; if (!bulk.hidden) area.focus(); } })),
      bulk, h("p.lead", { text: "The small box is the code saved in your data. Drag an answer on the canvas onto another question to branch on it." })]);
  }

  // ---- "When to show this" editor

  function ruleTargets(f) {
    return C.allFields(state.project).filter(function (o) { return o !== f && o.type !== "descriptive"; });
  }

  function defaultRuleFor(t) {
    if (t.type === "checkbox") return { field: t.name, code: t.choices.length ? t.choices[0].code : "1", op: "checked", value: "" };
    if (C.CODED_TYPES[t.type] && t.choices.length) return { field: t.name, code: null, op: "=", value: t.choices[0].code };
    return { field: t.name, code: null, op: "answered", value: "" };
  }

  function defaultRule(f) {
    var all = C.allFields(state.project), at = all.indexOf(f);
    var before = all.slice(0, at).filter(function (o) { return o.type !== "descriptive" && !o.rid; }).reverse();
    var pick = before.filter(function (o) { return C.CODED_TYPES[o.type]; })[0] || before[0] ||
      ruleTargets(f).filter(function (o) { return !o.rid; })[0];
    return pick ? defaultRuleFor(pick) : null;
  }

  var OPS_CODED = [["=", "is"], ["<>", "is not"], ["answered", "is answered"], ["empty", "is blank"]];
  var OPS_CHECK = [["checked", "includes"], ["unchecked", "does not include"]];
  var OPS_OPEN = [["=", "is"], ["<>", "is not"], [">", "is more than"], [">=", "is at least"], ["<", "is less than"], ["<=", "is at most"],
    ["answered", "is answered"], ["empty", "is blank"]];

  function logicEditor(f) {
    var has = !!(f.logic && f.logic.trim());
    var spec = has ? C.simpleRules(f.logic) : null;
    var raw = has && (state.rawMode[f.id] || !spec);
    append(insp, h("div.seg",
      h("button", { text: "Always", "aria-pressed": String(!has), onclick: function () {
        f.logic = ""; delete state.rawMode[f.id]; changed({ inspector: true, now: true });
      } }),
      h("button", { text: "Only if…", "aria-pressed": String(has), onclick: function () {
        if (has) return;
        var rule = defaultRule(f);
        if (!rule) { toast("Add another question first, then make this one depend on it."); return; }
        f.logic = C.ruleToLogic(rule);
        changed({ inspector: true, now: true });
      } })));
    if (!has) {
      append(insp, h("p.lead", { text: "Tip: on the canvas, drag an answer from another question onto this one." }));
      return;
    }
    var box = h("div.rules");
    var index = C.fieldIndex(state.project);
    if (raw) {
      var english = h("div.english");
      var showEnglish = function () { english.textContent = C.simpleRules(f.logic) ? "Shows if " + C.describeLogic(f.logic, index) : ""; };
      showEnglish();
      append(box, [english, h("textarea.mono", { rows: 4, value: f.logic, spellcheck: false,
        oninput: function (e) { f.logic = e.target.value; showEnglish(); changed(); },
        onchange: function () { changed({ inspector: true, now: true }); } })]);
      if (spec) append(box, h("button.link-btn", { text: "Back to the simple editor", onclick: function () { delete state.rawMode[f.id]; renderInspector(); } }));
      else append(box, h("p.lead", { style: "margin:6px 0 0", text: "This rule is more detailed than the simple editor can show, so it is kept exactly as REDCap logic." }));
    } else {
      var write = function (rerender) { f.logic = C.rulesToLogic(spec); changed({ inspector: rerender, now: rerender }); };
      if (spec.rules.length > 1) {
        var joinSel = h("select", { style: "margin-bottom:8px", onchange: function () { spec.join = joinSel.value; write(true); } },
          h("option", { value: "and", text: "Show when ALL of these are true", selected: spec.join === "and" }),
          h("option", { value: "or", text: "Show when ANY of these is true", selected: spec.join === "or" }));
        box.appendChild(joinSel);
      }
      spec.rules.forEach(function (r, k) { box.appendChild(ruleRow(f, spec, r, k, index, write)); });
      append(box, h("div.row",
        h("button.link-btn", { text: "+ Add a condition", onclick: function () {
          var rule = defaultRule(f);
          if (rule) { spec.rules.push(rule); write(true); }
        } }),
        h("button.link-btn", { text: "Edit as REDCap logic", style: "text-align:right", onclick: function () { state.rawMode[f.id] = true; renderInspector(); } })));
    }
    insp.appendChild(box);
  }

  function ruleRow(f, spec, r, k, index, write) {
    var hit = index[r.field], t = hit ? hit.field : null;
    var fieldSel = h("select", { "aria-label": "Question", onchange: function () {
      var next = index[fieldSel.value];
      if (next) { spec.rules[k] = defaultRuleFor(next.field); write(true); }
    } });
    if (!t) fieldSel.appendChild(h("option", { value: r.field, text: "[" + r.field + "] (missing)", selected: true }));
    state.project.forms.forEach(function (form) {
      var group = h("optgroup", { label: form.label });
      form.items.forEach(function (o) {
        if (!C.isField(o) || o === f || o.type === "descriptive") return;
        group.appendChild(h("option", { value: o.name, text: C.shortLabel(o), selected: o === t }));
      });
      if (group.children.length) fieldSel.appendChild(group);
    });
    var parts = h("div.parts", fieldSel);
    var checkbox = t && t.type === "checkbox", coded = t && C.CODED_TYPES[t.type] && !checkbox;
    var ops = checkbox ? OPS_CHECK : coded ? OPS_CODED : OPS_OPEN;
    var needsValue = r.op !== "answered" && r.op !== "empty";
    var opSel = h("select" + (needsValue ? "" : ".solo"), { "aria-label": "Comparison", onchange: function () {
      var was = r.op;
      r.op = opSel.value;
      var wasValue = was !== "answered" && was !== "empty", nowValue = r.op !== "answered" && r.op !== "empty";
      if (nowValue && !wasValue) r.value = coded && t.choices.length ? t.choices[0].code : "1";
      write(true);
    } });
    ops.forEach(function (o) { opSel.appendChild(h("option", { value: o[0], text: o[1], selected: o[0] === r.op })); });
    parts.appendChild(opSel);
    if (needsValue) {
      if (checkbox || coded) {
        var current = checkbox ? r.code : r.value;
        var valSel = h("select", { "aria-label": "Answer", onchange: function () { if (checkbox) r.code = valSel.value; else r.value = valSel.value; write(true); } });
        var found = false;
        t.choices.forEach(function (c) {
          found = found || c.code === current;
          valSel.appendChild(h("option", { value: c.code, text: C.stripHtml(c.label) || c.code, selected: c.code === current }));
        });
        if (!found) valSel.appendChild(h("option", { value: current, text: current + " (not an answer)", selected: true }));
        parts.appendChild(valSel);
      } else {
        parts.appendChild(h("input", { type: "text", value: r.value, "aria-label": "Value", placeholder: "value",
          oninput: function (e) { r.value = e.target.value.trim(); write(false); } }));
      }
    }
    return h("div.rule", parts, h("button.icon-btn", { text: "×", title: "Remove this condition", onclick: function () {
      spec.rules.splice(k, 1);
      write(true);
    } }));
  }

  function sectionPanel(s) {
    append(insp, [h("h2", h("span.glyph", { text: "§" }), "Section heading", closeButton()),
      issueNotes(function (i) { return i.itemId === s.id; }),
      labelled("Heading", h("textarea", { rows: 2, value: s.label, "data-focus": "label", oninput: function (e) { s.label = e.target.value; changed(); } }),
        "Shown as a band above the question that follows it."),
      h("div.actions", h("button.danger", { text: "Delete", onclick: function () { deleteItem(s.id); } }))]);
  }

  function formPanel(form) {
    var p = state.project, at = p.forms.indexOf(form);
    function shift(by) {
      p.forms.splice(at, 1);
      p.forms.splice(at + by, 0, form);
      changed({ inspector: true, now: true });
    }
    append(insp, [h("h2", "Instrument", closeButton()),
      h("p.lead", { text: "An instrument is one page or form in REDCap. Each can be a survey or a data entry form." }),
      issueNotes(function (i) { return i.formId === form.id && !i.itemId; }),
      labelled("Name", h("input", { type: "text", value: form.label, "data-focus": "form-label", oninput: function (e) {
        form.label = e.target.value;
        if (form.autoName) form.name = C.uniqueFormName(p, C.formSlug(form.label), form.id);
        changed();
      } }), "Name inside REDCap: " + form.name),
      h("div.actions",
        h("button", { text: "← Move left", disabled: at === 0, onclick: function () { shift(-1); } }),
        h("button", { text: "Move right →", disabled: at === p.forms.length - 1, onclick: function () { shift(1); } }),
        h("button.danger", { text: "Delete instrument", disabled: p.forms.length < 2, onclick: function () {
          p.forms.splice(at, 1);
          state.selForm = null;
          changed({ inspector: true, now: true });
          toast("Instrument deleted. Press Undo to bring it back.");
        } }))]);
  }

  function projectPanel(p) {
    var fields = C.allFields(p);
    var gated = fields.filter(function (f) { return f.logic && f.logic.trim(); }).length;
    append(insp, [h("h2", { text: "Your survey" }),
      h("dl.dl", h("dt", { text: "Questions" }), h("dd", { text: String(fields.length) }),
        h("dt", { text: "Instruments" }), h("dd", { text: String(p.forms.length) }),
        h("dt", { text: "With branching" }), h("dd", { text: String(gated) }),
        p.source ? [h("dt", { text: "Opened from" }), h("dd", { text: p.source.file || p.source.format })] : null)]);
    if (state.issues.length) {
      append(insp, h("h3", { text: "To fix before uploading" }));
      state.issues.forEach(function (i) {
        var loc = find(i.itemId);
        var who = loc ? (loc.item.kind === "section" ? "Section" : loc.item.name) + ": " : "";
        append(insp, h("div.note.click." + i.severity, { onclick: function () {
          if (i.itemId) select(i.itemId, { reveal: true }); else if (i.formId) selectForm(i.formId);
        } }, who ? h("b", { text: who }) : null, i.message));
      });
    } else {
      append(insp, h("div.note.info", { text: "No problems found. Preview it, then export to REDCap." }));
    }
    append(insp, [h("h3", { text: "How it works" }),
      h("ol.steps",
        h("li", { text: "Drag a question type onto an instrument, then type the question." }),
        h("li", { text: "To add branching, drag an answer (like Yes) onto the question that should appear for it." }),
        h("li", { text: "Press Preview to answer the survey yourself and watch questions appear and disappear." }),
        h("li", { text: "Press Export to download a file REDCap can upload." })),
      h("p.lead", { style: "margin-top:14px", text: "Your work is saved in this browser as you go. Nothing is uploaded anywhere." })]);
  }

  // ---------------------------------------------------------------- menus and modals

  var openThing = null;
  function closeThing() { if (openThing) { openThing.remove(); openThing = null; } }

  function openMenu(anchor, items) {
    closeThing();
    var menu = h("div.menu");
    items.forEach(function (it) {
      if (!it) { menu.appendChild(h("hr")); return; }
      menu.appendChild(h("button", { onclick: function () { closeThing(); it.run(); } },
        it.glyph ? h("span.glyph", { text: it.glyph }) : null, it.label));
    });
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
    menu.style.top = top + "px";
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
    openThing = menu;
  }
  document.addEventListener("pointerdown", function (e) {
    if (openThing && openThing.classList.contains("menu") && !openThing.contains(e.target)) closeThing();
  }, true);

  function openModal(content, cls) {
    closeThing();
    var scrim = h("div.scrim", { onpointerdown: function (e) { if (e.target === scrim) closeThing(); } }, h("div.modal" + (cls || ""), { role: "dialog", "aria-modal": "true" }, content));
    document.body.appendChild(scrim);
    openThing = scrim;
    return scrim.firstChild;
  }

  function welcome() {
    openModal([
      h("h2", { text: "Design a REDCap survey" }),
      h("p.lead", { text: "Build questions and skip logic by dragging, test it like a respondent, then download a file REDCap can upload. You can also open an existing REDCap project to see and change it." }),
      h("div.options",
        h("button.option", { onclick: function () { closeThing(); setProject(C.newProject("My survey"), true); } },
          h("span.big", { text: "＋" }), h("strong", { text: "Start a new survey" }), h("span", { text: "A blank canvas with a record ID ready to go." })),
        h("button.option", { onclick: function () { closeThing(); $("file").click(); } },
          h("span.big", { text: "⇪" }), h("strong", { text: "Open a REDCap file" }), h("span", { text: "A project XML export or a data dictionary CSV. You can also drop the file anywhere on this page." })),
        h("button.option", { onclick: function () { closeThing(); setProject(C.sampleProject(), true); toast("This is an example. Click a question, or press Preview to try it."); } },
          h("span.big", { text: "◉" }), h("strong", { text: "Explore an example" }), h("span", { text: "A short housing survey with branching already set up." }))),
      h("p.lead", { style: "margin:16px 0 0", text: "Everything happens in this browser on your computer. Nothing is uploaded." })
    ]);
  }

  function download(name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = h("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportModal() {
    if (commitTimer) commit();
    var p = state.project;
    var errors = state.issues.filter(function (i) { return i.severity === "error"; });
    var stem = (p.title.trim() || "survey").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "survey";
    var done = h("div");
    function run(kind) {
      try {
        if (kind === "xml") {
          var out = C.exportOdm(p);
          download(stem + ".REDCap.xml", out.xml, "application/xml");
          done.textContent = "";
          append(done, [h("div.note.info", { text: "Downloaded " + stem + ".REDCap.xml" })].concat(out.notes.map(function (n) { return h("div.note.warning", { text: n }); })));
        } else {
          download(stem + "_DataDictionary.csv", C.exportDataDictionary(p), "text/csv");
          done.textContent = "";
          append(done, h("div.note.info", { text: "Downloaded " + stem + "_DataDictionary.csv" }));
        }
      } catch (e) {
        done.textContent = "";
        append(done, h("div.note.error", { text: e.message }));
      }
    }
    openModal([
      h("div.modal-head", h("h2", { text: "Export to REDCap" }), h("button.quiet", { text: "Close", onclick: closeThing })),
      h("p.lead", { text: plural(C.allFields(p).length, "question") + " in " + plural(p.forms.length, "instrument") + "." }),
      errors.length ? h("div.note.error", h("b", { text: plural(errors.length, "problem") + " to fix first. " }),
        "REDCap may reject the file or questions may never show. ",
        h("button.link-btn", { text: "Show me", onclick: function () { closeThing(); state.sel = null; state.selForm = null; renderCanvas(); renderInspector(); insp.classList.add("open"); } })) : null,
      h("div.options",
        h("div.panelbox", h("h3", { text: "A new REDCap project" }), h("p", { text: "Creates the whole project: instruments, questions and branching." }),
          h("button.primary", { text: "Download project XML", onclick: function () { run("xml"); } }),
          h("ol.steps", h("li", { text: "In REDCap, choose New Project." }), h("li", { text: "Pick “Upload a REDCap project XML file”." }), h("li", { text: "Choose the downloaded file and create the project." }))),
        h("div.panelbox", h("h3", { text: "A project you already have" }), h("p", { text: "Replaces that project's questions with this design." }),
          h("button", { text: "Download data dictionary CSV", onclick: function () { run("csv"); } }),
          h("ol.steps", h("li", { text: "Open the project, then Project Setup." }), h("li", { text: "Open Data Dictionary." }), h("li", { text: "Upload the downloaded CSV and commit the changes." })))),
      done,
      h("p.lead", { style: "margin:14px 0 0", text: "To keep working later, open the project XML here again. It is also your save file." })
    ]);
  }

  // ---------------------------------------------------------------- preview

  function openPreview() {
    if (commitTimer) commit();
    var p = state.project, answers = {}, wraps = [];
    var loc = find(state.sel);
    var current = Math.max(0, p.forms.indexOf(loc ? loc.form : formById(state.selForm)));
    var body = h("div.pv-form");
    var formSel = h("select", { "aria-label": "Instrument", onchange: function () { current = +formSel.value; build(); } });
    p.forms.forEach(function (form, k) { formSel.appendChild(h("option", { value: String(k), text: form.label, selected: k === current })); });
    var status = h("span.lead", { style: "margin:0" });

    function setAnswer(f, value) {
      if (value === "" || value == null) delete answers[f.name]; else answers[f.name] = value;
      refresh();
    }

    function control(f) {
      var name = "pv_" + f.name;
      if (f.type === "descriptive") return null;
      if (C.CODED_TYPES[f.type] && f.type !== "dropdown") {
        var box = f.type === "checkbox";
        return h("div", f.choices.map(function (c) {
          return h("label.opt", h("input", { type: box ? "checkbox" : "radio", name: name, value: c.code, onchange: function (e) {
            if (!box) return setAnswer(f, c.code);
            var set = answers[f.name] && typeof answers[f.name] === "object" ? answers[f.name] : {};
            if (e.target.checked) set[c.code] = true; else delete set[c.code];
            setAnswer(f, Object.keys(set).length ? set : "");
          } }), C.stripHtml(c.label) || c.code);
        }), box ? null : h("button.link-btn", { text: "clear", onclick: function (e) {
          [].forEach.call(e.target.parentNode.querySelectorAll("input"), function (i) { i.checked = false; });
          setAnswer(f, "");
        } }));
      }
      if (f.type === "dropdown") {
        return h("select", { onchange: function (e) { setAnswer(f, e.target.value); } }, h("option", { value: "", text: "" }),
          f.choices.map(function (c) { return h("option", { value: c.code, text: C.stripHtml(c.label) || c.code }); }));
      }
      if (f.type === "notes") return h("textarea", { rows: 3, oninput: function (e) { setAnswer(f, e.target.value); } });
      if (f.type === "slider") return h("input", { type: "range", min: 0, max: 100, style: "max-width:420px;width:100%", oninput: function (e) { setAnswer(f, e.target.value); } });
      if (f.type === "calc") return h("input", { type: "text", disabled: true, placeholder: "REDCap works this out" });
      if (f.type === "file") return h("input", { type: "text", disabled: true, placeholder: "File upload" });
      var v = f.validation || "";
      var type = /^(integer|number)/.test(v) ? "number" : /^date_/.test(v) ? "date" : v === "email" ? "email" : "text";
      return h("input", { type: type, oninput: function (e) { setAnswer(f, e.target.value); } });
    }

    function build() {
      body.textContent = "";
      wraps = [];
      p.forms[current].items.forEach(function (it) {
        if (it.kind === "section") { body.appendChild(h("div.pv-section", { text: C.stripHtml(it.label) })); return; }
        if (it.rid) return;
        var tags = h("span");
        var el = h("div.pv-q", it.type === "descriptive" ? h("div.pv-desc", C.stripHtml(it.label), tags)
          : [h("div.q", C.stripHtml(it.label) || it.name, it.required ? h("span.star", { text: " *" }) : null, tags), control(it),
            it.note ? h("div.hint", { text: C.stripHtml(it.note) }) : null]);
        wraps.push({ f: it, el: el, tags: tags });
        body.appendChild(el);
      });
      if (!wraps.length) body.appendChild(h("p.lead", { style: "margin-top:16px", text: "This instrument has no questions for respondents yet." }));
      // restore answers already given on this instrument
      wraps.forEach(function (w) {
        var a = answers[w.f.name];
        if (a == null) return;
        [].forEach.call(w.el.querySelectorAll("input, select, textarea"), function (i) {
          if (i.type === "radio") i.checked = i.value === a;
          else if (i.type === "checkbox") i.checked = !!a[i.value];
          else i.value = a;
        });
      });
      refresh();
    }

    function refresh() {
      var all = C.allFields(p), shown = {}, again = true, guard = 0;
      while (again && guard++ < 25) {
        again = false;
        all.forEach(function (f) {
          var s = C.isShown(f, answers);
          shown[f.id] = s;
          if (s === false && answers[f.name] != null) { delete answers[f.name]; again = true; }
        });
      }
      var visible = 0;
      wraps.forEach(function (w) {
        var s = shown[w.f.id];
        w.el.classList.toggle("skipped", s === false);
        if (s === false) {
          [].forEach.call(w.el.querySelectorAll("input, select, textarea"), function (i) {
            if (i.type === "radio" || i.type === "checkbox") i.checked = false; else if (!i.disabled) i.value = "";
          });
        } else visible++;
        w.tags.textContent = "";
        if (s === false) w.tags.appendChild(h("span.pv-tag.skip", { text: "skipped" }));
        else if (s === null) w.tags.appendChild(h("span.pv-tag.unk", { text: "always shown here", title: "This logic uses REDCap features the preview cannot run: " + w.f.logic }));
        else if (w.f.logic && w.f.logic.trim()) w.tags.appendChild(h("span.pv-tag.cond", { text: "shown by branching", title: w.f.logic }));
      });
      status.textContent = visible + " of " + wraps.length + " showing";
    }

    var modal = openModal([
      h("div.modal-head", h("h2", { text: "Preview" }), h("button.quiet", { text: "Close", onclick: closeThing })),
      h("p.lead", { text: "Answer as a respondent would. Questions appear and disappear according to your branching." }),
      h("div.pv-bar", formSel, status,
        h("label.check", { style: "margin:0" }, h("input", { type: "checkbox", onchange: function (e) { modal.classList.toggle("show-skipped", e.target.checked); } }), "Show skipped questions"),
        h("button", { text: "Start over", onclick: function () { answers = {}; build(); } })),
      body
    ], ".wide");
    build();
  }

  // ---------------------------------------------------------------- opening files

  function loadText(text, name) {
    try {
      var result = C.importAny(text, name);
      setProject(result.project, true);
      var n = C.allFields(result.project).length;
      if (result.notes.length) {
        openModal([h("div.modal-head", h("h2", { text: "Opened " + name }), h("button.primary", { text: "OK", onclick: closeThing })),
          h("p.lead", { text: plural(n, "question") + " in " + plural(result.project.forms.length, "instrument") + "." }),
          result.notes.map(function (note) { return h("div.note.info", { text: note }); })]);
      } else toast("Opened " + name + ": " + plural(n, "question") + ". Undo brings back what you had before.");
      requestAnimationFrame(function () {
        // Small projects open fitted; large ones stay readable and are panned.
        fitView();
        if (state.view.k < 0.6) { state.view = { x: 28, y: 24, k: 0.6 }; applyView(); }
      });
    } catch (e) {
      openModal([h("div.modal-head", h("h2", { text: "That file could not be opened" }), h("button.primary", { text: "OK", onclick: closeThing })),
        h("div.note.error", { text: e && e.name === "InputError" ? e.message : "Something unexpected went wrong reading " + name + ": " + (e && e.message) }),
        h("p.lead", { text: "Use a REDCap project XML (Project Setup, Other Functionality, Download metadata only) or a Data Dictionary CSV." })]);
    }
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { loadText(String(reader.result), file.name); };
    reader.onerror = function () { toast("That file could not be read."); };
    reader.readAsText(file);
  }

  $("file").addEventListener("change", function (e) { readFile(e.target.files[0]); e.target.value = ""; });

  var dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  window.addEventListener("dragenter", function (e) { if (hasFiles(e)) { dragDepth++; $("dropzone").classList.add("show"); e.preventDefault(); } });
  window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", function (e) { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("dropzone").classList.remove("show"); } });
  window.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("dropzone").classList.remove("show");
    readFile(e.dataTransfer.files[0]);
  });

  // ---------------------------------------------------------------- wiring

  function renderAll() { renderCanvas(); renderInspector(); updateTop(); }

  $("title").addEventListener("input", function (e) { state.project.title = e.target.value; clearTimeout(commitTimer); commitTimer = setTimeout(commit, 500); document.title = e.target.value + " · XML Wizard Designer"; });
  $("undo").addEventListener("click", function () { travel(-1); });
  $("redo").addEventListener("click", function () { travel(1); });
  $("problems").addEventListener("click", function () { state.sel = null; state.selForm = null; renderCanvas(); renderInspector(); insp.classList.add("open"); });
  $("preview").addEventListener("click", openPreview);
  $("open").addEventListener("click", function () { $("file").click(); });
  $("export").addEventListener("click", exportModal);
  $("more").addEventListener("click", function (e) {
    openMenu(e.currentTarget, [
      { label: "New survey", run: function () { setProject(C.newProject("My survey"), true); toast("Started a new survey. Undo brings back the previous one."); } },
      { label: "Open the example", run: function () { setProject(C.sampleProject(), true); } },
      { label: "Open a REDCap file…", run: function () { $("file").click(); } },
      null,
      { label: "Undo", run: function () { travel(-1); } },
      { label: "Redo", run: function () { travel(1); } },
      { label: "Fit everything on screen", run: fitView },
      null,
      { label: "Start screen", run: welcome }
    ]);
  });
  $("zoom-in").addEventListener("click", function () { var r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, state.view.k * 1.2); });
  $("zoom-out").addEventListener("click", function () { var r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, state.view.k / 1.2); });
  $("zoom-fit").addEventListener("click", fitView);
  $("fab").addEventListener("click", function () { insp.classList.remove("open"); palette.classList.toggle("open"); });

  window.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || tag === "select";
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      if (openThing) closeThing();
      else if (gesture) endGesture(false);
      else if (typing) e.target.blur();
      else if (state.sel || state.selForm) { state.sel = null; state.selForm = null; renderCanvas(); renderInspector(); }
      return;
    }
    if (openThing) return;
    if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); travel(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); travel(1); }
    else if (mod && e.key.toLowerCase() === "d" && state.sel) { e.preventDefault(); duplicateItem(state.sel); }
    else if ((e.key === "Delete" || e.key === "Backspace") && state.sel && (e.target === document.body || stage.contains(e.target))) { e.preventDefault(); deleteItem(state.sel); }
  });
  window.addEventListener("resize", function () { applyView(); });

  // ---------------------------------------------------------------- start

  renderPalette();
  var preload = null, saved = null;
  try { preload = JSON.parse($("xmlw-preload").textContent || "null"); } catch (e) { preload = null; }
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
  if (preload && preload.text) {
    state.project = C.newProject("My survey");
    loadText(preload.text, preload.name || "project");
    if (!state.history.length) setProject(state.project);
  } else if (saved && saved.forms && saved.forms.length) {
    setProject(saved);
  } else {
    setProject(C.newProject("My survey"));
    welcome();
  }
  window.XMLWDesigner = { state: state, core: C };
})();
