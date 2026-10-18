/* AEGIS — тесты для повышения в администрации (exam.html).

   Одна страница, два режима:
   - СДАЮЩИЙ: ссылка из личного сообщения бота, вида exam.html#t=<id>.<ключ>. Входа на сайт не
     нужно — ключ в ссылке и есть пропуск, и он открывает только этот один тест. Верных ответов,
     пояснений и рубрик служба сдающему не отдает вообще, так что подсмотреть их в коде нельзя.
   - ПУЛЬТ: та же страница без #t. Вход на сайт, дальше служба сама решает, высшая ли это
     администрация; остальным пульт не открывается. Здесь выдача тестов, список сдающих,
     разбор ответов, ручные баллы и окончательное решение.

   Служба — /exam/* на api (exam.py на дедике). Ответы «нет» приходят с кодами 4xx и телом
   {ok:false, code, text}, поэтому запросы идут своим помощником, а не A.call: тот на 4xx теряет
   текст и на 403 выкидывает вход. */
(function (w, d) {
  'use strict';
  var A = w.AegisApi, T = w.AegisTk;
  var esc = A.esc;
  var box = d.getElementById('exBody');

  /* ════════════════════════════════ общее ════════════════════════════════ */

  function req(path, data, opt) {
    opt = opt || {};
    var root = A.base();
    if (!root) return Promise.reject(A.offline());
    var init = { method: data === undefined ? 'GET' : 'POST', cache: 'no-store', headers: {} };
    if (data !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(data);
    }
    if (opt.auth && A.token()) init.headers.Authorization = 'Bearer ' + A.token();
    if (opt.keepalive) init.keepalive = true;
    var timer = null;
    if (typeof AbortController === 'function' && !opt.keepalive) {
      var ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, opt.timeout || 15000);
    }
    return fetch(root + path, init).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.text().then(function (t) {
        var x = null;
        try { x = JSON.parse(t); } catch (e) { x = null; }
        if (!x) {
          throw A.err('down', r.status >= 500 || !t
            ? 'Служба тестов сейчас не отвечает — попробуйте через минуту.'
            : 'Служба ответила не тем, чего мы ждали.');
        }
        if (r.status === 401 && opt.auth) A.setSession(null);
        /* ok в карточке теста значит «порог пройден», поэтому ошибка — только ok:false вместе с кодом */
        if ((x.ok === false && x.code) || !r.ok) {
          var e = A.err(x.code || 'no', x.text || ('Ошибка ' + r.status + '.'));
          e.data = x;
          e.status = r.status;
          throw e;
        }
        return x;
      });
    }, function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw A.err('timeout', 'Служба не ответила вовремя. Попробуйте еще раз.');
      throw A.err('net', 'Нет связи со службой тестов. Проверьте интернет и попробуйте еще раз.');
    });
  }

  function plural(n, f) {
    var a = Math.abs(Math.floor(n)) % 100, b = a % 10;
    if (a > 10 && a < 20) return f[2];
    if (b > 1 && b < 5) return f[1];
    if (b === 1) return f[0];
    return f[2];
  }
  function nw(n, f) { return n + ' ' + plural(n, f); }
  var W_MIN = ['минута', 'минуты', 'минут'], W_Q = ['вопрос', 'вопроса', 'вопросов'],
    W_PT = ['балл', 'балла', 'баллов'], W_TIME = ['раз', 'раза', 'раз'];

  function when(ms) {
    if (!ms) return '';
    var dt = new Date(ms), now = new Date();
    var t = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (dt.toDateString() === now.toDateString()) return 'сегодня, ' + t;
    var y = new Date(now.getTime() - 864e5);
    if (dt.toDateString() === y.toDateString()) return 'вчера, ' + t;
    return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', ' + t;
  }
  function ago(ms) {
    if (!ms) return '';
    var s = (Date.now() - ms) / 1000;
    if (s < 60) return 'только что';
    if (s < 3600) return nw(Math.floor(s / 60), ['минуту', 'минуты', 'минут']) + ' назад';
    if (s < 86400) return nw(Math.floor(s / 3600), ['час', 'часа', 'часов']) + ' назад';
    return when(ms);
  }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function dur(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'меньше минуты';
    return nw(m, W_MIN);
  }
  function para(s) { return esc(s).replace(/\n/g, '<br>'); }
  function pct(v) { return (v == null ? '—' : String(Math.round(v * 10) / 10).replace('.', ',')) + '%'; }
  function num(v) { return String(Math.round((v || 0) * 100) / 100).replace('.', ','); }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { /* закрытое хранилище — живем без памяти */ }
    return null;
  }
  function busy(btn, on, txt) {
    if (!btn) return;
    if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; if (txt) btn.textContent = txt; }
    else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
  }
  function hero(kick, h1, lead) {
    d.getElementById('exKick').textContent = kick;
    d.getElementById('exH1').textContent = h1;
    d.getElementById('exLead').textContent = lead;
  }
  function fail(title, text, extra) {
    box.innerHTML = '<div class="ex-note ex-note-big"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
      (extra || '') + '</div>';
  }
  function avatar(did, name, has, cls) {
    var letter = esc((String(name || '?').replace(/[^\wА-Яа-я]/g, '')[0] || '?').toUpperCase());
    if (!has) return '<span class="ex-av ex-av-l ' + (cls || '') + '">' + letter + '</span>';
    return '<span class="ex-av ' + (cls || '') + '" data-l="' + letter + '"><img src="' +
      esc(A.base() + '/exam/av/' + encodeURIComponent(did)) + '" alt="" loading="lazy" decoding="async"></span>';
  }
  /* Аватар не загрузился — вместо пустого квадрата первая буква имени. */
  d.addEventListener('error', function (e) {
    var im = e.target;
    if (!im || im.tagName !== 'IMG' || !im.parentNode || !im.parentNode.classList.contains('ex-av')) return;
    var sp = im.parentNode;
    sp.classList.add('ex-av-l');
    sp.textContent = sp.getAttribute('data-l') || '?';
  }, true);
  function copy(text, btn) {
    function ok() { if (btn) { var t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(function () { btn.textContent = t; }, 1600); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = d.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.appendChild(ta); ta.select();
      try { d.execCommand('copy'); ok(); } catch (e) { /* пусть выделит сам */ }
      d.body.removeChild(ta);
    }
  }
  function topH() {
    var t = d.querySelector('.topbar');
    return t ? t.offsetHeight : 0;
  }

  var KIND = { one: 'Один ответ', many: 'Несколько ответов', open: 'Развернутый ответ' };
  var BRANCH = { game: 'Игровая администрация', discord: 'Discord' };

  /* ═══════════════════════════════ сдающий ═══════════════════════════════ */

  var X = { id: '', k: '', dev: '', v: null, skew: 0, answers: [], dirty: false, saving: false,
    savedAt: 0, saveErr: '', away: { n: 0, ms: 0 }, awayFrom: 0, tick: null, loop: null, poll: null,
    sending: false, sent: false };

  function devId() {
    var k = 'aegis.exam.dev', v = store(k);
    if (v && v.length >= 16) return v;
    var a = new Uint8Array(16);
    (w.crypto || w.msCrypto).getRandomValues(a);
    v = Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    store(k, v);
    return v;
  }

  function takeCall(path, extra, opt) {
    var b = { id: X.id, k: X.k, dev: X.dev };
    for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) b[key] = extra[key];
    return req('/exam/take/' + path, b, opt);
  }

  function takeStart() {
    var m = /(?:^|[#&])t=([0-9a-f]{6,40})\.([\w-]{8,80})/i.exec(location.hash || '');
    X.id = m[1]; X.k = m[2];
    try { X.dev = devId(); } catch (e) { X.dev = 'nodev-' + Math.random().toString(36).slice(2) + Date.now(); }
    hero('Тест для команды', 'Тест на должность', 'Загружаем тест…');
    takeInfo(true);
  }

  function takeInfo(first) {
    return takeCall('info', {}).then(function (v) { show(v); }, function (e) {
      if (!first && (e.code === 'net' || e.code === 'timeout' || e.code === 'down')) return;
      takeError(e);
    });
  }

  function takeError(e) {
    stopTimers();
    if (e.code === 'no_exam') {
      hero('Тест для команды', 'Тест не найден', 'Ссылка неполная или тест уже удален.');
      fail('Что делать', 'Откройте ссылку из личного сообщения бота AEGIS целиком — она длинная, ' +
        'и часть могла не скопироваться. Если не помогло, напишите тому, кто выдал тест.');
    } else if (e.code === 'other_device') {
      hero('Тест для команды', 'Тест открыт в другом браузере', 'Продолжить можно только там, где он был начат.');
      fail('Что делать', e.text);
    } else if (e.code === 'expired') {
      hero('Тест для команды', 'Срок теста вышел', 'Начать тест можно было в течение трех суток после выдачи.');
      fail('Что делать', e.text);
    } else {
      fail('Не получилось открыть тест', A.textOf(e),
        '<p class="ex-act"><button class="btn btn-dark btn-sm" type="button" data-x="retry">Попробовать еще раз</button></p>');
    }
  }

  function show(v) {
    X.v = v;
    X.skew = (v.now || Date.now()) - Date.now();
    stopTimers();
    if (v.state === 'new') return drawIntro(v);
    if (v.state === 'run') return drawRun(v);
    if (v.state === 'done' || v.state === 'final') return drawResult(v);
    if (v.state === 'cancel') {
      hero('Тест для команды', 'Тест отменен', 'Тест «' + v.title + '» закрыт администрацией.');
      return fail('Тест отменен', v.reason || 'Тест закрыт администрацией.',
        '<p class="ex-muted">Если нужен новый тест, его выдаст высшая администрация — ссылка придет в личные сообщения Discord.</p>');
    }
    if (v.state === 'expired') {
      hero('Тест для команды', 'Срок теста вышел', 'Тест «' + v.title + '» так и не был начат.');
      return fail('Срок вышел', 'Начать тест можно было в течение трех суток после выдачи. Новый тест выдает высшая администрация.');
    }
    fail('Тест недоступен', 'Состояние теста не распознано. Обновите страницу.');
  }

  function stopTimers() {
    clearInterval(X.tick); clearInterval(X.loop); clearTimeout(X.poll);
    X.tick = X.loop = X.poll = null;
  }

  /* ---------- до старта ---------- */

  function drawIntro(v) {
    hero('Тест для команды', 'Тест на должность «' + v.title + '»',
      'Здравствуйте, ' + v.name + '. Перед повышением в команде AEGIS проходит короткий тест по правилам, ' +
      'вики и работе с игроками. Прочитайте условия ниже — таймер пойдет сразу после кнопки «Начать тест».');
    var k = v.kinds || {};
    var parts = [];
    if (k.one) parts.push(nw(k.one, ['с одним ответом', 'с одним ответом', 'с одним ответом']));
    if (k.many) parts.push(k.many + ' с несколькими');
    if (k.open) parts.push(k.open + ' ' + plural(k.open, ['развернутый', 'развернутых', 'развернутых']));
    box.innerHTML =
      '<div class="ex-intro">' +
        '<div class="ex-facts">' +
          fact('Время', nw(v.minutes, W_MIN), 'таймер не останавливается') +
          fact('Порог', v.pass + '%', 'от всех баллов теста') +
          fact('Вопросов', String(v.n), parts.join(', ')) +
          fact('Начать до', when(v.expires), 'потом ссылка сгорит') +
        '</div>' +
        '<div class="ex-rules">' +
          '<h2>Как это устроено</h2>' +
          '<ul>' +
            '<li>Вопросы собраны под эту должность: правила сервера, вики, работа с обращениями и игроками, ' +
              'сценарии из практики. Набор и порядок у каждого свои.</li>' +
            '<li>В вопросах с одним ответом верен ровно один вариант. Там, где «несколько ответов», отметьте все верные: ' +
              'лишняя отметка снижает балл.</li>' +
            '<li>Развернутый ответ пишите своими словами, как действовали бы на деле. Важен смысл и порядок действий, ' +
              'а не объем.</li>' +
            '<li>Ответы сохраняются сами. Когда время выйдет, тест сдастся автоматически с тем, что успели.</li>' +
            '<li>Тест привязывается к этому браузеру. Уходы со страницы видны проверяющему.</li>' +
            '<li>Сначала ответы проверит ИИ — предварительный итог появится здесь и в личных сообщениях. ' +
              'Окончательное решение принимает высшая администрация.</li>' +
            '<li>Есть ключевые вопросы: ошибка в них не дает пройти даже при высоком проценте.</li>' +
          '</ul>' +
          '<label class="ex-check"><input type="checkbox" id="exReady"> <span>Я прочитал(а) условия, у меня есть ' +
            nw(v.minutes, W_MIN) + ' без перерыва</span></label>' +
          '<div class="ex-act"><button class="btn btn-primary" type="button" data-x="start" disabled>Начать тест</button>' +
            '<span class="ex-say" role="status"></span></div>' +
        '</div>' +
      '</div>';
    d.getElementById('exReady').addEventListener('change', function () {
      box.querySelector('[data-x="start"]').disabled = !this.checked;
    });
  }
  function fact(k, v, s) {
    return '<div class="ex-fact"><span>' + esc(k) + '</span><b>' + esc(v) + '</b><small>' + esc(s || '') + '</small></div>';
  }

  function doStart(btn) {
    busy(btn, true, 'Запускаем…');
    takeCall('start', {}).then(function (v) { show(v); }, function (e) {
      busy(btn, false);
      if (e.code === 'other_device' || e.code === 'expired' || e.code === 'no_exam') return takeError(e);
      box.querySelector('.ex-say').textContent = A.textOf(e);
    });
  }

  /* ---------- идет тест ---------- */

  function backupKey() { return 'aegis.exam.a.' + X.id; }

  function drawRun(v) {
    hero('Тест для команды', 'Тест на должность «' + v.title + '»', 'Отвечайте по порядку или в любом удобном — ' +
      'номера сверху показывают, что уже сделано. Ответы сохраняются сами.');
    X.answers = (v.answers || []).slice();
    var bk = null;
    try { bk = JSON.parse(store(backupKey()) || 'null'); } catch (e) { bk = null; }
    if (bk && bk.a && bk.a.length === X.answers.length) X.answers = bk.a;
    var qs = v.questions || [];
    var h = '<div class="ex-bar" id="exBar"><div class="ex-bar-in">' +
      '<div class="ex-time" id="exTime"><span>Осталось</span><b>—</b></div>' +
      '<div class="ex-dots" id="exDots">';
    for (var i = 0; i < qs.length; i++) h += '<button type="button" data-go="' + i + '" aria-label="Вопрос ' + (i + 1) + '">' + (i + 1) + '</button>';
    h += '</div><div class="ex-bar-r"><span class="ex-saved" id="exSaved" role="status"></span>' +
      '<button class="btn btn-primary btn-sm" type="button" data-x="ask">Сдать</button></div></div>' +
      '<div class="ex-prog"><i id="exProg"></i></div></div>';
    h += '<form class="ex-qs" id="exQs" autocomplete="off" onsubmit="return false">';
    qs.forEach(function (q, n) {
      h += '<section class="ex-q" id="exq' + n + '" data-q="' + n + '">' +
        '<header><span class="ex-qn">' + (n + 1) + '</span><span class="ex-qk">' + KIND[q.kind] + '</span>' +
        '<span class="ex-qp">' + nw(q.max, W_PT) + '</span></header>' +
        '<div class="ex-qt">' + para(q.text) + '</div>';
      if (q.kind === 'open') {
        h += '<textarea class="ex-ta" data-i="' + n + '" maxlength="2500" rows="6" spellcheck="true" ' +
          'placeholder="Ваш ответ: что делаете, в каком порядке и почему"></textarea>' +
          '<div class="ex-ta-n"><span data-cnt="' + n + '">0</span> / 2500</div>';
      } else {
        if (q.kind === 'many') h += '<p class="ex-hint">Отметьте все верные варианты.</p>';
        h += '<div class="ex-opts">';
        (q.opts || []).forEach(function (o, j) {
          h += '<label class="ex-opt"><input type="' + (q.kind === 'one' ? 'radio' : 'checkbox') + '" name="q' + n +
            '" value="' + j + '" data-i="' + n + '"><span class="ex-mark"></span><span class="ex-ot">' + para(o) + '</span></label>';
        });
        h += '</div>';
      }
      h += '</section>';
    });
    h += '</form><div class="ex-end"><p>Проверьте ответы. Сдать можно в любой момент — после сдачи изменить ничего нельзя.</p>' +
      '<button class="btn btn-primary" type="button" data-x="ask">Сдать тест</button></div>' +
      '<div class="ex-modal" id="exModal" hidden><div class="ex-modal-in" role="dialog" aria-modal="true" aria-labelledby="exMh">' +
      '<h2 id="exMh">Сдать тест?</h2><p id="exMp"></p><div class="ex-act">' +
      '<button class="btn btn-primary btn-sm" type="button" data-x="submit">Сдать</button>' +
      '<button class="btn btn-dark btn-sm" type="button" data-x="close">Вернуться к вопросам</button></div></div></div>';
    box.innerHTML = h;
    d.getElementById('exBar').style.top = topH() + 'px';
    // ответы, которые уже есть
    qs.forEach(function (q, n) {
      var a = X.answers[n];
      if (q.kind === 'open') {
        var ta = box.querySelector('textarea[data-i="' + n + '"]');
        ta.value = a || '';
        box.querySelector('[data-cnt="' + n + '"]').textContent = String((a || '').length);
      } else if (q.kind === 'one') {
        if (a != null) { var r = box.querySelector('input[name="q' + n + '"][value="' + a + '"]'); if (r) r.checked = true; }
      } else (a || []).forEach(function (j) {
        var c = box.querySelector('input[name="q' + n + '"][value="' + j + '"]'); if (c) c.checked = true;
      });
    });
    var form = d.getElementById('exQs');
    form.addEventListener('change', onAnswer);
    form.addEventListener('input', onAnswer);
    form.addEventListener('copy', noCopy);
    form.addEventListener('cut', noCopy);
    marks();
    X.sent = X.sending = false;
    X.tick = setInterval(tickTime, 250);
    X.loop = setInterval(function () { if (X.dirty) save(); }, 8000);
    tickTime();
    savedLine();
  }

  function noCopy(e) {
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  }

  function onAnswer(e) {
    var el = e.target, n = Number(el.getAttribute('data-i'));
    if (isNaN(n)) return;
    var q = X.v.questions[n];
    if (q.kind === 'open') {
      X.answers[n] = el.value;
      var c = box.querySelector('[data-cnt="' + n + '"]');
      if (c) c.textContent = String(el.value.length);
    } else if (q.kind === 'one') {
      var r = box.querySelector('input[name="q' + n + '"]:checked');
      X.answers[n] = r ? Number(r.value) : null;
    } else {
      X.answers[n] = Array.prototype.map.call(box.querySelectorAll('input[name="q' + n + '"]:checked'),
        function (x) { return Number(x.value); });
    }
    X.dirty = true;
    X.lastEdit = Date.now();
    store(backupKey(), JSON.stringify({ a: X.answers, t: Date.now() }));
    marks();
    savedLine();
  }

  function answered(n) {
    var a = X.answers[n], q = X.v.questions[n];
    if (q.kind === 'open') return !!String(a || '').trim();
    if (q.kind === 'one') return a != null;
    return !!(a && a.length);
  }

  function marks() {
    var qs = X.v.questions, done = 0;
    for (var n = 0; n < qs.length; n++) {
      var ok = answered(n);
      if (ok) done++;
      var b = box.querySelector('[data-go="' + n + '"]');
      if (b) b.classList.toggle('on', ok);
      var s = d.getElementById('exq' + n);
      if (s) s.classList.toggle('on', ok);
    }
    var p = d.getElementById('exProg');
    if (p) p.style.width = (100 * done / qs.length) + '%';
    return done;
  }

  function left() { return X.v.until - (Date.now() + X.skew); }

  function tickTime() {
    var el = d.getElementById('exTime');
    if (!el || !X.v) return;
    var ms = left();
    el.querySelector('b').textContent = clock(ms);
    el.classList.toggle('warn', ms < 5 * 60000);
    el.classList.toggle('hot', ms < 60000);
    if (ms <= 0 && !X.sent) {
      el.querySelector('span').textContent = 'Время вышло';
      doSubmit(true);
    }
  }

  function awayNow() {
    var a = { n: X.away.n, ms: X.away.ms };
    if (X.awayFrom) a.ms += Date.now() - X.awayFrom;
    a.ms = Math.round(a.ms);
    return a;
  }

  function save(keep) {
    if (X.saving && !keep) return;
    X.saving = true;
    var sentAt = Date.now();
    var p = takeCall('save', { answers: X.answers, away: awayNow() }, keep ? { keepalive: true } : { timeout: 12000 });
    if (keep) return;
    p.then(function (r) {
      X.saving = false;
      if (r.state) return show(r);
      if (X.lastEdit && X.lastEdit > sentAt) X.dirty = true; else X.dirty = false;
      X.savedAt = Date.now(); X.saveErr = '';
      if (r.until && X.v) X.v.until = r.until;
      if (r.now) X.skew = r.now - Date.now();
      savedLine();
    }, function (e) {
      X.saving = false;
      if (e.code === 'other_device' || e.code === 'no_exam') return takeError(e);
      X.saveErr = e.code === 'net' || e.code === 'timeout' ? 'нет связи — повторим сами' : A.textOf(e);
      savedLine();
    });
  }

  function savedLine() {
    var el = d.getElementById('exSaved');
    if (!el) return;
    if (X.saveErr) { el.textContent = 'Не сохранено: ' + X.saveErr; el.className = 'ex-saved bad'; return; }
    el.className = 'ex-saved';
    el.textContent = X.dirty ? 'Сохраняем…' : (X.savedAt ? 'Сохранено' : 'Ответы сохраняются сами');
  }

  function ask() {
    var left0 = X.v.questions.length - marks();
    d.getElementById('exMp').textContent = left0
      ? 'Без ответа ' + nw(left0, W_Q) + '. После сдачи изменить ответы нельзя.'
      : 'Все вопросы отвечены. После сдачи изменить ответы нельзя.';
    var m = d.getElementById('exModal');
    m.hidden = false;
    m.querySelector('[data-x="close"]').focus();
  }

  function doSubmit(auto) {
    if (X.sending) return;
    X.sending = true;
    var m = d.getElementById('exModal');
    if (m) m.hidden = true;
    box.querySelectorAll('[data-x="ask"],[data-x="submit"]').forEach(function (b) { busy(b, true, 'Сдаем…'); });
    takeCall('submit', { answers: X.answers, away: awayNow() }, { timeout: 20000 }).then(function (v) {
      X.sent = true;
      store(backupKey(), null);
      w.scrollTo(0, 0);
      show(v);
    }, function (e) {
      X.sending = false;
      if (e.code === 'other_device' || e.code === 'no_exam') return takeError(e);
      box.querySelectorAll('[data-x="ask"],[data-x="submit"]').forEach(function (b) { busy(b, false); });
      X.saveErr = (auto ? 'автосдача не дошла — ' : 'сдать не вышло — ') + (e.code === 'net' ? 'нет связи, повторим' : A.textOf(e));
      savedLine();
      if (auto) setTimeout(function () { if (!X.sent) doSubmit(true); }, 5000);
    });
  }

  /* Уходы со страницы: свернул вкладку, переключился в другое окно. Считаем число и время —
     проверяющий видит это рядом с ответами. */
  function awayStart() {
    if (!X.v || X.v.state !== 'run' || X.sent || X.awayFrom) return;
    X.awayFrom = Date.now();
    X.away.n++;
    if (X.dirty) save(true), X.dirty = false;
  }
  function awayEnd() {
    if (!X.awayFrom) return;
    X.away.ms += Date.now() - X.awayFrom;
    X.awayFrom = 0;
    X.dirty = true;
  }
  d.addEventListener('visibilitychange', function () { if (d.hidden) awayStart(); else awayEnd(); });
  w.addEventListener('blur', function () { setTimeout(function () { if (!d.hasFocus()) awayStart(); }, 300); });
  w.addEventListener('focus', awayEnd);
  w.addEventListener('pagehide', function () {
    if (X.v && X.v.state === 'run' && !X.sent && X.dirty) save(true);
  });

  /* ---------- итог ---------- */

  function drawResult(v) {
    var r = v.result || {}, f = r.final;
    var h = '';
    if (f) {
      var pass = f.verdict === 'pass';
      hero('Тест для команды', pass ? 'Тест пройден' : 'Тест не пройден',
        pass ? 'Поздравляем: решение принято, роль «' + v.title + '» выдается автоматически.'
          : 'Решение принято. Новый тест выдает высшая администрация — дождитесь его.');
      h += '<div class="ex-verdict ' + (pass ? 'ok' : 'no') + '"><span>Окончательное решение</span><b>' +
        (pass ? 'Повышение до «' + esc(v.title) + '»' : 'Тест не пройден') + '</b>' +
        (f.note ? '<p>' + para(f.note) + '</p>' : '') + '<small>' + esc(when(f.at)) + '</small></div>';
    } else {
      hero('Тест для команды', 'Тест сдан', r.auto ? 'Время вышло, и тест сдался сам с сохраненными ответами.'
        : 'Ответы приняты. Изменить их уже нельзя.');
    }
    h += '<div class="ex-res">';
    h += fact('Тестовая часть', num(r.closed) + ' из ' + num(r.closed_max), 'вопросы с вариантами');
    if (r.open_max) {
      h += fact('Развернутые ответы', r.open == null ? (r.ai === 'fail' ? 'проверит администрация' : 'проверяет ИИ')
        : num(r.open) + ' из ' + num(r.open_max), 'смысл и порядок действий');
    }
    h += fact('Итог', r.pct == null ? '—' : pct(r.pct), 'порог ' + r.need + '%');
    h += '</div>';
    if (!f) {
      if (r.ai === 'wait') {
        h += '<div class="ex-note ex-wait"><div class="loading"><i></i><i></i><i></i></div><h2>ИИ проверяет развернутые ответы</h2>' +
          '<p>Обычно это занимает до пары минут. Страница обновится сама, а предварительный итог придет и в личные сообщения Discord.</p></div>';
      } else if (r.ai === 'fail') {
        h += '<div class="ex-note"><h2>Развернутые ответы проверит администрация</h2>' +
          '<p>Автоматическая проверка в этот раз не получилась. Это не влияет на результат: ответы целиком прочитает высшая администрация.</p></div>';
      } else if (r.pct != null) {
        var good = r.ok;
        h += '<div class="ex-pre ' + (good ? 'ok' : 'no') + '"><span>Предварительный итог</span><b>' +
          (good ? 'Порог пройден' : 'Порог не пройден') + '</b>' +
          (r.crit ? '<p>Есть ошибка в ключевом вопросе — такой тест не проходит даже с высоким процентом.</p>' : '') +
          (r.summary ? '<p>' + para(r.summary) + '</p>' : '') + '</div>';
      }
      h += '<div class="ex-note"><h2>Что дальше</h2><p>Предварительную оценку ставит ИИ, а окончательное решение — высшая администрация: ' +
        'она перечитает ответы и может поправить баллы в любую сторону. Решение придет в личные сообщения Discord и появится на этой странице.</p></div>';
    }
    box.innerHTML = h;
    if (!f) X.poll = setTimeout(function () { takeInfo(false); }, r.ai === 'wait' ? 15000 : 60000);
  }

  /* ══════════════════════════════ пульт ══════════════════════════════ */

  var P = { me: null, tab: store('aegis.exam.tab') || 'give', level: '', member: null, q: '', list: [],
    filter: 'act', open: '', item: null, timer: null, qTimer: null, note: '' };

  function consoleStart() {
    hero('Для команды', 'Тесты администрации', 'Выдача тестов перед повышением, проверка и решение. ' +
      'Раздел только для высшей администрации.');
    if (!A.token()) return drawLogin();
    box.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    req('/exam/me', undefined, { auth: true }).then(function (me) {
      P.me = me;
      if (!me.top) {
        return fail('Раздел высшей администрации', 'Вы вошли как ' + me.nick + '. Тесты выдает и проверяет высшая ' +
          'администрация. Если вам выдали тест — откройте ссылку из личного сообщения бота AEGIS.',
          '<p class="ex-act"><button class="btn btn-dark btn-sm" type="button" data-p="logout">Выйти</button></p>');
      }
      drawConsole();
    }, function (e) {
      if (e.code === 'auth') return drawLogin();
      fail('Пульт не открылся', A.textOf(e),
        '<p class="ex-act"><button class="btn btn-dark btn-sm" type="button" data-p="reload">Попробовать еще раз</button></p>');
    });
  }

  function drawLogin() {
    T.login(box, {
      title: 'Вход в пульт тестов',
      lead: 'Ник и пароль те же, что в лаунчере. Пульт откроется только высшей администрации.',
      done: consoleStart
    });
  }

  function drawConsole() {
    box.innerHTML =
      '<div class="ex-top"><div class="ex-tabs" role="tablist">' +
        '<button type="button" role="tab" data-tab="give">Выдать тест</button>' +
        '<button type="button" role="tab" data-tab="list">Тесты <em id="exWait"></em></button>' +
      '</div><div class="ex-who">' + esc(P.me.nick) + ' · <button type="button" class="ex-link" data-p="logout">выйти</button></div></div>' +
      '<div id="exPane"></div>';
    tab(P.tab === 'list' ? 'list' : 'give');
    refreshList(true);
    clearInterval(P.timer);
    P.timer = setInterval(function () {
      if (d.hidden) return;
      refreshList(true);
      if (P.tab === 'list' && P.open && P.item && liveItem(P.item)) loadItem(P.open, true);
    }, 20000);
  }

  function tab(t) {
    P.tab = t;
    store('aegis.exam.tab', t);
    box.querySelectorAll('[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (t === 'give') drawGive();
    else if (P.open) loadItem(P.open);
    else drawList();
  }

  /* ---------- выдача ---------- */

  function drawGive() {
    var pane = d.getElementById('exPane');
    var lv = P.me.levels || [];
    var h = '<div class="ex-step"><h2><span>1</span>Должность</h2><div class="ex-levels">';
    ['game', 'discord'].forEach(function (br) {
      lv.filter(function (l) { return l.branch === br; }).forEach(function (l) {
        h += '<button type="button" class="ex-lv' + (P.level === l.key ? ' on' : '') + '" data-lv="' + esc(l.key) + '">' +
          '<small>' + esc(BRANCH[l.branch] || l.branch) + '</small><b>' + esc(l.title) + '</b>' +
          '<span>' + nw(l.minutes, W_MIN) + ' · порог ' + l.pass + '%</span>' +
          '<span>' + nw(l.closed + l.open, W_Q) + ', из них ' + l.open + ' ' + plural(l.open, ['развернутый', 'развернутых', 'развернутых']) + '</span></button>';
      });
    });
    h += '</div></div>' +
      '<div class="ex-step"><h2><span>2</span>Кому</h2>' +
      '<div class="ex-search"><input type="search" id="exQ" placeholder="Имя или ник в Discord" value="' + esc(P.q) + '" ' +
      'autocomplete="off" spellcheck="false" aria-label="Поиск участника"><span id="exMemAt"></span></div>' +
      '<div class="ex-mems" id="exMems"><div class="loading"><i></i><i></i><i></i></div></div></div>' +
      '<div class="ex-step ex-go" id="exGo"></div>';
    pane.innerHTML = h;
    var q = d.getElementById('exQ');
    q.addEventListener('input', function () {
      P.q = q.value;
      clearTimeout(P.qTimer);
      P.qTimer = setTimeout(loadMembers, 250);
    });
    loadMembers();
    drawGo();
  }

  function loadMembers() {
    var el = d.getElementById('exMems');
    if (!el) return;
    req('/exam/members?q=' + encodeURIComponent(P.q.trim()), undefined, { auth: true }).then(function (r) {
      var at = d.getElementById('exMemAt');
      if (at) at.textContent = r.at ? 'список из Discord обновлен ' + ago(r.at) : '';
      if (!r.list.length) {
        el.innerHTML = '<p class="ex-muted ex-pad">' + (r.at ? (P.q ? 'Никого не нашли.' : 'Список пуст.')
          : 'Бот еще не прислал список участников Discord. Обычно это занимает пару минут после его запуска.') + '</p>';
        return;
      }
      var h = '';
      r.list.forEach(function (m) {
        var sel = P.member && P.member.did === m.did;
        h += '<button type="button" class="ex-mem' + (sel ? ' on' : '') + '" data-did="' + esc(m.did) + '"' +
          (m.top ? ' disabled title="Высшей администрации тест не нужен"' : '') + '>' +
          avatar(m.did, m.display, m.av) +
          '<span class="ex-mem-n"><b>' + esc(m.display) + '</b><small>@' + esc(m.name) + '</small></span>' +
          '<span class="ex-mem-t">' + m.staff.map(function (s) { return '<i>' + esc(s) + '</i>'; }).join('') +
          (m.top ? '<i>тест не нужен</i>' : '') +
          (m.busy ? '<i class="busy">тест «' + esc(m.busy.title) + '» ' + (m.busy.state === 'done' ? 'сдан' : m.busy.state === 'run' ? 'идет' : 'выдан') + '</i>' : '') +
          '</span></button>';
      });
      if (r.total > r.list.length) h += '<p class="ex-muted ex-pad">Показаны первые ' + r.list.length + ' из ' + r.total + ' — уточните поиск.</p>';
      el.innerHTML = h;
      el._list = r.list;
    }, function (e) {
      if (e.code === 'auth' || e.code === 'not_top') return consoleStart();
      el.innerHTML = '<p class="ex-muted ex-pad">' + esc(A.textOf(e)) + '</p>';
    });
  }

  function drawGo(msg) {
    var el = d.getElementById('exGo');
    if (!el) return;
    var L = (P.me.levels || []).filter(function (l) { return l.key === P.level; })[0];
    if (!L || !P.member) {
      el.innerHTML = '<h2><span>3</span>Выдать</h2><p class="ex-muted">' +
        (!L && !P.member ? 'Выберите должность и участника.' : !L ? 'Выберите должность.' : 'Выберите участника.') + '</p>';
      return;
    }
    el.innerHTML = '<h2><span>3</span>Выдать</h2><div class="ex-sum">' + avatar(P.member.did, P.member.display, P.member.av, 'big') +
      '<div><b>' + esc(P.member.display) + '</b><span>тест на «' + esc(L.title) + '» · ' + nw(L.minutes, W_MIN) +
      ' · порог ' + L.pass + '%</span><small>Ссылка уйдет в личные сообщения Discord и действует трое суток.</small></div></div>' +
      '<div class="ex-act"><button class="btn btn-primary" type="button" data-p="issue">Выдать тест</button></div>' +
      '<div id="exGoMsg">' + (msg || '') + '</div>';
  }

  function issue(btn, force) {
    busy(btn, true, 'Выдаем…');
    req('/exam/issue', { did: P.member.did, level: P.level, force: !!force }, { auth: true }).then(function (r) {
      busy(btn, false);
      var L = (P.me.levels || []).filter(function (l) { return l.key === P.level; })[0];
      d.getElementById('exGo').innerHTML = '<h2><span>3</span>Готово</h2><div class="ex-done">' +
        '<p><b>Тест «' + esc(L.title) + '» выдан: ' + esc(P.member.display) + '.</b> Бот отправит ссылку в личные сообщения. ' +
        'Если они закрыты, передайте ссылку сами — она открывает только этот тест.</p>' +
        '<div class="ex-url"><input type="text" readonly value="' + esc(r.url) + '" aria-label="Ссылка на тест">' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="copy">Копировать</button></div>' +
        '<div class="ex-act"><button class="btn btn-dark btn-sm" type="button" data-open="' + esc(r.id) + '">Открыть тест в списке</button>' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="again">Выдать еще</button></div></div>';
      refreshList(true);
      loadMembers();
    }, function (e) {
      busy(btn, false);
      if (e.code === 'auth' || e.code === 'not_top') return consoleStart();
      var x = '<div class="ex-warn"><p>' + esc(A.textOf(e)) + '</p>';
      if (e.code === 'has_role') x += '<div class="ex-act"><button class="btn btn-dark btn-sm" type="button" data-p="force">Все равно выдать</button></div>';
      if (e.code === 'busy') {
        x += '<div class="ex-act">' + (e.data && e.data.id ? '<button class="btn btn-dark btn-sm" type="button" data-open="' + esc(e.data.id) + '">Открыть тот тест</button>' : '') +
          '<button class="btn btn-dark btn-sm" type="button" data-p="force">Отменить его и выдать новый</button></div>';
      }
      x += '</div>';
      d.getElementById('exGoMsg').innerHTML = x;
    });
  }

  /* ---------- список ---------- */

  var STATE = {
    'new': ['Выдан, не начат', 'wait'], run: ['Идет', 'run'], done: ['Ждет решения', 'need'],
    cancel: ['Отменен', 'off'], expired: ['Истек', 'off']
  };
  function stateOf(e) {
    if (e.state === 'final') return e.verdict === 'pass' ? ['Пройден', 'ok'] : ['Не пройден', 'no'];
    return STATE[e.state] || [e.state, 'off'];
  }
  function pill(e) { var s = stateOf(e); return '<span class="ex-pill ' + s[1] + '">' + s[0] + '</span>'; }
  function liveItem(e) { return e.state === 'new' || e.state === 'run' || (e.state === 'done' && e.ai === 'wait'); }

  function refreshList(quiet) {
    return req('/exam/list', undefined, { auth: true }).then(function (r) {
      P.list = r.list || [];
      P.skew = (r.now || Date.now()) - Date.now();
      var need = P.list.filter(function (e) { return e.state === 'done'; }).length;
      var el = d.getElementById('exWait');
      if (el) el.textContent = need ? String(need) : '';
      if (P.tab === 'list' && !P.open) drawList();
    }, function (e) {
      if (e.code === 'auth' || e.code === 'not_top') return consoleStart();
      if (!quiet) d.getElementById('exPane').innerHTML = '<p class="ex-muted ex-pad">' + esc(A.textOf(e)) + '</p>';
    });
  }

  var FILTERS = [['act', 'Сейчас'], ['done', 'Ждут решения'], ['closed', 'Закрытые'], ['all', 'Все']];
  function inFilter(e, f) {
    if (f === 'act') return e.state === 'new' || e.state === 'run' || e.state === 'done';
    if (f === 'done') return e.state === 'done';
    if (f === 'closed') return e.state === 'final' || e.state === 'cancel' || e.state === 'expired';
    return true;
  }

  function drawList() {
    var pane = d.getElementById('exPane');
    if (!pane) return;
    var h = '<div class="ex-filters">';
    FILTERS.forEach(function (f) {
      var n = P.list.filter(function (e) { return inFilter(e, f[0]); }).length;
      h += '<button type="button" class="' + (P.filter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' <em>' + n + '</em></button>';
    });
    h += '</div>';
    var rows = P.list.filter(function (e) { return inFilter(e, P.filter); });
    if (!rows.length) {
      h += '<div class="ex-note"><p>' + (P.list.length ? 'Здесь пусто.' : 'Тестов еще не выдавали. Выдать — во вкладке «Выдать тест».') + '</p></div>';
    } else {
      h += '<div class="ex-rows">';
      rows.forEach(function (e) {
        var info;
        if (e.state === 'new') info = 'выдан ' + ago(e.created) + ', ' + esc(e.by);
        else if (e.state === 'run') info = 'осталось ' + clock(e.until - Date.now() - (P.skew || 0));
        else if (e.state === 'done') info = 'сдан ' + ago(e.submitted) + (e.ai === 'wait' ? ', ИИ проверяет' : '');
        else info = ago(e.submitted || e.created);
        var sc = e.pct == null ? '' : '<span class="ex-sc ' + (e.ok ? 'ok' : 'no') + '">' + pct(e.pct) +
          '<small>из ' + e.need + '%' + (e.crit ? ', ключевой' : '') + (e.known === false ? ', не все проверены' : '') + '</small></span>';
        h += '<button type="button" class="ex-row" data-open="' + esc(e.id) + '">' + avatar(e.did, e.name, e.av) +
          '<span class="ex-row-n"><b>' + esc(e.name) + '</b><small>' + esc(e.title) + ' · ' + info + '</small></span>' +
          sc + pill(e) + (e.away ? '<span class="ex-away" title="уходов со страницы">↗ ' + e.away + '</span>' : '') +
          (dmBad(e.dm) ? '<span class="ex-dm" title="личное сообщение не доставлено">ЛС</span>' : '') + '</button>';
      });
      h += '</div>';
    }
    pane.innerHTML = h;
  }
  function dmBad(dm) { for (var k in dm) if (dm[k] === 'fail') return true; return false; }

  /* ---------- разбор ---------- */

  function loadItem(id, quiet) {
    P.open = id;
    var pane = d.getElementById('exPane');
    if (!quiet) pane.innerHTML = '<div class="loading"><i></i><i></i><i></i></div>';
    req('/exam/get?id=' + encodeURIComponent(id), undefined, { auth: true }).then(function (e) {
      if (quiet && P.item && P.item.id === id && JSON.stringify(e.score) === JSON.stringify(P.item.score) &&
        e.state === P.item.state && (e.ai || {}).state === (P.item.ai || {}).state && e.until === P.item.until &&
        e.saved === P.item.saved) return;
      P.item = e;
      if (P.tab === 'list' && P.open === id) drawItem();
    }, function (er) {
      if (er.code === 'auth' || er.code === 'not_top') return consoleStart();
      if (!quiet) pane.innerHTML = '<p class="ex-muted ex-pad">' + esc(A.textOf(er)) + '</p>';
    });
  }

  var DM = { issue: 'ссылка', prelim: 'предварительный итог', 'final': 'решение', cancel: 'отмена' };
  var DMS = { wait: 'в очереди', ok: 'доставлено', fail: 'не доставлено' };

  function drawItem() {
    var e = P.item, pane = d.getElementById('exPane'), s = e.score || {}, ai = e.ai || {};
    var skew = (e.now || Date.now()) - Date.now();
    var h = '<button type="button" class="ex-back" data-p="back">← Все тесты</button>';
    h += '<div class="ex-head">' + avatar(e.did, e.name, e.av, 'big') + '<div class="ex-head-n"><h2>' + esc(e.name) + '</h2>' +
      '<p>' + (e.uname ? '@' + esc(e.uname) + ' · ' : '') + 'тест на «' + esc(e.title) + '» · выдал ' + esc(e.by) + ' ' + esc(when(e.created)) + '</p></div>' +
      pill(e) + '</div>';
    // факты
    h += '<div class="ex-facts">';
    if (e.state === 'run') h += fact('Осталось', clock(e.until - Date.now() - skew), 'из ' + nw(e.minutes, W_MIN));
    if (e.state === 'new') h += fact('Время', nw(e.minutes, W_MIN), 'еще не начат');
    if (e.started) h += fact('Начат', when(e.started), e.submitted ? 'сдан ' + when(e.submitted) + (e.auto ? ', сам по таймеру' : '') : '');
    if (e.state === 'done' || e.state === 'final') {
      h += fact('Итог', pct(s.pct), 'порог ' + e.need + '%' + (s.known ? '' : ' — не все ответы оценены'));
      h += fact('Варианты', num(s.closed) + ' из ' + num(s.closed_max), s.crit ? 'ошибка в ключевом вопросе' : 'ключевые без ошибок');
      if (s.open_max) h += fact('Развернутые', num(s.open) + ' из ' + num(s.open_max), aiLine(ai) + (e.graded_by && Object.keys(e.grades || {}).length ? ', баллы поправил ' + esc(e.graded_by) : ''));
    }
    h += fact('Уходы со страницы', e.away ? nw(e.away, W_TIME) : 'нет', e.away ? 'всего ' + dur(e.away_ms) : 'вкладку не покидал(а)');
    h += '</div>';
    // личные сообщения
    var dmk = Object.keys(e.dm || {});
    if (dmk.length) {
      h += '<div class="ex-dms">Личные сообщения: ' + dmk.map(function (k) {
        return '<span class="' + (e.dm[k] || '') + '">' + (DM[k] || k) + ' — ' + (DMS[e.dm[k]] || e.dm[k]) + '</span>';
      }).join('') + '</div>';
      if (dmBad(e.dm) && (e.state === 'new' || e.state === 'run')) {
        h += '<p class="ex-warn-s">Бот не смог написать в личные сообщения — у участника они закрыты. Передайте ссылку сами.</p>';
      }
    }
    if (e.appoint) h += '<p class="ex-muted">Назначение: ' + esc(e.appoint) + '</p>';
    // ссылка и действия до сдачи
    if (e.state === 'new' || e.state === 'run') {
      h += '<div class="ex-box"><h3>Ссылка на тест</h3><div class="ex-url"><input type="text" readonly value="' + esc(e.url) + '" aria-label="Ссылка">' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="copy">Копировать</button></div>' +
        '<div class="ex-act">' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="extend" data-m="5">+5 минут</button>' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="extend" data-m="15">+15 минут</button>' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="resend">Отправить ссылку еще раз</button>' +
        (e.bound ? '<button class="btn btn-dark btn-sm" type="button" data-p="unbind">Отвязать браузер</button>' : '') +
        '</div><p class="ex-muted">«Отвязать браузер» — если сдающий сменил устройство: тест продолжится там, где ссылку откроют следующей.' +
        (e.saved ? ' Последнее сохранение ответов: ' + esc(ago(e.saved)) + '.' : '') + '</p></div>';
    }
    // решение
    if (e.state === 'done') {
      var rec = ai.state === 'wait' ? 'ИИ еще проверяет развернутые ответы — решение лучше принять после.'
        : (s.ok ? 'По баллам порог пройден.' : (s.crit ? 'Ошибка в ключевом вопросе — по правилам теста это непройден.' :
          (s.known ? 'По баллам порог не пройден.' : 'Не все развернутые ответы оценены — поставьте баллы ниже.')));
      h += '<div class="ex-box ex-decide"><h3>Решение</h3><p>' + rec + ' Решение за вами: баллы за развернутые ответы ' +
        'можно поправить ниже, итог пересчитается.</p>' +
        (ai.summary ? '<div class="ex-ai-sum"><span>Сводка ИИ</span>' + para(ai.summary) + '</div>' : '') +
        '<textarea id="exNote" class="ex-ta" rows="3" maxlength="600" placeholder="Комментарий сдающему (придет в ЛС вместе с решением, по желанию)">' +
        esc(P.note) + '</textarea>' +
        '<div class="ex-act"><button class="btn btn-primary btn-sm" type="button" data-p="pass">Прошел — выдать «' + esc(e.title) + '»</button>' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="fail">Не прошел</button>' +
        '<button class="btn btn-dark btn-sm" type="button" data-p="regrade">Перепроверить ИИ</button></div>' +
        '<p class="ex-muted">«Прошел» — бот сам выдаст роль в Discord, игровой ранг подтянется из нее. «Не прошел» — сдающий ' +
        'ждет новый тест. Оба решения уходят в личные сообщения.</p></div>';
    }
    if (e.state === 'final' && e.final) {
      h += '<div class="ex-verdict ' + (e.final.verdict === 'pass' ? 'ok' : 'no') + '"><span>Решение — ' + esc(e.final.by) + ', ' +
        esc(when(e.final.at * 1000)) + '</span><b>' + (e.final.verdict === 'pass' ? 'Повышен до «' + esc(e.title) + '»' : 'Не прошел') + '</b>' +
        (e.final.note ? '<p>' + para(e.final.note) + '</p>' : '') +
        (e.chat ? '<p>Ссылка на конфу администрации ушла в письме с решением.</p>' : '') + '</div>';
    }
    if (e.state === 'cancel' || e.state === 'expired') {
      h += '<div class="ex-note"><p>' + (e.state === 'expired' ? 'Тест не начали за трое суток.' : 'Отменен: ' + esc(e.reason)) + '</p></div>';
    }
    // вопросы
    var showAns = e.state !== 'new';
    h += '<div class="ex-review"><h3>Вопросы и ответы</h3>';
    (e.questions || []).forEach(function (q, n) { h += reviewQ(q, n, e, showAns); });
    h += '</div>';
    if (e.state === 'new' || e.state === 'run' || e.state === 'done') {
      h += '<div class="ex-box ex-cancel"><h3>Отменить тест</h3><div class="ex-url"><input type="text" id="exWhy" maxlength="300" ' +
        'placeholder="Причина — увидит сдающий"><button class="btn btn-dark btn-sm" type="button" data-p="cancel">Отменить</button></div></div>';
    }
    pane.innerHTML = h;
    var note = d.getElementById('exNote');
    if (note) note.addEventListener('input', function () { P.note = note.value; });
  }

  function aiLine(ai) {
    if (ai.state === 'wait') return 'ИИ проверяет' + (ai.tries ? ', попытка ' + (ai.tries + 1) : '');
    if (ai.state === 'fail') return 'ИИ не справился — оцените вручную';
    if (ai.state === 'ok') return ai.by === 'без ИИ' ? 'ответов нет' : 'оценил ИИ (' + esc(ai.by || '') + ')';
    return '';
  }

  function reviewQ(q, n, e, showAns) {
    var editable = e.state === 'done';
    var got = q.got;
    var cls = got == null ? '' : (got >= q.max ? 'ok' : got > 0 ? 'mid' : 'no');
    var h = '<section class="ex-rq ' + cls + '"><header><span class="ex-qn">' + (n + 1) + '</span><span class="ex-qk">' + KIND[q.kind] + '</span>' +
      (q.crit ? '<span class="ex-crit">ключевой</span>' : '') +
      '<span class="ex-qp">' + (got == null ? nw(q.max, W_PT) : num(got) + ' из ' + q.max) + '</span></header>' +
      '<div class="ex-qt">' + para(q.text) + '</div>';
    if (q.kind === 'open') {
      var ans = String(q.answer || '').trim();
      h += '<div class="ex-ans' + (ans ? '' : ' empty') + '">' + (ans ? para(ans) : (showAns ? 'Ответа нет' : 'Тест еще не начат')) + '</div>';
      h += '<div class="ex-rub"><span>Что должно быть в ответе</span><ul>' + (q.rubric || []).map(function (r) {
        return '<li><b>' + r[1] + '</b>' + esc(r[0]) + '</li>';
      }).join('') + '</ul></div>';
      if (q.ai) {
        h += '<div class="ex-ainote' + (q.ai.flag ? ' flag' : '') + '"><span>ИИ: ' + nw(q.ai.score, W_PT) + '</span>' + para(q.ai.why || '') +
          (q.ai.flag ? '<b>Похоже на попытку повлиять на проверку — перечитайте ответ.</b>' : '') + '</div>';
      }
      if (editable && ans) {
        h += '<div class="ex-grade"><span>Ваша оценка</span>';
        [0, 1, 2, 3].forEach(function (v) {
          h += '<button type="button" class="' + (q.grade === v ? 'on' : '') + '" data-g="' + n + '" data-v="' + v + '">' + v + '</button>';
        });
        h += '<button type="button" class="reset' + (q.grade == null ? ' on' : '') + '" data-g="' + n + '" data-v="">как у ИИ</button></div>';
      } else if (q.grade != null) {
        h += '<p class="ex-muted">Оценка администрации: ' + nw(q.grade, W_PT) + '.</p>';
      }
    } else {
      var a = q.answer;
      var chosen = q.kind === 'one' ? (a == null ? [] : [a]) : (a || []);
      h += '<ul class="ex-ropts">';
      (q.opts || []).forEach(function (o, j) {
        var c = chosen.indexOf(j) >= 0;
        h += '<li class="' + (o.ok ? 'right' : '') + (c ? ' picked' : '') + (c && !o.ok ? ' wrong' : '') + '">' +
          '<i>' + (c ? (o.ok ? '✓' : '✗') : (o.ok ? '○' : '')) + '</i><span>' + para(o.t) + '</span></li>';
      });
      h += '</ul>';
      if (showAns && !chosen.length) h += '<p class="ex-muted">Ответа нет.</p>';
      if (q.why) h += '<div class="ex-why">' + para(q.why) + '</div>';
    }
    if (q.rule) h += '<p class="ex-rule">Источник: ' + esc(q.rule) + '</p>';
    return h + '</section>';
  }

  function act(path, body, btn, after) {
    busy(btn, true, '…');
    body.id = P.open;
    return req('/exam/' + path, body, { auth: true }).then(function (r) {
      busy(btn, false);
      if (after) after(r);
      loadItem(P.open, false);
      refreshList(true);
    }, function (e) {
      busy(btn, false);
      if (e.code === 'auth' || e.code === 'not_top') return consoleStart();
      w.alert(A.textOf(e));
    });
  }

  /* ════════════════════════════ клики ════════════════════════════ */

  box.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, [data-go]');
    if (!t || !box.contains(t)) return;
    var x = t.getAttribute('data-x'), p = t.getAttribute('data-p');
    // сдающий
    if (x === 'retry') return takeInfo(true);
    if (x === 'start') return doStart(t);
    if (x === 'ask') return ask();
    if (x === 'close') { d.getElementById('exModal').hidden = true; return; }
    if (x === 'submit') return doSubmit(false);
    if (t.hasAttribute('data-go')) {
      var s = d.getElementById('exq' + t.getAttribute('data-go'));
      if (s) w.scrollTo({ top: s.getBoundingClientRect().top + w.pageYOffset - topH() - d.getElementById('exBar').offsetHeight - 16, behavior: 'smooth' });
      return;
    }
    // пульт
    if (t.hasAttribute('data-tab')) { P.open = ''; P.item = null; return tab(t.getAttribute('data-tab')); }
    if (t.hasAttribute('data-lv')) {
      P.level = t.getAttribute('data-lv');
      box.querySelectorAll('[data-lv]').forEach(function (b) { b.classList.toggle('on', b === t); });
      return drawGo();
    }
    if (t.hasAttribute('data-did')) {
      var list = d.getElementById('exMems')._list || [];
      P.member = list.filter(function (m) { return m.did === t.getAttribute('data-did'); })[0] || null;
      box.querySelectorAll('[data-did]').forEach(function (b) { b.classList.toggle('on', b === t); });
      return drawGo();
    }
    if (t.hasAttribute('data-f')) { P.filter = t.getAttribute('data-f'); return drawList(); }
    if (t.hasAttribute('data-open')) {
      P.note = '';
      P.open = t.getAttribute('data-open');
      P.item = null;
      if (P.tab !== 'list') { P.tab = 'list'; store('aegis.exam.tab', 'list'); box.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === 'list'); }); }
      w.scrollTo(0, box.getBoundingClientRect().top + w.pageYOffset - topH() - 20);
      return loadItem(P.open);
    }
    if (t.hasAttribute('data-g')) {
      var sc = {};
      sc[t.getAttribute('data-g')] = t.getAttribute('data-v') === '' ? null : Number(t.getAttribute('data-v'));
      return act('grade', { scores: sc }, t);
    }
    switch (p) {
      case 'logout': return T.logout().then(consoleStart);
      case 'reload': return consoleStart();
      case 'issue': return issue(t, false);
      case 'force': return issue(box.querySelector('[data-p="issue"]') || t, true);
      case 'again': P.member = null; return drawGive();
      case 'copy': return copy(t.parentNode.querySelector('input').value, t);
      case 'back': P.open = ''; P.item = null; return drawList();
      case 'extend': return act('extend', { minutes: Number(t.getAttribute('data-m')) }, t);
      case 'resend': return act('resend', {}, t, function () { w.alert('Бот отправит ссылку еще раз в течение минуты.'); });
      case 'unbind': return act('unbind', {}, t);
      case 'regrade': return act('regrade', {}, t);
      case 'pass':
      case 'fail':
        if (!w.confirm(p === 'pass' ? P.item.name + ' прошел тест — выдать должность «' + P.item.title + '»? Бот сразу выдаст роль.'
          : 'Отметить тест как непройденный? Сдающему придет решение в ЛС.')) return;
        return act('decide', { verdict: p, note: (d.getElementById('exNote') || {}).value || '' }, t, function () { P.note = ''; });
      case 'cancel':
        if (!w.confirm('Отменить этот тест? Ссылка перестанет работать.')) return;
        return act('cancel', { reason: (d.getElementById('exWhy') || {}).value || '' }, t);
    }
  });

  d.addEventListener('keydown', function (e) {
    var m = d.getElementById('exModal');
    if (e.key === 'Escape' && m && !m.hidden) m.hidden = true;
  });

  /* ════════════════════════════ старт ════════════════════════════ */

  function boot() {
    if (!A.base()) return fail('Раздел недоступен', A.textOf(A.offline()));
    if (/(?:^|[#&])t=[0-9a-f]{6,40}\.[\w-]{8,80}/i.test(location.hash || '')) takeStart();
    else consoleStart();
  }
  w.addEventListener('hashchange', function () { stopTimers(); clearInterval(P.timer); boot(); });
  boot();
})(window, document);
