/* =========================================================================
   MD5 (RFC 1321) over a Uint8Array. Web Crypto does not offer MD5, so the
   encoder toolbox uses this. Returns a lowercase hex string.
   ========================================================================= */
(function () {
  'use strict';

  var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K = new Int32Array(64);
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

  function md5(bytes) {
    var len = bytes.length;
    var padded = ((len + 8) >>> 6) + 1 << 6;
    var buf = new Uint8Array(padded);
    buf.set(bytes);
    buf[len] = 0x80;
    var bitLen = len * 8;
    var dv = new DataView(buf.buffer);
    dv.setUint32(padded - 8, bitLen >>> 0, true);
    dv.setUint32(padded - 4, Math.floor(bitLen / 4294967296), true);

    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    var M = new Int32Array(16);
    for (var off = 0; off < padded; off += 64) {
      for (var j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);
      var A = a0, B = b0, C = c0, D = d0;
      for (var k = 0; k < 64; k++) {
        var F, g;
        if (k < 16) { F = (B & C) | (~B & D); g = k; }
        else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) & 15; }
        else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * k) & 15; }
        F = (F + A + K[k] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << S[k]) | (F >>> (32 - S[k])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new DataView(new ArrayBuffer(16));
    out.setInt32(0, a0, true); out.setInt32(4, b0, true); out.setInt32(8, c0, true); out.setInt32(12, d0, true);
    var hex = '';
    for (var m = 0; m < 16; m++) hex += (out.getUint8(m) + 256).toString(16).slice(1);
    return hex;
  }

  window.md5 = md5;
})();
