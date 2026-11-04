/* =========================================================================
   Tool: Repo changelog
   Pull commits from one or more GitHub repositories and compare them side
   by side: a timeline with one column per repo (days lined up across
   repos), a changelog grouped by version and change type, and activity
   stats. Click any commit to see its files and diff.
   Uses the public GitHub REST API from the browser. An optional token
   (kept in this browser only) raises the rate limit and allows private repos.
   ========================================================================= */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var HUES = [255, 25, 150, 300, 65, 200, 340, 105];
  var RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All']];

  var prefs = Object.assign({ repos: [], range: '30', view: 'timeline', hideMerges: true, max: 300 }, U.store.get('changelog', {}));
  function savePrefs() { U.store.set('changelog', prefs); }
  function getToken() { return U.store.get('changelog-token', ''); }

  /* ---------- GitHub API with ETag caching ---------- */
  var cache = {};                        // url -> { etag, data, link }
  var rate = { remaining: null, limit: null, reset: null };
  function GhError(msg, kind) { this.message = msg; this.kind = kind; }

  async function gh(path) {
    var url = path.indexOf('http') === 0 ? path : API + path;
    var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    var tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    var hit = cache[url];
    if (hit && hit.etag) headers['If-None-Match'] = hit.etag;   // 304s do not count against the rate limit
    var res;
    try { res = await fetch(url, { headers: headers }); }
    catch (e) { throw new GhError('Could not reach GitHub. Check your connection.', 'network'); }
    if (res.headers.get('x-ratelimit-remaining') != null) {
      rate.remaining = +res.headers.get('x-ratelimit-remaining');
      rate.limit = +res.headers.get('x-ratelimit-limit');
      rate.reset = +res.headers.get('x-ratelimit-reset') * 1000;
    }
    if (res.status === 304 && hit) return hit;
    if (res.status === 404) throw new GhError('Not found. Check the name, or add a token if it is private.', 'notfound');
    if (res.status === 409) return { data: [], link: '' };            // empty repository
    if (res.status === 401) throw new GhError('GitHub rejected the token. Check or remove it in Settings.', 'auth');
    if (res.status === 403 || res.status === 429) {
      if (rate.remaining === 0) throw new GhError('GitHub rate limit reached. It resets ' + U.relTime(rate.reset) + '. Add a token in Settings for 5,000 requests an hour.', 'rate');
      var j403 = null; try { j403 = await res.json(); } catch (e) {}
      throw new GhError((j403 && j403.message) || 'GitHub refused the request.', 'forbidden');
    }
    if (!res.ok) throw new GhError('GitHub error ' + res.status, 'http');
    var entry = { etag: res.headers.get('etag'), data: await res.json(), link: res.headers.get('link') || '' };
    cache[url] = entry;
    return entry;
  }

  /* ---------- Parsing input ---------- */
  function parseRepo(s) {
    s = String(s || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
    var m = /github\.com[/:]([\w.-]+)\/([\w.-]+)/i.exec(s) || /^([\w.-]+)\/([\w.-]+)$/.exec(s);
    return m ? m[1] + '/' + m[2] : null;
  }

  /* ---------- Commit categories ---------- */
  var CATS = [
    ['feat', 'Features'], ['fix', 'Fixes'], ['perf', 'Performance'], ['refactor', 'Refactoring'], ['docs', 'Docs'],
    ['test', 'Tests'], ['build', 'Build & CI'], ['chore', 'Chores'], ['revert', 'Reverts'], ['merge', 'Merges'], ['other', 'Other changes']
  ];
  var CAT_NAME = {}; CATS.forEach(function (c) { CAT_NAME[c[0]] = c[1]; });
  var CAT_HUE = { feat: 150, fix: 25, perf: 300, refactor: 200, docs: 255, test: 85, build: 60, chore: 0, revert: 340, merge: 0, other: 0 };
  function categorize(title, body, parents) {
    var cc = /^(\w+)(\([^)]*\))?(!)?:\s*/.exec(title);
    var breaking = !!(cc && cc[3]) || /BREAKING[ -]CHANGE/.test(body || '');
    var t = cc ? cc[1].toLowerCase() : '';
    var map = { feat: 'feat', feature: 'feat', fix: 'fix', bugfix: 'fix', hotfix: 'fix', perf: 'perf', refactor: 'refactor', docs: 'docs', doc: 'docs', test: 'test', tests: 'test', build: 'build', ci: 'build', chore: 'chore', style: 'chore', deps: 'chore', revert: 'revert' };
    var cat = map[t];
    if (!cat) {
      if (parents > 1 || /^merge\b/i.test(title)) cat = 'merge';
      else if (/^revert\b/i.test(title)) cat = 'revert';
      else if (/^(add|adds|added|implement|implements|introduce|introduces|create|creates|new|support|allow|enable)\b/i.test(title)) cat = 'feat';
      else if (/^(fix|fixes|fixed|bug|resolve|resolves|correct|repair|patch|handle)\b/i.test(title)) cat = 'fix';
      else if (/^(refactor|clean|cleanup|tidy|simplify|rename|move|restructure|extract)\b/i.test(title)) cat = 'refactor';
      else if (/^(doc|docs|readme|document|update readme|comment)\b/i.test(title) || /\breadme\b/i.test(title)) cat = 'docs';
      else if (/^(test|tests|add tests?)\b/i.test(title)) cat = 'test';
      else if (/^(bump|upgrade|update dependenc|deps|ci|build|release|version)\b/i.test(title)) cat = 'build';
      else if (/^(speed up|optimi[sz]e|faster|perf)\b/i.test(title)) cat = 'perf';
      else cat = 'other';
    }
    return { cat: cat, breaking: breaking, clean: cc ? title.slice(cc[0].length) : title, scope: cc && cc[2] ? cc[2].slice(1, -1) : '' };
  }

  /* ---------- Loading a repository ---------- */
  function rangeDates() {
    if (prefs.range === 'all') return { since: null, until: null };
    if (prefs.range === 'custom') return { since: prefs.since ? new Date(prefs.since + 'T00:00:00') : null, until: prefs.until ? new Date(prefs.until + 'T23:59:59') : null };
    return { since: new Date(Date.now() - (+prefs.range) * 86400000), until: null };
  }
  async function loadRepo(full, onPage) {
    var info = (await gh('/repos/' + full)).data;
    var r = rangeDates(), commits = [], page = 1, max = prefs.max;
    var q = '?per_page=100' + (r.since ? '&since=' + r.since.toISOString() : '') + (r.until ? '&until=' + r.until.toISOString() : '');
    var url = '/repos/' + full + '/commits' + q, truncated = false;
    while (url) {
      var resp = await gh(url);
      resp.data.forEach(function (c) {
        if (commits.length >= max) { truncated = true; return; }
        var msg = c.commit.message || '', nl = msg.indexOf('\n');
        var title = nl === -1 ? msg : msg.slice(0, nl), body = nl === -1 ? '' : msg.slice(nl + 1).trim();
        var parents = (c.parents || []).length;
        var date = c.commit.author && c.commit.author.date || c.commit.committer && c.commit.committer.date;
        commits.push({
          sha: c.sha, title: title, body: body, url: c.html_url, parents: parents, date: new Date(date),
          author: { name: (c.commit.author && c.commit.author.name) || 'Unknown', login: c.author && c.author.login, avatar: c.author && c.author.avatar_url },
          kind: categorize(title, body, parents)
        });
      });
      if (onPage) onPage(commits.length);
      var next = /<([^>]+)>;\s*rel="next"/.exec(resp.link);
      url = next && commits.length < max ? next[1] : null;
      if (next && commits.length >= max) truncated = true;
      if (++page > 20) break;
    }
    var tags = {};
    try {
      var tr = await gh('/repos/' + full + '/tags?per_page=100');
      tr.data.forEach(function (t) { (tags[t.commit.sha] = tags[t.commit.sha] || []).push(t.name); });
    } catch (e) { /* tags are optional */ }
    return { full: info.full_name || full, info: info, commits: commits, tags: tags, truncated: truncated };
  }

  /* ---------- Tool ---------- */
  var S = { data: [], errors: {}, loading: false, key: '' };   // survives navigating away

  U.register({
    id: 'changelog',
    name: 'Repo changelog',
    desc: 'Compare the commits of one or more GitHub repos side by side, as a timeline, a changelog by version and type, or activity stats.',
    hue: 220,
    icon: 'gitCompare',
    keywords: ['github', 'git', 'commits', 'changelog', 'repo', 'repository', 'compare', 'history', 'timeline', 'release notes', 'diff'],
    shortcuts: [['Load / refresh', ['Enter']]],
    homeStat: function () {
      if (S.data.length) return '<span class="dot"></span><b>' + S.data.length + '</b> repo' + (S.data.length === 1 ? '' : 's') + ' · ' + U.fmtNum(S.data.reduce(function (a, r) { return a + r.commits.length; }, 0), 0) + ' commits';
      return prefs.repos.length ? '<span class="dot"></span>' + U.esc(prefs.repos.slice(0, 2).join(', ')) + (prefs.repos.length > 2 ? ' +' + (prefs.repos.length - 2) : '') : '';
    },
    mount: function (root) {
      // A shared link (#/changelog?r=a/b,c/d&d=30) overrides saved repos.
      var hq = (location.hash.split('?')[1] || '');
      var params = new URLSearchParams(hq);
      if (params.get('r')) {
        prefs.repos = params.get('r').split(',').map(parseRepo).filter(Boolean).slice(0, 8);
        if (params.get('d')) prefs.range = params.get('d');
        if (params.get('since')) { prefs.range = 'custom'; prefs.since = params.get('since'); prefs.until = params.get('until') || ''; }
        savePrefs();
      }

      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('gitCompare') + '</span>Repo changelog</h1>' +
          '<p>Add one or more GitHub repositories to see their commits side by side.</p>' +
        '</div><div class="tool-head-actions">' +
          '<button class="btn btn-ghost btn-sm" data-act="share" title="Copy a link to this comparison">' + U.icon('link') + 'Share</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="token">' + U.icon('key') + 'Token</button>' +
        '</div></div>' +
        '<section class="panel cl-controls">' +
          '<div class="cl-repos" id="clRepos"></div>' +
          '<div class="cl-row">' +
            '<div class="seg" id="clRange">' + RANGES.map(function (r) { return '<button data-v="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '<button data-v="custom">Custom</button></div>' +
            '<span class="cl-custom" id="clCustom"><input class="text-input sm" type="date" id="clSince" aria-label="From"><span class="muted">to</span><input class="text-input sm" type="date" id="clUntil" aria-label="To"></span>' +
            '<label class="check-label"><input type="checkbox" id="clMerges">Hide merge commits</label>' +
            '<select class="select-input sm" id="clMax" style="width:auto" aria-label="Most commits per repo"><option value="100">Up to 100 per repo</option><option value="300">Up to 300 per repo</option><option value="1000">Up to 1,000 per repo</option></select>' +
            '<button class="btn btn-primary btn-sm" data-act="load" id="clLoad" style="margin-left:auto">' + U.icon('reset') + 'Load commits</button>' +
          '</div>' +
        '</section>' +
        '<div class="cl-viewbar"><div class="seg lg" id="clView"><button data-v="timeline">Timeline</button><button data-v="changelog">Changelog</button><button data-v="stats">Stats</button></div><span class="muted" id="clRate"></span></div>' +
        '<div id="clBody"></div>';

      var reposEl = U.$('#clRepos', root), body = U.$('#clBody', root);
      var alive = true;

      /* ----- Repo chips ----- */
      function paintRepos() {
        reposEl.innerHTML = prefs.repos.map(function (r, i) {
          return '<span class="cl-chip" style="--h:' + HUES[i % HUES.length] + '"><span class="dot"></span>' + U.esc(r) + (S.errors[r] ? ' <span class="cl-err" title="' + U.esc(S.errors[r]) + '">!</span>' : '') +
            '<button data-rm="' + i + '" aria-label="Remove ' + U.esc(r) + '">' + U.icon('x') + '</button></span>';
        }).join('') +
          '<input class="cl-input" id="clInput" placeholder="' + (prefs.repos.length ? 'Add another: owner/repo or URL' : 'owner/repo or a GitHub URL, then Enter (add several, separated by commas)') + '" autocomplete="off" spellcheck="false" aria-label="Add a repository">' +
          '<button class="btn btn-ghost btn-sm" data-act="user" title="Pick from a user’s or organization’s public repos">' + U.icon('user') + 'From a user</button>';
        var inp = U.$('#clInput', reposEl);
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (!inp.value.trim()) { if (e.key === 'Enter' && prefs.repos.length) loadAll(); return; }
            addRepos(inp.value);
          } else if (e.key === 'Backspace' && !inp.value && prefs.repos.length) { prefs.repos.pop(); savePrefs(); paintRepos(); U.$('#clInput', reposEl).focus(); }
        });
        inp.addEventListener('paste', function () { setTimeout(function () { if (/[,\s]/.test(inp.value.trim())) addRepos(inp.value); }, 0); });
      }
      function addRepos(text) {
        var bad = [], added = 0;
        text.split(/[\s,]+/).filter(Boolean).forEach(function (t) {
          var r = parseRepo(t);
          if (!r) { if (/^[\w.-]+$/.test(t)) { userDialog(t); } else bad.push(t); return; }
          if (prefs.repos.some(function (x) { return x.toLowerCase() === r.toLowerCase(); })) return;
          if (prefs.repos.length >= 8) { U.toast('Up to 8 repos at a time'); return; }
          prefs.repos.push(r); added++;
        });
        savePrefs(); paintRepos(); U.$('#clInput', reposEl).focus();
        if (bad.length) U.toast('Not a repo: ' + bad.join(', ') + '. Use owner/repo.');
        if (added) loadAll();
      }

      /* ----- Pick repos from a user or org ----- */
      function userDialog(prefill) {
        var bodyEl = U.h('<div><div class="field-inline"><input class="text-input" id="clUser" placeholder="GitHub user or organization" value="' + U.esc(prefill || '') + '" autocomplete="off" spellcheck="false"><button class="btn btn-soft" id="clUserGo">Find repos</button></div><div id="clUserList" class="cl-userlist"></div></div>');
        var picked = {};
        var m = U.modal({ title: 'Add repos from a user', size: 'lg', body: bodyEl, actions: [
          { label: 'Cancel', kind: 'btn-ghost' },
          { label: 'Add selected', kind: 'btn-primary', onClick: function () {
            var list = Object.keys(picked).filter(function (k) { return picked[k]; });
            if (!list.length) { U.toast('Select at least one repo'); return false; }
            addRepos(list.join(','));
          } }
        ] });
        var input = U.$('#clUser', bodyEl), list = U.$('#clUserList', bodyEl);
        async function find() {
          var u = input.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split('/')[0];
          if (!u) return;
          list.innerHTML = '<p class="muted">Loading…</p>';
          try {
            var res = await gh('/users/' + encodeURIComponent(u) + '/repos?per_page=100&sort=pushed');
            var repos = res.data;
            if (!repos.length) { list.innerHTML = '<p class="muted">No public repositories.</p>'; return; }
            list.innerHTML = repos.map(function (r) {
              return '<label class="cl-pick"><input type="checkbox" data-full="' + U.esc(r.full_name) + '"' + (prefs.repos.indexOf(r.full_name) !== -1 ? ' checked disabled' : '') + '>' +
                '<span><b>' + U.esc(r.name) + '</b>' + (r.fork ? ' <span class="badge">fork</span>' : '') + (r.description ? '<small>' + U.esc(r.description) + '</small>' : '') + '</span>' +
                '<span class="muted">' + (r.pushed_at ? 'pushed ' + U.relTime(new Date(r.pushed_at).getTime()) : '') + '</span></label>';
            }).join('');
          } catch (e) { list.innerHTML = '<p style="color:var(--danger)">' + U.esc(e.message) + '</p>'; }
        }
        U.$('#clUserGo', bodyEl).addEventListener('click', find);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });
        list.addEventListener('change', function (e) { if (e.target.dataset.full) picked[e.target.dataset.full] = e.target.checked; });
        if (prefill) find();
        void m;
      }

      /* ----- Controls ----- */
      var since = U.$('#clSince', root), until = U.$('#clUntil', root), custom = U.$('#clCustom', root);
      since.value = prefs.since || ''; until.value = prefs.until || '';
      custom.hidden = prefs.range !== 'custom';
      U.seg(U.$('#clRange', root), prefs.range, function (v) {
        prefs.range = v; custom.hidden = v !== 'custom';
        if (v === 'custom' && !prefs.since) { since.value = prefs.since = U.dayKey(new Date(Date.now() - 60 * 86400000)); until.value = prefs.until = U.dayKey(); }
        savePrefs(); if (v !== 'custom' && prefs.repos.length) loadAll();
      });
      [since, until].forEach(function (el) { el.addEventListener('change', function () { prefs.since = since.value; prefs.until = until.value; savePrefs(); if (prefs.repos.length) loadAll(); }); });
      var merges = U.$('#clMerges', root);
      merges.checked = prefs.hideMerges;
      merges.addEventListener('change', function () { prefs.hideMerges = merges.checked; savePrefs(); render(); });
      var maxSel = U.$('#clMax', root);
      maxSel.value = String(prefs.max);
      maxSel.addEventListener('change', function () { prefs.max = +maxSel.value; savePrefs(); if (prefs.repos.length) loadAll(); });
      U.seg(U.$('#clView', root), prefs.view, function (v) { prefs.view = v; savePrefs(); render(); });

      function paintRate() {
        var el = U.$('#clRate', root); if (!el) return;
        el.textContent = rate.remaining == null ? '' : 'GitHub API: ' + U.fmtNum(rate.remaining, 0) + ' of ' + U.fmtNum(rate.limit, 0) + ' requests left' + (rate.reset ? ', resets ' + U.relTime(rate.reset) : '') + (getToken() ? ' · using your token' : '');
      }

      /* ----- Loading ----- */
      async function loadAll() {
        if (!prefs.repos.length) { render(); return; }
        var key = JSON.stringify([prefs.repos, prefs.range, prefs.since, prefs.until, prefs.max]);
        S.loading = true; S.key = key; S.errors = {};
        var progress = {};
        var btn = U.$('#clLoad', root); if (btn) btn.disabled = true;
        renderLoading(progress);
        var results = await Promise.all(prefs.repos.map(function (full) {
          return loadRepo(full, function (n) { progress[full] = n; if (alive) renderLoading(progress); })
            .catch(function (e) { S.errors[full] = e.message; return null; });
        }));
        if (S.key !== key) return;            // a newer load started
        S.loading = false;
        S.data = results.filter(Boolean).map(function (r) { r.hue = HUES[prefs.repos.indexOf(r.full) % HUES.length]; if (isNaN(r.hue)) r.hue = HUES[prefs.repos.findIndex(function (x) { return x.toLowerCase() === r.full.toLowerCase(); }) % HUES.length] || HUES[0]; return r; });
        if (btn) btn.disabled = false;
        if (!alive) return;
        paintRepos(); paintRate(); render();
        Object.keys(S.errors).forEach(function (r) { U.toast(r + ': ' + S.errors[r], { duration: 7000 }); });
      }
      function renderLoading(progress) {
        body.innerHTML = '<section class="panel"><div class="empty"><div class="spinner-lg"></div><h3>Loading commits…</h3><p>' +
          prefs.repos.map(function (r) { return U.esc(r) + ': ' + (progress[r] != null ? U.fmtNum(progress[r], 0) + ' commits' : 'starting'); }).join('<br>') + '</p></div></section>';
      }

      /* ----- Rendering ----- */
      function visible(r) { return r.commits.filter(function (c) { return !(prefs.hideMerges && c.kind.cat === 'merge'); }); }
      function render() {
        paintRate();
        if (S.loading) return;
        if (!prefs.repos.length) {
          body.innerHTML = '<section class="panel"><div class="empty"><div class="empty-art">' + U.icon('gitCompare') + '</div><h3>Compare repositories</h3>' +
            '<p>Type <b>owner/repo</b> above and press Enter, paste GitHub URLs, or use <b>From a user</b>. Add several to see them side by side.</p>' +
            '<div class="empty-actions"><button class="btn btn-soft" data-example="facebook/react,vuejs/core,sveltejs/svelte">Try: React vs Vue vs Svelte</button></div></div></section>';
          return;
        }
        if (!S.data.length) {
          body.innerHTML = '<section class="panel"><div class="empty"><h3>' + (Object.keys(S.errors).length ? 'Could not load these repos' : 'Ready') + '</h3><p>' +
            (Object.keys(S.errors).length ? Object.keys(S.errors).map(function (r) { return '<b>' + U.esc(r) + '</b>: ' + U.esc(S.errors[r]); }).join('<br>') : 'Press <b>Load commits</b>.') + '</p></div></section>';
          return;
        }
        if (prefs.view === 'changelog') renderChangelog();
        else if (prefs.view === 'stats') renderStats();
        else renderTimeline();
      }

      function header(r) {
        var v = visible(r), authors = {};
        v.forEach(function (c) { var k = c.author.login || c.author.name; if (!authors[k]) authors[k] = c.author; });
        var ak = Object.keys(authors);
        return '<div class="cl-head" style="--h:' + r.hue + '">' +
          '<a class="cl-name" href="' + U.esc(r.info.html_url || ('https://github.com/' + r.full)) + '" target="_blank" rel="noopener">' + U.esc(r.full) + U.icon('external') + '</a>' +
          (r.info.description ? '<div class="cl-desc">' + U.esc(r.info.description) + '</div>' : '') +
          '<div class="cl-meta"><b>' + U.fmtNum(v.length, 0) + '</b> commit' + (v.length === 1 ? '' : 's') + (r.truncated ? '+' : '') +
            ' · <b>' + ak.length + '</b> author' + (ak.length === 1 ? '' : 's') +
            (r.info.default_branch ? ' · <span class="mono">' + U.esc(r.info.default_branch) + '</span>' : '') + '</div>' +
          '<div class="cl-avatars">' + ak.slice(0, 8).map(function (k) { var a = authors[k]; return a.avatar ? '<img src="' + U.esc(a.avatar) + '&s=48" alt="" title="' + U.esc(a.login || a.name) + '" loading="lazy">' : '<span title="' + U.esc(a.name) + '">' + U.esc((a.name || '?')[0]) + '</span>'; }).join('') + (ak.length > 8 ? '<span>+' + (ak.length - 8) + '</span>' : '') + '</div>' +
          sparkline(v) +
          (r.truncated ? '<div class="cl-warn">Showing the newest ' + U.fmtNum(prefs.max, 0) + ' commits. Raise the limit to see more.</div>' : '') +
        '</div>';
      }
      function sparkline(commits) {
        var r = rangeDates(), end = r.until || new Date(), start = r.since || (commits.length ? commits[commits.length - 1].date : end);
        var days = Math.max(1, Math.round((end - start) / 86400000)), bins = Math.min(60, Math.max(7, days)), size = (end - start) / bins || 1, b = new Array(bins).fill(0);
        commits.forEach(function (c) { var k = Math.floor((c.date - start) / size); if (k >= 0 && k < bins) b[k]++; });
        var max = Math.max.apply(null, b) || 1;
        return '<div class="cl-spark" title="Commits over the selected period">' + b.map(function (n) { return '<i style="height:' + (n ? 12 + 88 * n / max : 4) + '%;opacity:' + (n ? 1 : 0.35) + '"></i>'; }).join('') + '</div>';
      }

      function chip(kind) {
        return '<span class="cl-cat" style="--ch:' + CAT_HUE[kind.cat] + '"' + (kind.cat === 'other' || kind.cat === 'merge' || kind.cat === 'chore' ? ' data-plain' : '') + '>' + U.esc(CAT_NAME[kind.cat].replace(/s$/, '').replace('Build & CI', 'Build')) + '</span>' + (kind.breaking ? '<span class="cl-cat" style="--ch:25">Breaking</span>' : '');
      }
      function card(r, c) {
        var t = c.date, tags = r.tags[c.sha];
        return '<button class="cl-commit' + (c.kind.cat === 'merge' ? ' merge' : '') + '" data-repo="' + U.esc(r.full) + '" data-sha="' + c.sha + '" style="--h:' + r.hue + '">' +
          (tags ? '<span class="cl-tag">' + U.icon('star') + U.esc(tags.join(', ')) + '</span>' : '') +
          '<span class="cl-title">' + U.esc(c.kind.clean || c.title) + '</span>' +
          '<span class="cl-line">' + chip(c.kind) +
            (c.author.avatar ? '<img src="' + U.esc(c.author.avatar) + '&s=32" alt="" loading="lazy">' : '') +
            '<span class="cl-who">' + U.esc(c.author.login || c.author.name) + '</span>' +
            '<span class="cl-time">' + U.pad(t.getHours()) + ':' + U.pad(t.getMinutes()) + '</span>' +
            '<span class="mono cl-sha">' + c.sha.slice(0, 7) + '</span></span>' +
        '</button>';
      }

      var expanded = {};
      function renderTimeline() {
        var n = S.data.length, byDay = {};
        S.data.forEach(function (r, i) {
          visible(r).forEach(function (c) {
            var k = U.dayKey(c.date);
            (byDay[k] = byDay[k] || S.data.map(function () { return []; }))[i].push(c);
          });
        });
        var days = Object.keys(byDay).sort().reverse();
        var cols = 'grid-template-columns: 96px repeat(' + n + ', minmax(' + (n > 3 ? 250 : 300) + 'px, 1fr))';
        var html = '<section class="panel cl-timeline"><div class="cl-scroll"><div class="cl-grid" style="' + cols + '">' +
          '<div class="cl-corner"></div>' + S.data.map(header).join('');
        var lastMonth = '';
        days.forEach(function (k) {
          var d = U.parseDay(k), month = U.MONTHS[d.getMonth()] + ' ' + d.getFullYear();
          if (month !== lastMonth) { html += '<div class="cl-month" style="grid-column:1 / -1">' + month + '</div>'; lastMonth = month; }
          html += '<div class="cl-date"><b>' + d.getDate() + '</b><span>' + U.DAYS[d.getDay()] + '</span></div>';
          byDay[k].forEach(function (list, i) {
            var r = S.data[i], key = k + '|' + i, show = expanded[key] ? list : list.slice(0, 5);
            html += '<div class="cl-cell' + (list.length ? '' : ' empty') + '">' + show.map(function (c) { return card(r, c); }).join('') +
              (list.length > show.length ? '<button class="cl-more" data-more="' + key + '">+' + (list.length - show.length) + ' more</button>' : '') + '</div>';
          });
        });
        if (!days.length) html += '<div class="cl-none" style="grid-column:1 / -1">No commits in this period.</div>';
        html += '</div></div></section>';
        body.innerHTML = html;
      }

      function renderChangelog() {
        var n = S.data.length;
        var html = '<div class="cl-cols" style="grid-template-columns: repeat(' + n + ', minmax(' + (n > 2 ? 280 : 320) + 'px, 1fr))">';
        S.data.forEach(function (r) {
          var groups = versions(r);
          html += '<section class="panel cl-log" style="--h:' + r.hue + '">' + header(r) +
            '<div class="cl-log-actions"><button class="btn btn-ghost btn-sm" data-md="' + U.esc(r.full) + '">' + U.icon('copy') + 'Copy as Markdown</button></div>' +
            '<div class="cl-log-body">' + (groups.length ? groups.map(function (g) {
              return '<div class="cl-ver"><div class="cl-ver-head"><b>' + U.esc(g.name) + '</b><span class="muted">' + (g.date ? U.fmtDay(g.date, { year: true }) : '') + ' · ' + g.count + ' commit' + (g.count === 1 ? '' : 's') + '</span></div>' +
                CATS.filter(function (c) { return g.cats[c[0]]; }).map(function (c) {
                  return '<div class="cl-sec"><div class="cl-sec-head"><span class="cl-cat" style="--ch:' + CAT_HUE[c[0]] + '">' + c[1] + '</span><span class="muted">' + g.cats[c[0]].length + '</span></div><ul>' +
                    g.cats[c[0]].map(function (cm) {
                      return '<li><button class="cl-li" data-repo="' + U.esc(r.full) + '" data-sha="' + cm.sha + '">' + (cm.kind.breaking ? '<b class="cl-break">Breaking:</b> ' : '') + (cm.kind.scope ? '<b>' + U.esc(cm.kind.scope) + ':</b> ' : '') + U.esc(cm.kind.clean || cm.title) + ' <span class="mono muted">' + cm.sha.slice(0, 7) + '</span></button></li>';
                    }).join('') + '</ul></div>';
                }).join('') + '</div>';
            }).join('') : '<p class="muted" style="padding:16px">No commits in this period.</p>') + '</div></section>';
        });
        html += '</div>';
        body.innerHTML = html;
      }
      // Splits a repo's commits into versions at each tagged commit (newest first).
      function versions(r) {
        var out = [], cur = null;
        visible(r).forEach(function (c) {
          var tag = r.tags[c.sha];
          if (tag || !cur) { cur = { name: tag ? tag.join(', ') : 'Unreleased', date: c.date, cats: {}, count: 0 }; out.push(cur); }
          (cur.cats[c.kind.cat] = cur.cats[c.kind.cat] || []).push(c);
          cur.count++;
        });
        return out;
      }
      function markdown(r) {
        var lines = ['# Changelog: ' + r.full, ''];
        versions(r).forEach(function (g) {
          lines.push('## ' + g.name + (g.date ? ' (' + U.dayKey(g.date) + ')' : ''), '');
          CATS.forEach(function (c) {
            if (!g.cats[c[0]]) return;
            lines.push('### ' + c[1]);
            g.cats[c[0]].forEach(function (cm) { lines.push('- ' + (cm.kind.breaking ? '**Breaking:** ' : '') + (cm.kind.scope ? '**' + cm.kind.scope + ':** ' : '') + (cm.kind.clean || cm.title) + ' ([' + cm.sha.slice(0, 7) + '](' + cm.url + '))'); });
            lines.push('');
          });
        });
        return lines.join('\n');
      }

      function renderStats() {
        var html = '<div class="cl-cols" style="grid-template-columns: repeat(' + S.data.length + ', minmax(260px, 1fr))">';
        S.data.forEach(function (r) {
          var v = visible(r), authors = {}, cats = {}, heat = [], dayset = {};
          for (var d = 0; d < 7; d++) heat.push(new Array(24).fill(0));
          v.forEach(function (c) {
            var k = c.author.login || c.author.name;
            authors[k] = authors[k] || { a: c.author, n: 0 }; authors[k].n++;
            cats[c.kind.cat] = (cats[c.kind.cat] || 0) + 1;
            heat[c.date.getDay()][c.date.getHours()]++;
            dayset[U.dayKey(c.date)] = 1;
          });
          var top = Object.keys(authors).map(function (k) { return authors[k]; }).sort(function (a, b) { return b.n - a.n; });
          var hmax = Math.max.apply(null, heat.map(function (row) { return Math.max.apply(null, row); })) || 1;
          var active = Object.keys(dayset).length;
          html += '<section class="panel" style="--h:' + r.hue + '">' + header(r) + '<div class="panel-body">' +
            '<div class="cl-kpis"><div><b>' + U.fmtNum(v.length, 0) + '</b><span>commits</span></div><div><b>' + active + '</b><span>active days</span></div><div><b>' + (active ? (v.length / active).toFixed(1) : '0') + '</b><span>per active day</span></div></div>' +
            '<p class="section-label" style="margin-top:16px">Types of change</p>' +
            '<div class="cl-stack">' + CATS.filter(function (c) { return cats[c[0]]; }).map(function (c) { return '<i style="flex:' + cats[c[0]] + ';--ch:' + CAT_HUE[c[0]] + '"' + (CAT_HUE[c[0]] === 0 ? ' data-plain' : '') + ' title="' + c[1] + ': ' + cats[c[0]] + '"></i>'; }).join('') + '</div>' +
            '<div class="cl-legend">' + CATS.filter(function (c) { return cats[c[0]]; }).map(function (c) { return '<span><i style="--ch:' + CAT_HUE[c[0]] + '"' + (CAT_HUE[c[0]] === 0 ? ' data-plain' : '') + '></i>' + c[1] + ' ' + cats[c[0]] + '</span>'; }).join('') + '</div>' +
            '<p class="section-label" style="margin-top:16px">When commits happen</p>' +
            '<div class="cl-heat">' + heat.map(function (row, di) {
              return '<span class="cl-hd">' + U.DAYS[di][0] + '</span>' + row.map(function (n, h) { return '<i title="' + U.DAYS[di] + ' ' + U.pad(h) + ':00 · ' + n + '" style="opacity:' + (n ? 0.2 + 0.8 * n / hmax : 1) + '"' + (n ? ' data-on' : '') + '></i>'; }).join('');
            }).join('') + '</div><div class="cl-heat-x"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>' +
            '<p class="section-label" style="margin-top:16px">Top authors</p><ul class="cl-authors">' + top.slice(0, 8).map(function (t) {
              return '<li>' + (t.a.avatar ? '<img src="' + U.esc(t.a.avatar) + '&s=40" alt="" loading="lazy">' : '<span class="av">' + U.esc((t.a.name || '?')[0]) + '</span>') + '<span class="nm">' + U.esc(t.a.login || t.a.name) + '</span><span class="bar"><i style="width:' + (100 * t.n / top[0].n) + '%"></i></span><b>' + t.n + '</b></li>';
            }).join('') + '</ul>' +
          '</div></section>';
        });
        html += '</div>' + weeklyChart();
        body.innerHTML = html;
      }
      function weeklyChart() {
        var all = S.data.map(function (r) { return visible(r); });
        var dates = [].concat.apply([], all).map(function (c) { return c.date; });
        if (!dates.length) return '';
        var r = rangeDates(), end = r.until || new Date(), start = r.since || new Date(Math.min.apply(null, dates));
        var weeks = Math.max(1, Math.ceil((end - start) / (7 * 86400000))), step = weeks > 60 ? Math.ceil(weeks / 60) : 1, bins = Math.ceil(weeks / step);
        var counts = all.map(function (list) { var b = new Array(bins).fill(0); list.forEach(function (c) { var k = Math.floor((c.date - start) / (7 * 86400000 * step)); if (k >= 0 && k < bins) b[k]++; }); return b; });
        var max = Math.max.apply(null, counts.map(function (b) { return Math.max.apply(null, b); })) || 1;
        var W = 960, H = 220, pad = 30, bw = Math.min((W - pad) / bins, 36 * S.data.length + 8), inner = Math.max(1, (bw - 4) / S.data.length);
        var bars = '';
        counts.forEach(function (b, ri) {
          b.forEach(function (n, k) {
            if (!n) return;
            var h = (H - 30) * n / max, x = pad + k * bw + 2 + ri * inner;
            bars += '<rect x="' + x.toFixed(1) + '" y="' + (H - 20 - h).toFixed(1) + '" width="' + Math.max(1, inner - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" style="fill:oklch(var(--al) var(--ac) ' + S.data[ri].hue + ')"><title>' + U.esc(S.data[ri].full) + ': ' + n + ' commits, week of ' + U.fmtDay(new Date(start.getTime() + k * step * 7 * 86400000)) + '</title></rect>';
          });
        });
        var labels = '', every = Math.max(1, Math.ceil(bins / 8));
        for (var k = 0; k < bins; k += every) labels += '<text x="' + (pad + k * bw).toFixed(1) + '" y="' + (H - 4) + '">' + U.fmtDay(new Date(start.getTime() + k * step * 7 * 86400000)) + '</text>';
        return '<section class="panel" style="margin-top:12px"><div class="panel-head"><span class="panel-title">Commits per ' + (step === 1 ? 'week' : step + ' weeks') + '</span><div class="cl-legend">' +
          S.data.map(function (r) { return '<span><i style="background:oklch(var(--al) var(--ac) ' + r.hue + ')"></i>' + U.esc(r.full) + '</span>'; }).join('') + '</div></div>' +
          '<div class="panel-body"><svg class="cl-weekly" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Commits per week">' +
          '<line x1="' + pad + '" x2="' + W + '" y1="' + (H - 20) + '" y2="' + (H - 20) + '"/>' + bars + labels +
          '<text x="0" y="12">' + max + '</text></svg></div></section>';
      }

      /* ----- Commit details ----- */
      async function openCommit(full, sha) {
        var r = S.data.filter(function (x) { return x.full === full; })[0]; if (!r) return;
        var c = r.commits.filter(function (x) { return x.sha === sha; })[0]; if (!c) return;
        var bodyEl = U.h('<div class="cl-detail">' +
          '<div class="chips" style="margin-bottom:10px"><span class="badge" style="color:oklch(var(--al) var(--ac) ' + r.hue + ')">' + U.esc(full) + '</span>' + chip(c.kind) + (r.tags[sha] ? '<span class="badge accent">' + U.esc(r.tags[sha].join(', ')) + '</span>' : '') + '</div>' +
          '<h3 class="cl-dtitle">' + U.esc(c.title) + '</h3>' +
          (c.body ? '<pre class="cl-dbody">' + U.esc(c.body) + '</pre>' : '') +
          '<div class="cl-dmeta">' + (c.author.avatar ? '<img src="' + U.esc(c.author.avatar) + '&s=40" alt="">' : '') + '<span><b>' + U.esc(c.author.name) + '</b>' + (c.author.login ? ' (@' + U.esc(c.author.login) + ')' : '') + ' · ' + c.date.toLocaleString() + '</span>' +
            '<a class="btn btn-ghost btn-sm" href="' + U.esc(c.url) + '" target="_blank" rel="noopener" style="margin-left:auto">' + U.icon('external') + 'GitHub</a>' +
            '<button class="icon-btn sm" data-copy-sha title="Copy full SHA" aria-label="Copy SHA">' + U.icon('copy') + '</button></div>' +
          '<div id="clFiles"><p class="muted">Loading changed files…</p></div></div>');
        U.$('[data-copy-sha]', bodyEl).addEventListener('click', function () { U.copy(sha, 'SHA'); });
        U.modal({ title: 'Commit ' + sha.slice(0, 7), size: 'lg', body: bodyEl });
        var filesEl = U.$('#clFiles', bodyEl);
        try {
          var d = (await gh('/repos/' + full + '/commits/' + sha)).data;
          paintRate();
          var files = d.files || [], st = d.stats || { additions: 0, deletions: 0 };
          var maxCh = Math.max.apply(null, files.map(function (f) { return f.changes; }).concat([1]));
          filesEl.innerHTML = '<div class="cl-dstats"><b>' + files.length + '</b> file' + (files.length === 1 ? '' : 's') + ' changed · <span class="plus">+' + U.fmtNum(st.additions, 0) + '</span> <span class="minus">−' + U.fmtNum(st.deletions, 0) + '</span>' + (files.length >= 300 ? ' <span class="muted">(GitHub lists at most 300 files)</span>' : '') + '</div>' +
            '<ul class="cl-files">' + files.map(function (f, i) {
              return '<li><button class="cl-file" data-file="' + i + '"><span class="st st-' + f.status + '">' + ({ added: 'A', removed: 'D', modified: 'M', renamed: 'R', copied: 'C', changed: 'M' }[f.status] || '?') + '</span>' +
                '<span class="fn mono">' + (f.previous_filename ? U.esc(f.previous_filename) + ' → ' : '') + U.esc(f.filename) + '</span>' +
                '<span class="nums"><span class="plus">+' + f.additions + '</span> <span class="minus">−' + f.deletions + '</span></span>' +
                '<span class="chg"><i class="a" style="width:' + (60 * f.additions / maxCh) + 'px"></i><i class="d" style="width:' + (60 * f.deletions / maxCh) + 'px"></i></span></button>' +
                '<div class="cl-patch" hidden></div></li>';
            }).join('') + '</ul>';
          filesEl.addEventListener('click', function (e) {
            var b = e.target.closest('[data-file]'); if (!b) return;
            var f = files[+b.dataset.file], pane = b.nextElementSibling;
            if (!pane.hidden) { pane.hidden = true; return; }
            if (!pane.innerHTML) pane.innerHTML = f.patch ? '<pre>' + f.patch.split('\n').slice(0, 1500).map(function (l) {
              var cls = l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : l.indexOf('@@') === 0 ? 'h' : '';
              return '<span class="' + cls + '">' + (U.esc(l) || ' ') + '</span>';
            }).join('') + '</pre>' : '<p class="muted" style="padding:10px">No text diff (binary file, or too large for GitHub to show).</p>';
            pane.hidden = false;
          });
        } catch (e) { filesEl.innerHTML = '<p style="color:var(--danger)">' + U.esc(e.message) + '</p>'; }
      }

      function tokenDialog() {
        var bodyEl = U.h('<div><p class="confirm-text">Without a token, GitHub allows 60 requests an hour from your network (about 2–3 per repo load). A token raises that to 5,000 and lets you view private repos.</p>' +
          '<ol class="cl-steps"><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Settings → Fine-grained tokens</a>.</li><li>Choose the repositories, and give <b>Contents: Read-only</b> (for private repos). Public-only access needs no permissions.</li><li>Paste the token here.</li></ol>' +
          '<input class="text-input mono" id="clTok" type="password" placeholder="github_pat_…" autocomplete="off" value="' + U.esc(getToken()) + '">' +
          '<p class="muted" style="font-size:12.5px;margin:8px 0 0">The token is stored only in this browser and only sent to api.github.com. It is not included in backups or shared links.</p></div>');
        U.modal({ title: 'GitHub token (optional)', body: bodyEl, actions: [
          { label: 'Remove token', kind: 'btn-ghost', left: true, onClick: function () { U.store.remove('changelog-token'); cache = {}; U.toast('Token removed'); paintRate(); } },
          { label: 'Cancel', kind: 'btn-ghost' },
          { label: 'Save', kind: 'btn-primary', onClick: function () {
            var v = U.$('#clTok', bodyEl).value.trim();
            if (v) U.store.set('changelog-token', v); else U.store.remove('changelog-token');
            cache = {}; U.toast(v ? 'Token saved' : 'Token removed');
            if (prefs.repos.length) loadAll();
          } }
        ] });
      }

      function shareLink() {
        var q = 'r=' + prefs.repos.map(encodeURIComponent).join(',').replace(/%2F/g, '/');
        q += prefs.range === 'custom' ? '&since=' + (prefs.since || '') + '&until=' + (prefs.until || '') : '&d=' + prefs.range;
        return location.origin + location.pathname + '#/changelog?' + q;
      }

      /* ----- Events ----- */
      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          var act = a.dataset.act;
          if (act === 'load') loadAll();
          if (act === 'token') tokenDialog();
          if (act === 'user') userDialog('');
          if (act === 'share') { if (!prefs.repos.length) { U.toast('Add a repo first'); return; } U.copy(shareLink(), 'Link'); }
          return;
        }
        var rm = e.target.closest('[data-rm]');
        if (rm) { var gone = prefs.repos.splice(+rm.dataset.rm, 1)[0]; savePrefs(); S.data = S.data.filter(function (r) { return r.full.toLowerCase() !== gone.toLowerCase(); }); paintRepos(); render(); return; }
        var ex = e.target.closest('[data-example]');
        if (ex) { addRepos(ex.dataset.example); return; }
        var more = e.target.closest('[data-more]');
        if (more) { expanded[more.dataset.more] = true; renderTimeline(); return; }
        var md = e.target.closest('[data-md]');
        if (md) { var rr = S.data.filter(function (x) { return x.full === md.dataset.md; })[0]; if (rr) U.copy(markdown(rr), 'Changelog'); return; }
        var cm = e.target.closest('[data-sha][data-repo]');
        if (cm) openCommit(cm.dataset.repo, cm.dataset.sha);
      });

      paintRepos();
      var key = JSON.stringify([prefs.repos, prefs.range, prefs.since, prefs.until, prefs.max]);
      if (S.data.length && S.key === key) render();
      else if (prefs.repos.length) loadAll();
      else render();
      return function () { alive = false; };
    }
  });

  U.changelog = { parseRepo: parseRepo, categorize: categorize };
})();
