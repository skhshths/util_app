/* =========================================================================
   Formats: dependency-free parsers and serialisers used by the JSON tool.
   - parseJSON(text, { loose })  strict JSON with precise errors, or a lenient
                                 parser that repairs common mistakes
   - parseYAML(text) / toYAML(value)
   - parseCSV(text, { delimiter, types }) / toCSV(value, { delimiter })
   - jsonPath(expr, root)        a practical JSONPath subset
   ========================================================================= */
(function () {
  'use strict';

  var F = {};

  /* ---------- Shared ---------- */
  function lineCol(src, pos) {
    var line = 1, col = 1;
    for (var i = 0; i < pos && i < src.length; i++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
    }
    return { line: line, col: col };
  }
  F.lineCol = lineCol;

  function fail(msg, src, pos) {
    var lc = lineCol(src, pos);
    var e = new SyntaxError(msg);
    e.pos = pos; e.line = lc.line; e.col = lc.col;
    return e;
  }

  /* =======================================================================
     JSON (strict or loose)
     ======================================================================= */
  var FIX_LABELS = {
    comment: 'comments removed',
    single: 'single quotes converted',
    unquotedKey: 'unquoted keys quoted',
    trailingComma: 'trailing commas removed',
    missingComma: 'missing commas added',
    literal: 'Python/JS literals converted',
    number: 'numbers normalised',
    control: 'raw line breaks in strings escaped',
    escape: 'invalid escapes fixed',
    multipleRoots: 'multiple values wrapped in an array',
    unclosed: 'unclosed brackets closed'
  };
  var STRICT_MSG = {
    comment: 'Comments are not allowed in JSON',
    single: 'Strings must use double quotes',
    unquotedKey: 'Property names must be in double quotes',
    trailingComma: 'Trailing comma',
    missingComma: 'Missing comma',
    literal: 'Unknown literal',
    number: 'Invalid number',
    control: 'Unescaped line break or control character in string',
    escape: 'Invalid escape sequence',
    multipleRoots: 'Unexpected content after the end of the JSON value',
    unclosed: 'Unexpected end of input'
  };

  F.parseJSON = function (src, opts) {
    var loose = !!(opts && opts.loose);
    var i = 0, n = src.length, fixes = {};

    function note(kind, at) {
      if (!loose) throw fail(STRICT_MSG[kind], src, at == null ? i : at);
      fixes[kind] = (fixes[kind] || 0) + 1;
    }
    function ws() {
      for (;;) {
        var c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') { i++; continue; }
        if (c === '/' && src[i + 1] === '/') { note('comment'); while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') {
          note('comment');
          var end = src.indexOf('*/', i + 2);
          i = end === -1 ? n : end + 2; continue;
        }
        if (c === '#' && loose) { note('comment'); while (i < n && src[i] !== '\n') i++; continue; }
        break;
      }
    }
    function isIdStart(c) { return c != null && /[A-Za-z_$]/.test(c); }
    function readIdent() { var s = i; while (i < n && /[\w$]/.test(src[i])) i++; return src.slice(s, i); }

    function value() {
      ws();
      if (i >= n) {
        if (loose) { note('unclosed'); return null; }
        throw fail('Unexpected end of input', src, i);
      }
      var c = src[i];
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === '"') return string('"');
      if (c === "'") { note('single'); return string("'"); }
      if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) return number();
      if (isIdStart(c)) {
        var at = i, id = readIdent();
        if (id === 'true') return true;
        if (id === 'false') return false;
        if (id === 'null') return null;
        var map = { True: true, False: false, None: null, undefined: null, NaN: null, Infinity: null, nil: null };
        if (id in map) { note('literal', at); return map[id]; }
        throw fail('Unexpected token "' + id + '"' + (loose ? '' : '. Strings must be quoted'), src, at);
      }
      throw fail('Unexpected character "' + c + '"', src, i);
    }

    function object() {
      var obj = {}, start = i; i++;
      ws();
      if (src[i] === '}') { i++; return obj; }
      for (;;) {
        ws();
        if (i >= n) { if (loose) { note('unclosed'); return obj; } throw fail('Unclosed object (opened here)', src, start); }
        var key, c = src[i];
        if (c === '"') key = string('"');
        else if (c === "'") { note('single'); key = string("'"); }
        else if (isIdStart(c) || (c >= '0' && c <= '9')) { note('unquotedKey'); var s = i; while (i < n && /[\w$\-]/.test(src[i])) i++; key = src.slice(s, i); }
        else if (c === '}' ) { note('trailingComma'); i++; return obj; }
        else throw fail('Expected a property name in double quotes', src, i);
        ws();
        if (src[i] !== ':') {
          if (loose && src[i] === '=') { note('literal'); }
          else throw fail('Expected ":" after property name "' + key + '"', src, i);
        }
        i++;
        obj[key] = value();
        ws();
        c = src[i];
        if (c === ',') {
          i++; ws();
          if (src[i] === '}') { note('trailingComma'); i++; return obj; }
          continue;
        }
        if (c === '}') { i++; return obj; }
        if (i >= n) { if (loose) { note('unclosed'); return obj; } throw fail('Unclosed object (opened here)', src, start); }
        if (loose && (c === '"' || c === "'" || isIdStart(c))) { note('missingComma'); continue; }
        throw fail('Expected "," or "}" after property value', src, i);
      }
    }

    function array() {
      var arr = [], start = i; i++;
      ws();
      if (src[i] === ']') { i++; return arr; }
      for (;;) {
        ws();
        if (src[i] === ']') { note('trailingComma'); i++; return arr; }
        if (i >= n) { if (loose) { note('unclosed'); return arr; } throw fail('Unclosed array (opened here)', src, start); }
        arr.push(value());
        ws();
        var c = src[i];
        if (c === ',') { i++; continue; }
        if (c === ']') { i++; return arr; }
        if (i >= n) { if (loose) { note('unclosed'); return arr; } throw fail('Unclosed array (opened here)', src, start); }
        if (loose && c !== '}' && c !== ':') { note('missingComma'); continue; }
        throw fail('Expected "," or "]" after array item', src, i);
      }
    }

    function string(q) {
      var start = i, out = '';
      i++;
      for (;;) {
        if (i >= n) throw fail('Unterminated string (starts here)', src, start);
        var c = src[i];
        if (c === q) { i++; return out; }
        if (c === '\\') {
          var e = src[i + 1];
          var simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (e in simple) { out += simple[e]; i += 2; continue; }
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.substr(i + 2, 4))) { out += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
          if (e === "'") { note('escape', i); out += "'"; i += 2; continue; }
          if (e === '\n') { note('escape', i); i += 2; continue; }
          note('escape', i); out += e == null ? '' : e; i += 2; continue;
        }
        if (c < ' ') {
          note('control', i);
          out += c; i++; continue;
        }
        out += c; i++;
      }
    }

    function number() {
      var rest = src.slice(i);
      var strict = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
      var lenient = /^[+-]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(rest);
      if (lenient && (!strict || lenient[0].length > strict[0].length || lenient[0] !== strict[0])) {
        // Also catches leading zeros like 007, which strict JSON rejects.
        if (!strict || /^[+-]?0\d/.test(lenient[0]) || lenient[0].length !== strict[0].length) {
          note('number');
          var s = lenient[0]; i += s.length;
          var neg = s[0] === '-'; s = s.replace(/^[+-]/, '');
          var v = /^0[xX]/.test(s) ? parseInt(s, 16) : parseFloat(s);
          return neg ? -v : v;
        }
      }
      if (!strict) throw fail('Invalid number', src, i);
      // Leading zeros: "0123" parses strict as "0" followed by junk.
      if (/^-?0\d/.test(rest)) { note('number'); var m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest)[0]; i += m.length; return parseFloat(m); }
      i += strict[0].length;
      return parseFloat(strict[0]);
    }

    ws();
    if (i >= n) throw fail('Input is empty', src, 0);
    var result = value();
    ws();
    if (i < n) {
      if (!loose) throw fail('Unexpected content after the end of the JSON value', src, i);
      var many = [result];
      while (i < n) {
        if (src[i] === ',') { i++; ws(); if (i >= n) break; }
        many.push(value()); ws();
      }
      note('multipleRoots');
      result = many;
    }
    var labels = Object.keys(fixes).map(function (k) { return FIX_LABELS[k] + (fixes[k] > 1 ? ' (' + fixes[k] + ')' : ''); });
    return { value: result, fixes: labels };
  };

  /* =======================================================================
     YAML (a practical subset of YAML 1.2)
     Supports block maps and sequences, flow [..] and {..}, quoted and plain
     scalars, multi-line plain scalars, block scalars (| and > with chomping),
     comments, anchors and aliases, merge keys (<<) and the first document.
     ======================================================================= */
  F.parseYAML = function (src) {
    var lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
    var i = 0, anchors = {};

    function isBlank(l) { return /^\s*(#.*)?$/.test(l); }
    function indentOf(l) { return l.match(/^ */)[0].length; }
    function skipBlank() { while (i < lines.length && isBlank(lines[i])) i++; }
    function err(msg, li) { var e = new SyntaxError(msg); e.line = (li == null ? i : li) + 1; e.col = 1; return e; }
    function posOfLine(li) { var p = 0; for (var k = 0; k < li && k < lines.length; k++) p += lines[k].length + 1; return p; }

    // Strip a trailing " # comment" outside quotes.
    function stripComment(s) {
      var q = null;
      for (var k = 0; k < s.length; k++) {
        var c = s[k];
        if (q) { if (c === q) { if (q === "'" && s[k + 1] === "'") { k++; continue; } q = null; } else if (c === '\\' && q === '"') k++; continue; }
        if (c === '"' || c === "'") { if (k === 0 || /[\s\[{,:]/.test(s[k - 1])) q = c; continue; }
        if (c === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).replace(/\s+$/, '');
      }
      return s.replace(/\s+$/, '');
    }

    // Index of the ":" that separates key and value, or -1.
    function keySep(s) {
      if (s[0] === '[' || s[0] === '{') return -1;
      var k = 0;
      if (s[0] === '"' || s[0] === "'") {
        var q = s[0]; k = 1;
        while (k < s.length) {
          if (s[k] === '\\' && q === '"') { k += 2; continue; }
          if (s[k] === q) { if (q === "'" && s[k + 1] === "'") { k += 2; continue; } break; }
          k++;
        }
        k++;
        while (s[k] === ' ') k++;
        return s[k] === ':' && (k + 1 === s.length || s[k + 1] === ' ') ? k : -1;
      }
      for (; k < s.length; k++) {
        if (s[k] === '#' && k > 0 && s[k - 1] === ' ') return -1;
        if (s[k] === ':' && (k + 1 === s.length || s[k + 1] === ' ')) return k;
      }
      return -1;
    }

    function parseKey(raw) {
      raw = raw.trim();
      if (raw[0] === '"') return F.parseJSON(raw).value;
      if (raw[0] === "'") return raw.slice(1, -1).replace(/''/g, "'");
      return raw;
    }

    function scalar(s) {
      if (s === '' || s === '~' || /^(null|Null|NULL)$/.test(s)) return null;
      if (/^(true|True|TRUE)$/.test(s)) return true;
      if (/^(false|False|FALSE)$/.test(s)) return false;
      if (/^[-+]?(0|[1-9][\d_]*)$/.test(s)) { var v = Number(s.replace(/_/g, '')); if (Number.isSafeInteger(v)) return v; return s; }
      if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
      if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
      if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
      if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s[0] === '-' ? -Infinity : Infinity;
      if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN;
      return s;
    }

    // Flow collections: [a, b] and {a: 1}
    function parseFlow(text, li) {
      var p = 0;
      function sp() { while (p < text.length && /[\s]/.test(text[p])) p++; }
      function val(inMap) {
        sp();
        var c = text[p];
        if (c === '[') {
          p++; var arr = [];
          for (;;) {
            sp();
            if (text[p] === ']') { p++; return arr; }
            if (p >= text.length) throw err('Unclosed "[" in flow sequence', li);
            arr.push(val(false)); sp();
            if (text[p] === ',') { p++; continue; }
            if (text[p] === ']') { p++; return arr; }
            throw err('Expected "," or "]" in flow sequence', li);
          }
        }
        if (c === '{') {
          p++; var obj = {};
          for (;;) {
            sp();
            if (text[p] === '}') { p++; return obj; }
            if (p >= text.length) throw err('Unclosed "{" in flow mapping', li);
            var k = val(true); sp();
            var v = null;
            if (text[p] === ':') { p++; v = val(false); sp(); }
            obj[k == null ? 'null' : String(k)] = v;
            if (text[p] === ',') { p++; continue; }
            if (text[p] === '}') { p++; return obj; }
            throw err('Expected "," or "}" in flow mapping', li);
          }
        }
        if (c === '"') {
          var s = p; p++;
          while (p < text.length && text[p] !== '"') { if (text[p] === '\\') p++; p++; }
          p++;
          return F.parseJSON(text.slice(s, p).replace(/\n\s*/g, ' ')).value;
        }
        if (c === "'") {
          var out = ''; p++;
          while (p < text.length) {
            if (text[p] === "'") { if (text[p + 1] === "'") { out += "'"; p += 2; continue; } break; }
            out += text[p++];
          }
          p++;
          return out;
        }
        var st = p;
        while (p < text.length && !/[,\]}]/.test(text[p]) && !(inMap && text[p] === ':' && /[\s,\]}]/.test(text[p + 1] || ' '))) p++;
        var raw = text.slice(st, p).trim().replace(/\s+/g, ' ');
        if (raw[0] === '*') return anchors[raw.slice(1)];
        return scalar(raw);
      }
      var result = val(false);
      sp();
      if (p < text.length) throw err('Unexpected text after flow collection', li);
      return result;
    }

    function balanced(text) {
      var depth = 0, q = null;
      for (var k = 0; k < text.length; k++) {
        var c = text[k];
        if (q) { if (c === '\\' && q === '"') k++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') depth--;
      }
      return depth <= 0;
    }

    function blockScalar(header, parentIndent) {
      var style = header[0];
      var chomp = /-/.test(header) ? 'strip' : /\+/.test(header) ? 'keep' : 'clip';
      var explicit = /\d/.exec(header);
      var collected = [], blockIndent = explicit ? parentIndent + +explicit[0] : null;
      while (i < lines.length) {
        var l = lines[i];
        if (/^\s*$/.test(l)) { collected.push(''); i++; continue; }
        var ind = indentOf(l);
        if (blockIndent == null) { if (ind <= parentIndent) break; blockIndent = ind; }
        if (ind < blockIndent) break;
        collected.push(l.slice(blockIndent));
        i++;
      }
      var trailing = 0;
      while (collected.length && collected[collected.length - 1] === '') { collected.pop(); trailing++; }
      var body;
      if (style === '|') body = collected.join('\n');
      else {
        body = '';
        for (var k = 0; k < collected.length; k++) {
          var line = collected[k], prev = collected[k - 1];
          if (k === 0) body = line;
          else if (line === '') body += '\n';
          else if (prev === '' || /^\s/.test(line) || /^\s/.test(prev)) body += (prev === '' ? '' : '\n') + line;
          else body += ' ' + line;
        }
      }
      if (!collected.length) return '';
      if (chomp === 'clip') body += '\n';
      else if (chomp === 'keep') body += '\n' + new Array(trailing + 1).join('\n');
      return body;
    }

    // Parses a value that starts inline (after "key:" or "- ").
    function inlineValue(rest, ownerIndent) {
      var anchor = null;
      rest = rest.replace(/^!!?[\w\-]+\s*/, '');
      var am = /^&([^\s]+)\s*/.exec(rest);
      if (am) { anchor = am[1]; rest = rest.slice(am[0].length); }
      var value;
      if (rest === '' || rest[0] === '#') {
        i++;
        value = nestedOrNull(ownerIndent);
      } else if (rest[0] === '*') {
        i++;
        var name = stripComment(rest).slice(1);
        if (!(name in anchors)) throw err('Unknown alias "*' + name + '"', i - 1);
        value = anchors[name];
      } else if (rest[0] === '|' || rest[0] === '>') {
        i++;
        value = blockScalar(stripComment(rest), ownerIndent);
      } else if (rest[0] === '[' || rest[0] === '{') {
        var startLine = i, text = stripComment(rest);
        i++;
        while (!balanced(text) && i < lines.length) { text += '\n' + stripComment(lines[i]); i++; }
        value = parseFlow(text, startLine);
      } else if (rest[0] === '"' || rest[0] === "'") {
        var q = rest[0], startL = i, buf = rest;
        var closed = function (s) {
          for (var k = 1; k < s.length; k++) {
            if (q === '"' && s[k] === '\\') { k++; continue; }
            if (s[k] === q) { if (q === "'" && s[k + 1] === "'") { k++; continue; } return k; }
          }
          return -1;
        };
        i++;
        while (closed(buf) === -1 && i < lines.length) { buf += '\n' + lines[i].trim(); i++; }
        var end = closed(buf);
        if (end === -1) throw err('Unterminated quoted string', startL);
        var inner = buf.slice(0, end + 1).replace(/\n/g, ' ');
        value = q === '"' ? F.parseJSON(inner.replace(/\t/g, '\\t')).value : inner.slice(1, -1).replace(/''/g, "'");
      } else {
        var text2 = stripComment(rest);
        i++;
        // Multi-line plain scalar: continuation lines indented deeper than the owner.
        while (i < lines.length && !isBlank(lines[i]) && indentOf(lines[i]) > ownerIndent) {
          var t = lines[i].trim();
          if (keySep(t) !== -1 || /^-( |$)/.test(t)) break;
          text2 += ' ' + stripComment(t); i++;
        }
        value = scalar(text2);
      }
      if (anchor) anchors[anchor] = value;
      return value;
    }

    function nestedOrNull(ownerIndent) {
      skipBlank();
      if (i >= lines.length) return null;
      var ind = indentOf(lines[i]);
      if (ind > ownerIndent) return node(ind);
      if (ind === ownerIndent && /^-( |$)/.test(lines[i].slice(ind))) return seq(ind);
      return null;
    }

    function node(minIndent) {
      skipBlank();
      if (i >= lines.length) return null;
      var l = lines[i], ind = indentOf(l);
      if (ind < minIndent) return null;
      var content = l.slice(ind);
      if (/^-( |$)/.test(content)) return seq(ind);
      if (keySep(content) !== -1) return map(ind);
      return inlineValue(content, ind - 1);
    }

    function map(ind) {
      var obj = {};
      for (;;) {
        skipBlank();
        if (i >= lines.length || isDocEnd(lines[i])) break;
        var l = lines[i], li = indentOf(l);
        if (li < ind) break;
        if (li > ind) throw err('Bad indentation: expected ' + ind + ' spaces, found ' + li);
        var content = l.slice(ind);
        if (/^-( |$)/.test(content)) break;
        var k = keySep(content);
        if (k === -1) throw err('Expected "key: value"');
        var key = parseKey(content.slice(0, k));
        var rest = content.slice(k + 1).replace(/^ +/, '');
        var v = inlineValue(rest, ind);
        if (key === '<<') {
          [].concat(v).forEach(function (src) { if (src && typeof src === 'object') Object.keys(src).forEach(function (kk) { if (!(kk in obj)) obj[kk] = src[kk]; }); });
        } else obj[key] = v;
      }
      return obj;
    }

    function seq(ind) {
      var arr = [];
      for (;;) {
        skipBlank();
        if (i >= lines.length || isDocEnd(lines[i])) break;
        var l = lines[i], li = indentOf(l);
        if (li !== ind || !/^-( |$)/.test(l.slice(ind))) {
          if (li > ind) throw err('Bad indentation in list');
          break;
        }
        var after = l.slice(ind + 1);
        var spaces = after.match(/^ */)[0].length;
        var rest = after.slice(spaces);
        var col = ind + 1 + spaces;
        if (rest !== '' && rest[0] !== '#' && (/^-( |$)/.test(rest) || keySep(rest) !== -1) && !/^[&*!|>]/.test(rest)) {
          // "- key: value" or "- - x": re-indent this line and parse a nested node there.
          lines[i] = new Array(col + 1).join(' ') + rest;
          arr.push(node(col));
        } else {
          arr.push(inlineValue(rest, ind));
        }
      }
      return arr;
    }

    function isDocEnd(l) { return /^(---|\.\.\.)(\s|$)/.test(l); }

    // Skip directives and the first document marker.
    skipBlank();
    while (i < lines.length && /^%/.test(lines[i])) { i++; skipBlank(); }
    if (i < lines.length && /^---(\s|$)/.test(lines[i])) {
      var after = lines[i].slice(3).trim();
      if (after && after[0] !== '#') lines[i] = after; else i++;
    }
    skipBlank();
    if (i >= lines.length) return null;
    var result = node(0);
    skipBlank();
    if (i < lines.length && !isDocEnd(lines[i])) {
      throw err('Unexpected content (check the indentation)');
    }
    void posOfLine;
    return result;
  };

  function yamlNeedsQuotes(s) {
    if (s === '') return true;
    if (/^[\s]|[\s]$/.test(s)) return true;
    if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return true;
    if (/: |:$| #|\t/.test(s)) return true;
    if (/[\u0000-\u001f\u007f]/.test(s)) return true;
    var asScalar;
    try { asScalar = F.parseYAMLScalar(s); } catch (e) { return true; }
    return asScalar !== s;
  }
  F.parseYAMLScalar = function (s) { return F.parseYAML('v: ' + s).v; };

  function yamlKey(k) { return yamlNeedsQuotes(k) ? JSON.stringify(k) : k; }

  function yamlScalar(v, indent) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return isFinite(v) ? String(v) : isNaN(v) ? '.nan' : v > 0 ? '.inf' : '-.inf';
    var s = String(v);
    if (s.indexOf('\n') !== -1 && !/[\u0000-\u0009\u000b-\u001f]/.test(s) && !/^\s/.test(s)) {
      var pad = new Array(indent + 3).join(' ');
      var chomp = /\n$/.test(s) ? (/\n\n$/.test(s) ? '+' : '') : '-';
      var body = s.replace(/\n$/, '');
      return '|' + chomp + '\n' + body.split('\n').map(function (l) { return l ? pad + l : ''; }).join('\n');
    }
    return yamlNeedsQuotes(s) ? JSON.stringify(s) : s;
  }

  F.toYAML = function (value) {
    function emit(v, indent) {
      var pad = new Array(indent + 1).join(' ');
      if (Array.isArray(v)) {
        if (!v.length) return '[]';
        return v.map(function (item) {
          if (item && typeof item === 'object' && (Array.isArray(item) ? item.length : Object.keys(item).length)) {
            var inner = emit(item, indent + 2);
            return pad + '- ' + inner.replace(/^\s+/, '');
          }
          return pad + '- ' + scalarOrEmpty(item, indent);
        }).join('\n');
      }
      if (v && typeof v === 'object') {
        var keys = Object.keys(v);
        if (!keys.length) return '{}';
        return keys.map(function (k) {
          var item = v[k];
          if (item && typeof item === 'object' && (Array.isArray(item) ? item.length : Object.keys(item).length)) {
            return pad + yamlKey(k) + ':\n' + emit(item, Array.isArray(item) ? indent : indent + 2);
          }
          return pad + yamlKey(k) + ': ' + scalarOrEmpty(item, indent);
        }).join('\n');
      }
      return pad + yamlScalar(v, indent);
    }
    function scalarOrEmpty(item, indent) {
      if (Array.isArray(item)) return '[]';
      if (item && typeof item === 'object') return '{}';
      return yamlScalar(item, indent);
    }
    return emit(value, 0) + '\n';
  };

  /* =======================================================================
     CSV (RFC 4180)
     ======================================================================= */
  F.detectDelimiter = function (text) {
    var first = text.split(/\r?\n/).slice(0, 5);
    var best = ',', bestScore = 0;
    [',', '\t', ';', '|'].forEach(function (d) {
      var counts = first.map(function (l) { return countOutsideQuotes(l, d); });
      var min = Math.min.apply(null, counts), max = Math.max.apply(null, counts);
      var score = min > 0 ? min * 10 - (max - min) : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  };
  function countOutsideQuotes(line, d) {
    var q = false, c = 0;
    for (var k = 0; k < line.length; k++) {
      if (line[k] === '"') q = !q;
      else if (!q && line[k] === d) c++;
    }
    return c;
  }

  F.parseCSVRows = function (text, delimiter) {
    var d = delimiter || F.detectDelimiter(text);
    var rows = [], row = [], field = '', q = false, i = 0, n = text.length, quotedField = false;
    while (i < n) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { q = true; quotedField = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; quotedField = false; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; quotedField = false;
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (q) throw fail('Unclosed quote in CSV', text, n - 1);
    if (field !== '' || quotedField || row.length) { row.push(field); rows.push(row); }
    // Drop fully empty trailing rows.
    while (rows.length && rows[rows.length - 1].every(function (f) { return f === ''; })) rows.pop();
    return { rows: rows, delimiter: d };
  };

  function typed(s) {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s) && s.length < 16) return Number(s);
    return s;
  }

  // Header row → array of objects. Dotted headers ("a.b") become nested objects.
  F.parseCSV = function (text, opts) {
    opts = opts || {};
    var res = F.parseCSVRows(text, opts.delimiter);
    var rows = res.rows;
    if (!rows.length) return { value: [], delimiter: res.delimiter };
    var head = rows[0];
    var seen = {};
    head = head.map(function (h, idx) {
      h = h.trim() || 'column' + (idx + 1);
      if (seen[h]) { seen[h]++; h = h + '_' + seen[h]; } else seen[h] = 1;
      return h;
    });
    var out = rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, idx) {
        var raw = r[idx] == null ? '' : r[idx];
        var v = opts.types === false ? raw : typed(raw);
        setPath(o, h, v);
      });
      return o;
    });
    return { value: out, delimiter: res.delimiter, columns: head.length, rows: out.length };
  };
  function setPath(o, path, v) {
    if (path.indexOf('.') === -1) { o[path] = v; return; }
    var parts = path.split('.'), cur = o;
    for (var k = 0; k < parts.length - 1; k++) {
      if (cur[parts[k]] == null || typeof cur[parts[k]] !== 'object') cur[parts[k]] = {};
      cur = cur[parts[k]];
    }
    cur[parts[parts.length - 1]] = v;
  }

  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, key, out);
      else out[key] = v;
    });
    return out;
  }

  F.toCSV = function (value, opts) {
    var d = (opts && opts.delimiter) || ',';
    function cell(v) {
      if (v == null) return '';
      if (typeof v === 'object') v = JSON.stringify(v);
      var s = String(v);
      return (s.indexOf(d) !== -1 || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var rows;
    if (!Array.isArray(value)) value = [value];
    if (value.every(Array.isArray)) {
      rows = value.map(function (r) { return r.map(cell).join(d); });
    } else {
      var flat = value.map(function (r) { return r && typeof r === 'object' && !Array.isArray(r) ? flatten(r, '', {}) : { value: r }; });
      var cols = [];
      flat.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) === -1) cols.push(k); }); });
      rows = [cols.map(cell).join(d)].concat(flat.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(d); }));
    }
    return rows.join('\n') + '\n';
  };

  /* =======================================================================
     JSONPath subset
     $  .key  ['key']  [0]  [-1]  [0,2]  [1:4]  [::2]  *  ..key  ..*
     [?(@.price < 10)]  [?(@.tags)]  [?(@.name =~ /^a/i)]  && and ||
     ======================================================================= */
  F.pathFor = function (keys) {
    return '$' + keys.map(function (k) {
      if (typeof k === 'number') return '[' + k + ']';
      return /^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : "['" + String(k).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']";
    }).join('');
  };

  function parsePath(expr) {
    expr = expr.trim();
    if (!expr) expr = '$';
    if (expr[0] === '@') expr = '$' + expr.slice(1);
    if (expr[0] !== '$') expr = '$' + (expr[0] === '[' || expr[0] === '.' ? '' : '.') + expr;
    var p = 1, segs = [];
    function name() { var s = p; while (p < expr.length && !/[.\[]/.test(expr[p])) p++; return expr.slice(s, p).trim(); }
    function bracket(rec) {
      var depth = 0, q = null, s = ++p;
      for (; p < expr.length; p++) {
        var c = expr[p];
        if (q) { if (c === '\\') p++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')') depth--;
        else if (c === ']') { if (depth === 0) break; depth--; }
      }
      if (p >= expr.length) throw new SyntaxError('Unclosed "[" in path');
      var body = expr.slice(s, p).trim(); p++;
      if (body === '*') return { type: 'wild', rec: rec };
      if (body[0] === '?') {
        var f = body.slice(1).trim();
        if (f[0] === '(' && f[f.length - 1] === ')') f = f.slice(1, -1);
        return { type: 'filter', expr: f, rec: rec };
      }
      if (/^-?\d*\s*:\s*-?\d*(\s*:\s*-?\d*)?$/.test(body)) {
        var parts = body.split(':').map(function (x) { x = x.trim(); return x === '' ? null : parseInt(x, 10); });
        return { type: 'slice', a: parts[0], b: parts[1], s: parts[2] == null ? 1 : parts[2], rec: rec };
      }
      var items = splitTop(body, ',').map(function (x) {
        x = x.trim();
        if (/^-?\d+$/.test(x)) return parseInt(x, 10);
        if (/^(['"]).*\1$/.test(x)) return x.slice(1, -1).replace(/\\(.)/g, '$1');
        return x;
      });
      return { type: 'pick', items: items, rec: rec };
    }
    while (p < expr.length) {
      if (expr.substr(p, 2) === '..') {
        p += 2;
        if (expr[p] === '[') { segs.push(bracket(true)); continue; }
        var nm = name();
        segs.push(nm === '*' ? { type: 'wild', rec: true } : { type: 'pick', items: [nm], rec: true });
      } else if (expr[p] === '.') {
        p++;
        var nm2 = name();
        if (!nm2) throw new SyntaxError('Expected a property name after "."');
        segs.push(nm2 === '*' ? { type: 'wild' } : { type: 'pick', items: [nm2] });
      } else if (expr[p] === '[') {
        segs.push(bracket(false));
      } else if (/\s/.test(expr[p])) { p++; }
      else throw new SyntaxError('Unexpected "' + expr[p] + '" in path');
    }
    return segs;
  }
  function splitTop(s, sep) {
    var out = [], depth = 0, q = null, start = 0;
    for (var k = 0; k < s.length; k++) {
      var c = s[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && s.substr(k, sep.length) === sep) { out.push(s.slice(start, k)); start = k + sep.length; k += sep.length - 1; }
    }
    out.push(s.slice(start));
    return out;
  }

  function children(node) {
    var v = node.value, out = [];
    if (Array.isArray(v)) v.forEach(function (x, k) { out.push({ value: x, keys: node.keys.concat(k) }); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { out.push({ value: v[k], keys: node.keys.concat(k) }); });
    return out;
  }
  function descendants(node, out) {
    out.push(node);
    children(node).forEach(function (c) { descendants(c, out); });
    return out;
  }

  function literal(s) {
    s = s.trim();
    if (/^(['"]).*\1$/.test(s)) return s.slice(1, -1);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    var re = /^\/(.*)\/([a-z]*)$/.exec(s);
    if (re) return new RegExp(re[1], re[2]);
    if (!isNaN(parseFloat(s))) return parseFloat(s);
    return s;
  }
  function evalFilter(expr, item) {
    return splitTop(expr, '||').some(function (orPart) {
      return splitTop(orPart, '&&').every(function (term) {
        term = term.trim();
        var neg = false;
        if (term[0] === '!') { neg = true; term = term.slice(1).trim(); }
        if (term[0] === '(' && term[term.length - 1] === ')') { var r = evalFilter(term.slice(1, -1), item); return neg ? !r : r; }
        var m = /^(@[^=!<>~]*?)\s*(==|!=|<=|>=|<|>|=~)\s*(.+)$/.exec(term);
        var path = m ? m[1] : term;
        var found = F.jsonPath(path, item);
        var res;
        if (!m) res = found.length > 0 && found[0].value !== undefined;
        else {
          var left = found.length ? found[0].value : undefined, right = literal(m[3]), op = m[2];
          if (op === '==') res = left === right;
          else if (op === '!=') res = left !== right;
          else if (op === '<') res = left < right;
          else if (op === '<=') res = left <= right;
          else if (op === '>') res = left > right;
          else if (op === '>=') res = left >= right;
          else if (op === '=~') res = right instanceof RegExp ? right.test(String(left)) : String(left).indexOf(String(right)) !== -1;
        }
        return neg ? !res : res;
      });
    });
  }

  F.jsonPath = function (expr, root) {
    var segs = parsePath(expr);
    var nodes = [{ value: root, keys: [] }];
    segs.forEach(function (seg) {
      var next = [];
      nodes.forEach(function (node) {
        var bases = seg.rec ? descendants(node, []) : [node];
        bases.forEach(function (b) {
          var v = b.value;
          if (seg.type === 'wild') { next.push.apply(next, children(b)); return; }
          if (seg.type === 'filter') {
            children(b).forEach(function (c) { try { if (evalFilter(seg.expr, c.value)) next.push(c); } catch (e) {} });
            return;
          }
          if (seg.type === 'slice') {
            if (!Array.isArray(v)) return;
            var len = v.length, st = seg.s || 1;
            var a = seg.a == null ? (st > 0 ? 0 : len - 1) : seg.a < 0 ? Math.max(len + seg.a, 0) : Math.min(seg.a, len);
            var e = seg.b == null ? (st > 0 ? len : -1) : seg.b < 0 ? Math.max(len + seg.b, -1) : Math.min(seg.b, len);
            for (var k = a; st > 0 ? k < e : k > e; k += st) next.push({ value: v[k], keys: b.keys.concat(k) });
            return;
          }
          seg.items.forEach(function (it) {
            if (Array.isArray(v) && typeof it === 'number') {
              var idx = it < 0 ? v.length + it : it;
              if (idx >= 0 && idx < v.length) next.push({ value: v[idx], keys: b.keys.concat(idx) });
            } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, it)) {
              next.push({ value: v[it], keys: b.keys.concat(String(it)) });
            }
          });
        });
      });
      nodes = next;
    });
    return nodes.map(function (n) { return { value: n.value, path: F.pathFor(n.keys), keys: n.keys }; });
  };

  /* ---------- Format detection ---------- */
  F.detect = function (text) {
    var t = text.trim();
    if (!t) return null;
    if (t[0] === '{' || t[0] === '[') return 'json';
    if (/^"/.test(t)) { try { JSON.parse(t); return 'json'; } catch (e) {} }
    var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 6);
    if (lines.length >= 2 && !/^\s*-\s|:\s|:$/.test(lines[0])) {
      var d = F.detectDelimiter(t);
      var counts = lines.map(function (l) { return countOutsideQuotes(l, d); });
      if (counts[0] > 0 && counts.every(function (c) { return c === counts[0]; })) return 'csv';
    }
    return 'yaml';
  };

  window.Formats = F;
})();
