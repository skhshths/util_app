/* =========================================================================
   Tool: Workout logger
   Log sessions as exercises with sets of reps × weight. See progress per
   exercise as a chart (estimated 1RM, top weight, volume or reps), personal
   records, and a history you can edit. Weights are stored in kilograms and
   shown in your chosen unit.
   ========================================================================= */
(function () {
  'use strict';

  var LB = 2.2046226218;

  function load() {
    var d = U.store.get('workouts', null);
    if (!d || !Array.isArray(d.sessions)) d = { unit: 'kg', sessions: [] };
    if (d.unit !== 'lb') d.unit = 'kg';
    return d;
  }
  var data = load();
  function save() { U.store.set('workouts', data); }

  /* ---------- Units and maths ---------- */
  function toDisplay(kg) { if (kg == null || kg === '') return ''; var v = data.unit === 'lb' ? kg * LB : kg; return Math.round(v * 100) / 100; }
  function fromDisplay(v) { if (v === '' || v == null || isNaN(v)) return 0; v = +v; return data.unit === 'lb' ? v / LB : v; }
  function w(kg) { return U.fmtNum(toDisplay(kg), 2) + ' ' + data.unit; }
  function e1rm(weight, reps) { if (!weight || !reps) return 0; return reps === 1 ? weight : weight * (1 + reps / 30); }
  function norm(name) { return name.trim().toLowerCase().replace(/\s+/g, ' '); }

  function sorted() { return data.sessions.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0); }); }

  // Exercise names, most frequent first, keeping the most recent spelling.
  function exerciseNames() {
    var count = {}, label = {};
    sorted().forEach(function (s) {
      s.exercises.forEach(function (ex) {
        var k = norm(ex.name); if (!k) return;
        count[k] = (count[k] || 0) + 1;
        if (!label[k]) label[k] = ex.name.trim();
      });
    });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b); }).map(function (k) { return { key: k, name: label[k], count: count[k] }; });
  }

  function sessionVolume(s) {
    var v = 0;
    s.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { v += (st.weight || 0) * (st.reps || 0); }); });
    return v;
  }

  // One point per session for an exercise.
  function series(key, metric) {
    var pts = [];
    data.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (s) {
      var sets = [];
      s.exercises.forEach(function (ex) { if (norm(ex.name) === key) sets = sets.concat(ex.sets.filter(function (st) { return st.reps > 0; })); });
      if (!sets.length) return;
      var v;
      if (metric === 'e1rm') v = Math.max.apply(null, sets.map(function (st) { return e1rm(st.weight, st.reps); }));
      else if (metric === 'top') v = Math.max.apply(null, sets.map(function (st) { return st.weight || 0; }));
      else if (metric === 'volume') v = sets.reduce(function (a, st) { return a + (st.weight || 0) * st.reps; }, 0);
      else v = sets.reduce(function (a, st) { return a + st.reps; }, 0);
      pts.push({ date: s.date, v: v, sets: sets, session: s });
    });
    return pts;
  }

  function prs() {
    var best = {};
    data.sessions.forEach(function (s) {
      s.exercises.forEach(function (ex) {
        var k = norm(ex.name); if (!k) return;
        ex.sets.forEach(function (st) {
          if (!st.reps) return;
          var score = st.weight ? e1rm(st.weight, st.reps) : 0;
          var cur = best[k];
          var better = !cur || (score > cur.score) || (score === 0 && cur.score === 0 && st.reps > cur.reps);
          if (better) best[k] = { name: ex.name.trim(), key: k, score: score, weight: st.weight, reps: st.reps, date: s.date };
        });
      });
    });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function lastSetsFor(name, beforeDate, excludeId) {
    var k = norm(name);
    var list = sorted();
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.id === excludeId || (beforeDate && s.date > beforeDate)) continue;
      for (var j = 0; j < s.exercises.length; j++) if (norm(s.exercises[j].name) === k) return { sets: s.exercises[j].sets, date: s.date };
    }
    return null;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min = min - 1; max = max + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (var t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    return ticks;
  }

  function examples() {
    var today = new Date(), out = [];
    var plans = [
      { title: 'Push', ex: [['Bench press', 60, 5, 2.5], ['Overhead press', 35, 6, 1.25], ['Dips', 0, 10, 0]] },
      { title: 'Pull', ex: [['Deadlift', 100, 5, 5], ['Pull-ups', 0, 6, 0], ['Barbell row', 50, 8, 2.5]] },
      { title: 'Legs', ex: [['Squat', 80, 5, 2.5], ['Romanian deadlift', 70, 8, 2.5], ['Leg press', 120, 10, 5]] }
    ];
    var k = 0;
    for (var day = 63; day >= 1; day--) {
      var d = U.addDays(today, -day);
      if ([1, 3, 5].indexOf(d.getDay()) === -1) continue;
      var p = plans[k % 3], week = Math.floor(k / 3);
      out.push({
        id: U.uid(), date: U.dayKey(d), title: p.title, notes: '', created: d.getTime(),
        exercises: p.ex.map(function (e) {
          var weight = e[1] + e[3] * week - (week === 5 ? e[3] * 2 : 0); // a deload week for realism
          var reps = e[1] ? e[2] : e[2] + Math.floor(week / 2);
          return { name: e[0], sets: [0, 1, 2].map(function (i) { return { reps: Math.max(1, reps - (i === 2 && week % 2 ? 1 : 0)), weight: weight }; }) };
        })
      });
      k++;
    }
    return out;
  }

  var view = Object.assign({ ex: null, metric: 'e1rm' }, U.store.get('workouts-view', {}));
  function saveView() { U.store.set('workouts-view', view); }

  U.register({
    id: 'workouts',
    name: 'Workout logger',
    desc: 'Log sets, reps and weight, repeat last session in one tap, and chart your progress and PRs for each exercise.',
    hue: 25,
    icon: 'dumbbell',
    keywords: ['workout', 'gym', 'exercise', 'lifting', 'fitness', 'sets', 'reps', 'weight', 'pr', '1rm', 'training', 'log'],
    shortcuts: [['Log a workout', ['N']]],
    homeStat: function () {
      data = load();
      if (!data.sessions.length) return '<span class="dot"></span>No workouts logged yet';
      var last = sorted()[0];
      var weekAgo = U.dayKey(U.addDays(new Date(), -6));
      var wk = data.sessions.filter(function (s) { return s.date >= weekAgo; }).length;
      return '<span class="dot"></span>Last: <b>' + U.esc(U.relDay(U.parseDay(last.date))) + '</b> · ' + wk + ' in 7 days';
    },
    mount: function (root) {
      data = load();
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('dumbbell') + '</span>Workout logger</h1>' +
          '<p id="woSub"></p>' +
        '</div><div class="tool-head-actions">' +
          '<div class="seg" id="woUnit" title="Weight unit"><button data-v="kg">kg</button><button data-v="lb">lb</button></div>' +
          '<button class="btn btn-primary" data-act="new">' + U.icon('plus') + 'Log workout <kbd>N</kbd></button>' +
        '</div></div>' +
        '<div class="stats" id="woStats"></div>' +
        '<div id="woEmpty"></div>' +
        '<div class="wo-layout" id="woMain">' +
          '<div class="stack">' +
            '<section class="panel"><div class="panel-head"><div class="field-inline" style="min-width:0;flex:1"><select class="select-input sm" id="woEx" aria-label="Exercise" style="max-width:240px"></select></div>' +
              '<div class="seg" id="woMetric"><button data-v="e1rm" title="Estimated one-rep max (Epley)">Est. 1RM</button><button data-v="top">Top set</button><button data-v="volume">Volume</button><button data-v="reps">Reps</button></div></div>' +
              '<div class="panel-body"><div class="chart-wrap" id="woChartWrap"><div class="chart-tip" id="woTip"></div><div id="woChart"></div></div></div>' +
              '<div class="panel-foot" id="woChartFoot"></div></section>' +
            '<section class="panel"><div class="panel-head"><span class="panel-title">History</span><div class="panel-actions"><span class="muted" style="font-size:12.5px" id="woCount"></span></div></div>' +
              '<ul class="session-list" id="woHistory"></ul><div class="panel-foot" id="woMore" hidden></div></section>' +
          '</div>' +
          '<div class="stack">' +
            '<section class="panel"><div class="panel-head"><span class="panel-title">' + U.icon('trophy').replace('class="i"', 'class="i" style="width:15px;height:15px"') + 'Personal records</span></div>' +
              '<div class="panel-body" style="padding-top:6px;padding-bottom:6px"><ul class="pr-list" id="woPRs"></ul></div>' +
              '<div class="panel-foot">Best set by estimated 1RM. Bodyweight moves rank by reps.</div></section>' +
          '</div>' +
        '</div>';

      var stats = U.$('#woStats', root), main = U.$('#woMain', root), empty = U.$('#woEmpty', root), sub = U.$('#woSub', root);
      var exSel = U.$('#woEx', root), chart = U.$('#woChart', root), tip = U.$('#woTip', root), chartFoot = U.$('#woChartFoot', root);
      var history = U.$('#woHistory', root), prList = U.$('#woPRs', root), more = U.$('#woMore', root), count = U.$('#woCount', root);
      var historyLimit = 15;

      U.seg(U.$('#woUnit', root), data.unit, function (v) { data.unit = v; save(); render(); });
      var setMetric = U.seg(U.$('#woMetric', root), view.metric, function (v) { view.metric = v; saveView(); drawChart(); });
      exSel.addEventListener('change', function () { view.ex = exSel.value; saveView(); drawChart(); });

      function stat(label, value, subText) {
        return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + U.esc(value) + '</div><div class="stat-sub">' + U.esc(subText || '') + '</div></div>';
      }

      function render() {
        var has = data.sessions.length > 0;
        main.hidden = !has; stats.hidden = !has;
        if (!has) {
          sub.textContent = 'Track sets, reps and weight. Your data stays in this browser.';
          empty.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('dumbbell') + '</div><h2>Log your first workout</h2><p>Add exercises and sets as you train. Progress charts and personal records build up automatically.</p>' +
            '<div class="empty-actions"><button class="btn btn-primary" data-act="new">' + U.icon('plus') + 'Log workout</button><button class="btn btn-soft" data-act="examples">' + U.icon('sparkles') + 'Try example data</button></div></div>';
          return;
        }
        empty.innerHTML = '';
        var list = sorted(), last = list[0];
        var today = new Date();
        var d7 = U.dayKey(U.addDays(today, -6)), d30 = U.dayKey(U.addDays(today, -29));
        var in7 = data.sessions.filter(function (s) { return s.date >= d7; });
        var in30 = data.sessions.filter(function (s) { return s.date >= d30; });
        var vol7 = in7.reduce(function (a, s) { return a + sessionVolume(s); }, 0);
        // Weekly streak: consecutive Monday-based weeks with at least one session.
        var weeks = {}; data.sessions.forEach(function (s) { var d = U.parseDay(s.date); weeks[U.dayKey(U.addDays(d, -((d.getDay() + 6) % 7)))] = true; });
        var monday = U.addDays(today, -((today.getDay() + 6) % 7)), streak = 0;
        if (!weeks[U.dayKey(monday)]) monday = U.addDays(monday, -7);
        while (weeks[U.dayKey(monday)]) { streak++; monday = U.addDays(monday, -7); }
        var lastDays = U.daysBetween(U.parseDay(last.date), today);
        sub.textContent = lastDays === 0 ? 'You trained today. ' + (last.title ? last.title + ' is logged.' : '') : lastDays === 1 ? 'Last workout was yesterday.' : lastDays < 0 ? 'Next workout is planned for ' + U.fmtDay(U.parseDay(last.date)) + '.' : 'Last workout was ' + lastDays + ' days ago.';
        stats.innerHTML =
          stat('Last 7 days', in7.length + (in7.length === 1 ? ' session' : ' sessions'), in30.length + ' in the last 30 days') +
          stat('Volume, 7 days', U.fmtNum(toDisplay(vol7), 0) + ' ' + data.unit, 'Reps × weight') +
          stat('Weekly streak', streak + (streak === 1 ? ' week' : ' weeks'), 'With at least one session') +
          stat('Total logged', U.fmtNum(data.sessions.length, 0), 'Since ' + U.fmtDay(U.parseDay(list[list.length - 1].date), { year: true }));

        var names = exerciseNames();
        if (!view.ex || !names.some(function (n) { return n.key === view.ex; })) view.ex = names.length ? names[0].key : null;
        exSel.innerHTML = names.map(function (n) { return '<option value="' + U.esc(n.key) + '">' + U.esc(n.name) + ' (' + n.count + ')</option>'; }).join('');
        if (view.ex) exSel.value = view.ex;
        drawChart();
        renderHistory(list);
        renderPRs();
      }

      function renderHistory(list) {
        count.textContent = list.length + (list.length === 1 ? ' session' : ' sessions');
        history.innerHTML = list.slice(0, historyLimit).map(function (s) {
          var d = U.parseDay(s.date);
          var exs = s.exercises.filter(function (ex) { return ex.name.trim(); }).map(function (ex) {
            var sets = ex.sets.filter(function (st) { return st.reps; });
            var same = sets.length && sets.every(function (st) { return st.reps === sets[0].reps && st.weight === sets[0].weight; });
            var detail = !sets.length ? '' : same ? sets.length + '×' + sets[0].reps + (sets[0].weight ? ' @ ' + w(sets[0].weight) : '') :
              sets.map(function (st) { return st.reps + (st.weight ? '×' + U.fmtNum(toDisplay(st.weight), 2) : ''); }).join(', ') + (sets.some(function (st) { return st.weight; }) ? ' ' + data.unit : ' reps');
            return '<b>' + U.esc(ex.name) + '</b> ' + U.esc(detail);
          });
          return '<li class="session" data-id="' + s.id + '" tabindex="0" role="button" aria-label="Edit workout on ' + U.fmtDay(d, { year: true }) + '">' +
            '<div class="session-head"><span class="session-title">' + U.esc(s.title || 'Workout') + '</span><span class="session-date">' + U.esc(U.relDay(d)) + (U.relDay(d).indexOf(U.MONTHS[d.getMonth()]) === -1 ? ' · ' + U.fmtDay(d) : '') + '</span></div>' +
            '<div class="session-ex">' + (exs.join(' · ') || '<span class="muted">No exercises</span>') + '</div>' +
            (s.notes ? '<div class="session-ex muted" style="margin-top:2px">' + U.esc(s.notes) + '</div>' : '') +
          '</li>';
        }).join('');
        more.hidden = list.length <= historyLimit;
        if (!more.hidden) more.innerHTML = '<button class="btn btn-ghost btn-sm" data-act="more">Show ' + Math.min(15, list.length - historyLimit) + ' more</button>';
      }

      function renderPRs() {
        var list = prs();
        prList.innerHTML = list.length ? list.slice(0, 20).map(function (p) {
          var val = p.weight ? w(p.weight) + ' × ' + p.reps : p.reps + ' reps';
          return '<li data-ex="' + U.esc(p.key) + '" title="' + (p.weight ? 'Est. 1RM ' + w(p.score) : '') + '"><span class="pr-name">' + U.esc(p.name) + '</span><span class="pr-val">' + U.esc(val) + '</span><span class="pr-when">' + U.esc(U.relDay(U.parseDay(p.date))) + '</span></li>';
        }).join('') : '<li class="muted" style="cursor:default">No sets logged yet.</li>';
      }

      /* ---------- Chart ---------- */
      var pts = [], geom = null;
      function drawChart() {
        if (!view.ex) { chart.innerHTML = ''; chartFoot.innerHTML = ''; return; }
        setMetric(view.metric);
        pts = series(view.ex, view.metric);
        var bodyweightOnly = pts.length && pts.every(function (p) { return p.sets.every(function (st) { return !st.weight; }); });
        if (bodyweightOnly && view.metric !== 'reps') { view.metric = 'reps'; setMetric('reps'); pts = series(view.ex, 'reps'); }
        var W = Math.max(280, chart.clientWidth || 600), H = 220, padL = 44, padR = 14, padT = 12, padB = 26;
        if (!pts.length) { chart.innerHTML = '<p class="muted" style="margin:0">No sets for this exercise yet.</p>'; chartFoot.innerHTML = ''; return; }
        var t0 = U.parseDay(pts[0].date).getTime(), t1 = U.parseDay(pts[pts.length - 1].date).getTime();
        if (t0 === t1) { t0 -= 86400000 * 3; t1 += 86400000 * 3; }
        var vals = pts.map(function (p) { return view.metric === 'reps' ? p.v : toDisplay(p.v); });
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        var ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.15), hi + (hi - lo) * 0.1, 4);
        var yMin = ticks[0], yMax = ticks[ticks.length - 1];
        function x(t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
        function y(v) { return padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB); }
        var best = -Infinity;
        var xy = pts.map(function (p, i) {
          var v = vals[i], pr = v > best; if (pr) best = v;
          return { x: x(U.parseDay(p.date).getTime()), y: y(v), v: v, p: p, pr: pr && i > 0 };
        });
        var line = xy.map(function (q, i) { return (i ? 'L' : 'M') + q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join('');
        var area = line + 'L' + xy[xy.length - 1].x.toFixed(1) + ',' + (H - padB) + 'L' + xy[0].x.toFixed(1) + ',' + (H - padB) + 'Z';
        // X labels: up to 5 evenly spaced dates.
        var xl = '', nLab = Math.min(5, pts.length);
        for (var i = 0; i < nLab; i++) {
          var t = t0 + (t1 - t0) * (nLab === 1 ? 0.5 : i / (nLab - 1));
          var dd = new Date(t);
          xl += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === nLab - 1 ? 'end' : 'middle') + '">' + U.MONTHS[dd.getMonth()] + ' ' + dd.getDate() + '</text>';
        }
        chart.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progress chart">' +
          '<g class="grid">' + ticks.map(function (tk) { return '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(tk).toFixed(1) + '" y2="' + y(tk).toFixed(1) + '"/>'; }).join('') + '</g>' +
          '<g class="axis">' + ticks.map(function (tk) { return '<text x="' + (padL - 8) + '" y="' + (y(tk) + 3.5).toFixed(1) + '" text-anchor="end">' + U.fmtNum(tk, 1) + '</text>'; }).join('') + xl + '</g>' +
          '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/>' +
          '<line class="hover-line" id="woHover" y1="' + padT + '" y2="' + (H - padB) + '" visibility="hidden"/>' +
          xy.map(function (q) { return '<circle class="pt' + (q.pr ? ' pr' : '') + '" cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + (q.pr ? 4.5 : 3.5) + '"/>'; }).join('') +
          '</svg>';
        geom = { xy: xy, W: W };
        var first = vals[0], lastV = vals[vals.length - 1], change = lastV - first;
        var unit = view.metric === 'reps' ? 'reps' : data.unit;
        var label = { e1rm: 'Estimated 1RM', top: 'Top set', volume: 'Volume', reps: 'Total reps' }[view.metric];
        chartFoot.innerHTML = '<span>' + label + ': <b style="color:var(--text)">' + U.fmtNum(lastV, 1) + ' ' + unit + '</b> latest · best ' + U.fmtNum(Math.max.apply(null, vals), 1) + '</span>' +
          (pts.length > 1 ? '<span class="badge ' + (change > 0 ? 'ok' : change < 0 ? 'warn' : '') + '" style="margin-left:auto">' + (change >= 0 ? '+' : '') + U.fmtNum(change, 1) + ' ' + unit + ' over ' + pts.length + ' sessions</span>' : '');
      }

      function onMove(e) {
        if (!geom) return;
        var svg = chart.querySelector('svg'); if (!svg) return;
        var r = svg.getBoundingClientRect();
        var mx = (e.clientX - r.left) / r.width * geom.W;
        var best = null, bd = Infinity;
        geom.xy.forEach(function (q) { var d = Math.abs(q.x - mx); if (d < bd) { bd = d; best = q; } });
        if (!best) return;
        var hl = svg.querySelector('#woHover');
        hl.setAttribute('x1', best.x); hl.setAttribute('x2', best.x); hl.setAttribute('visibility', 'visible');
        var sets = best.p.sets.map(function (st) { return st.reps + (st.weight ? '×' + U.fmtNum(toDisplay(st.weight), 2) : ''); }).join(', ');
        tip.innerHTML = '<b>' + U.fmtNum(best.v, 1) + ' ' + (view.metric === 'reps' ? 'reps' : data.unit) + '</b>' + (best.pr ? ' · PR' : '') + '<br><span style="opacity:.75">' + U.fmtDay(U.parseDay(best.p.date), { weekday: true }) + ' · ' + U.esc(sets) + '</span>';
        var wrapR = U.$('#woChartWrap', root).getBoundingClientRect();
        tip.style.left = (r.left - wrapR.left + best.x / geom.W * r.width) + 'px';
        tip.style.top = (r.top - wrapR.top + best.y / 220 * r.height) + 'px';
        tip.classList.add('show');
      }
      function onLeave() { tip.classList.remove('show'); var hl = chart.querySelector('#woHover'); if (hl) hl.setAttribute('visibility', 'hidden'); }
      chart.addEventListener('pointermove', onMove);
      chart.addEventListener('pointerleave', onLeave);
      var ro = window.ResizeObserver ? new ResizeObserver(U.debounce(function () { if (data.sessions.length) drawChart(); }, 80)) : null;
      if (ro) ro.observe(chart);

      /* ---------- Editor ---------- */
      function editor(session, template) {
        var isNew = !session;
        var draft = session ? JSON.parse(JSON.stringify(session)) :
          { id: U.uid(), date: U.dayKey(), title: template ? template.title : '', notes: '', exercises: template ? JSON.parse(JSON.stringify(template.exercises)) : [{ name: '', sets: [{ reps: '', weight: '' }] }] };
        var names = exerciseNames();
        var recent = [], seenTitles = {};
        sorted().forEach(function (s) { var k = (s.title || '').toLowerCase(); if (recent.length < 4 && !seenTitles[k]) { seenTitles[k] = true; recent.push(s); } });

        var body = U.h('<div>' +
          (isNew && recent.length && !template ? '<div class="form-row"><span class="form-label">Start from a previous workout</span><div class="chips">' +
            recent.map(function (s) { return '<button type="button" class="chip" data-tpl="' + s.id + '">' + U.icon('repeat').replace('class="i"', 'class="i" style="width:13px;height:13px"') + U.esc(s.title || 'Workout') + ' <span class="muted">' + U.esc(U.fmtDay(U.parseDay(s.date))) + '</span></button>'; }).join('') + '</div></div>' : '') +
          '<div class="form-row" style="display:grid;grid-template-columns:1fr 160px;gap:10px">' +
            '<div><label class="form-label" for="woTitle">Name</label><input class="text-input" id="woTitle" maxlength="60" placeholder="e.g. Push day"></div>' +
            '<div><label class="form-label" for="woDate">Date</label><input class="text-input" id="woDate" type="date"></div></div>' +
          '<datalist id="woNames">' + names.map(function (n) { return '<option value="' + U.esc(n.name) + '">'; }).join('') + '</datalist>' +
          '<div id="woExList"></div>' +
          '<button type="button" class="btn btn-soft btn-sm" style="margin-top:10px" data-addex>' + U.icon('plus') + 'Add exercise</button>' +
          '<div class="form-row"><label class="form-label" for="woNotes">Notes</label><textarea class="text-area" id="woNotes" rows="2" style="min-height:60px" placeholder="How did it feel?"></textarea></div>' +
          '</div>');
        var title = U.$('#woTitle', body), date = U.$('#woDate', body), notes = U.$('#woNotes', body), exList = U.$('#woExList', body);
        title.value = draft.title || ''; date.value = draft.date; notes.value = draft.notes || '';

        function readBack() {
          // Pull values from inputs into draft (weights stay in display units until save).
          draft.title = title.value; draft.date = date.value || U.dayKey(); draft.notes = notes.value;
          U.$$('.ex-block', exList).forEach(function (blk, i) {
            var ex = draft.exercises[i]; if (!ex) return;
            ex.name = U.$('[data-exname]', blk).value;
            U.$$('tr[data-set]', blk).forEach(function (tr, j) {
              ex.sets[j] = { reps: U.$('[data-reps]', tr).value, weight: U.$('[data-weight]', tr).value, _disp: true };
            });
          });
        }
        function prevText(name) {
          var prev = name && name.trim() ? lastSetsFor(name, date.value || draft.date, draft.id) : null;
          return prev ? 'Last time (' + U.fmtDay(U.parseDay(prev.date)) + '): ' + prev.sets.map(function (st) { return st.reps + (st.weight ? '×' + U.fmtNum(toDisplay(st.weight), 2) : ''); }).join(', ') : '';
        }
        function refreshHints() {
          U.$$('.ex-block', exList).forEach(function (blk) {
            var t = prevText(U.$('[data-exname]', blk).value), el = U.$('[data-prev]', blk);
            el.textContent = t; el.hidden = !t;
          });
        }
        function dispWeight(st) { return st._disp ? st.weight : (st.weight ? toDisplay(st.weight) : ''); }
        function paintEx(focusLast) {
          exList.innerHTML = draft.exercises.map(function (ex, i) {
            var prevTxt = prevText(ex.name);
            return '<div class="ex-block" data-i="' + i + '">' +
              '<div class="ex-block-head"><input data-exname list="woNames" placeholder="Exercise, e.g. Bench press" value="' + U.esc(ex.name) + '" aria-label="Exercise name">' +
              '<button type="button" class="icon-btn sm danger" data-rmex title="Remove exercise" aria-label="Remove exercise">' + U.icon('trash') + '</button></div>' +
              '<div class="sets prev" data-prev style="margin:0 0 4px"' + (prevTxt ? '' : ' hidden') + '>' + U.esc(prevTxt) + '</div>' +
              '<table class="sets"><thead><tr><th>Set</th><th>Reps</th><th>Weight (' + data.unit + ')</th><th></th></tr></thead><tbody>' +
              ex.sets.map(function (st, j) {
                return '<tr data-set="' + j + '"><td class="n">' + (j + 1) + '</td>' +
                  '<td><input data-reps type="number" inputmode="numeric" min="0" step="1" value="' + U.esc(st.reps) + '" aria-label="Reps for set ' + (j + 1) + '"></td>' +
                  '<td><input data-weight type="number" inputmode="decimal" min="0" step="any" placeholder="Bodyweight" value="' + U.esc(dispWeight(st)) + '" aria-label="Weight for set ' + (j + 1) + '"></td>' +
                  '<td class="x"><button type="button" class="icon-btn sm" data-rmset title="Remove set" aria-label="Remove set ' + (j + 1) + '">' + U.icon('x') + '</button></td></tr>';
              }).join('') + '</tbody></table>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-addset style="margin-top:4px">' + U.icon('plus') + 'Add set</button>' +
            '</div>';
          }).join('');
          if (focusLast) { var ins = U.$$('[data-exname]', exList); var last = ins[ins.length - 1]; if (last) last.focus(); }
        }
        draft.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { st._disp = false; }); });
        paintEx(false);

        body.addEventListener('click', function (e) {
          var t = e.target.closest('[data-tpl]');
          if (t) {
            var src = data.sessions.filter(function (s) { return s.id === t.dataset.tpl; })[0];
            if (src) { readBack(); draft.title = src.title; draft.exercises = JSON.parse(JSON.stringify(src.exercises)); draft.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { st._disp = false; }); }); title.value = draft.title; paintEx(false); U.toast('Copied “' + (src.title || 'Workout') + '”. Adjust and save.'); }
            return;
          }
          if (e.target.closest('[data-addex]')) { readBack(); draft.exercises.push({ name: '', sets: [{ reps: '', weight: '', _disp: true }] }); paintEx(true); return; }
          var blk = e.target.closest('.ex-block'); if (!blk) return;
          var i = +blk.dataset.i;
          if (e.target.closest('[data-rmex]')) { readBack(); draft.exercises.splice(i, 1); paintEx(false); return; }
          if (e.target.closest('[data-addset]')) {
            readBack();
            var sets = draft.exercises[i].sets, last = sets[sets.length - 1] || { reps: '', weight: '', _disp: true };
            sets.push({ reps: last.reps, weight: last.weight, _disp: last._disp });
            paintEx(false);
            var rows = U.$$('.ex-block[data-i="' + i + '"] [data-reps]', exList); rows[rows.length - 1].focus(); rows[rows.length - 1].select();
            return;
          }
          var rm = e.target.closest('[data-rmset]');
          if (rm) { readBack(); var j = +rm.closest('tr').dataset.set; draft.exercises[i].sets.splice(j, 1); if (!draft.exercises[i].sets.length) draft.exercises[i].sets.push({ reps: '', weight: '', _disp: true }); paintEx(false); }
        });
        // Show "last time" hints once an exercise name is chosen.
        body.addEventListener('change', function (e) { if (e.target.matches('[data-exname]') || e.target === date) refreshHints(); });

        var actions = [];
        if (!isNew) actions.push({ label: 'Delete', kind: 'btn-ghost', left: true, onClick: function () { remove(session); } });
        actions.push({ label: 'Cancel', kind: 'btn-ghost' });
        actions.push({ label: isNew ? 'Save workout' : 'Save changes', kind: 'btn-primary', onClick: function () {
          readBack();
          var clean = draft.exercises.map(function (ex) {
            return { name: ex.name.trim(), sets: ex.sets.map(function (st) { return { reps: Math.max(0, parseInt(st.reps, 10) || 0), weight: Math.max(0, st._disp ? fromDisplay(st.weight) : (+st.weight || 0)) }; }).filter(function (st) { return st.reps > 0; }) };
          }).filter(function (ex) { return ex.name && ex.sets.length; });
          if (!clean.length) { U.toast('Add at least one exercise with a set'); return false; }
          var out = { id: draft.id, date: draft.date, title: draft.title.trim(), notes: draft.notes.trim(), exercises: clean, created: session ? session.created : Date.now() };
          var prBefore = prs().reduce(function (m, p) { m[p.key] = p.score || p.reps; return m; }, {});
          if (isNew) data.sessions.push(out);
          else data.sessions[data.sessions.indexOf(session)] = out;
          save(); render();
          var newPRs = prs().filter(function (p) { return p.date === out.date && prBefore[p.key] !== undefined && (p.score || p.reps) > prBefore[p.key]; });
          U.toast(newPRs.length ? 'Saved. New PR: ' + newPRs.map(function (p) { return p.name; }).join(', ') + '!' : isNew ? 'Workout saved' : 'Changes saved');
        } });
        U.modal({ title: isNew ? 'Log workout' : 'Edit workout', size: 'lg', body: body, actions: actions });
        if (isNew && !template) setTimeout(function () { var first = U.$('[data-exname]', exList); if (first && !draft.title) title.focus(); }, 50);
      }

      function remove(s) {
        var i = data.sessions.indexOf(s);
        data.sessions.splice(i, 1); save(); render();
        U.toast('Workout deleted', { action: 'Undo', onAction: function () { data.sessions.splice(i, 0, s); save(); render(); } });
      }

      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          if (a.dataset.act === 'new') editor(null);
          if (a.dataset.act === 'examples') { data.sessions = data.sessions.concat(examples()); save(); render(); U.toast('Example workouts added. Delete them from History.'); }
          if (a.dataset.act === 'more') { historyLimit += 15; renderHistory(sorted()); }
          return;
        }
        var s = e.target.closest('.session');
        if (s) { editor(data.sessions.filter(function (x) { return x.id === s.dataset.id; })[0]); return; }
        var pr = e.target.closest('[data-ex]');
        if (pr) { view.ex = pr.dataset.ex; saveView(); exSel.value = view.ex; drawChart(); U.$('#woChartWrap', root).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
      history.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('session')) { e.preventDefault(); e.target.click(); } });

      function onKey(e) {
        if (U.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open')) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); editor(null); }
      }
      document.addEventListener('keydown', onKey);

      render();
      return function () { document.removeEventListener('keydown', onKey); if (ro) ro.disconnect(); };
    }
  });
})();
