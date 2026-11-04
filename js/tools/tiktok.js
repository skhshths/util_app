/* =========================================================================
   Tool: TikTok viewer
   Paste TikTok video links into a saved list and watch them in a
   phone-shaped pane using TikTok's official embed player
   (https://www.tiktok.com/player/v1/{id}). The player is controlled
   through its postMessage API: play, pause, mute, and auto-advance when a
   video ends. TikTok does not allow signing in inside embeds, so signing
   in happens on tiktok.com in a normal tab.
   ========================================================================= */
(function () {
  'use strict';

  var ORIGIN = 'https://www.tiktok.com';
  var prefs = Object.assign({ list: [], current: 0, autoplay: true, loop: false, advance: true, muted: false, info: true }, U.store.get('tiktok', {}));
  function save() { U.store.set('tiktok', prefs); }

  // Accepts full video/photo links (www, m., with or without @user), or a bare numeric id.
  function parseLink(s) {
    s = String(s || '').trim();
    var m = /tiktok\.com\/@([\w.-]+)\/(video|photo)\/(\d{8,25})/i.exec(s);
    if (m) return { id: m[3], user: m[1], kind: m[2].toLowerCase(), url: 'https://www.tiktok.com/@' + m[1] + '/' + m[2].toLowerCase() + '/' + m[3] };
    m = /tiktok\.com\/(?:v|embed(?:\/v2)?|player\/v1)\/(\d{8,25})/i.exec(s);
    if (m) return { id: m[1], user: '', kind: 'video', url: 'https://www.tiktok.com/video/' + m[1] };
    if (/^\d{15,25}$/.test(s)) return { id: s, user: '', kind: 'video', url: 'https://www.tiktok.com/video/' + s };
    if (/(vm|vt)\.tiktok\.com\/|tiktok\.com\/t\//i.test(s)) return { short: true, url: s };
    return null;
  }

  function playerSrc(item) {
    var q = {
      autoplay: prefs.autoplay ? 1 : 0, loop: prefs.loop ? 1 : 0, music_info: prefs.info ? 1 : 0, description: prefs.info ? 1 : 0,
      rel: 0, controls: 1, progress_bar: 1, play_button: 1, volume_control: 1, fullscreen_button: 1, timestamp: 1, closed_caption: 1
    };
    return ORIGIN + '/player/v1/' + item.id + '?' + Object.keys(q).map(function (k) { return k + '=' + q[k]; }).join('&');
  }

  // Best-effort title/author/thumbnail from TikTok's public oEmbed endpoint.
  function enrich(item, done) {
    if (item.title || item.tried) return;
    item.tried = true;
    fetch(ORIGIN + '/oembed?url=' + encodeURIComponent(item.url)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      item.title = j.title || ''; item.author = j.author_name || ''; item.thumb = j.thumbnail_url || '';
      if (!item.user && j.author_unique_id) item.user = j.author_unique_id;
      save(); done();
    }).catch(function () { /* blocked or offline: the list still works without it */ });
  }

  U.register({
    id: 'tiktok',
    name: 'TikTok viewer',
    desc: 'Save TikTok video links and watch them back to back in a phone-sized player, with keyboard controls and auto-advance.',
    hue: 340,
    icon: 'video',
    keywords: ['tiktok', 'video', 'player', 'watch', 'playlist', 'queue', 'embed', 'clips'],
    shortcuts: [['Next / previous video', ['J', 'K']], ['Play / pause', ['Space']], ['Mute', ['M']]],
    homeStat: function () {
      return prefs.list.length ? '<span class="dot"></span><b>' + prefs.list.length + '</b> saved video' + (prefs.list.length === 1 ? '' : 's') : '';
    },
    mount: function (root) {
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('video') + '</span>TikTok viewer</h1>' +
          '<p>Paste TikTok video links to build a list, then watch them back to back.</p>' +
        '</div><div class="tool-head-actions">' +
          '<a class="btn btn-soft btn-sm" href="https://www.tiktok.com/login" target="_blank" rel="noopener" id="ttSignIn">' + U.icon('user') + 'Open TikTok to sign in</a>' +
        '</div></div>' +
        '<div class="tt-layout">' +
          '<section class="tt-stage">' +
            '<div class="tt-phone" id="ttPhone"><div class="tt-screen" id="ttScreen"></div></div>' +
            '<div class="tt-controls">' +
              '<button class="icon-btn" data-act="prev" title="Previous (K)" aria-label="Previous video">' + U.icon('arrowLeft', '') + '</button>' +
              '<button class="btn btn-soft btn-sm" data-act="play" id="ttPlay" title="Play / pause (Space)">' + U.icon('play') + '<span>Play</span></button>' +
              '<button class="btn btn-soft btn-sm" data-act="mute" id="ttMute" title="Mute (M)">' + U.icon('volume') + '<span>Mute</span></button>' +
              '<button class="icon-btn" data-act="next" title="Next (J)" aria-label="Next video">' + U.icon('arrowRight') + '</button>' +
            '</div>' +
            '<div class="tt-toggles">' +
              '<label class="check-label"><input type="checkbox" data-pref="autoplay">Autoplay</label>' +
              '<label class="check-label"><input type="checkbox" data-pref="advance">Play next when one ends</label>' +
              '<label class="check-label"><input type="checkbox" data-pref="loop">Loop each video</label>' +
              '<label class="check-label"><input type="checkbox" data-pref="info">Show caption &amp; music</label>' +
            '</div>' +
          '</section>' +
          '<section class="panel tt-side">' +
            '<div class="panel-head"><span class="panel-title">' + U.icon('lines') + 'Your list <span class="muted" id="ttCount"></span></span>' +
              '<div class="panel-actions"><button class="btn btn-ghost btn-sm" data-act="copyAll" title="Copy all links">' + U.icon('copy') + 'Copy</button><button class="btn btn-ghost btn-sm" data-act="clear">' + U.icon('trash') + 'Clear</button></div></div>' +
            '<div class="panel-body tt-add"><textarea class="text-area" id="ttInput" rows="2" placeholder="Paste one or more TikTok video links (one per line), then press Enter"></textarea>' +
              '<button class="btn btn-primary btn-sm" data-act="add">' + U.icon('plus') + 'Add</button></div>' +
            '<ol class="tt-list" id="ttList"></ol>' +
            '<div class="panel-foot tt-note">' + U.icon('key') + '<span>TikTok does not allow signing in inside embedded players, so likes, comments and your For You feed are not available here. Use <b>Open TikTok to sign in</b> to use your account in a normal tab, where TikTok and your browser decide how long you stay signed in.</span></div>' +
          '</section>' +
        '</div>';

      var screen = U.$('#ttScreen', root), listEl = U.$('#ttList', root), input = U.$('#ttInput', root);
      var frame = null, ready = false, playing = false, alive = true;

      U.$$('[data-pref]', root).forEach(function (cb) {
        cb.checked = !!prefs[cb.dataset.pref];
        cb.addEventListener('change', function () {
          prefs[cb.dataset.pref] = cb.checked; save();
          if (cb.dataset.pref !== 'advance') load(true);
        });
      });

      /* ----- Player ----- */
      function current() { return prefs.list[prefs.current]; }
      function load(keepPosition) {
        var item = current();
        ready = false; playing = false; paintButtons();
        if (!item) {
          screen.innerHTML = '<div class="tt-empty">' + U.icon('video') + '<b>No video yet</b><span>Paste a TikTok link on the right to start watching.</span></div>';
          frame = null; paintList(); return;
        }
        screen.innerHTML = '<iframe id="ttFrame" title="TikTok video" src="' + U.esc(playerSrc(item)) + '" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
          '<div class="tt-loading" id="ttLoading">Loading video…</div>';
        frame = U.$('#ttFrame', screen);
        // If the player never reports ready (blocked network, removed video), say so.
        var shown = item.id;
        setTimeout(function () {
          if (!alive || ready || !current() || current().id !== shown) return;
          var l = U.$('#ttLoading', screen);
          if (l) l.innerHTML = 'Still loading. If nothing appears, the video may be private or removed, or TikTok may be blocked on this network. <a href="' + U.esc(item.url) + '" target="_blank" rel="noopener">Open on TikTok</a>';
        }, 9000);
        paintList();
        if (!keepPosition) { var li = listEl.children[prefs.current]; if (li) li.scrollIntoView({ block: 'nearest' }); }
        enrich(item, paintList);
      }
      function send(type, value) {
        if (!frame || !frame.contentWindow) return;
        var msg = { type: type, 'x-tiktok-player': true };
        if (value !== undefined) msg.value = value;
        frame.contentWindow.postMessage(msg, ORIGIN);
      }
      function onMessage(e) {
        if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow) return;
        var d = e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
        if (!d || !d['x-tiktok-player']) return;
        if (d.type === 'onPlayerReady') {
          ready = true;
          var l = U.$('#ttLoading', screen); if (l) l.remove();
          if (prefs.muted) send('mute');
        } else if (d.type === 'onStateChange') {
          playing = d.value === 1;
          if (d.value === 0 && prefs.advance && !prefs.loop && prefs.current < prefs.list.length - 1) step(1);
        } else if (d.type === 'onMute') {
          prefs.muted = !!d.value; save();
        } else if (d.type === 'onError') {
          var l2 = U.$('#ttLoading', screen);
          if (l2) l2.textContent = 'This video could not be played. It may be private or removed.';
        }
        paintButtons();
      }
      window.addEventListener('message', onMessage);
      function step(n) {
        if (!prefs.list.length) return;
        var i = prefs.current + n;
        if (i < 0 || i >= prefs.list.length) { U.toast(i < 0 ? 'This is the first video' : 'End of your list'); return; }
        prefs.current = i; save(); load();
      }
      function togglePlay() { send(playing ? 'pause' : 'play'); playing = !playing; paintButtons(); }
      function toggleMute() { prefs.muted = !prefs.muted; save(); send(prefs.muted ? 'mute' : 'unMute'); paintButtons(); }
      function paintButtons() {
        var p = U.$('#ttPlay', root), m = U.$('#ttMute', root);
        if (p) p.innerHTML = U.icon(playing ? 'pause' : 'play') + '<span>' + (playing ? 'Pause' : 'Play') + '</span>';
        if (m) m.innerHTML = U.icon(prefs.muted ? 'volumeOff' : 'volume') + '<span>' + (prefs.muted ? 'Unmute' : 'Mute') + '</span>';
      }

      /* ----- List ----- */
      function paintList() {
        U.$('#ttCount', root).textContent = prefs.list.length ? '· ' + prefs.list.length : '';
        listEl.innerHTML = prefs.list.map(function (it, i) {
          var who = it.author || (it.user ? '@' + it.user : 'TikTok ' + it.kind);
          return '<li class="tt-item' + (i === prefs.current ? ' on' : '') + '" data-i="' + i + '">' +
            '<button class="tt-pick" data-pick="' + i + '">' +
              (it.thumb ? '<img src="' + U.esc(it.thumb) + '" alt="" loading="lazy">' : '<span class="tt-thumb">' + U.icon(i === prefs.current ? 'play' : 'video') + '</span>') +
              '<span class="tt-text"><b>' + U.esc(it.title || (it.kind === 'photo' ? 'Photo post ' : 'Video ') + it.id.slice(-6)) + '</b><small>' + U.esc(who) + '</small></span>' +
            '</button>' +
            '<span class="tt-actions">' +
              '<button class="icon-btn sm" data-move="-1" title="Move up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + U.icon('arrowLeft', 'rot90') + '</button>' +
              '<a class="icon-btn sm" href="' + U.esc(it.url) + '" target="_blank" rel="noopener" title="Open on TikTok" aria-label="Open on TikTok">' + U.icon('external') + '</a>' +
              '<button class="icon-btn sm danger" data-del title="Remove" aria-label="Remove">' + U.icon('x') + '</button>' +
            '</span></li>';
        }).join('') || '<li class="tt-hint">Your list is empty. Copy a link from TikTok (<b>Share → Copy link</b>) and paste it above.</li>';
      }
      function add(text) {
        var added = 0, short = 0, bad = 0, dup = 0;
        text.split(/[\s,]+/).filter(Boolean).forEach(function (t) {
          var p = parseLink(t);
          if (!p) { bad++; return; }
          if (p.short) { short++; return; }
          if (prefs.list.some(function (x) { return x.id === p.id; })) { dup++; return; }
          prefs.list.push(p); added++;
        });
        save();
        var wasEmpty = prefs.list.length === added;
        if (added && wasEmpty) { prefs.current = 0; save(); load(); } else paintList();
        prefs.list.forEach(function (it) { enrich(it, paintList); });
        var msg = [];
        if (added) msg.push('Added ' + added + ' video' + (added === 1 ? '' : 's'));
        if (dup) msg.push(dup + ' already in the list');
        if (short) msg.push(short + ' short link' + (short === 1 ? '' : 's') + ' (vm.tiktok.com) can’t be read here: open ' + (short === 1 ? 'it' : 'them') + ' once and copy the full address');
        if (bad) msg.push(bad + ' not a TikTok video link');
        if (msg.length) U.toast(msg.join('. '), { duration: short || bad ? 7000 : 2400 });
        return added;
      }

      /* ----- Events ----- */
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.value.trim() && add(input.value) !== undefined) input.value = ''; }
      });
      input.addEventListener('paste', function () { setTimeout(function () { if (/tiktok\.com/i.test(input.value) && /\n|\s/.test(input.value.trim()) === false) { add(input.value); input.value = ''; } }, 0); });
      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          var act = a.dataset.act;
          if (act === 'add') { if (input.value.trim()) { add(input.value); input.value = ''; } else input.focus(); }
          if (act === 'prev') step(-1);
          if (act === 'next') step(1);
          if (act === 'play') togglePlay();
          if (act === 'mute') toggleMute();
          if (act === 'copyAll') U.copy(prefs.list.map(function (x) { return x.url; }).join('\n'), 'Links');
          if (act === 'clear') {
            if (!prefs.list.length) return;
            var old = prefs.list.slice(), oc = prefs.current;
            prefs.list = []; prefs.current = 0; save(); load();
            U.toast('List cleared', { action: 'Undo', onAction: function () { prefs.list = old; prefs.current = oc; save(); load(); } });
          }
          return;
        }
        var li = e.target.closest('.tt-item'); if (!li) return;
        var i = +li.dataset.i;
        if (e.target.closest('[data-pick]')) { prefs.current = i; save(); load(true); return; }
        if (e.target.closest('[data-del]')) {
          var gone = prefs.list.splice(i, 1)[0];
          var wasCurrent = i === prefs.current;
          if (i < prefs.current || (wasCurrent && prefs.current >= prefs.list.length)) prefs.current = Math.max(0, prefs.current - 1);
          save(); if (wasCurrent) load(); else paintList();
          U.toast('Removed', { action: 'Undo', onAction: function () { prefs.list.splice(i, 0, gone); save(); paintList(); } });
          return;
        }
        var mv = e.target.closest('[data-move]');
        if (mv && i > 0) {
          var it = prefs.list.splice(i, 1)[0]; prefs.list.splice(i - 1, 0, it);
          if (prefs.current === i) prefs.current = i - 1; else if (prefs.current === i - 1) prefs.current = i;
          save(); paintList();
        }
      });
      function onKey(e) {
        if (U.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open')) return;
        var k = e.key.toLowerCase();
        if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        else if (k === 'm') { e.preventDefault(); toggleMute(); }
      }
      document.addEventListener('keydown', onKey);

      if (prefs.current >= prefs.list.length) prefs.current = 0;
      load();
      paintButtons();
      return function () { alive = false; window.removeEventListener('message', onMessage); document.removeEventListener('keydown', onKey); };
    }
  });

  U.tiktok = { parseLink: parseLink, playerSrc: playerSrc };
})();
