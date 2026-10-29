/* =========================================================================
   Tool: Habit grid
   A GitHub-style contribution grid per habit. Tick today, click any past
   square to fix it, set which weekdays a habit applies to, and track
   current streak, best streak and 30-day completion.
   ========================================================================= */
(function () {
  'use strict';

  var HUES = [145, 255, 25, 300, 65, 200, 340, 105];
  var WEEKS = 53;
  var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function load() {
    var d = U.store.get('habits', null);
    if (!d || !Array.isArray(d.habits)) d = { habits: [] };
    d.habits.forEach(function (h) { if (!h.done) h.done = {}; if (!h.days) h.days = [0, 1, 2, 3, 4, 5, 6]; });
    return d;
  }
  var data = load();
  function save() { U.store.set('habits', data); }

  function scheduled(h, date) { return h.days.indexOf(date.getDay()) !== -1; }
  function isDone(h, key) { return !!h.done[key]; }

  function streaks(h) {
    var today = new Date(), d = today, cur = 0;
    // Today still being open does not break the streak.
    if (scheduled(h, d) && !isDone(h, U.dayKey(d))) d = U.addDays(d, -1);
    for (var guard = 0; guard < 3700; guard++) {
      if (scheduled(h, d)) { if (isDone(h, U.dayKey(d))) cur++; else break; }
      d = U.addDays(d, -1);
      if (h.created && U.dayKey(d) < h.created && !isDone(h, U.dayKey(d))) break;
    }
    var keys = Object.keys(h.done).filter(function (k) { return h.done[k]; }).sort();
    var best = 0, run = 0;
    if (keys.length) {
      var start = U.parseDay(keys[0] < (h.created || keys[0]) ? keys[0] : (h.created || keys[0]));
      for (var x = start; U.daysBetween(x, today) >= 0; x = U.addDays(x, 1)) {
        if (!scheduled(h, x)) continue;
        if (isDone(h, U.dayKey(x))) { run++; if (run > best) best = run; }
        else if (U.daysBetween(x, today) > 0) run = 0;
      }
    }
    return { current: cur, best: Math.max(best, cur), total: keys.length };
  }

  function rate(h, days) {
    var today = new Date(), sched = 0, done = 0;
    var created = h.created ? U.parseDay(h.created) : U.addDays(today, -days + 1);
    for (var i = 0; i < days; i++) {
      var d = U.addDays(today, -i);
      if (U.daysBetween(created, d) < 0) break;
      if (!scheduled(h, d)) continue;
      if (i === 0 && !isDone(h, U.dayKey(d))) continue; // today not finished yet
      sched++;
      if (isDone(h, U.dayKey(d))) done++;
    }
    return sched ? Math.round(done / sched * 100) : null;
  }

  function todayProgress() {
    var t = new Date(), k = U.dayKey(t);
    var due = data.habits.filter(function (h) { return scheduled(h, t); });
    return { done: due.filter(function (h) { return isDone(h, k); }).length, due: due.length };
  }

  function examples() {
    var today = new Date();
    function fill(prob, days) {
      var done = {};
      for (var i = 1; i < 200; i++) { var d = U.addDays(today, -i); if (days.indexOf(d.getDay()) !== -1 && Math.random() < prob) done[U.dayKey(d)] = true; }
      // A recent unbroken run so streaks look alive.
      for (var j = 1; j <= 6; j++) { var dd = U.addDays(today, -j); if (days.indexOf(dd.getDay()) !== -1) done[U.dayKey(dd)] = true; }
      return done;
    }
    var all = [0, 1, 2, 3, 4, 5, 6], weekdays = [1, 2, 3, 4, 5];
    var created = U.dayKey(U.addDays(today, -200));
    return [
      { id: U.uid(), name: 'Read 20 pages', hue: 255, days: all, created: created, done: fill(0.8, all) },
      { id: U.uid(), name: 'Gym', hue: 25, days: [1, 3, 5], created: created, done: fill(0.75, [1, 3, 5]) },
      { id: U.uid(), name: 'No phone after 10pm', hue: 300, days: all, created: created, done: fill(0.6, all) },
      { id: U.uid(), name: 'Code on a side project', hue: 145, days: weekdays, created: created, done: fill(0.55, weekdays) }
    ];
  }

  U.register({
    id: 'habits',
    name: 'Habit grid',
    desc: 'One contribution grid per habit. Tick today, keep streaks alive and see a year of consistency at a glance.',
    hue: 145,
    icon: 'calendarCheck',
    keywords: ['habit', 'streak', 'tracker', 'daily', 'routine', 'grid', 'calendar', 'goals'],
    shortcuts: [['New habit', ['N']], ['Tick habit 1–9 for today', ['1', '…', '9']]],
    homeStat: function () {
      data = load();
      if (!data.habits.length) return '<span class="dot"></span>No habits yet';
      var p = todayProgress(), today = new Date(), cells = '';
      for (var i = 13; i >= 0; i--) {
        var d = U.addDays(today, -i), k = U.dayKey(d);
        var due = data.habits.filter(function (h) { return scheduled(h, d); });
        var frac = due.length ? due.filter(function (h) { return isDone(h, k); }).length / due.length : 0;
        cells += '<i class="' + (frac ? 'on' : '') + '" style="' + (frac ? 'opacity:' + (0.3 + frac * 0.7).toFixed(2) : '') + '"></i>';
      }
      return '<div style="flex:1;min-width:0"><div style="margin-bottom:6px"><b>' + p.done + '/' + p.due + '</b> done today</div><div class="tool-mini-grid">' + cells + '</div></div>';
    },
    mount: function (root) {
      data = load();
      root.innerHTML =
        '<div class="tool-head"><div>' +
          '<h1><span class="tool-icon">' + U.icon('calendarCheck') + '</span>Habit grid</h1>' +
          '<p id="habitSub"></p>' +
        '</div><div class="tool-head-actions">' +
          '<button class="btn btn-primary" data-act="new">' + U.icon('plus') + 'New habit <kbd>N</kbd></button>' +
        '</div></div>' +
        '<div class="stats" id="habitStats"></div>' +
        '<ul class="habit-list" id="habitList"></ul>' +
        '<div id="habitEmpty"></div>';
      var list = U.$('#habitList', root), stats = U.$('#habitStats', root), empty = U.$('#habitEmpty', root), sub = U.$('#habitSub', root);

      function render() {
        var p = todayProgress();
        var has = data.habits.length > 0;
        stats.hidden = !has;
        var d = new Date();
        sub.textContent = U.DAYS_LONG[d.getDay()] + ', ' + U.MONTHS[d.getMonth()] + ' ' + d.getDate() + (has ? ' · ' + (p.due ? (p.done === p.due ? 'Everything done for today. Nice.' : (p.due - p.done) + ' left for today') : 'Nothing scheduled today') : '');
        if (!has) {
          list.innerHTML = '';
          empty.innerHTML = '<div class="empty"><div class="empty-art">' + U.icon('calendarCheck') + '</div><h2>Start your first habit</h2><p>Add something you want to do regularly. Each habit gets a year-long grid that fills up as you go.</p>' +
            '<div class="empty-actions"><button class="btn btn-primary" data-act="new">' + U.icon('plus') + 'New habit</button><button class="btn btn-soft" data-act="examples">' + U.icon('sparkles') + 'Try examples</button></div></div>';
          return;
        }
        empty.innerHTML = '';
        var all = data.habits.map(function (h) { return { h: h, s: streaks(h), r: rate(h, 30) }; });
        var bestCur = all.reduce(function (m, x) { return x.s.current > m.s.current ? x : m; }, all[0]);
        var rates = all.map(function (x) { return x.r; }).filter(function (r) { return r != null; });
        var avg = rates.length ? Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length) : null;
        var total = all.reduce(function (a, x) { return a + x.s.total; }, 0);
        stats.innerHTML =
          stat('Today', p.done + ' / ' + p.due, p.due ? Math.round(p.done / p.due * 100) + '% complete' : 'Rest day') +
          stat('Top streak', bestCur.s.current + (bestCur.s.current === 1 ? ' day' : ' days'), bestCur.h.name) +
          stat('30-day rate', avg == null ? '–' : avg + '%', 'Across all habits') +
          stat('Check-ins', U.fmtNum(total, 0), 'All time');
        list.innerHTML = '';
        all.forEach(function (x, i) { list.appendChild(card(x.h, x.s, x.r, i)); });
        // Show the most recent weeks on narrow screens.
        U.$$('.hgrid-scroll', list).forEach(function (s) { s.scrollLeft = s.scrollWidth; });
      }
      function stat(label, value, subText) {
        return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + U.esc(value) + '</div><div class="stat-sub">' + U.esc(subText) + '</div></div>';
      }

      function card(h, s, r, i) {
        var today = new Date(), tk = U.dayKey(today);
        var li = document.createElement('li');
        li.className = 'habit';
        li.style.setProperty('--h', h.hue);
        li.style.setProperty('--i', i);
        li.dataset.id = h.id;
        var due = scheduled(h, today), done = isDone(h, tk);
        var daysLabel = h.days.length === 7 ? 'Every day' : h.days.length === 5 && h.days.indexOf(0) === -1 && h.days.indexOf(6) === -1 ? 'Weekdays' : h.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).map(function (d) { return U.DAYS[d]; }).join(', ');
        li.innerHTML =
          '<div class="habit-head">' +
            '<button class="today-btn' + (done ? ' on' : '') + '" data-today title="' + (due ? 'Mark today' : 'Not scheduled today, but you can still tick it') + (i < 9 ? ' (' + (i + 1) + ')' : '') + '" aria-pressed="' + done + '" aria-label="Done today: ' + U.esc(h.name) + '"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></button>' +
            '<h3 class="habit-name">' + U.esc(h.name) + '</h3>' +
            '<button class="icon-btn sm" data-edit title="Edit habit" aria-label="Edit ' + U.esc(h.name) + '">' + U.icon('edit') + '</button>' +
          '</div>' +
          '<div class="habit-meta">' +
            '<span class="flame">' + U.icon('flame') .replace('class="i"', 'class="i" style="width:14px;height:14px;vertical-align:-2px"') + ' <b>' + s.current + '</b> day streak</span>' +
            '<span>Best <b>' + s.best + '</b></span>' +
            '<span>30 days <b>' + (r == null ? '–' : r + '%') + '</b></span>' +
            '<span>' + U.esc(daysLabel) + (due ? '' : ' · <i>rest day today</i>') + '</span>' +
          '</div>' +
          grid(h);
        return li;
      }

      function grid(h) {
        var today = new Date();
        // Columns are weeks starting Monday; the last column contains today.
        var dow = (today.getDay() + 6) % 7; // Monday = 0
        var start = U.addDays(today, -dow - (WEEKS - 1) * 7);
        var cells = '', months = '', lastMonth = -1;
        for (var w = 0; w < WEEKS; w++) {
          var colStart = U.addDays(start, w * 7);
          var m = colStart.getMonth();
          months += '<span>' + (m !== lastMonth && colStart.getDate() <= 7 ? U.MONTHS[m] : '') + '</span>';
          if (m !== lastMonth && colStart.getDate() <= 7) lastMonth = m;
          for (var d = 0; d < 7; d++) {
            var day = U.addDays(colStart, d), k = U.dayKey(day), diff = U.daysBetween(day, today);
            var cls = [];
            if (diff < 0) cls.push('future');
            if (isDone(h, k)) cls.push('on');
            else if (!scheduled(h, day)) cls.push('skip');
            if (diff === 0) cls.push('today');
            cells += '<button class="' + cls.join(' ') + '" data-day="' + k + '" title="' + U.fmtDay(day, { weekday: true, year: true }) + (isDone(h, k) ? ' · done' : scheduled(h, day) ? '' : ' · not scheduled') + '" aria-label="' + U.fmtDay(day, { weekday: true, year: true }) + (isDone(h, k) ? ', done' : ', not done') + '"' + (diff < 0 ? ' tabindex="-1"' : '') + '></button>';
          }
        }
        return '<div class="hgrid-scroll"><div class="hgrid-wrap">' +
          '<div class="hgrid-months">' + months + '</div>' +
          '<div class="hgrid-body"><div class="hgrid-days"><span></span><span>Tue</span><span></span><span>Thu</span><span></span><span>Sat</span><span></span></div>' +
          '<div class="hgrid">' + cells + '</div></div>' +
          '</div></div>';
      }

      function toggle(id, key, fromToday) {
        var h = data.habits.filter(function (x) { return x.id === id; })[0]; if (!h) return;
        if (h.done[key]) delete h.done[key]; else h.done[key] = true;
        save();
        var wasAll = false;
        var p = todayProgress();
        if (fromToday && h.done[key] && p.due && p.done === p.due) wasAll = true;
        render();
        if (fromToday) {
          var btn = U.$('.habit[data-id="' + id + '"] [data-today]', list);
          if (btn) { btn.classList.add('pop'); setTimeout(function () { btn.classList.remove('pop'); }, 450); }
        }
        if (wasAll) U.toast('All habits done for today. Well done!');
      }

      function editor(h) {
        var isNew = !h;
        var draft = h ? { name: h.name, hue: h.hue, days: h.days.slice() } : { name: '', hue: HUES[data.habits.length % HUES.length], days: [0, 1, 2, 3, 4, 5, 6] };
        var body = U.h('<div>' +
          '<div class="form-row"><label class="form-label" for="hName">Habit</label><input class="text-input" id="hName" maxlength="80" placeholder="e.g. Walk 8,000 steps" autofocus></div>' +
          '<div class="form-row"><span class="form-label">Colour</span><div class="swatches" role="radiogroup" aria-label="Colour">' + HUES.map(function (hu) { return '<button class="swatch" role="radio" style="--h:' + hu + '" data-hue="' + hu + '" aria-label="Colour ' + hu + '"></button>'; }).join('') + '</div></div>' +
          '<div class="form-row"><span class="form-label">Repeat on</span><div class="day-picker">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<button type="button" data-d="' + d + '" aria-label="' + U.DAYS[d] + '">' + U.DAYS[d].slice(0, 2) + '</button>'; }).join('') + '</div>' +
          '<div class="chips" style="margin-top:8px"><button type="button" class="chip" data-preset="all">Every day</button><button type="button" class="chip" data-preset="wk">Weekdays</button><button type="button" class="chip" data-preset="we">Weekends</button></div></div>' +
          '</div>');
        var name = U.$('#hName', body);
        name.value = draft.name;
        function paint() {
          U.$$('.swatch', body).forEach(function (s) { s.setAttribute('aria-checked', String(+s.dataset.hue === draft.hue)); });
          U.$$('.day-picker button', body).forEach(function (b) { b.setAttribute('aria-pressed', String(draft.days.indexOf(+b.dataset.d) !== -1)); });
        }
        body.addEventListener('click', function (e) {
          var s = e.target.closest('.swatch'); if (s) { draft.hue = +s.dataset.hue; paint(); }
          var d = e.target.closest('[data-d]');
          if (d) { var n = +d.dataset.d, i = draft.days.indexOf(n); if (i === -1) draft.days.push(n); else if (draft.days.length > 1) draft.days.splice(i, 1); paint(); }
          var p = e.target.closest('[data-preset]');
          if (p) { draft.days = { all: [0, 1, 2, 3, 4, 5, 6], wk: [1, 2, 3, 4, 5], we: [0, 6] }[p.dataset.preset]; paint(); }
        });
        paint();
        var actions = [];
        if (!isNew) actions.push({ label: 'Delete', kind: 'btn-ghost left', left: true, onClick: function () { remove(h); } });
        actions.push({ label: 'Cancel', kind: 'btn-ghost' });
        actions.push({ label: isNew ? 'Add habit' : 'Save', kind: 'btn-primary', onClick: function () {
          var n = name.value.trim();
          if (!n) { name.focus(); name.classList.add('invalid'); return false; }
          if (isNew) data.habits.push({ id: U.uid(), name: n, hue: draft.hue, days: draft.days, created: U.dayKey(), done: {} });
          else { h.name = n; h.hue = draft.hue; h.days = draft.days; }
          save(); render();
          if (isNew) U.toast('Added “' + n + '”');
        } });
        var m = U.modal({ title: isNew ? 'New habit' : 'Edit habit', body: body, actions: actions });
        name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); U.$('.btn-primary', m.root).click(); } });
        if (!isNew) {
          // Reorder buttons live in the footer's left side.
          var idx = data.habits.indexOf(h);
          var mv = U.h('<div style="display:flex;gap:2px;margin-right:auto"><button class="icon-btn sm" data-mv="-1" title="Move up" aria-label="Move up"' + (idx === 0 ? ' disabled' : '') + '>' + U.icon('arrowLeft').replace('class="i"', 'class="i" style="transform:rotate(90deg)"') + '</button><button class="icon-btn sm" data-mv="1" title="Move down" aria-label="Move down"' + (idx === data.habits.length - 1 ? ' disabled' : '') + '>' + U.icon('arrowLeft').replace('class="i"', 'class="i" style="transform:rotate(-90deg)"') + '</button></div>');
          var foot = U.$('.modal-foot', m.root);
          foot.insertBefore(mv, foot.children[1]);
          mv.addEventListener('click', function (e) {
            var b = e.target.closest('[data-mv]'); if (!b) return;
            var i = data.habits.indexOf(h), j = i + +b.dataset.mv;
            if (j < 0 || j >= data.habits.length) return;
            data.habits.splice(i, 1); data.habits.splice(j, 0, h); save(); render();
            U.$('[data-mv="-1"]', mv).disabled = j === 0; U.$('[data-mv="1"]', mv).disabled = j === data.habits.length - 1;
          });
        }
      }

      function remove(h) {
        var i = data.habits.indexOf(h);
        data.habits.splice(i, 1); save(); render();
        U.toast('Deleted “' + h.name + '”', { action: 'Undo', onAction: function () { data.habits.splice(i, 0, h); save(); render(); } });
      }

      root.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (a) {
          if (a.dataset.act === 'new') editor(null);
          if (a.dataset.act === 'examples') { data.habits = data.habits.concat(examples()); save(); render(); U.toast('Example habits added. Delete them any time from Edit.'); }
          return;
        }
        var card = e.target.closest('.habit'); if (!card) return;
        var id = card.dataset.id;
        if (e.target.closest('[data-today]')) { toggle(id, U.dayKey(), true); return; }
        if (e.target.closest('[data-edit]')) { editor(data.habits.filter(function (x) { return x.id === id; })[0]); return; }
        var cell = e.target.closest('[data-day]');
        if (cell) toggle(id, cell.dataset.day, cell.dataset.day === U.dayKey());
      });

      function onKey(e) {
        if (U.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-root.open')) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); editor(null); return; }
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9 && data.habits[n - 1]) { e.preventDefault(); toggle(data.habits[n - 1].id, U.dayKey(), true); }
      }
      document.addEventListener('keydown', onKey);

      // Roll over to a new day if the page stays open past midnight.
      var dayNow = U.dayKey();
      var iv = setInterval(function () { if (U.dayKey() !== dayNow) { dayNow = U.dayKey(); render(); } }, 60000);

      render();
      return function () { document.removeEventListener('keydown', onKey); clearInterval(iv); };
    }
  });
})();
