/* =========================================================================
   Tool: Regex playground
   Live highlighting, match and group details, replace preview and a
   plain-English explanation of the pattern. Matching runs in a Web Worker
   with a time limit, so a catastrophic pattern cannot freeze the page.
   ========================================================================= */
(function () {
  'use strict';

  var WORKER_SRC = [
    'onmessage = function (e) {',
    '  var d = e.data, t0 = Date.now();',
    '  try {',
    '    var re = new RegExp(d.src, d.flags), out = [], truncated = false;',
    '    if (re.global || re.sticky) {',
    '      var m; re.lastIndex = 0;',
    '      while ((m = re.exec(d.text)) !== null) {',
    '        out.push({ i: m.index, s: m[0], g: m.slice(1), n: m.groups || null });',
    '        if (m[0] === "") re.lastIndex += (re.unicode && d.text.codePointAt(re.lastIndex) > 0xffff) ? 2 : 1;',
    '        if (out.length >= d.limit) { truncated = true; break; }',
    '        if (!re.global) break;',
    '      }',
    '    } else {',
    '      var m1 = re.exec(d.text);',
    '      if (m1) out.push({ i: m1.index, s: m1[0], g: m1.slice(1), n: m1.groups || null });',
    '    }',
    '    var replaced = d.replace ? d.text.replace(new RegExp(d.src, d.flags), d.replacement) : null;',
    '    postMessage({ id: d.id, ok: true, matches: out, truncated: truncated, replaced: replaced, ms: Date.now() - t0 });',
    '  } catch (err) { postMessage({ id: d.id, ok: false, error: err.message }); }',
    '};'
  ].join('\n');

  var PRESETS = [
    ['Email', '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', 'gi'],
    ['URL', 'https?:\\/\\/[^\\s/$.?#].[^\\s]*', 'gi'],
    ['IPv4', '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', 'g'],
    ['ISO date', '(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])', 'g'],
    ['Hex colour', '#(?:[0-9a-fA-F]{3}){1,2}\\b', 'g'],
    ['UUID', '\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b', 'gi'],
    ['Number', '-?\\d+(?:[.,]\\d+)?', 'g'],
    ['Phone (US)', '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}', 'g'],
    ['Trailing spaces', '[ \\t]+$', 'gm'],
    ['Duplicate words', '\\b(\\w+)\\s+\\1\\b', 'gi']
  ];

  var SAMPLE_TEXT = 'Contact ana.lopez+news@example.com or call (555) 014-2368 before 2026-11-15.\n' +
    'Docs live at https://example.org/docs?page=2 and the API is at 10.0.0.12.\n' +
    'Brand colours: #1e293b, #f59e0b and #fff.\n' +
    'Request id 3f2b8c1e-9a4d-4c2e-8f1a-7b6d5e4c3a21 took 1,250 ms.\n' +
    'This this line has a a duplicate word.   \n';

  var CHEATS = [
    ['.', 'any character'], ['\\d', 'digit'], ['\\w', 'word character'], ['\\s', 'whitespace'],
    ['\\b', 'word boundary'], ['^', 'start of line'], ['$', 'end of line'], ['[abc]', 'one of a, b, c'],
    ['[^abc]', 'not a, b or c'], ['[a-z]', 'a to z'], ['a|b', 'a or b'], ['(…)', 'capture group'],
    ['(?:…)', 'group, no capture'], ['(?<name>…)', 'named group'], ['\\1', 'back-reference'], ['(?=…)', 'followed by'],
    ['(?!…)', 'not followed by'], ['(?<=…)', 'preceded by'], ['*', '0 or more'], ['+', '1 or more'],
    ['?', 'optional'], ['{3}', 'exactly 3'], ['{2,5}', '2 to 5'], ['*?', 'lazy (fewest)']
  ];

  var FLAG_INFO = {
    g: 'global: find every match', i: 'ignore case', m: 'multiline: ^ and $ match at line breaks',
    s: 'dotAll: . also matches line breaks', u: 'unicode', y: 'sticky: match only at lastIndex'
  };

  /* ---------- Explainer ---------- */
  var ESCAPES = {
    d: 'a digit (0–9)', D: 'any character that is not a digit', w: 'a word character (letter, digit or _)', W: 'any non-word character',
    s: 'whitespace (space, tab, line break…)', S: 'any non-whitespace character', b: 'a word boundary', B: 'a position that is not a word boundary',
    n: 'a line break (\\n)', r: 'a carriage return (\\r)', t: 'a tab', f: 'a form feed', v: 'a vertical tab', '0': 'a null character'
  };
  function q(s) { return '“' + U.esc(s) + '”'; }

  function readEscape(src, i) {
    // Returns { tok, desc, end } for the escape starting at src[i] === '\\'.
    var c = src[i + 1];
    if (c == null) return { tok: '\\', desc: 'A trailing backslash (invalid)', end: i + 1 };
    if (ESCAPES[c]) return { tok: '\\' + c, desc: ESCAPES[c], end: i + 2 };
    var m;
    if ((m = /^x[0-9a-fA-F]{2}/.exec(src.slice(i + 1)))) return { tok: '\\' + m[0], desc: 'the character with hex code ' + m[0].slice(1).toUpperCase() + ' (' + q(String.fromCharCode(parseInt(m[0].slice(1), 16))) + ')', end: i + 1 + m[0].length };
    if ((m = /^u\{[0-9a-fA-F]+\}|^u[0-9a-fA-F]{4}/.exec(src.slice(i + 1)))) { var hex = m[0].replace(/[u{}]/g, ''); return { tok: '\\' + m[0], desc: 'the character U+' + hex.toUpperCase() + ' (' + q(String.fromCodePoint(parseInt(hex, 16))) + ')', end: i + 1 + m[0].length }; }
    if ((m = /^[pP]\{[^}]+\}/.exec(src.slice(i + 1)))) return { tok: '\\' + m[0], desc: (c === 'P' ? 'a character NOT in' : 'a character in') + ' the Unicode category ' + q(m[0].slice(2, -1)), end: i + 1 + m[0].length };
    if ((m = /^[1-9]\d*/.exec(src.slice(i + 1)))) return { tok: '\\' + m[0], desc: 'the same text matched by group ' + m[0], end: i + 1 + m[0].length, backref: true };
    if ((m = /^k<([^>]+)>/.exec(src.slice(i + 1)))) return { tok: '\\' + m[0], desc: 'the same text matched by the group named ' + q(m[1]), end: i + 1 + m[0].length, backref: true };
    if ((m = /^c[A-Za-z]/.exec(src.slice(i + 1)))) return { tok: '\\' + m[0], desc: 'the control character Ctrl+' + m[0][1].toUpperCase(), end: i + 3 };
    return { tok: '\\' + c, desc: 'the literal character ' + q(c), end: i + 2, literal: c };
  }

  function readQuant(src, i) {
    var c = src[i], m, desc = null, end = i;
    if (c === '*') { desc = 'zero or more times'; end = i + 1; }
    else if (c === '+') { desc = 'one or more times'; end = i + 1; }
    else if (c === '?') { desc = 'optionally (zero or one time)'; end = i + 1; }
    else if ((m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i)))) {
      end = i + m[0].length;
      if (!m[2]) desc = 'exactly ' + m[1] + ' time' + (m[1] === '1' ? '' : 's');
      else if (m[3] === '') desc = m[1] + ' or more times';
      else desc = 'between ' + m[1] + ' and ' + m[3] + ' times';
    }
    if (!desc) return null;
    var lazy = src[end] === '?';
    if (lazy) end++;
    if (lazy) desc += ', as few as possible';
    else if (c !== '?' && !/^\{\d+\}/.test(src.slice(i))) desc += ', as many as possible';
    return { tok: src.slice(i, end), desc: desc, end: end };
  }

  function describeClass(body) {
    var neg = body[0] === '^';
    if (neg) body = body.slice(1);
    var parts = [], i = 0;
    while (i < body.length) {
      var a, aEnd;
      if (body[i] === '\\') { var e = readEscape(body, i); a = e.literal != null ? e.literal : null; parts.push(a != null ? null : e.desc); aEnd = e.end; if (a == null) { i = aEnd; continue; } parts.pop(); }
      else { a = body[i]; aEnd = i + 1; }
      if (body[aEnd] === '-' && aEnd + 1 < body.length) {
        var b, bEnd;
        if (body[aEnd + 1] === '\\') { var e2 = readEscape(body, aEnd + 1); b = e2.literal != null ? e2.literal : e2.tok; bEnd = e2.end; }
        else { b = body[aEnd + 1]; bEnd = aEnd + 2; }
        parts.push(q(a) + ' to ' + q(b));
        i = bEnd;
      } else { parts.push(q(a)); i = aEnd; }
    }
    return (neg ? 'any character except ' : 'one character from ') + (parts.length ? parts.join(', ') : 'nothing');
  }

  function explain(src, flags) {
    var out = [], i = 0, depth = 0, groupNo = 0;
    function add(tok, desc, d) { out.push({ tok: tok, desc: desc, depth: d == null ? depth : d }); }
    function withQuant(tok, desc, at) {
      var qn = readQuant(src, at);
      if (qn) { add(tok + qn.tok, desc + ', ' + qn.desc); return qn.end; }
      add(tok, desc); return at;
    }
    while (i < src.length) {
      var c = src[i];
      if (c === '^') { add('^', flags.indexOf('m') !== -1 ? 'Start of a line' : 'Start of the text'); i++; continue; }
      if (c === '$') { add('$', flags.indexOf('m') !== -1 ? 'End of a line' : 'End of the text'); i++; continue; }
      if (c === '|') { add('|', '<b>Or</b>: otherwise, try the alternative that follows', depth); i++; continue; }
      if (c === '.') { i = withQuant('.', '<b>Any character</b>' + (flags.indexOf('s') !== -1 ? ' (including line breaks)' : ' except a line break'), i + 1); continue; }
      if (c === '(') {
        var rest = src.slice(i), m, tok, desc;
        if (rest.indexOf('(?:') === 0) { tok = '(?:'; desc = 'Start a group (not captured)'; }
        else if (rest.indexOf('(?=') === 0) { tok = '(?='; desc = 'Look ahead: must be followed by…'; }
        else if (rest.indexOf('(?!') === 0) { tok = '(?!'; desc = 'Look ahead: must NOT be followed by…'; }
        else if (rest.indexOf('(?<=') === 0) { tok = '(?<='; desc = 'Look behind: must be preceded by…'; }
        else if (rest.indexOf('(?<!') === 0) { tok = '(?<!'; desc = 'Look behind: must NOT be preceded by…'; }
        else if ((m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest))) { groupNo++; tok = m[0]; desc = 'Start <b>group ' + groupNo + '</b>, named ' + q(m[1]); }
        else { groupNo++; tok = '('; desc = 'Start capturing <b>group ' + groupNo + '</b>'; }
        add(tok, desc); depth++; i += tok.length; continue;
      }
      if (c === ')') { depth = Math.max(0, depth - 1); i = withQuant(')', 'End of group', i + 1); continue; }
      if (c === '[') {
        var j = i + 1;
        if (src[j] === '^') j++;
        if (src[j] === ']') j++;
        while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; }
        var body = src.slice(i + 1, j);
        var full = src.slice(i, j + 1);
        i = withQuant(full, '<b>' + describeClass(body).replace(/^./, function (x) { return x.toUpperCase(); }) + '</b>', j + 1);
        continue;
      }
      if (c === '\\') {
        var e = readEscape(src, i);
        if (e.literal == null) { i = withQuant(e.tok, '<b>' + e.desc.replace(/^./, function (x) { return x.toUpperCase(); }) + '</b>', e.end); continue; }
      }
      if (/[*+?{]/.test(c) && readQuant(src, i)) {
        var qq = readQuant(src, i);
        add(qq.tok, 'Repeat the previous item ' + qq.desc + ' (nothing to repeat: likely an error)');
        i = qq.end; continue;
      }
      // Literal run. A quantifier after it applies to the last character only.
      var lit = '', start = i, raw = '';
      while (i < src.length) {
        var ch = src[i];
        if ('^$|.()[]'.indexOf(ch) !== -1) break;
        if (ch === '\\') { var ee = readEscape(src, i); if (ee.literal == null) break; if (readQuant(src, ee.end) && lit) break; lit += ee.literal; raw += ee.tok; i = ee.end; if (readQuant(src, i)) break; continue; }
        if (/[*+?]/.test(ch) || (ch === '{' && readQuant(src, i))) break;
        if (readQuant(src, i + 1) && lit) break;
        lit += ch; raw += ch; i++;
        if (readQuant(src, i)) break;
      }
      if (i === start) { add(c, 'The character ' + q(c)); i++; continue; }
      var qn = readQuant(src, i);
      if (qn) {
        add(raw + qn.tok, (lit.length === 1 ? 'The character ' : 'The text ') + q(lit) + ', ' + qn.desc);
        i = qn.end;
      } else add(raw, (lit.length === 1 ? 'The character ' : 'The text ') + q(lit));
    }
    return out;
  }
  U.explainRegex = explain;

  /* ---------- Tool ---------- */
  var state = Object.assign({ src: '\\b(\\w+)@(\\w+)\\.com\\b', flags: 'gi', text: '', replace: '', mode: 'matches' }, U.store.get('regex', {}));
  if (!state.text) state.text = SAMPLE_TEXT;
  var save = U.debounce(function () { U.store.set('regex', state); }, 300);

  U.register({
    id: 'regex',
    name: 'Regex playground',
    desc: 'Test a pattern against your text with live highlighting, group details, replace preview and a plain-English explanation.',
    hue: 300,
    icon: 'regex',
    keywords: ['regex', 'regular expression', 'pattern', 'match', 'replace', 'test', 'explain'],
    homeStat: function () {
      var s = U.store.get('regex', null);
      if (!s || !s.src) return '';
      var short = s.src.length > 22 ? s.src.slice(0, 22) + '…' : s.src;
      return '<span class="dot"></span><span class="mono" style="color:var(--text-2)">/' + U.esc(short) + '/' + U.esc(s.flags) + '</span>';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('regex') + '</span>Regex playground</h1>' +
          '<p>JavaScript regular expressions, matched live in a sandboxed worker.</p>' +
        '</div><div class="tool-head-actions">' +
          '<select class="select-input sm" id="rxPreset" style="width:auto" aria-label="Load a common pattern"><option value="">Common patterns…</option>' +
            PRESETS.map(function (p, k) { return '<option value="' + k + '">' + p[0] + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-ghost btn-sm" data-act="sample">' + U.icon('sparkles') + 'Sample text</button>' +
        '</div></div>' +
        '<div class="rx-bar" id="rxBar"><span class="rx-slash">/</span>' +
          '<input class="rx-pattern" id="rxSrc" spellcheck="false" autocomplete="off" placeholder="Type a pattern" aria-label="Pattern">' +
          '<span class="rx-slash">/</span><div class="rx-flags" id="rxFlags">' +
            'gimsuy'.split('').map(function (f) { return '<button data-f="' + f + '" title="' + FLAG_INFO[f] + '" aria-label="Flag ' + f + ': ' + FLAG_INFO[f] + '">' + f + '</button>'; }).join('') +
          '</div><button class="icon-btn sm" data-act="copyRx" title="Copy as /pattern/flags" aria-label="Copy regex">' + U.icon('copy') + '</button>' +
        '</div>' +
        '<div class="panel-foot" id="rxErr" style="border:0;padding:6px 4px 0;min-height:28px"></div>' +
        '<div class="split" style="margin-top:6px">' +
          '<div class="stack">' +
            '<section class="panel">' +
              '<div class="panel-head"><span class="panel-title">Test text</span><div class="panel-actions"><span id="rxCount" class="badge accent"></span></div></div>' +
              '<div class="rx-editor"><div class="rx-backdrop" id="rxBack" aria-hidden="true"></div>' +
              '<textarea id="rxText" spellcheck="false" aria-label="Test text"></textarea></div>' +
            '</section>' +
            '<section class="panel">' +
              '<div class="panel-head"><span class="panel-title">Replace with</span><div class="panel-actions"><button class="icon-btn sm" data-act="copyOut" title="Copy result" aria-label="Copy result">' + U.icon('copy') + '</button></div></div>' +
              '<div class="panel-body" style="padding-bottom:6px"><input class="text-input mono" id="rxRep" placeholder="e.g. $2 · $1, $<year>, $& (leave empty to skip)" spellcheck="false" autocomplete="off"></div>' +
              '<pre class="code-out wrap" id="rxOut" style="min-height:80px;max-height:300px;padding-top:6px"></pre>' +
            '</section>' +
          '</div>' +
          '<section class="panel">' +
            '<div class="panel-head"><div class="seg" id="rxMode"><button data-v="matches">Matches</button><button data-v="explain">Explain</button><button data-v="cheats">Cheat sheet</button></div></div>' +
            '<div class="panel-body" id="rxSide"></div>' +
          '</section>' +
        '</div>';

      var srcIn = U.$('#rxSrc', root), text = U.$('#rxText', root), back = U.$('#rxBack', root);
      var bar = U.$('#rxBar', root), errBox = U.$('#rxErr', root), countEl = U.$('#rxCount', root);
      var rep = U.$('#rxRep', root), outEl = U.$('#rxOut', root), side = U.$('#rxSide', root);
      var worker = null, jobId = 0, timer = null, last = { matches: [] }, lastErrMsg = '';

      srcIn.value = state.src; text.value = state.text; rep.value = state.replace;
      function syncFlags() { U.$$('#rxFlags button', root).forEach(function (b) { b.setAttribute('aria-pressed', String(state.flags.indexOf(b.dataset.f) !== -1)); }); }
      syncFlags();
      U.seg(U.$('#rxMode', root), state.mode, function (v) { state.mode = v; save(); renderSide(); });

      function newWorker() {
        if (worker) worker.terminate();
        try {
          worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
          worker.onmessage = function (e) { onResult(e.data); };
        } catch (e) { worker = null; }
      }
      newWorker();

      function run() {
        state.src = srcIn.value; state.text = text.value; state.replace = rep.value; save();
        var src = state.src;
        bar.classList.remove('invalid');
        if (!src) { onResult({ id: ++jobId, ok: true, matches: [], replaced: null, empty: true }); return; }
        try { new RegExp(src, state.flags); }
        catch (e) { bar.classList.add('invalid'); lastErrMsg = e.message.replace(/^Invalid regular expression: /, ''); showErr(lastErrMsg); last = { matches: [] }; paint(); renderSide(); return; }
        var job = { id: ++jobId, src: src, flags: state.flags, text: state.text, limit: 5000, replace: rep.value !== '', replacement: rep.value };
        clearTimeout(timer);
        if (!worker) { // Fallback: no worker support. Run inline.
          var res; try { var wre = new RegExp(src, state.flags), ms = []; var m; if (wre.global) { while ((m = wre.exec(job.text)) && ms.length < 5000) { ms.push({ i: m.index, s: m[0], g: m.slice(1), n: m.groups || null }); if (m[0] === '') wre.lastIndex++; } } else if ((m = wre.exec(job.text))) ms.push({ i: m.index, s: m[0], g: m.slice(1), n: m.groups || null });
            res = { id: job.id, ok: true, matches: ms, replaced: job.replace ? job.text.replace(new RegExp(src, state.flags), job.replacement) : null }; } catch (e) { res = { id: job.id, ok: false, error: e.message }; }
          onResult(res); return;
        }
        worker.postMessage(job);
        timer = setTimeout(function () {
          if (jobId !== job.id) return;
          newWorker();
          bar.classList.add('invalid');
          showErr('Stopped after 1.5 s. This pattern backtracks catastrophically on this text (often nested quantifiers like (a+)+).');
          last = { matches: [] }; paint(); renderSide();
        }, 1500);
      }

      function showErr(msg) { errBox.innerHTML = msg ? '<span class="err">' + U.esc(msg) + '</span>' : ''; }

      function onResult(r) {
        if (r.id !== jobId) return;
        clearTimeout(timer);
        if (!r.ok) { bar.classList.add('invalid'); showErr(r.error); last = { matches: [] }; }
        else {
          last = r; lastErrMsg = '';
          var flagsDesc = state.flags.split('').map(function (f) { return FLAG_INFO[f].split(':')[0]; }).join(', ');
          errBox.innerHTML = r.empty ? '<span>Type a pattern to start matching.</span>' :
            '<span>' + (r.truncated ? 'Showing the first 5,000 matches' : '') + '</span><span style="margin-left:auto">' + (flagsDesc ? 'Flags: ' + U.esc(flagsDesc) : 'No flags: only the first match is found') + (r.ms != null ? ' · ' + r.ms + ' ms' : '') + '</span>';
        }
        paint(); renderSide();
        outEl.textContent = rep.value === '' ? 'Type a replacement to preview the result. Use $1, $2… for groups, $<name> for named groups and $& for the whole match.' : (last.replaced != null ? last.replaced : '');
        outEl.classList.toggle('muted', rep.value === '');
      }

      function paint() {
        var t = text.value, ms = last.matches || [], html = '', pos = 0;
        ms.forEach(function (m, k) {
          if (m.i < pos) return;
          html += U.esc(t.slice(pos, m.i));
          html += m.s === '' ? '<mark class="empty"></mark>' : '<mark' + (k % 2 ? ' class="alt"' : '') + '>' + U.esc(m.s) + '</mark>';
          pos = m.i + m.s.length;
        });
        html += U.esc(t.slice(pos)) + '\n';
        back.innerHTML = html;
        back.scrollTop = text.scrollTop;
        var n = ms.length;
        countEl.textContent = n ? n + (n === 1 ? ' match' : ' matches') : 'No matches';
        countEl.className = 'badge ' + (n ? 'accent' : '');
      }

      function renderSide() {
        if (state.mode === 'explain') {
          if (!srcIn.value) { side.innerHTML = '<p class="muted" style="margin:0">Type a pattern and its parts are explained here.</p>'; return; }
          var items = explain(srcIn.value, state.flags);
          side.innerHTML = (lastErrMsg ? '<p class="err" style="color:var(--danger);margin:0 0 10px;font-size:13px">' + U.esc(lastErrMsg) + '</p>' : '') +
            '<ul class="explain">' + items.map(function (it) {
              return '<li style="padding-left:' + (it.depth * 16) + 'px"><code>' + U.esc(it.tok) + '</code><span class="d">' + it.desc + '</span></li>';
            }).join('') + '</ul>' +
            (state.flags ? '<p class="muted" style="font-size:12.5px;margin:12px 0 0">Flags: ' + state.flags.split('').map(function (f) { return '<b class="mono" style="color:var(--text-2)">' + f + '</b> ' + U.esc(FLAG_INFO[f]); }).join(' · ') + '</p>' : '');
          return;
        }
        if (state.mode === 'cheats') {
          side.innerHTML = '<p class="muted" style="margin:0 0 10px;font-size:12.5px">Click a token to insert it at the cursor.</p><div class="cheats">' +
            CHEATS.map(function (c) { return '<button data-ins="' + U.esc(c[0].replace('…', '')) + '"><code>' + U.esc(c[0]) + '</code><span>' + U.esc(c[1]) + '</span></button>'; }).join('') + '</div>';
          return;
        }
        var ms = last.matches || [];
        if (!ms.length) {
          side.innerHTML = '<div class="empty" style="padding:30px 10px"><div class="empty-art">' + U.icon('regex') + '</div><h3>' + (srcIn.value ? 'No matches' : 'No pattern yet') + '</h3><p>' +
            (srcIn.value ? 'Try the i flag for case-insensitive matching, or check the Explain tab.' : 'Type a pattern above or choose a common one.') + '</p></div>';
          return;
        }
        var shown = ms.slice(0, 300);
        side.innerHTML = '<ul class="match-list">' + shown.map(function (m, k) {
          var groups = '';
          if (m.g.length) {
            var names = {};
            if (m.n) Object.keys(m.n).forEach(function (nm) { names[nm] = m.n[nm]; });
            groups = '<dl class="groups">' + m.g.map(function (g, gi) {
              var named = Object.keys(names).filter(function (nm) { return names[nm] === g && g !== undefined; })[0];
              return '<dt>' + (gi + 1) + (named ? ' ' + U.esc(named) : '') + '</dt><dd>' + (g === undefined ? '<span class="muted">not matched</span>' : g === '' ? '<span class="muted">empty</span>' : U.esc(g)) + '</dd>';
            }).join('') + '</dl>';
          }
          return '<li><div class="m-head"><span class="muted" style="font-size:12px">#' + (k + 1) + '</span><span class="m-val">' + (m.s === '' ? '<span class="muted">empty</span>' : U.esc(m.s)) + '</span>' +
            '<span class="m-idx">' + m.i + '–' + (m.i + m.s.length) + '</span></div>' + groups + '</li>';
        }).join('') + '</ul>' + (ms.length > shown.length ? '<p class="muted" style="font-size:12.5px;margin:8px 0 0">and ' + (ms.length - shown.length) + ' more…</p>' : '');
      }

      srcIn.addEventListener('input', U.debounce(run, 90));
      text.addEventListener('input', U.debounce(run, 120));
      rep.addEventListener('input', U.debounce(run, 120));
      text.addEventListener('scroll', function () { back.scrollTop = text.scrollTop; });
      // Keep the backdrop the same height as the (resizable) textarea.
      var ro = window.ResizeObserver ? new ResizeObserver(function () { back.style.height = text.offsetHeight + 'px'; }) : null;
      if (ro) ro.observe(text);

      U.$('#rxFlags', root).addEventListener('click', function (e) {
        var b = e.target.closest('button[data-f]'); if (!b) return;
        var f = b.dataset.f;
        state.flags = state.flags.indexOf(f) !== -1 ? state.flags.replace(f, '') : 'gimsuy'.split('').filter(function (x) { return x === f || state.flags.indexOf(x) !== -1; }).join('');
        syncFlags(); run();
      });
      U.$('#rxPreset', root).addEventListener('change', function (e) {
        var p = PRESETS[e.target.value]; if (!p) return;
        srcIn.value = p[1]; state.flags = p[2]; syncFlags(); e.target.value = ''; run();
      });
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (b) {
          if (b.dataset.act === 'sample') { text.value = SAMPLE_TEXT; run(); }
          if (b.dataset.act === 'copyRx') U.copy('/' + srcIn.value.replace(/\//g, '\\/').replace(/\\\\\//g, '\\/') + '/' + state.flags, 'Regex');
          if (b.dataset.act === 'copyOut') U.copy(last.replaced || '', 'Result');
          return;
        }
        var ins = e.target.closest('[data-ins]');
        if (ins) {
          var s = srcIn.selectionStart == null ? srcIn.value.length : srcIn.selectionStart, en = srcIn.selectionEnd == null ? s : srcIn.selectionEnd;
          srcIn.setRangeText(ins.dataset.ins, s, en, 'end');
          srcIn.focus(); run();
        }
      });

      run();
      return function () { clearTimeout(timer); if (worker) worker.terminate(); if (ro) ro.disconnect(); };
    }
  });
})();
