/* =========================================================================
   Utilities: core
   Shared helpers (storage, DOM, icons, toasts, modals), the tool registry,
   the hash router and the home page. Each tool lives in js/tools/*.js and
   registers itself with U.register({...}).
   ========================================================================= */
(function () {
  'use strict';

  var U = window.U = {};
  var PREFIX = 'util-app/';

  /* ---------- Storage ---------- */
  // Every read and write is guarded: private windows and blocked storage throw.
  U.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove: function (key) { try { localStorage.removeItem(PREFIX + key); } catch (e) {} },
    keys: function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
        }
      } catch (e) {}
      return out;
    }
  };

  var settings = Object.assign({ theme: null, recent: {} }, U.store.get('settings', {}));
  U.settings = settings;
  U.saveSettings = function () { U.store.set('settings', settings); };

  /* ---------- DOM helpers ---------- */
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.h = function (html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
  };
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };
  U.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  U.isTyping = function (el) {
    el = el || document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };
  // Grows a textarea to fit its content (used by small text areas only).
  U.autosize = function (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

  /* ---------- Dates ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  U.pad = pad;
  // Local calendar day as YYYY-MM-DD. Never use toISOString for this: it is UTC.
  U.dayKey = function (d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  U.parseDay = function (key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  U.addDays = function (d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
  U.daysBetween = function (a, b) {
    var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  };
  U.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  U.DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  U.fmtDay = function (d, opts) {
    opts = opts || {};
    var s = (opts.weekday ? U.DAYS[d.getDay()] + ', ' : '') + U.MONTHS[d.getMonth()] + ' ' + d.getDate();
    if (opts.year || d.getFullYear() !== new Date().getFullYear()) s += ', ' + d.getFullYear();
    return s;
  };
  U.relDay = function (d) {
    var n = U.daysBetween(d, new Date());
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n === -1) return 'Tomorrow';
    if (n > 1 && n < 7) return n + ' days ago';
    return U.fmtDay(d);
  };
  U.relTime = function (ms) {
    var diff = ms - Date.now(), abs = Math.abs(diff), future = diff > 0;
    var units = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];
    if (abs < 45e3) return future ? 'in a few seconds' : 'just now';
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][1]) {
        var v = Math.round(abs / units[i][1]);
        var label = v + ' ' + units[i][0] + (v === 1 ? '' : 's');
        return future ? 'in ' + label : label + ' ago';
      }
    }
    return '';
  };
  U.fmtNum = function (n, digits) {
    if (n == null || isNaN(n)) return '–';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits == null ? 1 : digits });
  };

  /* ---------- Icons ---------- */
  var ICONS = {
    grid: '<rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    regex: '<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>',
    diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
    binary: '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
    calendarCheck: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
    swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    tree: '<path d="M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lines: '<path d="M15 12H3M17 18H3M21 6H3"/>',
    shrink: '<path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
    rows: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>'
  };
  U.icon = function (name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };

  /* ---------- Toasts ---------- */
  U.toast = function (msg, opts) {
    opts = opts || {};
    var box = U.$('#toasts');
    var t = U.h('<div class="toast" role="status"><span>' + U.esc(msg) + '</span>' +
      (opts.action ? '<button type="button">' + U.esc(opts.action) + '</button>' : '') + '</div>');
    box.appendChild(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    requestAnimationFrame(function () { t.classList.add('in'); });
    var gone = false;
    function close() {
      if (gone) return; gone = true;
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 220);
    }
    if (opts.action) t.querySelector('button').addEventListener('click', function () { opts.onAction && opts.onAction(); close(); });
    setTimeout(close, opts.duration || (opts.action ? 5500 : 2400));
    return close;
  };

  U.copy = function (text, label) {
    function done() { U.toast((label || 'Text') + ' copied'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { U.toast('Copy failed'); }
      ta.remove();
    }
    if (!text) { U.toast('Nothing to copy'); return; }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  U.download = function (filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  U.pickFile = function (accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; if (accept) inp.accept = accept;
      inp.addEventListener('change', function () { resolve(inp.files && inp.files[0]); });
      inp.click();
    });
  };

  /* ---------- Modals ---------- */
  var modalStack = [];
  // U.modal({ title, body: html|Node, size: 'sm'|'lg', actions: [{ label, kind, onClick(close) -> false keeps it open }] })
  U.modal = function (opts) {
    var root = U.h('<div class="modal-root" role="dialog" aria-modal="true" aria-label="' + U.esc(opts.title || '') + '">' +
      '<div class="backdrop"></div>' +
      '<div class="modal ' + (opts.size || '') + '">' +
      '<div class="modal-head"><h2>' + U.esc(opts.title || '') + '</h2>' +
      '<button class="icon-btn sm" data-close aria-label="Close">' + U.icon('x') + '</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div></div>');
    var body = root.querySelector('.modal-body'), foot = root.querySelector('.modal-foot');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    (opts.actions || []).forEach(function (a) {
      var b = U.h('<button type="button" class="btn ' + (a.kind || 'btn-soft') + (a.left ? ' left' : '') + '">' + U.esc(a.label) + '</button>');
      b.addEventListener('click', function () { if (!a.onClick || a.onClick(close) !== false) close(); });
      foot.appendChild(b);
    });
    if (!foot.children.length) foot.remove();
    var prevFocus = document.activeElement;
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      root.classList.remove('open');
      modalStack.splice(modalStack.indexOf(api), 1);
      if (!modalStack.length) document.body.classList.remove('no-scroll');
      setTimeout(function () { root.remove(); }, 300);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      opts.onClose && opts.onClose();
    }
    root.querySelector('.backdrop').addEventListener('click', close);
    root.querySelector('[data-close]').addEventListener('click', close);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        var primary = foot.querySelector('.btn-primary'); if (primary) primary.click();
      }
      if (e.key === 'Tab') trapFocus(e, root.querySelector('.modal'));
    });
    document.body.appendChild(root);
    document.body.classList.add('no-scroll');
    var api = { root: root, body: body, close: close };
    modalStack.push(api);
    requestAnimationFrame(function () {
      root.classList.add('open');
      var f = body.querySelector('[autofocus], input, textarea, select') || foot.querySelector('.btn-primary') || root.querySelector('[data-close]');
      f && f.focus();
    });
    return api;
  };
  function trapFocus(e, box) {
    var els = U.$$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', box).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  U.confirm = function (opts) {
    return new Promise(function (resolve) {
      var answered = false;
      U.modal({
        title: opts.title, size: 'sm',
        body: '<p class="confirm-text">' + U.esc(opts.text) + '</p>',
        actions: [
          { label: 'Cancel', kind: 'btn-ghost' },
          { label: opts.confirm || 'Delete', kind: opts.kind || 'btn-danger', onClick: function () { answered = true; resolve(true); } }
        ],
        onClose: function () { if (!answered) resolve(false); }
      });
    });
  };

  // Small popover menu bound to a trigger button.
  U.menu = function (trigger, items) {
    var wrap = trigger.parentElement;
    var menu = wrap.querySelector('.menu');
    if (!menu) { menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'menu'); wrap.appendChild(menu); }
    function render() {
      menu.innerHTML = items().map(function (it) {
        if (it === '-') return '<hr>';
        return '<button role="menuitem" class="' + (it.danger ? 'danger' : '') + '" data-id="' + it.id + '">' + U.icon(it.icon) + '<span>' + U.esc(it.label) + '</span>' +
          (it.kbd ? '<span class="kbd-hint">' + U.esc(it.kbd) + '</span>' : '') + '</button>';
      }).join('');
    }
    function close() { menu.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); }
    function outside(e) { if (!wrap.contains(e.target)) close(); }
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.addEventListener('click', function () {
      if (menu.classList.contains('open')) return close();
      render();
      menu.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      var first = menu.querySelector('button'); first && first.focus();
    });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]'); if (!b) return;
      close();
      var it = items().filter(function (x) { return x.id === b.dataset.id; })[0];
      it && it.run();
    });
    menu.addEventListener('keydown', function (e) {
      var btns = U.$$('button', menu), i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.focus(); }
    });
  };

  // Wires a segmented control: buttons with data-v inside `seg`.
  U.seg = function (seg, value, onChange, attr) {
    attr = attr || 'aria-pressed';
    function set(v) { U.$$('button', seg).forEach(function (b) { b.setAttribute(attr, String(b.dataset.v === v)); }); }
    set(value);
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      set(b.dataset.v); onChange(b.dataset.v);
    });
    return set;
  };

  /* ---------- Theme ---------- */
  function currentTheme() { return document.documentElement.dataset.theme; }
  function applyTheme(t) {
    var root = document.documentElement;
    var run = function () {
      root.dataset.theme = t;
      var meta = U.$('meta[name="theme-color"]'); if (meta) meta.content = t === 'dark' ? '#0d0d0f' : '#f7f7f5';
      var btn = U.$('#themeBtn'); if (btn) btn.innerHTML = U.icon(t === 'dark' ? 'sun' : 'moon');
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run);
    else run();
  }
  U.toggleTheme = function () {
    var t = currentTheme() === 'dark' ? 'light' : 'dark';
    settings.theme = t; U.saveSettings(); applyTheme(t);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!settings.theme) applyTheme(e.matches ? 'dark' : 'light');
  });

  /* ---------- Tool registry ---------- */
  U.tools = [];
  U.register = function (tool) { U.tools.push(tool); };
  function toolById(id) { return U.tools.filter(function (t) { return t.id === id; })[0]; }

  /* ---------- Router ---------- */
  var view, cleanup = null, currentId = null;

  function route() {
    var id = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || '').toLowerCase();
    var tool = toolById(id);
    if (id && !tool) { location.replace('#/'); return; }
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    currentId = tool ? tool.id : null;
    view.classList.remove('leaving');
    // Restart the enter animation.
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    view.innerHTML = '';
    U.$('#app').classList.toggle('wide', !!tool);
    renderCrumb(tool);
    if (tool) {
      settings.recent[tool.id] = Date.now(); U.saveSettings();
      document.title = tool.name + ' · Utilities';
      document.documentElement.style.setProperty('--h', tool.hue);
      var root = document.createElement('div');
      root.className = 'tool tool-' + tool.id;
      view.appendChild(root);
      try { cleanup = tool.mount(root) || null; }
      catch (e) {
        console.error(e);
        root.innerHTML = '<div class="empty"><h2>This tool failed to load</h2><p>' + U.esc(e.message) + '</p></div>';
      }
    } else {
      document.title = 'Utilities';
      document.documentElement.style.setProperty('--h', 255);
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  function renderCrumb(tool) {
    var crumb = U.$('#crumb');
    if (!tool) { crumb.innerHTML = ''; return; }
    crumb.innerHTML = '<span class="sep">/</span><span class="tool-dot"></span><span class="name">' + U.esc(tool.name) + '</span>';
  }

  U.go = function (id) { location.hash = id ? '#/' + id : '#/'; };

  /* ---------- Home ---------- */
  var homeQuery = '';
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function renderHome() {
    var d = new Date();
    view.innerHTML =
      '<section class="greeting">' +
        '<h1>' + greeting() + '.</h1>' +
        '<p>' + U.DAYS_LONG[d.getDay()] + ', ' + U.MONTHS[d.getMonth()] + ' ' + d.getDate() + ' · ' + U.tools.length + ' tools, all running privately in your browser.</p>' +
      '</section>' +
      '<div class="toolbar">' +
        '<div class="search">' + U.icon('search') +
          '<input id="homeSearch" type="search" placeholder="Find a tool…" autocomplete="off" aria-label="Find a tool" value="' + U.esc(homeQuery) + '"><kbd>/</kbd></div>' +
      '</div>' +
      '<ul class="tool-grid" id="toolGrid"></ul>' +
      '<div class="empty" id="homeEmpty" hidden><h2>No tools match</h2><p>Try “json”, “hash”, “gym” or “streak”.</p></div>' +
      '<div class="home-note">' +
        '<span><kbd>1</kbd>–<kbd>' + U.tools.length + '</kbd> open a tool</span>' +
        '<span><kbd>/</kbd> search</span>' +
        '<span><kbd>Esc</kbd> back home</span>' +
        '<span><kbd>?</kbd> all shortcuts</span>' +
      '</div>';
    var search = U.$('#homeSearch');
    search.addEventListener('input', function () { homeQuery = search.value; renderCards(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = U.$('#toolGrid .tool-card'); if (first) first.click(); }
      if (e.key === 'Escape') { if (search.value) { search.value = ''; homeQuery = ''; renderCards(); } else search.blur(); e.stopPropagation(); }
    });
    renderCards();
  }

  function matches(tool, q) {
    if (!q) return true;
    var hay = (tool.name + ' ' + tool.desc + ' ' + (tool.keywords || []).join(' ')).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function renderCards() {
    var grid = U.$('#toolGrid');
    var list = U.tools.filter(function (t) { return matches(t, homeQuery.trim()); });
    grid.innerHTML = list.map(function (t, i) {
      var n = U.tools.indexOf(t) + 1;
      var stat = '';
      try { stat = t.homeStat ? t.homeStat() : ''; } catch (e) { stat = ''; }
      if (!stat) {
        var last = settings.recent[t.id];
        stat = '<span class="dot"></span>' + (last ? 'Opened ' + U.relTime(last) : 'Not opened yet');
      }
      return '<li><a class="tool-card" href="#/' + t.id + '" style="--h:' + t.hue + ';--i:' + i + '">' +
        '<div class="tool-card-head"><span class="tool-icon">' + U.icon(t.icon) + '</span><span class="tool-key" aria-hidden="true">' + n + '</span></div>' +
        '<h2>' + U.esc(t.name) + '</h2>' +
        '<p>' + U.esc(t.desc) + '</p>' +
        '<div class="tool-foot"><div class="foot-text">' + stat + '</div>' + U.icon('arrowRight', 'arrow') + '</div>' +
      '</a></li>';
    }).join('');
    U.$('#homeEmpty').hidden = list.length > 0;
  }

  /* ---------- Data: export, import, reset ---------- */
  function exportAll() {
    var data = {};
    U.store.keys().forEach(function (k) { data[k] = U.store.get(k); });
    U.download('utilities-backup-' + U.dayKey() + '.json', JSON.stringify({ app: 'utilities', version: 1, exportedAt: new Date().toISOString(), data: data }, null, 2));
    U.toast('Backup downloaded');
  }
  function importAll() {
    U.pickFile('.json,application/json').then(function (file) {
      if (!file) return;
      file.text().then(function (txt) {
        var parsed;
        try { parsed = JSON.parse(txt); } catch (e) { U.toast('That file is not valid JSON'); return; }
        if (!parsed || parsed.app !== 'utilities' || typeof parsed.data !== 'object') { U.toast('That is not a Utilities backup'); return; }
        U.confirm({ title: 'Import backup?', text: 'This replaces your habits, workouts and saved tool inputs with the contents of ' + file.name + '.', confirm: 'Import', kind: 'btn-primary' })
          .then(function (ok) {
            if (!ok) return;
            U.store.keys().forEach(function (k) { U.store.remove(k); });
            Object.keys(parsed.data).forEach(function (k) { U.store.set(k, parsed.data[k]); });
            location.reload();
          });
      });
    });
  }
  function resetAll() {
    U.confirm({ title: 'Erase all data?', text: 'This deletes every habit, workout, saved input and setting stored by this app in this browser. Export a backup first if you might want it back.', confirm: 'Erase everything' })
      .then(function (ok) {
        if (!ok) return;
        U.store.keys().forEach(function (k) { U.store.remove(k); });
        location.reload();
      });
  }

  function showShortcuts() {
    var rows = [
      ['Open tool 1–' + U.tools.length + ' (from home)', ['1', '…', String(U.tools.length)]],
      ['Find a tool', ['/']],
      ['Back to home', ['Esc']],
      ['Toggle dark mode', ['T']],
      ['Show this list', ['?']],
      ['Confirm a dialog', ['Ctrl', 'Enter']]
    ];
    U.tools.forEach(function (t) { (t.shortcuts || []).forEach(function (s) { rows.push([t.name + ': ' + s[0], s[1]]); }); });
    U.modal({
      title: 'Keyboard shortcuts', size: 'sm',
      body: '<div class="shortcuts">' + rows.map(function (r) {
        return '<span>' + U.esc(r[0]) + '</span><span class="keys">' + r[1].map(function (k) { return '<kbd>' + U.esc(k) + '</kbd>'; }).join('') + '</span>';
      }).join('') + '</div>'
    });
  }

  /* ---------- Global keys ---------- */
  function onKey(e) {
    if (modalStack.length || e.metaKey || e.ctrlKey || e.altKey) return;
    var typing = U.isTyping(e.target);
    if (e.key === 'Escape') {
      if (typing) { e.target.blur(); return; }
      if (currentId) { e.preventDefault(); U.go(''); }
      return;
    }
    if (typing) return;
    if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); U.toggleTheme(); return; }
    if (!currentId) {
      if (e.key === '/') { e.preventDefault(); var s = U.$('#homeSearch'); s && s.focus(); return; }
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= U.tools.length) { e.preventDefault(); U.go(U.tools[n - 1].id); }
    }
  }

  /* ---------- Boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    view = U.$('#view');
    var themeBtn = U.$('#themeBtn');
    themeBtn.innerHTML = U.icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    themeBtn.addEventListener('click', U.toggleTheme);
    U.$('#brandMark').innerHTML = '<svg viewBox="0 0 24 24">' + ICONS.grid + '</svg>';
    var moreBtn = U.$('#moreBtn');
    moreBtn.innerHTML = U.icon('more');
    U.menu(moreBtn, function () {
      return [
        { id: 'export', label: 'Export backup', icon: 'download', run: exportAll },
        { id: 'import', label: 'Import backup', icon: 'upload', run: importAll },
        '-',
        { id: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: showShortcuts },
        '-',
        { id: 'reset', label: 'Erase all data', icon: 'trash', danger: true, run: resetAll }
      ];
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    route();
  });
})();
