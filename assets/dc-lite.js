/* dc-lite: tiny runtime that renders Keenum page templates and wires up their interactive parts. */
(function () {
  'use strict';

  var FORM_EMAIL = window.KEENUM_FORM_EMAIL || 'KeenumLawncare@gmail.com';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.');
    var s = scope, v;
    while (s) {
      if (s.vars && Object.prototype.hasOwnProperty.call(s.vars, parts[0])) { v = s.vars[parts[0]]; break; }
      s = s.parent;
    }
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, e) { var v = lookup(scope, e); return v == null ? '' : String(v); });
  }

  // Sends the form with a normal page submission to FormSubmit, which then returns visitors to /thanks.
  function sendForm(form) {
    var out = document.createElement('form');
    out.method = 'POST';
    out.action = 'https://formsubmit.co/' + FORM_EMAIL;
    out.style.display = 'none';
    function add(name, value) {
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = name; i.value = value == null ? '' : String(value);
      out.appendChild(i);
    }
    new FormData(form).forEach(function (v, k) { add(k, v); });
    add('page', location.pathname);
    add('_subject', 'New website request from keenumlawncare.com');
    add('_template', 'table');
    add('_captcha', 'false');
    add('_next', location.origin + '/thanks');
    add('_honey', '');
    document.body.appendChild(out);
    out.submit();
    return true;
  }

  function eventName(attr, el) {
    var n = attr.slice(2).toLowerCase();
    if (n === 'change') {
      var t = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'SELECT' || t === 'checkbox' || t === 'radio') return 'change';
      return 'input';
    }
    return n;
  }

  function setAttr(el, name, v) {
    if (name === 'checked' || name === 'value' || name === 'selected') {
      el[name] = name === 'value' ? (v == null ? '' : v) : !!v;
      if (name !== 'value') { if (v) el.setAttribute(name, ''); else el.removeAttribute(name); }
      else el.setAttribute('value', v == null ? '' : v);
      return;
    }
    if (name.indexOf('aria-') === 0) { el.setAttribute(name, String(v)); return; }
    if (v === false || v == null) el.removeAttribute(name);
    else if (v === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(v));
  }

  // Compile a template node into an instance {nodes, update(scope)}
  function compile(tpl, scope) {
    if (tpl.nodeType === 3) {
      var text = tpl.nodeValue;
      var tn = document.createTextNode('');
      if (!HOLE.test(text)) { HOLE.lastIndex = 0; tn.nodeValue = text; return { nodes: [tn], update: function () {} }; }
      HOLE.lastIndex = 0;
      var upd = function (s) { tn.nodeValue = interp(text, s); };
      upd(scope);
      return { nodes: [tn], update: upd };
    }
    if (tpl.nodeType !== 1) return { nodes: [], update: function () {} };
    var tag = tpl.tagName.toLowerCase();
    if (tag === 'sc-for') return compileFor(tpl, scope);
    if (tag === 'sc-if') return compileIf(tpl, scope);

    var el = tpl.namespaceURI && tpl.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(tpl.namespaceURI, tpl.localName)
      : document.createElement(tpl.tagName);
    var updaters = [];
    var handlers = {};
    Array.prototype.forEach.call(tpl.attributes, function (a) {
      var name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) return;
      if (/^on[a-z]+$/i.test(name) && WHOLE.test(val)) {
        var expr = val.match(WHOLE)[1];
        var evName = eventName(name, tpl);
        handlers[evName] = null;
        el.addEventListener(evName, function (e) {
          if (evName === 'submit') { e.preventDefault(); sendForm(el); return; }
          var h = handlers[evName];
          if (typeof h === 'function') h(e);
        });
        updaters.push(function (s) { handlers[evName] = lookup(s, expr); });
        return;
      }
      if (WHOLE.test(val)) {
        var ex = val.match(WHOLE)[1];
        updaters.push(function (s) { setAttr(el, name, lookup(s, ex)); });
      } else if (HOLE.test(val)) {
        HOLE.lastIndex = 0;
        updaters.push(function (s) { el.setAttribute(name, interp(val, s)); });
      } else {
        HOLE.lastIndex = 0;
        el.setAttribute(name, val);
      }
    });
    var kids = [];
    var src = tag === 'template' ? tpl.content : tpl;
    Array.prototype.forEach.call(src.childNodes, function (c) {
      var inst = compile(c, scope);
      inst.nodes.forEach(function (n) { el.appendChild(n); });
      kids.push(inst);
    });
    var update = function (s) {
      updaters.forEach(function (u) { u(s); });
      kids.forEach(function (k) { k.update(s); });
    };
    updaters.forEach(function (u) { u(scope); });
    return { nodes: [el], update: update };
  }

  function region(tpl, scope, build) {
    var start = document.createComment('dc'), end = document.createComment('/dc');
    var frag = document.createDocumentFragment();
    frag.appendChild(start); frag.appendChild(end);
    var state = { items: [] };
    function clear() {
      var n = start.nextSibling;
      while (n && n !== end) { var nx = n.nextSibling; n.parentNode.removeChild(n); n = nx; }
    }
    function insert(nodes) {
      nodes.forEach(function (n) { end.parentNode ? end.parentNode.insertBefore(n, end) : frag.insertBefore(n, end); });
    }
    return { start: start, end: end, frag: frag, state: state, clear: clear, insert: insert };
  }

  function compileChildren(tpl, scope) {
    var out = [];
    Array.prototype.forEach.call(tpl.childNodes, function (c) { out.push(compile(c, scope)); });
    return out;
  }

  function compileFor(tpl, scope) {
    var listExpr = (tpl.getAttribute('list') || '').match(WHOLE);
    listExpr = listExpr ? listExpr[1] : '';
    var as = tpl.getAttribute('as') || 'item';
    var r = region(tpl, scope);
    var insts = [];
    function scopeFor(s, item, i) { var v = {}; v[as] = item; v.$index = i; return { vars: v, parent: s }; }
    function build(s) {
      var list = lookup(s, listExpr) || [];
      if (list.length === insts.length) {
        insts.forEach(function (row, i) { var sc = scopeFor(s, list[i], i); row.forEach(function (k) { k.update(sc); }); });
        return;
      }
      r.clear(); insts = [];
      list.forEach(function (item, i) {
        var sc = scopeFor(s, item, i);
        var row = compileChildren(tpl, sc);
        row.forEach(function (k) { r.insert(k.nodes); });
        insts.push(row);
      });
    }
    build(scope);
    return { nodes: Array.prototype.slice.call(r.frag.childNodes), update: build };
  }

  function compileIf(tpl, scope) {
    var m = (tpl.getAttribute('value') || '').match(WHOLE);
    var expr = m ? m[1] : 'false';
    var r = region(tpl, scope);
    var shown = null, kids = [];
    function build(s) {
      var on = !!lookup(s, expr);
      if (on === shown) { if (on) kids.forEach(function (k) { k.update(s); }); return; }
      shown = on; r.clear(); kids = [];
      if (on) { kids = compileChildren(tpl, s); kids.forEach(function (k) { r.insert(k.nodes); }); }
    }
    build(scope);
    return { nodes: Array.prototype.slice.call(r.frag.childNodes), update: build };
  }

  function mount() {
    var tplEl = document.getElementById('dc-template');
    var root = document.getElementById('dc-root');
    var codeEl = document.getElementById('dc-logic');
    if (!tplEl || !root || !codeEl) return;
    var Component = new Function('DCLogic', codeEl.textContent + '\n;return Component;')(DCLogic);
    var comp = new Component({});
    var top = { vars: {} };
    var inst = null;
    function render() {
      top.vars = comp.renderVals() || {};
      if (!inst) {
        inst = { kids: compileChildren(tplEl.content, top) };
        var frag = document.createDocumentFragment();
        inst.kids.forEach(function (k) { k.nodes.forEach(function (n) { frag.appendChild(n); }); });
        root.innerHTML = '';
        root.appendChild(frag);
      } else {
        inst.kids.forEach(function (k) { k.update(top); });
      }
    }
    comp.__render = render;
    render();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    window.__dcReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
