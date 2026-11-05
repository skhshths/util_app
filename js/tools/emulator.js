/* =========================================================================
   Tool: Site emulator
   Enter any link and see the page running inside device frames: phones,
   tablets, laptops and desktops, rotated, zoomed, or several side by side.
   Pages load directly in a sandboxed iframe (no proxy), so they behave as
   they would on that screen size. Sites that forbid being framed (via
   X-Frame-Options or CSP frame-ancestors) cannot be shown; the tool says
   so and offers to open them in a normal tab.
   ========================================================================= */
(function () {
  'use strict';

  var DEVICES = [
    { id: 'iphone15', name: 'iPhone 15', w: 393, h: 852, type: 'phone' },
    { id: 'iphonese', name: 'iPhone SE', w: 375, h: 667, type: 'phone' },
    { id: 'pixel8', name: 'Pixel 8', w: 412, h: 915, type: 'phone' },
    { id: 'galaxy', name: 'Galaxy S24', w: 360, h: 780, type: 'phone' },
    { id: 'ipadmini', name: 'iPad mini', w: 744, h: 1133, type: 'tablet' },
    { id: 'ipad', name: 'iPad', w: 820, h: 1180, type: 'tablet' },
    { id: 'ipadpro', name: 'iPad Pro 12.9"', w: 1024, h: 1366, type: 'tablet' },
    { id: 'laptop', name: 'Laptop', w: 1280, h: 800, type: 'laptop' },
    { id: 'desktop', name: 'Desktop', w: 1440, h: 900, type: 'desktop' },
    { id: 'fhd', name: 'Full HD', w: 1920, h: 1080, type: 'desktop' },
    { id: 'custom', name: 'Custom', w: 1024, h: 768, type: 'desktop' }
  ];
  var COMPARE = ['iphone15', 'ipad', 'desktop'];
  // Sites well known to refuse being shown inside other pages.
  var BLOCKS_FRAMING = ['google.', 'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'github.com',
    'reddit.com', 'linkedin.com', 'amazon.', 'netflix.com', 'discord.com', 'openai.com', 'chatgpt.com', 'claude.ai', 'microsoft.com', 'live.com',
    'office.com', 'apple.com', 'icloud.com', 'paypal.com', 'twitch.tv', 'spotify.com', 'whatsapp.com', 'snapchat.com', 'pinterest.com', 'yahoo.com', 'bing.com'];

  var prefs = Object.assign({ url: '', device: 'iphone15', rotate: false, zoom: 'fit', compare: false, frame: true, recent: [], customW: 1024, customH: 768 }, U.store.get('emulator', {}));
  function save() { U.store.set('emulator', prefs); }

  function normalize(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (!/^[^\s/]+\.[^\s/]+/.test(s) && !/^localhost(:\d+)?(\/|$)/.test(s)) return { error: 'That does not look like a web address. Try something like example.com.' };
      s = (/^localhost/.test(s) ? 'http://' : 'https://') + s;
    }
    var u;
    try { u = new URL(s); } catch (e) { return { error: 'That is not a valid web address.' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https links can be shown.' };
    return { url: u.href, host: u.hostname };
  }
  function knownBlocked(host) {
    host = host.replace(/^www\./, '');
    return BLOCKS_FRAMING.some(function (d) { return d.slice(-1) === '.' ? host.indexOf(d) === 0 || host.indexOf('.' + d) !== -1 : host === d || host.slice(-d.length - 1) === '.' + d; });
  }
  function device(id) {
    var d = DEVICES.filter(function (x) { return x.id === id; })[0] || DEVICES[0];
    if (d.id === 'custom') d = Object.assign({}, d, { w: prefs.customW, h: prefs.customH });
    return d;
  }
  function dims(d) { return prefs.rotate ? { w: d.h, h: d.w } : { w: d.w, h: d.h }; }

  U.register({
    id: 'emulator',
    name: 'Site emulator',
    desc: 'Open any link inside phone, tablet, laptop and desktop frames. Rotate, zoom, or compare several screen sizes side by side.',
    hue: 190,
    icon: 'devices',
    keywords: ['emulator', 'simulator', 'responsive', 'device', 'mobile', 'phone', 'tablet', 'preview', 'website', 'browser', 'link', 'url', 'viewport', 'iframe'],
    shortcuts: [['Focus the address bar', ['/']], ['Rotate', ['O']], ['Compare devices', ['C']]],
    homeStat: function () {
      if (!prefs.url) return '';
      var h = ''; try { h = new URL(prefs.url).hostname; } catch (e) {}
      return '<span class="dot"></span>Last: <b>' + U.esc(h) + '</b> on ' + U.esc(prefs.compare ? '3 devices' : device(prefs.device).name);
    },
    mount: function (root) {
      // Shared link: #/emulator?u=https://example.com&d=ipad
      var q = new URLSearchParams(location.hash.split('?')[1] || '');
      if (q.get('u')) { var n0 = normalize(q.get('u')); if (n0 && n0.url) prefs.url = n0.url; }
      if (q.get('d') && DEVICES.some(function (x) { return x.id === q.get('d'); })) { prefs.device = q.get('d'); prefs.compare = false; }
      if (q.get('d') === 'compare') prefs.compare = true;

      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('devices') + '</span>Site emulator</h1>' +
          '<p>See how any web page looks and works on different screens.</p>' +
        '</div></div>' +
        '<section class="panel em-bar">' +
          '<form class="em-url" id="emForm" autocomplete="off">' +
            '<span class="em-lock" id="emLock">' + U.icon('search') + '</span>' +
            '<input id="emInput" type="text" inputmode="url" spellcheck="false" placeholder="Enter any link, e.g. example.com" aria-label="Web address">' +
            '<button class="icon-btn sm" type="button" data-act="reload" title="Reload" aria-label="Reload">' + U.icon('reset') + '</button>' +
            '<button class="btn btn-primary btn-sm" type="submit">Go</button>' +
          '</form>' +
          '<div class="em-row">' +
            '<select class="select-input sm" id="emDevice" aria-label="Device" style="width:auto">' +
              ['phone', 'tablet', 'laptop', 'desktop'].map(function (t) {
                return '<optgroup label="' + t[0].toUpperCase() + t.slice(1) + 's">' + DEVICES.filter(function (d) { return d.type === t && d.id !== 'custom'; }).map(function (d) { return '<option value="' + d.id + '">' + d.name + ' · ' + d.w + '×' + d.h + '</option>'; }).join('') + '</optgroup>';
              }).join('') + '<option value="custom">Custom size…</option></select>' +
            '<span class="em-custom" id="emCustom"><input class="text-input sm" type="number" id="emW" min="200" max="3840" aria-label="Width"><span class="muted">×</span><input class="text-input sm" type="number" id="emH" min="200" max="3840" aria-label="Height"></span>' +
            '<button class="btn btn-ghost btn-sm" data-act="rotate" id="emRotate" title="Rotate (O)">' + U.icon('reset') + 'Rotate</button>' +
            '<select class="select-input sm" id="emZoom" aria-label="Zoom" style="width:auto"><option value="fit">Fit to screen</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option></select>' +
            '<button class="stl-tog" data-tog="compare" title="Phone, tablet and desktop side by side (C)">Compare devices</button>' +
            '<button class="stl-tog" data-tog="frame">Device frame</button>' +
            '<span class="em-spacer"></span>' +
            '<button class="btn btn-ghost btn-sm" data-act="share" title="Copy a link to this view">' + U.icon('link') + 'Share</button>' +
            '<a class="btn btn-soft btn-sm" id="emOpen" target="_blank" rel="noopener">' + U.icon('external') + 'Open in new tab</a>' +
          '</div>' +
          '<div class="em-recent" id="emRecent"></div>' +
        '</section>' +
        '<div class="em-stage" id="emStage"></div>' +
        '<p class="em-hint">' + U.icon('key') + '<span>Pages run in a sandboxed frame at the device’s screen size, so layouts, menus and scripts respond as they would on that screen. The browser itself is still yours: sites see your browser, not the device’s. Some sites refuse to be shown inside other pages (most big apps and anything with a login, like Google, YouTube or banks). Those show an error or a blank frame here, so use <b>Open in new tab</b>.</span></p>';

      var stage = U.$('#emStage', root), input = U.$('#emInput', root), sel = U.$('#emDevice', root), zoom = U.$('#emZoom', root);
      var cw = U.$('#emW', root), ch = U.$('#emH', root), custom = U.$('#emCustom', root);
      var alive = true, loadToken = 0;
      input.value = prefs.url;
      sel.value = prefs.device; zoom.value = prefs.zoom;
      cw.value = prefs.customW; ch.value = prefs.customH;

      function paintControls() {
        custom.hidden = prefs.device !== 'custom' || prefs.compare;
        sel.disabled = prefs.compare;
        U.$$('[data-tog]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(!!prefs[b.dataset.tog])); });
        U.$('#emRotate', root).setAttribute('aria-pressed', String(prefs.rotate));
        var open = U.$('#emOpen', root);
        if (prefs.url) { open.href = prefs.url; open.removeAttribute('aria-disabled'); } else { open.removeAttribute('href'); open.setAttribute('aria-disabled', 'true'); }
        U.$('#emLock', root).innerHTML = U.icon(prefs.url ? (/^https:/.test(prefs.url) ? 'key' : 'x') : 'search');
        U.$('#emLock', root).title = prefs.url ? (/^https:/.test(prefs.url) ? 'Secure (https)' : 'Not secure (http)') : '';
        U.$('#emRecent', root).innerHTML = prefs.recent.length ? '<span class="muted">Recent</span>' + prefs.recent.map(function (u, i) {
          var host = u; try { host = new URL(u).host + (new URL(u).pathname !== '/' ? new URL(u).pathname : ''); } catch (e) {}
          return '<span class="em-chip"><button data-go="' + i + '" title="' + U.esc(u) + '">' + U.esc(host.length > 40 ? host.slice(0, 40) + '…' : host) + '</button><button data-forget="' + i + '" aria-label="Forget">' + U.icon('x') + '</button></span>';
        }).join('') : '';
      }

      /* ----- Rendering devices ----- */
      function frameHtml(d, idx) {
        var sz = dims(d);
        var chrome = prefs.frame ? d.type : 'none';
        var host = ''; try { host = new URL(prefs.url).host; } catch (e) {}
        return '<figure class="em-device em-' + chrome + (prefs.rotate ? ' landscape' : '') + '" data-idx="' + idx + '" data-w="' + sz.w + '" data-h="' + sz.h + '">' +
          '<div class="em-box"><div class="em-scale">' +
            '<div class="em-body">' +
              (chrome === 'laptop' || chrome === 'desktop' ? '<div class="em-titlebar"><i></i><i></i><i></i><span>' + U.esc(host) + '</span></div>' : '') +
              (chrome === 'phone' ? '<div class="em-notch"></div>' : '') +
              '<div class="em-viewport" style="width:' + sz.w + 'px;height:' + sz.h + 'px">' + viewportInner(idx) + '</div>' +
            '</div>' +
            (chrome === 'laptop' ? '<div class="em-base"></div>' : '') +
          '</div></div>' +
          '<figcaption>' + U.esc(d.name) + ' · ' + sz.w + '×' + sz.h + (prefs.rotate ? ' · landscape' : '') + ' <span class="em-scalepct"></span></figcaption>' +
        '</figure>';
      }
      function viewportInner(idx) {
        if (!prefs.url) return '<div class="em-msg">' + U.icon('devices') + '<b>Enter a link above</b><span>Try example.com, or your own site.</span></div>';
        var n = normalize(prefs.url);
        if (knownBlocked(n.host)) {
          return '<div class="em-msg">' + U.icon('x') + '<b>' + U.esc(n.host) + ' can’t be shown here</b><span>This site tells browsers not to display it inside other pages, so no emulator can frame it.</span>' +
            '<a class="btn btn-soft btn-sm" href="' + U.esc(n.url) + '" target="_blank" rel="noopener">' + U.icon('external') + 'Open in new tab</a></div>';
        }
        if (location.protocol === 'https:' && /^http:/.test(n.url) && !/^http:\/\/localhost/.test(n.url)) {
          return '<div class="em-msg">' + U.icon('x') + '<b>Insecure link</b><span>This page is served over https, and browsers block plain http pages inside it. Try the https version.</span>' +
            '<button class="btn btn-soft btn-sm" data-https>Use https://' + U.esc(n.host) + '</button></div>';
        }
        return '<iframe src="' + U.esc(n.url) + '" title="Page on device ' + idx + '" loading="eager" referrerpolicy="strict-origin-when-cross-origin" ' +
          'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-pointer-lock" ' +
          'allow="fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture"></iframe><div class="em-loading">Loading ' + U.esc(n.host) + '…</div>';
      }
      function render() {
        var list = prefs.compare ? COMPARE.map(device) : [device(prefs.device)];
        stage.classList.toggle('compare', prefs.compare);
        stage.innerHTML = list.map(frameHtml).join('');
        var token = ++loadToken;
        U.$$('iframe', stage).forEach(function (f) {
          f.addEventListener('load', function () {
            var l = f.nextElementSibling; if (l && l.classList.contains('em-loading')) l.remove();
          });
          setTimeout(function () {
            if (!alive || token !== loadToken) return;
            var l = f.nextElementSibling;
            if (l && l.classList.contains('em-loading')) l.innerHTML = 'Still loading… If it stays blank, the site may block being framed. <a href="' + U.esc(prefs.url) + '" target="_blank" rel="noopener">Open in new tab</a>';
          }, 8000);
        });
        layout();
        paintControls();
      }
      // Scales each device to fit the stage (or to the chosen zoom).
      function layout() {
        var figs = U.$$('.em-device', stage); if (!figs.length) return;
        var avail = stage.clientWidth - 56, availH = Math.max(360, window.innerHeight - stage.getBoundingClientRect().top - 40);
        var sizes = figs.map(function (f) {
          var body = U.$('.em-scale', f);
          body.style.transform = 'none';
          return { f: f, body: body, w: body.offsetWidth, h: body.offsetHeight };
        });
        var scale;
        if (prefs.zoom !== 'fit') scale = +prefs.zoom;
        else if (prefs.compare) {
          var total = sizes.reduce(function (a, s) { return a + s.w; }, 0) + 24 * (sizes.length - 1);
          var maxH = Math.max.apply(null, sizes.map(function (s) { return s.h; }));
          scale = Math.min(1, avail / total, (availH + 120) / maxH);
          if (stage.clientWidth < 700) scale = Math.min(1, avail / Math.max.apply(null, sizes.map(function (s) { return s.w; })));
        } else scale = Math.min(1, avail / sizes[0].w, availH / sizes[0].h);
        sizes.forEach(function (s) {
          // The transform does not change layout size, so the wrapper is sized to the scaled device.
          s.body.style.transform = 'scale(' + scale + ')';
          s.body.style.transformOrigin = 'top left';
          var box = U.$('.em-box', s.f);
          box.style.width = Math.round(s.w * scale) + 'px';
          box.style.height = Math.round(s.h * scale) + 'px';
          U.$('.em-scalepct', s.f).textContent = '· ' + Math.round(scale * 100) + '%';
        });
      }
      var ro = new ResizeObserver(U.debounce(layout, 60)); ro.observe(stage);

      /* ----- Navigation ----- */
      function go(raw) {
        var n = normalize(raw);
        if (!n) { input.focus(); return; }
        if (n.error) { U.toast(n.error); return; }
        prefs.url = n.url;
        prefs.recent = [n.url].concat(prefs.recent.filter(function (u) { return u !== n.url; })).slice(0, 8);
        save(); input.value = n.url; render();
      }
      U.$('#emForm', root).addEventListener('submit', function (e) { e.preventDefault(); go(input.value); input.blur(); });
      input.addEventListener('focus', function () { input.select(); });
      sel.addEventListener('change', function () { prefs.device = sel.value; save(); render(); });
      zoom.addEventListener('change', function () { prefs.zoom = zoom.value; save(); layout(); });
      [cw, ch].forEach(function (el) {
        el.addEventListener('change', function () {
          prefs.customW = Math.max(200, Math.min(3840, +cw.value || 1024)); prefs.customH = Math.max(200, Math.min(3840, +ch.value || 768));
          cw.value = prefs.customW; ch.value = prefs.customH; save(); render();
        });
      });
      function toggle(name) { prefs[name] = !prefs[name]; save(); render(); }
      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          if (a.dataset.act === 'reload') { if (prefs.url) render(); }
          if (a.dataset.act === 'rotate') toggle('rotate');
          if (a.dataset.act === 'share') {
            if (!prefs.url) { U.toast('Enter a link first'); return; }
            U.copy(location.origin + location.pathname + '#/emulator?u=' + encodeURIComponent(prefs.url) + '&d=' + (prefs.compare ? 'compare' : prefs.device), 'Link');
          }
          return;
        }
        var t = e.target.closest('[data-tog]'); if (t) { toggle(t.dataset.tog); return; }
        var g = e.target.closest('[data-go]'); if (g) { go(prefs.recent[+g.dataset.go]); return; }
        var f = e.target.closest('[data-forget]'); if (f) { prefs.recent.splice(+f.dataset.forget, 1); save(); paintControls(); return; }
        if (e.target.closest('[data-https]')) { go(prefs.url.replace(/^http:/, 'https:')); return; }
        var open = e.target.closest('#emOpen'); if (open && !prefs.url) e.preventDefault();
      });
      function onKey(e) {
        if (U.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open')) return;
        var k = e.key.toLowerCase();
        if (e.key === '/') { e.preventDefault(); input.focus(); }
        else if (k === 'o') { e.preventDefault(); toggle('rotate'); }
        else if (k === 'c') { e.preventDefault(); toggle('compare'); }
      }
      document.addEventListener('keydown', onKey);

      render();
      if (!prefs.url) input.focus();
      return function () { alive = false; ro.disconnect(); document.removeEventListener('keydown', onKey); };
    }
  });

  U.emulator = { normalize: normalize, knownBlocked: knownBlocked };
})();
