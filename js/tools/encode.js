/* =========================================================================
   Tool: Encoder toolbox
   Base64, URL encoding and URL parsing, JWT decoding (with optional HMAC
   signature check), hashing of text or files, Unix timestamps and HTML
   entities. Hashing uses Web Crypto; MD5 comes from js/lib/md5.js.
   ========================================================================= */
(function () {
  'use strict';

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8', { fatal: true });

  function bytesToB64(bytes) {
    var bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64ToBytes(s) {
    s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (/^data:[^,]*;base64,/.test(s)) s = s.slice(s.indexOf(',') + 1);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Contains characters that are not Base64');
    if (s.length % 4 === 1) throw new Error('Invalid length: Base64 cannot have a length of 4n+1');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toHex(bytes) { var h = ''; for (var i = 0; i < bytes.length; i++) h += (bytes[i] + 256).toString(16).slice(1); return h; }
  function hexDump(bytes, max) {
    var lines = [], n = Math.min(bytes.length, max || 512);
    for (var o = 0; o < n; o += 16) {
      var chunk = bytes.subarray(o, Math.min(o + 16, n));
      var hex = Array.prototype.map.call(chunk, function (b) { return (b + 256).toString(16).slice(1); }).join(' ');
      var asc = Array.prototype.map.call(chunk, function (b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : '.'; }).join('');
      lines.push((o + 256 * 256 * 256).toString(16).slice(1).padStart(6, '0') + '  ' + hex.padEnd(47, ' ') + '  ' + asc);
    }
    if (bytes.length > n) lines.push('… ' + (bytes.length - n) + ' more bytes');
    return lines.join('\n');
  }
  function b64urlJSON(part) {
    var bytes = b64ToBytes(part);
    return JSON.parse(dec.decode(bytes));
  }
  function prettyJSON(v) { return JSON.stringify(v, null, 2); }
  function hasSubtle() { return !!(window.crypto && crypto.subtle); }

  var TABS = [
    ['base64', 'Base64'], ['url', 'URL'], ['jwt', 'JWT'], ['hash', 'Hash'], ['time', 'Timestamp'], ['html', 'HTML entities']
  ];

  var state = Object.assign({
    tab: 'base64',
    b64: { input: '', dir: 'encode', urlSafe: false },
    url: { input: '', mode: 'component' },
    jwt: { input: '', secret: '' },
    hash: { input: '', upper: false, expect: '' },
    time: { input: '' },
    html: { input: '', dir: 'encode', all: false }
  }, U.store.get('encode', {}));
  var save = U.debounce(function () { U.store.set('encode', state); }, 300);

  var SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.' ;

  U.register({
    id: 'encode',
    name: 'Encoder toolbox',
    desc: 'Base64, URL encoding, JWT decoding, SHA and MD5 hashes, Unix timestamps and HTML entities in one place.',
    hue: 65,
    icon: 'binary',
    keywords: ['base64', 'url', 'encode', 'decode', 'jwt', 'token', 'hash', 'sha256', 'md5', 'sha1', 'timestamp', 'unix', 'epoch', 'html', 'entities', 'hmac'],
    homeStat: function () {
      var s = U.store.get('encode', null);
      var label = s && TABS.filter(function (t) { return t[0] === s.tab; })[0];
      return label ? '<span class="dot"></span>Last used: <b>' + label[1] + '</b>' : '';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('binary') + '</span>Encoder toolbox</h1>' +
          '<p>Encode, decode and inspect. All processing happens on this device.</p>' +
        '</div></div>' +
        '<div class="seg lg enc-tabs" id="encTabs" role="tablist">' + TABS.map(function (t) { return '<button role="tab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        '<div id="encBody"></div>';
      var body = U.$('#encBody', root);
      var cleanup = null;
      function show(tab) {
        if (cleanup) { cleanup(); cleanup = null; }
        state.tab = tab; save();
        body.innerHTML = '';
        body.style.animation = 'none'; void body.offsetWidth; body.style.animation = 'fadeUp .35s var(--ease)';
        cleanup = PANES[tab](body) || null;
      }
      U.seg(U.$('#encTabs', root), state.tab, show, 'aria-selected');
      show(state.tab);
      return function () { if (cleanup) cleanup(); };
    }
  });

  // Two-pane helper: input on the left, output on the right.
  function ioLayout(opts) {
    return '<div class="split">' +
      '<section class="panel"><div class="panel-head"><span class="panel-title">' + opts.inTitle + '</span><div class="panel-actions">' + (opts.inActions || '') + '</div></div>' +
      '<textarea class="code-area wrap" id="encIn" style="min-height:260px" spellcheck="false" placeholder="' + U.esc(opts.placeholder || '') + '" aria-label="Input"></textarea>' +
      '<div class="panel-foot" id="encInFoot"></div></section>' +
      '<section class="panel"><div class="panel-head"><span class="panel-title">' + opts.outTitle + '</span><div class="panel-actions">' + (opts.outActions || '') +
      '<button class="icon-btn sm" data-act="copy" title="Copy output" aria-label="Copy output">' + U.icon('copy') + '</button></div></div>' +
      '<pre class="code-out wrap" id="encOut" style="min-height:260px"></pre>' +
      '<div class="panel-foot" id="encOutFoot"></div></section>' +
      '</div>' + (opts.after || '');
  }
  function sizeInfo(s) { var b = enc.encode(s).length; return s.length + ' chars · ' + b + ' bytes'; }

  var PANES = {};

  /* ---------- Base64 ---------- */
  PANES.base64 = function (box) {
    var st = state.b64, fileBytes = null, fileName = '';
    box.innerHTML = ioLayout({
      inTitle: '<div class="seg" id="b64Dir"><button data-v="encode">Encode</button><button data-v="decode">Decode</button></div>',
      inActions: '<label class="check-label" title="Use - and _ instead of + and /, without padding"><input type="checkbox" id="b64Url">URL-safe</label>' +
        '<button class="btn btn-ghost btn-sm" data-act="file">' + U.icon('file') + 'File</button>',
      outTitle: 'Output',
      outActions: '<button class="btn btn-ghost btn-sm" data-act="swap" title="Use output as input and flip direction">' + U.icon('swap') + 'Swap</button>',
      placeholder: 'Type or paste text…'
    });
    var input = U.$('#encIn', box), out = U.$('#encOut', box), inFoot = U.$('#encInFoot', box), outFoot = U.$('#encOutFoot', box);
    var urlBox = U.$('#b64Url', box);
    input.value = st.input; urlBox.checked = st.urlSafe;
    var setDir = U.seg(U.$('#b64Dir', box), st.dir, function (v) { st.dir = v; fileBytes = null; run(); });
    var outText = '', decodedBytes = null;

    function run() {
      st.input = input.value; st.urlSafe = urlBox.checked; save();
      decodedBytes = null; outFoot.innerHTML = '';
      input.placeholder = st.dir === 'encode' ? 'Type or paste text, or choose a file…' : 'Paste Base64 (standard or URL-safe)…';
      if (fileBytes) {
        outText = bytesToB64(fileBytes);
        if (st.urlSafe) outText = outText.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        out.textContent = outText;
        inFoot.innerHTML = '<span>File: ' + U.esc(fileName) + ' · ' + fileBytes.length + ' bytes</span><button class="btn btn-ghost btn-sm" data-act="dataurl" style="margin-left:auto">Copy as data URL</button>';
        outFoot.innerHTML = '<span>' + outText.length + ' chars</span>';
        return;
      }
      inFoot.innerHTML = input.value ? '<span>' + sizeInfo(input.value) + '</span>' : '';
      if (!input.value) { out.textContent = ''; outText = ''; return; }
      if (st.dir === 'encode') {
        outText = bytesToB64(enc.encode(input.value));
        if (st.urlSafe) outText = outText.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        out.textContent = outText;
        outFoot.innerHTML = '<span>' + outText.length + ' chars</span>';
      } else {
        try {
          var bytes = b64ToBytes(input.value);
          decodedBytes = bytes;
          try {
            outText = dec.decode(bytes);
            out.textContent = outText;
            outFoot.innerHTML = '<span class="ok">' + U.icon('check') + '</span><span>Decoded ' + bytes.length + ' bytes as UTF-8 text</span>';
          } catch (e) {
            outText = toHex(bytes);
            out.textContent = hexDump(bytes);
            outFoot.innerHTML = '<span>Binary data (' + bytes.length + ' bytes), shown as hex</span><button class="btn btn-soft btn-sm" data-act="savebin" style="margin-left:auto">' + U.icon('download') + 'Save file</button>';
          }
        } catch (e) {
          outText = ''; out.textContent = '';
          outFoot.innerHTML = '<span class="err">' + U.esc(e.message) + '</span>';
        }
      }
    }
    input.addEventListener('input', U.debounce(function () { fileBytes = null; run(); }, 100));
    urlBox.addEventListener('change', run);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var a = b.dataset.act;
      if (a === 'copy') U.copy(outText, 'Output');
      if (a === 'swap') { input.value = outText; fileBytes = null; st.dir = st.dir === 'encode' ? 'decode' : 'encode'; setDir(st.dir); run(); }
      if (a === 'file') U.pickFile().then(function (f) {
        if (!f) return;
        if (f.size > 25 * 1048576) { U.toast('That file is over 25 MB'); return; }
        f.arrayBuffer().then(function (buf) { fileBytes = new Uint8Array(buf); fileName = f.name; fileType = f.type; st.dir = 'encode'; setDir('encode'); input.value = ''; run(); });
      });
      if (a === 'dataurl' && fileBytes) U.copy('data:' + (fileType || 'application/octet-stream') + ';base64,' + bytesToB64(fileBytes), 'Data URL');
      if (a === 'savebin' && decodedBytes) U.download('decoded.bin', decodedBytes, 'application/octet-stream');
    });
    var fileType = '';
    run();
  };

  /* ---------- URL ---------- */
  PANES.url = function (box) {
    var st = state.url;
    box.innerHTML = ioLayout({
      inTitle: '<div class="seg" id="urlMode"><button data-v="component" title="encodeURIComponent: for a single query value or path segment">Encode value</button><button data-v="full" title="encodeURI: keeps :/?#&= intact">Encode URL</button><button data-v="decode">Decode</button></div>',
      outTitle: 'Output',
      placeholder: 'Paste a URL or some text…',
      after: '<section class="panel" style="margin-top:12px" id="urlParts" hidden><div class="panel-head"><span class="panel-title">URL breakdown</span></div><div class="panel-body" id="urlPartsBody"></div></section>'
    });
    var input = U.$('#encIn', box), out = U.$('#encOut', box), outFoot = U.$('#encOutFoot', box), inFoot = U.$('#encInFoot', box);
    var parts = U.$('#urlParts', box), partsBody = U.$('#urlPartsBody', box);
    input.value = st.input;
    U.seg(U.$('#urlMode', box), st.mode, function (v) { st.mode = v; run(); });
    var outText = '';
    function run() {
      st.input = input.value; save();
      var v = input.value;
      inFoot.innerHTML = v ? '<span>' + sizeInfo(v) + '</span>' : '';
      outFoot.innerHTML = '';
      try {
        if (st.mode === 'component') outText = encodeURIComponent(v);
        else if (st.mode === 'full') outText = encodeURI(v);
        else outText = decodeURIComponent(v.replace(/\+/g, ' '));
        out.textContent = outText;
        if (st.mode === 'decode' && /\+/.test(v)) outFoot.innerHTML = '<span>“+” was decoded as a space (form encoding)</span>';
      } catch (e) {
        outText = ''; out.textContent = '';
        outFoot.innerHTML = '<span class="err">' + U.esc(e.message) + ' (a “%” is not followed by two hex digits)</span>';
      }
      // URL breakdown
      var url = null, raw = v.trim();
      if (st.mode === 'decode') { try { raw = decodeURIComponent(raw); } catch (e) {} }
      try { if (/^[a-z][\w+.-]*:\/\//i.test(raw)) url = new URL(raw); } catch (e) {}
      parts.hidden = !url;
      if (url) {
        var rows = [['Protocol', url.protocol], ['Host', url.hostname], ['Port', url.port || '(default)'], ['Path', decodeSafe(url.pathname)]];
        if (url.username) rows.splice(1, 0, ['User', url.username + (url.password ? ':••••' : '')]);
        if (url.hash) rows.push(['Fragment', decodeSafe(url.hash)]);
        var params = Array.from(url.searchParams.entries());
        partsBody.innerHTML = '<dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd class="mono">' + U.esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
          (params.length ? '<p class="section-label" style="margin:16px 0 8px">Query parameters (' + params.length + ')</p><dl class="kv">' +
            params.map(function (p) { return '<dt class="mono">' + U.esc(p[0]) + '</dt><dd class="mono">' + (p[1] === '' ? '<span class="muted">empty</span>' : U.esc(p[1])) + '</dd>'; }).join('') + '</dl>' : '');
      }
    }
    function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
    input.addEventListener('input', U.debounce(run, 100));
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-act="copy"]'); if (b) U.copy(outText, 'Output'); });
    run();
  };

  /* ---------- JWT ---------- */
  PANES.jwt = function (box) {
    var st = state.jwt;
    box.innerHTML =
      '<div class="split">' +
        '<section class="panel"><div class="panel-head"><span class="panel-title">Token</span><div class="panel-actions"><button class="btn btn-ghost btn-sm" data-act="sample">' + U.icon('sparkles') + 'Sample</button></div></div>' +
          '<textarea class="code-area wrap" id="jwtIn" style="min-height:150px" spellcheck="false" placeholder="Paste a JWT (header.payload.signature)…" aria-label="JWT"></textarea>' +
          '<div class="panel-body" style="border-top:1px solid var(--border)"><div id="jwtColored" class="jwt-parts" hidden></div>' +
          '<div class="form-row" id="jwtVerify"><label class="form-label" for="jwtSecret">Verify an HMAC signature (HS256/384/512) with a secret</label>' +
          '<input class="text-input mono" id="jwtSecret" type="password" autocomplete="off" placeholder="Secret (stays on this device, never saved)"><div id="jwtVerifyOut" style="margin-top:8px;font-size:13px"></div></div></div>' +
        '</section>' +
        '<div class="stack">' +
          '<section class="panel"><div class="panel-head"><span class="panel-title">Header</span><div class="panel-actions"><span id="jwtAlg"></span></div></div><pre class="code-out" id="jwtHead" style="min-height:0;max-height:200px"></pre></section>' +
          '<section class="panel"><div class="panel-head"><span class="panel-title">Payload</span><div class="panel-actions"><span id="jwtExp"></span><button class="icon-btn sm" data-act="copyPayload" title="Copy payload JSON" aria-label="Copy payload">' + U.icon('copy') + '</button></div></div><pre class="code-out" id="jwtPayload" style="min-height:0;max-height:320px"></pre>' +
            '<div class="panel-body" id="jwtClaims" style="border-top:1px solid var(--border)"></div></section>' +
        '</div>' +
      '</div>' +
      '<p class="muted" style="font-size:12.5px;margin:12px 2px 0">Decoding does not prove a token is genuine. Without the secret or public key, anyone can create a token that decodes like this.</p>';
    var input = U.$('#jwtIn', box), head = U.$('#jwtHead', box), payload = U.$('#jwtPayload', box), claims = U.$('#jwtClaims', box);
    var colored = U.$('#jwtColored', box), algEl = U.$('#jwtAlg', box), expEl = U.$('#jwtExp', box), secret = U.$('#jwtSecret', box), verifyOut = U.$('#jwtVerifyOut', box);
    input.value = st.input;
    var cur = null, tick;

    var CLAIMS = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', exp: 'Expires', nbf: 'Not before', iat: 'Issued at', jti: 'Token ID', name: 'Name', email: 'Email', scope: 'Scope', role: 'Role', roles: 'Roles' };

    function run() {
      st.input = input.value; save();
      var t = input.value.trim().replace(/^Bearer\s+/i, '');
      cur = null; verifyOut.innerHTML = '';
      if (!t) {
        head.textContent = ''; payload.textContent = ''; claims.innerHTML = '<p class="muted" style="margin:0;font-size:13px">Paste a token to see its claims.</p>'; colored.hidden = true; algEl.innerHTML = ''; expEl.innerHTML = '';
        return;
      }
      var p = t.split('.');
      colored.hidden = false;
      colored.innerHTML = p.map(function (x, i) { return '<span class="p' + Math.min(i, 2) + '">' + U.esc(x) + '</span>'; }).join('.');
      if (p.length === 5) { head.textContent = ''; payload.textContent = ''; claims.innerHTML = '<p style="margin:0;color:var(--warn);font-size:13px">This looks like an encrypted JWE (5 parts). Its payload cannot be read without the key.</p>'; return; }
      if (p.length !== 3) { head.textContent = ''; payload.textContent = ''; claims.innerHTML = '<p style="margin:0;color:var(--danger);font-size:13px">A JWT has 3 parts separated by dots. This has ' + p.length + '.</p>'; return; }
      var h, pl;
      try { h = b64urlJSON(p[0]); head.textContent = prettyJSON(h); } catch (e) { head.textContent = 'Header is not valid Base64URL JSON: ' + e.message; }
      try { pl = b64urlJSON(p[1]); payload.textContent = prettyJSON(pl); } catch (e) { payload.textContent = 'Payload is not valid Base64URL JSON: ' + e.message; }
      algEl.innerHTML = h && h.alg ? '<span class="badge">' + U.esc(h.alg) + '</span>' : '';
      cur = { h: h, pl: pl, parts: p };
      renderClaims();
      verify();
    }

    function renderClaims() {
      var pl = cur && cur.pl;
      if (!pl || typeof pl !== 'object') { claims.innerHTML = ''; expEl.innerHTML = ''; return; }
      var now = Date.now() / 1000;
      if (typeof pl.exp === 'number') {
        expEl.innerHTML = pl.exp < now ? '<span class="badge danger">Expired ' + U.relTime(pl.exp * 1000) + '</span>' : '<span class="badge ok">Valid, expires ' + U.relTime(pl.exp * 1000) + '</span>';
      } else expEl.innerHTML = '<span class="badge">No expiry</span>';
      if (typeof pl.nbf === 'number' && pl.nbf > now) expEl.innerHTML += ' <span class="badge warn">Not valid yet</span>';
      claims.innerHTML = '<table class="claims">' + Object.keys(pl).map(function (k) {
        var v = pl[k], note = CLAIMS[k] || '';
        if ((k === 'exp' || k === 'iat' || k === 'nbf' || k === 'auth_time') && typeof v === 'number') {
          var d = new Date(v * 1000);
          note = (CLAIMS[k] || k) + ': ' + d.toLocaleString() + ' (' + U.relTime(v * 1000) + ')';
        }
        return '<tr><td>' + U.esc(k) + '</td><td>' + U.esc(typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</td><td>' + U.esc(note) + '</td></tr>';
      }).join('') + '</table>';
    }

    function verify() {
      verifyOut.innerHTML = '';
      if (!cur || !cur.h) return;
      var alg = cur.h.alg, map = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
      if (!map[alg]) { verifyOut.innerHTML = '<span class="muted">' + (alg === 'none' ? 'This token is unsigned (alg “none”). Never accept it.' : 'Signature check here supports HS256, HS384 and HS512. This token uses ' + U.esc(alg || 'an unknown algorithm') + '.') + '</span>'; return; }
      if (!secret.value) return;
      if (!hasSubtle()) { verifyOut.innerHTML = '<span class="muted">Web Crypto is unavailable here (it needs HTTPS or localhost).</span>'; return; }
      var data = enc.encode(cur.parts[0] + '.' + cur.parts[1]);
      crypto.subtle.importKey('raw', enc.encode(secret.value), { name: 'HMAC', hash: map[alg] }, false, ['sign']).then(function (key) {
        return crypto.subtle.sign('HMAC', key, data);
      }).then(function (sig) {
        var expected = bytesToB64(new Uint8Array(sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        var ok = expected === cur.parts[2];
        verifyOut.innerHTML = ok ? '<span class="badge ok">' + U.icon('check') + 'Signature verified</span>' : '<span class="badge danger">Signature does not match this secret</span>';
      }).catch(function (e) { verifyOut.innerHTML = '<span class="err" style="color:var(--danger)">' + U.esc(e.message) + '</span>'; });
    }

    input.addEventListener('input', U.debounce(run, 100));
    secret.addEventListener('input', U.debounce(verify, 150));
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'sample') {
        input.value = SAMPLE_JWT + 'signature';
        // Sign the sample with the secret "secret" so verification can be tried.
        if (hasSubtle()) {
          crypto.subtle.importKey('raw', enc.encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
            .then(function (k) { return crypto.subtle.sign('HMAC', k, enc.encode(SAMPLE_JWT.slice(0, -1))); })
            .then(function (sig) { input.value = SAMPLE_JWT + bytesToB64(new Uint8Array(sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); run(); U.toast('Sample signed with the secret “secret”'); });
        }
        run();
      }
      if (b.dataset.act === 'copyPayload') U.copy(cur && cur.pl ? prettyJSON(cur.pl) : '', 'Payload');
    });
    run();
    tick = setInterval(function () { if (cur) renderClaims(); }, 30000);
    return function () { clearInterval(tick); };
  };

  /* ---------- Hash ---------- */
  PANES.hash = function (box) {
    var st = state.hash, fileBytes = null, fileName = '';
    var ALGS = [['MD5', null], ['SHA-1', 'SHA-1'], ['SHA-256', 'SHA-256'], ['SHA-384', 'SHA-384'], ['SHA-512', 'SHA-512']];
    box.innerHTML =
      '<div class="split">' +
        '<section class="panel"><div class="panel-head"><span class="panel-title">Input</span><div class="panel-actions"><span class="muted" id="hashSrc" style="font-size:12.5px"></span></div></div>' +
          '<textarea class="code-area wrap" id="encIn" style="min-height:180px" spellcheck="false" placeholder="Type or paste text…" aria-label="Text to hash"></textarea>' +
          '<div class="panel-body" style="border-top:1px solid var(--border)"><div class="drop" id="hashDrop" tabindex="0" role="button">' + U.icon('upload') + '<div>Drop a file here or <b>browse</b> to hash it</div><div class="muted" style="font-size:12px">Files are read locally and never uploaded</div></div></div>' +
        '</section>' +
        '<section class="panel"><div class="panel-head"><span class="panel-title">Hashes</span><div class="panel-actions"><label class="check-label"><input type="checkbox" id="hashUpper">Uppercase</label></div></div>' +
          '<div class="panel-body"><ul class="hash-list" id="hashList"></ul>' +
          '<div class="form-row"><label class="form-label" for="hashExpect">Compare with an expected hash</label><input class="text-input mono" id="hashExpect" placeholder="Paste a checksum to check it" autocomplete="off" spellcheck="false"><div id="hashCmp" style="margin-top:8px;font-size:13px"></div></div></div>' +
        '</section>' +
      '</div>';
    var input = U.$('#encIn', box), list = U.$('#hashList', box), upper = U.$('#hashUpper', box), expect = U.$('#hashExpect', box), cmp = U.$('#hashCmp', box), src = U.$('#hashSrc', box), drop = U.$('#hashDrop', box);
    input.value = st.input; upper.checked = st.upper; expect.value = st.expect;
    var results = {}, runId = 0;
    list.innerHTML = ALGS.map(function (a) { return '<li><span class="alg">' + a[0] + '</span><span class="val" data-alg="' + a[0] + '"></span><button class="icon-btn sm" data-copy="' + a[0] + '" aria-label="Copy ' + a[0] + '">' + U.icon('copy') + '</button></li>'; }).join('');

    function run() {
      st.input = input.value; st.upper = upper.checked; st.expect = expect.value; save();
      var bytes = fileBytes || enc.encode(input.value);
      src.textContent = fileBytes ? fileName + ' · ' + U.fmtNum(bytes.length, 0) + ' bytes' : U.fmtNum(bytes.length, 0) + ' bytes of UTF-8 text';
      var id = ++runId;
      results = {};
      ALGS.forEach(function (a) {
        if (!a[1]) { results[a[0]] = window.md5(bytes); paint(); return; }
        if (!hasSubtle()) { results[a[0]] = 'Needs HTTPS or localhost'; paint(); return; }
        crypto.subtle.digest(a[1], bytes).then(function (buf) { if (id !== runId) return; results[a[0]] = toHex(new Uint8Array(buf)); paint(); });
      });
    }
    function paint() {
      ALGS.forEach(function (a) {
        var v = results[a[0]] || '';
        if (/^[0-9a-f]+$/.test(v) && upper.checked) v = v.toUpperCase();
        U.$('[data-alg="' + a[0] + '"]', list).textContent = v;
      });
      var e = expect.value.trim().toLowerCase().replace(/^(md5|sha-?\d+)[:=\s]+/i, '');
      if (!e) { cmp.innerHTML = ''; return; }
      var hit = ALGS.filter(function (a) { return (results[a[0]] || '') === e; })[0];
      cmp.innerHTML = hit ? '<span class="badge ok">' + U.icon('check') + 'Matches ' + hit[0] + '</span>' : '<span class="badge danger">No match with any algorithm above</span>';
    }
    function loadFile(f) {
      if (!f) return;
      if (f.size > 200 * 1048576) { U.toast('Files up to 200 MB can be hashed here'); return; }
      f.arrayBuffer().then(function (buf) { fileBytes = new Uint8Array(buf); fileName = f.name; input.value = ''; input.placeholder = 'Hashing ' + f.name + '. Type here to hash text instead.'; run(); });
    }
    input.addEventListener('input', U.debounce(function () { fileBytes = null; input.placeholder = 'Type or paste text…'; run(); }, 120));
    upper.addEventListener('change', function () { st.upper = upper.checked; save(); paint(); });
    expect.addEventListener('input', function () { st.expect = expect.value; save(); paint(); });
    drop.addEventListener('click', function () { U.pickFile().then(loadFile); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); U.pickFile().then(loadFile); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-copy]'); if (b) U.copy(U.$('[data-alg="' + b.dataset.copy + '"]', list).textContent, b.dataset.copy); });
    run();
  };

  /* ---------- Timestamp ---------- */
  PANES.time = function (box) {
    var st = state.time;
    box.innerHTML =
      '<div class="split">' +
        '<section class="panel"><div class="panel-head"><span class="panel-title">Now</span><div class="panel-actions"><button class="btn btn-ghost btn-sm" data-act="useNow">Use now</button></div></div>' +
          '<div class="panel-body"><div class="ts-now" id="tsNow"></div><div class="muted" id="tsNowMs" style="font:13px var(--mono);margin-top:4px"></div><div id="tsNowIso" style="margin-top:10px;font-size:13.5px;color:var(--text-2)"></div></div>' +
        '</section>' +
        '<section class="panel"><div class="panel-head"><span class="panel-title">Convert</span></div>' +
          '<div class="panel-body"><input class="text-input mono" id="tsIn" placeholder="1730000000, 1730000000000, 2026-10-29T14:00:00Z or “Oct 29 2026 9:30”" autocomplete="off" spellcheck="false">' +
          '<div class="field-inline" style="margin-top:8px"><span class="muted" style="font-size:12.5px">or pick</span><input class="text-input sm" id="tsPick" type="datetime-local" step="1" style="width:auto"></div>' +
          '<div id="tsDetected" class="muted" style="font-size:12.5px;margin-top:10px"></div></div>' +
        '</section>' +
      '</div>' +
      '<section class="panel" style="margin-top:12px"><div class="panel-head"><span class="panel-title">Result</span></div><div class="panel-body"><div class="ts-rows" id="tsRows"></div></div></section>';
    var tsIn = U.$('#tsIn', box), pick = U.$('#tsPick', box), rowsEl = U.$('#tsRows', box), det = U.$('#tsDetected', box);
    tsIn.value = st.input;

    function parse(v) {
      v = v.trim();
      if (!v) return null;
      if (/^-?\d+(\.\d+)?$/.test(v)) {
        var n = parseFloat(v), abs = Math.abs(n), unit;
        if (abs >= 1e17) { unit = 'nanoseconds'; n = n / 1e6; }
        else if (abs >= 1e14) { unit = 'microseconds'; n = n / 1e3; }
        else if (abs >= 1e11) { unit = 'milliseconds'; }
        else { unit = 'seconds'; n = n * 1000; }
        return { d: new Date(n), how: 'Read as Unix time in ' + unit };
      }
      var d = new Date(v);
      if (isNaN(d)) return { error: 'Could not read that as a date or Unix timestamp' };
      var tz = /Z$|[+-]\d\d:?\d\d$/.test(v) ? 'with its own time zone' : 'in your local time zone';
      return { d: d, how: 'Read as a date string ' + tz };
    }

    function row(label, value) {
      return '<span class="l">' + label + '</span><span class="v">' + U.esc(value) + '</span><button class="icon-btn sm" data-copy="' + U.esc(value) + '" aria-label="Copy ' + label + '">' + U.icon('copy') + '</button>';
    }
    function isoWeek(d) {
      var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
      var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      return Math.ceil(((t - y0) / 86400000 + 1) / 7);
    }
    function run() {
      st.input = tsIn.value; save();
      var r = parse(tsIn.value);
      if (!r) { det.textContent = 'Paste a Unix timestamp (seconds, ms, µs or ns) or a date.'; rowsEl.innerHTML = '<span class="muted" style="grid-column:1/-1">Results appear here.</span>'; return; }
      if (r.error) { det.innerHTML = '<span style="color:var(--danger)">' + U.esc(r.error) + '</span>'; rowsEl.innerHTML = ''; return; }
      var d = r.d, tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      det.textContent = r.how + '.';
      var local = d.toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
      var off = -d.getTimezoneOffset(), offStr = (off >= 0 ? '+' : '-') + U.pad(Math.floor(Math.abs(off) / 60)) + ':' + U.pad(Math.abs(off) % 60);
      var localIso = d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) + 'T' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds()) + offStr;
      rowsEl.innerHTML =
        row('Unix seconds', String(Math.floor(d.getTime() / 1000))) +
        row('Unix milliseconds', String(d.getTime())) +
        row('ISO 8601 (UTC)', d.toISOString()) +
        row('ISO 8601 (local)', localIso) +
        row('Local (' + tz + ')', local) +
        row('UTC', d.toUTCString()) +
        row('Relative', U.relTime(d.getTime())) +
        row('Day of year · week', 'Day ' + (U.daysBetween(new Date(d.getFullYear(), 0, 1), d) + 1) + ' · ISO week ' + isoWeek(d));
    }
    function tickNow() {
      var n = Date.now();
      U.$('#tsNow', box).textContent = Math.floor(n / 1000);
      U.$('#tsNowMs', box).textContent = n + ' ms';
      U.$('#tsNowIso', box).textContent = new Date(n).toISOString();
    }
    tsIn.addEventListener('input', U.debounce(run, 120));
    pick.addEventListener('change', function () { if (pick.value) { tsIn.value = pick.value; run(); } });
    box.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]'); if (c) { U.copy(c.dataset.copy, 'Value'); return; }
      var a = e.target.closest('[data-act="useNow"]'); if (a) { tsIn.value = String(Math.floor(Date.now() / 1000)); run(); }
    });
    tickNow(); run();
    var iv = setInterval(tickNow, 1000);
    var iv2 = setInterval(function () { if (tsIn.value) run(); }, 30000);
    return function () { clearInterval(iv); clearInterval(iv2); };
  };

  /* ---------- HTML entities ---------- */
  PANES.html = function (box) {
    var st = state.html;
    box.innerHTML = ioLayout({
      inTitle: '<div class="seg" id="htmlDir"><button data-v="encode">Escape</button><button data-v="decode">Unescape</button></div>',
      inActions: '<label class="check-label" title="Also convert every non-ASCII character to a numeric entity"><input type="checkbox" id="htmlAll">Non-ASCII too</label>',
      outTitle: 'Output',
      placeholder: 'Type or paste HTML or text…'
    });
    var input = U.$('#encIn', box), out = U.$('#encOut', box), all = U.$('#htmlAll', box);
    input.value = st.input; all.checked = st.all;
    U.seg(U.$('#htmlDir', box), st.dir, function (v) { st.dir = v; run(); });
    var outText = '';
    function run() {
      st.input = input.value; st.all = all.checked; save();
      all.parentElement.hidden = st.dir !== 'encode';
      if (st.dir === 'encode') {
        outText = input.value.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
        if (st.all) outText = outText.replace(/[^\x00-\x7f]/gu, function (c) { return '&#' + c.codePointAt(0) + ';'; });
      } else {
        var ta = document.createElement('textarea');
        ta.innerHTML = input.value;
        outText = ta.value;
      }
      out.textContent = outText;
    }
    input.addEventListener('input', U.debounce(run, 100));
    all.addEventListener('change', run);
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-act="copy"]'); if (b) U.copy(outText, 'Output'); });
    run();
  };
})();
