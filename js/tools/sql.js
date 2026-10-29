/* =========================================================================
   Tool: SQL viewer
   Opens .sql dumps (MySQL/MariaDB, PostgreSQL incl. COPY, SQLite .dump)
   and SQLite database files of any size. The file is never loaded whole:
   a Web Worker streams it in chunks, builds a byte-offset index per table,
   and then serves pages of rows and full-file searches on demand.
   ========================================================================= */
(function () {
  'use strict';

  /* =======================================================================
     Worker. Stringified into a Blob URL so it also runs from file://.
     Nothing in here may reference variables outside this function.
     ======================================================================= */
  function sqlWorker() {
    var CHUNK = 4 * 1024 * 1024;     // bytes read per step when streaming
    var HEAD_MAX = 2048;             // bytes of a statement used to classify it
    var RUN_MAX = 2000;              // rows per index run (bounds the cost of fetching a page)
    var PREVIEW = 100;               // rows kept in memory per table for instant first pages
    var CELL_MAX = 100000;           // characters per value sent to the page
    var utf8 = new TextDecoder('utf-8');

    var file = null, kind = null, dialect = 'generic';
    var tables = {}, order = [], schema = [], stats = null;
    var cancelled = {};
    var sq = null; // SQLite state

    function post(m) { postMessage(m); }

    self.onmessage = function (e) {
      var m = e.data;
      var fn = H[m.type];
      if (!fn) return;
      Promise.resolve().then(function () { return fn(m); }).catch(function (err) {
        post({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
      });
    };

    var H = {};
    H.cancel = function (m) { cancelled[m.target] = true; };

    H.open = async function (m) {
      file = m.file;
      var head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      if (head.length >= 16 && utf8.decode(head.subarray(0, 15)) === 'SQLite format 3') {
        kind = 'sqlite';
        await openSqlite(m.id);
        return;
      }
      if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) throw new Error('This file is UTF-16 encoded. Save it as UTF-8 and open it again.');
      if (head[0] === 0x1f && head[1] === 0x8b) throw new Error('This file is gzip-compressed. Unzip it first (for example: gunzip dump.sql.gz), then open the .sql file.');
      if (head[0] === 0x50 && head[1] === 0x4b) throw new Error('This is a ZIP archive. Extract the .sql file from it first.');
      kind = 'dump';
      var txt = utf8.decode(head);
      if (/PostgreSQL database dump|SET standard_conforming_strings|pg_catalog\./.test(txt)) dialect = 'postgres';
      else if (/MySQL dump|MariaDB dump|ENGINE=|`/.test(txt)) dialect = 'mysql';
      else if (/PRAGMA foreign_keys|BEGIN TRANSACTION;/.test(txt)) dialect = 'sqlite';
      await indexDump(m.id);
    };

    /* -------------------------------------------------------------------
       Identifiers and statement heads
       ------------------------------------------------------------------- */
    function isWs(c) { return c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f'; }
    function readIdent(s, i) {
      var parts = [];
      for (;;) {
        while (i < s.length && isWs(s[i])) i++;
        var c = s[i], part = '';
        if (c === '`' || c === '"' || c === '[') {
          var close = c === '[' ? ']' : c; i++;
          while (i < s.length) {
            if (s[i] === close) { if (close !== ']' && s[i + 1] === close) { part += close; i += 2; continue; } i++; break; }
            part += s[i++];
          }
        } else {
          var st = i;
          while (i < s.length && !/[\s.(),;`"\[=]/.test(s[i])) i++;
          part = s.slice(st, i);
        }
        if (!part) break;
        parts.push(part);
        var j = i; while (j < s.length && isWs(s[j])) j++;
        if (s[j] === '.') { i = j + 1; continue; }
        break;
      }
      return { parts: parts, i: i };
    }
    function readColList(s, i) {
      while (i < s.length && isWs(s[i])) i++;
      if (s[i] !== '(') return null;
      var depth = 0, j = i, q = null;
      for (; j < s.length; j++) {
        var c = s[j];
        if (q) { if (c === q) q = null; continue; }
        if (c === '`' || c === '"') q = c;
        else if (c === '(') depth++;
        else if (c === ')') { depth--; if (!depth) break; }
      }
      if (j >= s.length) return null;
      var inner = s.slice(i + 1, j);
      return { cols: splitTop(inner).map(function (x) { return readIdent(x, 0).parts.pop() || x.trim(); }), i: j + 1 };
    }
    function splitTop(s) {
      var out = [], depth = 0, q = null, start = 0;
      for (var k = 0; k < s.length; k++) {
        var c = s[k];
        if (q) { if (c === '\\' && dialect === 'mysql') { k++; continue; } if (c === q) q = null; continue; }
        if (c === "'" || c === '"' || c === '`') q = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) { out.push(s.slice(start, k)); start = k + 1; }
      }
      out.push(s.slice(start));
      return out.map(function (x) { return x.trim(); }).filter(Boolean);
    }

    var RE_INSERT = /^(?:INSERT|REPLACE)\s+(?:(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE|OR\s+[A-Z]+)\s+)*INTO\s+/i;
    var RE_CREATE_TABLE = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED|VIRTUAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i;
    var RE_COPY = /^COPY\s+/i;
    var RE_SCHEMA = /^(?:CREATE|ALTER)\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+|MATERIALIZED\s+|TEMP\s+|TEMPORARY\s+|DEFINER\s*=\s*\S+\s+|ALGORITHM\s*=\s*\S+\s+|SQL\s+SECURITY\s+\S+\s+)*(VIEW|INDEX|TRIGGER|SEQUENCE|FUNCTION|PROCEDURE|TYPE|SCHEMA|EXTENSION|DOMAIN)\b/i;

    function stripLead(s) {
      // Drop leading comments that ended up inside a statement head.
      for (;;) {
        s = s.replace(/^\s+/, '');
        if (s.indexOf('--') === 0) { var n = s.indexOf('\n'); s = n === -1 ? '' : s.slice(n + 1); continue; }
        if (s.indexOf('/*') === 0 && s[2] !== '!') { var e = s.indexOf('*/'); s = e === -1 ? '' : s.slice(e + 2); continue; }
        return s;
      }
    }

    function classifyHead(head) {
      var s = stripLead(head), m, r;
      if ((m = RE_INSERT.exec(s))) {
        r = readIdent(s, m[0].length);
        var cl = readColList(s, r.i);
        return { type: 'insert', parts: r.parts, cols: cl ? cl.cols : null };
      }
      if ((m = RE_CREATE_TABLE.exec(s))) { r = readIdent(s, m[0].length); return { type: 'create', parts: r.parts }; }
      if (RE_COPY.test(s) && /\bFROM\s+stdin\b/i.test(s)) {
        r = readIdent(s, 5);
        var cl2 = readColList(s, r.i);
        return { type: 'copy', parts: r.parts, cols: cl2 ? cl2.cols : null };
      }
      if ((m = RE_SCHEMA.exec(s))) {
        var after = s.slice(m[0].length).replace(/^\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+|CONCURRENTLY\s+)*/i, ' ');
        return { type: 'schema', what: m[1].toUpperCase(), name: readIdent(after, 0).parts.join('.') };
      }
      return { type: 'other' };
    }

    /* -------------------------------------------------------------------
       Table registry (dump mode)
       ------------------------------------------------------------------- */
    function tableFor(parts, create) {
      if (!parts || !parts.length) return null;
      var key = parts.join('.');
      if (tables[key]) return tables[key];
      if (!create) {
        // INSERT INTO users when the CREATE said public.users (or the reverse).
        var last = parts[parts.length - 1], hits = order.filter(function (k) { return tables[k].last === last; });
        if (hits.length === 1) return tables[hits[0]];
      }
      var t = { name: key, last: parts[parts.length - 1], columns: [], createSql: '', rows: 0, preview: [], runs: [], lastSeq: -2 };
      tables[key] = t; order.push(key);
      return t;
    }

    function parseColumns(sql) {
      var r = RE_CREATE_TABLE.exec(stripLead(sql));
      var s = stripLead(sql), i = r ? readIdent(s, r[0].length).i : 0;
      var open = s.indexOf('(', i);
      if (open === -1) return [];
      var depth = 0, q = null, j = open;
      for (; j < s.length; j++) {
        var c = s[j];
        if (q) { if (c === q) q = null; continue; }
        if (c === "'" || c === '"' || c === '`') q = c;
        else if (c === '(') depth++;
        else if (c === ')') { depth--; if (!depth) break; }
      }
      var defs = splitTop(s.slice(open + 1, j)), cols = [], pk = [];
      defs.forEach(function (d) {
        var tpk = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(d);
        if (tpk) { pk = splitTop(tpk[1]).map(function (x) { return readIdent(x, 0).parts.pop(); }); return; }
        if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|KEY|INDEX|FULLTEXT|SPATIAL|EXCLUDE|PERIOD|LIKE)\b/i.test(d)) return;
        var id = readIdent(d, 0);
        var name = id.parts.pop();
        if (!name) return;
        var rest = d.slice(id.i).trim();
        var cut = /\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|AUTO_INCREMENT|AUTOINCREMENT|GENERATED|CONSTRAINT|COMMENT|CHARACTER\s+SET|ON\s+UPDATE|AS\s*\()\b/i.exec(' ' + rest);
        var type = cut ? (' ' + rest).slice(0, cut.index).trim() : rest;
        var extra = cut ? (' ' + rest).slice(cut.index).trim() : '';
        cols.push({ name: name, type: type, extra: extra });
      });
      if (pk.length === 1) cols.forEach(function (c) { if (c.name === pk[0] && !/PRIMARY\s+KEY/i.test(c.extra)) c.extra = (c.extra + ' PRIMARY KEY').trim(); });
      cols.pk = pk.length ? pk : cols.filter(function (c) { return /PRIMARY\s+KEY/i.test(c.extra); }).map(function (c) { return c.name; });
      return cols;
    }

    /* -------------------------------------------------------------------
       Value parsing
       ------------------------------------------------------------------- */
    var MY_ESC = { '0': '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a', '\\': '\\', "'": "'", '"': '"' };
    function clip(s) { return s.length > CELL_MAX ? s.slice(0, CELL_MAX) + ' …[truncated, ' + s.length + ' chars]' : s; }

    // Reads INSERT tuples from a statement body. onRow(values) returning false stops.
    function parseInsertRows(body, onRow) {
      var s = stripLead(body);
      var m = RE_INSERT.exec(s); if (!m) return;
      var r = readIdent(s, m[0].length), i = r.i;
      var cl = readColList(s, i); if (cl) i = cl.i;
      var vm = /\bVALUES?\b/i.exec(s.slice(i, i + 200));
      if (!vm) return;
      i += vm.index + vm[0].length;
      var n = s.length, mysql = dialect === 'mysql';
      for (;;) {
        while (i < n && (isWs(s[i]) || s[i] === ',')) i++;
        if (s[i] !== '(') return;
        i++;
        var row = [];
        for (;;) {
          while (i < n && isWs(s[i])) i++;
          if (i >= n) return;
          if (s[i] === ')') { i++; break; }
          var v, c = s[i];
          var esc = mysql;
          if ((c === 'E' || c === 'e') && s[i + 1] === "'") { esc = true; i++; c = "'"; }
          if (c === "'" || (c === '"' && mysql)) {
            var q = c, out = '', st = ++i;
            for (;;) {
              if (i >= n) return;
              var ch = s[i];
              if (ch === '\\' && esc) { out += s.slice(st, i); var e2 = s[i + 1]; out += MY_ESC[e2] != null ? MY_ESC[e2] : '\\' + e2; i += 2; st = i; continue; }
              if (ch === q) {
                if (s[i + 1] === q) { out += s.slice(st, i + 1); i += 2; st = i; continue; }
                out += s.slice(st, i); i++; break;
              }
              i++;
            }
            v = clip(out);
            // Skip a trailing cast such as '...'::jsonb
            while (s[i] === ':' && s[i + 1] === ':') { i += 2; while (i < n && /[\w\s\[\]."()]/.test(s[i]) && s[i] !== ',' && s[i] !== ')') i++; }
          } else {
            var st2 = i, depth = 0, q2 = null;
            for (; i < n; i++) {
              var ch2 = s[i];
              if (q2) { if (ch2 === '\\' && mysql) { i++; continue; } if (ch2 === q2) q2 = null; continue; }
              if (ch2 === "'") q2 = ch2;
              else if (ch2 === '(') depth++;
              else if (ch2 === ')') { if (!depth) break; depth--; }
              else if (ch2 === ',' && !depth) break;
            }
            var raw = s.slice(st2, i).trim();
            var intro = /^_[a-z0-9]+\s*'([\s\S]*)'$/i.exec(raw) || /^[nN]'([\s\S]*)'$/.exec(raw);
            if (/^null$/i.test(raw)) v = null;
            else if (intro) v = clip(intro[1].replace(/''/g, "'").replace(/\\(.)/g, function (_, x) { return MY_ESC[x] != null ? MY_ESC[x] : x; }));
            else if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw)) { var num = Number(raw); v = String(num) === raw.replace(/^\+/, '') && Math.abs(num) <= Number.MAX_SAFE_INTEGER ? num : { n: raw }; }
            else v = { raw: clip(raw) };
          }
          row.push(v);
          while (i < n && isWs(s[i])) i++;
          if (s[i] === ',') { i++; continue; }
          if (s[i] === ')') { i++; break; }
        }
        if (onRow(row) === false) return;
      }
    }

    var COPY_ESC = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' };
    function parseCopyLine(line) {
      return line.split('\t').map(function (f) {
        if (f === '\\N') return null;
        if (f.indexOf('\\') === -1) return clip(f);
        return clip(f.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, function (_, x) {
          if (COPY_ESC[x] != null) return COPY_ESC[x];
          if (x[0] === 'x') return String.fromCharCode(parseInt(x.slice(1), 16));
          if (/^[0-7]+$/.test(x)) return String.fromCharCode(parseInt(x, 8));
          return x;
        }));
      });
    }

    /* -------------------------------------------------------------------
       The streaming scanner
       Walks bytes, tracking strings, comments, parentheses and COPY data,
       and reports each statement with its exact byte range.
       cb.classify(head)       -> info object, may set info.collect = true
       cb.stmt(s)              s = { start, end, info, tuples, body|null }
       cb.copyBegin(info, at)  -> true to receive line text
       cb.copyLine(at, text|null)
       cb.copyEnd(at)
       cb.progress(pos), cb.stop() -> true to abort
       ------------------------------------------------------------------- */
    function concat(parts) {
      if (parts.length === 1) return parts[0];
      var len = 0, k; for (k = 0; k < parts.length; k++) len += parts[k].length;
      var out = new Uint8Array(len), off = 0;
      for (k = 0; k < parts.length; k++) { out.set(parts[k], off); off += parts[k].length; }
      return out;
    }

    async function scan(from, to, cb) {
      var mysql = dialect === 'mysql';
      var st = 0, depth = 0, tuples = 0, stmtStart = -1, classified = false, collecting = false, parts = [], info = null;
      var copy = null, pos = from;
      while (pos < to) {
        if (cb.stop && cb.stop()) return false;
        var end = Math.min(to, pos + CHUNK);
        var u8 = new Uint8Array(await file.slice(pos, end).arrayBuffer());
        var base = pos, n = u8.length, more = end < to, consumed = n, i = 0;
        var cFrom = stmtStart >= 0 && collecting ? 0 : -1;   // where collected bytes begin in this chunk
        var lFrom = 0;                                          // where the current COPY line begins in this chunk
        var nq = -1, nb = -1, nqFor = -1;

        var classify = function (iAt) {
          var bytes = concat(parts.concat([u8.subarray(cFrom < 0 ? iAt : cFrom, iAt)]));
          info = cb.classify(utf8.decode(bytes.length > HEAD_MAX ? bytes.subarray(0, HEAD_MAX) : bytes)) || { type: 'other' };
          classified = true;
          if (!info.collect) { collecting = false; parts = []; cFrom = -1; }
        };
        var finish = function (iEnd) {
          if (!classified) classify(iEnd);
          var body = null;
          if (collecting) body = utf8.decode(concat(parts.concat([u8.subarray(cFrom < 0 ? 0 : cFrom, iEnd)])));
          cb.stmt({ start: stmtStart, end: base + iEnd, info: info, tuples: tuples, body: body });
          var wasCopy = info && info.type === 'copy';
          if (wasCopy) copy = { info: info, skip: true, lines: 0, want: false, lineStart: 0, lparts: [] };
          stmtStart = -1; classified = false; collecting = false; parts = []; cFrom = -1; tuples = 0; depth = 0; info = null;
          if (wasCopy) st = 6;
        };

        for (; i < n; i++) {
          if (stmtStart >= 0 && !classified && base + i - stmtStart >= HEAD_MAX) classify(i);
          var c = u8[i];
          if (st === 0) {
            if (c === 32 || c === 10 || c === 13 || c === 9) continue;
            if (c === 45 || c === 47) { // '-' or '/'
              if (i + 1 >= n && more) { consumed = i; break; }
              var d = u8[i + 1];
              if (c === 45 && d === 45) { st = 4; i++; continue; }
              if (c === 47 && d === 42) { st = 5; i++; continue; }
            }
            if (c === 35 && mysql) { st = 4; continue; }
            if (stmtStart < 0) { stmtStart = base + i; cFrom = i; collecting = true; tuples = 0; depth = 0; }
            if (c === 39) st = 1;
            else if (c === 34) st = 2;
            else if (c === 96) st = 3;
            else if (c === 40) { if (depth === 0) tuples++; depth++; }
            else if (c === 41) { if (depth > 0) depth--; }
            else if (c === 59 && depth === 0) finish(i + 1);
            continue;
          }
          if (st === 1 || st === 2 || st === 3) {
            var qc = st === 1 ? 39 : st === 2 ? 34 : 96;
            if (nqFor !== qc || nq < i) { nq = u8.indexOf(qc, i); nqFor = qc; if (nq === -1) nq = n; }
            if (mysql && st !== 3) {
              if (nb < i && nb !== n) { nb = u8.indexOf(92, i); if (nb === -1) nb = n; }
              if (nb < nq) {
                if (nb + 1 >= n && more) { consumed = nb; break; }
                i = nb + 1; continue;
              }
            }
            if (nq >= n) { i = n; break; }
            i = nq; st = 0; continue;
          }
          if (st === 4) { var nl = u8.indexOf(10, i); if (nl === -1) { i = n; break; } i = nl; st = 0; continue; }
          if (st === 5) {
            var star = u8.indexOf(42, i);
            if (star === -1) { i = n; break; }
            if (star + 1 >= n && more) { consumed = star; break; }
            if (u8[star + 1] === 47) { i = star + 1; st = 0; } else i = star;
            continue;
          }
          if (st === 6) {
            if (copy.skip) {
              var nl0 = u8.indexOf(10, i);
              if (nl0 === -1) { i = n; break; }
              i = nl0; copy.skip = false; copy.lineStart = base + nl0 + 1; lFrom = nl0 + 1;
              copy.want = !!cb.copyBegin(copy.info, copy.lineStart);
              continue;
            }
            var nl2 = u8.indexOf(10, i);
            if (nl2 === -1) { i = n; break; }
            var lineLen = base + nl2 - copy.lineStart;
            var lineEnd = nl2 > 0 && u8[nl2 - 1] === 13 ? nl2 - 1 : nl2;
            var isEnd = (lineLen === 2 || (lineLen === 3 && lineEnd === nl2 - 1)) && copy.lparts.length === 0 && u8[lFrom] === 92 && u8[lFrom + 1] === 46;
            if (isEnd) {
              cb.copyEnd(copy.lineStart);
              copy = null; st = 0; i = nl2; continue;
            }
            var text = null;
            if (copy.want || (cb.copyWant && cb.copyWant())) {
              text = utf8.decode(concat(copy.lparts.concat([u8.subarray(lFrom, lineEnd)])));
            }
            cb.copyLine(copy.lineStart, text);
            copy.lines++; copy.lparts = [];
            copy.lineStart = base + nl2 + 1; lFrom = nl2 + 1; i = nl2;
            continue;
          }
        }
        // Carry partial data into the next chunk.
        if (stmtStart >= 0 && collecting) parts.push(u8.slice(cFrom < 0 ? 0 : cFrom, consumed));
        if (st === 6 && copy && !copy.skip && lFrom < consumed) {
          // Re-read a very short partial line next time, so a "\." terminator split across chunks is still seen.
          if (more && consumed - lFrom < 4 && copy.lparts.length === 0) consumed = lFrom;
          else if (copy.want || (cb.copyWant && cb.copyWant())) copy.lparts.push(u8.slice(lFrom, consumed));
        }
        pos = base + consumed;
        if (cb.progress) cb.progress(pos);
      }
      if (stmtStart >= 0) {
        // Trailing statement without a semicolon.
        var tail = concat(parts);
        if (!classified) { info = cb.classify(utf8.decode(tail.length > HEAD_MAX ? tail.subarray(0, HEAD_MAX) : tail)) || { type: 'other' }; }
        cb.stmt({ start: stmtStart, end: to, info: info, tuples: tuples, body: info.collect ? utf8.decode(tail) : null });
      }
      if (copy && !copy.skip) cb.copyEnd(to);
      return true;
    }

    function insertRows(info, tuples) { return Math.max(0, tuples - (info.cols ? 1 : 0)); }

    /* -------------------------------------------------------------------
       Dump: index
       ------------------------------------------------------------------- */
    async function indexDump(id) {
      tables = {}; order = []; schema = [];
      stats = { statements: 0, inserts: 0, size: file.size };
      var seq = 0, last = 0, t0 = Date.now(), copyT = null;
      await scan(0, file.size, {
        stop: function () { return cancelled[id]; },
        classify: function (head) {
          var info = classifyHead(head);
          if (info.type === 'insert') {
            info.t = tableFor(info.parts, false);
            if (info.t.preview.length < PREVIEW) info.collect = true;
          } else if (info.type === 'create') { info.t = tableFor(info.parts, true); info.collect = true; }
          else if (info.type === 'schema' || info.type === 'copy') info.collect = true;
          return info;
        },
        stmt: function (s) {
          stats.statements++; seq++;
          var info = s.info, t = info.t;
          if (info.type === 'insert') {
            stats.inserts++;
            var rows = insertRows(info, s.tuples);
            if (!t.columns.length && info.cols) t.columns = info.cols.map(function (c) { return { name: c, type: '', extra: '' }; });
            var run = t.runs[t.runs.length - 1];
            if (run && run.k === 0 && t.lastSeq === seq - 1 && run.n + rows <= RUN_MAX) { run.e = s.end; run.n += rows; }
            else t.runs.push({ k: 0, s: s.start, e: s.end, r0: t.rows, n: rows });
            t.rows += rows; t.lastSeq = seq;
            if (s.body && t.preview.length < PREVIEW) parseInsertRows(s.body, function (row) { t.preview.push(row); return t.preview.length < PREVIEW; });
          } else if (info.type === 'create') {
            t.createSql = s.body.length > 200000 ? s.body.slice(0, 200000) : s.body;
            t.columns = parseColumns(s.body);
          } else if (info.type === 'schema') {
            schema.push({ what: info.what, name: info.name, sql: s.body.length > 20000 ? s.body.slice(0, 20000) + '\n…' : s.body });
          }
        },
        copyBegin: function (info, at) {
          var t = tableFor(info.parts, false);
          if (!t.columns.length && info.cols) t.columns = info.cols.map(function (c) { return { name: c, type: '', extra: '' }; });
          t.runs.push({ k: 1, s: at, e: at, r0: t.rows, n: 0 });
          copyT = t;
          return false; // lines are decoded only while copyWant() says the preview needs them
        },
        copyWant: function () { return copyT && copyT.preview.length < PREVIEW; },
        copyLine: function (at, text) {
          var t = copyT, run = t.runs[t.runs.length - 1];
          if (run.n >= RUN_MAX) { run.e = at; run = { k: 1, s: at, e: at, r0: t.rows, n: 0 }; t.runs.push(run); }
          run.n++; t.rows++;
          if (text != null && t.preview.length < PREVIEW) t.preview.push(parseCopyLine(text));
        },
        copyEnd: function (at) { if (copyT) { copyT.runs[copyT.runs.length - 1].e = at; copyT = null; } },
        progress: function (p) {
          var now = Date.now();
          if (now - last > 120 || p >= file.size) { last = now; post({ type: 'progress', id: id, done: p, total: file.size, tables: order.length, ms: now - t0 }); }
        }
      });
      if (cancelled[id]) { post({ type: 'cancelled', id: id }); return; }
      order.forEach(function (k) {
        var t = tables[k];
        if (!t.columns.length) {
          var w = t.preview.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
          for (var c = 0; c < w; c++) t.columns.push({ name: 'column' + (c + 1), type: '', extra: '' });
        }
      });
      post({ type: 'ready', id: id, info: summary(Date.now() - t0) });
    }

    function summary(ms) {
      return {
        kind: kind, dialect: dialect, size: file.size, name: file.name || 'pasted.sql', ms: ms,
        statements: stats ? stats.statements : null,
        tables: order.map(function (k) {
          var t = tables[k];
          return { name: t.name, columns: t.columns, rows: t.rows, exact: t.exact !== false, createSql: t.createSql, note: t.note || '' };
        }),
        schema: schema
      };
    }

    /* -------------------------------------------------------------------
       Dump: pages
       ------------------------------------------------------------------- */
    async function readRun(t, run, onRow) {
      if (run.k === 1) {
        var txt = utf8.decode(new Uint8Array(await file.slice(run.s, run.e).arrayBuffer()));
        var lines = txt.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        for (var k = 0; k < lines.length; k++) if (onRow(parseCopyLine(lines[k].replace(/\r$/, '')), run.r0 + k) === false) return;
        return;
      }
      var idx = run.r0, stop = false;
      await scan(run.s, run.e, {
        stop: function () { return stop; },
        classify: function (head) { var info = classifyHead(head); info.collect = info.type === 'insert'; return info; },
        stmt: function (s) {
          if (stop || !s.body || s.info.type !== 'insert') return;
          parseInsertRows(s.body, function (row) { if (onRow(row, idx++) === false) { stop = true; return false; } });
        },
        copyBegin: function () { return false; }, copyLine: function () {}, copyEnd: function () {}
      });
    }

    function findRun(t, row) {
      var lo = 0, hi = t.runs.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (t.runs[mid].r0 <= row) lo = mid; else hi = mid - 1; }
      return lo;
    }

    H.page = async function (m) {
      if (kind === 'sqlite') return sqlitePage(m);
      var t = tables[m.table];
      if (!t) throw new Error('Unknown table');
      var start = Math.max(0, m.start), limit = m.limit, rows = [];
      if (start + limit <= t.preview.length || (start < t.preview.length && t.preview.length >= t.rows)) {
        rows = t.preview.slice(start, start + limit);
      } else {
        var ri = findRun(t, start);
        while (ri < t.runs.length && rows.length < limit) {
          await readRun(t, t.runs[ri], function (row, idx) {
            if (idx >= start && rows.length < limit) rows.push(row);
            return rows.length < limit;
          });
          ri++;
        }
      }
      post({ type: 'page', id: m.id, table: m.table, start: start, rows: rows, total: t.rows });
    };

    /* -------------------------------------------------------------------
       Search (both modes)
       ------------------------------------------------------------------- */
    function makeMatcher(m) {
      var q = m.q;
      if (m.mode === 'regex') {
        var re = new RegExp(q, m.cs ? '' : 'i');
        return { test: function (s) { return re.test(s); }, pre: null };
      }
      var qn = m.cs ? q : q.toLowerCase();
      // Prefilter on the raw SQL text. Quotes and backslashes may be escaped there,
      // so use the longest stretch of the query without them.
      var pre = qn.split(/['"\\\n\r\t]/).sort(function (a, b) { return b.length - a.length; })[0];
      if (!pre || (pre.length < 3 && pre !== qn)) pre = null;
      if (m.mode === 'exact') return { test: function (s) { return (m.cs ? s : s.toLowerCase()) === qn; }, pre: pre };
      return { test: function (s) { return (m.cs ? s : s.toLowerCase()).indexOf(qn) !== -1; }, pre: pre };
    }
    function valStr(v) {
      if (v == null) return null;
      if (typeof v === 'object') return v.raw != null ? v.raw : v.n != null ? v.n : v.h != null ? '0x' + v.h : '';
      return String(v);
    }
    function rowHit(row, matcher, col) {
      if (col >= 0) { var s = valStr(row[col]); return s != null && matcher.test(s) ? col : -1; }
      for (var k = 0; k < row.length; k++) { var v = valStr(row[k]); if (v != null && matcher.test(v)) return k; }
      return -1;
    }

    H.search = async function (m) {
      var matcher = makeMatcher(m);
      var hits = [], total = 0, lastPost = 0, sent = 0, scanned = 0, id = m.id;
      var limit = m.limit || 1000;
      function flush(force) {
        var now = Date.now();
        if (!force && now - lastPost < 200) return;
        lastPost = now;
        post({ type: 'searchProgress', id: id, hits: hits.slice(sent), total: total, scanned: scanned, size: m.table ? null : file.size });
        sent = hits.length;
      }
      function add(table, rowIdx, row, col) {
        total++;
        if (hits.length < limit) hits.push({ table: table, row: rowIdx, values: row.map(function (v) { return typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v; }), col: col });
      }
      var stop = function () { return cancelled[id] || hits.length >= limit; };

      if (kind === 'sqlite') { await sqliteSearch(m, matcher, add, stop, function (p) { scanned = p; flush(); }); }
      else if (m.table) {
        var t = tables[m.table];
        for (var ri = 0; ri < t.runs.length && !stop(); ri++) {
          var run = t.runs[ri];
          if (matcher.pre) {
            // Cheap prefilter: skip the whole run when its raw text cannot contain the query.
            var raw = utf8.decode(new Uint8Array(await file.slice(run.s, run.e).arrayBuffer()));
            if ((m.cs ? raw : raw.toLowerCase()).indexOf(matcher.pre) === -1) { scanned += run.n; flush(); continue; }
          }
          await readRun(t, run, function (row, idx) {
            var c = rowHit(row, matcher, m.col);
            if (c >= 0) add(t.name, idx, row, c);
            return !stop();
          });
          scanned += run.n; flush();
        }
      } else {
        var counters = {}, copyT = null, copyIdx = 0;
        await scan(0, file.size, {
          stop: stop,
          classify: function (head) {
            var info = classifyHead(head);
            if (info.type === 'insert') { info.t = tableFor(info.parts, false); info.collect = true; }
            return info;
          },
          stmt: function (s) {
            var info = s.info;
            if (info.type !== 'insert' || !s.body) return;
            var t = info.t, base = counters[t.name] || 0;
            counters[t.name] = base + insertRows(info, s.tuples);
            if (matcher.pre && (m.cs ? s.body : s.body.toLowerCase()).indexOf(matcher.pre) === -1) return;
            var k = 0;
            parseInsertRows(s.body, function (row) {
              var c = rowHit(row, matcher, -1);
              if (c >= 0) add(t.name, base + k, row, c);
              k++;
              return !stop();
            });
          },
          copyBegin: function (info) { copyT = tableFor(info.parts, false); copyIdx = counters[copyT.name] || 0; return true; },
          copyLine: function (at, text) {
            var idx = copyIdx++;
            counters[copyT.name] = copyIdx;
            if (text == null) return;
            if (matcher.pre && (m.cs ? text : text.toLowerCase()).indexOf(matcher.pre) === -1) return;
            var row = parseCopyLine(text), c = rowHit(row, matcher, -1);
            if (c >= 0) add(copyT.name, idx, row, c);
          },
          copyEnd: function () { copyT = null; },
          progress: function (p) { scanned = p; flush(); }
        });
      }
      flush(true);
      post({ type: 'searchDone', id: id, total: total, shown: hits.length, limited: total > hits.length || hits.length >= limit, cancelled: !!cancelled[id] });
    };

    /* =====================================================================
       SQLite database files
       ===================================================================== */
    async function openSqlite(id) {
      var h = new Uint8Array(await file.slice(0, 100).arrayBuffer());
      var dv = new DataView(h.buffer);
      var ps = dv.getUint16(16); if (ps === 1) ps = 65536;
      var reserved = h[20];
      var enc = dv.getUint32(56);
      sq = {
        ps: ps, usable: ps - reserved, enc: enc === 2 ? new TextDecoder('utf-16le') : enc === 3 ? new TextDecoder('utf-16be') : utf8,
        cache: new Map(), pending: new Map(), maxPages: Math.max(64, Math.floor(64 * 1048576 / ps)), block: Math.max(1, Math.floor(262144 / ps)),
        pages: Math.ceil(file.size / ps)
      };
      tables = {}; order = []; schema = [];
      var master = [];
      await walkTree(1, async function (row) { master.push(row.values); });
      master.forEach(function (r) {
        var type = r[0], name = r[1], root = r[3], sql = r[4];
        if (type === 'table') {
          var cols = sql ? parseColumns(sql) : [];
          if (name === 'sqlite_master' || name === 'sqlite_schema') return;
          var withoutRowid = /\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(sql || '');
          var isVirtual = /^CREATE\s+VIRTUAL/i.test(sql || '');
          var ipk = -1;
          if (!withoutRowid) cols.forEach(function (c, k) { if (/^INTEGER$/i.test(c.type) && /PRIMARY\s+KEY/i.test(c.extra) && !/PRIMARY\s+KEY\s+DESC/i.test(c.extra)) ipk = k; });
          // WITHOUT ROWID records store the primary key columns first.
          var order2 = null;
          if (withoutRowid && cols.pk && cols.pk.length) {
            var pkNames = cols.pk, rest = cols.filter(function (c) { return pkNames.indexOf(c.name) === -1; });
            order2 = cols.map(function (c) { var pi = pkNames.indexOf(c.name); return pi !== -1 ? pi : pkNames.length + rest.indexOf(c); });
          }
          var t = { name: name, last: name, columns: cols, createSql: sql || '', root: root, withoutRowid: withoutRowid, ipk: ipk, order: order2, rows: null, exact: false, idx: null, note: isVirtual ? 'Virtual table: rows live in shadow tables or an extension.' : '' };
          if (isVirtual || !root) t.rows = 0, t.exact = true;
          tables[name] = t; order.push(name);
        } else if (sql) {
          schema.push({ what: String(type).toUpperCase(), name: name, sql: sql });
        }
      });
      stats = null;
      post({ type: 'ready', id: id, info: summary(0) });
      // Count rows in the background, smallest root pages first is not meaningful, so keep file order.
      for (var k = 0; k < order.length; k++) {
        var tt = tables[order[k]];
        if (!tt.exact) await ensureIndex(tt);
      }
    }

    async function readPage(no) {
      var c = sq.cache.get(no);
      if (c) { sq.cache.delete(no); sq.cache.set(no, c); return c; }
      var first = Math.floor((no - 1) / sq.block) * sq.block + 1;
      var p = sq.pending.get(first);
      if (!p) {
        p = file.slice((first - 1) * sq.ps, Math.min(file.size, (first - 1 + sq.block) * sq.ps)).arrayBuffer().then(function (buf) {
          var all = new Uint8Array(buf);
          for (var k = 0; k * sq.ps < all.length; k++) sq.cache.set(first + k, all.subarray(k * sq.ps, (k + 1) * sq.ps));
          while (sq.cache.size > sq.maxPages) sq.cache.delete(sq.cache.keys().next().value);
          sq.pending.delete(first);
        });
        sq.pending.set(first, p);
      }
      await p;
      var pg = sq.cache.get(no);
      if (!pg) throw new Error('Page ' + no + ' is outside the file. The database may be truncated.');
      return pg;
    }

    function varint(b, p) {
      var v = 0;
      for (var k = 0; k < 8; k++) {
        var c = b[p + k];
        v = v * 128 + (c & 0x7f);
        if (!(c & 0x80)) return [v, p + k + 1];
      }
      return [v * 256 + b[p + 8], p + 9];
    }
    function u16(b, p) { return (b[p] << 8) | b[p + 1]; }
    function u32(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }

    function pageInfo(pg, no) {
      var h = no === 1 ? 100 : 0, type = pg[h];
      var interior = type === 2 || type === 5;
      return { type: type, h: h, cells: u16(pg, h + 3), right: interior ? u32(pg, h + 8) : 0, ptr: h + (interior ? 12 : 8) };
    }

    // Reads a cell payload, following overflow pages up to `cap` bytes.
    async function payload(pg, off, P, isIndex) {
      var U = sq.usable;
      var X = isIndex ? Math.floor((U - 12) * 64 / 255) - 23 : U - 35;
      var M = Math.floor((U - 12) * 32 / 255) - 23;
      var local = P;
      if (P > X) { var K = M + ((P - M) % (U - 4)); local = K <= X ? K : M; }
      if (local >= P) return { bytes: pg.subarray(off, off + P), full: true };
      var cap = 262144, out = new Uint8Array(Math.min(P, cap)), got = Math.min(local, out.length);
      out.set(pg.subarray(off, off + got), 0);
      var next = u32(pg, off + local);
      while (got < out.length && next) {
        var op = await readPage(next);
        var take = Math.min(U - 4, out.length - got);
        out.set(op.subarray(4, 4 + take), got); got += take;
        next = u32(op, 0);
      }
      return { bytes: out, full: out.length >= P };
    }

    function hex(b, max) { var s = ''; for (var k = 0; k < Math.min(b.length, max); k++) s += (b[k] + 256).toString(16).slice(1); return s; }

    function decodeRecord(b, full) {
      var r = varint(b, 0), hdr = r[0], p = r[1], types = [];
      while (p < hdr && p < b.length) { r = varint(b, p); types.push(r[0]); p = r[1]; }
      var off = hdr, vals = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      for (var k = 0; k < types.length; k++) {
        var t = types[k], v = null, len = 0;
        if (t === 0 || t === 10 || t === 11) v = null;
        else if (t >= 1 && t <= 6) {
          len = [0, 1, 2, 3, 4, 6, 8][t];
          if (off + len > b.length) { v = { raw: '…' }; }
          else if (t === 1) v = dv.getInt8(off);
          else if (t === 2) v = dv.getInt16(off);
          else if (t === 3) { v = (b[off] << 16) | (b[off + 1] << 8) | b[off + 2]; if (v & 0x800000) v -= 0x1000000; }
          else if (t === 4) v = dv.getInt32(off);
          else if (t === 5) v = dv.getInt16(off) * 4294967296 + dv.getUint32(off + 2);
          else { var big = dv.getBigInt64(off); v = (big <= 9007199254740991n && big >= -9007199254740991n) ? Number(big) : { n: big.toString() }; }
        } else if (t === 7) { len = 8; v = off + 8 <= b.length ? dv.getFloat64(off) : { raw: '…' }; }
        else if (t === 8) v = 0;
        else if (t === 9) v = 1;
        else if (t >= 12) {
          len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
          var avail = b.subarray(off, Math.min(b.length, off + len));
          if (t % 2 === 0) v = { b: len, h: hex(avail, 48) };
          else {
            var s = sq.enc.decode(avail);
            if (avail.length < len) s += ' …[truncated, ' + len + ' bytes]';
            v = clip(s);
          }
        }
        vals.push(v);
        off += len;
      }
      return vals;
    }

    function finishRow(t, rowid, vals) {
      if (!t) return vals;
      if (t.order) vals = t.order.map(function (k) { return vals[k] === undefined ? null : vals[k]; });
      if (t.ipk >= 0 && vals[t.ipk] == null) vals[t.ipk] = rowid;
      while (vals.length < t.columns.length) vals.push(null);
      return vals;
    }

    // In-order traversal of a table or index b-tree. onRow({rowid, values}) may return false to stop.
    async function walkTree(root, onRow, stop) {
      var halted = false;
      async function visit(no, depth) {
        if (halted || depth > 64) return;
        if (stop && stop()) { halted = true; return; }
        var pg = await readPage(no), pi = pageInfo(pg, no), k, off, r;
        if (pi.type === 13 || pi.type === 10) {
          for (k = 0; k < pi.cells; k++) {
            off = u16(pg, pi.ptr + 2 * k);
            r = varint(pg, off); var P = r[0]; off = r[1];
            var rowid = null;
            if (pi.type === 13) { r = varint(pg, off); rowid = r[0]; off = r[1]; }
            var pl = await payload(pg, off, P, pi.type === 10);
            if ((await onRow({ rowid: rowid, values: decodeRecord(pl.bytes, pl.full) })) === false) { halted = true; return; }
          }
        } else if (pi.type === 5) {
          for (k = 0; k < pi.cells && !halted; k++) await visit(u32(pg, u16(pg, pi.ptr + 2 * k)), depth + 1);
          if (!halted) await visit(pi.right, depth + 1);
        } else if (pi.type === 2) {
          for (k = 0; k < pi.cells && !halted; k++) {
            off = u16(pg, pi.ptr + 2 * k);
            await visit(u32(pg, off), depth + 1);
            if (halted) return;
            r = varint(pg, off + 4);
            var pl2 = await payload(pg, r[1], r[0], true);
            if ((await onRow({ rowid: null, values: decodeRecord(pl2.bytes, pl2.full) })) === false) { halted = true; return; }
          }
          if (!halted) await visit(pi.right, depth + 1);
        } else throw new Error('Unexpected page type ' + pi.type + ' at page ' + no + '. The file may be corrupt or encrypted.');
      }
      await visit(root, 0);
    }

    // Leaf index for paging: entries are leaf pages (or single interior cells of index trees).
    function ensureIndex(t) {
      if (t.idx) return t.idx.promise;
      var idx = t.idx = { pages: [], counts: [], cells: [], cum: [], total: 0, done: false, waiters: [] };
      var last = 0;
      function push(page, count, cell) {
        idx.cum.push(idx.total); idx.pages.push(page); idx.counts.push(count); idx.cells.push(cell);
        idx.total += count;
        idx.waiters = idx.waiters.filter(function (w) { if (idx.total >= w.need) { w.resolve(); return false; } return true; });
        var now = Date.now();
        if (now - last > 250) { last = now; post({ type: 'count', table: t.name, rows: idx.total, done: false }); }
      }
      async function visit(no, depth) {
        if (depth > 64) return;
        var pg = await readPage(no), pi = pageInfo(pg, no), k;
        if (pi.type === 13 || pi.type === 10) { push(no, pi.cells, -1); return; }
        if (pi.type === 5) { for (k = 0; k < pi.cells; k++) await visit(u32(pg, u16(pg, pi.ptr + 2 * k)), depth + 1); await visit(pi.right, depth + 1); return; }
        if (pi.type === 2) {
          for (k = 0; k < pi.cells; k++) { await visit(u32(pg, u16(pg, pi.ptr + 2 * k)), depth + 1); push(no, 1, k); }
          await visit(pi.right, depth + 1); return;
        }
        throw new Error('Unexpected page type ' + pi.type + ' at page ' + no);
      }
      idx.promise = visit(t.root, 0).then(function () {
        idx.done = true; t.rows = idx.total; t.exact = true;
        idx.waiters.forEach(function (w) { w.resolve(); }); idx.waiters = [];
        post({ type: 'count', table: t.name, rows: idx.total, done: true });
      }, function (err) {
        idx.done = true; idx.error = err;
        idx.waiters.forEach(function (w) { w.resolve(); }); idx.waiters = [];
        post({ type: 'count', table: t.name, rows: idx.total, done: true, error: err.message });
      });
      return idx.promise;
    }
    function waitRows(t, need) {
      ensureIndex(t);
      var idx = t.idx;
      if (idx.done || idx.total >= need) return Promise.resolve();
      return new Promise(function (resolve) { idx.waiters.push({ need: need, resolve: resolve }); });
    }

    async function sqlitePage(m) {
      var t = tables[m.table];
      if (!t) throw new Error('Unknown table');
      if (t.exact && t.rows === 0 && !t.root) { post({ type: 'page', id: m.id, table: m.table, start: 0, rows: [], total: 0 }); return; }
      var start = Math.max(0, m.start), limit = m.limit;
      await waitRows(t, start + limit);
      var idx = t.idx, rows = [];
      if (idx.error && !idx.total) throw idx.error;
      var lo = 0, hi = idx.pages.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (idx.cum[mid] <= start) lo = mid; else hi = mid - 1; }
      for (var e = lo; e < idx.pages.length && rows.length < limit; e++) {
        var no = idx.pages[e], pg = await readPage(no), pi = pageInfo(pg, no);
        var skip = Math.max(0, start - idx.cum[e]);
        if (idx.cells[e] >= 0) {
          if (skip) continue;
          var off0 = u16(pg, pi.ptr + 2 * idx.cells[e]);
          var r0 = varint(pg, off0 + 4), pl0 = await payload(pg, r0[1], r0[0], true);
          rows.push(finishRow(t, null, decodeRecord(pl0.bytes, pl0.full)));
          continue;
        }
        for (var k = skip; k < pi.cells && rows.length < limit; k++) {
          var off = u16(pg, pi.ptr + 2 * k), r = varint(pg, off), P = r[0], rowid = null;
          off = r[1];
          if (pi.type === 13) { r = varint(pg, off); rowid = r[0]; off = r[1]; }
          var pl = await payload(pg, off, P, pi.type === 10);
          rows.push(finishRow(t, rowid, decodeRecord(pl.bytes, pl.full)));
        }
      }
      post({ type: 'page', id: m.id, table: m.table, start: start, rows: rows, total: idx.done ? idx.total : null, counted: idx.total });
    }

    async function sqliteSearch(m, matcher, add, stop, progress) {
      var list = m.table ? [tables[m.table]] : order.map(function (k) { return tables[k]; });
      var scanned = 0;
      for (var k = 0; k < list.length && !stop(); k++) {
        var t = list[k];
        if (!t.root || (t.exact && t.rows === 0)) continue;
        var i = 0;
        await walkTree(t.root, function (r) {
          var row = finishRow(t, r.rowid, r.values);
          var c = rowHit(row, matcher, m.table ? m.col : -1);
          if (c >= 0) add(t.name, i, row, c);
          i++; scanned++;
          if ((scanned & 1023) === 0) progress(scanned);
          return !stop();
        }, stop);
      }
      progress(scanned);
    }
  }

  /* =======================================================================
     Main thread
     ======================================================================= */
  var PAGE_SIZES = [50, 100, 250, 500];
  var prefs = Object.assign({ pageSize: 100, mode: 'contains', cs: false }, U.store.get('sql', {}));
  function savePrefs() { U.store.set('sql', prefs); }

  // The open file survives navigating away and back; it lives at module level.
  var S = { worker: null, info: null, loading: null, table: null, start: 0, view: 'rows', search: null, listeners: null, reqs: {}, seq: 0, hl: -1, tableFilter: '' };

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
  }

  function startWorker() {
    if (S.worker) S.worker.terminate();
    var src = '(' + sqlWorker.toString() + ')()';
    S.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    S.worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'page' || (m.type === 'error' && S.reqs[m.id])) {
        var r = S.reqs[m.id]; delete S.reqs[m.id];
        if (r) { if (m.type === 'error') r.reject(new Error(m.message)); else r.resolve(m); }
        return;
      }
      if (S.listeners) S.listeners(m);
    };
    S.worker.onerror = function (e) { if (S.listeners) S.listeners({ type: 'error', message: e.message || 'The worker crashed' }); };
  }
  function request(msg) {
    return new Promise(function (resolve, reject) {
      var id = ++S.seq;
      S.reqs[id] = { resolve: resolve, reject: reject };
      msg.id = id;
      S.worker.postMessage(msg);
    });
  }

  function sampleDump() {
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    var first = ['Ana', 'Ben', 'Chloé', 'Dev', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jun', 'Kofi', 'Lena', 'Mateo', 'Nia', 'Oscar', 'Priya', 'Quinn', 'Rosa', 'Sven', 'Tariq', 'Uma', 'Vik', 'Wren', 'Yara', 'Zoe'];
    var last = ['Lopez', 'Smith', "O'Neil", 'Kim', 'Novak', 'Haddad', 'Okafor', 'Rossi', 'Tanaka', 'Müller', 'Silva', 'Brown', 'Patel', 'Nguyen', 'Jensen'];
    var cities = ['Bristol', 'Lisbon', 'Osaka', 'Toronto', 'Nairobi', 'Austin', 'Berlin', 'Melbourne', 'Seoul', 'Lima'];
    var products = [];
    var out = ['-- MySQL dump 10.13  Distrib 8.0.36 (sample generated by Utilities)', '-- Host: localhost    Database: shop', '', 'SET NAMES utf8mb4;', '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;', ''];
    out.push('DROP TABLE IF EXISTS `products`;', 'CREATE TABLE `products` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `sku` varchar(16) NOT NULL,\n  `name` varchar(120) NOT NULL,\n  `price` decimal(10,2) NOT NULL,\n  `stock` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `sku` (`sku`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', '');
    var adj = ['Classic', 'Organic', 'Compact', 'Deluxe', 'Recycled', 'Wireless', 'Vintage', 'Smart'];
    var noun = ['Mug', 'Lamp', 'Notebook', 'Backpack', 'Kettle', 'Headphones', 'Chair', 'Plant pot', 'Water bottle', 'Desk mat'];
    var rows = [];
    for (var p = 1; p <= 240; p++) {
      var nm = pick(adj) + ' ' + pick(noun);
      var price = (Math.round(rnd() * 15000) / 100 + 2).toFixed(2);
      products.push({ id: p, name: nm, price: +price });
      rows.push('(' + p + ",'SKU-" + (10000 + p) + "','" + nm + (p === 7 ? " \\\"Pro\\\" 12oz" : '') + "'," + price + ',' + (p % 17 === 0 ? 'NULL' : Math.floor(rnd() * 500)) + ')');
    }
    out.push('LOCK TABLES `products` WRITE;', 'INSERT INTO `products` VALUES ' + rows.join(',') + ';', 'UNLOCK TABLES;', '');
    out.push('DROP TABLE IF EXISTS `customers`;', 'CREATE TABLE `customers` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `name` varchar(100) NOT NULL,\n  `email` varchar(255) NOT NULL,\n  `city` varchar(60) DEFAULT NULL,\n  `joined` date NOT NULL,\n  `notes` text,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', '');
    var N = 25000;
    for (var b = 0; b < N; b += 500) {
      rows = [];
      for (var c = b + 1; c <= Math.min(N, b + 500); c++) {
        var f = pick(first), l = pick(last);
        var email = (f + '.' + l).toLowerCase().replace(/[^a-z.]/g, '') + c + '@example.com';
        var d = new Date(2019, 0, 1 + Math.floor(rnd() * 2400));
        var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var note = c % 97 === 0 ? "'Prefers delivery after 6pm;\\nleave at door'" : c % 13 === 0 ? 'NULL' : "''";
        rows.push('(' + c + ",'" + (f + ' ' + l).replace(/'/g, "\\'") + "','" + email + "','" + pick(cities) + "','" + date + "'," + note + ')');
      }
      out.push('INSERT INTO `customers` VALUES ' + rows.join(',') + ';');
    }
    out.push('', 'DROP TABLE IF EXISTS `orders`;', 'CREATE TABLE `orders` (\n  `id` bigint NOT NULL AUTO_INCREMENT,\n  `customer_id` int NOT NULL,\n  `product_id` int NOT NULL,\n  `qty` smallint NOT NULL DEFAULT 1,\n  `total` decimal(10,2) NOT NULL,\n  `status` enum(\'paid\',\'shipped\',\'refunded\') NOT NULL,\n  `created_at` datetime NOT NULL,\n  PRIMARY KEY (`id`),\n  KEY `customer_id` (`customer_id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', '');
    var O = 80000;
    for (var ob = 0; ob < O; ob += 1000) {
      rows = [];
      for (var o = ob + 1; o <= Math.min(O, ob + 1000); o++) {
        var pr = products[Math.floor(rnd() * products.length)], q = 1 + Math.floor(rnd() * 4);
        var dt = new Date(2023, 0, 1, 0, 0, Math.floor(rnd() * 60 * 60 * 24 * 660));
        var ts = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') + ':' + String(dt.getSeconds()).padStart(2, '0');
        rows.push('(' + o + ',' + (1 + Math.floor(rnd() * N)) + ',' + pr.id + ',' + q + ',' + (pr.price * q).toFixed(2) + ",'" + pick(['paid', 'paid', 'shipped', 'shipped', 'shipped', 'refunded']) + "','" + ts + "')");
      }
      out.push('INSERT INTO `orders` VALUES ' + rows.join(',') + ';');
    }
    out.push('', 'CREATE VIEW `big_orders` AS SELECT * FROM `orders` WHERE `total` > 300;', '', '-- Dump completed');
    return new File([out.join('\n') + '\n'], 'sample-shop.sql', { type: 'application/sql' });
  }

  U.register({
    id: 'sql',
    name: 'SQL viewer',
    desc: 'Open SQL dumps and SQLite databases of any size. Browse every table page by page and search the whole file.',
    hue: 210,
    icon: 'database',
    keywords: ['sql', 'database', 'dump', 'mysql', 'postgres', 'postgresql', 'sqlite', 'db', 'table', 'viewer', 'search', 'large', 'huge'],
    shortcuts: [['Search the open file', ['/']], ['Next / previous page', ['J', 'K']]],
    homeStat: function () {
      if (S.info) return '<span class="dot"></span>Open: <b>' + U.esc(S.info.name) + '</b> · ' + fmtBytes(S.info.size);
      var last = U.store.get('sql-last', null);
      return last ? '<span class="dot"></span>Last opened: <b>' + U.esc(last.name) + '</b> · ' + fmtBytes(last.size) : '';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('database') + '</span>SQL viewer</h1>' +
          '<p>Dumps from MySQL, MariaDB, PostgreSQL and SQLite, or SQLite database files. Streamed locally, so size is not a problem.</p>' +
        '</div><div class="tool-head-actions" id="sqlActions"></div></div>' +
        '<div id="sqlBody"></div>';
      var body = U.$('#sqlBody', root), actions = U.$('#sqlActions', root);
      var alive = true;

      function setActions() {
        actions.innerHTML = S.info || S.loading
          ? '<button class="btn btn-ghost btn-sm" data-act="open">' + U.icon('file') + 'Open another</button><button class="btn btn-ghost btn-sm" data-act="close">' + U.icon('x') + 'Close</button>'
          : '<button class="btn btn-ghost btn-sm" data-act="paste">' + U.icon('edit') + 'Paste SQL</button><button class="btn btn-soft btn-sm" data-act="open">' + U.icon('file') + 'Open file</button>';
      }

      /* ---------- Opening ---------- */
      function openFile(f) {
        if (!f) return;
        startWorker();
        S.info = null; S.table = null; S.start = 0; S.search = null; S.hl = -1; S.tableFilter = '';
        S.loading = { name: f.name || 'pasted.sql', size: f.size, done: 0, tables: 0, ms: 0, id: ++S.seq };
        S.listeners = onWorker;
        S.worker.postMessage({ type: 'open', id: S.loading.id, file: f });
        render();
      }

      function onWorker(m) {
        if (m.type === 'progress' && S.loading) {
          S.loading.done = m.done; S.loading.tables = m.tables; S.loading.ms = m.ms;
          if (alive) paintProgress();
        } else if (m.type === 'ready') {
          S.info = m.info; S.loading = null;
          U.store.set('sql-last', { name: m.info.name, size: m.info.size });
          var first = S.info.tables.slice().sort(function (a, b) { return (b.rows || 0) - (a.rows || 0); })[0];
          S.table = first ? first.name : null; S.start = 0; S.view = 'rows';
          if (alive) render();
          if (m.info.kind === 'dump') U.toast('Indexed ' + fmtBytes(m.info.size) + ' in ' + (m.info.ms / 1000).toFixed(1) + ' s');
        } else if (m.type === 'cancelled') {
          S.loading = null; S.info = null; if (alive) render();
        } else if (m.type === 'count') {
          var t = S.info && S.info.tables.filter(function (x) { return x.name === m.table; })[0];
          if (t) { t.rows = m.rows; t.exact = m.done && !m.error; if (m.error) t.note = 'Counting stopped: ' + m.error; }
          if (alive && S.info) { paintTableList(); if (m.table === S.table) paintPager(); }
        } else if (m.type === 'searchProgress' && S.search && m.id === S.search.id) {
          S.search.hits = S.search.hits.concat(m.hits); S.search.total = m.total; S.search.scanned = m.scanned;
          if (alive) paintSearch();
        } else if (m.type === 'searchDone' && S.search && m.id === S.search.id) {
          S.search.done = true; S.search.total = m.total; S.search.limited = m.limited; S.search.cancelled = m.cancelled;
          if (alive) paintSearch();
        } else if (m.type === 'error') {
          if (S.loading) { S.loading = null; S.info = null; if (alive) render(); }
          if (S.search && m.id === S.search.id) { S.search.done = true; S.search.error = m.message; if (alive) paintSearch(); return; }
          U.toast(m.message, { duration: 7000 });
        }
      }
      if (S.worker) S.listeners = onWorker;

      /* ---------- Rendering ---------- */
      function render() {
        setActions();
        if (S.loading) return renderLoading();
        if (!S.info) return renderEmpty();
        renderLoaded();
      }

      function renderEmpty() {
        body.innerHTML =
          '<section class="panel"><div class="panel-body" style="padding:22px">' +
            '<div class="drop sql-drop" id="sqlDrop" tabindex="0" role="button" aria-label="Open a SQL file">' +
              '<div class="tool-icon" style="margin:0 auto 12px;width:46px;height:46px">' + U.icon('database') + '</div>' +
              '<div style="font-size:15px;color:var(--text);font-weight:600">Drop a .sql dump or SQLite database here</div>' +
              '<div style="margin-top:4px">or <b>browse</b> for a file. Gigabyte files are fine: the file is streamed, never uploaded.</div>' +
            '</div>' +
            '<div class="sql-formats">' +
              '<div><b>MySQL / MariaDB</b><span>mysqldump, extended INSERTs</span></div>' +
              '<div><b>PostgreSQL</b><span>pg_dump plain format, COPY or INSERTs</span></div>' +
              '<div><b>SQLite</b><span>.dump output or .db / .sqlite files</span></div>' +
            '</div>' +
            '<div class="empty-actions" style="margin-top:16px"><button class="btn btn-soft" data-act="sample">' + U.icon('sparkles') + 'Generate a 105,000-row sample</button><button class="btn btn-ghost" data-act="paste">' + U.icon('edit') + 'Paste SQL instead</button></div>' +
          '</div></section>';
        var drop = U.$('#sqlDrop', body);
        drop.addEventListener('click', pick);
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
        drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); });
      }
      function pick() { U.pickFile('.sql,.txt,.db,.sqlite,.sqlite3,.db3,.dump,application/sql').then(openFile); }

      function renderLoading() {
        var L = S.loading;
        body.innerHTML = '<section class="panel"><div class="panel-body" style="padding:28px 24px">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><span class="tool-icon">' + U.icon('database') + '</span><div style="min-width:0;flex:1"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.esc(L.name) + '</div><div class="muted" style="font-size:13px" id="sqlProgText">Reading…</div></div>' +
          '<button class="btn btn-ghost btn-sm" data-act="cancelLoad">Cancel</button></div>' +
          '<div class="progress"><span id="sqlProgBar"></span></div>' +
          '<p class="muted" style="font-size:12.5px;margin:12px 0 0">Building an index of every table: row counts, byte offsets and a preview. The file itself is not kept in memory.</p>' +
          '</div></section>';
        paintProgress();
      }
      function paintProgress() {
        var L = S.loading, bar = U.$('#sqlProgBar', body), txt = U.$('#sqlProgText', body);
        if (!L || !bar) return;
        var pct = L.size ? L.done / L.size * 100 : 0;
        bar.style.width = pct.toFixed(1) + '%';
        var speed = L.ms > 300 ? L.done / (L.ms / 1000) : 0;
        var eta = speed ? (L.size - L.done) / speed : 0;
        txt.textContent = pct.toFixed(0) + '% · ' + fmtBytes(L.done) + ' of ' + fmtBytes(L.size) + (speed ? ' · ' + fmtBytes(speed) + '/s · ' + (eta > 1 ? Math.ceil(eta) + ' s left' : 'almost done') : '') + ' · ' + L.tables + (L.tables === 1 ? ' table' : ' tables') + ' found';
      }

      function renderLoaded() {
        var I = S.info;
        var totalRows = I.tables.reduce(function (a, t) { return a + (t.rows || 0); }, 0);
        var counting = I.tables.some(function (t) { return !t.exact; });
        body.innerHTML =
          '<section class="panel sql-searchbar">' +
            '<div class="search">' + U.icon('search') + '<input id="sqlQ" type="search" placeholder="Search every row, e.g. an email, id or name…" autocomplete="off" spellcheck="false" aria-label="Search rows"><kbd>/</kbd></div>' +
            '<select class="select-input" id="sqlScope" style="width:auto;max-width:220px" aria-label="Where to search"></select>' +
            '<select class="select-input" id="sqlCol" style="width:auto;max-width:180px" aria-label="Column"></select>' +
            '<div class="seg" id="sqlMode"><button data-v="contains">Contains</button><button data-v="exact">Exact</button><button data-v="regex">Regex</button></div>' +
            '<button class="icon-btn" id="sqlCase" title="Match case" aria-label="Match case" style="font:600 13px var(--mono)">Aa</button>' +
            '<button class="btn btn-primary" data-act="search">Search</button>' +
          '</section>' +
          '<div class="sql-layout">' +
            '<aside class="panel sql-side">' +
              '<div class="panel-body sql-file">' +
                '<div class="sql-file-name" title="' + U.esc(I.name) + '">' + U.esc(I.name) + '</div>' +
                '<div class="chips" style="margin-top:6px">' +
                  '<span class="badge accent">' + (I.kind === 'sqlite' ? 'SQLite database' : ({ mysql: 'MySQL dump', postgres: 'PostgreSQL dump', sqlite: 'SQLite dump', generic: 'SQL dump' })[I.dialect]) + '</span>' +
                  '<span class="badge">' + fmtBytes(I.size) + '</span>' +
                '</div>' +
                '<dl class="kv" style="margin-top:10px;font-size:12.5px"><dt>Tables</dt><dd>' + I.tables.length + '</dd><dt>Rows</dt><dd id="sqlTotalRows">' + U.fmtNum(totalRows, 0) + (counting ? '<span class="muted"> · counting…</span>' : '') + '</dd>' +
                  (I.statements != null ? '<dt>Statements</dt><dd>' + U.fmtNum(I.statements, 0) + '</dd>' : '') +
                  (I.schema.length ? '<dt>Other objects</dt><dd><button class="sql-link" data-act="objects">' + I.schema.length + ' (views, indexes…)</button></dd>' : '') +
                '</dl>' +
              '</div>' +
              '<div style="padding:0 12px 8px"><input class="text-input sm" id="sqlTf" placeholder="Filter tables" aria-label="Filter tables" value="' + U.esc(S.tableFilter) + '"></div>' +
              '<ul class="sql-tables" id="sqlTables"></ul>' +
            '</aside>' +
            '<section class="panel sql-main" id="sqlMain"></section>' +
          '</div>';

        var q = U.$('#sqlQ', body);
        if (S.search) q.value = S.search.q;
        q.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
          if (e.key === 'Escape' && (q.value || S.search)) { e.stopPropagation(); q.value = ''; clearSearch(); }
        });
        U.seg(U.$('#sqlMode', body), prefs.mode, function (v) { prefs.mode = v; savePrefs(); });
        var cs = U.$('#sqlCase', body);
        cs.setAttribute('aria-pressed', String(prefs.cs));
        cs.addEventListener('click', function () { prefs.cs = !prefs.cs; savePrefs(); cs.setAttribute('aria-pressed', String(prefs.cs)); });
        U.$('#sqlScope', body).addEventListener('change', paintColSelect);
        U.$('#sqlTf', body).addEventListener('input', function (e) { S.tableFilter = e.target.value; paintTableList(); });
        paintScope();
        paintTableList();
        paintMain();
      }

      function curTable() { return S.info && S.info.tables.filter(function (t) { return t.name === S.table; })[0]; }

      function paintScope() {
        var sel = U.$('#sqlScope', body); if (!sel) return;
        var t = curTable(), prev = sel.value;
        sel.innerHTML = '<option value="">All tables</option>' + (t ? '<option value="' + U.esc(t.name) + '">Table: ' + U.esc(t.name) + '</option>' : '');
        sel.value = prev && t && prev === t.name ? prev : '';
        paintColSelect();
      }
      function paintColSelect() {
        var sel = U.$('#sqlCol', body), scope = U.$('#sqlScope', body).value, t = curTable();
        sel.disabled = !scope;
        sel.innerHTML = '<option value="-1">Any column</option>' + (scope && t ? t.columns.map(function (c, i) { return '<option value="' + i + '">' + U.esc(c.name) + '</option>'; }).join('') : '');
      }

      function paintTableList() {
        var ul = U.$('#sqlTables', body); if (!ul) return;
        var f = S.tableFilter.trim().toLowerCase();
        var list = S.info.tables.filter(function (t) { return !f || t.name.toLowerCase().indexOf(f) !== -1; });
        ul.innerHTML = list.map(function (t) {
          return '<li><button class="sql-tbl" data-table="' + U.esc(t.name) + '" aria-current="' + (t.name === S.table && !S.search) + '">' +
            '<span class="n">' + U.esc(t.name) + '</span><span class="c">' + (t.rows == null ? '…' : U.fmtNum(t.rows, 0) + (t.exact ? '' : '+')) + '</span></button></li>';
        }).join('') || '<li class="muted" style="padding:6px 12px;font-size:13px">No tables match.</li>';
        var tr = U.$('#sqlTotalRows', body);
        if (tr) {
          var total = S.info.tables.reduce(function (a, t) { return a + (t.rows || 0); }, 0);
          var counting = S.info.tables.some(function (t) { return !t.exact; });
          tr.innerHTML = U.fmtNum(total, 0) + (counting ? '<span class="muted"> · counting…</span>' : '');
        }
      }

      function paintMain() {
        if (S.search) return paintSearch();
        var main = U.$('#sqlMain', body), t = curTable();
        if (!t) {
          main.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('database') + '</div><h3>No tables found</h3><p>This file has no CREATE TABLE or INSERT statements that could be read.' + (S.info.schema.length ? ' It does contain other objects such as views or indexes.' : '') + '</p></div>';
          return;
        }
        main.innerHTML =
          '<div class="panel-head"><div class="sql-title"><b>' + U.esc(t.name) + '</b><span class="badge">' + t.columns.length + ' columns</span><span class="badge" id="sqlRowBadge"></span></div>' +
          '<div class="seg" id="sqlView"><button data-v="rows">Rows</button><button data-v="schema">Schema</button></div></div>' +
          '<div id="sqlView-body"></div>';
        U.seg(U.$('#sqlView', main), S.view, function (v) { S.view = v; paintView(); });
        paintView();
      }

      function paintView() {
        var box = U.$('#sqlView-body', body), t = curTable();
        if (!box || !t) return;
        if (S.view === 'schema') {
          box.innerHTML = '<div class="panel-body">' +
            (t.note ? '<p style="color:var(--warn);font-size:13px;margin:0 0 12px">' + U.esc(t.note) + '</p>' : '') +
            (t.columns.length ? '<table class="sql-cols"><thead><tr><th>#</th><th>Column</th><th>Type</th><th>Constraints</th></tr></thead><tbody>' +
              t.columns.map(function (c, i) { return '<tr><td class="muted">' + (i + 1) + '</td><td class="mono">' + U.esc(c.name) + '</td><td class="mono">' + U.esc(c.type || '–') + '</td><td class="mono muted">' + U.esc(c.extra || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
            '<div class="section-label" style="margin:18px 0 8px;display:flex;align-items:center;justify-content:space-between">CREATE statement' + (t.createSql ? '<button class="icon-btn sm" data-act="copyCreate" aria-label="Copy CREATE statement">' + U.icon('copy') + '</button>' : '') + '</div>' +
            '<pre class="code-out" style="min-height:0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)">' + U.esc(t.createSql || 'No CREATE TABLE statement was found for this table. Columns were taken from the INSERT statements.') + '</pre></div>';
          paintPager();
          return;
        }
        box.innerHTML = '<div class="sql-grid-wrap" id="sqlGrid"><div class="sql-loading">Loading rows…</div></div><div class="panel-foot sql-pager" id="sqlPager"></div>';
        if (S.page && S.page.table === t.name && S.page.start === S.start && S.page.limit === prefs.pageSize) paintGrid();
        else loadPage();
        paintPager();
      }

      var pageReq = 0;
      function loadPage() {
        var t = curTable(); if (!t || !S.worker) return;
        var my = ++pageReq, grid = U.$('#sqlGrid', body);
        if (grid && !grid.querySelector('table')) grid.innerHTML = '<div class="sql-loading">Loading rows…</div>';
        else if (grid) grid.classList.add('busy');
        request({ type: 'page', table: t.name, start: S.start, limit: prefs.pageSize }).then(function (m) {
          if (my !== pageReq || !alive) return;
          S.page = { table: t.name, start: m.start, limit: prefs.pageSize, rows: m.rows, total: m.total };
          if (m.total != null && t.rows !== m.total) { t.rows = m.total; t.exact = true; paintTableList(); }
          paintGrid(); paintPager();
        }, function (err) {
          if (my !== pageReq || !alive) return;
          var g = U.$('#sqlGrid', body); if (g) g.innerHTML = '<div class="empty"><h3>Could not read these rows</h3><p>' + U.esc(err.message) + '</p></div>';
        });
      }

      function cellHtml(v, mark) {
        if (v === null || v === undefined) return '<td class="null">NULL</td>';
        if (typeof v === 'number') return '<td class="num">' + v + '</td>';
        if (typeof v === 'object') {
          if (v.b != null) return '<td class="blob" title="' + (v.h ? '0x' + v.h + (v.b > 48 ? '…' : '') : '') + '">BLOB · ' + fmtBytes(v.b) + '</td>';
          if (v.n != null) return '<td class="num">' + U.esc(v.n) + '</td>';
          return '<td class="raw">' + U.esc(v.raw) + '</td>';
        }
        var s = v.length > 160 ? v.slice(0, 160) + '…' : v;
        s = U.esc(s).replace(/\n/g, '<span class="nl">↵</span>');
        if (mark) s = mark(s);
        return '<td' + (v.length > 160 ? ' class="long"' : '') + '>' + (s === '' ? '<span class="muted">empty</span>' : s) + '</td>';
      }

      function paintGrid() {
        var grid = U.$('#sqlGrid', body), t = curTable(), P = S.page;
        if (!grid || !t || !P) return;
        grid.classList.remove('busy');
        if (!P.rows.length) {
          grid.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('database') + '</div><h3>' + (P.start ? 'No rows on this page' : 'This table is empty') + '</h3><p>' + (P.start ? 'Go back to an earlier page.' : 'It is defined in the file but has no rows.') + '</p></div>';
          return;
        }
        var width = Math.max(t.columns.length, P.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
        var head = '<tr><th class="rn">#</th>';
        for (var c = 0; c < width; c++) {
          var col = t.columns[c] || { name: 'column' + (c + 1), type: '' };
          head += '<th title="' + U.esc(col.type) + '">' + U.esc(col.name) + (col.type ? '<span>' + U.esc(col.type.length > 24 ? col.type.slice(0, 24) + '…' : col.type) + '</span>' : '') + '</th>';
        }
        head += '</tr>';
        var rows = P.rows.map(function (r, i) {
          var idx = P.start + i, cells = '';
          for (var c2 = 0; c2 < width; c2++) cells += cellHtml(r[c2]);
          return '<tr data-i="' + i + '"' + (idx === S.hl ? ' class="hl"' : '') + '><td class="rn">' + U.fmtNum(idx + 1, 0) + '</td>' + cells + '</tr>';
        }).join('');
        grid.innerHTML = '<table class="sql-grid"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
        var hl = grid.querySelector('tr.hl');
        if (hl) { hl.scrollIntoView({ block: 'center' }); }
        else grid.scrollTop = 0;
      }

      function paintPager() {
        var t = curTable(), pager = U.$('#sqlPager', body), badge = U.$('#sqlRowBadge', body);
        if (!t) return;
        var total = t.rows, exact = t.exact;
        if (badge) badge.textContent = total == null ? 'counting rows…' : U.fmtNum(total, 0) + (exact ? '' : '+') + (total === 1 ? ' row' : ' rows') + (exact ? '' : ' (counting…)');
        if (!pager) return;
        var ps = prefs.pageSize, from = S.start + 1, shown = S.page && S.page.table === t.name ? S.page.rows.length : 0;
        var to = S.start + (shown || ps);
        if (total != null && exact) to = Math.min(to, total);
        var lastStart = total ? Math.floor((total - 1) / ps) * ps : 0;
        var big = total != null && total > ps;
        pager.innerHTML =
          '<span>' + (total === 0 ? 'No rows' : 'Rows <b>' + U.fmtNum(from, 0) + '–' + U.fmtNum(to, 0) + '</b> of ' + (total == null ? '…' : U.fmtNum(total, 0) + (exact ? '' : '+'))) + '</span>' +
          (big ? '<span class="muted sql-hint">Large table: shown ' + ps + ' rows at a time. Search to find specific rows.</span>' : '') +
          '<span class="sql-pager-ctl">' +
            '<button class="icon-btn sm" data-pg="first" title="First page" aria-label="First page"' + (S.start === 0 ? ' disabled' : '') + '>«</button>' +
            '<button class="icon-btn sm" data-pg="prev" title="Previous page (K)" aria-label="Previous page"' + (S.start === 0 ? ' disabled' : '') + '>‹</button>' +
            '<button class="icon-btn sm" data-pg="next" title="Next page (J)" aria-label="Next page"' + ((exact && S.start + ps >= total) || (shown && shown < ps) ? ' disabled' : '') + '>›</button>' +
            '<button class="icon-btn sm" data-pg="last" title="Last page" aria-label="Last page"' + (!exact || S.start >= lastStart ? ' disabled' : '') + '>»</button>' +
            '<input class="text-input sm" id="sqlGoto" type="number" min="1" placeholder="Go to row" aria-label="Go to row" style="width:110px">' +
            '<select class="select-input sm" id="sqlPs" aria-label="Rows per page" style="width:auto">' + PAGE_SIZES.map(function (n) { return '<option value="' + n + '"' + (n === ps ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('') + '</select>' +
          '</span>';
        U.$('#sqlGoto', pager).addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          var n = parseInt(e.target.value, 10);
          if (!(n >= 1)) return;
          if (total != null && exact && n > total) { U.toast('This table has ' + U.fmtNum(total, 0) + ' rows'); return; }
          goRow(n - 1);
        });
        U.$('#sqlPs', pager).addEventListener('change', function (e) {
          prefs.pageSize = +e.target.value; savePrefs();
          S.start = Math.floor(S.start / prefs.pageSize) * prefs.pageSize;
          S.page = null; paintView();
        });
      }

      function goRow(idx) {
        S.hl = idx;
        S.start = Math.floor(idx / prefs.pageSize) * prefs.pageSize;
        S.page = null;
        if (S.view !== 'rows') { S.view = 'rows'; paintMain(); } else { paintPager(); loadPage(); }
      }
      function goPage(where) {
        var t = curTable(); if (!t) return;
        var ps = prefs.pageSize;
        if (where === 'first') S.start = 0;
        if (where === 'prev') S.start = Math.max(0, S.start - ps);
        if (where === 'next') { if (t.exact && S.start + ps >= t.rows) return; if (S.page && S.page.rows.length < ps) return; S.start += ps; }
        if (where === 'last' && t.exact) S.start = Math.max(0, Math.floor((t.rows - 1) / ps) * ps);
        S.hl = -1; paintPager(); loadPage();
      }

      function selectTable(name) {
        if (S.search) { S.search = null; var q = U.$('#sqlQ', body); if (q) q.value = ''; }
        S.table = name; S.start = 0; S.hl = -1; S.page = null;
        paintTableList(); paintScope(); paintMain();
      }

      /* ---------- Search ---------- */
      function runSearch() {
        var q = U.$('#sqlQ', body).value;
        if (!q.trim()) { clearSearch(); return; }
        if (prefs.mode === 'regex') { try { new RegExp(q); } catch (e) { U.toast('Invalid regex: ' + e.message); return; } }
        if (S.search && !S.search.done) S.worker.postMessage({ type: 'cancel', target: S.search.id });
        var scope = U.$('#sqlScope', body).value, col = +U.$('#sqlCol', body).value;
        var id = ++S.seq;
        S.search = { id: id, q: q, table: scope || null, col: scope ? col : -1, hits: [], total: 0, scanned: 0, done: false, t0: Date.now(), mode: prefs.mode, cs: prefs.cs };
        S.worker.postMessage({ type: 'search', id: id, q: q, table: scope || null, col: scope ? col : -1, mode: prefs.mode, cs: prefs.cs, limit: 1000 });
        paintTableList();
        U.$('#sqlMain', body).innerHTML = '';
        paintSearch();
      }
      function stopSearch() { if (S.search && !S.search.done) S.worker.postMessage({ type: 'cancel', target: S.search.id }); }
      function clearSearch() { stopSearch(); S.search = null; paintTableList(); paintMain(); }

      function markFn(q, mode, cs) {
        if (mode === 'regex') return null; // the matching cell is highlighted instead
        var esc = U.esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re2 = new RegExp(esc, cs ? 'g' : 'gi');
        return function (html) { return html.replace(re2, function (x) { return '<mark>' + x + '</mark>'; }); };
      }

      function paintSearch() {
        var main = U.$('#sqlMain', body), s = S.search;
        if (!main || !s) return;
        var I = S.info;
        var pct = s.table ? null : (I.kind === 'dump' ? (s.scanned / I.size * 100) : null);
        var status = s.error ? '<span style="color:var(--danger)">' + U.esc(s.error) + '</span>'
          : s.done ? (s.cancelled ? 'Stopped' : 'Done') + ' in ' + ((Date.now() - s.t0) / 1000).toFixed(1) + ' s'
          : 'Searching… ' + (pct != null ? pct.toFixed(0) + '% of the file' : U.fmtNum(s.scanned, 0) + ' rows scanned');
        var groups = {}, orderT = [];
        s.hits.forEach(function (h) { if (!groups[h.table]) { groups[h.table] = []; orderT.push(h.table); } groups[h.table].push(h); });
        var mark = markFn(s.q, s.mode, s.cs);
        var html = '<div class="panel-head"><div class="sql-title"><b>' + U.fmtNum(s.total, 0) + (s.total === 1 ? ' match' : ' matches') + '</b><span class="muted">for “' + U.esc(s.q) + '”' + (s.table ? ' in ' + U.esc(s.table) : '') + '</span></div>' +
          '<div class="panel-actions"><span class="muted" style="font-size:12.5px">' + status + '</span>' +
          (s.done ? '' : '<button class="btn btn-soft btn-sm" data-act="stopSearch">Stop</button>') +
          '<button class="btn btn-ghost btn-sm" data-act="clearSearch">' + U.icon('x') + 'Clear</button></div></div>' +
          (!s.done && pct != null ? '<div class="progress thin"><span style="width:' + pct.toFixed(1) + '%"></span></div>' : '');
        if (s.limited && s.done) html += '<div class="panel-foot" style="border-top:0;border-bottom:1px solid var(--border)">Showing the first ' + U.fmtNum(s.hits.length, 0) + ' matches' + (s.total > s.hits.length ? ' of ' + U.fmtNum(s.total, 0) : '') + '. Make the search more specific, or limit it to one table or column.</div>';
        if (!orderT.length) {
          html += s.done ? '<div class="empty"><div class="empty-art">' + U.icon('search') + '</div><h3>No matches</h3><p>Nothing in ' + (s.table ? 'this table' : 'the file') + ' ' + (s.mode === 'exact' ? 'equals' : s.mode === 'regex' ? 'matches' : 'contains') + ' “' + U.esc(s.q) + '”' + (s.cs ? ' (case-sensitive)' : '') + '.</p></div>' : '<div class="sql-loading">Scanning…</div>';
        }
        orderT.forEach(function (tn) {
          var t = I.tables.filter(function (x) { return x.name === tn; })[0] || { columns: [] };
          var hs = groups[tn];
          var width = Math.max(t.columns.length, hs.reduce(function (m, h) { return Math.max(m, h.values.length); }, 0));
          var head = '<tr><th class="rn">Row</th>';
          for (var c = 0; c < width; c++) head += '<th>' + U.esc((t.columns[c] || { name: 'column' + (c + 1) }).name) + '</th>';
          html += '<div class="sql-group"><div class="sql-group-head"><button class="sql-link" data-table="' + U.esc(tn) + '"><b>' + U.esc(tn) + '</b></button><span class="muted">' + hs.length + (hs.length === 1 ? ' match' : ' matches') + (s.done ? '' : '…') + '</span></div>' +
            '<div class="sql-grid-wrap" style="max-height:420px"><table class="sql-grid"><thead>' + head + '</tr></thead><tbody>' +
            hs.slice(0, 300).map(function (h) {
              var cells = '';
              for (var c2 = 0; c2 < width; c2++) {
                var cell = cellHtml(h.values[c2], c2 === h.col ? mark : null);
                if (c2 === h.col) cell = cell.replace('<td', '<td data-hit="1"');
                cells += cell;
              }
              return '<tr class="hit" data-goto-table="' + U.esc(tn) + '" data-goto-row="' + h.row + '" title="Open row ' + (h.row + 1) + ' in ' + U.esc(tn) + '"><td class="rn"><span class="sql-link">' + U.fmtNum(h.row + 1, 0) + ' →</span></td>' + cells + '</tr>';
            }).join('') + '</tbody></table></div>' +
            (hs.length > 300 ? '<div class="panel-foot">' + (hs.length - 300) + ' more matches in this table. Search within this table to see them.</div>' : '') +
            '</div>';
        });
        main.innerHTML = html;
      }

      /* ---------- Cell detail ---------- */
      function showCell(table, colIdx, value, rowNo) {
        var t = S.info.tables.filter(function (x) { return x.name === table; })[0];
        var col = (t && t.columns[colIdx]) || { name: 'column' + (colIdx + 1), type: '' };
        var text, pretty = null;
        if (value == null) text = 'NULL';
        else if (typeof value === 'object') text = value.b != null ? 'BLOB, ' + value.b + ' bytes\n\nFirst bytes (hex):\n' + (value.h || '').replace(/(.{2})/g, '$1 ').trim() : (value.n != null ? value.n : value.raw);
        else text = String(value);
        if (typeof value === 'string' && /^\s*[\[{]/.test(value)) { try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch (e) {} }
        var bodyEl = U.h('<div><div class="chips" style="margin-bottom:10px"><span class="badge">' + U.esc(table) + '</span><span class="badge">Row ' + U.fmtNum(rowNo + 1, 0) + '</span>' + (col.type ? '<span class="badge">' + U.esc(col.type) + '</span>' : '') + (typeof value === 'string' ? '<span class="badge">' + U.fmtNum(value.length, 0) + ' chars</span>' : '') + '</div>' +
          '<pre class="code-out wrap" style="min-height:0;max-height:55vh;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)"></pre></div>');
        U.$('pre', bodyEl).textContent = pretty || text;
        U.modal({ title: col.name, size: 'lg', body: bodyEl, actions: (pretty ? [{ label: 'Copy formatted JSON', kind: 'btn-ghost', onClick: function () { U.copy(pretty, 'JSON'); return false; } }] : []).concat([{ label: 'Copy value', kind: 'btn-primary', onClick: function () { U.copy(text, 'Value'); return false; } }]) });
      }

      function showObjects() {
        var objs = S.info.schema;
        var bodyEl = U.h('<div>' + objs.map(function (o) {
          return '<details class="sql-obj"><summary><span class="badge">' + U.esc(o.what) + '</span> <b class="mono">' + U.esc(o.name || '') + '</b></summary><pre class="code-out wrap" style="min-height:0;max-height:300px">' + U.esc(o.sql) + '</pre></details>';
        }).join('') + '</div>');
        U.modal({ title: 'Views, indexes and other objects', size: 'lg', body: bodyEl });
      }

      function pasteDialog() {
        var bodyEl = U.h('<div><p class="confirm-text" style="margin-bottom:10px">Paste a SQL dump or any CREATE TABLE and INSERT statements.</p><textarea class="text-area mono" id="sqlPaste" style="min-height:240px;font:12.5px/1.5 var(--mono)" spellcheck="false" placeholder="CREATE TABLE users (id INT, email TEXT);&#10;INSERT INTO users VALUES (1, \'ana@example.com\');"></textarea></div>');
        U.modal({ title: 'Paste SQL', size: 'lg', body: bodyEl, actions: [
          { label: 'Cancel', kind: 'btn-ghost' },
          { label: 'Open', kind: 'btn-primary', onClick: function () {
            var v = U.$('#sqlPaste', bodyEl).value;
            if (!v.trim()) return false;
            openFile(new File([v], 'pasted.sql', { type: 'application/sql' }));
          } }
        ] });
      }

      function closeFile() {
        if (S.worker) S.worker.terminate();
        S.worker = null; S.info = null; S.loading = null; S.search = null; S.page = null; S.table = null;
        render();
      }

      /* ---------- Events ---------- */
      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          var act = a.dataset.act;
          if (act === 'open') pick();
          if (act === 'paste') pasteDialog();
          if (act === 'close') closeFile();
          if (act === 'sample') { U.toast('Generating sample…'); setTimeout(function () { openFile(sampleDump()); }, 30); }
          if (act === 'cancelLoad' && S.loading) { S.worker.postMessage({ type: 'cancel', target: S.loading.id }); }
          if (act === 'search') runSearch();
          if (act === 'stopSearch') stopSearch();
          if (act === 'clearSearch') { var q = U.$('#sqlQ', body); if (q) q.value = ''; clearSearch(); }
          if (act === 'objects') showObjects();
          if (act === 'copyCreate') { var t = curTable(); if (t) U.copy(t.createSql, 'CREATE statement'); }
          return;
        }
        var tb = e.target.closest('[data-table]');
        if (tb) { selectTable(tb.dataset.table); return; }
        var pg = e.target.closest('[data-pg]');
        if (pg && !pg.disabled) { goPage(pg.dataset.pg); return; }
        var hitRow = e.target.closest('tr[data-goto-row]');
        if (hitRow) {
          var td = e.target.closest('td');
          if (td && !td.classList.contains('rn')) {
            var hs = S.search.hits.filter(function (h) { return h.table === hitRow.dataset.gotoTable && h.row === +hitRow.dataset.gotoRow; })[0];
            var ci = Array.prototype.indexOf.call(hitRow.children, td) - 1;
            if (hs) { showCell(hs.table, ci, hs.values[ci], hs.row); return; }
          }
          var tn = hitRow.dataset.gotoTable, row = +hitRow.dataset.gotoRow;
          S.search = null;
          S.table = tn; paintTableList(); paintScope();
          S.view = 'rows'; S.page = null;
          S.hl = row; S.start = Math.floor(row / prefs.pageSize) * prefs.pageSize;
          paintMain();
          return;
        }
        var cell = e.target.closest('#sqlGrid td');
        if (cell && !cell.classList.contains('rn') && S.page) {
          var tr = cell.parentElement, i = +tr.dataset.i, c = Array.prototype.indexOf.call(tr.children, cell) - 1;
          showCell(S.page.table, c, S.page.rows[i][c], S.page.start + i);
        }
      });

      function onKey(e) {
        if (!S.info || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open')) return;
        if (U.isTyping(e.target)) return;
        if (e.key === '/') { e.preventDefault(); var q = U.$('#sqlQ', body); if (q) { q.focus(); q.select(); } }
        if (!S.search && S.view === 'rows') {
          if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); goPage('next'); }
          if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); goPage('prev'); }
        }
      }
      document.addEventListener('keydown', onKey);

      // Drop a file anywhere on the tool to open it.
      function onDragOver(e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) e.preventDefault(); }
      function onDrop(e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && !e.defaultPrevented) { e.preventDefault(); openFile(f); } }
      root.addEventListener('dragover', onDragOver);
      root.addEventListener('drop', onDrop);

      render();
      if (S.info && S.table && !S.search) { /* page restored by paintView */ }
      return function () { alive = false; document.removeEventListener('keydown', onKey); };
    }
  });
})();
