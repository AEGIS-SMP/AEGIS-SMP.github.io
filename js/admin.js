/* AEGIS — панель управления сайтом и командой (admin.html).

   Вход один и тот же, что в кабинет: POST /cab/login кладёт сессию в
   sessionStorage, кабинет и панель её делят. Панель просто требует прав
   больше: {ok:false} на любом /adm/* — это нормальный отказ, а не поломка.

   Права приходят в /cab/me полем rights[]: "tickets", "content", "staff",
   "exams", "settings", "log". Панель прячет разделы, на которые прав нет,
   но это удобство, а не защита: запрос можно послать руками, поэтому
   каждое право сервер проверяет сам.

   ЧТО ДОЛЖНА ОТДАВАТЬ СЛУЖБА (зона СЕРВЕР). Времена — миллисекунды.

   GET  /adm/overview -> {ok, online, tickets:{open,wait}, orders:{wait},
        exams:{issued,check}, staff:{apply}, notes:[{text,view}]}

   Обращения:
   GET  /adm/tickets?state=open|wait|done|all&q=&limit=60
        -> {ok, rows:[{id,cat,name,nick,contact,at,status,last}]}
   GET  /adm/ticket?id=       -> {ok, id,cat,name,nick,contact,at,status,
        fields:[{label,value}], talk:[{at,who,text,staff}]}
   POST /adm/ticket/reply {id,text}        -> {ok,text}
   POST /adm/ticket/state {id,status,note} -> {ok,text}

   Содержимое (то, что видно на сайте):
   GET  /adm/content?key=news|streamers|topics|wiki -> {ok, key, at, by, data}
   POST /adm/content {key, data}                    -> {ok, text, at}
        data — ровно та структура, что лежит в site/data/<key>.json.
        Служба хранит свою копию и отдаёт её страницам сайта
        (GET /site/news, /site/streamers, /site/topics, /site/wiki).
        Пока службы нет, страницы читают файлы в репозитории — поэтому
        снимок надо уметь выгружать обратно в файлы (кнопка в хабе).

   Команда:
   GET  /adm/staff -> {ok, rows:[{nick,role,rights,since,online,
        stat:{tickets,punish,pardoned},review:{at,by,score}}],
        apply:[{id,nick,role,at,text,contact}]}
   POST /adm/staff/role   {nick, role, rights}          -> {ok,text}
   POST /adm/staff/review {nick, score, note}           -> {ok,text}
   POST /adm/staff/apply  {id, verdict:"exam|no", note}  -> {ok,text,exam}

   Экзамены (вопросы и правильные ответы живут ТОЛЬКО на сервере):
   GET  /adm/exams?state=all|issued|done|graded -> {ok, rows:[E]}
   POST /adm/exam/issue {nick, role, level, count, minutes} -> {ok, text, id}
   POST /adm/exam/regen {id}   -> {ok, text, id}   старый вариант гасится
   POST /adm/exam/cancel {id}  -> {ok, text}
   GET  /adm/exam?id=  -> {ok, ...E, questions:[Q]}
   POST /adm/exam/grade {id, marks:[{q, score, note}], verdict:"pass|redo|no", note}
        -> {ok, text}

   E = {id, nick, role, level, variant, at, until, state:"issued|done|graded",
        auto:{got,max}, score, verdict, by}
   Q = {n, kind:"one|many|open", text, options:[str], answer, correct, score, max, note}
       answer  — что ответил кандидат (индексы для one/many, текст для open);
       correct — правильный ответ; отдавать ТОЛЬКО когда state != "issued",
       иначе правильные ответы утекут кандидату через открытую панель.

   Настройки сайта:
   GET  /adm/settings -> {ok, notice:{on,kind,text}, wipe, links:{map,launcher,donate},
        maintenance:{on,text}}
   POST /adm/settings {...то же...} -> {ok,text}

   GET  /adm/log?limit=80 -> {ok, rows:[{at,who,what,about}]}
*/
(function () {
  'use strict';

  var A = window.AegisApi;
  var body = document.getElementById('adBody');
  if (!body || !A) return;

  var me = null;          /* кто вошёл: /cab/me */
  var view = 'home';
  var sub = 'news';       /* подраздел «Содержимое» */
  var msg = null;         /* одноразовая полоска сверху */
  var d = {};             /* что загружено по разделам */
  var open = null;        /* открытая карточка: обращение или экзамен */

  var NAV = [
    ['home', 'Обзор', ''],
    ['tickets', 'Обращения', 'tickets'],
    ['content', 'Содержимое', 'content'],
    ['staff', 'Команда', 'staff'],
    ['exams', 'Экзамены', 'exams'],
    ['settings', 'Настройки', 'settings'],
    ['log', 'Журнал', 'log']
  ];

  var SUBS = [
    ['news', 'Новости'],
    ['streamers', 'Эфиры'],
    ['topics', 'Темы обращений'],
    ['wiki', 'Вики']
  ];

  /* Должности ровно те же, что на странице вики «Должности команды», и в том же
     порядке снизу вверх. Третьим полем — состав: он же выбирает на сервере глубину
     набора вопросов, поэтому отдельной «сложности» тут нет.
     Руководство (Основатель, Управляющий, Координатор, Discord-Куратор) экзаменом
     не берут — это назначение, а не отбор, и в списке его нет намеренно. */
  var ROLES = [
    ['intern', 'Стажёр', 'Младший состав'],
    ['moder', 'Модератор', 'Младший состав'],
    ['smoder', 'Старший Модератор', 'Средний состав'],
    ['admin', 'Администратор', 'Средний состав'],
    ['sadmin', 'Старший Администратор', 'Старший состав'],
    ['special', 'Администратор по Особым Поручениям', 'Старший состав'],
    ['hadmin', 'Главный Администратор', 'Старший состав'],
    ['dc-moder', 'Discord-Модератор', 'Ветка Discord'],
    ['dc-admin', 'Discord-Администратор', 'Ветка Discord']
  ];

  /* Повод, по которому экзамен вообще выдают. Сервер по нему решает, что спрашивать:
     на входе — правила и поведение, на повышении — обязанности новой должности,
     на переаттестации — разбор того, что человек уже наделал на посту. */
  var LEVELS = [
    ['entry', 'Приём на стажировку', 'приём'],
    ['up', 'Повышение на должность', 'повышение'],
    ['recert', 'Переаттестация на посту', 'переаттестация']
  ];

  var STATE = {
    issued: ['выдан', 'gold'],
    done: ['ждёт проверки', 'green'],
    graded: ['проверен', ''],
    dead: ['погашен', 'red']
  };

  function esc(s) { return A.esc(s); }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? (e.value || '').trim() : ''; }
  function roleName(k) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i][0] === k) return ROLES[i][1];
    return k || '';
  }
  /* состав должности — подпись помельче рядом с названием */
  function roleTier(k) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i][0] === k) return ROLES[i][2];
    return '';
  }
  function levelName(k) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === k) return LEVELS[i][1];
    return k || '';
  }
  /* короткое слово для плитки, где длинное «Повышение на должность» ломает строку */
  function levelShort(k) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === k) return LEVELS[i][2];
    return k || '';
  }
  function plural(n, f) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return n + ' ' + f[2];
    if (b > 1 && b < 5) return n + ' ' + f[1];
    if (b === 1) return n + ' ' + f[0];
    return n + ' ' + f[2];
  }
  function date(ts) {
    if (!ts) return '';
    var x = new Date(Number(ts));
    return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) +
      ' в ' + x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function left(ts) {
    if (!ts) return 'без срока';
    var m = Math.round((Number(ts) - Date.now()) / 60000);
    if (m <= 0) return 'время вышло';
    if (m < 60) return 'осталось ' + plural(m, ['минута', 'минуты', 'минут']);
    var h = Math.round(m / 60);
    if (h < 48) return 'осталось ' + plural(h, ['час', 'часа', 'часов']);
    return 'осталось ' + plural(Math.round(h / 24), ['день', 'дня', 'дней']);
  }
  function can(right) {
    if (!me) return false;
    if (!right) return true;
    if (!me.rights || !me.rights.length) return !!me.admin;
    return me.rights.indexOf(right) >= 0;
  }

  function note(kind, text) { msg = { kind: kind, text: text }; }
  function flash() {
    if (!msg) return '';
    var h = '<div class="cb-msg ' + (msg.kind === 'ok' ? 'ok' : 'bad') + '">' +
      esc(msg.text) + '</div>';
    msg = null;
    return h;
  }

  function fail(e) {
    if (e && e.code === 'auth') {
      A.setSession(null);
      me = null;
      note('bad', 'Вход истёк — зайди заново.');
      paint();
      return;
    }
    note('bad', A.textOf(e));
    paint();
  }

  function loading() {
    body.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
  }

  /* ------------------------------------------------------------- загрузка */

  function loadMe() {
    return A.call('/cab/me').then(function (r) { me = r; });
  }

  function need() {
    if (view === 'home') return A.call('/adm/overview').then(function (r) { d.home = r; });
    if (view === 'tickets') {
      if (open) return A.call('/adm/ticket?id=' + encodeURIComponent(open))
        .then(function (r) { d.ticket = r; });
      return A.call('/adm/tickets?limit=60&state=' + encodeURIComponent(d.tstate || 'open'))
        .then(function (r) { d.tickets = r; });
    }
    if (view === 'content') return A.call('/adm/content?key=' + encodeURIComponent(sub))
      .then(function (r) { d.content = r; });
    if (view === 'staff') return A.call('/adm/staff').then(function (r) { d.staff = r; });
    if (view === 'exams') {
      if (open) return A.call('/adm/exam?id=' + encodeURIComponent(open))
        .then(function (r) { d.exam = r; });
      return A.call('/adm/exams?state=' + encodeURIComponent(d.estate || 'all'))
        .then(function (r) { d.exams = r; });
    }
    if (view === 'settings') return A.call('/adm/settings').then(function (r) { d.set = r; });
    if (view === 'log') return A.call('/adm/log?limit=80').then(function (r) { d.log = r; });
    return Promise.resolve();
  }

  function go(v, id) {
    view = v;
    open = id || null;
    loading();
    need().then(paint, fail);
  }

  function reload() {
    loading();
    need().then(paint, fail);
  }

  /* ---------------------------------------------------------------- экран */

  function paint() {
    if (!A.base()) return paintOffline();
    if (!A.token() || !me) return paintLogin();
    if (!me.admin) return paintNoRights();

    body.innerHTML = '<div class="cab">' + side() + '<div>' + flash() + main() + '</div></div>';
    var f = body.querySelector('[data-focus]');
    if (f) f.focus();
  }

  function paintOffline() {
    body.innerHTML =
      '<div class="cab-login"><h2>Панель включится вместе с сервером</h2>' +
      '<p class="cl-lead">Управление сайтом работает от службы игрового сервера: она хранит ' +
      'обращения, содержимое страниц, состав команды и экзамены. Пока адрес службы не ' +
      'прописан в <b>js/config.js</b>, показывать здесь нечего.</p></div>' +
      '<div class="cab-why"><h3>Что будет внутри</h3><ul>' +
      '<li>очередь обращений с сайта и из Discord — ответ прямо отсюда;</li>' +
      '<li>новости, эфиры, темы обращений и страницы вики — правятся без git;</li>' +
      '<li>состав команды, права и оценка работы на посту;</li>' +
      '<li>экзамены на должность: выдать, перегенерировать, проверить;</li>' +
      '<li>объявление на сайте и режим техработ;</li>' +
      '<li>журнал: кто что сделал и когда.</li>' +
      '</ul></div>';
  }

  function paintLogin() {
    body.innerHTML = flash() +
      '<div class="cab-login"><h2>Вход в управление</h2>' +
      '<p class="cl-lead">Имя и пароль те же, что в лаунчере и кабинете. Панель откроется, ' +
      'только если у аккаунта есть права.</p>' +
      '<div class="field"><label for="adNick">Игровое имя</label>' +
      '<input id="adNick" type="text" autocomplete="username" spellcheck="false" ' +
      'data-focus placeholder="Например, VineZerro"></div>' +
      '<div class="field"><label for="adPass">Пароль</label>' +
      '<input id="adPass" type="password" autocomplete="current-password" ' +
      'placeholder="Пароль от аккаунта"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="in">Войти</button>' +
      '<span class="fg-note" role="status" id="adSay"></span></div></div>';
    var n = el('adNick');
    if (n) n.focus();
  }

  function paintNoRights() {
    body.innerHTML = flash() +
      '<div class="cab-login"><h2>Прав нет</h2>' +
      '<p class="cl-lead">Аккаунт <b>' + esc(me.nick || '') + '</b> вошёл, но управлять сайтом ' +
      'ему не разрешено. Если это ошибка — скажи тому, кто выдаёт права.</p>' +
      '<div class="form-go"><a class="btn btn-dark" href="cabinet.html">В кабинет</a>' +
      '<button class="btn btn-dark" data-act="out">Выйти</button></div></div>';
  }

  function side() {
    var letter = esc((me.nick || '?').charAt(0).toUpperCase());
    var skin = me.skin && me.skin.has
      ? A.base() + '/skins/' + encodeURIComponent(me.nick) + '.png' : '';
    var av = '<div class="cm-av"><span class="cm-let">' + letter + '</span>' +
      (skin ? '<img src="' + esc(skin) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '</div>';

    var o = d.home || {};
    /* Открытый раздел отличается только заливкой — читалке это не видно.
       Это не нажатая кнопка, а «сейчас открыто вот это»: aria-current. */
    var n = '<nav class="cab-nav" aria-label="Разделы управления">';
    NAV.forEach(function (t) {
      if (!can(t[2])) return;
      var b = '';
      if (t[0] === 'tickets' && o.tickets) b = String(o.tickets.open || '');
      if (t[0] === 'exams' && o.exams) b = String(o.exams.check || '');
      if (t[0] === 'staff' && o.staff) b = String(o.staff.apply || '');
      n += '<button type="button" data-nav="' + t[0] + '"' +
        (view === t[0] ? ' class="on" aria-current="true"' : '') + '>' + esc(t[1]) +
        (b ? '<span class="cn-b">' + esc(b) + '</span>' : '') + '</button>';
    });
    n += '</nav>';

    return '<aside class="cab-side">' +
      '<div class="cab-me">' + av + '<div><div class="cm-n">' + esc(me.nick || '') +
      '</div><div class="cm-s">' + esc(me.role || 'команда') + '</div></div></div>' + n +
      /* Точка-разделитель в своём теге: на телефоне «Выйти» становится отдельной
         кнопкой под строкой, и точка повисала в хвосте «Кабинет ·». Голый текст
         стилями не убрать, поэтому он завёрнут. */
      '<div class="cab-out"><a href="cabinet.html">Кабинет</a><span class="cab-sep"> · </span>' +
      '<button type="button" data-act="out">Выйти</button></div></aside>';
  }

  function main() {
    if (view === 'tickets') return open ? viewTicket() : viewTickets();
    if (view === 'content') return viewContent();
    if (view === 'staff') return viewStaff();
    if (view === 'exams') return open ? viewExam() : viewExams();
    if (view === 'settings') return viewSettings();
    if (view === 'log') return viewLog();
    return viewHome();
  }

  /* --------------------------------------------------------------- кусочки */

  /* cls — необязательный довесок: «wide» растягивает плитку на всю ширину ряда
     на телефоне (ник в неё влезает целиком, а не переносится по слогам). */
  function tile(k, v, s, cls) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="t-k">' + esc(k) + '</div>' +
      '<div class="t-v">' + esc(v) + '</div>' +
      (s ? '<div class="t-s">' + s + '</div>' : '') + '</div>';
  }

  function row(t, s, r) {
    return '<div class="row r2"><div><div class="rw-t">' + t + '</div>' +
      (s ? '<div class="rw-s">' + s + '</div>' : '') + '</div>' +
      '<div class="rw-r">' + (r || '') + '</div></div>';
  }

  function empty(h, p) {
    return '<div class="empty"><h4>' + esc(h) + '</h4><p>' + esc(p) + '</p></div>';
  }

  function block(title, inner, right) {
    return '<div class="cab-block"><h2>' + esc(title) +
      (right ? '<span class="ad-h-r">' + right + '</span>' : '') + '</h2>' + inner + '</div>';
  }

  /* ---------------------------------------------------------------- обзор */

  function viewHome() {
    var o = d.home || {};
    var t = o.tickets || {}, e = o.exams || {}, s = o.staff || {}, r = o.orders || {};

    var tiles =
      tile('На сервере', o.online != null ? String(o.online) : '—', 'игроков прямо сейчас') +
      tile('Обращения', String(t.open || 0),
        (t.wait ? plural(t.wait, ['ждёт', 'ждут', 'ждут']) + ' ответа игрока' : 'новых нет')) +
      tile('Экзамены', String(e.check || 0), 'сданы и ждут проверки') +
      tile('Заявки', String(s.apply || 0), 'в команду');

    var list = '';
    var notes = o.notes || [];
    if (notes.length) {
      list = notes.map(function (n) {
        return row(esc(n.text), '', n.view
          ? '<button class="btn btn-dark btn-sm" data-nav="' + esc(n.view) + '">Открыть</button>'
          : '');
      }).join('');
    } else {
      list = row('Ничего не горит', 'Очередь пуста, экзамены проверены', '');
    }

    var quick = '<div class="row-list">' +
      row('Наказания, чат сервера и игроки', 'Это в кабинете — там же, где команда работает каждый день',
        '<a class="btn btn-dark btn-sm" href="cabinet.html#/players">В кабинет</a>') +
      row('Обращения глазами игрока', 'Полезно открыть после правки тем',
        '<a class="btn btn-dark btn-sm" href="tickets.html" target="_blank" rel="noopener">Открыть</a>') +
      row('Вики', 'Проверить, как легли правки',
        '<a class="btn btn-dark btn-sm" href="wiki.html" target="_blank" rel="noopener">Открыть</a>') +
      '</div>';

    return '<div class="cab-tiles">' + tiles + '</div>' +
      block('Требует внимания', '<div class="row-list">' + list + '</div>') +
      block('Быстрые ходы', quick);
  }

  /* ----------------------------------------------------------- обращения */

  var TSTATE = [['open', 'В работе'], ['wait', 'Ждут игрока'], ['done', 'Закрытые'], ['all', 'Все']];

  function viewTickets() {
    var r = (d.tickets && d.tickets.rows) || [];
    var cur = d.tstate || 'open';

    var tabs = '<div class="ad-sub" role="group" aria-label="Состояние обращений">' +
      TSTATE.map(function (s) {
        return '<button type="button" data-tst="' + s[0] + '"' +
          (cur === s[0] ? ' class="on" aria-current="true"' : '') + '>' + esc(s[1]) + '</button>';
      }).join('') + '</div>';

    if (!r.length) {
      return tabs + empty('Пусто', cur === 'open'
        ? 'Новых обращений нет — редкий и хороший день.'
        : 'В этой вкладке ничего нет.');
    }

    var rows = r.map(function (t) {
      var pill = t.status === 'done' ? '<span class="pill">закрыто</span>'
        : t.status === 'wait' ? '<span class="pill gold">ждёт игрока</span>'
          : '<span class="pill green">в работе</span>';
      return row(
        '<a href="#/t/' + esc(t.id) + '">№' + esc(t.id) + ' · ' + esc(t.name || t.cat) + '</a>',
        esc(t.nick || 'без имени') + ' · ' + esc(date(t.at)) +
        (t.last ? ' · последнее сообщение ' + esc(A.ago(t.last)) : ''),
        pill);
    }).join('');

    return tabs + block('Очередь', '<div class="row-list">' + rows + '</div>');
  }

  function viewTicket() {
    var t = d.ticket || {};
    var f = (t.fields || []).map(function (x) {
      return row(esc(x.label), esc(x.value), '');
    }).join('');

    var talk = (t.talk || []).map(function (m) {
      return '<div class="ad-msg' + (m.staff ? ' me' : '') + '">' +
        '<div class="ad-msg-h">' + esc(m.who || '') + ' · ' + esc(date(m.at)) + '</div>' +
        '<div>' + esc(m.text) + '</div></div>';
    }).join('') || '<p class="cab-hint">Переписки пока нет.</p>';

    var reply =
      '<div class="field"><label for="adRep">Ответ игроку</label>' +
      '<textarea id="adRep" rows="4" placeholder="Пишем по-человечески: что решили и почему"></textarea></div>' +
      '<div class="form-go">' +
      '<button class="btn btn-primary" data-act="t-reply">Отправить</button>' +
      '<button class="btn btn-dark" data-act="t-wait">Ждём игрока</button>' +
      '<button class="btn btn-dark" data-act="t-done">Закрыть обращение</button>' +
      '<span class="fg-note" role="status" id="adTSay"></span></div>';

    return '<p class="tk-back"><a href="#/tickets">← к очереди</a></p>' +
      block('№' + esc(t.id || '') + ' · ' + esc(t.name || t.cat || ''),
        '<div class="row-list">' +
        row('Игрок', esc(t.nick || 'не указан'), '') +
        row('Куда отвечать', esc(t.contact || 'не указано'), '') +
        row('Подано', esc(date(t.at)), '') + f + '</div>') +
      block('Переписка', talk) +
      block('Ответить', reply);
  }

  /* ---------------------------------------------------------- содержимое */

  function viewContent() {
    var tabs = '<div class="ad-sub" role="group" aria-label="Что правим">' +
      SUBS.map(function (s) {
        return '<button type="button" data-sub="' + s[0] + '"' +
          (sub === s[0] ? ' class="on" aria-current="true"' : '') + '>' + esc(s[1]) + '</button>';
      }).join('') + '</div>';

    var c = d.content || {};
    var when = c.at ? '<span class="ad-h-r">правил ' + esc(c.by || 'кто-то') + ' ' +
      esc(A.ago(c.at)) + '</span>' : '';

    var inner = sub === 'news' ? edNews(c.data)
      : sub === 'streamers' ? edStreamers(c.data)
        : sub === 'topics' ? edTopics(c.data)
          : edWiki(c.data);

    return tabs + when + inner;
  }

  /* Новости главной. Порядок сверху вниз — как на сайте. */
  function edNews(data) {
    var items = (data && data.items) || [];
    var rows = items.map(function (n, i) {
      return row(esc(n.title || 'без заголовка'),
        esc(n.date || '') + ' · ' + esc((n.text || '').slice(0, 90)) +
        ((n.text || '').length > 90 ? '…' : ''),
        '<button class="btn btn-dark btn-sm" data-act="n-up" data-i="' + i + '">↑</button>' +
        '<button class="btn btn-dark btn-sm" data-act="n-ed" data-i="' + i + '">Править</button>' +
        '<button class="btn btn-dark btn-sm" data-act="n-del" data-i="' + i + '">Удалить</button>');
    }).join('') || row('Новостей нет', 'Добавь первую — она встанет на главную', '');

    var i = d.edit != null ? d.edit : -1;
    var cur = i >= 0 ? (items[i] || {}) : {};
    var form = '<div class="ad-form">' +
      '<div class="ad-two">' +
      '<div class="field"><label for="nDate">Дата</label>' +
      '<input id="nDate" value="' + esc(cur.date || '') + '" placeholder="01.09.2026"></div>' +
      '<div class="field"><label for="nTitle">Заголовок</label>' +
      '<input id="nTitle" value="' + esc(cur.title || '') + '" placeholder="Коротко, без точки"></div>' +
      '</div>' +
      '<div class="field"><label for="nText">Текст</label>' +
      '<textarea id="nText" rows="4" placeholder="Два-три предложения: что сделали и что это даёт игроку">' +
      esc(cur.text || '') + '</textarea></div>' +
      '<div class="form-go">' +
      '<button class="btn btn-primary" data-act="n-save" data-i="' + i + '">' +
      (i >= 0 ? 'Сохранить' : 'Добавить') + '</button>' +
      (i >= 0 ? '<button class="btn btn-dark" data-act="n-cancel">Отмена</button>' : '') +
      '<span class="fg-note" role="status" id="adCSay"></span></div></div>';

    /* Порядок здесь = порядок на главной, и первая строка — та самая крупная
       карточка наверху. Отдельной «главной новости» нет: добавил новую — она
       встала первой, прежняя ушла в общий ряд сама. */
    var hint = '<p class="ad-hint">Первая в списке — самая свежая: на главной ' +
      'она стоит крупной карточкой во всю ширину, остальные идут под ней обычными. ' +
      'Новая новость встаёт первой сама, прежняя уходит в общий ряд. ' +
      'Кнопка ↑ поднимает новость на строку выше.</p>';

    return block('Новости на главной', hint + '<div class="row-list">' + rows + '</div>') +
      block(i >= 0 ? 'Правим новость' : 'Новая новость', form);
  }

  /* Каналы стримеров: их опрашивает live.html. */
  function edStreamers(data) {
    var ch = (data && data.channels) || [];
    var rows = ch.map(function (c, i) {
      return row(esc(c.name || c.id || ''),
        esc(c.platform || '') + ' · ' + esc(c.id || '') +
        (c.owner ? ' · ' + esc(c.owner) : ''),
        '<button class="btn btn-dark btn-sm" data-act="s-del" data-i="' + i + '">Убрать</button>');
    }).join('') || row('Каналов нет', 'Добавь первый — он появится на странице «Эфиры»', '');

    var form = '<div class="ad-form"><div class="ad-two">' +
      '<div class="field"><label for="sPlat">Площадка</label>' +
      '<select id="sPlat"><option value="twitch">Twitch</option>' +
      '<option value="youtube">YouTube</option><option value="kick">Kick</option>' +
      '<option value="vk">VK Видео</option><option value="trovo">Trovo</option></select></div>' +
      '<div class="field"><label for="sId">Канал</label>' +
      '<input id="sId" placeholder="Имя канала или id"></div></div>' +
      '<div class="ad-two">' +
      '<div class="field"><label for="sName">Как показывать</label>' +
      '<input id="sName" placeholder="Имя стримера"></div>' +
      '<div class="field"><label for="sNick">Игровое имя</label>' +
      '<input id="sNick" placeholder="Ник на сервере, необязательно"></div></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="s-add">Добавить канал</button>' +
      '<span class="fg-note" role="status" id="adCSay"></span></div></div>';

    return block('Каналы на странице «Эфиры»', '<div class="row-list">' + rows + '</div>') +
      block('Добавить канал', form) +
      '<p class="cab-hint">Кто сейчас в эфире, служба проверяет сама: список каналов — ' +
      'это всё, что нужно задать руками.</p>';
  }

  /* Темы обращений: включить/выключить и переименовать. Поля форм —
     штука тонкая, их правят в data/tickets.json, и врать про это не надо. */
  function edTopics(data) {
    var cats = (data && data.categories) || [];
    var rows = cats.map(function (c, i) {
      var on = c.off ? '<span class="pill red">выключена</span>'
        : '<span class="pill green">видна</span>';
      return row(esc((c.emoji || '') + ' ' + (c.name || c.key)),
        esc(c.key) + (c.hint ? ' · ' + esc(c.hint) : ''),
        on + '<button class="btn btn-dark btn-sm" data-act="c-off" data-i="' + i + '">' +
        (c.off ? 'Включить' : 'Выключить') + '</button>');
    }).join('') || row('Тем нет', 'Что-то не так с содержимым', '');

    return block('Темы на странице обращений', '<div class="row-list">' + rows + '</div>') +
      '<p class="cab-hint">Вопросы внутри формы задаются в файле ' +
      '<b>site/data/tickets.json</b> — там их удобнее держать целиком, чем править по одному ' +
      'через панель. Здесь тему можно спрятать от игроков и вернуть обратно.</p>';
  }

  /* Вики: правка markdown прямо в панели. */
  function edWiki(data) {
    var pages = (data && data.pages) || [];
    var i = d.edit != null ? d.edit : -1;

    var rows = pages.map(function (p, k) {
      return row(esc(p.title || p.slug),
        esc(p.slug) + (p.type === 'rules' ? ' · правила, правятся файлом' : ''),
        p.type === 'rules' ? '<span class="pill">файл</span>'
          : '<button class="btn btn-dark btn-sm" data-act="w-ed" data-i="' + k + '">Править</button>');
    }).join('') || row('Страниц нет', '', '');

    var form = '';
    if (i >= 0 && pages[i]) {
      var p = pages[i];
      form = block('Правим «' + (p.title || p.slug) + '»',
        '<div class="ad-form">' +
        '<div class="field"><label for="wTitle">Заголовок</label>' +
        '<input id="wTitle" value="' + esc(p.title || '') + '"></div>' +
        '<div class="field"><label for="wBody">Текст (markdown)</label>' +
        '<textarea id="wBody" rows="18" class="ad-mono">' + esc(p.body || '') + '</textarea></div>' +
        '<div class="form-go">' +
        '<button class="btn btn-primary" data-act="w-save" data-i="' + i + '">Сохранить</button>' +
        '<button class="btn btn-dark" data-act="w-cancel">Отмена</button>' +
        '<span class="fg-note" role="status" id="adCSay"></span></div></div>');
    }

    return block('Страницы вики', '<div class="row-list">' + rows + '</div>') + form +
      (i < 0 ? '<p class="cab-hint">Заголовки внутри страницы — строки, начинающиеся с ' +
        '<b>##</b>. Списки — строки с <b>-</b> или <b>1.</b>. Жирное — <b>**так**</b>. ' +
        'Больше ничего знать не нужно.</p>' : '');
  }

  /* -------------------------------------------------------------- команда */

  function viewStaff() {
    var s = d.staff || {};
    var apply = s.apply || [];
    var rows = (s.rows || []).map(function (p) {
      var st = p.stat || {};
      var rev = p.review && p.review.score
        ? '<span class="pill green">оценка ' + esc(p.review.score) + '/5</span>'
        : '<span class="pill gold">не оценивали</span>';
      return row(esc(p.nick) + ' <span class="ad-role">' + esc(roleName(p.role)) + '</span>',
        'разобрал ' + plural(st.tickets || 0, ['обращение', 'обращения', 'обращений']) +
        ' · выдал ' + plural(st.punish || 0, ['наказание', 'наказания', 'наказаний']) +
        (st.pardoned ? ' · отменено апелляциями ' + esc(st.pardoned) : '') +
        (p.since ? ' · в команде с ' + esc(date(p.since)) : ''),
        rev + '<button class="btn btn-dark btn-sm" data-act="st-rev" data-n="' +
        esc(p.nick) + '">Оценить</button>' +
        '<button class="btn btn-dark btn-sm" data-act="st-exam" data-n="' +
        esc(p.nick) + '">Экзамен</button>');
    }).join('') || row('Команда пуста', 'Пока никого, кроме владельца', '');

    var app = apply.length ? apply.map(function (a) {
      return row(esc(a.nick) + ' → ' + esc(roleName(a.role)),
        esc(date(a.at)) + (a.contact ? ' · ' + esc(a.contact) : '') +
        (a.text ? '<br>' + esc(a.text) : ''),
        '<button class="btn btn-primary btn-sm" data-act="ap-exam" data-id="' + esc(a.id) +
        '" data-n="' + esc(a.nick) + '" data-r="' + esc(a.role) + '">Дать экзамен</button>' +
        '<button class="btn btn-dark btn-sm" data-act="ap-no" data-id="' + esc(a.id) +
        '">Отказать</button>');
    }).join('') : row('Заявок нет', 'Форма заявки — тема «Стажёр» на странице обращений', '');

    var revForm = '';
    if (d.rev) {
      revForm = block('Оценка работы: ' + d.rev,
        '<div class="ad-form">' +
        '<div class="field"><label for="rvScore">Балл за период (1–5)</label>' +
        '<select id="rvScore"><option>5</option><option>4</option><option>3</option>' +
        '<option>2</option><option>1</option></select></div>' +
        '<div class="field"><label for="rvNote">За что именно</label>' +
        '<textarea id="rvNote" rows="4" placeholder="Конкретно: что делал хорошо, что провалил. ' +
        'Эту запись человек увидит."></textarea></div>' +
        '<div class="form-go"><button class="btn btn-primary" data-act="rv-save">Записать</button>' +
        '<button class="btn btn-dark" data-act="rv-cancel">Отмена</button>' +
        '<span class="fg-note" role="status" id="adSSay"></span></div></div>');
    }

    return block('Заявки в команду', '<div class="row-list">' + app + '</div>') +
      block('Состав', '<div class="row-list">' + rows + '</div>') + revForm +
      '<p class="cab-hint">Оценка работы на посту — это не «нравится/не нравится»: ' +
      'служба считает разобранные обращения, выданные наказания и то, сколько из них ' +
      'отменили по апелляции. Балл ставится к этим числам, а не вместо них.</p>';
  }

  /* ------------------------------------------------------------- экзамены */

  var ESTATE = [['all', 'Все'], ['issued', 'Выданные'], ['done', 'Ждут проверки'],
    ['graded', 'Проверенные']];

  function viewExams() {
    var cur = d.estate || 'all';
    var tabs = '<div class="ad-sub" role="group" aria-label="Состояние экзаменов">' +
      ESTATE.map(function (s) {
        return '<button type="button" data-est="' + s[0] + '"' +
          (cur === s[0] ? ' class="on" aria-current="true"' : '') + '>' + esc(s[1]) + '</button>';
      }).join('') + '</div>';

    var rows = ((d.exams && d.exams.rows) || []).map(function (e) {
      var st = STATE[e.state] || ['', ''];
      var pill = '<span class="pill ' + st[1] + '">' + esc(st[0]) + '</span>';
      var got = e.auto ? e.auto.got + '/' + e.auto.max : '';
      return row('<a href="#/e/' + esc(e.id) + '">' + esc(e.nick) + '</a> ' +
        '<span class="ad-role">' + esc(roleName(e.role)) + '</span>',
        (e.level ? esc(levelName(e.level)) + ' · ' : '') +
        'вариант ' + esc(e.variant || e.id) + ' · выдан ' + esc(date(e.at)) +
        (e.state === 'issued' ? ' · ' + esc(left(e.until)) : '') +
        (e.state === 'graded' && e.score != null ? ' · итог ' + esc(e.score) : '') +
        (got ? ' · закрытые ' + esc(got) : ''),
        pill);
    }).join('');

    var form = block('Выдать экзамен',
      '<div class="ad-form"><div class="ad-two">' +
      '<div class="field"><label for="exNick">Кому</label>' +
      '<input id="exNick" value="' + esc(d.exNick || '') + '" placeholder="Игровое имя"></div>' +
      '<div class="field"><label for="exRole">Должность</label><select id="exRole">' +
      ROLES.map(function (r) {
        return '<option value="' + r[0] + '"' +
          (d.exRole === r[0] ? ' selected' : '') + '>' + esc(r[1]) +
          ' — ' + esc(r[2]) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="ad-two">' +
      '<div class="field"><label for="exLevel">Повод</label><select id="exLevel">' +
      LEVELS.map(function (r) {
        return '<option value="' + r[0] + '">' + esc(r[1]) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label for="exCount">Вопросов</label>' +
      '<input id="exCount" type="number" min="8" max="40" value="20"></div></div>' +
      '<div class="field"><label for="exMin">Времени на прохождение, минут</label>' +
      '<input id="exMin" type="number" min="15" max="240" value="60"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="ex-issue">Выдать</button>' +
      '<span class="fg-note" role="status" id="adESay"></span></div></div>');

    return tabs +
      (rows ? block('Экзамены', '<div class="row-list">' + rows + '</div>')
        : empty('Экзаменов нет', 'Выдай первый — форма ниже.')) +
      form +
      '<p class="cab-hint">Вариант собирается на сервере под конкретного человека: свой ' +
      'набор вопросов, свой порядок ответов, свои числа в задачах. Готовые ответы от друга ' +
      'не подойдут — у него был другой вариант. Если вариант всё-таки утёк, жми ' +
      '«Перегенерировать» в карточке: старый гаснет, кандидат получает новый.</p>';
  }

  function viewExam() {
    var e = d.exam || {};
    var st = STATE[e.state] || ['', ''];
    var qs = e.questions || [];
    var editable = e.state === 'done';

    var head = '<div class="cab-tiles">' +
      tile('Кандидат', e.nick || '',
        esc(roleName(e.role)) + (roleTier(e.role) ? ' · ' + esc(roleTier(e.role)) : ''),
        'wide') +
      tile('Состояние', st[0] || '', 'вариант ' + esc(e.variant || e.id || '') +
        (e.level ? ' · ' + esc(levelShort(e.level)) : '')) +
      tile('Закрытые', e.auto ? e.auto.got + ' из ' + e.auto.max : '—', 'считает сервер') +
      tile('Итог', e.score != null ? String(e.score) : '—',
        e.verdict ? esc(verdictName(e.verdict)) : 'ещё не выставлен') +
      '</div>';

    var qh = qs.map(function (q) {
      var ans = '';
      if (q.kind === 'open') {
        ans = '<div class="ad-ans">' + (q.answer ? esc(q.answer) : '<i>без ответа</i>') + '</div>';
      } else {
        ans = '<ul class="ad-opts">' + (q.options || []).map(function (o, i) {
          var picked = pickedIn(q.answer, i);
          var right = pickedIn(q.correct, i);
          return '<li class="' + (picked ? 'pick ' : '') + (right ? 'right' : '') + '">' +
            esc(o) + '</li>';
        }).join('') + '</ul>';
      }
      var mark = editable
        ? '<div class="ad-two"><div class="field"><label for="q' + q.n + 's">Балл</label>' +
          '<input id="q' + q.n + 's" type="number" min="0" max="' + (q.max || 1) +
          '" value="' + (q.score != null ? q.score : (q.kind === 'open' ? 0 : q.score || 0)) +
          '"></div><div class="field"><label for="q' + q.n + 'n">Замечание</label>' +
          '<input id="q' + q.n + 'n" value="' + esc(q.note || '') + '"></div></div>'
        : (q.score != null ? '<div class="ad-mark">Балл: ' + esc(q.score) + ' из ' +
          esc(q.max || 1) + (q.note ? ' · ' + esc(q.note) : '') + '</div>' : '');

      return '<div class="ad-q" data-q="' + q.n + '"><div class="ad-q-h">' + q.n + '. ' +
        esc(q.text) + '</div>' + ans + mark + '</div>';
    }).join('') || '<p class="cab-hint">Кандидат ещё не сдал — ответов нет.</p>';

    var acts = '<div class="form-go">';
    if (editable) {
      acts += '<button class="btn btn-primary" data-act="ex-pass">Принять</button>' +
        '<button class="btn btn-dark" data-act="ex-redo">На доработку</button>' +
        '<button class="btn btn-dark" data-act="ex-no">Не прошёл</button>';
    }
    if (e.state === 'issued') {
      acts += '<button class="btn btn-dark" data-act="ex-regen">Перегенерировать</button>' +
        '<button class="btn btn-dark" data-act="ex-cancel">Погасить</button>';
    }
    acts += '<span class="fg-note" role="status" id="adESay"></span></div>';

    var verdict = editable
      ? '<div class="field"><label for="exNote">Что сказать кандидату</label>' +
        '<textarea id="exNote" rows="3" placeholder="Коротко и по делу: что зашло, ' +
        'что переделать"></textarea></div>'
      : (e.verdict ? '<p class="cab-hint">Решение: <b>' + esc(verdictName(e.verdict)) +
        '</b>' + (e.by ? ', ' + esc(e.by) : '') + '.</p>' : '');

    return '<p class="tk-back"><a href="#/exams">← ко всем экзаменам</a></p>' + head +
      block('Ответы', qh) +
      block('Решение', verdict + acts);
  }

  function verdictName(v) {
    return v === 'pass' ? 'принят' : v === 'redo' ? 'на доработку' : v === 'no' ? 'не прошёл' : v;
  }

  /* answer/correct бывают числом (один вариант) и списком (несколько). */
  function pickedIn(a, i) {
    if (a == null) return false;
    if (Array.isArray(a)) return a.indexOf(i) >= 0;
    return Number(a) === i;
  }

  /* ------------------------------------------------------------ настройки */

  function viewSettings() {
    var s = d.set || {};
    var n = s.notice || {}, m = s.maintenance || {}, l = s.links || {};

    var notice = '<div class="ad-form">' +
      '<div class="field"><label><input type="checkbox" id="ntOn"' +
      (n.on ? ' checked' : '') + '> Показывать объявление на сайте</label></div>' +
      '<div class="field"><label for="ntText">Текст</label>' +
      '<input id="ntText" value="' + esc(n.text || '') +
      '" placeholder="Например: вайп 19 сентября, сервер уходит на профилактику"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="set-save">Сохранить</button>' +
      '<span class="fg-note" role="status" id="adNSay"></span></div></div>';

    var links = '<div class="row-list">' +
      row('Карта мира', esc(l.map || 'не задана'), '') +
      row('Лаунчер', esc(l.launcher || 'не задан'), '') +
      row('Приём платежей', esc(l.donate || 'не задан'), '') +
      '</div><p class="cab-hint">Адреса живут в <b>site/js/config.js</b> и правятся файлом: ' +
      'это единственное место, где они записаны, и при переезде на хостинг меняется ' +
      'только оно. Здесь показано, что сейчас видит сайт.</p>';

    var maint = '<div class="ad-form">' +
      '<div class="field"><label><input type="checkbox" id="mtOn"' +
      (m.on ? ' checked' : '') + '> Режим техработ: сайт открыт, живые разделы отключены</label></div>' +
      '<div class="field"><label for="mtText">Что написать людям</label>' +
      '<input id="mtText" value="' + esc(m.text || '') +
      '" placeholder="Например: чиним начисление червонцев, вернёмся к вечеру"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="set-save">Сохранить</button>' +
      '</div></div>';

    return block('Объявление на сайте', notice) +
      block('Техработы', maint) +
      block('Адреса', links);
  }

  /* --------------------------------------------------------------- журнал */

  function viewLog() {
    var rows = ((d.log && d.log.rows) || []).map(function (r) {
      return row(esc(r.what), esc(r.who || '') + (r.about ? ' → ' + esc(r.about) : ''),
        '<span class="rw-s">' + esc(A.ago(r.at)) + '</span>');
    }).join('');
    if (!rows) return empty('Журнал пуст', 'Здесь появятся действия команды.');
    return block('Что делала команда', '<div class="row-list">' + rows + '</div>') +
      '<p class="cab-hint">Журнал нужен не для слежки, а для апелляций: без записи ' +
      '«кто выдал наказание» разобрать жалобу нечестно.</p>';
  }

  /* --------------------------------------------------------------- дела */

  function busy(btn, text) {
    if (!btn) return function () {};
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
    return function () { btn.disabled = false; btn.textContent = old; };
  }

  function doLogin() {
    var nick = val('adNick'), pass = val('adPass'), say = el('adSay');
    if (!nick || !pass) { if (say) say.textContent = 'Впиши имя и пароль.'; return; }
    var btn = body.querySelector('[data-act="in"]');
    var free = busy(btn, 'Входим…');
    if (say) say.textContent = '';
    A.call('/cab/login', { body: { nick: nick, pass: pass } }).then(function (r) {
      A.setSession({
        token: r.token, nick: r.nick || nick, role: r.role || '',
        admin: !!r.admin, until: r.until || 0
      });
      loading();
      /* После входа идём не «на главную», а туда, куда показывает адрес: ссылку на
         обращение или экзамен кидают в личку, и она должна открыться сама. Обзор
         грузим всё равно — из него берутся цифры на кнопках меню. */
      return loadMe().then(function () {
        if (!me.admin) return paint();
        return A.call('/adm/overview').then(function (r) { d.home = r; }, function () {})
          .then(route);
      });
    }).catch(function (e) {
      free();
      var s = el('adSay');
      if (s) s.textContent = A.textOf(e);
    });
  }

  function logout() {
    var t = A.token();
    A.setSession(null);
    me = null;
    d = {};
    if (t) A.call('/cab/logout', { body: {} }).catch(function () {});
    note('ok', 'Вышли.');
    paint();
  }

  /* Содержимое: сохраняем целиком — служба хранит снимок, а не поля по одному.
     Так проще откатить и проще выгрузить обратно в файлы репозитория. */
  function saveContent(data, ok) {
    var say = el('adCSay');
    if (say) say.textContent = 'Сохраняем…';
    A.call('/adm/content', { body: { key: sub, data: data } }).then(function (r) {
      d.edit = null;
      note('ok', (r && r.text) || ok || 'Сохранили.');
      reload();
    }).catch(function (e) {
      var s = el('adCSay');
      if (s) s.textContent = A.textOf(e);
    });
  }

  function newsData() {
    var c = d.content || {};
    var data = c.data || {};
    if (!data.items) data.items = [];
    return data;
  }

  function act(name, node) {
    var i = node ? Number(node.getAttribute('data-i')) : -1;
    var id = node ? node.getAttribute('data-id') : '';
    var nick = node ? node.getAttribute('data-n') : '';

    /* --- вход-выход --- */
    if (name === 'in') return doLogin();
    if (name === 'out') return logout();

    /* --- обращения --- */
    if (name === 't-reply' || name === 't-wait' || name === 't-done') {
      var t = d.ticket || {};
      var say = el('adTSay');
      var txt = val('adRep');
      if (name === 't-reply' && !txt) {
        if (say) say.textContent = 'Пустой ответ отправлять некуда.';
        return;
      }
      var free = busy(node, 'Отправляем…');
      var p = name === 't-reply'
        ? A.call('/adm/ticket/reply', { body: { id: t.id, text: txt } })
        : A.call('/adm/ticket/state', {
          body: { id: t.id, status: name === 't-done' ? 'done' : 'wait', note: txt }
        });
      p.then(function (r) {
        note('ok', (r && r.text) || 'Готово.');
        if (name === 't-reply') reload();
        else { open = null; go('tickets'); }
      }).catch(function (e) {
        free();
        var s = el('adTSay');
        if (s) s.textContent = A.textOf(e);
      });
      return;
    }

    /* --- новости --- */
    if (name === 'n-ed') { d.edit = i; paint(); return; }
    if (name === 'n-cancel') { d.edit = null; paint(); return; }
    if (name === 'n-up') {
      var nd = newsData();
      if (i > 0) {
        var x = nd.items[i - 1];
        nd.items[i - 1] = nd.items[i];
        nd.items[i] = x;
        saveContent(nd, 'Переставили.');
      }
      return;
    }
    if (name === 'n-del') {
      var nd2 = newsData();
      var it = nd2.items[i];
      if (!it || !confirm('Убрать новость «' + (it.title || '') + '» с главной?')) return;
      nd2.items.splice(i, 1);
      saveContent(nd2, 'Убрали с главной.');
      return;
    }
    if (name === 'n-save') {
      var nd3 = newsData();
      var item = {
        id: i >= 0 && nd3.items[i] ? nd3.items[i].id : 'n' + Date.now(),
        date: val('nDate'), title: val('nTitle'), text: val('nText')
      };
      var s2 = el('adCSay');
      if (!item.title || !item.text) {
        if (s2) s2.textContent = 'Нужны заголовок и текст.';
        return;
      }
      if (i >= 0) nd3.items[i] = item;
      else nd3.items.unshift(item);
      saveContent(nd3, i >= 0 ? 'Новость поправили.' : 'Новость на главной.');
      return;
    }

    /* --- каналы --- */
    if (name === 's-add') {
      var sd = (d.content && d.content.data) || {};
      if (!sd.channels) sd.channels = [];
      var cid = val('sId');
      var s3 = el('adCSay');
      if (!cid) { if (s3) s3.textContent = 'Впиши канал.'; return; }
      sd.channels.push({
        platform: val('sPlat') || (el('sPlat') ? el('sPlat').value : 'twitch'),
        id: cid, name: val('sName') || cid, owner: val('sNick')
      });
      saveContent(sd, 'Канал добавлен.');
      return;
    }
    if (name === 's-del') {
      var sd2 = (d.content && d.content.data) || {};
      if (!sd2.channels || !sd2.channels[i]) return;
      if (!confirm('Убрать канал «' + (sd2.channels[i].name || '') + '»?')) return;
      sd2.channels.splice(i, 1);
      saveContent(sd2, 'Канал убран.');
      return;
    }

    /* --- темы обращений --- */
    if (name === 'c-off') {
      var td = (d.content && d.content.data) || {};
      var c = td.categories && td.categories[i];
      if (!c) return;
      c.off = !c.off;
      saveContent(td, c.off ? 'Тему спрятали.' : 'Тему вернули.');
      return;
    }

    /* --- вики --- */
    if (name === 'w-ed') { d.edit = i; paint(); return; }
    if (name === 'w-cancel') { d.edit = null; paint(); return; }
    if (name === 'w-save') {
      var wd = (d.content && d.content.data) || {};
      var pg = wd.pages && wd.pages[i];
      if (!pg) return;
      pg.title = val('wTitle') || pg.title;
      pg.body = el('wBody') ? el('wBody').value : pg.body;
      saveContent(wd, 'Страницу сохранили.');
      return;
    }

    /* --- команда --- */
    if (name === 'st-rev') { d.rev = nick; paint(); return; }
    if (name === 'rv-cancel') { d.rev = null; paint(); return; }
    if (name === 'rv-save') {
      var score = el('rvScore') ? el('rvScore').value : '';
      var noteTxt = val('rvNote');
      var s4 = el('adSSay');
      if (!noteTxt) { if (s4) s4.textContent = 'Балл без объяснения — это не оценка.'; return; }
      var free2 = busy(node, 'Записываем…');
      A.call('/adm/staff/review', {
        body: { nick: d.rev, score: Number(score), note: noteTxt }
      }).then(function (r) {
        d.rev = null;
        note('ok', (r && r.text) || 'Записали.');
        reload();
      }).catch(function (e) {
        free2();
        var s = el('adSSay');
        if (s) s.textContent = A.textOf(e);
      });
      return;
    }
    if (name === 'st-exam') {
      d.exNick = nick;
      go('exams');
      return;
    }
    if (name === 'ap-exam') {
      d.exNick = nick;
      d.exRole = node.getAttribute('data-r') || '';
      A.call('/adm/staff/apply', { body: { id: id, verdict: 'exam', note: '' } })
        .then(function () { go('exams'); }, fail);
      return;
    }
    if (name === 'ap-no') {
      var why = prompt('Что написать в отказе? Человек это увидит.');
      if (why == null) return;
      A.call('/adm/staff/apply', { body: { id: id, verdict: 'no', note: why } })
        .then(function (r) {
          note('ok', (r && r.text) || 'Отказали.');
          reload();
        }, fail);
      return;
    }

    /* --- экзамены --- */
    if (name === 'ex-issue') {
      var eNick = val('exNick');
      var say2 = el('adESay');
      if (!eNick) { if (say2) say2.textContent = 'Кому выдаём?'; return; }
      var free3 = busy(node, 'Собираем вариант…');
      A.call('/adm/exam/issue', {
        body: {
          nick: eNick,
          role: el('exRole') ? el('exRole').value : 'helper',
          level: el('exLevel') ? el('exLevel').value : 'base',
          count: Number(val('exCount')) || 20,
          minutes: Number(val('exMin')) || 60
        }
      }).then(function (r) {
        d.exNick = '';
        note('ok', (r && r.text) || 'Экзамен выдан, кандидат увидит его в кабинете.');
        reload();
      }).catch(function (e) {
        free3();
        var s = el('adESay');
        if (s) s.textContent = A.textOf(e);
      });
      return;
    }
    if (name === 'ex-regen') {
      if (!confirm('Собрать новый вариант? Старый погаснет, и то, что кандидат уже ' +
        'успел ответить, не сохранится.')) return;
      A.call('/adm/exam/regen', { body: { id: open } }).then(function (r) {
        note('ok', (r && r.text) || 'Новый вариант готов.');
        open = (r && r.id) || open;
        reload();
      }, fail);
      return;
    }
    if (name === 'ex-cancel') {
      if (!confirm('Погасить экзамен?')) return;
      A.call('/adm/exam/cancel', { body: { id: open } }).then(function (r) {
        note('ok', (r && r.text) || 'Погасили.');
        open = null;
        go('exams');
      }, fail);
      return;
    }
    if (name === 'ex-pass' || name === 'ex-redo' || name === 'ex-no') {
      var ex = d.exam || {};
      var marks = (ex.questions || []).map(function (q) {
        var sEl = el('q' + q.n + 's'), nEl = el('q' + q.n + 'n');
        return {
          q: q.n,
          score: sEl ? Number(sEl.value) || 0 : (q.score || 0),
          note: nEl ? nEl.value : ''
        };
      });
      var verdict = name === 'ex-pass' ? 'pass' : name === 'ex-redo' ? 'redo' : 'no';
      if (!confirm('Решение: ' + verdictName(verdict) + '. Отправляем кандидату?')) return;
      var free4 = busy(node, 'Отправляем…');
      A.call('/adm/exam/grade', {
        body: { id: ex.id, marks: marks, verdict: verdict, note: val('exNote') }
      }).then(function (r) {
        note('ok', (r && r.text) || 'Решение записано.');
        reload();
      }).catch(function (e) {
        free4();
        var s = el('adESay');
        if (s) s.textContent = A.textOf(e);
      });
      return;
    }

    /* --- настройки --- */
    if (name === 'set-save') {
      var free5 = busy(node, 'Сохраняем…');
      A.call('/adm/settings', {
        body: {
          notice: {
            on: !!(el('ntOn') && el('ntOn').checked),
            text: val('ntText')
          },
          maintenance: {
            on: !!(el('mtOn') && el('mtOn').checked),
            text: val('mtText')
          }
        }
      }).then(function (r) {
        note('ok', (r && r.text) || 'Сохранили.');
        reload();
      }).catch(function (e) {
        free5();
        var s = el('adNSay');
        if (s) s.textContent = A.textOf(e);
      });
      return;
    }
  }

  /* --------------------------------------------------------------- клики */

  body.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;

    var nav = t.closest('[data-nav]');
    if (nav) { location.hash = '#/' + nav.getAttribute('data-nav'); return; }

    var st = t.closest('[data-tst]');
    if (st) { d.tstate = st.getAttribute('data-tst'); reload(); return; }

    var es = t.closest('[data-est]');
    if (es) { d.estate = es.getAttribute('data-est'); reload(); return; }

    var sb = t.closest('[data-sub]');
    if (sb) { sub = sb.getAttribute('data-sub'); d.edit = null; reload(); return; }

    var a = t.closest('[data-act]');
    if (a) { e.preventDefault(); act(a.getAttribute('data-act'), a); }
  });

  body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (!t || t.tagName === 'TEXTAREA') return;
    if (t.id === 'adNick' || t.id === 'adPass') { e.preventDefault(); doLogin(); }
  });

  /* -------------------------------------------------------------- маршрут */

  function route() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var m = h.match(/^t\/(.+)$/);
    if (m) return go('tickets', decodeURIComponent(m[1]));
    m = h.match(/^e\/(.+)$/);
    if (m) return go('exams', decodeURIComponent(m[1]));
    var known = { home: 1, tickets: 1, content: 1, staff: 1, exams: 1, settings: 1, log: 1 };
    go(known[h] ? h : 'home');
  }

  function start() {
    if (!A.base()) return paintOffline();
    if (!A.token()) return paintLogin();
    loading();
    loadMe().then(function () {
      if (!me.admin) return paint();
      /* Обзор нужен всегда: из него берутся цифры на кнопках меню. */
      return A.call('/adm/overview').then(function (r) { d.home = r; }, function () {})
        .then(route);
    }).catch(function (e) {
      if (e && e.code === 'auth') { A.setSession(null); me = null; paintLogin(); }
      else fail(e);
    });
  }

  window.addEventListener('hashchange', function () {
    if (me && me.admin) route();
  });

  start();
})();
