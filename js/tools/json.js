/* =========================================================================
   Tool: JSON · YAML · CSV
   Paste data in any of the three formats, see it as a collapsible tree or
   convert it to another format, repair broken JSON, and query it with
   JSONPath. Everything runs locally.
   ========================================================================= */
(function () {
  'use strict';
  var F = window.Formats;

  var SAMPLE = '{\n' +
    '  // Lenient input: comments, single quotes and trailing commas are fine. Click Repair.\n' +
    '  "store": {\n' +
    '    "name": "Corner Books",\n' +
    '    "open": true,\n' +
    '    "book": [\n' +
    '      { "title": "Dune", "author": "Frank Herbert", "price": 9.99, "tags": ["sci-fi", "classic"] },\n' +
    '      { "title": "Piranesi", "author": "Susanna Clarke", "price": 14.5, "tags": ["fantasy"] },\n' +
    "      { 'title': 'Klara and the Sun', author: 'Kazuo Ishiguro', price: 12, },\n" +
    '    ],\n' +
    '    "address": { "street": "12 High St", "city": "Bristol", "postcode": null }\n' +
    '  }\n' +
    '}\n';

  var state = Object.assign({ input: '', inFmt: 'auto', outView: 'tree', indent: '2', sortKeys: false, query: '' }, U.store.get('json', {}));
  function save() {
    var s = Object.assign({}, state);
    if (s.input.length > 400000) s.input = '';
    U.store.set('json', s);
  }

  function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (k) { o[k] = sortDeep(v[k]); });
      return o;
    }
    return v;
  }

  function stats(v) {
    var nodes = 0, depth = 0;
    (function walk(x, d) {
      nodes++; if (d > depth) depth = d;
      if (x && typeof x === 'object') (Array.isArray(x) ? x : Object.keys(x).map(function (k) { return x[k]; })).forEach(function (c) { walk(c, d + 1); });
    })(v, 0);
    return { nodes: nodes, depth: depth };
  }

  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

  /* ---------- Tree rendering (lazy) ---------- */
  var PAGE = 200;
  function summary(v) {
    if (Array.isArray(v)) return '[' + v.length + (v.length === 1 ? ' item' : ' items') + ']';
    return '{' + Object.keys(v).length + (Object.keys(v).length === 1 ? ' key' : ' keys') + '}';
  }
  function leafHtml(v) {
    if (v === null) return '<span class="t-null">null</span>';
    var t = typeof v;
    if (t === 'string') return '<span class="t-string">' + U.esc(JSON.stringify(v)) + '</span>';
    return '<span class="t-' + t + '">' + U.esc(String(v)) + '</span>';
  }
  function nodeEl(key, v, keys, depth) {
    var li = document.createElement('li');
    var isObj = v && typeof v === 'object';
    var keyHtml = key === null ? '' : '<span class="k" data-path="' + U.esc(F.pathFor(keys)) + '" title="Click to copy path">' + U.esc(typeof key === 'number' ? key : JSON.stringify(key)) + '</span><span class="sum">:</span>';
    if (!isObj) {
      li.innerHTML = '<div class="row"><span class="tog"></span>' + keyHtml + leafHtml(v) + '</div>';
      return li;
    }
    li.innerHTML = '<div class="row" data-toggle><span class="tog">▼</span>' + keyHtml + '<span class="sum">' + summary(v) + '</span></div>';
    li._v = v; li._keys = keys;
    if (depth < 2) expand(li); else li.classList.add('collapsed');
    return li;
  }
  function expand(li) {
    if (li._built) return;
    li._built = true;
    var ul = document.createElement('ul');
    li.appendChild(ul);
    appendChildren(ul, li._v, li._keys, 0, li._keys.length + 1);
  }
  function appendChildren(ul, v, keys, from, depth) {
    var entries = Array.isArray(v) ? v.map(function (x, i) { return [i, x]; }) : Object.keys(v).map(function (k) { return [k, v[k]]; });
    var to = Math.min(entries.length, from + PAGE);
    for (var i = from; i < to; i++) ul.appendChild(nodeEl(entries[i][0], entries[i][1], keys.concat(entries[i][0]), depth));
    if (to < entries.length) {
      var more = U.h('<li><button class="btn btn-ghost btn-sm">Show ' + Math.min(PAGE, entries.length - to) + ' more of ' + (entries.length - to) + '</button></li>');
      more.querySelector('button').addEventListener('click', function () { more.remove(); appendChildren(ul, v, keys, to, depth); });
      ul.appendChild(more);
    }
  }

  U.register({
    id: 'json',
    name: 'JSON · YAML · CSV',
    desc: 'Paste data, browse it as a tree, convert between formats, repair broken JSON and query with JSONPath.',
    hue: 255,
    icon: 'braces',
    keywords: ['json', 'yaml', 'csv', 'convert', 'format', 'pretty', 'minify', 'jsonpath', 'tree', 'validate', 'repair', 'data'],
    shortcuts: [['Format input as pretty JSON', ['Ctrl', 'Shift', 'F']]],
    homeStat: function () {
      var s = U.store.get('json', {});
      if (!s.input) return '';
      var kb = fmtBytes(s.input.length);
      return '<span class="dot"></span>Draft saved · <b>' + kb + '</b>';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('braces') + '</span>JSON · YAML · CSV</h1>' +
          '<p>Convert, format, repair and query structured data. Nothing leaves your browser.</p>' +
        '</div><div class="tool-head-actions">' +
          '<button class="btn btn-ghost btn-sm" data-act="sample">' + U.icon('sparkles') + 'Sample</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="open">' + U.icon('file') + 'Open file</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="clear">' + U.icon('reset') + 'Clear</button>' +
        '</div></div>' +
        '<div class="split">' +
          '<section class="panel">' +
            '<div class="panel-head"><div class="seg" id="inFmt">' +
              '<button data-v="auto">Auto</button><button data-v="json">JSON</button><button data-v="yaml">YAML</button><button data-v="csv">CSV</button>' +
            '</div><div class="panel-actions">' +
              '<button class="btn btn-soft btn-sm" data-act="repair" title="Fix comments, quotes, trailing commas and more">' + U.icon('wand') + 'Repair</button>' +
              '<button class="btn btn-soft btn-sm" data-act="pretty" title="Rewrite the input as formatted JSON (Ctrl+Shift+F)">' + U.icon('lines') + 'Format</button>' +
            '</div></div>' +
            '<textarea class="code-area" id="jsonIn" spellcheck="false" autocomplete="off" placeholder="Paste JSON, YAML or CSV here, or drop a file…" aria-label="Input"></textarea>' +
            '<div class="panel-foot" id="inStatus"></div>' +
          '</section>' +
          '<section class="panel">' +
            '<div class="panel-head"><div class="seg" id="outView">' +
              '<button data-v="tree">Tree</button><button data-v="json">JSON</button><button data-v="yaml">YAML</button><button data-v="csv">CSV</button>' +
            '</div><div class="panel-actions">' +
              '<select class="select-input sm" id="indent" aria-label="Indentation" style="width:auto"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tab">Tabs</option><option value="min">Minified</option></select>' +
              '<label class="check-label" title="Sort object keys alphabetically"><input type="checkbox" id="sortKeys">Sort</label>' +
              '<button class="icon-btn sm" data-act="copy" title="Copy output" aria-label="Copy output">' + U.icon('copy') + '</button>' +
              '<button class="icon-btn sm" data-act="download" title="Download output" aria-label="Download output">' + U.icon('download') + '</button>' +
            '</div></div>' +
            '<div style="padding:10px 12px 0"><div class="search" style="max-width:none">' + U.icon('search') +
              '<input id="jq" class="mono" type="search" placeholder="JSONPath query, e.g. $.store.book[?(@.price < 10)].title" autocomplete="off" spellcheck="false" aria-label="JSONPath query"></div></div>' +
            '<div id="outBody"></div>' +
            '<div class="panel-foot" id="outStatus"></div>' +
          '</section>' +
        '</div>';

      var input = U.$('#jsonIn', root), outBody = U.$('#outBody', root);
      var inStatus = U.$('#inStatus', root), outStatus = U.$('#outStatus', root);
      var jq = U.$('#jq', root), indentSel = U.$('#indent', root), sortBox = U.$('#sortKeys', root);
      var repairBtn = U.$('[data-act="repair"]', root);
      var parsed = null, outText = '', lastErr = null;

      input.value = state.input;
      jq.value = state.query;
      indentSel.value = state.indent;
      sortBox.checked = state.sortKeys;

      U.seg(U.$('#inFmt', root), state.inFmt, function (v) { state.inFmt = v; run(); });
      U.seg(U.$('#outView', root), state.outView, function (v) { state.outView = v; render(); save(); });
      indentSel.addEventListener('change', function () { state.indent = indentSel.value; render(); save(); });
      sortBox.addEventListener('change', function () { state.sortKeys = sortBox.checked; render(); save(); });
      input.addEventListener('input', U.debounce(function () { state.input = input.value; run(); }, 180));
      jq.addEventListener('input', U.debounce(function () { state.query = jq.value; render(); save(); }, 150));
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          var s = input.selectionStart, en = input.selectionEnd;
          input.setRangeText('  ', s, en, 'end');
          input.dispatchEvent(new Event('input'));
        }
        if (e.key.toLowerCase() === 'f' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pretty(); }
      });

      // Drop a file onto the input.
      input.addEventListener('dragover', function (e) { e.preventDefault(); });
      input.addEventListener('drop', function (e) {
        var f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { e.preventDefault(); loadFile(f); }
      });
      function loadFile(f) {
        if (f.size > 20 * 1048576) { U.toast('That file is over 20 MB'); return; }
        f.text().then(function (t) {
          input.value = t; state.input = t;
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          var fmt = ext === 'yml' ? 'yaml' : ['json', 'yaml', 'csv'].indexOf(ext) !== -1 ? ext : 'auto';
          if (ext === 'tsv') fmt = 'csv';
          state.inFmt = fmt; U.$$('#inFmt button', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === fmt)); });
          run(); U.toast('Opened ' + f.name);
        });
      }

      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (b) {
          var act = b.dataset.act;
          if (act === 'sample') { input.value = SAMPLE; state.input = SAMPLE; state.inFmt = 'auto'; U.$$('#inFmt button', root).forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.v === 'auto')); }); run(); }
          if (act === 'clear') { var prev = input.value; input.value = ''; state.input = ''; jq.value = ''; state.query = ''; run(); input.focus(); if (prev) U.toast('Input cleared', { action: 'Undo', onAction: function () { input.value = prev; state.input = prev; run(); } }); }
          if (act === 'open') U.pickFile('.json,.yaml,.yml,.csv,.tsv,.txt').then(function (f) { if (f) loadFile(f); });
          if (act === 'repair') repair();
          if (act === 'pretty') pretty();
          if (act === 'copy') U.copy(outText, 'Output');
          if (act === 'download') {
            var ext = state.outView === 'tree' ? 'json' : state.outView;
            U.download('data.' + ext, outText, ext === 'csv' ? 'text/csv' : ext === 'yaml' ? 'text/yaml' : 'application/json');
          }
          if (act === 'goto' && lastErr) gotoError();
          return;
        }
        var k = e.target.closest('.tree .k');
        if (k) { e.stopPropagation(); U.copy(k.dataset.path, 'Path'); return; }
        var row = e.target.closest('.tree [data-toggle]');
        if (row) {
          var li = row.parentElement;
          if (li.classList.contains('collapsed')) { expand(li); li.classList.remove('collapsed'); }
          else li.classList.add('collapsed');
        }
      });

      function gotoError() {
        var pos = lastErr.pos;
        if (pos == null && lastErr.line) { var ls = input.value.split('\n'); pos = 0; for (var i = 0; i < lastErr.line - 1 && i < ls.length; i++) pos += ls[i].length + 1; }
        input.focus();
        input.setSelectionRange(pos || 0, (pos || 0) + 1);
        // Scroll the caret into view.
        var lh = 13 * 1.6, line = input.value.slice(0, pos).split('\n').length;
        input.scrollTop = Math.max(0, (line - 4) * lh);
      }

      function detectFmt() { return state.inFmt === 'auto' ? F.detect(input.value) : state.inFmt; }

      function run() {
        var text = input.value, fmt = detectFmt();
        lastErr = null; parsed = null;
        repairBtn.hidden = fmt === 'yaml' || fmt === 'csv';
        if (!text.trim()) {
          inStatus.innerHTML = '<span>Paste data, open a file, or try the sample.</span>';
          parsed = undefined; render(); save(); return;
        }
        var info = '';
        try {
          if (fmt === 'json') {
            parsed = F.parseJSON(text).value;
          } else if (fmt === 'yaml') {
            parsed = F.parseYAML(text);
          } else if (fmt === 'csv') {
            var res = F.parseCSV(text);
            parsed = res.value;
            info = ' · ' + res.rows + ' rows × ' + res.columns + ' columns, ' + ({ ',': 'comma', '\t': 'tab', ';': 'semicolon', '|': 'pipe' }[res.delimiter]) + '-separated';
          }
          var lines = text.split('\n').length;
          inStatus.innerHTML = '<span class="ok">' + U.icon('check') + '</span><span>Valid ' + fmt.toUpperCase() + (state.inFmt === 'auto' ? ' (detected)' : '') + info + '</span><span style="margin-left:auto">' + lines + ' lines · ' + fmtBytes(new Blob([text]).size) + '</span>';
        } catch (e) {
          lastErr = e;
          var where = e.line ? 'Line ' + e.line + (e.col && fmt !== 'yaml' ? ', column ' + e.col : '') + ': ' : '';
          var loose = null;
          if (fmt === 'json') { try { loose = F.parseJSON(text, { loose: true }); } catch (e2) {} }
          inStatus.innerHTML = '<span class="' + (loose ? '' : 'err') + '" style="' + (loose ? 'color:var(--warn)' : '') + '">' + U.esc(where + e.message) + (loose ? '. Previewing a repaired version.' : '') + '</span>' +
            '<span style="margin-left:auto;display:flex;gap:4px">' +
            '<button class="btn btn-ghost btn-sm" data-act="goto">Show</button>' +
            (loose ? '<button class="btn btn-soft btn-sm" data-act="repair">' + U.icon('wand') + 'Repair</button>' : '') + '</span>';
          parsed = loose ? loose.value : undefined;
        }
        render(); save();
      }

      function repair() {
        try {
          var r = F.parseJSON(input.value, { loose: true });
          var prev = input.value;
          input.value = JSON.stringify(r.value, null, 2) + '\n';
          state.input = input.value;
          state.inFmt = state.inFmt === 'auto' ? 'auto' : 'json';
          run();
          U.toast(r.fixes.length ? 'Repaired: ' + r.fixes.join(', ') : 'Already valid. Reformatted', { action: 'Undo', onAction: function () { input.value = prev; state.input = prev; run(); } });
        } catch (e) {
          U.toast('Could not repair: ' + (e.line ? 'line ' + e.line + ', ' : '') + e.message);
        }
      }

      function pretty() {
        if (parsed === undefined) { if (detectFmt() === 'json') repair(); else U.toast('Fix the input first'); return; }
        var prev = input.value;
        input.value = JSON.stringify(parsed, null, 2) + '\n';
        state.input = input.value; state.inFmt = 'auto';
        U.$$('#inFmt button', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === 'auto')); });
        run();
        U.toast('Input formatted as JSON', { action: 'Undo', onAction: function () { input.value = prev; state.input = prev; run(); } });
      }

      function render() {
        indentSel.hidden = state.outView !== 'json';
        if (parsed === undefined) {
          outText = '';
          outBody.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('braces') + '</div><h3>' + (lastErr ? 'Waiting for valid input' : 'Nothing to show yet') + '</h3><p>' +
            (lastErr ? 'Fix the error on the left, or click Repair for JSON.' : 'The tree, conversions and query results appear here.') + '</p></div>';
          outStatus.innerHTML = '';
          jq.classList.remove('invalid');
          return;
        }
        var data = parsed, qInfo = '';
        jq.classList.remove('invalid');
        var q = jq.value.trim();
        if (q && q !== '$') {
          try {
            var hits = F.jsonPath(q, parsed);
            var single = hits.length === 1 && !/\*|\.\.|\?|:|,/.test(q);
            data = single ? hits[0].value : hits.map(function (h) { return h.value; });
            qInfo = '<span class="badge accent">' + hits.length + (hits.length === 1 ? ' match' : ' matches') + '</span>';
          } catch (e) {
            jq.classList.add('invalid');
            qInfo = '<span class="err">Query: ' + U.esc(e.message) + '</span>';
          }
        }
        if (state.sortKeys) data = sortDeep(data);
        var view = state.outView;
        var ind = state.indent === 'tab' ? '\t' : state.indent === 'min' ? 0 : +state.indent;
        if (view === 'tree') {
          outText = JSON.stringify(data, null, 2);
          var wrap = U.h('<div class="tree"><ul></ul></div>');
          wrap.firstChild.appendChild(nodeEl(null, data, [], 0));
          outBody.innerHTML = ''; outBody.appendChild(wrap);
        } else {
          try {
            if (view === 'json') outText = JSON.stringify(data, null, ind) + (ind ? '\n' : '');
            if (view === 'yaml') outText = F.toYAML(data);
            if (view === 'csv') outText = F.toCSV(data);
          } catch (e) { outText = ''; qInfo += '<span class="err">' + U.esc(e.message) + '</span>'; }
          outBody.innerHTML = '';
          var pre = document.createElement('pre');
          pre.className = 'code-out' + (state.indent === 'min' && view === 'json' ? ' wrap' : '');
          pre.textContent = outText;
          outBody.appendChild(pre);
        }
        var st = stats(data);
        var csvNote = view === 'csv' && !Array.isArray(data) ? ' · single object written as one row' : '';
        outStatus.innerHTML = qInfo + '<span>' + U.fmtNum(st.nodes, 0) + ' values · depth ' + st.depth + csvNote + '</span>' +
          '<span style="margin-left:auto">' + (view === 'tree' ? 'Click a key to copy its path' : fmtBytes(new Blob([outText]).size)) + '</span>';
      }

      run();
      if (!input.value) input.focus();
    }
  });
})();
