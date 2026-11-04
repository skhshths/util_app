/* =========================================================================
   Tool: 3D model viewer (STL, OBJ, 3MF)
   Open a binary or ASCII .stl, an .obj or a .3mf file and inspect it in 3D: drag to rotate,
   right-drag (or Shift-drag) to pan, scroll or pinch to zoom. A small
   dependency-free WebGL renderer with studio lighting, wireframe, grid,
   view presets and print-oriented model info (size, volume, area,
   watertightness, estimated weight).
   ========================================================================= */
(function () {
  'use strict';

  /* ---------- STL parsing ---------- */
  // Returns { positions: Float32Array (9 floats per triangle), triangles, format, name }.
  function parseSTL(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 84) {
      var dv = new DataView(buf);
      var count = dv.getUint32(80, true);
      // A binary STL is exactly 84 + 50 bytes per triangle. ASCII files that start
      // with "solid" fail this check, while binary files that also start with "solid"
      // (some exporters do this) still pass.
      if (84 + count * 50 === bytes.length) return parseBinary(dv, count, bytes);
    }
    var head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512)));
    if (/^\s*solid/i.test(head) && /facet|endsolid/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))))) return parseAscii(new TextDecoder().decode(bytes));
    if (bytes.length >= 84) {
      // Some binary files have trailing bytes or a wrong count: trust the size.
      var n = Math.floor((bytes.length - 84) / 50);
      if (n > 0) return parseBinary(new DataView(buf), n, bytes, true);
    }
    throw new Error('This does not look like an STL file.');
  }
  function parseBinary(dv, count, bytes, guessed) {
    var pos = new Float32Array(count * 9);
    for (var i = 0, o = 84; i < count; i++, o += 50) {
      for (var k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
    }
    var name = new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0[\s\S]*$/, '').replace(/^solid\s*/i, '').trim();
    return { positions: pos, triangles: count, format: guessed ? 'Binary (size-corrected)' : 'Binary', name: name };
  }
  function parseAscii(text) {
    var re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, m, vals = [];
    while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
    var tris = Math.floor(vals.length / 9);
    if (!tris) throw new Error('No triangles found in this ASCII STL.');
    var nm = /^\s*solid\s+([^\r\n]*)/i.exec(text);
    return { positions: new Float32Array(vals.slice(0, tris * 9)), triangles: tris, format: 'ASCII', name: nm ? nm[1].trim() : '' };
  }

  /* ---------- OBJ ---------- */
  // Vertices ("v x y z") and faces ("f 1 2 3 4", "f 1/1/1 …", negative = relative).
  // Polygons are split into triangles as a fan. Everything else is ignored.
  function parseOBJ(text) {
    var verts = [], out = [], groups = 0, bad = 0, i = 0, n = text.length;
    while (i < n) {
      var e = text.indexOf('\n', i); if (e === -1) e = n;
      var c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1);
      if (c0 === 118 && (c1 === 32 || c1 === 9)) {               // "v "
        var p = text.slice(i + 2, e).trim().split(/\s+/);
        verts.push(+p[0], +p[1], +p[2]);
      } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {        // "f "
        var f = text.slice(i + 2, e).trim().split(/\s+/), idx = [], nv = verts.length / 3;
        for (var k = 0; k < f.length; k++) {
          var v = parseInt(f[k], 10);
          if (isNaN(v)) continue;
          v = v < 0 ? nv + v : v - 1;
          if (v < 0 || v >= nv) { bad++; idx = null; break; }
          idx.push(v);
        }
        if (idx) for (k = 1; k + 1 < idx.length; k++) {
          var a = idx[0] * 3, b = idx[k] * 3, cc = idx[k + 1] * 3;
          out.push(verts[a], verts[a + 1], verts[a + 2], verts[b], verts[b + 1], verts[b + 2], verts[cc], verts[cc + 1], verts[cc + 2]);
        }
      } else if ((c0 === 111 || c0 === 103) && c1 === 32) groups++; // "o " / "g "
      i = e + 1;
    }
    if (!out.length) throw new Error(verts.length ? 'This OBJ has vertices but no faces (it may be a point cloud).' : 'No geometry found in this OBJ file.');
    return { positions: new Float32Array(out), triangles: out.length / 9, format: 'OBJ' + (groups > 1 ? ' · ' + groups + ' groups' : ''), name: '', note: bad ? bad + ' faces pointed at missing vertices and were skipped' : '' };
  }

  /* ---------- 3MF (a ZIP of XML) ---------- */
  async function unzip(buf) {
    var b = new Uint8Array(buf), dv = new DataView(buf), eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This 3MF file is not a valid ZIP archive.');
    var count = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    if (off === 0xffffffff) throw new Error('This 3MF uses ZIP64, which is not supported.');
    var files = {}, td = new TextDecoder();
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true);
      var name = td.decode(b.subarray(off + 46, off + 46 + nlen));
      files[name.replace(/^\//, '')] = { method: method, csize: csize, local: local };
      off += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      read: async function (name) {
        var f = files[name.replace(/^\//, '')];
        if (!f) throw new Error('Missing part in 3MF: ' + name);
        var start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
        var data = b.subarray(start, start + f.csize);
        if (f.method === 0) return td.decode(data);
        if (f.method !== 8) throw new Error('Unsupported compression in 3MF (method ' + f.method + ').');
        if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip 3MF files. Try a current Chrome, Edge, Firefox or Safari.');
        var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      }
    };
  }
  var UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
  function attrs(s) { var o = {}, re = /([\w:-]+)\s*=\s*"([^"]*)"/g, m; while ((m = re.exec(s))) o[m[1].replace(/^[\w-]+:(?=path$)/, 'p:')] = m[2]; return o; }
  function readModel(xml) {
    var model = { unit: 1, objects: {}, build: [], title: '' };
    var mm = /<(?:[\w-]+:)?model\b([^>]*)>/.exec(xml);
    if (mm) { var u = attrs(mm[1]).unit; if (u && UNIT_MM[u]) model.unit = UNIT_MM[u]; }
    var t = /<(?:[\w-]+:)?metadata\s+name="Title"[^>]*>([^<]*)</i.exec(xml); if (t) model.title = t[1].trim();
    var objRe = /<(?:[\w-]+:)?object\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?object>/g, m;
    while ((m = objRe.exec(xml))) {
      var a = attrs(m[1]), body = m[2], o = { verts: null, tris: null, comps: [] };
      var vs = [], vre = /<(?:[\w-]+:)?vertex\b([^>]*)>/g, vm;
      while ((vm = vre.exec(body))) { var va = attrs(vm[1]); vs.push(+va.x, +va.y, +va.z); }
      var ts = [], tre = /<(?:[\w-]+:)?triangle\b([^>]*)>/g, tm;
      while ((tm = tre.exec(body))) { var ta = attrs(tm[1]); ts.push(+ta.v1, +ta.v2, +ta.v3); }
      if (vs.length) { o.verts = vs; o.tris = ts; }
      var cre = /<(?:[\w-]+:)?component\b([^>]*)>/g, cm;
      while ((cm = cre.exec(body))) { var ca = attrs(cm[1]); o.comps.push({ id: ca.objectid, t: parseT(ca.transform), path: ca['p:path'] }); }
      model.objects[a.id] = o;
    }
    var bre = /<(?:[\w-]+:)?item\b([^>]*)>/g, bm;
    var build = /<(?:[\w-]+:)?build\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?build>/.exec(xml);
    if (build) while ((bm = bre.exec(build[1]))) { var ba = attrs(bm[1]); model.build.push({ id: ba.objectid, t: parseT(ba.transform), path: ba['p:path'] }); }
    return model;
  }
  // 3MF transforms are 4x3 row-major: x' = x*m00 + y*m10 + z*m20 + m30, and so on.
  function parseT(s) { if (!s) return null; var v = s.trim().split(/\s+/).map(Number); return v.length === 12 ? v : null; }
  function composeT(a, b) { // apply a, then b
    if (!a) return b; if (!b) return a;
    var o = new Array(12);
    for (var r = 0; r < 4; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + (r === 3 ? b[9 + c] : 0);
    return o;
  }
  async function parse3MF(buf) {
    var zip = await unzip(buf), models = {};
    var rels = zip.names.indexOf('_rels/.rels') !== -1 ? await zip.read('_rels/.rels') : '';
    var start = (/Target="([^"]+)"[^>]*Type="[^"]*3dmodel"/.exec(rels) || /Type="[^"]*3dmodel"[^>]*Target="([^"]+)"/.exec(rels) || [])[1];
    var modelNames = zip.names.filter(function (n) { return /\.model$/i.test(n); });
    if (!modelNames.length) throw new Error('No 3D model part found in this 3MF file.');
    start = (start || '3D/3dmodel.model').replace(/^\//, '');
    if (modelNames.indexOf(start) === -1) start = modelNames[0];
    for (var i = 0; i < modelNames.length; i++) models[modelNames[i]] = readModel(await zip.read(modelNames[i]));
    var root = models[start], out = [], objects = 0;
    function emit(path, id, T, depth) {
      var mdl = models[(path || start).replace(/^\//, '')], o = mdl && mdl.objects[id];
      if (!o || depth > 16) return;
      if (o.verts) {
        objects++;
        var v = o.verts, tr = o.tris, s = mdl.unit, flip = T && (T[0] * (T[4] * T[8] - T[5] * T[7]) - T[1] * (T[3] * T[8] - T[5] * T[6]) + T[2] * (T[3] * T[7] - T[4] * T[6])) < 0;
        for (var k = 0; k < tr.length; k += 3) {
          var order = flip ? [tr[k], tr[k + 2], tr[k + 1]] : [tr[k], tr[k + 1], tr[k + 2]];
          for (var j = 0; j < 3; j++) {
            var x = v[order[j] * 3], y = v[order[j] * 3 + 1], z = v[order[j] * 3 + 2];
            if (T) { var X = x * T[0] + y * T[3] + z * T[6] + T[9], Y = x * T[1] + y * T[4] + z * T[7] + T[10], Z = x * T[2] + y * T[5] + z * T[8] + T[11]; x = X; y = Y; z = Z; }
            out.push(x * s, y * s, z * s);
          }
        }
      }
      o.comps.forEach(function (c) { emit(c.path || path, c.id, composeT(c.t, T), depth + 1); });
    }
    if (root.build.length) root.build.forEach(function (it) { emit(it.path, it.id, it.t, 0); });
    else Object.keys(root.objects).forEach(function (id) { emit(null, id, null, 0); });
    if (!out.length) throw new Error('This 3MF file has no printable meshes.');
    return { positions: new Float32Array(out), triangles: out.length / 9, format: '3MF · ' + objects + (objects === 1 ? ' object' : ' objects'), name: root.title };
  }

  // Picks the parser from the extension, or by sniffing the bytes.
  async function parseModel(name, buf) {
    var ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    var head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096));
    if (ext === '3mf' || (head[0] === 0x50 && head[1] === 0x4b)) return parse3MF(buf);
    if (ext === 'obj' || (ext !== 'stl' && /^(#.*\n|\s*\n)*\s*(v|vn|vt|o|g|mtllib|f)\s/m.test(new TextDecoder().decode(head)))) return parseOBJ(new TextDecoder().decode(buf));
    return parseSTL(buf);
  }

  /* ---------- Geometry ---------- */
  function analyse(pos) {
    var n = pos.length / 9, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    var normals = new Float32Array(pos.length), area = 0, vol = 0, degenerate = 0;
    for (var i = 0; i < n; i++) {
      var o = i * 9;
      var ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5], cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      area += len / 2;
      // Signed volume of the tetrahedron (origin, a, b, c).
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      if (len > 0) { nx /= len; ny /= len; nz /= len; } else degenerate++;
      for (var k = 0; k < 3; k++) {
        normals[o + k * 3] = nx; normals[o + k * 3 + 1] = ny; normals[o + k * 3 + 2] = nz;
        var x = pos[o + k * 3], y = pos[o + k * 3 + 1], z = pos[o + k * 3 + 2];
        if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
      }
    }
    return { normals: normals, min: min, max: max, area: area, volume: Math.abs(vol), inverted: vol < 0, degenerate: degenerate };
  }

  // Welds vertices by position, then counts how many faces share each edge.
  // Every edge shared by exactly two faces means the mesh is closed (watertight).
  // Uses open-addressing hash tables on typed arrays, so millions of triangles stay fast.
  function pow2(n) { var c = 1; while (c < n) c *= 2; return c; }
  function topology(pos, size) {
    var nC = pos.length / 3, eps = Math.max(size, 1e-9) * 1e-6;
    var cap = pow2(nC * 1.5 + 16), mask = cap - 1, table = new Int32Array(cap).fill(-1);
    var qx = new Int32Array(nC), qy = new Int32Array(nC), qz = new Int32Array(nC), vid = new Uint32Array(nC), next = 0;
    for (var i = 0; i < nC; i++) {
      var x = Math.round(pos[i * 3] / eps) | 0, y = Math.round(pos[i * 3 + 1] / eps) | 0, z = Math.round(pos[i * 3 + 2] / eps) | 0;
      var h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      for (;;) {
        var s = table[h];
        if (s === -1) { table[h] = next; qx[next] = x; qy[next] = y; qz[next] = z; vid[i] = next++; break; }
        if (qx[s] === x && qy[s] === y && qz[s] === z) { vid[i] = s; break; }
        h = (h + 1) & mask;
      }
    }
    table = qx = qy = qz = null;
    var n = nC / 3, ecap = pow2(n * 4 + 16), emask = ecap - 1;
    var ka = new Int32Array(ecap).fill(-1), kb = new Int32Array(ecap), cnt = new Uint8Array(ecap), edges = 0;
    for (var t = 0; t < n; t++) {
      for (var e = 0; e < 3; e++) {
        var a = vid[t * 3 + e], b = vid[t * 3 + (e + 1) % 3];
        if (a > b) { var tmp = a; a = b; b = tmp; }
        var eh = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503)) & emask;
        for (;;) {
          if (ka[eh] === -1) { ka[eh] = a; kb[eh] = b; cnt[eh] = 1; edges++; break; }
          if (ka[eh] === a && kb[eh] === b) { if (cnt[eh] < 255) cnt[eh]++; break; }
          eh = (eh + 1) & emask;
        }
      }
    }
    var open = 0, nonManifold = 0;
    for (var k = 0; k < ecap; k++) { if (cnt[k] === 1) open++; else if (cnt[k] > 2) nonManifold++; }
    return { vertices: next, vid: vid, edges: edges, open: open, nonManifold: nonManifold };
  }

  // Smooth normals: average the normals of faces meeting at a vertex, but keep
  // sharp edges (faces more than 35° apart) crisp.
  function smoothNormals(flat, vid, nVerts) {
    var n = flat.length / 9, cos = Math.cos(35 * Math.PI / 180);
    var start = new Uint32Array(nVerts + 1);
    for (var i = 0; i < n * 3; i++) start[vid[i] + 1]++;
    for (var v = 0; v < nVerts; v++) start[v + 1] += start[v];
    var fill = start.slice(0, nVerts), list = new Uint32Array(n * 3);
    for (i = 0; i < n * 3; i++) list[fill[vid[i]]++] = (i / 3) | 0;
    var out = new Float32Array(flat.length);
    for (var c = 0; c < n * 3; c++) {
      var f = (c / 3) | 0, fx = flat[f * 9], fy = flat[f * 9 + 1], fz = flat[f * 9 + 2], sx = 0, sy = 0, sz = 0;
      for (var j = start[vid[c]]; j < start[vid[c] + 1]; j++) {
        var g = list[j], gx = flat[g * 9], gy = flat[g * 9 + 1], gz = flat[g * 9 + 2];
        if (gx * fx + gy * fy + gz * fz >= cos) { sx += gx; sy += gy; sz += gz; }
      }
      var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      out[c * 3] = sx / l; out[c * 3 + 1] = sy / l; out[c * 3 + 2] = sz / l;
    }
    return out;
  }

  function edgeLines(pos) {
    var n = pos.length / 9, out = new Float32Array(n * 18);
    for (var i = 0; i < n; i++) {
      var o = i * 9, w = i * 18;
      for (var e = 0; e < 3; e++) {
        var a = o + e * 3, b = o + ((e + 1) % 3) * 3;
        out[w + e * 6] = pos[a]; out[w + e * 6 + 1] = pos[a + 1]; out[w + e * 6 + 2] = pos[a + 2];
        out[w + e * 6 + 3] = pos[b]; out[w + e * 6 + 4] = pos[b + 1]; out[w + e * 6 + 5] = pos[b + 2];
      }
    }
    return out;
  }

  /* ---------- Sample model: a trefoil knot on a little plinth ---------- */
  function sampleSTL() {
    var tris = [];
    function tri(a, b, c) { tris.push(a, c, b); } // listed clockwise below, stored counter-clockwise (outward)
    var U = 240, V = 28, R = 5.2;
    function knot(t) {
      return [ (Math.sin(t) + 2 * Math.sin(2 * t)) * 9, (Math.cos(t) - 2 * Math.cos(2 * t)) * 9, -Math.sin(3 * t) * 9 + 34 ];
    }
    var ring = [];
    for (var i = 0; i < U; i++) {
      var t = i / U * Math.PI * 2, p = knot(t), q = knot(t + 0.001);
      var T = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], tl = Math.hypot(T[0], T[1], T[2]); T = T.map(function (x) { return x / tl; });
      var up = [0, 0, 1], N = [T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]], nl = Math.hypot(N[0], N[1], N[2]) || 1;
      N = N.map(function (x) { return x / nl; });
      var B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      var r = [];
      for (var j = 0; j < V; j++) {
        var a = j / V * Math.PI * 2;
        r.push([p[0] + R * (Math.cos(a) * N[0] + Math.sin(a) * B[0]), p[1] + R * (Math.cos(a) * N[1] + Math.sin(a) * B[1]), p[2] + R * (Math.cos(a) * N[2] + Math.sin(a) * B[2])]);
      }
      ring.push(r);
    }
    for (i = 0; i < U; i++) for (var j2 = 0; j2 < V; j2++) {
      var a0 = ring[i][j2], a1 = ring[i][(j2 + 1) % V], b0 = ring[(i + 1) % U][j2], b1 = ring[(i + 1) % U][(j2 + 1) % V];
      tri(a0, b0, b1); tri(a0, b1, a1);
    }
    // Hexagonal plinth.
    var S = 6, top = 8, rad = 30, base = [], cap = [];
    for (i = 0; i < S; i++) { var ang = i / S * Math.PI * 2; base.push([Math.cos(ang) * rad, Math.sin(ang) * rad, 0]); cap.push([Math.cos(ang) * rad, Math.sin(ang) * rad, top]); }
    for (i = 0; i < S; i++) {
      var k2 = (i + 1) % S;
      tri(base[i], base[k2], cap[k2]); tri(base[i], cap[k2], cap[i]);
      tri([0, 0, top], cap[i], cap[k2]); tri([0, 0, 0], base[k2], base[i]);
    }
    var n = tris.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    var hdr = 'Trefoil knot sample by Utilities';
    for (i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, n, true);
    for (i = 0; i < n; i++) for (var v = 0; v < 3; v++) for (var c = 0; c < 3; c++) dv.setFloat32(84 + i * 50 + 12 + v * 12 + c * 4, tris[i * 3 + v][c], true);
    return new File([buf], 'trefoil-knot.stl', { type: 'model/stl' });
  }

  /* ---------- Matrices (column-major, like WebGL) ---------- */
  function persp(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function ortho(h, aspect, near, far) {
    var w = h * aspect;
    return [1 / w, 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  }
  function lookAt(e, t, up) {
    var zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2], zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx, xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }

  /* ---------- Renderer ---------- */
  var VS = 'attribute vec3 aPos; attribute vec3 aNorm; uniform mat4 uMVP; uniform mat4 uView; varying vec3 vN; varying vec3 vV;' +
    'void main(){ vec4 p = uView * vec4(aPos,1.0); vV = -p.xyz; vN = mat3(uView) * aNorm; gl_Position = uMVP * vec4(aPos,1.0); }';
  var FS = 'precision mediump float; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uOrtho;' +
    'vec3 light(vec3 n, vec3 v, vec3 l, vec3 c, float spec){ float d = max(dot(n,l),0.0); vec3 h = normalize(l+v); float s = pow(max(dot(n,h),0.0), 48.0) * spec; return c*(d*uColor + s); }' +
    'void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; vec3 v = uOrtho > 0.5 ? vec3(0.0,0.0,1.0) : normalize(vV);' +
    ' vec3 col = uColor * mix(vec3(0.20,0.20,0.23), vec3(0.34,0.35,0.38), n.y*0.5+0.5);' +
    ' col += light(n, v, normalize(vec3(0.45,0.65,0.62)), vec3(0.78), 0.35);' +
    ' col += light(n, v, normalize(vec3(-0.7,0.15,0.45)), vec3(0.32,0.34,0.40), 0.10);' +
    ' col += light(n, v, normalize(vec3(0.1,-0.6,-0.5)), vec3(0.22), 0.25);' +
    ' gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0); }';
  var LVS = 'attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position = uMVP * vec4(aPos,1.0); }';
  var LFS = 'precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }';

  function compile(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNorm');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {};
    ['uMVP', 'uView', 'uColor', 'uOrtho'].forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  /* ---------- Tool ---------- */
  var COLORS = [['Slate', '#8b93a5'], ['Blue', '#5b8def'], ['Orange', '#f08a3c'], ['Green', '#3fb07a'], ['Red', '#e5534b'], ['Purple', '#9b6fe3'], ['White', '#e8e8ea'], ['Black', '#3a3a40']];
  var prefs = Object.assign({ color: '#5b8def', mode: 'shaded', grid: true, smooth: false, spin: false, ortho: false, units: 'mm', density: 1.24 }, U.store.get('stl', {}));
  function savePrefs() { U.store.set('stl', prefs); }
  var M = null; // the loaded model survives navigating away and back

  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

  U.register({
    id: 'stl',
    name: '3D model viewer',
    desc: 'Open an STL, OBJ or 3MF model and spin it around. See its size, volume, surface area, whether it is watertight and roughly what it would weigh printed.',
    hue: 30,
    icon: 'cube',
    keywords: ['stl', 'obj', '3mf', '3d', 'model', 'viewer', 'print', '3d print', 'mesh', 'cad', 'rotate', 'slicer', 'wavefront'],
    shortcuts: [['Reset the view', ['R']], ['Toggle wireframe', ['W']], ['Toggle auto-rotate', ['A']], ['Toggle grid', ['G']]],
    homeStat: function () {
      if (M) return '<span class="dot"></span>Open: <b>' + U.esc(M.file) + '</b> · ' + U.fmtNum(M.triangles, 0) + ' triangles';
      var last = U.store.get('stl-last', null);
      return last ? '<span class="dot"></span>Last opened: <b>' + U.esc(last.name) + '</b>' : '';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('cube') + '</span>3D model viewer</h1>' +
          '<p>Drag to rotate, right-drag or Shift-drag to pan, scroll or pinch to zoom. Files never leave your device.</p>' +
        '</div><div class="tool-head-actions">' +
          '<button class="btn btn-ghost btn-sm" data-act="sample">' + U.icon('sparkles') + 'Sample</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="shot" id="stlShot">' + U.icon('download') + 'Screenshot</button>' +
          '<button class="btn btn-soft btn-sm" data-act="open">' + U.icon('file') + 'Open model</button>' +
        '</div></div>' +
        '<div class="stl-layout">' +
          '<section class="panel stl-stage" id="stlStage">' +
            '<canvas id="stlCanvas" aria-label="3D model view. Drag to rotate, scroll to zoom." tabindex="0"></canvas>' +
            '<div class="stl-bar stl-top">' +
              '<div class="seg" id="stlView"><button data-v="iso">3D</button><button data-v="front">Front</button><button data-v="right">Side</button><button data-v="top">Top</button></div>' +
              '<div class="seg" id="stlMode"><button data-v="shaded">Solid</button><button data-v="both">Edges</button><button data-v="wire">Wire</button></div>' +
            '</div>' +
            '<div class="stl-bar stl-bottom">' +
              '<button class="stl-tog" data-tog="grid">Grid</button><button class="stl-tog" data-tog="smooth">Smooth</button><button class="stl-tog" data-tog="spin">Auto-rotate</button><button class="stl-tog" data-tog="ortho">Orthographic</button>' +
              '<span class="stl-colors">' + COLORS.map(function (c) { return '<button class="stl-color" data-color="' + c[1] + '" title="' + c[0] + '" aria-label="' + c[0] + '" style="background:' + c[1] + '"></button>'; }).join('') + '</span>' +
              '<button class="icon-btn sm" data-act="fit" title="Reset view (R)" aria-label="Reset view">' + U.icon('reset') + '</button>' +
            '</div>' +
            '<div class="stl-drop" id="stlDrop"><div class="tool-icon" style="width:52px;height:52px">' + U.icon('cube') + '</div><b>Drop an .stl, .obj or .3mf file here</b><span>or <button class="sql-link" data-act="open">browse</button>, or try the <button class="sql-link" data-act="sample">sample model</button></span></div>' +
            '<div class="stl-busy" id="stlBusy" hidden><span class="spin"></span><span id="stlBusyText">Loading…</span></div>' +
          '</section>' +
          '<aside class="panel stl-info" id="stlInfo"></aside>' +
        '</div>';

      var stage = U.$('#stlStage', root), canvas = U.$('#stlCanvas', root), info = U.$('#stlInfo', root), drop = U.$('#stlDrop', root);
      var busy = U.$('#stlBusy', root);
      var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) {
        stage.innerHTML = '<div class="empty"><h3>WebGL is not available</h3><p>This browser or device has 3D graphics turned off, so models cannot be shown. Try another browser.</p></div>';
        return;
      }
      var prog = compile(gl, VS, FS), lprog = compile(gl, LVS, LFS);
      var buffers = { pos: gl.createBuffer(), norm: gl.createBuffer(), smooth: null, lines: null, grid: gl.createBuffer(), axes: gl.createBuffer() };
      var gridCount = 0, gridMajor = 0, lineCount = 0, vertCount = 0;
      var cam = { yaw: -Math.PI / 4, pitch: 0.5, dist: 100, target: [0, 0, 0], radius: 50 };
      var anim = null, dirty = true, alive = true, lastT = 0;

      /* ----- Uploading a model ----- */
      function upload() {
        if (!M) { vertCount = 0; return; }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos); gl.bufferData(gl.ARRAY_BUFFER, M.centered, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.norm); gl.bufferData(gl.ARRAY_BUFFER, prefs.smooth && M.smooth ? M.smooth : M.normals, gl.STATIC_DRAW);
        vertCount = M.triangles * 3;
        if (buffers.lines) { gl.deleteBuffer(buffers.lines); buffers.lines = null; }
        buildGrid();
      }
      function ensureLines() {
        if (buffers.lines || !M) return;
        buffers.lines = gl.createBuffer();
        var l = edgeLines(M.centered);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lines); gl.bufferData(gl.ARRAY_BUFFER, l, gl.STATIC_DRAW);
        lineCount = l.length / 3;
      }
      function niceStep(span) {
        var raw = span / 10, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
        return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
      }
      function buildGrid() {
        var size = M ? Math.max(M.size[0], M.size[1]) : 100, step = niceStep(size * 1.6), half = Math.ceil(size * 0.9 / step) * step;
        var z = M ? -M.size[2] / 2 : 0, minor = [], major = [];
        for (var x = -half; x <= half + 1e-9; x += step) {
          var arr = Math.abs(Math.round(x / step)) % 5 === 0 ? major : minor;
          arr.push(x, -half, z, x, half, z, -half, x, z, half, x, z);
        }
        var all = new Float32Array(minor.concat(major));
        gridCount = minor.length / 3; gridMajor = major.length / 3;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.grid); gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
        var a = half * 0.35;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.axes); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-half, -half, z, -half + a, -half, z, -half, -half, z, -half, -half + a, z, -half, -half, z, -half, -half, z + a]), gl.STATIC_DRAW);
        cam.gridStep = step;
      }

      /* ----- Camera ----- */
      var VIEWS = { iso: [-Math.PI / 4, 0.5], front: [-Math.PI / 2, 0.0001], right: [0, 0.0001], top: [-Math.PI / 2, Math.PI / 2 - 0.0001] };
      function fit(view) {
        var v = VIEWS[view || 'iso'];
        cam.target = [0, 0, 0];
        cam.radius = M ? Math.max(1e-6, Math.hypot(M.size[0], M.size[1], M.size[2]) / 2) : 50;
        cam.dist = cam.radius / Math.sin(FOV / 2) * 1.08;
        tween(v[0], v[1]);
      }
      var FOV = 35 * Math.PI / 180;
      function tween(yaw, pitch) {
        var from = { yaw: cam.yaw, pitch: cam.pitch }, t0 = performance.now();
        // Take the short way round.
        while (yaw - from.yaw > Math.PI) yaw -= Math.PI * 2;
        while (yaw - from.yaw < -Math.PI) yaw += Math.PI * 2;
        cam.tween = function (now) {
          var k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
          cam.yaw = from.yaw + (yaw - from.yaw) * e; cam.pitch = from.pitch + (pitch - from.pitch) * e;
          if (k >= 1) cam.tween = null;
        };
        dirty = true;
      }
      function eye() {
        var cp = Math.cos(cam.pitch);
        return [cam.target[0] + cam.dist * cp * Math.cos(cam.yaw), cam.target[1] + cam.dist * cp * Math.sin(cam.yaw), cam.target[2] + cam.dist * Math.sin(cam.pitch)];
      }

      /* ----- Drawing ----- */
      function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a]; }
      function draw(now) {
        if (!alive) return;
        anim = requestAnimationFrame(draw);
        var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0; lastT = now;
        if (cam.tween) cam.tween(now);
        if (prefs.spin && M && !drag) { cam.yaw += dt * 0.5; dirty = true; }
        if (!dirty && !cam.tween) return;
        dirty = false;
        var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (!M) return;
        var aspect = w / Math.max(1, h), e = eye();
        var near = Math.max(cam.dist - cam.radius * 6, cam.dist * 0.01), far = cam.dist + cam.radius * 8;
        var proj = prefs.ortho ? ortho(cam.dist * Math.tan(FOV / 2), aspect, near, far) : persp(FOV, aspect, near, far);
        var up = Math.abs(Math.cos(cam.pitch)) < 0.01 ? [-Math.cos(cam.yaw), -Math.sin(cam.yaw), 0] : [0, 0, 1];
        var view = lookAt(e, cam.target, up), mvp = mul(proj, view);
        gl.enable(gl.DEPTH_TEST);
        var dark = document.documentElement.dataset.theme === 'dark';

        if (prefs.grid) {
          gl.useProgram(lprog.p); gl.uniformMatrix4fv(lprog.u.uMVP, false, mvp);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.grid); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(1);
          gl.uniform4fv(lprog.u.uColor, dark ? [1, 1, 1, 0.07] : [0, 0, 0, 0.07]); gl.drawArrays(gl.LINES, 0, gridCount);
          gl.uniform4fv(lprog.u.uColor, dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.16]); gl.drawArrays(gl.LINES, gridCount, gridMajor);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.axes); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          [[0.9, 0.3, 0.3, 0.9], [0.3, 0.75, 0.4, 0.9], [0.35, 0.55, 1, 0.9]].forEach(function (c, i) { gl.uniform4fv(lprog.u.uColor, c); gl.drawArrays(gl.LINES, i * 2, 2); });
          gl.depthMask(true); gl.disable(gl.BLEND);
        }
        if (prefs.mode !== 'wire') {
          gl.useProgram(prog.p);
          gl.uniformMatrix4fv(prog.u.uMVP, false, mvp); gl.uniformMatrix4fv(prog.u.uView, false, view);
          gl.uniform3fv(prog.u.uColor, rgba(prefs.color, 1).slice(0, 3)); gl.uniform1f(prog.u.uOrtho, prefs.ortho ? 1 : 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.norm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
          gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
          gl.drawArrays(gl.TRIANGLES, 0, vertCount);
          gl.disable(gl.POLYGON_OFFSET_FILL); gl.disableVertexAttribArray(1);
        }
        if (prefs.mode !== 'shaded') {
          ensureLines();
          gl.useProgram(lprog.p); gl.uniformMatrix4fv(lprog.u.uMVP, false, mvp);
          var wire = prefs.mode === 'wire';
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform4fv(lprog.u.uColor, wire ? rgba(prefs.color, 0.85) : (dark ? [1, 1, 1, 0.22] : [0, 0, 0, 0.25]));
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lines); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.LINES, 0, lineCount);
          gl.disable(gl.BLEND);
        }
      }
      anim = requestAnimationFrame(draw);
      var ro = new ResizeObserver(function () { dirty = true; });
      ro.observe(canvas);
      var mo = new MutationObserver(function () { dirty = true; });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      /* ----- Pointer controls ----- */
      var pointers = new Map(), drag = null, pinch = null;
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      canvas.addEventListener('pointerdown', function (e) {
        if (!M) return;
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        cam.tween = null;
        if (pointers.size === 2) { var p = Array.from(pointers.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), dist: cam.dist, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 }; drag = null; return; }
        drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey };
        stage.classList.add('grabbing');
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) {
          var p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          cam.dist = Math.max(cam.radius * 0.05, Math.min(cam.radius * 40, pinch.dist * pinch.d / Math.max(1, d)));
          var cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
          pan(cx - pinch.cx, cy - pinch.cy); pinch.cx = cx; pinch.cy = cy;
          dirty = true; return;
        }
        if (!drag) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) pan(dx, dy);
        else {
          cam.yaw -= dx * 0.008;
          cam.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, cam.pitch + dy * 0.008));
        }
        dirty = true;
      });
      function endPointer(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) { drag = null; stage.classList.remove('grabbing'); }
      }
      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      function pan(dx, dy) {
        var h = canvas.clientHeight || 1, scale = 2 * cam.dist * Math.tan(FOV / 2) / h;
        var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
        var right = [-sy, cy, 0], up = [-sp * cy, -sp * sy, cp];
        for (var i = 0; i < 3; i++) cam.target[i] += (-dx * right[i] + dy * up[i]) * scale;
      }
      canvas.addEventListener('wheel', function (e) {
        if (!M) return;
        e.preventDefault();
        var k = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0012);
        cam.dist = Math.max(cam.radius * 0.05, Math.min(cam.radius * 40, cam.dist * k));
        dirty = true;
      }, { passive: false });
      canvas.addEventListener('dblclick', function () { if (M) fit('iso'); });

      /* ----- Controls ----- */
      var setView = U.seg(U.$('#stlView', root), 'iso', function (v) { fit(v); });
      U.seg(U.$('#stlMode', root), prefs.mode, function (v) { prefs.mode = v; savePrefs(); dirty = true; });
      function paintToggles() {
        U.$$('[data-tog]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(!!prefs[b.dataset.tog])); });
        U.$$('[data-color]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.color === prefs.color)); });
      }
      paintToggles();
      function toggle(name) {
        prefs[name] = !prefs[name]; savePrefs(); paintToggles();
        if (name === 'smooth' && M) {
          if (prefs.smooth && !M.smooth) {
            if (M.triangles > 3000000) { prefs.smooth = false; paintToggles(); U.toast('Smooth shading is limited to 3 million triangles'); return; }
            M.smooth = smoothNormals(M.normals, M.topo.vid, M.topo.vertices);
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.norm); gl.bufferData(gl.ARRAY_BUFFER, prefs.smooth ? M.smooth : M.normals, gl.STATIC_DRAW);
        }
        dirty = true;
      }

      /* ----- Info panel ----- */
      var UNITS = { mm: [1, 'mm'], cm: [10, 'cm'], in: [25.4, 'in'] };
      function paintInfo() {
        if (!M) {
          info.innerHTML = '<div class="panel-body"><p class="section-label">Model</p><p class="muted" style="margin:0;font-size:13.5px">Open a model to see its size, volume and print details. Supports STL (binary and ASCII), OBJ and 3MF.</p>' +
            '<p class="section-label" style="margin-top:20px">Controls</p><dl class="kv stl-keys"><dt>Rotate</dt><dd>Drag</dd><dt>Pan</dt><dd>Right-drag or Shift-drag</dd><dt>Zoom</dt><dd>Scroll or pinch</dd><dt>Reset</dt><dd>Double-click or R</dd></dl></div>';
          return;
        }
        var u = UNITS[prefs.units], s = M.size.map(function (v) { return v / u[0]; });
        var vol = M.volume / 1000, wt = vol * prefs.density; // cm³, g
        var tight = M.topo.open === 0 && M.topo.nonManifold === 0;
        info.innerHTML =
          '<div class="panel-head"><span class="panel-title" style="min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.esc(M.file) + '</span></span>' +
            '<div class="seg" id="stlUnits"><button data-v="mm">mm</button><button data-v="cm">cm</button><button data-v="in">in</button></div></div>' +
          '<div class="panel-body">' +
            '<div class="stl-dims">' + ['X', 'Y', 'Z'].map(function (a, i) { return '<div><span class="ax ax-' + a.toLowerCase() + '">' + a + '</span><b>' + U.fmtNum(s[i], 2) + '</b><span class="muted">' + u[1] + '</span></div>'; }).join('') + '</div>' +
            '<dl class="kv" style="margin-top:14px">' +
              '<dt>Volume</dt><dd>' + U.fmtNum(vol, 2) + ' cm³' + (tight ? '' : ' <span class="muted">(approx.)</span>') + '</dd>' +
              '<dt>Surface area</dt><dd>' + U.fmtNum(M.area / 100, 2) + ' cm²</dd>' +
              '<dt>Triangles</dt><dd>' + U.fmtNum(M.triangles, 0) + '</dd>' +
              '<dt>Vertices</dt><dd>' + U.fmtNum(M.topo.vertices, 0) + ' unique</dd>' +
              '<dt>Format</dt><dd>' + U.esc(M.format) + ' · ' + fmtBytes(M.bytes) + '</dd>' +
              (M.name ? '<dt>Name in file</dt><dd>' + U.esc(M.name) + '</dd>' : '') +
            '</dl>' +
            '<p class="section-label" style="margin-top:18px">Print check</p>' +
            '<div class="stl-check ' + (tight ? 'ok' : 'warn') + '">' + U.icon(tight ? 'check' : 'x') + '<div><b>' + (tight ? 'Watertight' : 'Not watertight') + '</b><span>' +
              (tight ? 'Every edge joins exactly two faces, so slicers can fill it.' : [M.topo.open ? U.fmtNum(M.topo.open, 0) + ' open edge' + (M.topo.open === 1 ? '' : 's') + ' (holes)' : '', M.topo.nonManifold ? U.fmtNum(M.topo.nonManifold, 0) + ' edge' + (M.topo.nonManifold === 1 ? '' : 's') + ' shared by 3+ faces' : ''].filter(Boolean).join(', ') + '. Most slicers can repair this.') + '</span></div></div>' +
            (M.inverted ? '<div class="stl-check warn">' + U.icon('reset') + '<div><b>Faces point inwards</b><span>The triangles are wound inside-out. Most slicers flip them automatically.</span></div></div>' : '') +
            (M.degenerate ? '<div class="stl-check warn">' + U.icon('x') + '<div><b>' + U.fmtNum(M.degenerate, 0) + ' zero-area triangle' + (M.degenerate === 1 ? '' : 's') + '</b><span>Harmless for viewing; slicers usually drop them.</span></div></div>' : '') +
            '<p class="section-label" style="margin-top:18px">Estimated weight</p>' +
            '<div class="field-inline"><select class="select-input sm" id="stlMat" style="width:auto">' +
              [['PLA', 1.24], ['PETG', 1.27], ['ABS', 1.04], ['ASA', 1.07], ['TPU', 1.21], ['Nylon', 1.14], ['Resin', 1.10]].map(function (m) { return '<option value="' + m[1] + '"' + (Math.abs(prefs.density - m[1]) < 1e-9 ? ' selected' : '') + '>' + m[0] + ' · ' + m[1] + ' g/cm³</option>'; }).join('') +
            '</select></div>' +
            '<dl class="kv" style="margin-top:10px"><dt>Solid (100%)</dt><dd><b>' + U.fmtNum(wt, 1) + ' g</b></dd><dt>Typical print</dt><dd>≈ ' + U.fmtNum(estimatePrint(vol, M.area / 100, prefs.density), 1) + ' g <span class="muted">(2 walls, 15% infill)</span></dd></dl>' +
          '</div>';
        U.seg(U.$('#stlUnits', info), prefs.units, function (v) { prefs.units = v; savePrefs(); paintInfo(); });
        U.$('#stlMat', info).addEventListener('change', function (e) { prefs.density = +e.target.value; savePrefs(); paintInfo(); });
      }
      // A rough printed weight: a 0.8 mm shell over the surface plus 15% of the rest.
      function estimatePrint(volCm3, areaCm2, density) {
        var shell = Math.min(volCm3, areaCm2 * 0.08);
        return (shell + Math.max(0, volCm3 - shell) * 0.15) * density;
      }

      /* ----- Loading ----- */
      function showBusy(text) { busy.hidden = !text; if (text) U.$('#stlBusyText', busy).textContent = text; }
      function load(file) {
        if (!file) return;
        if (file.size > 800 * 1048576) { U.toast('That file is over 800 MB, which is too large to view in a browser'); return; }
        showBusy('Reading ' + file.name + '…');
        file.arrayBuffer().then(function (buf) {
          showBusy('Building the model…');
          var t0 = performance.now();
          return new Promise(function (r) { setTimeout(r, 30); }).then(function () { return parseModel(file.name, buf); }).then(function (parsed) {
            var g = analyse(parsed.positions);
            var size = [g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2]];
            var c = [(g.max[0] + g.min[0]) / 2, (g.max[1] + g.min[1]) / 2, (g.max[2] + g.min[2]) / 2];
            var centered = new Float32Array(parsed.positions.length);
            for (var i = 0; i < centered.length; i += 3) { centered[i] = parsed.positions[i] - c[0]; centered[i + 1] = parsed.positions[i + 1] - c[1]; centered[i + 2] = parsed.positions[i + 2] - c[2]; }
            var topo = topology(parsed.positions, Math.max(size[0], size[1], size[2]));
            M = { file: file.name, bytes: file.size, format: parsed.format, name: parsed.name, triangles: parsed.triangles, centered: centered, normals: g.normals, size: size,
              area: g.area, volume: g.volume, inverted: g.inverted, degenerate: g.degenerate, topo: topo, smooth: null };
            if (prefs.smooth) M.smooth = M.triangles <= 3000000 ? smoothNormals(M.normals, topo.vid, topo.vertices) : null;
            U.store.set('stl-last', { name: file.name });
            upload(); setView('iso'); fit('iso');
            drop.hidden = true; showBusy(null); paintInfo();
            U.toast((parsed.note ? parsed.note + '. ' : '') + 'Loaded ' + U.fmtNum(M.triangles, 0) + ' triangles in ' + Math.round(performance.now() - t0) + ' ms', { duration: parsed.note ? 6000 : 2400 });
          });
        }).catch(function (err) { showBusy(null); U.toast(err.message || 'Could not open that file', { duration: 6000 }); });
      }

      /* ----- Events ----- */
      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          var act = a.dataset.act;
          if (act === 'open') U.pickFile('.stl,.obj,.3mf,model/stl,model/obj,model/3mf,application/sla').then(load);
          if (act === 'sample') load(sampleSTL());
          if (act === 'fit') { setView('iso'); fit('iso'); }
          if (act === 'shot') {
            if (!M) { U.toast('Open a model first'); return; }
            dirty = true; draw(performance.now());
            canvas.toBlob(function (b) {
              var url = URL.createObjectURL(b), l = document.createElement('a');
              l.href = url; l.download = M.file.replace(/\.(stl|obj|3mf)$/i, '') + '.png'; document.body.appendChild(l); l.click(); l.remove();
              setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            });
          }
          return;
        }
        var t = e.target.closest('[data-tog]');
        if (t) { toggle(t.dataset.tog); return; }
        var c = e.target.closest('[data-color]');
        if (c) { prefs.color = c.dataset.color; savePrefs(); paintToggles(); dirty = true; }
      });
      stage.addEventListener('dragover', function (e) { e.preventDefault(); stage.classList.add('over'); });
      stage.addEventListener('dragleave', function (e) { if (!stage.contains(e.relatedTarget)) stage.classList.remove('over'); });
      stage.addEventListener('drop', function (e) { e.preventDefault(); stage.classList.remove('over'); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) load(f); });
      function onKey(e) {
        if (U.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open') || !M) return;
        var k = e.key.toLowerCase();
        if (k === 'r') { setView('iso'); fit('iso'); }
        else if (k === 'w') { var order = ['shaded', 'both', 'wire']; prefs.mode = order[(order.indexOf(prefs.mode) + 1) % 3]; savePrefs(); U.$$('#stlMode button', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === prefs.mode)); }); dirty = true; }
        else if (k === 'a') toggle('spin');
        else if (k === 'g') toggle('grid');
        else return;
        e.preventDefault();
      }
      document.addEventListener('keydown', onKey);

      paintInfo();
      if (M) { drop.hidden = true; upload(); fit('iso'); }

      return function () {
        alive = false; cancelAnimationFrame(anim); ro.disconnect(); mo.disconnect();
        document.removeEventListener('keydown', onKey);
        var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      };
    }
  });

  U.stl = { parseSTL: parseSTL, analyse: analyse, topology: topology, sampleSTL: sampleSTL };
})();
