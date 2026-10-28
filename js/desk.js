/* AEGIS — пульт обращений для команды (admin.html).

   Овнер 24.09.2026: «сделай чтобы тикеты админам были видны на сайте, а то я не
   пойму где смотреть созданные». Здесь штаб после входа видит обращения с сайта:
   ждущие ответа и новые — сверху, у каждого стадия, от кого и тема. Обращение
   открывается прямо тут: переписка, файлы, ответ игроку или заметка для своих,
   «взять себе», смена стадии.

   Вход — по человеку: тот же ник и пароль, что в лаунчере. Что видно, решает
   сервер по должности в Discord (Модератор — помощь и жалобы, выше — больше
   тем, Координатор и владелец — все). Страница прав не проверяет и не хранит:
   все, что она показывает, прислал сервер под этот вход.

   Двери службы — /adm/* (Tickets.java). Старая служба их не знает (404) —
   тогда страница прямо говорит, что пульт появится после обновления сервера.

   Ссылка из ЛС бота: admin.html#t=<номер-ключ> — открывает сразу обращение.

   Текст обращений — данные: выводится только через esc, ссылки не кликаются. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var T = window.AegisTk;
  var root = document.getElementById('adBody');
  if (!root || !A || !T) return;
  var esc = A.esc;

  var ME = null;          // ответ /adm/me
  var TAB = 'overview';
  var Q = '', CAT = '';
  var PAGE = 40, SHOWN = 0, TOTAL = 0;
  var TIMER = 0;
  var REPLY = {};         // недописанные ответы по номерам обращений

  var TABS = [
    ['overview', 'Обзор'],
    ['waiting', 'Ждут ответа'],
    ['active', 'Все открытые'],
    ['mine', 'Мои'],
    ['free', 'Без ведущего'],
    ['later', 'Отложенные'],
    ['closed', 'Закрытые'],
    ['all', 'Все']
  ];
  var COUNT_OF = { waiting: 'waiting', mine: 'mine', free: 'free', later: 'later', closed: 'closed' };

  /* Доска над списком. Овнер 24.09.2026: «чтобы было видно список какие обращения
     существуют сейчас и открыты, какие закрыты и решены», а не ходить по ссылкам
     бота. Карточка — и счетчик, и фильтр: нажал — список только этой стадии,
     нажал еще раз — обратно к обзору. */
  var BOARD = [
    ['waiting', 'Ждут ответа', 'игрок написал последним', 'red'],
    ['open', 'Новые', 'стадия «открыт»', 'gold'],
    ['work', 'В работе', 'кто-то из команды ведет', 'green'],
    ['wait', 'Ждут игрока', 'ответили, слово за игроком', 'steel'],
    ['closed', 'Закрыты', 'решены и закрыты', 'off']
  ];

  /* Отложено, и срок еще не вышел (овнер 30.09.2026: «отложить для решения позже»). */
  function held(t) { return !!t.later && !t.due; }

  /* Разделы обзора: каждое открытое обращение попадает ровно в один. Закрепленные —
     первыми, отложенные до срока — последними (овнер 30.09.2026). */
  var SECS = [
    ['Закрепленные', 'Высшая администрация держит их наверху, пока не открепит или не закроет.',
      function (t) { return t.pin; }, function (a, b) { return (b.pinAt || 0) - (a.pinAt || 0); }],
    ['Ждут ответа команды', 'Игрок написал последним или вышел срок отложенного. Сверху те, что ждут дольше всех.',
      function (t) { return !t.pin && t.waiting; }, true],
    ['Новые', 'Пришли и еще не разобраны.',
      function (t) { return !t.pin && !t.waiting && !held(t) && t.status === 'open'; }],
    ['В работе', 'Ведет кто-то из команды.',
      function (t) { return !t.pin && !t.waiting && !held(t) && t.status === 'work'; }],
    ['Ждут игрока', 'Команда ответила, ждем, что скажет игрок.',
      function (t) { return !t.pin && !t.waiting && !held(t) && t.status === 'wait'; }],
    ['Отложенные', 'Ответ дадут позже. До срока их не трогают SIGEA и напоминания; в срок бот напомнит, а обращение встанет в «Ждут ответа».',
      function (t) { return !t.pin && held(t); }, function (a, b) { return (a.later || 0) - (b.later || 0); }]
  ];

  function hashId() {
    var m = /^#t=([A-Za-z0-9_-]{1,64})$/.exec(location.hash || '');
    return m ? m[1] : '';
  }

  function stopTimer() { if (TIMER) { clearInterval(TIMER); TIMER = 0; } }

  /* ------------------------------------------------------------ вход */

  function drawLogin() {
    stopTimer();
    root.innerHTML = '<div id="tkdL"></div><div class="cab-why">' +
      '<h3>Кто сюда входит</h3><p>Команда AEGIS: модераторы, администраторы, координатор. ' +
      'Какие темы обращений видны, сервер решает сам — по вашей должности в Discord. ' +
      'Бот присылает в ЛС ссылку на каждое новое обращение; она ведет прямо сюда.</p>' +
      '<p>Игрок? Ваши обращения — на странице <a href="tickets#/mine">«Мои обращения»</a>.</p></div>';
    T.login(document.getElementById('tkdL'), {
      title: 'Обращения — вход для команды',
      lead: 'Ник и пароль те же, что в лаунчере.',
      done: start
    });
  }

  function box(kind, html, withOut) {
    stopTimer();
    root.innerHTML = '<div class="tkd"><div class="nbox ' + kind + '"><span class="n-ic">' +
      (kind === 'warn' ? '!' : 'i') + '</span><div>' + html + '</div></div>' +
      (withOut ? '<div class="form-go"><button type="button" class="btn btn-dark" data-out>' +
        'Выйти</button></div>' : '') + '</div>';
    bindOut();
  }

  function bindOut() {
    root.querySelectorAll('[data-out]').forEach(function (b) {
      if (b.getAttribute('data-bound')) return;
      b.setAttribute('data-bound', '1');
      b.addEventListener('click', function () {
        b.disabled = true;
        ME = null;
        T.logout().then(drawLogin, drawLogin);
      });
    });
  }

  function fail(err, retry) {
    if (err && err.code === 'auth') { drawLogin(); return; }
    if (err && err.code === 'http') {
      box('warn', '<b>Пульт обращений заработает после обновления сервера.</b> ' +
        'Новые обращения бот все равно присылает в ЛС.', true);
      return;
    }
    if (err && err.code === 'forbidden') {
      box('warn', esc(A.textOf(err)), true);
      return;
    }
    stopTimer();
    root.innerHTML = '<div class="tkd"><div class="nbox warn"><span class="n-ic">!</span><div>' +
      esc(A.textOf(err)) + '</div></div><div class="form-go">' +
      '<button type="button" class="btn btn-primary" id="tkdAgain">Попробовать еще раз</button></div></div>';
    document.getElementById('tkdAgain').addEventListener('click', retry);
  }

  function start() {
    if (!A.base()) {
      box('warn', 'Служба сервера не подключена к сайту — пульту не к чему обратиться.', false);
      return;
    }
    if (!A.token()) { drawLogin(); return; }
    root.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    A.call('/adm/me').then(function (r) {
      ME = r;
      if (!r.staff) {
        box('', '<b>Эта страница — для команды проекта.</b> Вы вошли как ' + esc(r.nick || '') +
          '. Свои обращения смотрите на странице <a href="tickets#/mine">«Мои обращения»</a>.', true);
        return;
      }
      route();
    }, function (err) { fail(err, start); });
  }

  /* ------------------------------------------------------------ шапка */

  function head() {
    var cats = ME.all ? 'все темы' : (ME.cats || []).map(function (k) {
      return T.catName(k, k);
    }).join(', ');
    var h = '<div class="tk-me tkd-me"><div>Вы вошли как <b>' + esc(ME.nick) + '</b> · ' +
      esc(ME.rankTitle || 'команда') + '<span class="tkd-cats">Видите: ' + esc(cats || '—') +
      '</span></div><div class="tkd-me-r">';
    if (ME.owner) {
      h += '<button type="button" class="btn btn-sm ' + (ME.on ? 'btn-dark' : 'btn-primary') +
        '" id="tkdSw">' + (ME.on ? 'Прием открыт — закрыть' : 'Прием закрыт — открыть') + '</button>';
    }
    h += '<button type="button" class="btn btn-dark btn-sm" data-out>Выйти</button></div></div>';
    if (!ME.on) {
      h += '<div class="nbox warn"><span class="n-ic">!</span><div><b>Прием обращений с сайта ' +
        'сейчас закрыт.</b> Игроки не могут отправить новое; уже открытые обращения ' +
        'разбираются как обычно.' + (ME.owner ? ' Открыть — кнопкой выше.' : '') + '</div></div>';
    }
    return h;
  }

  function bindHead() {
    bindOut();
    var sw = document.getElementById('tkdSw');
    if (sw) sw.addEventListener('click', function () {
      var next = !ME.on;
      if (!confirm(next ? 'Открыть прием обращений с сайта?' :
        'Закрыть прием? Игроки не смогут отправить новое обращение с сайта.')) return;
      sw.disabled = true;
      A.call('/adm/switch', { body: { on: next } }).then(function () {
        ME.on = next;
        route();
      }, function (err) { sw.disabled = false; alert(A.textOf(err)); });
    });
  }

  /* ------------------------------------------------------------ список */

  function drawList() {
    document.title = 'Обращения — команда AEGIS';
    var h = '<div class="tkd">' + head();
    h += '<div class="tkd-board">';
    BOARD.forEach(function (b) {
      h += '<button type="button" class="tkd-card c-' + b[3] + (TAB === b[0] ? ' on' : '') + '" data-tab="' +
        b[0] + '" aria-pressed="' + (TAB === b[0]) + '"><b data-c="' + b[0] + '">·</b><span>' + esc(b[1]) +
        '</span><small>' + esc(b[2]) + '</small></button>';
    });
    h += '</div><p class="tkd-sum" id="tkdSum"></p>';
    h += '<div class="tkd-tabs" role="tablist">';
    TABS.forEach(function (t) {
      h += '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' +
        (TAB === t[0]) + '"' + (TAB === t[0] ? ' class="on"' : '') + '>' + esc(t[1]) +
        '<span class="tkd-n" data-n="' + t[0] + '"></span></button>';
    });
    if (ME.accessEdit || ME.owner) {
      h += '<button type="button" role="tab" data-tab="access" aria-selected="' + (TAB === 'access') + '"' +
        (TAB === 'access' ? ' class="on"' : '') + '>Доступ к темам</button>';
    }
    h += '<button type="button" role="tab" data-tab="week" aria-selected="' + (TAB === 'week') + '"' +
      (TAB === 'week' ? ' class="on"' : '') + '>Отчет недели</button>';
    if (ME.give) {
      h += '<button type="button" role="tab" data-tab="give" aria-selected="' + (TAB === 'give') + '"' +
        (TAB === 'give' ? ' class="on"' : '') + '>Выдача предметов</button>';
    }
    if (ME.rename) {
      h += '<button type="button" role="tab" data-tab="nick" aria-selected="' + (TAB === 'nick') + '"' +
        (TAB === 'nick' ? ' class="on"' : '') + '>Смена ника</button>';
    }
    if (ME.sableView) {
      h += '<button type="button" role="tab" data-tab="sable" aria-selected="' + (TAB === 'sable') + '"' +
        (TAB === 'sable' ? ' class="on"' : '') + '>Учет техники</button>';
    }
    if (ME.owner) {
      h += '<button type="button" role="tab" data-tab="team" aria-selected="' + (TAB === 'team') + '"' +
        (TAB === 'team' ? ' class="on"' : '') + '>Команда</button>';
    }
    /* Овнер 14.10.2026 не нашел, где выдавать тесты на повышение: пульт тестов —
       отдельная страница, ссылка на нее раньше была только в хабе. */
    if (ME.top || ME.owner) h += '<a class="tkd-go" href="exam">Тесты на повышение</a>';
    h += '</div>';
    if (TAB === 'team' || TAB === 'access' || TAB === 'week' || TAB === 'give' || TAB === 'sable' || TAB === 'nick') {
      h += '<div id="tkdTeam"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div></div>';
      root.innerHTML = h;
      bindHead(); bindTabs();
      if (TAB === 'team') drawTeam(); else if (TAB === 'week') drawWeek(); else if (TAB === 'give') drawGive(); else if (TAB === 'sable') drawSable(); else if (TAB === 'nick') drawNick(); else drawAccess();
      return;
    }
    /* Овнер 28.09.2026: «онлайн админов где-то сбоку, а не снизу». */
    h += '<div class="tk-cols"><div class="tk-main">';
    h += '<form class="tkd-bar" id="tkdF" role="search">' +
      '<input class="tkd-q" id="tkdQ" type="search" placeholder="Номер, ник или тема" value="' + esc(Q) + '">' +
      '<select id="tkdCat" aria-label="Тема"><option value="">Все темы</option></select>' +
      '<button class="btn btn-dark btn-sm" type="submit">Найти</button></form>';
    h += '<div id="tkdList"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>';
    h += '<div class="form-go tkd-more" id="tkdMoreW" hidden><button type="button" class="btn btn-dark" id="tkdMore">' +
      'Показать еще</button></div></div>' +
      '<aside class="tk-side"><div id="tkdCrew" class="tkd-crew"></div><div id="tkdDone" class="tkd-done"></div></aside></div></div>';
    root.innerHTML = h;
    bindHead(); bindTabs();
    document.getElementById('tkdF').addEventListener('submit', function (e) {
      e.preventDefault();
      Q = document.getElementById('tkdQ').value.trim();
      CAT = document.getElementById('tkdCat').value;
      load(false);
    });
    document.getElementById('tkdCat').addEventListener('change', function () {
      CAT = this.value;
      load(false);
    });
    document.getElementById('tkdMore').addEventListener('click', function () { load(true); });
    load(false);
    counts();
    stopTimer();
    TIMER = setInterval(function () {
      if (document.hidden || hashId() || TAB === 'team' || TAB === 'access' || TAB === 'week' || TAB === 'give' || TAB === 'sable' || TAB === 'nick') return;
      var q = document.getElementById('tkdQ');
      if (q && q === document.activeElement) return;
      counts();
      if (SHOWN <= PAGE) load(false, true);
    }, 45000);
  }

  function bindTabs(scope) {
    (scope || root).querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-tab');
        /* Повторное нажатие на карточку доски снимает фильтр. */
        TAB = b.classList.contains('tkd-card') && TAB === k ? 'overview' : k;
        SHOWN = 0;
        drawList();
      });
    });
  }

  function counts() {
    A.call('/adm/overview').then(function (r) {
      var c = r.counts || {};
      var act = (c.open || 0) + (c.work || 0) + (c.wait || 0);
      root.querySelectorAll('[data-n]').forEach(function (el) {
        var k = el.getAttribute('data-n');
        var n = k === 'active' ? act : k === 'all' ? c.all : c[COUNT_OF[k]];
        el.textContent = n ? String(n) : '';
        el.classList.toggle('hot', k === 'waiting' && n > 0);
      });
      root.querySelectorAll('[data-c]').forEach(function (el) {
        var n = c[el.getAttribute('data-c')] || 0;
        el.textContent = String(n);
        el.parentNode.classList.toggle('zero', !n);
      });
      var s = document.getElementById('tkdSum');
      if (s) s.innerHTML = 'Открыто сейчас: <b>' + act + '</b> · всего обращений: <b>' + (c.all || 0) +
        '</b> · новых за сутки: <b>' + (c.today || 0) + '</b> · без ведущего: <b>' + (c.free || 0) +
        '</b> · ведете вы: <b>' + (c.mine || 0) + '</b>';
      if (typeof r.on === 'boolean' && ME && r.on !== ME.on) { ME.on = r.on; }
      var cw = document.getElementById('tkdCrew');
      if (cw && r.crew) {
        cw.innerHTML = '<div class="tkd-crew-h"><h3>На связи</h3><span>кто из команды сейчас на сайте и в игре</span></div>' +
          T.crew(r.crew, true);
        T.heads(cw);
      }
      var dn = document.getElementById('tkdDone');
      if (dn && r.done) dn.innerHTML = doneOf(r.done, r.doneAll);
    }, function () {});
  }

  /* Кто сколько разобрал (овнер 28.09.2026): владельцу и высшей администрации — вся
     команда, остальным — только свое. */
  function doneOf(ls, all) {
    var h = '<div class="tkd-crew-h"><h3>' + (all ? 'Кто сколько разобрал' : 'Вы разобрали') + '</h3>' +
      '<span>закрытые обращения</span></div>';
    if (!ls.length) return h + '<p class="tkd-done-0">Пока ни одного закрытого.</p>';
    h += '<table class="tkd-done-t"><thead><tr><th scope="col">Кто</th><th scope="col" title="за 7 дней">7 дн.</th>' +
      '<th scope="col" title="за 30 дней">30 дн.</th><th scope="col">Всего</th></tr></thead><tbody>';
    ls.forEach(function (d) {
      var c = T.color(d.color);
      h += '<tr><td><b' + (c ? ' style="color:' + c + '"' : '') + '>' + esc(d.nick) + '</b><small>' + esc(d.title) +
        '</small></td><td>' + esc(d.week || 0) + '</td><td>' + esc(d.month || 0) + '</td><td>' + esc(d.all || 0) +
        (d.auto ? '<small title="из них закрылось само: игрок молчал больше суток">само ' + esc(d.auto) + '</small>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table><p class="tkd-done-n">В счет тому, кто закрыл. Игрок молчит больше суток после ' +
      'ответа — обращение закрывается само и идет в счет тому, кто его вел.</p>';
  }

  function row(t) {
    var cat = T.catName(t.cat, t.name);
    var waiting = t.waiting && t.status !== 'closed';
    var due = waiting && t.later && t.due;
    return '<a class="row r2 tkd-row' + (waiting ? ' tk-new' : '') + '" href="#t=' + encodeURIComponent(t.id) + '">' +
      '<div><div class="rw-t"><b>№' + esc(t.no) + '</b> · ' + esc(cat) +
      (t.pin && t.status !== 'closed' ? ' <span class="pill gold" title="Закрепил ' + esc(t.pinBy || '') + '">закреплено</span>' : '') +
      (due ? ' <span class="pill red" title="' + esc(laterTip(t)) + '">срок вышел</span>' :
        waiting ? ' <span class="pill red">ждет ответа</span>' : '') +
      (held(t) && t.status !== 'closed' ? ' <span class="pill" title="' + esc(laterTip(t)) + '">отложено до ' +
        esc(T.stamp(t.later)) + '</span>' + (t.lastBy === 'p' ? ' <span class="pill">игрок дописал</span>' : '') : '') +
      (t.sg === 'ans' ? ' <span class="pill" title="' + esc(t.sgWhy || '') + '">ответила SIGEA</span>' :
        t.sg === 'help' ? ' <span class="pill" title="' + esc(t.sgWhy || '') + '">SIGEA передала людям</span>' : '') + '</div>' +
      '<div class="rw-s">от <b>' + esc(t.nick || 'игрок') + '</b>' +
      (t.acc && t.acc.toLowerCase() !== String(t.nick || '').toLowerCase() ? ' (аккаунт ' + esc(t.acc) + ')' : '') +
      ' · создано ' + esc(T.stamp(t.at)) +
      ' · ведет: ' + (t.by ? esc(t.by) : 'никто') +
      (t.msgs ? ' · сообщений: ' + esc(t.msgs) : '') +
      (t.files ? ' · файлов: ' + esc(t.files) : '') + '</div></div>' +
      '<div class="rw-r">' + T.pill(t.status, false) + '<div class="tkd-ago">' + T.when(t.touched) + '</div></div></a>';
  }

  function laterTip(t) {
    return 'Отложил ' + (t.laterBy || '—') + (t.laterWhy ? '. Зачем: ' + t.laterWhy : '');
  }

  function fillCats(cats) {
    var sel = document.getElementById('tkdCat');
    if (!sel || sel.options.length > 1 || !cats) return;
    cats.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = T.catName(k, k);
      if (k === CAT) o.selected = true;
      sel.appendChild(o);
    });
  }

  function sec(title, n, hint, rows, tail) {
    return '<div class="tkd-sec"><div class="tkd-sec-h"><h3>' + esc(title) +
      '<span class="tkd-sec-n">' + esc(n) + '</span></h3><span class="tkd-sec-d">' + esc(hint) + '</span></div>' +
      '<div class="row-list">' + rows + '</div>' + (tail || '') + '</div>';
  }

  /* Обзор: все открытые обращения по стадиям и несколько последних закрытых. */
  function overview(quiet) {
    var mw = document.getElementById('tkdMoreW');
    if (mw) mw.hidden = true;
    Promise.all([
      A.call('/adm/tickets?state=active&limit=100'),
      A.call('/adm/tickets?state=closed&limit=6')
    ]).then(function (rs) {
      var list = document.getElementById('tkdList');
      if (!list || TAB !== 'overview' || Q || CAT) return;
      var act = rs[0].items || [], shut = rs[1].items || [];
      fillCats(rs[0].cats || rs[1].cats);
      var h = '';
      SECS.forEach(function (s) {
        var part = act.filter(s[2]);
        if (!part.length) return;
        part.sort(typeof s[3] === 'function' ? s[3] : function (a, b) {
          return s[3] ? (a.touched || 0) - (b.touched || 0) : (b.touched || 0) - (a.touched || 0);
        });
        h += sec(s[0], part.length, s[1], part.map(row).join(''), '');
      });
      if (!act.length) {
        h += '<div class="empty tkd-calm"><h4>Открытых обращений нет</h4><p>Все разобраны. ' +
          'Новые появятся здесь сами, а бот пришлет ссылку в ЛС.</p></div>';
      } else if ((rs[0].total || 0) > act.length) {
        h += '<p class="tkd-p">Показаны ' + act.length + ' из ' + rs[0].total +
          ' открытых. Остальные во вкладке «Все открытые».</p>';
      } else if (!act.some(function (t) { return t.waiting; })) {
        h = '<div class="nbox tkd-ok"><span class="n-ic">✓</span><div>Ответа никто не ждет: на все, что писали игроки, ' +
          'команда уже ответила.</div></div>' + h;
      }
      if (shut.length) {
        h += sec('Недавно закрытые', rs[1].total || shut.length, 'Решены и закрыты, последние сверху.',
          shut.map(row).join(''), (rs[1].total || 0) > shut.length ?
            '<button type="button" class="tkd-sec-go" data-tab="closed">Все закрытые (' + esc(rs[1].total) + ') →</button>' : '');
      }
      list.innerHTML = h;
      bindTabs(list);
      SHOWN = 0;
    }, function (err) {
      if (err && (err.code === 'auth' || err.code === 'http')) { fail(err, start); return; }
      var list = document.getElementById('tkdList');
      if (list && !quiet) list.innerHTML = '<div class="nbox warn"><span class="n-ic">!</span><div>' +
        esc(A.textOf(err)) + '</div></div>';
    });
  }

  function load(more, quiet) {
    var list = document.getElementById('tkdList');
    if (!list) return;
    if (TAB === 'overview' && !Q && !CAT) { overview(quiet); return; }
    var off = more ? SHOWN : 0;
    var lim = more ? PAGE : Math.max(PAGE, quiet ? SHOWN : PAGE);
    var url = '/adm/tickets?state=' + encodeURIComponent(TAB === 'overview' ? 'all' : TAB) + '&limit=' + lim + '&offset=' + off +
      (CAT ? '&cat=' + encodeURIComponent(CAT) : '') + (Q ? '&q=' + encodeURIComponent(Q) : '');
    A.call(url).then(function (r) {
      if (!document.getElementById('tkdList')) return;
      var items = r.items || [];
      TOTAL = r.total || 0;
      /* «Новые сверху»: закрепленные и ждущие ответа сервер уже ставит первыми; внутри
         этих кучек и в остальных — по времени создания, свежие выше. */
      items.sort(function (a, b) {
        var pa = a.pin && a.status !== 'closed' ? 1 : 0, pb = b.pin && b.status !== 'closed' ? 1 : 0;
        if (pa !== pb) return pb - pa;
        var wa = a.waiting && a.status !== 'closed' ? 1 : 0, wb = b.waiting && b.status !== 'closed' ? 1 : 0;
        if (wa !== wb) return wb - wa;
        return (b.at || 0) - (a.at || 0);
      });
      fillCats(r.cats);
      var html = items.map(row).join('');
      if (more) {
        var rl = list.querySelector('.row-list');
        if (rl) rl.insertAdjacentHTML('beforeend', html);
        SHOWN += items.length;
      } else {
        SHOWN = items.length;
        list.innerHTML = items.length ? '<div class="row-list">' + html + '</div>'
          : '<div class="empty"><h4>' + (Q || CAT ? 'Ничего не нашлось' : emptyText()) + '</h4>' +
            '<p>' + (Q || CAT ? 'Попробуйте другой номер, ник или тему.' :
              'Новые обращения появятся здесь сами, а бот пришлет ссылку в ЛС.') + '</p></div>';
      }
      var mw = document.getElementById('tkdMoreW');
      if (mw) mw.hidden = SHOWN >= TOTAL;
    }, function (err) {
      if (err && (err.code === 'auth' || err.code === 'http')) { fail(err, start); return; }
      if (!quiet) list.innerHTML = '<div class="nbox warn"><span class="n-ic">!</span><div>' +
        esc(A.textOf(err)) + '</div></div>';
    });
  }

  function emptyText() {
    return { waiting: 'Все ответили — ждущих нет', mine: 'У вас нет обращений в работе',
      free: 'Все обращения кто-то ведет', later: 'Отложенных нет', closed: 'Закрытых пока нет' }[TAB] || 'Обращений пока нет';
  }

  /* ------------------------------------------------------------ обращение */

  function drawTicket(id) {
    stopTimer();
    document.title = 'Обращение — команда AEGIS';
    root.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    A.call('/adm/ticket?id=' + encodeURIComponent(id)).then(function (r) {
      if (hashId() !== id) return;
      showTicket(r);
    }, function (err) {
      if (err && err.code === 'no_ticket') {
        root.innerHTML = '<div class="tkd">' + head() + '<div class="empty"><h4>Такого обращения нет</h4>' +
          '<p><a href="#">К списку обращений</a></p></div></div>';
        bindHead();
        return;
      }
      if (err && err.code === 'forbidden') {
        root.innerHTML = '<div class="tkd">' + head() + '<div class="nbox warn"><span class="n-ic">!</span><div>' +
          esc(A.textOf(err)) + '</div></div><p class="tk-back"><a href="#">← к списку</a></p></div>';
        bindHead();
        return;
      }
      fail(err, function () { drawTicket(id); });
    });
  }

  /* Живая переписка открытого обращения: одна на пульт. */
  var LIVE = null;
  function stopLive() { if (LIVE) { LIVE.stop(); LIVE = null; } }

  function topOf(t, r) {
    var me = r.me || ME.nick;
    var mineT = t.by && t.by.toLowerCase() === String(me).toLowerCase();
    var h = '';
    h += '<div class="tk-meta">' + T.pill(t.status, false) +
      '<span>от ' + T.av(t.acc || t.nick || '') + '<b>' + playerBtn(t.acc || t.nick, t.nick || 'игрок') + '</b>' +
      (t.acc && t.acc.toLowerCase() !== String(t.nick || '').toLowerCase() ? ' (аккаунт ' + esc(t.acc) + ')' : '') +
      '</span><span>создано ' + esc(T.stamp(t.at)) + '</span>' +
      '<span>ведет: ' + (t.by ? '<b>' + esc(t.by) + '</b>' : 'никто') + '</span>' +
      (t.pin && t.status !== 'closed' ? '<span class="pill gold" title="' + esc(T.stamp(t.pinAt)) + '">закрепил ' +
        esc(t.pinBy || '—') + '</span>' : '') +
      (t.site === false ? '<span>из Discord</span>' : '') + '</div>';

    /* Отложено (овнер 30.09.2026): до срока его не трогают SIGEA, само закрытие и
       напоминания; в срок бот пишет отложившему и ведущему, обращение встает первым. */
    if (t.later && t.status !== 'closed') {
      h += '<div class="nbox' + (t.due ? ' warn' : '') + ' tkd-lat">' + (t.due ? '<span class="n-ic">!</span>' : '') + '<div>' +
        (t.due ? '<b>Срок отложенного вышел ' + esc(T.stamp(t.later)) + '.</b> Пора дать ответ.'
          : '<b>Отложено до ' + esc(T.stamp(t.later)) + '.</b> До срока SIGEA, само закрытие и напоминания его не трогают.') +
        ' Отложил ' + esc(t.laterBy || '—') + (t.laterAt ? ' ' + esc(T.stamp(t.laterAt)) : '') + '.' +
        (t.laterWhy ? '<br>Зачем: ' + esc(t.laterWhy) : '') + '</div></div>';
    }

    /* действия */
    h += '<div class="tkd-act">';
    if (t.status !== 'closed') {
      if (!t.by) h += '<button type="button" class="btn btn-primary btn-sm" data-as="me">Взять себе</button>';
      else if (mineT) h += '<button type="button" class="btn btn-dark btn-sm" data-as="">Снять с себя</button>';
      /* Овнер 28.09.2026: передать может любой из команды — ничье или свое обращение;
         тому, кому передали, бот пишет в ЛС. Чужое переназначает владелец. */
      var own = (r.owners || []).map(function (n) { return String(n).toLowerCase(); });
      var to = (r.staff || []).filter(function (n) { return String(n).toLowerCase() !== String(me).toLowerCase(); });
      if (to.length && (r.owner || !t.by || mineT)) {
        h += '<select id="tkdTo" aria-label="Передать"><option value="">Передать…</option>' +
          to.map(function (n) {
            return '<option value="' + esc(n) + '">' + esc(n) +
              (own.indexOf(String(n).toLowerCase()) >= 0 ? ' (владелец)' : '') + '</option>';
          }).join('') + '</select>';
      }
      if (r.owner && t.by && !mineT) h += '<button type="button" class="btn btn-dark btn-sm" data-as="">Снять ведущего</button>';
      if (t.status !== 'work') h += '<button type="button" class="btn btn-dark btn-sm" data-st="work">В работу</button>';
      if (t.status !== 'wait') h += '<button type="button" class="btn btn-dark btn-sm" data-st="wait">Ждет игрока</button>';
      h += '<button type="button" class="btn btn-dark btn-sm" data-st="closed">Закрыть</button>';
      /* Закрепить и отложить — только высшая администрация (сервер проверяет сам). */
      if (r.top) {
        h += '<button type="button" class="btn btn-dark btn-sm" data-pin="' + (t.pin ? '0' : '1') + '">' +
          (t.pin ? 'Открепить' : 'Закрепить') + '</button>';
        h += '<button type="button" class="btn btn-dark btn-sm" id="tkdLaterGo" aria-controls="tkdLater">' +
          (t.later ? 'Перенести срок…' : 'Отложить…') + '</button>';
        if (t.later) h += '<button type="button" class="btn btn-dark btn-sm" data-later0="1">Вернуть из отложенных</button>';
      }
    } else {
      h += '<button type="button" class="btn btn-dark btn-sm" data-st="open">Открыть заново</button>';
    }
    h += '<span class="fg-note" id="tkdActSay" role="status"></span></div>';

    /* Выдача предметов по обращению — письмом /mail, только высшая администрация. */
    if (r.compCap > 0 || (t.comps || []).length) {
      h += '<div class="tkd-give"><h3 class="tk-h3">Выдача предметов</h3>';
      (t.comps || []).forEach(function (c) {
        h += '<div class="tkd-gv"><span><b>' + esc(c.count) + ' × ' + esc(c.name || c.item) + '</b> · ' + esc(c.by) +
          ' · ' + esc(T.stamp(c.at)) + (c.revokedBy ? ' · <i>отозвал ' + esc(c.revokedBy) + '</i>' : '') + '</span>' +
          (!c.revokedAt && r.compCap > 0 ? '<button type="button" class="btn btn-dark btn-sm" data-crev="' + esc(c.letter) +
            '">Отозвать</button>' : '') + '</div>';
      });
      if (r.compCap > 0 && t.status !== 'closed' && t.nick) {
        h += '<button type="button" class="btn btn-dark btn-sm" id="tkdGive">Выдать предметы автору письмом…</button>';
      }
      h += '</div>';
    }

    return h;
  }

  /* «Отложить для решения позже» (овнер 30.09.2026): важное обращение, ответ на
     которое будет позже, — например, про стажеров. Срок от 10 минут до 31 дня. */
  var LATER_MIN = 10 * 60 * 1000, LATER_MAX = 31 * 24 * 3600 * 1000;
  function localVal(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function laterForm(t) {
    var now = Date.now();
    var def = t.later && t.later > now + LATER_MIN ? t.later : now + 3 * 86400000;
    var pre = [['1', 'На день'], ['3', 'На 3 дня'], ['7', 'На неделю'], ['14', 'На 2 недели']];
    return '<div class="tkd-later" id="tkdLater" hidden>' +
      '<h3 class="tk-h3">' + (t.later ? 'Перенести срок' : 'Отложить для решения позже') + '</h3>' +
      '<p class="tkd-later-n">До срока обращение не трогают SIGEA, само закрытие и напоминания. В срок бот напишет ' +
      'вам и ведущему, а обращение встанет первым в «Ждут ответа». Ответ игроку снимает отложенное досрочно.</p>' +
      '<div class="tkd-later-pre">' + pre.map(function (p) {
        return '<button type="button" class="btn btn-dark btn-sm" data-days="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="tkdLaterAt">До какого времени</label>' +
      '<input type="datetime-local" id="tkdLaterAt" value="' + esc(localVal(def)) + '" min="' + esc(localVal(now + LATER_MIN)) +
      '" max="' + esc(localVal(now + LATER_MAX)) + '"></div>' +
      '<div class="field"><label for="tkdLaterWhy">Зачем — видит только команда</label>' +
      '<input type="text" id="tkdLaterWhy" maxlength="300" value="' + esc(t.laterWhy || '') +
      '" placeholder="Например: решаем по итогам стажировки"></div>' +
      '<label class="tkd-chk"><input type="checkbox" id="tkdLaterTell"> Написать игроку, что ответ будет позже</label>' +
      '<div class="field" id="tkdLaterMsgF" hidden><textarea id="tkdLaterMsg" maxlength="4000"></textarea></div>' +
      '<div class="form-go"><button type="button" class="btn btn-primary" id="tkdLaterOk">' +
      (t.later ? 'Перенести' : 'Отложить') + '</button>' +
      '<button type="button" class="btn btn-dark" id="tkdLaterNo">Отмена</button>' +
      '<div class="fg-note" role="status" id="tkdLaterSay"></div></div></div>';
  }

  function bindLater(t, r) {
    var box = document.getElementById('tkdLater');
    if (!box) return;
    var at = document.getElementById('tkdLaterAt');
    var why = document.getElementById('tkdLaterWhy');
    var tell = document.getElementById('tkdLaterTell');
    var msgF = document.getElementById('tkdLaterMsgF');
    var msg = document.getElementById('tkdLaterMsg');
    var say = document.getElementById('tkdLaterSay');
    var ok = document.getElementById('tkdLaterOk');
    function until() { var v = at.value ? new Date(at.value).getTime() : NaN; return isFinite(v) ? v : 0; }
    function dd(ms) {
      var d = new Date(ms);
      return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
    }
    function draft() {
      var u = until();
      return 'Спасибо, обращение принято. Ответ дадим позже' + (u ? ', до ' + dd(u) : '') + ' — напишем здесь.';
    }
    var touched = false;
    msg.addEventListener('input', function () { touched = true; });
    function redraft() { if (!touched) msg.value = draft(); }
    box.querySelectorAll('[data-days]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = new Date(Date.now() + (+b.getAttribute('data-days')) * 86400000);
        d.setHours(18, 0, 0, 0);
        at.value = localVal(d.getTime());
        redraft();
      });
    });
    at.addEventListener('change', redraft);
    tell.addEventListener('change', function () {
      msgF.hidden = !tell.checked;
      if (tell.checked) { redraft(); msg.focus(); }
    });
    document.getElementById('tkdLaterNo').addEventListener('click', function () { box.hidden = true; say.textContent = ''; });
    ok.addEventListener('click', function () {
      var u = until(), now = Date.now();
      if (!u) { say.textContent = 'Укажите, до какого времени отложить.'; at.focus(); return; }
      if (u < now + LATER_MIN - 60000) { say.textContent = 'Срок — не раньше чем через 10 минут.'; at.focus(); return; }
      if (u > now + LATER_MAX) { say.textContent = 'Срок — не дальше чем через 31 день.'; at.focus(); return; }
      var body = { id: t.id, until: u, why: why.value.trim() };
      if (tell.checked) {
        body.tell = msg.value.trim();
        if (!body.tell) { say.textContent = 'Напишите игроку пару слов или снимите галку.'; msg.focus(); return; }
      }
      ok.disabled = true;
      say.textContent = '';
      A.call('/adm/ticket/later', { body: body }).then(function (res) {
        r.ticket = res.ticket;
        showTicket(r);
      }, function (err) {
        ok.disabled = false;
        if (err && err.code === 'auth') { drawLogin(); return; }
        say.textContent = A.textOf(err);
      });
    });
  }

  function crewOf(t, r) {
    var cr = t.crew || r.crew;
    return cr ? '<h3 class="tk-h3">На связи</h3>' + T.crew(cr, true) : '';
  }

  function showTicket(r) {
    var t = r.ticket;
    if (!t) return;
    stopLive();
    var me = r.me || ME.nick;
    var mineT = t.by && t.by.toLowerCase() === String(me).toLowerCase();
    document.title = '№' + t.no + ' — обращения AEGIS';
    var h = '<div class="tkd tkd-one">' + head();
    h += '<p class="tk-back tkd-top"><a href="#">← к списку обращений</a></p>';
    h += '<div class="tk-cols"><div class="tk-main">';
    h += '<div class="tk-head"><h2>№' + esc(t.no) + ' · ' + esc(T.catName(t.cat, t.name)) + '</h2></div>';
    h += '<div id="tkdTop">' + topOf(t, r) + '</div>';
    /* Форма срока живет вне #tkdTop: живое обновление перерисовывает шапку и
       стерло бы набранное. */
    if (r.top && t.status !== 'closed') h += laterForm(t);

    h += T.fields(t.fields);
    if (t.contact) h += '<dl class="tk-fields"><dt>Куда ответить (старая форма)</dt><dd>' + T.text(t.contact) + '</dd></dl>';
    h += T.files(t.attach);
    if (t.pub && (t.cat === 'dcverify' || t.cat === 'video' || t.cat === 'streamer')) h += pubBox(t);
    h += '<h3 class="tk-h3">Переписка</h3><div id="tkdFeed">' + T.thread(t.thread, me, true) + '</div>';
    h += '<div class="tk-typing" id="tkdTyping" role="status" aria-live="polite" hidden></div>';

    /* ответ */
    h += '<form id="tkdRe" class="tk-reply" novalidate>' +
      '<div class="field"><label for="tkdReT">Ответ</label>' +
      '<textarea id="tkdReT" maxlength="4000" placeholder="Игрок увидит ответ на сайте, оповещение придет ему в игру и в Discord"></textarea></div>' +
      '<div class="field"><div id="tkdUp"></div></div>' +
      '<div class="tkd-opts"><label class="tkd-chk"><input type="checkbox" id="tkdInt"> ' +
      'Заметка для команды — игрок не увидит</label>' +
      '<label class="tkd-then">После ответа: <select id="tkdThen">' +
      '<option value="wait">ждет игрока</option><option value="work">в работе</option>' +
      '<option value="closed">закрыть</option></select></label></div>' +
      '<div class="form-go"><button class="btn btn-primary" type="submit" id="tkdGo">Отправить</button>' +
      '<div class="fg-note" role="status" id="tkdSay"></div></div></form>';
    h += '</div><aside class="tk-side" id="tkdCrew">' + crewOf(t, r) + '</aside></div>';
    h += '<p class="tk-back"><a href="#">← к списку обращений</a></p></div>';
    root.innerHTML = h;
    T.heads(root);
    bindHead();
    bindTicket(t, r);
    if (T.live) startLive(t, r);
  }

  /* Игрок ответил, кто-то взял обращение — перечитываем и меняем шапку,
     переписку и «на связи»; набранный ответ, галка заметки и файлы остаются. */
  function startLive(t, r) {
    var busy = false;
    var inn = document.getElementById('tkdInt');
    LIVE = T.live({
      url: '/adm/ticket/live', type: '/adm/ticket/typing', id: t.id,
      n: (t.thread || []).length, status: t.status,
      box: document.getElementById('tkdTyping'),
      extra: function () { return { note: !!(inn && inn.checked) }; },
      changed: function () {
        if (busy) return;
        busy = true;
        A.call('/adm/ticket?id=' + encodeURIComponent(t.id)).then(function (r2) {
          busy = false;
          if (!r2 || !r2.ticket || hashId() !== t.id || !document.getElementById('tkdFeed')) return;
          var me = r2.me || ME.nick;
          var top = document.getElementById('tkdTop');
          var feed = document.getElementById('tkdFeed');
          var crew = document.getElementById('tkdCrew');
          top.innerHTML = topOf(r2.ticket, r2);
          feed.innerHTML = T.thread(r2.ticket.thread, me, true);
          crew.innerHTML = crewOf(r2.ticket, r2);
          T.heads(top); T.heads(feed); T.heads(crew);
          bindActs(r2.ticket, r2);
        }, function () { busy = false; });
      }
    });
    LIVE.input(document.getElementById('tkdReT'));
    // Сменил галку «заметка» посреди текста — пометка у коллег меняется сразу.
    if (inn) inn.addEventListener('change', function () {
      var ta = document.getElementById('tkdReT');
      if (ta && ta.value.trim() && document.activeElement === ta) { LIVE.ping(false); LIVE.ping(true); }
    });
  }

  /* Публикация в Discord по одобрению команды. Две темы:
     — проверка Discord-сервера державы: ссылка уходит в канал серверов держав на 30 дней;
     — ролик игрока (овнер 25.09.2026: «кнопка для администрации от средней одобрить
       ролик и он бы пошел в канал "видео игроков"»): бот выкладывает карточку ролика.
     Игрок получает ответ, обращение закрывается. */
  var PUB = {
    dcverify: { where: 'канал серверов держав', what: 'ссылку', name: 'Кого представляет сервер',
      link: 'Ссылка-приглашение', ph: 'https://discord.gg/…', text: 'Текст карточки',
      check: 'Проверьте сервер.', tail: ' на 30 дней',
      rx: /discord\.gg\/[A-Za-z0-9-]{2,}|discord(?:app)?\.com\/invite\/[A-Za-z0-9-]{2,}/i,
      bad: 'Нужна ссылка-приглашение вида discord.gg/…', noName: 'Впишите, кого представляет сервер.' },
    video: { where: 'канал «видео игроков»', what: 'ролик', name: 'Канал автора',
      link: 'Ссылка на ролик', ph: 'https://youtube.com/…', text: 'О чем ролик',
      check: 'Посмотрите ролик: про AEGIS, без запрещенного, ссылка открывается.', tail: '',
      rx: /(youtube\.com\/(watch|shorts\/|live\/)|youtu\.be\/|tiktok\.com\/|vk\.com\/(video|clip)|vkvideo\.ru\/|rutube\.ru\/(video|shorts)\/|twitch\.tv\/)/i,
      bad: 'Нужна ссылка на ролик: YouTube, TikTok, VK Видео, Rutube или Twitch.', noName: 'Впишите название канала.' },
    /* Стример (овнер 28.09.2026): роль «Стример проекта» и канал в эфиры. Обычно одобряет
       SIGEA сама, проверив канал; кнопка — для заявок, которые она передала людям. */
    streamer: { where: 'эфиры', what: 'роль «Стример проекта» и канал', name: 'Ник в игре',
      link: 'Ссылка на канал', ph: 'https://twitch.tv/…', text: '', act: 'выдаст игроку роль «Стример проекта» и запишет канал в эфиры',
      done: 'Роль выдана, канал записан в эфиры', fail: 'Бот не смог выдать роль', btn: 'Одобрить стримера',
      check: 'Проверьте канал: он открывается и это канал игрока.', tail: '',
      rx: /twitch\.tv\/[A-Za-z0-9_]{3,}|youtube\.com\/(@[A-Za-z0-9_.\-]{3,}|channel\/UC)|live\.(vkvideo|vkplay)\.ru\/[A-Za-z0-9_.\-]{2,}|kick\.com\/[A-Za-z0-9_\-]{3,}/i,
      bad: 'Нужна ссылка на канал: Twitch, YouTube (@имя), VK Видео Live или Kick. TikTok — вручную в Discord.', noName: 'Впишите ник стримера.' }
  };

  function pubBox(t) {
    var p = t.pub || {}, st = p.state || '', K = PUB[t.cat] || PUB.dcverify;
    var h = '<section class="tkd-pub"><h3 class="tk-h3">Публикация в Discord</h3>';
    if (st === 'wait' || st === 'done') {
      h += '<p class="tkd-p">' + (st === 'wait'
        ? 'Одобрено' + (p.by ? ' — ' + esc(p.by) : '') + ', ' + esc(T.stamp(p.at)) +
          '. Бот ' + (K.act || 'выложит ' + K.what + ' в ' + K.where) + ' в течение пары минут.'
        : (K.done || 'Выложено в ' + K.where) + (p.by ? ' (одобрил ' + esc(p.by) + ')' : '') + '.' +
          (p.url ? ' <a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">Открыть в Discord</a>' : '')) +
        '</p><dl class="tk-fields"><dt>' + K.name + '</dt><dd>' + T.text(p.title || '') + '</dd>' +
        '<dt>' + K.link + '</dt><dd>' + T.text(p.invite || '') + '</dd>' +
        (p.text ? '<dt>' + K.text + '</dt><dd>' + T.text(p.text) + '</dd>' : '') + '</dl>';
      return h + '</section>';
    }
    if (st === 'fail') {
      h += '<div class="nbox tkd-pub-bad"><span class="n-ic">!</span><div>' + (K.fail || 'Бот не смог выложить ' + K.what) +
        (p.error ? ': ' + esc(p.error) : '') + '. Проверьте ссылку и нажмите «Одобрить» еще раз.</div></div>';
    }
    h += '<p class="tkd-p">' + K.check + ' Все в порядке — при необходимости поправьте поля и нажмите ' +
      '«Одобрить». Бот ' + (K.act || 'выложит ' + K.what + ' в ' + K.where) + K.tail + ', игрок получит ответ, обращение закроется.</p>' +
      '<form id="tkdPub" class="tkd-pubf" novalidate>' +
      '<div class="field"><label for="tkdPubT">' + K.name + '</label>' +
      '<input id="tkdPubT" maxlength="100" value="' + esc(p.title || '') + '"></div>' +
      '<div class="field"><label for="tkdPubI">' + K.link + '</label>' +
      '<input id="tkdPubI" maxlength="250" placeholder="' + K.ph + '" value="' + esc(p.invite || '') + '"></div>' +
      (K.text ? '<div class="field"><label for="tkdPubX">' + K.text + ' <span class="muted">(необязательно)</span></label>' +
      '<textarea id="tkdPubX" maxlength="1500">' + esc(p.text || '') + '</textarea></div>' : '') +
      '<div class="form-go"><button class="btn btn-primary" type="submit" id="tkdPubGo">' + (K.btn || 'Одобрить и выложить') + '</button>' +
      '<div class="fg-note" role="status" id="tkdPubSay"></div></div></form>';
    return h + '</section>';
  }

  function bindPub(t, r) {
    var f = document.getElementById('tkdPub');
    if (!f) return;
    var K = PUB[t.cat] || PUB.dcverify;
    var go = document.getElementById('tkdPubGo');
    var say = document.getElementById('tkdPubSay');
    var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { id: t.id, title: val('tkdPubT'), invite: val('tkdPubI'), text: val('tkdPubX') };
      if (!body.title) { say.textContent = K.noName; return; }
      if (!K.rx.test(body.invite)) { say.textContent = K.bad; return; }
      if (!confirm(K.act ? 'Одобрить стримера «' + body.title + '»? Бот ' + K.act + '.' : 'Одобрить «' + body.title + '» и выложить в ' + K.where + '?')) return;
      go.disabled = true; say.textContent = 'Одобряем…';
      A.call('/adm/ticket/approve', { body: body }).then(function (res) {
        r.ticket = res.ticket;
        showTicket(r);
      }, function (err) {
        go.disabled = false;
        if (err && err.code === 'auth') { drawLogin(); return; }
        say.textContent = A.textOf(err);
      });
    });
  }

  function bindTicket(t, r) {
    bindPub(t, r);
    bindActs(t, r);
    bindLater(t, r);
    bindForm(t, r);
  }

  function bindActs(t, r) {
    var say = document.getElementById('tkdActSay');
    function act(path, body) {
      root.querySelectorAll('.tkd-act button, .tkd-act select').forEach(function (b) { b.disabled = true; });
      A.call(path, { body: body }).then(function (res) {
        r.ticket = res.ticket;
        showTicket(r);
      }, function (err) {
        root.querySelectorAll('.tkd-act button, .tkd-act select').forEach(function (b) { b.disabled = false; });
        if (err && err.code === 'auth') { drawLogin(); return; }
        say.textContent = A.textOf(err);
      });
    }
    root.querySelectorAll('[data-as]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-as') === 'me' ? (r.me || ME.nick) : '';
        act('/adm/ticket/assign', { id: t.id, to: to });
      });
    });
    var sel = document.getElementById('tkdTo');
    if (sel) sel.addEventListener('change', function () {
      if (sel.value) act('/adm/ticket/assign', { id: t.id, to: sel.value });
    });
    var gv = document.getElementById('tkdGive');
    if (gv) gv.addEventListener('click', function () {
      GIVE.nick = t.nick || '';
      GIVE.no = String(t.no);
      GIVE.why = '';
      TAB = 'give';
      location.hash = '';
    });
    root.querySelectorAll('[data-crev]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Отозвать эту выдачу? Письмо пропадет у игрока, если он его еще не забрал.')) return;
        act('/adm/ticket/comp', { id: t.id, revoke: b.getAttribute('data-crev') });
      });
    });
    root.querySelectorAll('[data-st]').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.getAttribute('data-st');
        if (st === 'closed' && !confirm('Закрыть обращение №' + t.no + '?')) return;
        act('/adm/ticket/state', { id: t.id, status: st });
      });
    });
    root.querySelectorAll('[data-pin]').forEach(function (b) {
      b.addEventListener('click', function () {
        act('/adm/ticket/pin', { id: t.id, on: b.getAttribute('data-pin') === '1' });
      });
    });
    root.querySelectorAll('[data-later0]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Вернуть обращение №' + t.no + ' из отложенных? Оно снова попадет в обычный порядок.')) return;
        act('/adm/ticket/later', { id: t.id, until: 0 });
      });
    });
    var lg = document.getElementById('tkdLaterGo');
    if (lg) lg.addEventListener('click', function () {
      var box = document.getElementById('tkdLater');
      if (!box) {
        /* обращение открыли заново, пока страница была открыта, — формы еще нет */
        r.ticket = t; showTicket(r);
        box = document.getElementById('tkdLater');
        if (!box) return;
      }
      box.hidden = !box.hidden;
      if (!box.hidden) {
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        var at = document.getElementById('tkdLaterAt');
        if (at) at.focus();
      }
    });
  }

  function bindForm(t, r) {
    var f = document.getElementById('tkdRe');
    var ta = document.getElementById('tkdReT');
    var go = document.getElementById('tkdGo');
    var rs = document.getElementById('tkdSay');
    var inn = document.getElementById('tkdInt');
    var then = document.getElementById('tkdThen');
    var up = T.uploader(document.getElementById('tkdUp'), null);
    if (REPLY[t.id]) ta.value = REPLY[t.id];
    ta.addEventListener('input', function () { REPLY[t.id] = ta.value; });
    if (t.status === 'closed') then.value = 'closed';
    inn.addEventListener('change', function () {
      ta.placeholder = inn.checked ? 'Видно только команде' : 'Игрок увидит ответ на сайте, оповещение придет ему в игру и в Discord';
      go.textContent = inn.checked ? 'Сохранить заметку' : 'Отправить';
      then.value = inn.checked ? '' : (t.status === 'closed' ? 'closed' : 'wait');
      if (inn.checked && !then.querySelector('option[value=""]')) {
        var o = document.createElement('option');
        o.value = ''; o.textContent = 'стадию не менять';
        then.insertBefore(o, then.firstChild);
        then.value = '';
      }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      var files = up.ids();
      if (up.busy()) { rs.textContent = 'Дождитесь, пока загрузятся файлы.'; return; }
      if (!text && !files.length) { rs.textContent = 'Напишите ответ или приложите файл.'; return; }
      go.disabled = true; rs.textContent = 'Отправляем…';
      var body = { id: t.id, text: text, files: files, internal: inn.checked };
      if (then.value) body.then = then.value;
      if (LIVE) LIVE.sent();
      A.call('/adm/ticket/reply', { body: body }).then(function (res) {
        delete REPLY[t.id];
        r.ticket = res.ticket;
        showTicket(r);
        var s2 = document.getElementById('tkdSay');
        if (s2) s2.textContent = inn.checked ? 'Заметка сохранена.' : 'Ответ отправлен — игрок увидит его на сайте.';
      }, function (err) {
        go.disabled = false;
        if (err && err.code === 'auth') { drawLogin(); return; }
        rs.textContent = A.textOf(err);
      });
    });
  }

  /* ------------------------------------------------------------ команда (владелец) */

  function drawTeam() {
    var box = document.getElementById('tkdTeam');
    A.call('/adm/staff').then(function (r) { teamView(box, r); },
      function (err) { box.innerHTML = '<div class="nbox warn"><span class="n-ic">!</span><div>' + esc(A.textOf(err)) + '</div></div>'; });
  }

  function teamView(box, r) {
    if (!document.getElementById('tkdTeam')) return;
    var h = '<p class="tkd-p">Доступ по должности выдается сам: сервер сверяет роли в Discord, ' +
      'и с ролью доступ уходит. Вручную здесь добавляют тех, у кого нужной роли нет.</p>';
    h += '<h3 class="tk-h3">По должности</h3>';
    var auto = r.auto || [];
    h += auto.length ? '<div class="row-list">' + auto.map(function (x) {
      return '<div class="row r2"><div><div class="rw-t"><b>' + esc(x.nick) + '</b> · ' + esc(x.rank) + '</div>' +
        '<div class="rw-s">Темы: ' + esc((x.cats || []).map(function (k) { return T.catName(k, k); }).join(', ')) +
        (x.account ? '' : ' · <b>нет игрового аккаунта</b> — войти не сможет, пока не зайдет в лаунчер') + '</div></div>' +
        '<div class="rw-r">в работе: ' + esc(x.load || 0) + '<br>разобрал: ' + esc(x.doneWeek || 0) +
        ' за 7 дн. · ' + esc(x.done || 0) + ' всего</div></div>';
    }).join('') + '</div>' : '<p class="tkd-p">Никого.</p>';
    h += '<h3 class="tk-h3">Добавлены вручную</h3>';
    var st = r.staff || [];
    h += st.length ? '<div class="row-list">' + st.map(function (x) {
      return '<div class="row r2"><div><div class="rw-t"><b>' + esc(x.nick) + '</b>' +
        (x.rank ? ' · ' + esc(x.rank) : '') + '</div><div class="rw-s">добавил ' + esc(x.by || '') +
        ' · ' + esc(T.stamp(x.at)) + ' · в работе: ' + esc(x.load || 0) + ' · разобрал: ' +
        esc(x.doneWeek || 0) + ' за 7 дн., ' + esc(x.done || 0) + ' всего</div></div>' +
        '<div class="rw-r"><button type="button" class="btn btn-dark btn-sm" data-off="' + esc(x.nick) + '">Снять</button></div></div>';
    }).join('') + '</div>' : '<p class="tkd-p">Никого.</p>';
    h += '<form class="tkd-bar" id="tkdAdd"><input class="tkd-q" id="tkdAddN" type="text" maxlength="16" ' +
      'placeholder="Ник игрока" autocomplete="off" spellcheck="false">' +
      '<button class="btn btn-primary btn-sm" type="submit">Дать доступ ко всем темам</button></form>' +
      '<div class="fg-note" id="tkdAddSay" role="status"></div>';
    if (r.team && r.team.length) {
      h += '<p class="tkd-p">С админ-режимом в лаунчере, но без доступа здесь: ' +
        esc(r.team.join(', ')) + '.</p>';
    }
    box.innerHTML = h;
    var say = document.getElementById('tkdAddSay');
    function set(nick, on) {
      say.textContent = '…';
      A.call('/adm/staff/set', { body: { nick: nick, on: on } }).then(function (res) {
        teamView(box, res);
      }, function (err) { say.textContent = A.textOf(err); });
    }
    document.getElementById('tkdAdd').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = document.getElementById('tkdAddN').value.trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) { say.textContent = 'Ник: 3–16 знаков, латиница, цифры, подчеркивание.'; return; }
      if (!confirm('Дать ' + n + ' доступ ко всем обращениям?')) return;
      set(n, true);
    });
    box.querySelectorAll('[data-off]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = b.getAttribute('data-off');
        if (confirm('Снять доступ у ' + n + '? Его открытые обращения вернутся в общую очередь.')) set(n, false);
      });
    });
  }

  /* ------------------------------------------------------------ доступ к темам */

  /* Овнер 25.09.2026: «для высшей администрации, чтобы они могли настраивать тикеты
     для админов ниже… кто может просматривать обращения той или иной категории».
     Таблица: строки — темы, столбцы — должности сверху вниз. Тему видит выбранная
     должность и все старше нее. Кольцо — как было в тикетах Discord. Что можно
     менять, решает сервер (edit у темы, pick у должности). */
  var SHORT = { founder: 'Осн.', head: 'Упр.', deputy_head: 'Пом. упр.', coordinator: 'Коорд.',
    chief_admin: 'Гл. адм.', special_admin: 'Адм. ОП', senior_admin: 'Ст. адм.', admin: 'Адм.',
    senior_mod: 'Ст. мод.', mod: 'Мод.' };

  function drawAccess() {
    var box = document.getElementById('tkdTeam');
    A.call('/adm/access').then(function (r) { accessView(box, r); },
      function (err) { box.innerHTML = '<div class="nbox warn"><span class="n-ic">!</span><div>' + esc(A.textOf(err)) + '</div></div>'; });
  }

  function accessView(box, r) {
    if (!document.getElementById('tkdTeam') || TAB !== 'access') return;
    var ranks = r.ranks || [], idx = {};
    ranks.forEach(function (x, i) { idx[x.id] = i; });
    var h = '<p class="tkd-p">Кто видит обращения каждой темы. Тему видит отмеченная должность и все, кто ' +
      'старше. <span class="tkd-acc-ring" aria-hidden="true"></span> — как было в тикетах Discord. ' +
      (r.can ? 'Нажмите на клетку, чтобы тему видели с этой должности. Темы выше вашей должности настраивают старшие.'
        : 'Менять доступ могут Координатор и выше.') +
      ' Бот шлет уведомления о новых обращениях по этой же таблице.</p>';
    h += '<div class="tkd-acc-w"><table class="tkd-acc"><thead><tr><th scope="col">Тема</th>';
    ranks.forEach(function (x) {
      var c = T.color(x.color);
      h += '<th scope="col" title="' + esc(x.title) + '"' + (c ? ' style="color:' + c + '"' : '') + '>' +
        esc(SHORT[x.id] || x.title) + '</th>';
    });
    h += '<th scope="col"><span class="sr-only">Сброс</span></th></tr></thead><tbody>';
    (r.cats || []).forEach(function (c) {
      var need = idx[c.need], def = idx[c.def];
      h += '<tr' + (c.need !== c.def ? ' class="chg"' : '') + '><th scope="row">' + esc(T.catName(c.cat, c.cat)) + '</th>';
      ranks.forEach(function (x, i) {
        var on = i <= need, col = T.color(x.color);
        var can = c.edit && x.pick && i !== need;
        h += '<td><button type="button" class="tkd-acc-c' + (on ? ' on' : '') + (i === need ? ' lo' : '') +
          (i === def ? ' def' : '') + '"' + (col && on ? ' style="--rc:' + col + '"' : '') +
          (can ? ' data-cat="' + esc(c.cat) + '" data-need="' + esc(x.id) + '"' : ' disabled') +
          ' title="' + esc(x.title) + (on ? ' — видит' : ' — не видит') + '" aria-label="' +
          esc(T.catName(c.cat, c.cat) + ': ' + x.title + (on ? ', видит' : ', не видит')) + '"></button></td>';
      });
      h += '<td>' + (c.edit && c.need !== c.def
        ? '<button type="button" class="tkd-acc-def" data-cat="' + esc(c.cat) + '" data-need="">как в Discord</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="tkd-acc-f"><span class="fg-note" id="tkdAccSay" role="status">' +
      (r.by ? 'Последняя правка: ' + esc(r.by) + ', ' + esc(T.stamp(r.at)) : 'Все как было в Discord.') + '</span>' +
      (r.owner && (r.cats || []).some(function (c) { return c.need !== c.def; })
        ? '<button type="button" class="btn btn-dark btn-sm" id="tkdAccReset">Вернуть все как в Discord</button>' : '') + '</div>';
    box.innerHTML = h;
    var say = document.getElementById('tkdAccSay');
    function send(b, what) {
      say.textContent = 'Сохраняем…';
      box.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
      A.call('/adm/access', { body: b }).then(function (res) {
        accessView(box, res);
        var s = document.getElementById('tkdAccSay');
        if (s) s.textContent = what;
      }, function (err) {
        if (err && err.code === 'auth') { drawLogin(); return; }
        accessView(box, r);
        var s = document.getElementById('tkdAccSay');
        if (s) s.textContent = A.textOf(err);
      });
    }
    box.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cat = b.getAttribute('data-cat'), need = b.getAttribute('data-need');
        var rk = ranks[idx[need]];
        send({ cat: cat, need: need }, '«' + T.catName(cat, cat) + '» теперь видят ' +
          (need ? 'с должности «' + (rk ? rk.title : need) + '»' : 'как в Discord') + '.');
      });
    });
    var rs = document.getElementById('tkdAccReset');
    if (rs) rs.addEventListener('click', function () {
      if (confirm('Вернуть доступ ко всем темам как было в Discord?')) send({ reset: true }, 'Доступ ко всем темам — как в Discord.');
    });
  }

  /* ------------------------------------------------------------ карточка игрока */

  /* Овнер 25.09.2026: «чтобы команда администрации могла нажать на ник игрока и
     открыть профиль… в какой стране, координаты где он в последний раз находился,
     какая привилегия» и «что у него по кейсам наказаний». Все собирает сервер
     (/adm/player); где стоит старший по должности, младшему не показывается. */
  function playerBtn(nick, label) {
    if (!nick || !/^[A-Za-z0-9_]{3,16}$/.test(nick)) return esc(label || nick || '');
    return '<button type="button" class="tk-who" data-player="' + esc(nick) + '">' + esc(label || nick) + '</button>';
  }

  var PC = null;
  var KIND = { warn: ['пред', 'gold'], mute: ['мут', 'red'], unmute: ['снят мут', 'green'],
    ban: ['бан', 'red'], unban: ['разбан', 'green'], kick: ['кик', 'steel'] };
  var DIM = { 'minecraft:overworld': 'обычный мир', 'minecraft:the_nether': 'Незер', 'minecraft:the_end': 'Энд' };
  var MODE = { creative: 'творческий', spectator: 'наблюдатель', adventure: 'приключение' };

  function playerOpen(nick) {
    if (!PC) {
      PC = document.createElement('div');
      PC.className = 'tkp';
      PC.setAttribute('role', 'dialog');
      PC.setAttribute('aria-modal', 'true');
      PC.setAttribute('aria-label', 'Карточка игрока');
      PC.innerHTML = '<div class="tkp-box"><button type="button" class="tkp-x" aria-label="Закрыть">×</button>' +
        '<div class="tkp-in"></div></div>';
      document.body.appendChild(PC);
      PC.addEventListener('click', function (e) {
        if (e.target === PC || e.target.closest('.tkp-x') || e.target.closest('a[href^="#t="]')) { playerClose(); return; }
        var cp = e.target.closest('[data-copy]');
        if (cp) copy(cp);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !PC.classList.contains('on')) return;
        if (document.querySelector('.tk-lb.on')) return;   // сначала закрывается просмотр
        playerClose();
      });
    }
    var inn = PC.querySelector('.tkp-in');
    inn.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    PC.classList.add('on');
    document.documentElement.classList.add('tk-lb-lock');
    PC.querySelector('.tkp-x').focus();
    A.call('/adm/player?nick=' + encodeURIComponent(nick)).then(function (r) {
      inn.innerHTML = playerView(r);
      T.heads(inn);
    }, function (err) {
      if (err && err.code === 'auth') { playerClose(); drawLogin(); return; }
      inn.innerHTML = '<h2 class="tkp-nick">' + esc(nick) + '</h2><div class="nbox warn"><span class="n-ic">!</span><div>' +
        esc(err && err.code === 'http' ? 'Карточка игрока заработает после обновления сервера.' : A.textOf(err)) + '</div></div>';
    });
  }

  function playerClose() {
    if (!PC) return;
    PC.classList.remove('on');
    document.documentElement.classList.remove('tk-lb-lock');
  }

  function copy(b) {
    var s = b.getAttribute('data-copy'), old = b.textContent;
    var ok = function () { b.textContent = 'Скопировано'; setTimeout(function () { b.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(ok, function () { prompt('Скопируйте:', s); });
    else prompt('Скопируйте:', s);
  }

  function fact(k, v, sub) {
    return '<div class="tkp-f"><dt>' + k + '</dt><dd>' + v + (sub ? '<small>' + sub + '</small>' : '') + '</dd></div>';
  }

  function playerView(r) {
    var p = r.player || {}, now = Date.now(), h = '';
    var bc = T.color(p.badgeColor), cc = T.color(p.countryColor);
    h += '<div class="tkp-head"><canvas class="tk-av tkp-av" data-nick="' + esc(p.nick) + '" aria-hidden="true"></canvas>' +
      '<div><h2 class="tkp-nick">' + esc(p.nick) + '</h2><div class="tkp-tags">' +
      (p.badge ? '<span class="tkp-badge"' + (bc ? ' style="color:' + bc + ';border-color:' + bc + '66"' : '') + '>' + esc(p.badge) + '</span>' : '') +
      (p.online ? '<span class="tkp-st on">в игре' + (p.hidden ? ' · невидим' : '') + '</span>'
        : '<span class="tkp-st">не в игре</span>') +
      (p.duty === true ? '<span class="tkp-st duty">на дежурстве</span>' : '') +
      '</div></div></div>';

    /* что действует прямо сейчас */
    var al = '';
    if (p.ban) {
      var why = p.ban.reason && p.ban.reason !== 'Banned by an operator.' ? p.ban.reason : '';
      al += '<div class="tkp-al red"><b>Забанен' + (p.ban.until ? ' до ' + esc(T.stamp(p.ban.until)) : ' навсегда') + '</b>' +
        (why ? '<span>Причина: ' + esc(why) + '</span>' : '') + (p.ban.by ? '<span>Выдал: ' + esc(p.ban.by) + '</span>' : '') + '</div>';
    }
    if (p.accBanned) al += '<div class="tkp-al red"><b>Аккаунт заблокирован</b><span>В лаунчер войти не может.</span></div>';
    if (p.mutedUntil && p.mutedUntil > now) al += '<div class="tkp-al gold"><b>Мут до ' + esc(T.stamp(p.mutedUntil)) + '</b>' +
      '<span>Еще ' + esc(left(p.mutedUntil - now)) + '</span></div>';
    if (al) h += '<div class="tkp-als">' + al + '</div>';

    /* факты */
    h += '<dl class="tkp-facts">';
    h += fact('Держава', p.country ? (cc ? '<i class="tkp-dot" style="background:' + cc + '"></i>' : '') + esc(p.country) : 'без державы',
      p.country ? esc(p.countryRank || '') : '');
    h += fact('Город', p.town ? esc(p.town) : 'не в городе',
      p.town ? esc([p.townRank, p.province ? 'провинция ' + p.province : ''].filter(Boolean).join(' · ')) : '');
    h += fact('Привилегия', p.privilege ? esc(p.privilege) : 'нет',
      p.privilege ? (p.privUntil ? 'до ' + esc(T.stamp(p.privUntil)) : 'бессрочно') : '');
    h += fact('Наиграно', esc(p.playtimeText || '—'));
    h += fact('Последний вход', p.online ? 'сейчас в игре' : p.seen ? esc(T.stamp(p.seen)) : '—',
      !p.online && p.seen ? esc(A.ago(p.seen)) : '');
    h += fact('Аккаунт', p.created ? 'с ' + esc(T.stamp(p.created)) : '—', p.via ? esc(p.via) : '');
    h += fact('Червонцы', esc(String(p.coins || 0)) + ' Ч');
    h += fact('Убийства / смерти', esc(String(p.kills || 0)) + ' / ' + esc(String(p.deaths || 0)));
    if (p.discord || p.telegram) {
      h += fact('Связь', esc([p.discord ? 'Discord: ' + p.discord : '', p.telegram ? 'Telegram: ' + p.telegram : '']
        .filter(Boolean).join(' · ')));
    }
    h += '</dl>';

    /* где был */
    h += '<h3 class="tkp-h">Где ' + (p.online ? 'сейчас' : 'был в последний раз') + '</h3>';
    if (p.pos) {
      var q = p.pos, dim = q.dim || 'minecraft:overworld';
      var xyz = q.x + ' ' + q.y + ' ' + q.z;
      var tp = dim === 'minecraft:overworld' ? '/tp @s ' + xyz : '/execute in ' + dim + ' run tp @s ' + xyz;
      h += '<div class="tkp-pos"><div><b class="tkp-xyz">' + esc(xyz) + '</b>' +
        '<span>' + esc([DIM[dim] || dim, q.country ? q.country + (q.province ? ', ' + q.province : '') : 'ничья земля или море',
          MODE[q.mode] ? 'режим: ' + MODE[q.mode] : ''].filter(Boolean).join(' · ')) + '</span>' +
        '<span>' + (p.online ? 'данные на сейчас' : 'при выходе, ' + esc(T.stamp(q.at))) + '</span></div>' +
        '<button type="button" class="btn btn-dark btn-sm" data-copy="' + esc(tp) + '">Скопировать /tp</button></div>';
    } else if (p.posHidden) {
      h += '<p class="tkp-none">Скрыто: игрок старше вас по должности.</p>';
    } else {
      h += '<p class="tkp-none">Нет данных — игрок еще не заходил в мир.</p>';
    }

    /* наказания */
    var cs = p.cases || {}, cn = cs.count || {}, items = cs.items || [];
    h += '<h3 class="tkp-h">Наказания' + (cn.total ? '<span class="tkd-sec-n">' + esc(cn.total) + '</span>' : '') + '</h3>';
    if (!cn.total) {
      h += '<p class="tkp-none tkp-clean">Чисто: ни предупреждений, ни мутов, ни банов.</p>';
    } else {
      var chips = [['warn', 'предупр.'], ['mute', 'мутов'], ['ban', 'банов'], ['kick', 'киков']].filter(function (k) {
        return cn[k[0]];
      }).map(function (k) {
        return '<span class="tkp-chip ' + KIND[k[0]][1] + '"><b>' + esc(cn[k[0]]) + '</b> ' + k[1] + '</span>';
      });
      if (cn.auto) chips.push('<span class="tkp-chip"><b>' + esc(cn.auto) + '</b> от автомода</span>');
      h += '<div class="tkp-chips">' + chips.join('') + '</div><ol class="tkp-cases">' + items.map(function (c) {
        var k = KIND[c.kind] || [c.kind || '?', ''], auto = c.by === 'автомод';
        var live = (c.kind === 'mute' || (c.kind === 'ban' && p.ban)) && c.until && c.until > now;
        // срок как в команде: 45 мин, 12 ч, 3 дн, 2 нед (баны на срок с 03.10.2026)
        var span = !c.min ? '' : c.min % 10080 === 0 ? c.min / 10080 + ' нед' : c.min % 1440 === 0 ? c.min / 1440 + ' дн' :
          c.min % 60 === 0 ? c.min / 60 + ' ч' : c.min + ' мин';
        return '<li><span class="pill ' + k[1] + '">' + esc(k[0]) + (span ? ' ' + esc(span) : '') + '</span><div>' +
          '<div class="tkp-c1">' + esc(c.why || (c.kind === 'unmute' ? 'мут снят' : c.kind === 'unban' ? 'бан снят' : 'причина не указана')) +
          (live ? ' <span class="pill red">действует</span>' : '') + '</div>' +
          (c.what ? '<div class="tkp-c2">' + (auto ? 'Сработало на: <b>' + esc(c.what) + '</b>' : esc(c.what)) +
            (c.where ? ' · ' + esc(c.where) : '') + '</div>' : '') +
          (c.text ? '<blockquote class="tkp-q">' + esc(c.text) + '</blockquote>' : '') +
          '<div class="tkp-c3">' + esc(auto ? 'автомод' : (c.by || '?')) + ' · ' + esc(T.stamp(c.t)) +
          (c.src === 'лог' ? ' · из журнала сервера' : '') + '</div></div></li>';
      }).join('') + '</ol>';
      if (cn.total > items.length) h += '<p class="tkp-none">Показаны последние ' + items.length + ' из ' + esc(cn.total) + '.</p>';
    }

    /* обращения */
    var tk = r.tickets || [];
    h += '<h3 class="tkp-h">Обращения' + (r.ticketsAll ? '<span class="tkd-sec-n">' + esc(r.ticketsAll) + '</span>' : '') + '</h3>';
    h += tk.length ? '<div class="row-list">' + tk.map(row).join('') + '</div>' +
      (r.ticketsAll > tk.length ? '<p class="tkp-none">Показаны последние ' + tk.length + '.</p>' : '')
      : '<p class="tkp-none">Обращений, которые вам видны, нет.</p>';
    return h;
  }

  function left(ms) {
    var m = Math.ceil(ms / 60000);
    if (m < 60) return m + ' мин';
    var hh = Math.floor(m / 60);
    return hh < 48 ? hh + ' ч ' + (m % 60) + ' мин' : Math.floor(hh / 24) + ' дн.';
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-player]');
    if (!b) return;
    e.preventDefault();
    playerOpen(b.getAttribute('data-player'));
  });

  /* ------------------------------------------------------------ выдача предметов */

  /* Овнер 28.09.2026: «панель на сайте для поиска и выдачи предметов, оформи хорошо»,
     «выдавать может только высшая администрация». Вещи уходят письмом /mail: игрок
     забирает сам, пока не забрал — выдачу можно отозвать. Все пишется в журнал. */
  var GIVE = { item: null, nick: '', no: '', why: '', q: '', cart: [], run: false };
  var ICONS = null;
  var GIVE_MAX = 2304;
  var GV_ITEMS = [];
  var GV_T = 0;
  /* Овнер 28.09.2026: «набрать пачку предметов и потом выдать, а не по одному виду». Служба
     принимает один предмет за вызов (одно письмо) и не больше 20 вызовов в минуту на человека —
     пачка уходит по очереди; уперлись в лимит — ждем минуту и продолжаем сами. */
  var CART_MAX = 60;

  function iconsLoad() {
    if (ICONS) return Promise.resolve(ICONS);
    return fetch('assets/items/icons.json?v=0928').then(function (r) { return r.json(); }).then(
      function (j) { ICONS = j; return j; },
      function () { ICONS = { cell: 16, cols: 64, ids: {} }; return ICONS; });
  }

  function ico(id, name, big) {
    var n = ICONS && ICONS.ids ? ICONS.ids[id] : undefined;
    var cls = 'gv-ico' + (big ? ' big' : '');
    if (n === undefined) {
      return '<span class="' + cls + ' none" aria-hidden="true">' +
        esc(String(name || id || '?').charAt(0).toUpperCase()) + '</span>';
    }
    var s = big ? 3 : 2, c = ICONS.cell || 16, cols = ICONS.cols || 64;
    return '<span class="' + cls + '" aria-hidden="true" style="background-position:-' + (n % cols) * c * s +
      'px -' + Math.floor(n / cols) * c * s + 'px;background-size:' + cols * c * s + 'px auto"></span>';
  }

  function drawGive() {
    var box = document.getElementById('tkdTeam');
    iconsLoad().then(function () {
      var h = '<div class="gv"><div class="gv-l">' +
        '<form class="gv-find" id="gvF" role="search"><input id="gvQ" type="search" autocomplete="off" ' +
        'aria-label="Поиск предмета" placeholder="Предмет по-русски, по-английски или id: «железный слиток», «cogwheel»" value="' +
        esc(GIVE.q) + '"><span class="gv-n" id="gvN" role="status"></span></form>' +
        '<div class="gv-grid" id="gvGrid"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div></div>';
      h += '<form class="gv-card" id="gvSend" novalidate><h3 class="gv-h">Письмо игроку</h3>' +
        '<div class="gv-pick" id="gvPick"></div>' +
        '<label class="gv-f"><span>Игрок</span><input id="gvNick" maxlength="16" autocomplete="off" ' +
        'spellcheck="false" placeholder="Ник в игре" value="' + esc(GIVE.nick) + '"></label>' +
        '<div class="gv-f"><label for="gvCnt">Сколько</label><input id="gvCnt" type="number" min="1" max="' +
        GIVE_MAX + '" value="1"><div class="gv-q" id="gvQuick"></div></div>' +
        '<button type="button" class="btn btn-dark gv-add" id="gvAdd" disabled>+ В пачку</button>' +
        '<div class="gv-cart" id="gvCart"></div>' +
        '<label class="gv-f"><span>Обращение №<small>если выдаете по нему</small></span><input id="gvNo" ' +
        'inputmode="numeric" maxlength="7" autocomplete="off" placeholder="—" value="' + esc(GIVE.no) + '"></label>' +
        '<label class="gv-f"><span>Причина<small>игрок увидит ее в письме</small></span><textarea id="gvWhy" rows="2" ' +
        'maxlength="200" placeholder="Например: вещи пропали после отката 27.09">' + esc(GIVE.why) + '</textarea></label>' +
        '<button class="btn btn-primary" type="submit" id="gvGo">Отправить письмом</button>' +
        '<p class="gv-say" id="gvSay" role="status"></p>' +
        '<p class="gv-note">Игрок заберет вещи в игре командой <b>/mail</b> — письмо ждет, пока его не заберут. ' +
        'Пока не забрано, выдачу можно отозвать. Каждая выдача попадает в журнал ниже и в недельный отчет. ' +
        'Пачка: выберите предмет и «+ В пачку» (или двойной щелчок по нему), потом отправьте все разом — ' +
        'по письму на вид; больше 20 видов — остальное досылается через минуту само. ' +
        'Служебные и творческие предметы здесь не выдаются.</p></form></div>';
      h += '<div class="gv-lh"><h3 class="tk-h3">Журнал выдач</h3><button type="button" class="btn btn-dark btn-sm" ' +
        'id="gvRe">Обновить</button></div><div id="gvLog"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>';
      box.innerHTML = h;
      bindGive();
      pickView();
      cartView();
      giveSearch();
      giveLog();
    });
  }

  function pickView() {
    var p = document.getElementById('gvPick');
    if (!p) return;
    var it = GIVE.item;
    document.getElementById('gvAdd').disabled = !it || GIVE.run;
    if (!it) {
      p.className = 'gv-pick empty';
      p.innerHTML = 'Выберите предмет слева';
      document.getElementById('gvQuick').innerHTML = '';
      return;
    }
    p.className = 'gv-pick';
    p.innerHTML = ico(it.id, it.name, true) + '<div><b>' + esc(it.name) + '</b><small>' + esc(it.id) +
      ' · стак ' + esc(it.stack) + '</small></div>';
    var st = it.stack || 64, q = st >= 64 ? [1, 16, 32, 64, 128, 576] : st > 1 ? [1, st / 2, st, st * 2, st * 9] : [1, 2, 3, 5];
    document.getElementById('gvQuick').innerHTML = q.filter(function (n) { return n >= 1 && n <= GIVE_MAX; })
      .map(function (n) {
        var t = n >= st && st > 1 && n % st === 0 ? (n / st === 1 ? 'стак' : n / st + ' стаков') : String(n);
        if (n / st === 2 || n / st === 3 || n / st === 4) t = n / st + ' стака';
        return '<button type="button" data-n="' + n + '">' + esc(t) + '</button>';
      }).join('');
  }

  function vid(n) {
    var a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? 'вид' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'вида' : 'видов';
  }

  function gvSay(cls, text) {
    var s = document.getElementById('gvSay');
    if (s) { s.className = 'gv-say' + (cls ? ' ' + cls : ''); s.textContent = text; }
  }

  /* Пачка: строка = вид предмета = одно письмо. Пока пачка уходит, ее не правят. */
  function cartView() {
    var box = document.getElementById('gvCart'), go = document.getElementById('gvGo');
    if (!box) return;
    var c = GIVE.cart, run = GIVE.run;
    go.disabled = false;
    go.textContent = run ? 'Остановить' : c.length ? 'Отправить пачку · ' + c.length + ' ' + vid(c.length) : 'Отправить письмом';
    go.classList.toggle('gv-stop', run);
    if (!c.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var dis = run ? ' disabled' : '';
    box.innerHTML = '<div class="gv-ch"><b>Пачка</b><span>' + c.length + ' ' + vid(c.length) + '</span>' +
      (run ? '' : '<button type="button" class="gv-clr" data-clr="1">Очистить</button>') + '</div>' +
      c.map(function (x, i) {
        return '<div class="gv-cr' + (x.st ? ' ' + x.st : '') + '">' + ico(x.id, x.name) +
          '<span class="gv-cn"><b>' + esc(x.name) + '</b><small>' + esc(x.msg || x.id) + '</small></span>' +
          '<input type="number" min="1" max="' + GIVE_MAX + '" value="' + esc(x.count) + '" data-c="' + i +
          '" aria-label="Сколько: ' + esc(x.name) + '"' + dis + '>' +
          '<button type="button" class="gv-x" data-x="' + i + '" aria-label="Убрать: ' + esc(x.name) + '"' + dis +
          '>×</button></div>';
      }).join('');
  }

  function sendCart(nick, no, why, who) {
    var list = GIVE.cart.map(function (x) { return x.count + ' × ' + x.name; });
    if (!confirm('Отправить игроку ' + who + ' пачку — ' + list.length + ' ' + vid(list.length) + ':\n\n' +
      list.join('\n') + '\n\nКаждый вид уйдет отдельным письмом.')) return;
    var total = GIVE.cart.length, sent = 0, skip = 0, to = '';
    GIVE.run = true;
    GIVE.stop = false;
    GIVE.cart.forEach(function (x) { x.st = ''; x.msg = ''; });
    cartView();
    pickView();
    function end(cls, text) {
      GIVE.run = false;
      GIVE.stop = false;
      cartView();
      pickView();
      gvSay(cls, text);
      giveLog();
    }
    function next() {
      var x = GIVE.cart.filter(function (y) { return !y.st; })[0];
      if (!x) {
        return end(skip ? 'bad' : 'ok', 'Отправлено ' + sent + ' из ' + total + ' → ' + (to || who) + '. ' +
          (skip ? 'Не ушло: ' + skip + ' — причина в строке пачки.' : 'Письма ждут игрока в /mail.'));
      }
      if (GIVE.stop) return end('bad', 'Остановлено: отправлено ' + sent + ' из ' + total + '. Неотправленное осталось в пачке.');
      x.st = 'send';
      x.msg = 'отправляю…';
      cartView();
      gvSay('', 'Отправляю ' + (sent + skip + 1) + ' из ' + total + '…');
      A.call('/adm/give', { body: { nick: nick, item: x.id, count: x.count, reason: why, ticket: no ? +no : 0 } }).then(function (r) {
        sent++;
        to = (r.given || {}).nick || to;
        GIVE.cart.splice(GIVE.cart.indexOf(x), 1);
        setTimeout(next, 250);
      }, function (err) {
        if (err && err.code === 'auth') { GIVE.run = false; x.st = ''; drawLogin(); return; }
        if (err && err.code === 'too_often') {
          x.st = '';
          x.msg = '';
          cartView();
          var left = 61;
          (function tick() {
            if (GIVE.stop) return next();
            if (left <= 0) return next();
            gvSay('', 'Служба пускает 20 писем в минуту. Отправлено ' + sent + ' из ' + total +
              ', продолжу через ' + left + ' с…');
            left--;
            setTimeout(tick, 1000);
          })();
          return;
        }
        x.st = 'err';
        x.msg = A.textOf(err);
        if (err && err.code === 'bad_item') { skip++; cartView(); setTimeout(next, 250); return; }
        if (err && err.code === 'busy') x.msg = 'Не ясно, ушло ли, — сверьтесь с журналом выдач, прежде чем слать снова.';
        end('bad', 'Остановлено на «' + x.name + '»: ' + A.textOf(err) + ' Отправлено ' + sent + ' из ' + total +
          ', остальное в пачке.');
      });
    }
    next();
  }

  function giveSearch() {
    var grid = document.getElementById('gvGrid'), cnt = document.getElementById('gvN');
    if (!grid) return;
    var q = GIVE.q;
    A.call('/adm/items?q=' + encodeURIComponent(q)).then(function (r) {
      if (q !== GIVE.q) return;
      GIVE_MAX = r.max || GIVE_MAX;
      GV_ITEMS = r.items || [];
      cnt.textContent = !q ? 'Начните вводить название — ниже первые предметы по порядку игры.' :
        !r.total ? '' : r.total > GV_ITEMS.length ? 'Найдено ' + r.total + ', показаны первые ' + GV_ITEMS.length +
        ' — уточните запрос.' : 'Найдено: ' + r.total;
      if (!GV_ITEMS.length) {
        grid.innerHTML = '<p class="gv-empty">Ничего не нашлось. Попробуйте другое слово или id из игры (F3+H).</p>';
        return;
      }
      grid.innerHTML = GV_ITEMS.map(function (x, i) {
        var on = GIVE.item && GIVE.item.id === x.id;
        return '<button type="button" class="gv-it' + (on ? ' on' : '') + '" data-i="' + i + '" aria-pressed="' + on +
          '" title="' + esc(x.en ? x.name + ' · ' + x.en : x.name) + '">' + ico(x.id, x.name) +
          '<span><b>' + esc(x.name) + '</b><small>' + esc(x.id) + '</small></span></button>';
      }).join('');
    }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      grid.innerHTML = '<p class="gv-empty">' + esc(A.textOf(err)) + '</p>';
    });
  }

  function giveLog() {
    var box = document.getElementById('gvLog');
    if (!box) return;
    A.call('/adm/give/log').then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { box.innerHTML = '<p class="gv-empty">Выдач пока не было.</p>'; return; }
      var ST = { wait: ['ждет игрока', 'wait'], given: ['забрано', 'given'], revoked: ['отозвано', 'revoked'] };
      box.innerHTML = '<div class="row-list">' + rows.map(function (x) {
        var s = x.revokedAt ? ST.revoked : ST[x.state] || ST.wait;
        return '<div class="row gv-row">' + ico(x.item, x.name) + '<div><div class="rw-t"><b>' + esc(x.count) + ' × ' +
          esc(x.name || x.item) + '</b> → ' + esc(x.nick) + '</div><div class="rw-s">' + esc(x.by) + ' · ' +
          esc(T.stamp(x.at)) + (x.no ? ' · <a href="#t=' + esc(x.no) + '">обращение №' + esc(x.no) + '</a>' : '') +
          (x.reason ? ' · ' + esc(x.reason) : '') + (x.revokedBy ? ' · отозвал ' + esc(x.revokedBy) : '') +
          '</div></div><div class="rw-r"><span class="gv-st ' + s[1] + '">' + s[0] + '</span>' +
          (!x.revokedAt && x.state !== 'given' ? '<button type="button" class="btn btn-dark btn-sm" data-rev="' +
            esc(x.letter) + '" data-what="' + esc(x.count + ' × ' + (x.name || x.item) + ' → ' + x.nick) +
            '">Отозвать</button>' : '') + '</div></div>';
      }).join('') + '</div>';
      box.querySelectorAll('[data-rev]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Отозвать выдачу ' + b.getAttribute('data-what') + '? Письмо пропадет у игрока.')) return;
          b.disabled = true;
          A.call('/adm/give', { body: { revoke: b.getAttribute('data-rev') } }).then(giveLog, function (err) {
            b.disabled = false;
            alert(A.textOf(err));
          });
        });
      });
    }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      box.innerHTML = '<p class="gv-empty">' + esc(A.textOf(err)) + '</p>';
    });
  }

  function bindGive() {
    var q = document.getElementById('gvQ');
    document.getElementById('gvF').addEventListener('submit', function (e) { e.preventDefault(); });
    q.addEventListener('input', function () {
      clearTimeout(GV_T);
      GV_T = setTimeout(function () { GIVE.q = q.value.trim(); giveSearch(); }, 250);
    });
    document.getElementById('gvGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      GIVE.item = GV_ITEMS[+b.getAttribute('data-i')];
      document.querySelectorAll('.gv-it.on').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('on');
      b.setAttribute('aria-pressed', 'true');
      pickView();
      if (e.detail === 2) { document.getElementById('gvAdd').click(); return; }
      if (window.innerWidth <= 900) document.getElementById('gvSend').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('gvQuick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-n]');
      if (b) document.getElementById('gvCnt').value = b.getAttribute('data-n');
    });
    document.getElementById('gvCnt').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && GIVE.item && !GIVE.run) { e.preventDefault(); document.getElementById('gvAdd').click(); }
    });
    document.getElementById('gvAdd').addEventListener('click', function () {
      var it = GIVE.item, n = parseInt(document.getElementById('gvCnt').value, 10);
      if (!it || GIVE.run) return;
      if (!(n >= 1 && n <= GIVE_MAX)) { gvSay('bad', 'Сколько — от 1 до ' + GIVE_MAX + '.'); return; }
      var had = GIVE.cart.filter(function (x) { return x.id === it.id; })[0];
      if (!had && GIVE.cart.length >= CART_MAX) {
        gvSay('bad', 'В пачке уже ' + CART_MAX + ' видов — отправьте ее, потом наберите следующую.');
        return;
      }
      if (had) { had.count = Math.min(GIVE_MAX, had.count + n); had.st = ''; had.msg = ''; }
      else GIVE.cart.push({ id: it.id, name: it.name, count: n });
      gvSay('', had ? it.name + ' в пачке: теперь ' + had.count + '.' : 'В пачку: ' + n + ' × ' + it.name + '.');
      document.getElementById('gvCnt').value = 1;
      cartView();
    });
    var cart = document.getElementById('gvCart');
    cart.addEventListener('click', function (e) {
      if (GIVE.run) return;
      var x = e.target.closest('[data-x]');
      if (x) { GIVE.cart.splice(+x.getAttribute('data-x'), 1); cartView(); return; }
      if (e.target.closest('[data-clr]') && confirm('Очистить пачку?')) { GIVE.cart = []; cartView(); gvSay('', ''); }
    });
    cart.addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-c');
      if (i === null || !GIVE.cart[+i]) return;
      var n = parseInt(e.target.value, 10), ok = n >= 1 && n <= GIVE_MAX;
      e.target.classList.toggle('bad', !ok);
      if (ok) GIVE.cart[+i].count = n;
    });
    ['gvNick', 'gvNo', 'gvWhy'].forEach(function (id, i) {
      document.getElementById(id).addEventListener('input', function () {
        GIVE[['nick', 'no', 'why'][i]] = this.value;
      });
    });
    document.getElementById('gvRe').addEventListener('click', giveLog);
    document.getElementById('gvSend').addEventListener('submit', function (e) {
      e.preventDefault();
      if (GIVE.run) { GIVE.stop = true; gvSay('', 'Останавливаю после текущего письма…'); return; }
      var say = document.getElementById('gvSay'), go = document.getElementById('gvGo');
      var nick = document.getElementById('gvNick').value.trim();
      var no = document.getElementById('gvNo').value.trim().replace(/^№/, '');
      var why = document.getElementById('gvWhy').value.trim();
      var n = parseInt(document.getElementById('gvCnt').value, 10);
      var pack = GIVE.cart.length > 0;
      say.className = 'gv-say';
      var bad = !pack && !GIVE.item ? 'Выберите предмет или наберите пачку.' :
        !no && !/^[A-Za-z0-9_]{3,16}$/.test(nick) ? 'Впишите ник игрока (или номер обращения).' :
        no && !/^\d{1,7}$/.test(no) ? 'Номер обращения — только цифры.' :
        pack && cart.querySelector('input.bad') ? 'В пачке неверное количество — от 1 до ' + GIVE_MAX + '.' :
        !pack && !(n >= 1 && n <= GIVE_MAX) ? 'Сколько — от 1 до ' + GIVE_MAX + '.' :
        !no && why.length < 5 ? 'Напишите причину — она попадет в письмо и в журнал.' : '';
      if (bad) { say.className = 'gv-say bad'; say.textContent = bad; return; }
      var who = nick || 'автору обращения №' + no;
      if (pack) { sendCart(nick, no, why, who); return; }
      if (!confirm('Отправить ' + n + ' × ' + GIVE.item.name + ' игроку ' + who + '?')) return;
      go.disabled = true;
      say.textContent = 'Отправляю…';
      A.call('/adm/give', { body: { nick: nick, item: GIVE.item.id, count: n, reason: why, ticket: no ? +no : 0 } }).then(function (r) {
        go.disabled = false;
        var g = r.given || {};
        say.className = 'gv-say ok';
        say.textContent = 'Отправлено: ' + n + ' × ' + GIVE.item.name + ' → ' + (g.nick || who) + '. Письмо ждет игрока в /mail.';
        document.getElementById('gvCnt').value = 1;
        giveLog();
      }, function (err) {
        go.disabled = false;
        if (err && err.code === 'auth') { drawLogin(); return; }
        say.className = 'gv-say bad';
        say.textContent = A.textOf(err);
      });
    });
  }

  /* ------------------------------------------------------------ смена ника */

  /* Овнер 11.10.2026: «с должности "Администратор" и выше менять игроку ник через сайт и
     внутри сервера через команду». Номер игрока остается прежним — вещи, кошелек, держава и
     должность на месте; старое имя закрывается для всех остальных. */
  var NICK = { from: '', to: '', why: '' };

  function nkSay(cls, text) {
    var s = document.getElementById('nkSay');
    if (s) { s.className = 'gv-say' + (cls ? ' ' + cls : ''); s.textContent = text; }
  }

  function drawNick() {
    var box = document.getElementById('tkdTeam');
    box.innerHTML = '<form class="gv-card sb-card nk-card" id="nkF" novalidate><h3 class="gv-h">Смена ника</h3>' +
      '<div class="nk-two"><label class="gv-f"><span>Сейчас</span><input id="nkFrom" maxlength="16" autocomplete="off" ' +
      'spellcheck="false" placeholder="Нынешний ник" value="' + esc(NICK.from) + '"></label>' +
      '<label class="gv-f"><span>Станет</span><input id="nkTo" maxlength="16" autocomplete="off" ' +
      'spellcheck="false" placeholder="Новый ник" value="' + esc(NICK.to) + '"></label></div>' +
      '<label class="gv-f"><span>Причина<small>попадет в журнал</small></span><textarea id="nkWhy" rows="2" ' +
      'maxlength="200" placeholder="Например: обращение №123, ошибся в нике при регистрации">' + esc(NICK.why) +
      '</textarea></label>' +
      '<button class="btn btn-primary" type="submit" id="nkGo">Сменить ник</button>' +
      '<p class="gv-say" id="nkSay" role="status"></p>' +
      '<p class="gv-note">Номер игрока остается прежним: вещи, кошелек, держава, должность и техника на месте, ' +
      'пароль и привязка к Discord — тоже. На новое имя переезжают учетка, скин и обращения. Если игрок в игре — ' +
      'его выведет, зайти надо под новым именем. Старое имя закрывается: другой игрок занять его не сможет. ' +
      'Ник основателя и тех, кто выше вас по должности, здесь не меняется. В игре то же самое делает команда ' +
      '<b>/aegis ник &lt;старый&gt; &lt;новый&gt; [причина]</b>.</p></form>' +
      '<div class="gv-lh"><h3 class="tk-h3">Журнал смен</h3><button type="button" class="btn btn-dark btn-sm" ' +
      'id="nkRe">Обновить</button></div><div id="nkLog"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>';
    ['nkFrom', 'nkTo', 'nkWhy'].forEach(function (id, i) {
      document.getElementById(id).addEventListener('input', function () {
        NICK[['from', 'to', 'why'][i]] = this.value;
      });
    });
    document.getElementById('nkRe').addEventListener('click', nickLog);
    document.getElementById('nkF').addEventListener('submit', function (e) {
      e.preventDefault();
      var go = document.getElementById('nkGo');
      var from = document.getElementById('nkFrom').value.trim(), to = document.getElementById('nkTo').value.trim();
      var why = document.getElementById('nkWhy').value.trim(), rx = /^[A-Za-z0-9_]{3,16}$/;
      var bad = !rx.test(from) ? 'Впишите нынешний ник игрока — 3-16 латинских букв, цифр и «_».' :
        !rx.test(to) ? 'Новый ник — 3-16 латинских букв, цифр и «_».' :
        from === to ? 'Ник не меняется — впишите другое имя.' :
        why.length < 3 ? 'Напишите причину — она попадет в журнал.' : '';
      if (bad) { nkSay('bad', bad); return; }
      if (!confirm('Сменить ник ' + from + ' → ' + to + '?\n\nСтарое имя закроется, игрока выведет из игры.')) return;
      go.disabled = true;
      nkSay('', 'Меняю…');
      A.call('/adm/rename', { body: { from: from, to: to, reason: why } }).then(function (r) {
        go.disabled = false;
        NICK = { from: '', to: '', why: '' };
        ['nkFrom', 'nkTo', 'nkWhy'].forEach(function (id) { document.getElementById(id).value = ''; });
        nkSay('ok', r.text || 'Ник сменен.');
        nickLog();
      }, function (err) {
        go.disabled = false;
        if (err && err.code === 'auth') { drawLogin(); return; }
        nkSay('bad', A.textOf(err));
      });
    });
    nickLog();
  }

  function nickLog() {
    var box = document.getElementById('nkLog');
    if (!box) return;
    A.call('/adm/rename/log').then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { box.innerHTML = '<p class="gv-empty">Ников пока не меняли.</p>'; return; }
      box.innerHTML = '<div class="row-list">' + rows.map(function (x) {
        return '<div class="row gv-row"><span class="gv-ico none" aria-hidden="true">↻</span><div><div class="rw-t"><b>' +
          esc(x.from) + '</b> → <b>' + esc(x.to) + '</b></div><div class="rw-s">' + esc(x.by || '—') + ' · ' +
          esc(T.stamp(x.at)) + (x.why ? ' · ' + esc(x.why) : '') + '</div></div><div class="rw-r"></div></div>';
      }).join('') + '</div>';
    }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      box.innerHTML = '<p class="gv-empty">' + esc(A.textOf(err)) + '</p>';
    });
  }

  /* ------------------------------------------------------------ учет техники */

  /* Овнер 02.10.2026: каждая физическая постройка Sable — в учете; по тикету высшая администрация
     возвращает ее ресурсами (письмами) или целиком (достает посохом в игре). Прежняя копия
     постройки при этом убирается из мира, повторно по одной постройке не выдают. */
  var SBL = { q: '', id: 0 };

  function sblItem(id) { return String(id || '').replace(/^minecraft:/, ''); }

  /* 1 запись, 2 записи, 5 записей */
  function sblN(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many);
  }

  function sblState(x) {
    var c = { live: 'given', unloaded: 'wait', gone: 'revoked', disassembled: 'revoked', recalled: 'wait' }[x.state] || 'wait';
    return '<span class="gv-st ' + c + '">' + esc(x.stateRu || x.state) + '</span>';
  }

  function drawSable() {
    var box = document.getElementById('tkdTeam');
    var h = '<form class="tkd-bar" id="sbF" role="search"><input class="tkd-q" id="sbQ" type="search" ' +
      'placeholder="Номер техники, ник хозяина или того, кто ломал, имя, «пропала»" value="' + esc(SBL.q) + '">' +
      '<button class="btn btn-dark btn-sm" type="submit">Найти</button></form>' +
      '<p class="tkd-sum" id="sbSum"></p><div id="sbCard"></div>' +
      '<div id="sbList"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>';
    box.innerHTML = h;
    document.getElementById('sbF').addEventListener('submit', function (e) {
      e.preventDefault();
      SBL.q = document.getElementById('sbQ').value.trim();
      sblList();
    });
    sblList();
    if (SBL.id) sblCard(SBL.id);
  }

  function sblList() {
    var box = document.getElementById('sbList');
    if (!box) return;
    A.call('/adm/sable?limit=150&q=' + encodeURIComponent(SBL.q)).then(function (r) {
      var rows = r.list || [];
      document.getElementById('sbSum').textContent = 'В учете ' + sblN(r.all || 0, 'запись', 'записи', 'записей') +
        (SBL.q ? ', найдено ' + (r.total || 0) : '') + (r.waiting ? ', ждут выдачи посохом: ' + r.waiting : '') + '.';
      if (!rows.length) { box.innerHTML = '<p class="gv-empty">Ничего не нашлось.</p>'; return; }
      box.innerHTML = '<div class="row-list">' + rows.map(function (x) {
        var tag = x.restoredAt ? ' · <b>выдана ' + esc(x.restoredMode) + '</b>' : x.waitFor ? ' · <b>ждет посоха</b>' : '';
        return '<div class="row gv-row" data-sb="' + esc(x.id) + '" role="button" tabindex="0"><div><div class="rw-t"><b>№' +
          esc(x.id) + '</b>' + (x.root !== x.id ? ' <small>часть №' + esc(x.root) + '</small>' : '') +
          (x.name ? ' «' + esc(x.name) + '»' : '') + ' — ' + esc(x.owner || 'хозяин неизвестен') + (x.guess ? '?' : '') +
          '</div><div class="rw-s">' + esc(x.blocks) + ' бл. · слепков ' + esc(x.vers) + ' · замечена ' + esc(T.stamp(x.born)) +
          (x.goneAt ? ' · пропала ' + esc(T.stamp(x.goneAt)) : '') + tag + (x.flag ? ' · <i>' + esc(x.flag) + '</i>' : '') +
          '</div></div><div class="rw-r">' + sblState(x) + '</div></div>';
      }).join('') + '</div>';
      box.querySelectorAll('[data-sb]').forEach(function (b) {
        var go = function () { sblCard(+b.getAttribute('data-sb')); };
        b.addEventListener('click', go);
        b.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      });
    }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      box.innerHTML = '<p class="gv-empty">' + esc(A.textOf(err)) + '</p>';
    });
  }

  function sblCard(id) {
    var box = document.getElementById('sbCard');
    if (!box) return;
    SBL.id = id;
    box.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    A.call('/adm/sable/one?id=' + encodeURIComponent(id)).then(function (x) {
      var h = '<div class="gv-card sb-card"><div class="gv-lh"><h3 class="tk-h3">Техника №' + esc(x.id) +
        (x.name ? ' «' + esc(x.name) + '»' : '') + '</h3><button type="button" class="btn btn-dark btn-sm" id="sbClose">' +
        'Закрыть</button></div>';
      var li = [];
      li.push('Хозяин: <b>' + esc(x.owner || 'неизвестен') + '</b>' + (x.guess ? ' (догадка: ближайший игрок при сборке)' : ''));
      li.push('Состояние: ' + sblState(x) + ' · ' + esc(x.blocks) + ' бл. · ' + esc(x.dim) + ' ' + esc(x.x) + ' ' + esc(x.y) + ' ' + esc(x.z));
      li.push('Замечена ' + esc(T.stamp(x.born)) + ', последний раз ' + esc(T.stamp(x.seen)) +
        (x.goneAt ? ', пропала ' + esc(T.stamp(x.goneAt)) : ''));
      if (x.why) li.push('Почему пропала: ' + esc(x.why));
      if (x.near && x.near.length) li.push('Рядом были: ' + x.near.map(esc).join(', '));
      var hand = Object.keys(x.hand || {});
      if (hand.length) li.push('Ломали руками: ' + hand.map(function (k) { return esc(k) + ' ' + esc(x.hand[k]); }).join(', '));
      if (x.flag) li.push('<b>' + esc(x.flag) + '</b>');
      if (x.origin) li.push('Произошла от №' + esc(x.origin));
      if (x.family && x.family.length > 1) {
        li.push('Семья (одна постройка, раскололась): ' + x.family.map(function (f) {
          return '<a href="#" data-sb="' + esc(f.id) + '">№' + esc(f.id) + '</a> ' + esc(f.state) + ', ' + esc(f.blocks) + ' бл.';
        }).join('; '));
      }
      if (x.restoredAt) {
        li.push('<b>Выдана ' + esc(T.stamp(x.restoredAt)) + '</b>: ' + esc(x.restoredMode) + ', ' + esc(x.restoredBy) + ' → ' +
          esc(x.restoredNick) + (x.restoredTo ? ', теперь №' + esc(x.restoredTo) : '') +
          (x.restoredTicket ? ', <a href="#t=' + esc(x.restoredTicket) + '">обращение №' + esc(x.restoredTicket) + '</a>' : ''));
      }
      if (x.waitFor) {
        li.push('<b>Ждет выдачи целиком</b> с ' + esc(T.stamp(x.waitAt)) + ': достает ' + esc(x.waitFor) + ' посохом физики ' +
          '(Shift+ПКМ или дважды Shift), получатель ' + esc(x.waitNick) + (x.waitReason ? ' · ' + esc(x.waitReason) : ''));
      }
      h += '<div class="rw-s sb-li">' + li.map(function (s) { return '<p>' + s + '</p>'; }).join('') + '</div>';
      var vs = x.versions || [];
      h += '<h3 class="tk-h3">Слепки</h3>';
      if (!vs.length) h += '<p class="gv-empty">Слепков нет — восстановить эту часть нечем.</p>';
      else {
        h += '<div class="row-list">' + vs.map(function (v) {
          var top = Object.keys(v.items || {}).sort(function (a, b) { return v.items[b] - v.items[a]; });
          return '<div class="row gv-row"><div><div class="rw-t"><b>#' + esc(v.seq) + '</b> · ' + esc(T.stamp(v.at)) + ' · ' +
            esc(v.blocks) + ' бл.</div><div class="rw-s">' + top.slice(0, 8).map(function (k) {
              return esc(sblItem(k)) + ' ' + esc(v.items[k]);
            }).join(', ') + (top.length > 8 ? ' и еще ' + sblN(top.length - 8, 'вид', 'вида', 'видов') : '') + '</div></div></div>';
        }).join('') + '</div>';
      }
      if (ME.sable && !x.restoredAt && !x.waitFor && vs.length + (x.family || []).length > 0) {
        h += '<form class="sb-go" id="sbGo" novalidate><h3 class="tk-h3">Вернуть по обращению</h3>' +
          '<label class="gv-f"><span>Способ</span><select id="sbMode"><option value="ресурсы">Ресурсами — блоки корпуса письмами (/mail)</option>' +
          '<option value="целиком">Целиком — готовая постройка, достать посохом в игре</option></select></label>' +
          '<label class="gv-f"><span>Слепок</span><select id="sbVer"><option value="последний">последний</option>' +
          '<option value="прошлый">предпоследний</option><option value="пик">самый большой в семье</option>' +
          vs.map(function (v) { return '<option value="' + esc(v.seq) + '">#' + esc(v.seq) + ' — ' + esc(v.blocks) + ' бл.</option>'; }).join('') +
          '</select></label>' +
          '<label class="gv-f"><span>Обращение №</span><input id="sbNo" inputmode="numeric" maxlength="7" autocomplete="off" placeholder="—"></label>' +
          '<label class="gv-f"><span>Игрок<small>пусто — автор обращения, без него хозяин</small></span><input id="sbNick" maxlength="16" autocomplete="off" spellcheck="false" placeholder="' +
          esc(x.owner || 'ник') + '"></label>' +
          '<label class="gv-f"><span>Причина<small>без номера обращения — обязательно</small></span><textarea id="sbWhy" rows="2" maxlength="200"></textarea></label>' +
          '<button class="btn btn-primary" type="submit" id="sbBtn">Вернуть</button><p class="gv-say" id="sbSay" role="status"></p>' +
          '<p class="gv-note">Перед выдачей вся постройка (и все ее обломки) убирается из мира — даже спрятанная или выгруженная; ' +
          'если какая-то часть загрузится позже, ее уберет сервер. По одной постройке выдают один раз. ' +
          'Разобранную сборщиком не выдают: ее блоки уже у игрока. Груз сундуков и жидкости баков не возвращаются.</p></form>';
      }
      h += '</div>';
      box.innerHTML = h;
      document.getElementById('sbClose').addEventListener('click', function () { SBL.id = 0; box.innerHTML = ''; });
      box.querySelectorAll('[data-sb]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); sblCard(+a.getAttribute('data-sb')); });
      });
      var f = document.getElementById('sbGo');
      if (f) f.addEventListener('submit', function (e) {
        e.preventDefault();
        var say = document.getElementById('sbSay'), btn = document.getElementById('sbBtn');
        var body = {
          id: x.id, mode: document.getElementById('sbMode').value, ver: document.getElementById('sbVer').value,
          ticket: parseInt(document.getElementById('sbNo').value, 10) || 0,
          nick: document.getElementById('sbNick').value.trim(), reason: document.getElementById('sbWhy').value.trim()
        };
        if (!body.ticket && body.reason.length < 5) { say.textContent = 'Без номера обращения напишите причину.'; return; }
        var to = body.nick || x.owner || '?';
        if (!confirm('Вернуть технику №' + x.id + ' ' + body.mode + ' игроку ' + to + '?\n\nВся постройка будет убрана из мира. ' +
          'Повторно по ней выдать нельзя.')) return;
        btn.disabled = true;
        say.textContent = 'Отправляю…';
        A.call('/adm/sable/restore', { body: body }).then(function (res) {
          say.textContent = res.text || 'Готово.';
          setTimeout(function () { sblCard(x.id); sblList(); }, 1200);
        }, function (err) {
          if (err && err.code === 'auth') { drawLogin(); return; }
          btn.disabled = false;
          say.textContent = A.textOf(err);
        });
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      box.innerHTML = '<p class="gv-empty">' + esc(A.textOf(err)) + '</p>';
    });
  }

  /* ------------------------------------------------------------ отчет недели */

  /* Предложение команды 28.09.2026: «автоматические еженедельные отчеты на сайте».
     Считается сервером из обращений и журнала выдач, неделя — с понедельника по МСК. */
  var WEEK = 1;

  function drawWeek() {
    var box = document.getElementById('tkdTeam');
    A.call('/adm/weekly?back=' + WEEK).then(function (r) { weekView(box, r); }, function (err) {
      if (err && err.code === 'auth') { drawLogin(); return; }
      box.innerHTML = '<p class="tkd-p">' + esc(A.textOf(err)) + '</p>';
    });
  }

  function dur(ms) {
    if (ms == null || ms < 0) return '—';
    var m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return m + ' мин';
    var h = Math.floor(m / 60);
    if (h < 48) return h + ' ч' + (m % 60 ? ' ' + m % 60 + ' мин' : '');
    return Math.round(h / 24) + ' дн';
  }

  function weekView(box, r) {
    var d = function (ms) {
      return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
    };
    var h = '<div class="wk-head"><button type="button" class="btn btn-dark btn-sm" data-wk="1" aria-label="Неделей раньше"' +
      (r.back >= 52 ? ' disabled' : '') + '>←</button><b>' + esc(d(r.from)) + ' — ' + esc(d(r.to - 1)) + '</b>' +
      '<button type="button" class="btn btn-dark btn-sm" data-wk="-1" aria-label="Неделей позже"' +
      (r.back <= 0 ? ' disabled' : '') + '>→</button>' + (r.back === 0 ? '<span class="wk-now">неделя идет — цифры растут</span>' : '') + '</div>';
    var tiles = [
      [r.made, 'новых обращений'], [r.closed, 'закрыто'], [r.bySigea, 'из них закрыла SIGEA'],
      [r.byPlayer, 'закрыли сами игроки'], [r.open, 'открыто на конец недели'],
      [dur(r.firstMed), 'первый ответ, медиана' + (r.firstN ? ' (' + r.firstN + ')' : '')],
      [r.comps, 'выдач предметов' + (r.compItems ? ' · ' + r.compItems + ' шт.' : '')]
    ];
    /* Учет работы штаба (03.10.2026): смена и ответы — отдельными числами и по дням.
       Сервер до обновления поля work не шлет — тогда остается прежняя таблица. */
    if (r.work) {
      tiles.unshift([hm(r.dutyAll), r.all ? 'на смене всей командой' : 'на смене'],
        [r.answersAll, 'ответов в обращениях']);
    }
    h += '<div class="wk-tiles">' + tiles.map(function (x) {
      return '<div class="wk-tile"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>';
    }).join('') + '</div>';
    if ((r.cats || []).length) {
      h += '<div class="wk-cats">' + r.cats.map(function (c) {
        return '<span>' + esc(T.catName(c.cat, c.cat)) + '<b>' + esc(c.n) + '</b></span>';
      }).join('') + '</div>';
    }
    var rows = r.rows || [];
    h += '<h3 class="tk-h3">' + (r.all ? 'Команда' : 'Ваша строка') + '</h3>';
    if (r.work && rows.length) {
      h += '<div class="wk-wrap"><table class="wk-t wk-wide"><thead><tr><th>Кто</th><th>На смене</th><th>Ответов</th>' +
        '<th>Закрыл</th><th>Первый ответ</th><th>Выдач</th><th>Наказаний</th><th>Отгул</th></tr></thead><tbody>' +
        rows.map(function (x) { return workRow(x, r.from); }).join('') + '</tbody></table></div>' +
        '<p class="tkd-p wk-foot">Нажмите на строку — смена и ответы по дням, выданные наказания.' +
        (r.syncAt ? '' : ' Отгулы и взыскания появятся после первой сверки с ботом.') + '</p>';
    } else if (!rows.length) {
      h += '<p class="tkd-p">За эту неделю ' + (r.work ? (r.all ? 'в штабе никого нет.' : 'у вас ничего не записано.')
        : (r.all ? 'команда в обращениях не отвечала.' : 'вы в обращениях не отвечали.')) + '</p>';
    } else {
      h += '<div class="wk-wrap"><table class="wk-t"><thead><tr><th>Кто</th><th>Закрыл</th><th>Ответов</th>' +
        '<th>Первый ответ</th><th>Выдач</th></tr></thead><tbody>' + rows.map(function (x) {
          return '<tr><td><b>' + esc(x.nick) + '</b></td><td>' + esc(x.closed) +
            (x.auto ? ' <small>(' + esc(x.auto) + ' само)</small>' : '') + '</td><td>' + esc(x.answers) + '</td><td>' +
            (x.first ? esc(dur(x.firstMed)) + ' <small>(' + esc(x.first) + ')</small>' : '—') + '</td><td>' +
            (x.comps ? esc(x.comps) + ' <small>(' + esc(x.compItems) + ' шт.)</small>' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (!r.all) h += '<p class="tkd-p wk-foot">Всю команду в отчете видят высшая администрация и владелец.</p>';
    box.innerHTML = h;
    box.querySelectorAll('[data-wk]').forEach(function (b) {
      b.addEventListener('click', function () {
        WEEK = Math.max(0, Math.min(52, WEEK + +b.getAttribute('data-wk')));
        drawWeek();
      });
    });
    box.querySelectorAll('.wk-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var more = tr.nextElementSibling, btn = tr.querySelector('.wk-open');
        if (!more || !more.classList.contains('wk-more')) return;
        more.hidden = !more.hidden;
        tr.classList.toggle('is-open', !more.hidden);
        if (btn) btn.setAttribute('aria-expanded', more.hidden ? 'false' : 'true');
      });
    });
  }

  /* «12 ч 05 мин» из секунд — время на смене. */
  function hm(sec) {
    if (!sec || sec <= 0) return '—';
    if (sec < 60) return '< 1 мин';
    var hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60);
    return hh ? hh + ' ч ' + (mm < 10 ? '0' : '') + mm + ' мин' : mm + ' мин';
  }

  var WK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  var WK_KIND = { warn: 'пред', mute: 'мут', ban: 'бан', kick: 'кик' };

  /* Строка человека в недельном отчете и скрытая под ней раскладка по дням. */
  function workRow(x, from) {
    var day = function (ms, o) {
      o.timeZone = 'Europe/Moscow';
      return new Date(ms).toLocaleString('ru-RU', o);
    };
    var pun = (x.warn || 0) + (x.mute || 0) + (x.ban || 0) + (x.kick || 0);
    var lv = x.leave, leave = '—';
    if (lv) {
      leave = lv.now ? (lv.until ? 'до ' + day(lv.until, { day: 'numeric', month: 'numeric' }) : 'до снятия')
        : lv.days + ' дн.';
      leave = '<span class="wk-leave"' + (lv.reason ? ' title="' + esc(lv.reason) + '"' : '') + '>' + esc(leave) + '</span>';
    }
    var h = '<tr class="wk-row"><td><button type="button" class="wk-open" aria-expanded="false">' + esc(x.nick) + '</button>' +
      (x.rank ? '<small class="wk-rank">' + esc(x.rank) + '</small>' : '') +
      (x.staffWarns ? '<small class="wk-bad">взысканий: ' + esc(x.staffWarns) + '</small>' : '') + '</td><td>' +
      esc(hm(x.duty)) + '</td><td>' + esc(x.answers) + '</td><td>' + esc(x.closed) +
      (x.auto ? ' <small>(' + esc(x.auto) + ' само)</small>' : '') + '</td><td>' +
      (x.first ? esc(dur(x.firstMed)) + ' <small>(' + esc(x.first) + ')</small>' : '—') + '</td><td>' +
      (x.comps ? esc(x.comps) + ' <small>(' + esc(x.compItems) + ' шт.)</small>' : '—') + '</td><td>' +
      (pun || '—') + '</td><td>' + leave + '</td></tr>';
    var dd = x.dutyDays || [], ad = x.ansDays || [];
    h += '<tr class="wk-more" hidden><td colspan="8"><div class="wk-days">' + WK_DAYS.map(function (n, i) {
      var off = !dd[i] && !ad[i];
      return '<div class="wk-day' + (off ? ' is-off' : '') + '"><i>' + n + ', ' +
        esc(day(from + i * 86400000, { day: 'numeric', month: 'numeric' })) + '</i><b>' + esc(hm(dd[i])) + '</b><span>' +
        (ad[i] ? esc(ad[i]) + ' отв.' : 'без ответов') + '</span></div>';
    }).join('') + '</div>';
    h += '<p class="wk-sum">Наказания за неделю: ' + ['warn', 'mute', 'ban', 'kick'].map(function (k) {
      return WK_KIND[k] + ' <b>' + esc(x[k] || 0) + '</b>';
    }).join(' · ') + '</p>';
    if ((x.cases || []).length) {
      h += '<ul class="wk-cases">' + x.cases.map(function (c) {
        return '<li><time>' + esc(day(c.t, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) +
          '</time>' + esc(WK_KIND[c.kind] || c.kind) + (c.min ? ' на ' + esc(dur(c.min * 60000)) : '') + ' — <b>' +
          esc(c.nick || '?') + '</b>' + (c.why ? ' · ' + esc(c.why) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (x.staffWarns) {
      h += '<p class="wk-sum wk-bad">Действующих взысканий: ' + esc(x.staffWarns) + '. Ведутся в Discord: !дело.</p>';
    }
    if (lv && lv.reason) h += '<p class="wk-sum">Отгул: ' + esc(lv.reason) + '</p>';
    return h + '</td></tr>';
  }

  /* ------------------------------------------------------------ маршрут */

  function route() {
    stopLive();
    if (!ME) { start(); return; }
    var id = hashId();
    if (id) drawTicket(id);
    else drawList();
  }

  /* «Назад» к списку возвращает туда, где человек был, а не в самый верх:
     раньше после каждой темы список приходилось листать заново (идеи команды 03.10). */
  T.backScroll(function () {
    if (!ME) return false;
    route();
  });

  T.cats().then(start, start);
})();
