/* =========================================================================
   Tool: Diff viewer
   Myers line diff with word-level highlights inside changed lines,
   side-by-side or unified views, whitespace/case options, folding of
   unchanged regions and unified-patch export.
   ========================================================================= */
(function () {
  'use strict';

  var MAX_D = 6000;      // Edit distance beyond which we stop and show a full replace.
  var CONTEXT = 3;       // Unchanged lines kept around each change when folding.

  // Myers O((N+M)·D) diff on two arrays of comparable keys.
  // Returns ops: [{ t: 'eq'|'del'|'add', a: indexInA, b: indexInB }]
  function myers(A, B) {
    var N = A.length, M = B.length;
    // Trim common prefix and suffix first: cheap and very effective.
    var pre = 0; while (pre < N && pre < M && A[pre] === B[pre]) pre++;
    var suf = 0; while (suf < N - pre && suf < M - pre && A[N - 1 - suf] === B[M - 1 - suf]) suf++;
    var a = A.slice(pre, N - suf), b = B.slice(pre, M - suf);
    var n = a.length, m = b.length, max = n + m;
    var ops = [], k, i;
    for (i = 0; i < pre; i++) ops.push({ t: 'eq', a: i, b: i });
    var mid = [];
    if (n === 0) for (i = 0; i < m; i++) mid.push({ t: 'add', b: i });
    else if (m === 0) for (i = 0; i < n; i++) mid.push({ t: 'del', a: i });
    else {
      var off = max + 1, v = new Int32Array(2 * max + 3), trace = [], found = false, d;
      for (d = 0; d <= max && d <= MAX_D; d++) {
        trace.push(v.slice(off - d - 1, off + d + 2));
        for (k = -d; k <= d; k += 2) {
          var x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
          var y = x - k;
          while (x < n && y < m && a[x] === b[y]) { x++; y++; }
          v[off + k] = x;
          if (x >= n && y >= m) { found = true; break; }
        }
        if (found) break;
      }
      if (!found) {
        for (i = 0; i < n; i++) mid.push({ t: 'del', a: i });
        for (i = 0; i < m; i++) mid.push({ t: 'add', b: i });
      } else {
        var x2 = n, y2 = m;
        for (; d > 0; d--) {
          var vp = trace[d], o = d + 1; // vp holds v[-d-1 .. d+1] of the previous round
          k = x2 - y2;
          var prevK = (k === -d || (k !== d && vp[o + k - 1] < vp[o + k + 1])) ? k + 1 : k - 1;
          var px = vp[o + prevK], py = px - prevK;
          while (x2 > px && y2 > py) { mid.push({ t: 'eq', a: x2 - 1, b: y2 - 1 }); x2--; y2--; }
          if (x2 === px) mid.push({ t: 'add', b: y2 - 1 }); else mid.push({ t: 'del', a: x2 - 1 });
          x2 = px; y2 = py;
        }
        while (x2 > 0 && y2 > 0) { mid.push({ t: 'eq', a: x2 - 1, b: y2 - 1 }); x2--; y2--; }
        mid.reverse();
      }
    }
    mid.forEach(function (op) { ops.push({ t: op.t, a: op.a == null ? null : op.a + pre, b: op.b == null ? null : op.b + pre }); });
    var tailA = N - suf, tailB = M - suf;
    for (i = 0; i < suf; i++) ops.push({ t: 'eq', a: tailA + i, b: tailB + i });
    return ops;
  }
  U.myers = myers;

  function tokens(s) { return s.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || []; }

  // Word-level highlight for a changed pair of lines.
  function wordDiff(l, r, norm) {
    var ta = tokens(l), tb = tokens(r);
    if (ta.length + tb.length > 3000) return [U.esc(l), U.esc(r)];
    var ops = myers(ta.map(norm), tb.map(norm));
    var L = '', R = '';
    ops.forEach(function (op) {
      if (op.t === 'eq') { L += U.esc(ta[op.a]); R += U.esc(tb[op.b]); }
      else if (op.t === 'del') L += '<del>' + U.esc(ta[op.a]) + '</del>';
      else R += '<ins>' + U.esc(tb[op.b]) + '</ins>';
    });
    return [L.replace(/<\/del><del>/g, ''), R.replace(/<\/ins><ins>/g, '')];
  }

  // Groups ops into display rows: eq, change (paired del+add), del, add.
  function toRows(ops) {
    var rows = [], i = 0;
    while (i < ops.length) {
      if (ops[i].t === 'eq') { rows.push({ t: 'eq', a: ops[i].a, b: ops[i].b }); i++; continue; }
      var dels = [], adds = [];
      while (i < ops.length && ops[i].t !== 'eq') { (ops[i].t === 'del' ? dels : adds).push(ops[i]); i++; }
      var n = Math.max(dels.length, adds.length);
      for (var k = 0; k < n; k++) {
        var d = dels[k], a = adds[k];
        rows.push(d && a ? { t: 'chg', a: d.a, b: a.b } : d ? { t: 'del', a: d.a } : { t: 'add', b: a.b });
      }
    }
    return rows;
  }

  function unifiedPatch(A, B, ops, nameA, nameB) {
    var out = ['--- ' + nameA, '+++ ' + nameB];
    var changes = [];
    ops.forEach(function (op, i) { if (op.t !== 'eq') changes.push(i); });
    if (!changes.length) return '';
    var hunks = [], start = null, end = null;
    changes.forEach(function (ci) {
      var s = Math.max(0, ci - CONTEXT), e = Math.min(ops.length - 1, ci + CONTEXT);
      if (start === null) { start = s; end = e; }
      else if (s <= end + 1) end = Math.max(end, e);
      else { hunks.push([start, end]); start = s; end = e; }
    });
    hunks.push([start, end]);
    hunks.forEach(function (h) {
      var slice = ops.slice(h[0], h[1] + 1), lines = [], aStart = null, bStart = null, aLen = 0, bLen = 0;
      slice.forEach(function (op) {
        if (op.a != null && aStart === null) aStart = op.a;
        if (op.b != null && bStart === null) bStart = op.b;
        if (op.t === 'eq') { lines.push(' ' + A[op.a]); aLen++; bLen++; }
        else if (op.t === 'del') { lines.push('-' + A[op.a]); aLen++; }
        else { lines.push('+' + B[op.b]); bLen++; }
      });
      // Line numbers for empty sides point at the line before, per the unified format.
      if (aStart === null) { var prevA = ops.slice(0, h[0]).filter(function (o) { return o.a != null; }).pop(); aStart = prevA ? prevA.a + 1 : 0; }
      if (bStart === null) { var prevB = ops.slice(0, h[0]).filter(function (o) { return o.b != null; }).pop(); bStart = prevB ? prevB.b + 1 : 0; }
      out.push('@@ -' + (aLen ? aStart + 1 : aStart) + ',' + aLen + ' +' + (bLen ? bStart + 1 : bStart) + ',' + bLen + ' @@');
      out = out.concat(lines);
    });
    return out.join('\n') + '\n';
  }

  var SAMPLE_A = 'function greet(name) {\n  const greeting = "Hello, " + name;\n  console.log(greeting);\n  return greeting;\n}\n\nconst users = ["Ana", "Ben", "Chloe"];\nfor (let i = 0; i < users.length; i++) {\n  greet(users[i]);\n}\n\n// Count the vowels\nfunction vowels(s) {\n  return s.match(/[aeiou]/g).length;\n}\n';
  var SAMPLE_B = 'function greet(name, punctuation = "!") {\n  const greeting = `Hello, ${name}${punctuation}`;\n  console.log(greeting);\n  return greeting;\n}\n\nconst users = ["Ana", "Ben", "Chloe", "Dev"];\nfor (const user of users) {\n  greet(user);\n}\n\n// Count the vowels\nfunction vowels(s) {\n  return (s.match(/[aeiou]/gi) || []).length;\n}\n';

  var state = Object.assign({ a: '', b: '', view: 'split', ignoreWs: false, ignoreCase: false, fold: true }, U.store.get('diff', {}));
  var save = U.debounce(function () {
    var s = Object.assign({}, state);
    if (s.a.length + s.b.length > 400000) { s.a = ''; s.b = ''; }
    U.store.set('diff', s);
  }, 300);

  U.register({
    id: 'diff',
    name: 'Diff viewer',
    desc: 'Compare two blocks of text side by side or unified, with word-level highlights and an option to ignore whitespace.',
    hue: 160,
    icon: 'diff',
    keywords: ['diff', 'compare', 'difference', 'text', 'patch', 'changes', 'merge'],
    homeStat: function () {
      var s = U.store.get('diff', null);
      if (!s || (!s.a && !s.b)) return '';
      return '<span class="dot"></span>Last compare: <b>' + s.a.split('\n').length + '</b> vs <b>' + s.b.split('\n').length + '</b> lines';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('diff') + '</span>Diff viewer</h1>' +
          '<p>Paste the original on the left and the changed version on the right.</p>' +
        '</div><div class="tool-head-actions">' +
          '<button class="btn btn-ghost btn-sm" data-act="sample">' + U.icon('sparkles') + 'Sample</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="swap">' + U.icon('swap') + 'Swap</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="clear">' + U.icon('reset') + 'Clear</button>' +
        '</div></div>' +
        '<div class="split">' +
          ['a', 'b'].map(function (side) {
            return '<section class="panel"><div class="panel-head"><span class="panel-title">' + (side === 'a' ? 'Original' : 'Changed') + '</span>' +
              '<div class="panel-actions"><span class="muted" style="font-size:12px" id="info-' + side + '"></span>' +
              '<button class="icon-btn sm" data-open="' + side + '" title="Open a file" aria-label="Open a file">' + U.icon('file') + '</button></div></div>' +
              '<textarea class="code-area" style="min-height:200px" id="diff-' + side + '" spellcheck="false" placeholder="' + (side === 'a' ? 'Paste the original text, or drop a file' : 'Paste the changed text, or drop a file') + '" aria-label="' + (side === 'a' ? 'Original text' : 'Changed text') + '"></textarea></section>';
          }).join('') +
        '</div>' +
        '<section class="panel" style="margin-top:12px">' +
          '<div class="panel-head"><div class="diff-summary" id="diffSum"></div><div class="panel-actions">' +
            '<label class="check-label"><input type="checkbox" id="optWs">Ignore whitespace</label>' +
            '<label class="check-label" style="margin-left:10px"><input type="checkbox" id="optCase">Ignore case</label>' +
            '<label class="check-label" style="margin:0 10px"><input type="checkbox" id="optFold">Hide unchanged</label>' +
            '<div class="seg" id="diffView"><button data-v="split" title="Side by side">' + 'Split</button><button data-v="unified">Unified</button></div>' +
            '<button class="btn btn-soft btn-sm" data-act="patch" title="Copy as a unified diff (.patch)">' + U.icon('copy') + 'Patch</button>' +
          '</div></div>' +
          '<div class="diff-wrap" id="diffOut"></div>' +
        '</section>';

      var ta = U.$('#diff-a', root), tb = U.$('#diff-b', root), out = U.$('#diffOut', root), sum = U.$('#diffSum', root);
      var optWs = U.$('#optWs', root), optCase = U.$('#optCase', root), optFold = U.$('#optFold', root);
      ta.value = state.a; tb.value = state.b;
      optWs.checked = state.ignoreWs; optCase.checked = state.ignoreCase; optFold.checked = state.fold;
      var expanded = {}, lastPatch = '';

      U.seg(U.$('#diffView', root), state.view, function (v) { state.view = v; save(); compute(); });
      [optWs, optCase, optFold].forEach(function (el) {
        el.addEventListener('change', function () { state.ignoreWs = optWs.checked; state.ignoreCase = optCase.checked; state.fold = optFold.checked; expanded = {}; save(); compute(); });
      });
      var onInput = U.debounce(function () { state.a = ta.value; state.b = tb.value; expanded = {}; save(); compute(); }, 220);
      ta.addEventListener('input', onInput); tb.addEventListener('input', onInput);
      [ta, tb].forEach(function (el, idx) {
        el.addEventListener('dragover', function (e) { e.preventDefault(); });
        el.addEventListener('drop', function (e) { var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); load(f, idx ? tb : ta); } });
      });
      function load(f, el) {
        if (f.size > 10 * 1048576) { U.toast('That file is over 10 MB'); return; }
        f.text().then(function (t) { el.value = t; el.dispatchEvent(new Event('input')); U.toast('Opened ' + f.name); });
      }

      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (b) {
          var act = b.dataset.act;
          if (act === 'sample') { ta.value = SAMPLE_A; tb.value = SAMPLE_B; onInput(); }
          if (act === 'swap') { var t = ta.value; ta.value = tb.value; tb.value = t; onInput(); }
          if (act === 'clear') {
            var pa = ta.value, pb = tb.value; ta.value = ''; tb.value = ''; onInput();
            if (pa || pb) U.toast('Cleared both sides', { action: 'Undo', onAction: function () { ta.value = pa; tb.value = pb; onInput(); } });
          }
          if (act === 'patch') { if (lastPatch) U.copy(lastPatch, 'Patch'); else U.toast('No differences to copy'); }
          return;
        }
        var o = e.target.closest('[data-open]');
        if (o) { U.pickFile().then(function (f) { if (f) load(f, o.dataset.open === 'a' ? ta : tb); }); return; }
        var fold = e.target.closest('tr.fold');
        if (fold) { expanded[fold.dataset.k] = true; compute(); }
      });

      function compute() {
        var A = ta.value.split('\n'), B = tb.value.split('\n');
        if (ta.value === '') A = []; if (tb.value === '') B = [];
        // A trailing newline should not show up as an extra empty line.
        if (A.length && A[A.length - 1] === '' ) A.pop();
        if (B.length && B[B.length - 1] === '') B.pop();
        U.$('#info-a', root).textContent = A.length ? A.length + ' lines' : '';
        U.$('#info-b', root).textContent = B.length ? B.length + ' lines' : '';
        var norm = function (s) {
          if (state.ignoreWs) s = s.replace(/\s+/g, ' ').trim();
          if (state.ignoreCase) s = s.toLowerCase();
          return s;
        };
        var wnorm = function (s) {
          if (state.ignoreWs && /^\s+$/.test(s)) return ' ';
          return state.ignoreCase ? s.toLowerCase() : s;
        };
        if (!A.length && !B.length) {
          sum.innerHTML = '<span class="muted">Waiting for text</span>';
          out.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('diff') + '</div><h3>Nothing to compare yet</h3><p>Paste text into both boxes, drop files on them, or load the sample.</p></div>';
          lastPatch = ''; return;
        }
        var t0 = performance.now();
        var ops = myers(A.map(norm), B.map(norm));
        var ms = Math.round(performance.now() - t0);
        var added = 0, removed = 0;
        ops.forEach(function (op) { if (op.t === 'add') added++; else if (op.t === 'del') removed++; });
        lastPatch = unifiedPatch(A, B, ops, 'a/original', 'b/changed');
        var rows = toRows(ops);
        var changedRows = rows.filter(function (r) { return r.t !== 'eq'; }).length;
        sum.innerHTML = '<span class="plus">+' + added + '</span><span class="minus">−' + removed + '</span>' +
          '<span>' + (changedRows ? changedRows + ' changed ' + (changedRows === 1 ? 'line' : 'lines') : 'No differences') + '</span><span class="muted">· ' + ms + ' ms</span>';
        if (!added && !removed) {
          out.innerHTML = '<div class="diff-same">' + U.icon('check') + ' <b>The texts are identical</b>' + (state.ignoreWs || state.ignoreCase ? ' (ignoring ' + [state.ignoreWs && 'whitespace', state.ignoreCase && 'case'].filter(Boolean).join(' and ') + ')' : '') + '.</div>';
          return;
        }
        // Decide which equal rows are visible.
        var visible = rows.map(function () { return true; });
        if (state.fold) {
          var near = rows.map(function () { return false; });
          rows.forEach(function (r, i) { if (r.t !== 'eq') for (var k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) near[k] = true; });
          visible = near;
        }
        var html = '', split = state.view === 'split', i = 0, MAX_ROWS = 6000, count = 0;
        var cols = split ? '<colgroup><col class="c-ln"><col class="c-sg"><col><col class="c-ln"><col class="c-sg"><col></colgroup>' : '<colgroup><col class="c-ln"><col class="c-ln"><col class="c-sg"><col></colgroup>';
        while (i < rows.length) {
          if (!visible[i]) {
            var j = i; while (j < rows.length && !visible[j]) j++;
            if (expanded[i]) { for (var z = i; z < j; z++) html += rowHtml(rows[z], A, B, split, wnorm); }
            else html += '<tr class="fold" data-k="' + i + '"><td colspan="' + (split ? 6 : 4) + '">' + U.icon('chevronDown') + ' Show ' + (j - i) + ' unchanged ' + (j - i === 1 ? 'line' : 'lines') + '</td></tr>';
            i = j; continue;
          }
          if (count++ > MAX_ROWS) { html += '<tr class="fold"><td colspan="6">Output truncated at ' + MAX_ROWS + ' rows.</td></tr>'; break; }
          html += rowHtml(rows[i], A, B, split, wnorm);
          i++;
        }
        out.innerHTML = '<table class="diff">' + cols + '<tbody>' + html + '</tbody></table>';
      }

      function rowHtml(r, A, B, split, wnorm) {
        var la = r.a != null ? r.a + 1 : '', lb = r.b != null ? r.b + 1 : '';
        var L = r.a != null ? A[r.a] : '', R = r.b != null ? B[r.b] : '';
        if (r.t === 'chg') { var wd = wordDiff(L, R, wnorm); L = wd[0]; R = wd[1]; }
        else { L = U.esc(L); R = U.esc(R); }
        if (split) {
          var lc = r.t === 'del' || r.t === 'chg' ? 'del' : r.t === 'add' ? 'blank' : '';
          var rc = r.t === 'add' || r.t === 'chg' ? 'add' : r.t === 'del' ? 'blank' : '';
          return '<tr><td class="ln ' + (lc === 'del' ? 'del' : '') + '">' + la + '</td><td class="sg ' + (lc === 'del' ? 'del' : '') + '">' + (lc === 'del' ? '−' : '') + '</td><td class="c l ' + lc + '">' + (r.t === 'add' ? '' : L) + '</td>' +
            '<td class="ln ' + (rc === 'add' ? 'add' : '') + '">' + lb + '</td><td class="sg ' + (rc === 'add' ? 'add' : '') + '">' + (rc === 'add' ? '+' : '') + '</td><td class="c r ' + rc + '">' + (r.t === 'del' ? '' : R) + '</td></tr>';
        }
        if (r.t === 'eq') return '<tr><td class="ln">' + la + '</td><td class="ln">' + lb + '</td><td class="sg"></td><td class="c">' + L + '</td></tr>';
        var s = '';
        if (r.t === 'del' || r.t === 'chg') s += '<tr><td class="ln del">' + la + '</td><td class="ln del"></td><td class="sg del">−</td><td class="c del">' + L + '</td></tr>';
        if (r.t === 'add' || r.t === 'chg') s += '<tr><td class="ln add"></td><td class="ln add">' + lb + '</td><td class="sg add">+</td><td class="c add">' + R + '</td></tr>';
        return s;
      }

      compute();
    }
  });
})();
