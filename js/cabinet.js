/* AEGIS — личный кабинет.

   Кабинет живой только вместе со службой сервера: адрес задан в js/config.js,
   пока его нет — страница честно говорит, что раздел включится с сервером, и
   не изображает работу.

   Вход отдельный от игрового. Игровой POST /auth/login возвращает пропуск для
   запуска клиента и билет, привязанный к адресу игрока, — такому в браузере
   делать нечего. Поэтому у сайта своя пара запросов /cab/*, которая отдаёт
   только веб-ключ на время вкладки.

   Что служба должна уметь (всё в общем виде ответа: HTTP 200 и либо
   {ok:true, ...}, либо {ok:false, code, text}):

   POST /cab/login   {nick, pass}
        -> {ok, token, until, nick, role, admin}
   POST /cab/logout                                   (Bearer)  -> {ok}
   GET  /cab/me                                       (Bearer)
        -> {ok, nick, uuid, role, admin, coins, online, firstAt, lastAt,
            playedMin, country, countryName,
            skin:{has, model}, link:{provider, name},
            punish:[P], prizes:[Z], orders:[O], lands:{n, debt}}
   GET  /cab/coins?limit=60                           (Bearer)
        -> {ok, coins, paid, rows:[{at, delta, why, by}]}
   GET  /cab/lands                                    (Bearer)
        -> {ok, max, taxPct, debt, nextAt, rows:[L]}
   POST /cab/password {old, new}                      (Bearer)  -> {ok, text}
   POST /cab/prize {id}                               (Bearer)  -> {ok, text, coins}

   Только для команды (admin:true):
   GET  /cab/admin/players?q=&limit=60
        -> {ok, rows:[{nick, online, lastAt, coins, country, bans}]}
   GET  /cab/admin/player?nick=
        -> {ok, nick, uuid, online, lastAt, firstAt, playedMin, coins,
            country, countryName, ip, punish:[P]}
   GET  /cab/admin/bans     -> {ok, rows:[P с полем nick]}
   GET  /cab/admin/chat?since=&limit=200&q=
        -> {ok, at, rows:[{at, nick, text, kind}]}   kind: chat|cmd|sys
   POST /cab/admin/punish {nick, kind, minutes, reason}  -> {ok, text}
   POST /cab/admin/pardon {nick, id}                     -> {ok, text}
   POST /cab/admin/give {nick, coins, why}               -> {ok, text, coins}

   P = {id, kind:"warn|mute|kick|ban", reason, at, until, by, active}
   L = {id, name, country, chunks, price, tax, boughtAt, nextAt, debt, cutAt}
       price и tax считает игра, сайт их только показывает: два счёта в двух
       местах разойдутся, и на сайте будет одна сумма, а спишется другая.
       debt — недоимка по этой земле, cutAt — когда её заберут (0, если долга нет)
   Z = {id, name, text, coins, at, taken}
   O = {id, name, rub, coin, at, status:"wait|paid|failed"}  — те же слова,
       что отдаёт GET /shop/order, чтобы у заказа было одно состояние на всё

   Времена — миллисекунды (как Date.now()). until:0 = навсегда. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var body = document.getElementById('cbBody');
  if (!body || !A) return;

  /* --------------------------------------------------------------- состояние */

  var me = null;        // ответ /cab/me
  var view = 'me';
  var pnick = '';       // чей профиль открыла команда
  var msg = null;       // разовая полоска ответа {k:'ok'|'bad', t:'...'}
  var showPass = false;

  var coins = null;     // история червонцев
  var lands = null;     // свои провинции: цена, налог, сроки
  var players = null;   // список игроков для команды
  var bans = null;      // действующие наказания
  var pcard = null;     // карточка одного игрока
  var chat = { rows: [], at: 0, q: '' };
  var exam = null;      // выданный экзамен на должность, если он есть
  var poll = 0;

  var NAV = [
    ['me', 'Профиль'],
    ['coins', 'Червонцы'],
    ['lands', 'Провинции'],
    ['punish', 'Наказания'],
    ['prizes', 'Награды']
  ];
  /* «Все наказания» — не «Наказания»: в узком меню разделитель «Команда»
     прячется, и два одинаковых пункта стояли бы рядом. */
  var ANAV = [
    ['players', 'Игроки'],
    ['chat', 'Чат сервера'],
    ['bans', 'Все наказания']
  ];

  var KIND = {
    warn: ['Предупреждение', 'gold'],
    mute: ['Мут', 'gold'],
    kick: ['Кик', 'red'],
    ban: ['Бан', 'red']
  };

  /* --------------------------------------------------------------- помощники */

  var esc = A.esc;

  function plural(n, f) {
    n = Math.abs(Math.floor(n)) % 100;
    var d = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (d > 1 && d < 5) return f[1];
    if (d === 1) return f[0];
    return f[2];
  }

  /* Баланс показываем точно, до червонца: «1 240», а не «1,2 тыс». */
  function money(n) {
    n = Math.round(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function hours(min) {
    min = Math.max(0, Math.round(Number(min) || 0));
    if (min < 60) return min + ' ' + plural(min, ['минута', 'минуты', 'минут']);
    var h = Math.floor(min / 60);
    if (h < 48) return h + ' ' + plural(h, ['час', 'часа', 'часов']);
    var d = Math.floor(h / 24);
    return d + ' ' + plural(d, ['день', 'дня', 'дней']);
  }

  function date(ts) {
    ts = Number(ts) || 0;
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  /* Там, где важен только день («играет с 6 июля»), час только мешает. */
  function day(ts) {
    ts = Number(ts) || 0;
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    } catch (e) { return ''; }
  }

  /* «Через сколько». У налога и конфискации важен день, а не час: человеку
     нужно понять, успевает он до выходных или нет. */
  function leftDays(ts) {
    var ms = (Number(ts) || 0) - Date.now();
    if (ms <= 0) return 'уже сегодня';
    var d = Math.ceil(ms / 86400000);
    return 'через ' + d + ' ' + plural(d, ['день', 'дня', 'дней']);
  }

  function clock(ts) {
    ts = Number(ts) || 0;
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* Сколько наказанию осталось. 0 в поле until — «навсегда».
     Предупреждение и кик срока не имеют: они разовые, «снято» про них врало бы. */
  function left(p) {
    if (p.kind === 'warn' || p.kind === 'kick') return 'разово';
    if (!p.active) {
      return (p.until && Number(p.until) < Date.now()) ? 'истекло' : 'снято';
    }
    if (!p.until) return 'навсегда';
    var m = Math.round((Number(p.until) - Date.now()) / 60000);
    if (m <= 0) return 'истекло';
    return 'ещё ' + hours(m);
  }

  function pill(kind) {
    var k = KIND[kind] || [kind, 'gold'];
    return '<span class="pill ' + k[1] + '">' + esc(k[0]) + '</span>';
  }

  function note(k, t) { msg = { k: k, t: t }; }

  function flash() {
    if (!msg) return '';
    var h = '<div class="cb-msg ' + (msg.k === 'ok' ? 'ok' : 'bad') + '">' +
      esc(msg.t) + '</div>';
    msg = null;   // полоска разовая: показали и убрали
    return h;
  }

  function fail(e) {
    if (e && e.code === 'auth') {
      me = null;
      A.setSession(null);
      note('bad', A.textOf(e));
      paint();
      return;
    }
    note('bad', A.textOf(e));
    paint();
  }

  function el(id) { return document.getElementById(id); }
  function val(id) { var n = el(id); return n ? String(n.value || '').trim() : ''; }

  function empty(title, text) {
    return '<div class="empty"><h4>' + esc(title) + '</h4><p>' + text + '</p></div>';
  }

  /* --------------------------------------------------------------- загрузка */

  function loadMe() {
    return A.call('/cab/me').then(function (d) {
      me = d;
      if (!me.admin && ANAV.some(function (n) { return n[0] === view; })) view = 'me';
      if (!me.exam && view === 'exam') view = 'me';
    });
  }

  function loadCoins() {
    return A.call('/cab/coins?limit=60').then(function (d) { coins = d; });
  }

  /* Свои провинции. Ни цену, ни налог, ни сроки сайт не считает: их знает
     игра, а два счёта в двух местах однажды разойдутся — и человек увидит
     на сайте одну сумму, а в игре спишется другая. */
  function loadLands() {
    return A.call('/cab/lands').then(function (d) { lands = d; });
  }

  function loadPlayers(q) {
    return A.call('/cab/admin/players?limit=60&q=' + encodeURIComponent(q || ''))
      .then(function (d) { players = d; players.q = q || ''; });
  }

  function loadBans() {
    return A.call('/cab/admin/bans').then(function (d) { bans = d; });
  }

  function loadCard(nick) {
    return A.call('/cab/admin/player?nick=' + encodeURIComponent(nick))
      .then(function (d) { pcard = d; });
  }

  /* Чат подтягиваем кусками: первый раз — хвост, дальше только новое. */
  function loadChat(first) {
    var url = '/cab/admin/chat?limit=200&q=' + encodeURIComponent(chat.q);
    if (!first && chat.at) url += '&since=' + chat.at;
    return A.call(url).then(function (d) {
      var add = (d && d.rows) || [];
      chat.at = Number(d && d.at) || chat.at;
      chat.rows = first ? add : chat.rows.concat(add);
      if (chat.rows.length > 400) chat.rows = chat.rows.slice(-400);
      return add.length;
    });
  }

  /* Экзамен на должность. Вопросы приходят уже собранными под этого человека,
     правильных ответов в них нет — их знает только сервер, иначе вариант можно
     было бы прочитать прямо в браузере и разослать друзьям. */
  function loadExam() {
    return A.call('/cab/exam').then(function (d) { exam = d; });
  }

  function need() {
    if (view === 'exam' && !exam) return loadExam();
    if (view === 'coins' && !coins) return loadCoins();
    if (view === 'lands' && !lands) return loadLands();
    if (view === 'players' && !players) return loadPlayers('');
    if (view === 'bans' && !bans) return loadBans();
    if (view === 'chat' && !chat.at) return loadChat(true);
    if (view === 'player' && (!pcard || pcard.nick !== pnick)) return loadCard(pnick);
    return Promise.resolve();
  }

  function go(v, nick) {
    view = v;
    if (nick) pnick = nick;
    showPass = false;
    loading();
    need().then(paint, fail);
  }

  function loading() {
    body.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
  }

  /* ------------------------------------------------------------ нет службы */

  function paintOffline() {
    var reg = 'reg.html', dis = A.link('discord');
    body.innerHTML =
      '<div class="cab-login"><h2>Кабинет включится вместе с сервером</h2>' +
      '<p class="cl-lead">Личный кабинет работает от службы игрового сервера. ' +
      'Пока сезон готовится, показывать тут нечего — как только сервер поднимется, ' +
      'вход появится на этой же странице.</p></div>' +
      '<div class="cab-why"><h4>Что будет внутри</h4><ul>' +
      '<li>сколько у тебя червонцев и на что они уходили;</li>' +
      '<li>наказания: за что, на сколько и когда кончатся;</li>' +
      '<li>награды с розыгрышей — забрать себе;</li>' +
      '<li>скин, привязка аккаунта и смена пароля;</li>' +
      '<li>у команды — игроки, чат сервера и наказания.</li>' +
      '</ul><p style="margin-top:14px">Пока можно ' +
      '<a href="' + reg + '">завести аккаунт</a>' +
      (dis ? ' и заглянуть в <a href="' + esc(dis) + '" target="_blank" rel="noopener">Discord</a>' : '') +
      ' — данные не пропадут, кабинет подхватит их сам.</p></div>';
  }

  /* ---------------------------------------------------------------- вход */

  function paintLogin() {
    body.innerHTML = flash() +
      '<div class="cab-login"><h2>Вход в кабинет</h2>' +
      '<p class="cl-lead">Имя и пароль те же, что в лаунчере. Вход держится ' +
      'до закрытия вкладки и не пускает в игру — это только сайт.</p>' +
      '<div class="field"><label for="cbNick">Игровое имя</label>' +
      '<input id="cbNick" type="text" autocomplete="username" ' +
      'spellcheck="false" placeholder="Например, VineZerro"></div>' +
      '<div class="field"><label for="cbPass">Пароль</label>' +
      '<input id="cbPass" type="password" autocomplete="current-password" ' +
      'placeholder="Пароль от аккаунта"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="in">Войти</button>' +
      '<span class="fg-note" id="cbSay"></span></div></div>' +
      '<div class="cab-why"><h4>Если не заходит</h4><ul>' +
      '<li>аккаунта ещё нет — <a href="reg.html">заведи его</a>, это пара минут;</li>' +
      '<li>забыл пароль — напиши <a href="tickets.html#/help">обращение</a>, ' +
      'команда сбросит после проверки;</li>' +
      '<li>пароль не подходит после бана — кабинет всё равно откроется, ' +
      'наказание там видно.</li></ul></div>';
    var n = el('cbNick');
    if (n) n.focus();
  }

  function doLogin() {
    var nick = val('cbNick'), pass = val('cbPass');
    var say = el('cbSay');
    if (!nick || !pass) {
      if (say) say.textContent = 'Впиши имя и пароль.';
      return;
    }
    var btn = body.querySelector('[data-act="in"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Входим…'; }
    if (say) say.textContent = '';

    A.call('/cab/login', { body: { nick: nick, pass: pass } }).then(function (d) {
      A.setSession({
        token: d.token, nick: d.nick || nick,
        role: d.role || '', admin: !!d.admin, until: d.until || 0
      });
      loading();
      return loadMe().then(paint);
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
      var s = el('cbSay');
      if (s) s.textContent = A.textOf(e);
    });
  }

  /* ------------------------------------------------------------ боковина */

  function side() {
    var letter = esc((me.nick || '?').charAt(0).toUpperCase());
    var skin = me.skin && me.skin.has
      ? A.base() + '/skins/' + encodeURIComponent(me.nick) + '.png'
      : '';
    var av = '<div class="cm-av"><span class="cm-let">' + letter + '</span>' +
      (skin ? '<img src="' + esc(skin) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '</div>';

    var sub = me.online ? 'сейчас на сервере'
      : (me.lastAt ? 'заходил ' + A.ago(me.lastAt) : 'ещё не заходил');
    if (me.role) sub = esc(me.role) + ' · ' + sub;

    var n = '<nav class="cab-nav">';
    NAV.forEach(function (t) {
      var b = '';
      if (t[0] === 'coins') b = money(me.coins);
      /* Значок у «Провинций» — восклицательный знак при недоимке: это
         единственное место в кабинете, где промедление стоит земли. */
      if (t[0] === 'lands') b = me.lands && me.lands.debt ? '!' : String(me.lands && me.lands.n || '');
      if (t[0] === 'punish') b = String(actives(me.punish).length || '');
      if (t[0] === 'prizes') b = String(unTaken(me.prizes).length || '');
      n += btn(t[0], t[1], b);
    });
    /* Пункт появляется, только пока экзамен висит на человеке: у остальных
       такого раздела в кабинете нет и знать о нём незачем. */
    if (me.exam) n += btn('exam', 'Экзамен', me.exam.state === 'issued' ? '!' : '');
    if (me.admin) {
      n += '<div class="cn-t">Команда</div>';
      ANAV.forEach(function (t) { n += btn(t[0], t[1], ''); });
      /* Управление сайтом живёт отдельной страницей: сюда её не тащим, но
         искать по закладкам тоже не заставляем. */
      n += '<a class="cn-go" href="admin.html">Управление сайтом</a>';
    }
    n += '</nav>';

    return '<aside class="cab-side">' +
      '<div class="cab-me">' + av + '<div><div class="cm-n">' + esc(me.nick) +
      '</div><div class="cm-s">' + sub + '</div></div></div>' + n +
      '<div class="cab-out">Вход держится до закрытия вкладки. ' +
      '<button type="button" data-act="out">Выйти</button></div></aside>';
  }

  function btn(id, title, badge) {
    var on = (view === id) || (view === 'player' && id === 'players');
    return '<button type="button" data-nav="' + id + '"' + (on ? ' class="on"' : '') +
      '>' + esc(title) +
      (badge ? '<span class="cn-b">' + esc(badge) + '</span>' : '') + '</button>';
  }

  function actives(list) {
    return (list || []).filter(function (p) { return p.active; });
  }
  function unTaken(list) {
    return (list || []).filter(function (z) { return !z.taken; });
  }

  /* ------------------------------------------------------------- разделы */

  function tile(k, v, s) {
    return '<div class="tile"><div class="t-k">' + esc(k) + '</div>' +
      '<div class="t-v">' + esc(v) + '</div>' +
      (s ? '<div class="t-s">' + s + '</div>' : '') + '</div>';
  }

  function row(t, s, r) {
    return '<div class="row r2"><div><div class="rw-t">' + t + '</div>' +
      (s ? '<div class="rw-s">' + s + '</div>' : '') + '</div>' +
      '<div class="rw-r">' + (r || '') + '</div></div>';
  }

  function viewMe() {
    var act = actives(me.punish);
    var tiles =
      tile('Червонцы', money(me.coins),
        'Тратятся в лавке. <a href="donate.html">Пополнить</a>') +
      tile('Наиграно', me.playedMin ? hours(me.playedMin) : 'нисколько',
        me.firstAt ? 'играет с ' + esc(day(me.firstAt)) : '') +
      tile('Страна', me.countryName || me.country || 'нет',
        me.countryName ? 'приват по историческим границам' : 'выбирается на сервере') +
      tile('Наказания', act.length ? String(act.length) : 'нет',
        act.length ? 'смотри раздел «Наказания»' : 'чисто, так держать');

    var link = me.link && me.link.provider
      ? esc(me.link.name || me.link.provider)
      : 'не привязан';
    var acc = '<div class="row-list">' +
      row('Игровое имя', 'меняется только через обращение', esc(me.nick)) +
      row('Привязка входа',
        'один аккаунт на человека — привязка сохраняется даже после бана', link) +
      row('Скин', 'загружается на отдельной странице',
        (me.skin && me.skin.has ? 'свой' : 'стандартный') +
        ' · <a href="profile.html">поменять</a>') +
      row('Пароль', 'тот же, что в лаунчере',
        '<button class="btn btn-dark btn-sm" data-act="pw">Сменить</button>') +
      '</div>';

    var pw = showPass ? passForm() : '';

    var ord = '';
    if (me.orders && me.orders.length) {
      ord = '<div class="cab-block"><h2>Покупки</h2><div class="row-list">' +
        me.orders.map(function (o) {
          var st = o.status === 'paid' ? '<span class="pill green">зачислено</span>'
            : o.status === 'failed' ? '<span class="pill red">не прошло</span>'
              : '<span class="pill gold">ждём оплату</span>';
          return row(esc(o.name || 'Заказ'),
            esc(date(o.at)) + ' · ' + (o.rub ? esc(o.rub) + ' ₽' : '') +
            (o.coin ? ' · ' + money(o.coin) + ' червонцев' : ''), st);
        }).join('') + '</div></div>';
    }

    return '<div class="cab-tiles">' + tiles + '</div>' +
      '<div class="cab-block"><h2>Аккаунт</h2>' + acc + pw + '</div>' + ord;
  }

  function passForm() {
    return '<div class="cab-block"><h2>Смена пароля</h2>' +
      '<p class="cab-hint">Пароль один и для сайта, и для лаунчера: после смены ' +
      'заходить в игру нужно уже новым.</p>' +
      '<div style="max-width:430px">' +
      '<div class="field"><label for="pwOld">Нынешний пароль</label>' +
      '<input id="pwOld" type="password" autocomplete="current-password"></div>' +
      '<div class="field"><label for="pwNew">Новый пароль <em>от 8 знаков</em></label>' +
      '<input id="pwNew" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="pwNew2">Ещё раз новый</label>' +
      '<input id="pwNew2" type="password" autocomplete="new-password"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="pwgo">Сменить пароль</button>' +
      '<button class="btn btn-dark" data-act="pwoff">Отмена</button>' +
      '<span class="fg-note" id="pwSay"></span></div></div></div>';
  }

  function doPass() {
    var a = val('pwOld'), b = val('pwNew'), c = val('pwNew2');
    var say = el('pwSay');
    function bad(t) { if (say) say.textContent = t; }
    if (!a || !b) return bad('Заполни оба поля.');
    if (b.length < 8) return bad('Новый пароль короче восьми знаков.');
    if (b !== c) return bad('Новые пароли не совпали.');
    if (a === b) return bad('Новый пароль совпадает со старым.');

    var btn = body.querySelector('[data-act="pwgo"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Меняем…'; }
    bad('');
    A.call('/cab/password', { body: { old: a, 'new': b } }).then(function (d) {
      showPass = false;
      note('ok', d.text || 'Пароль сменили. В лаунчере заходи уже новым.');
      paint();
    }, function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Сменить пароль'; }
      bad(A.textOf(e));
    });
  }

  /* ------------------------------------------------------- экзамен на пост */

  /* Сколько осталось до конца — словами, без секундомера над душой. */
  function examLeft(until) {
    if (!until) return 'без ограничения по времени';
    var m = Math.round((Number(until) - Date.now()) / 60000);
    if (m <= 0) return 'время вышло';
    if (m < 60) return 'осталось ' + m + ' ' + plural(m, ['минута', 'минуты', 'минут']);
    var h = Math.floor(m / 60);
    return 'осталось ' + h + ' ' + plural(h, ['час', 'часа', 'часов']) + ' ' + (m % 60) + ' мин';
  }

  function viewExam() {
    var e = exam || {};
    var qs = e.questions || [];

    if (e.state === 'done') {
      return '<div class="cab-block"><h2>Экзамен сдан</h2>' +
        empty('Ждём проверку',
          'Ответы ушли старшим. Открытые вопросы читает человек, поэтому ответ не ' +
          'мгновенный — итог появится здесь же.') + '</div>';
    }

    if (e.state === 'graded') {
      var v = e.verdict === 'pass' ? '<span class="pill green">принят</span>'
        : e.verdict === 'redo' ? '<span class="pill gold">на доработку</span>'
          : '<span class="pill red">не прошёл</span>';
      var marks = qs.length ? '<div class="row-list">' + qs.map(function (q) {
        return row(esc(q.text),
          (q.note ? esc(q.note) : (q.score === q.max ? 'верно' : 'не засчитано')),
          '<span class="pill' + (q.score === q.max ? ' green' : '') + '">' +
          esc(q.score != null ? q.score : 0) + '/' + esc(q.max || 1) + '</span>');
      }).join('') + '</div>' : '';

      return '<div class="cab-tiles">' +
        tile('Итог', (e.score != null ? String(e.score) : '—'), v) +
        tile('Должность', esc(e.roleName || e.role || ''), 'на что сдавал') +
        '</div>' +
        (e.note ? '<div class="nbox"><span class="n-ic">!</span><div>' + esc(e.note) +
          '</div></div>' : '') +
        (marks ? '<div class="cab-block"><h2>По вопросам</h2>' + marks + '</div>' : '');
    }

    if (!qs.length) {
      return empty('Экзамена сейчас нет',
        'Когда старшие выдадут вариант, он появится здесь.');
    }

    /* Вопросы. Отвеченное сервер помнит: закрыл вкладку — вернулся и дописал. */
    var list = qs.map(function (q) {
      var head = '<div class="ad-q-h">' + q.n + '. ' + esc(q.text) + '</div>';
      var b;
      if (q.kind === 'open') {
        b = '<div class="field"><textarea id="ex' + q.n + '" rows="5" ' +
          'placeholder="Своими словами. Оценивает человек, шаблон видно сразу.">' +
          esc(q.answer || '') + '</textarea></div>';
      } else {
        var many = q.kind === 'many';
        b = '<div class="ex-opts">' + (q.options || []).map(function (o, i) {
          var on = Array.isArray(q.answer) ? q.answer.indexOf(i) >= 0
            : Number(q.answer) === i;
          return '<label class="ex-o"><input type="' + (many ? 'checkbox' : 'radio') +
            '" name="ex' + q.n + '" value="' + i + '"' + (on ? ' checked' : '') +
            '><span>' + esc(o) + '</span></label>';
        }).join('') + '</div>' +
          (many ? '<div class="ex-note">Верных вариантов может быть несколько.</div>' : '');
      }
      return '<div class="ad-q" data-exq="' + q.n + '" data-kind="' + esc(q.kind) + '">' +
        head + b + '</div>';
    }).join('');

    return '<div class="cab-tiles">' +
      tile('Должность', esc(e.roleName || e.role || ''), 'вариант ' + esc(e.variant || '')) +
      tile('Вопросов', String(qs.length), examLeft(e.until)) +
      '</div>' +
      '<p class="cab-hint">Вариант собран лично под тебя: у другого кандидата вопросы, ' +
      'порядок ответов и числа в задачах другие — чужие готовые ответы не подойдут. ' +
      'Ответы сохраняются на сервере, вкладку можно закрыть и вернуться. Отправишь — ' +
      'править уже нельзя.</p>' +
      '<div class="cab-block"><h2>Вопросы</h2>' + list +
      '<div class="form-go">' +
      '<button class="btn btn-dark" data-act="exsave">Сохранить</button>' +
      '<button class="btn btn-primary" data-act="exsend">Отправить на проверку</button>' +
      '<span class="fg-note" id="exSay"></span></div></div>';
  }

  /* Собираем ответы со страницы в тот вид, что ждёт служба. */
  function examAnswers() {
    var out = [];
    body.querySelectorAll('[data-exq]').forEach(function (box) {
      var n = Number(box.getAttribute('data-exq'));
      var kind = box.getAttribute('data-kind');
      if (kind === 'open') {
        var t = box.querySelector('textarea');
        out.push({ q: n, a: t ? t.value : '' });
      } else if (kind === 'many') {
        var picks = [];
        box.querySelectorAll('input:checked').forEach(function (i) {
          picks.push(Number(i.value));
        });
        out.push({ q: n, a: picks });
      } else {
        var one = box.querySelector('input:checked');
        out.push({ q: n, a: one ? Number(one.value) : null });
      }
    });
    return out;
  }

  function examSend(final, btn) {
    var say = el('exSay');
    var ans = examAnswers();
    if (final) {
      var miss = ans.filter(function (a) {
        return a.a == null || a.a === '' || (Array.isArray(a.a) && !a.a.length);
      }).length;
      if (miss && !confirm('Без ответа ' + miss + ' ' +
        plural(miss, ['вопрос', 'вопроса', 'вопросов']) +
        '. Всё равно отправить? Дописать потом уже нельзя.')) return;
      if (!miss && !confirm('Отправляем на проверку? Править ответы после этого нельзя.')) return;
    }
    if (btn) { btn.disabled = true; btn.textContent = final ? 'Отправляем…' : 'Сохраняем…'; }
    if (say) say.textContent = '';
    A.call(final ? '/cab/exam/submit' : '/cab/exam/save', {
      body: { id: exam.id, answers: ans }
    }).then(function (d) {
      exam = null;
      note('ok', (d && d.text) ||
        (final ? 'Отправили. Итог придёт сюда же.' : 'Сохранили, можно вернуться позже.'));
      go('exam');
    }, function (er) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = final ? 'Отправить на проверку' : 'Сохранить';
      }
      if (say) say.textContent = A.textOf(er);
    });
  }

  function viewCoins() {
    var rows = (coins && coins.rows) || [];
    var bal = coins && coins.coins != null ? coins.coins : me.coins;

    var list = rows.length
      ? '<div class="row-list">' + rows.map(function (r) {
        var d = Number(r.delta) || 0;
        var sign = d > 0 ? '+' : '−';
        var col = d > 0 ? 'green' : 'red';
        return row(esc(r.why || (d > 0 ? 'Начисление' : 'Списание')),
          esc(date(r.at)) + (r.by ? ' · ' + esc(r.by) : ''),
          '<span class="pill ' + col + '">' + sign + ' ' + money(Math.abs(d)) + '</span>');
      }).join('') + '</div>'
      : empty('Движений пока не было',
        'Как только червонцы начнут приходить и уходить, всё будет видно тут.');

    var got = 0, spent = 0;
    rows.forEach(function (r) {
      var d = Number(r.delta) || 0;
      if (d > 0) got += d; else spent -= d;
    });

    /* paid — сколько из баланса куплено за рубли. Такие червонцы тратятся
       последними, и человек имеет право видеть, сколько их у него осталось. */
    var paid = coins && coins.paid != null ? Number(coins.paid) || 0 : 0;

    return '<div class="cab-tiles">' +
      tile('На счету', money(bal),
        (paid > 0 ? money(paid) + ' куплено за рубли' :
          plural(bal, ['червонец', 'червонца', 'червонцев'])) +
        ' · <a href="donate.html">пополнить</a>') +
      tile('Пришло', money(got), 'за последние ' + rows.length + ' ' +
        plural(rows.length, ['движение', 'движения', 'движений'])) +
      tile('Потрачено', money(spent), 'покупки в лавке и списания') +
      '</div>' +
      '<div class="cab-block"><h2>История</h2>' +
      '<p class="cab-hint">Червонцы <b>переживают вайп</b>: счёт остаётся с ' +
      'тобой и в новом сезоне. Вещи, постройки и земля — нет, их выдаёт мир, ' +
      'а мир начинается заново.' +
      (paid > 0 ? ' Купленные за рубли червонцы списываются последними — ' +
        'сначала уходит заработанное в игре.' : '') + '</p>' + list + '</div>';
  }

  function landRow(r) {
    var debt = Number(r.debt) || 0;
    var sub = [];
    if (r.country) sub.push(esc(r.country));
    if (r.chunks) {
      sub.push(money(r.chunks) + ' ' + plural(r.chunks, ['чанк', 'чанка', 'чанков']));
    }
    if (r.boughtAt) sub.push('куплена ' + esc(day(r.boughtAt)));
    /* Пока есть долг, дата конфискации важнее даты следующего налога:
       она и решает, останется земля за человеком или нет. */
    if (debt && r.cutAt) {
      sub.push('заберут ' + esc(day(r.cutAt)) + ', ' + leftDays(r.cutAt));
    } else if (r.nextAt) {
      sub.push('налог спишется ' + esc(day(r.nextAt)) + ', ' + leftDays(r.nextAt));
    }

    return '<div class="row r2"><div>' +
      '<div class="rw-t">' + esc(r.name || 'Провинция') +
      (debt ? ' <span class="pill red">недоимка ' + money(debt) + ' Ч</span>' : '') +
      '</div><div class="rw-s">' + sub.join(' · ') + '</div></div>' +
      '<div class="rw-r ln-r"><b>' + money(r.price) + ' Ч</b>' +
      '<span>налог ' + money(r.tax) + ' Ч в неделю</span></div></div>';
  }

  /* «Провинции». Земля — единственное в кабинете, что можно потерять,
     ничего не нарушив: просто не хватило червонцев на налог. Поэтому здесь
     на виду две вещи — сколько списывать и сколько осталось до изъятия. */
  function viewLands() {
    var d = lands || {};
    var rows = d.rows || [];
    var max = Number(d.max) || 3;
    var pct = Number(d.taxPct) || 3;

    if (!rows.length) {
      return empty('Своей земли пока нет',
        'Провинции покупаются на сервере у государства: свободная стоит от ' +
        '100 червонцев, а новичку при первом заходе выдают 150 подъёмных — ' +
        'на первую землю хватает сразу. Что где стоит, видно в списке ' +
        '<a href="lands.html">земель и налогов</a>.');
    }

    var tax = 0, debt = 0, next = 0;
    rows.forEach(function (r) {
      tax += Number(r.tax) || 0;
      debt += Number(r.debt) || 0;
      var n = Number(r.nextAt) || 0;
      if (n && (!next || n < next)) next = n;
    });
    if (d.debt != null) debt = Number(d.debt) || 0;
    if (d.nextAt) next = Number(d.nextAt) || next;

    var weeks = tax > 0 ? Math.floor((Number(me.coins) || 0) / tax) : 0;

    var tiles =
      tile('Провинций', rows.length + ' из ' + max,
        max > 3 ? 'больше даёт звание' : 'звание Офицера даёт +1, Маршала +2') +
      tile('Налог в неделю', money(tax) + ' Ч',
        pct + '% от цены каждой земли') +
      /* Крупно — «через сколько», мелко — дата: человеку сначала важно,
         успевает он или нет, и только потом — какое это число. */
      tile('Ближайшее списание', next ? leftDays(next) : '—',
        next ? esc(day(next)) : 'сроки придут с сервера') +
      (debt
        ? tile('Недоимка', money(debt) + ' Ч',
          'погаси, иначе землю заберут · <a href="donate.html">пополнить</a>')
        : tile('Хватит червонцев', weeks
          ? 'на ' + weeks + ' ' + plural(weeks, ['неделю', 'недели', 'недель'])
          : 'меньше недели',
          weeks ? 'при нынешнем налоге' : 'налог спишется не полностью'));

    var hint = debt
      ? '<p class="cab-hint">Недоимка растёт, пока на счету не хватает на налог. ' +
        'Через 14 дней земля возвращается государству: за неё вернут 75% цены, ' +
        'а постройки достанутся новому хозяину. Гасится она сама, как только ' +
        'червонцы появятся на счету.</p>'
      : '<p class="cab-hint">Налог списывается со счёта сам, раз в неделю. ' +
        'Не хватило — копится недоимка, и через 14 дней землю забирают. ' +
        'Все правила: цена, продажа, переезд — на странице ' +
        '<a href="lands.html">Земли и налоги</a>.</p>';

    return '<div class="cab-tiles">' + tiles + '</div>' +
      '<div class="cab-block"><h2>Мои провинции</h2>' + hint +
      '<div class="row-list">' + rows.map(landRow).join('') + '</div></div>';
  }

  /* nick нужен для кнопки «снять»: без него строка только показывает.
     В своих наказаниях его не передаём — снимать самому себе нечего. */
  function punishRow(p, nick, showNick) {
    var who = showNick && nick ? esc(nick) + ' · ' : '';
    var sub = who + esc(date(p.at)) + (p.by ? ' · выдал ' + esc(p.by) : '');
    var right = esc(left(p));
    if (me.admin && p.active && nick) {
      right += '<button class="btn btn-dark btn-sm" data-act="pardon" ' +
        'data-nick="' + esc(nick) + '" data-id="' + esc(p.id) + '">Снять</button>';
    }
    return '<div class="row"><div>' + pill(p.kind) + '</div>' +
      '<div><div class="rw-t">' + esc(p.reason || 'без пояснения') + '</div>' +
      '<div class="rw-s">' + sub + '</div></div>' +
      '<div class="rw-r">' + right + '</div></div>';
  }

  function viewPunish() {
    var all = me.punish || [];
    if (!all.length) {
      return empty('Наказаний нет',
        'За тобой ничего не числится. Правила лежат в <a href="wiki.html#/rules">вики</a> — ' +
        'загляни, чтобы так и осталось.');
    }
    var act = all.filter(function (p) { return p.active; });
    var old = all.filter(function (p) { return !p.active; });
    var h = '';
    if (act.length) {
      h += '<div class="cab-block"><h2>Действуют сейчас</h2>' +
        '<p class="cab-hint">Считаешь, что наказание несправедливо — не спорь в чате, ' +
        'а напиши <a href="tickets.html#/appeal">обжалование</a>. Разберут по логам.</p>' +
        '<div class="row-list">' + act.map(function (p) { return punishRow(p, '', false); }).join('') +
        '</div></div>';
    }
    if (old.length) {
      h += '<div class="cab-block"><h2>Уже прошли</h2><div class="row-list">' +
        old.map(function (p) { return punishRow(p, '', false); }).join('') + '</div></div>';
    }
    return h;
  }

  function viewPrizes() {
    var all = me.prizes || [];
    if (!all.length) {
      return empty('Наград пока нет',
        'Тут появятся выигрыши с розыгрышей и то, что выдала команда. ' +
        'Забирать нужно самому — просто так на счёт не упадёт.');
    }
    return '<div class="row-list">' + all.map(function (z) {
      var r = z.taken
        ? '<span class="pill green">забрано</span>'
        : '<button class="btn btn-primary btn-sm" data-act="prize" data-id="' +
        esc(z.id) + '">Забрать</button>';
      return row(esc(z.name || 'Награда'),
        esc(z.text || '') + (z.text ? ' · ' : '') + esc(date(z.at)) +
        (z.coins ? ' · ' + money(z.coins) + ' червонцев' : ''), r);
    }).join('') + '</div>';
  }

  function takePrize(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Забираем…'; }
    A.call('/cab/prize', { body: { id: id } }).then(function (d) {
      note('ok', d.text || 'Забрали. Червонцы уже на счету.');
      coins = null;
      return loadMe().then(paint);
    }, fail);
  }

  /* --------------------------------------------------------- разделы команды */

  function viewPlayers() {
    var rows = (players && players.rows) || [];
    var bar = '<div class="adm-bar">' +
      '<label class="search' + (players && players.q ? ' has' : '') + '">' +
      '<svg class="s-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="admQ" type="search" placeholder="Имя игрока" ' +
      'value="' + esc((players && players.q) || '') + '">' +
      '<button type="button" class="s-clear" data-act="qclear" aria-label="Очистить">×</button>' +
      '</label>' +
      '<button class="btn btn-dark btn-sm" data-act="find">Найти</button>' +
      '</div>';

    var list = rows.length
      ? '<div class="row-list">' + rows.map(function (p) {
        var st = p.online ? '<span class="pill green">на сервере</span>'
          : esc(p.lastAt ? A.ago(p.lastAt) : 'не заходил');
        return '<div class="row r2">' +
          '<div><div class="rw-t"><a href="#/p/' + encodeURIComponent(p.nick) + '">' +
          esc(p.nick) + '</a>' +
          (p.bans ? ' <span class="pill red">' + p.bans + ' ' +
            plural(p.bans, ['наказание', 'наказания', 'наказаний']) + '</span>' : '') + '</div>' +
          '<div class="rw-s">' + money(p.coins) + ' червонцев' +
          (p.country ? ' · ' + esc(p.country) : '') + '</div></div>' +
          '<div class="rw-r">' + st + '</div></div>';
      }).join('') + '</div>'
      : empty('Никого не нашли',
        'Проверь имя — ищем по началу и по куску слова.');

    return bar + list;
  }

  function viewPlayer() {
    var p = pcard || {};
    var act = actives(p.punish);
    var tiles =
      tile('Червонцы', money(p.coins), 'выдать или списать — форма ниже') +
      tile('Наиграно', p.playedMin ? hours(p.playedMin) : 'нисколько',
        p.firstAt ? 'играет с ' + esc(day(p.firstAt)) : '') +
      tile('Сейчас', p.online ? 'на сервере' : 'не в игре',
        p.lastAt ? 'был ' + esc(A.ago(p.lastAt)) : '') +
      tile('Наказания', act.length ? String(act.length) : 'нет',
        p.punish && p.punish.length ? 'всего записей: ' + p.punish.length : 'чисто');

    var hist = (p.punish && p.punish.length)
      ? '<div class="row-list">' + p.punish.map(function (x) {
        return punishRow(x, p.nick, false);
      }).join('') + '</div>'
      : empty('Наказаний нет', 'За игроком ничего не числится.');

    return '<div class="cab-hint"><a href="#/players">← ко всем игрокам</a></div>' +
      '<div class="cab-block"><h2>' + esc(p.nick) + '</h2>' +
      '<div class="cab-tiles">' + tiles + '</div></div>' +
      '<div class="cab-block"><h2>Наказания</h2>' + hist + '</div>' +
      punishForm(p.nick) + giveForm(p.nick);
  }

  function punishForm(nick) {
    return '<div class="cab-block"><h2>Наказать</h2>' +
      '<p class="cab-hint">Причину видит сам игрок — пиши так, чтобы было понятно ' +
      'без пересказа. Кик отправляет с сервера сразу, мут и бан держатся до срока.</p>' +
      '<div style="max-width:560px">' +
      '<div class="field"><label for="pnNick">Игрок</label>' +
      '<input id="pnNick" type="text" spellcheck="false" value="' + esc(nick || '') + '"></div>' +
      '<div class="field"><label for="pnKind">Что делаем</label>' +
      '<select id="pnKind">' +
      '<option value="warn">Предупреждение</option>' +
      '<option value="mute">Мут — не может писать</option>' +
      '<option value="kick">Кик — выкинуть с сервера</option>' +
      '<option value="ban">Бан — не пускать</option>' +
      '</select></div>' +
      '<div class="field"><label for="pnTime">На сколько</label>' +
      '<select id="pnTime">' +
      '<option value="30">30 минут</option>' +
      '<option value="180">3 часа</option>' +
      '<option value="1440" selected>Сутки</option>' +
      '<option value="10080">Неделя</option>' +
      '<option value="43200">Месяц</option>' +
      '<option value="0">Навсегда</option>' +
      '</select></div>' +
      '<div class="field"><label for="pnWhy">Причина <span class="req">*</span></label>' +
      '<textarea id="pnWhy" placeholder="Например: гриф чужой базы, скриншоты в тикете #124"></textarea></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="punish">Применить</button>' +
      '<span class="fg-note" id="pnSay"></span></div></div></div>';
  }

  function giveForm(nick) {
    return '<div class="cab-block"><h2>Выдать червонцы</h2>' +
      '<p class="cab-hint">Для выигрышей и компенсаций. Запись останется в истории ' +
      'игрока с твоим именем — «за что» он увидит.</p>' +
      '<div style="max-width:560px">' +
      '<div class="field"><label for="gvNick">Игрок</label>' +
      '<input id="gvNick" type="text" spellcheck="false" value="' + esc(nick || '') + '"></div>' +
      '<div class="field"><label for="gvSum">Сколько <em>минус — списать</em></label>' +
      '<input id="gvSum" type="number" step="1" placeholder="500"></div>' +
      '<div class="field"><label for="gvWhy">За что <span class="req">*</span></label>' +
      '<input id="gvWhy" type="text" placeholder="Победа в розыгрыше от 12 сентября"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="give">Выдать</button>' +
      '<span class="fg-note" id="gvSay"></span></div></div></div>';
  }

  function doPunish() {
    var nick = val('pnNick'), kind = val('pnKind');
    var minutes = Number(val('pnTime')) || 0;
    var why = val('pnWhy');
    var say = el('pnSay');
    function bad(t) { if (say) say.textContent = t; }
    if (!nick) return bad('Впиши имя игрока.');
    if (!why) return bad('Причина обязательна — её увидит игрок.');

    var k = (KIND[kind] || [kind])[0];
    var when = minutes ? 'на ' + hours(minutes) : 'навсегда';
    if (kind === 'warn' || kind === 'kick') when = '';
    if (!confirm(k + ' игроку ' + nick + (when ? ' ' + when : '') + '?\n\nПричина: ' + why)) return;

    var btn = body.querySelector('[data-act="punish"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Применяем…'; }
    bad('');
    A.call('/cab/admin/punish', {
      body: { nick: nick, kind: kind, minutes: minutes, reason: why }
    }).then(function (d) {
      note('ok', d.text || (k + ' выдан игроку ' + nick + '.'));
      players = null; bans = null; pcard = null;
      loading();
      return need().then(paint);
    }, function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Применить'; }
      bad(A.textOf(e));
    });
  }

  function doGive() {
    var nick = val('gvNick'), why = val('gvWhy');
    var sum = Math.round(Number(val('gvSum')) || 0);
    var say = el('gvSay');
    function bad(t) { if (say) say.textContent = t; }
    if (!nick) return bad('Впиши имя игрока.');
    if (!sum) return bad('Впиши число — сколько червонцев.');
    if (!why) return bad('Напиши, за что: игрок это увидит.');
    if (!confirm((sum > 0 ? 'Выдать ' : 'Списать ') + money(Math.abs(sum)) +
      ' червонцев игроку ' + nick + '?\n\nЗа что: ' + why)) return;

    var btn = body.querySelector('[data-act="give"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Выдаём…'; }
    bad('');
    A.call('/cab/admin/give', { body: { nick: nick, coins: sum, why: why } })
      .then(function (d) {
        note('ok', d.text || 'Готово. У игрока теперь ' + money(d.coins) + '.');
        players = null; pcard = null;
        loading();
        return need().then(paint);
      }, function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Выдать'; }
        bad(A.textOf(e));
      });
  }

  function doPardon(nick, id, btn) {
    if (!confirm('Снять наказание с игрока ' + nick + '?')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Снимаем…'; }
    A.call('/cab/admin/pardon', { body: { nick: nick, id: id } }).then(function (d) {
      note('ok', d.text || 'Наказание снято.');
      bans = null; pcard = null;
      return loadMe().then(function () { loading(); return need().then(paint); });
    }, fail);
  }

  function viewBans() {
    var rows = (bans && bans.rows) || [];
    if (!rows.length) {
      return empty('Действующих наказаний нет',
        'На сервере сейчас никто не наказан. Выдать наказание можно из карточки ' +
        'игрока в разделе «Игроки».');
    }
    return '<p class="cab-hint">Всё, что действует прямо сейчас. Снятое и истёкшее ' +
      'остаётся в карточке игрока.</p>' +
      '<div class="row-list">' + rows.map(function (p) {
        return punishRow(p, p.nick, true);
      }).join('') + '</div>';
  }

  function viewChat() {
    var bar = '<div class="adm-bar">' +
      '<label class="search' + (chat.q ? ' has' : '') + '">' +
      '<svg class="s-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="chatQ" type="search" placeholder="Имя или слово" value="' + esc(chat.q) + '">' +
      '<button type="button" class="s-clear" data-act="chclear" aria-label="Очистить">×</button>' +
      '</label>' +
      '<button class="btn btn-dark btn-sm" data-act="chfind">Искать</button>' +
      '</div>';

    var log = chat.rows.length
      ? '<div class="chatlog" id="chLog">' + chat.rows.map(function (r) {
        var sys = r.kind && r.kind !== 'chat';
        return '<div class="cl' + (sys ? ' sys' : '') + '">' +
          '<span class="cl-t">' + esc(clock(r.at)) + '</span>' +
          '<span class="cl-n">' + esc(r.nick || 'сервер') + '</span>' +
          '<span class="cl-m">' + esc(r.text || '') + '</span></div>';
      }).join('') + '</div>'
      : empty('В чате пока пусто',
        chat.q ? 'По этому слову ничего не нашлось.'
          : 'Сервер ещё ничего не написал в лог.');

    return bar +
      '<p class="cab-hint">Последние сообщения с сервера, новые подтягиваются сами ' +
      'раз в пятнадцать секунд, пока вкладка открыта. Команды и служебные строки ' +
      'показаны серым.</p>' + log;
  }

  /* ------------------------------------------------------------- отрисовка */

  function main() {
    if (view === 'exam') return viewExam();
    if (view === 'coins') return viewCoins();
    if (view === 'lands') return viewLands();
    if (view === 'punish') return viewPunish();
    if (view === 'prizes') return viewPrizes();
    if (view === 'players') return viewPlayers();
    if (view === 'player') return viewPlayer();
    if (view === 'bans') return viewBans();
    if (view === 'chat') return viewChat();
    return viewMe();
  }

  function paint() {
    stopPoll();
    if (!A.base()) return paintOffline();
    if (!A.token() || !me) return paintLogin();

    body.innerHTML = '<div class="cab">' + side() +
      '<div>' + flash() + main() + '</div></div>';

    if (view === 'chat') {
      var lg = el('chLog');
      if (lg) lg.scrollTop = lg.scrollHeight;
      startPoll();
    }
  }

  /* Чат сам подтягивается, но только пока вкладку смотрят. */
  function startPoll() {
    stopPoll();
    poll = setInterval(function () {
      if (view !== 'chat' || document.visibilityState !== 'visible') return;
      loadChat(false).then(function (n) {
        if (!n) return;
        var lg = el('chLog');
        var stick = !lg || (lg.scrollHeight - lg.scrollTop - lg.clientHeight) < 60;
        paint();
        if (stick) { lg = el('chLog'); if (lg) lg.scrollTop = lg.scrollHeight; }
      }, function () { /* разовая заминка со связью — ждём следующего круга */ });
    }, 15000);
  }
  function stopPoll() { if (poll) { clearInterval(poll); poll = 0; } }

  /* --------------------------------------------------------------- события */

  body.addEventListener('click', function (e) {
    var n = e.target.closest ? e.target.closest('[data-nav],[data-act]') : null;
    if (!n) return;

    var nav = n.getAttribute('data-nav');
    if (nav) {
      e.preventDefault();
      location.hash = '#/' + nav;
      return;
    }

    var act = n.getAttribute('data-act');
    if (act === 'in') { e.preventDefault(); doLogin(); }
    else if (act === 'out') { e.preventDefault(); logout(); }
    else if (act === 'pw') { e.preventDefault(); showPass = true; paint(); }
    else if (act === 'pwoff') { e.preventDefault(); showPass = false; paint(); }
    else if (act === 'pwgo') { e.preventDefault(); doPass(); }
    else if (act === 'prize') {
      e.preventDefault();
      takePrize(n.getAttribute('data-id'), n);
    } else if (act === 'punish') { e.preventDefault(); doPunish(); }
    else if (act === 'give') { e.preventDefault(); doGive(); }
    else if (act === 'pardon') {
      e.preventDefault();
      doPardon(n.getAttribute('data-nick'), n.getAttribute('data-id'), n);
    } else if (act === 'find') { e.preventDefault(); search(); }
    else if (act === 'qclear') {
      e.preventDefault();
      var q = el('admQ'); if (q) q.value = '';
      search();
    } else if (act === 'exsave') { e.preventDefault(); examSend(false, n); }
    else if (act === 'exsend') { e.preventDefault(); examSend(true, n); }
    else if (act === 'chfind') { e.preventDefault(); chatSearch(); }
    else if (act === 'chclear') {
      e.preventDefault();
      var c = el('chatQ'); if (c) c.value = '';
      chatSearch();
    }
  });

  /* Enter в поле = нажать соседнюю кнопку: так привычнее, чем тянуться мышкой. */
  body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (t.id === 'cbNick' || t.id === 'cbPass') { e.preventDefault(); doLogin(); }
    else if (t.id === 'admQ') { e.preventDefault(); search(); }
    else if (t.id === 'chatQ') { e.preventDefault(); chatSearch(); }
    else if (t.id === 'pwOld' || t.id === 'pwNew' || t.id === 'pwNew2') {
      e.preventDefault(); doPass();
    } else if (t.id === 'gvNick' || t.id === 'gvSum' || t.id === 'gvWhy') {
      e.preventDefault(); doGive();
    }
  });

  function search() {
    var q = val('admQ');
    loading();
    loadPlayers(q).then(paint, fail);
  }

  function chatSearch() {
    chat.q = val('chatQ');
    chat.at = 0;
    chat.rows = [];
    loading();
    loadChat(true).then(paint, fail);
  }

  function logout() {
    var was = A.token();
    A.setSession(null);
    me = null; coins = null; players = null; bans = null; pcard = null;
    chat = { rows: [], at: 0, q: '' };
    note('ok', 'Вышли. Ключ вкладки стёрт.');
    paint();
    /* Службе сообщаем следом: даже если не дойдёт, ключ уже не у нас. */
    if (was) {
      fetch(A.base() + '/cab/logout', {
        method: 'POST', cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + was }
      }).catch(function () { });
    }
  }

  /* --------------------------------------------------------------- маршруты */

  function fromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (h.indexOf('p/') === 0) {
      return { v: 'player', n: decodeURIComponent(h.slice(2)) };
    }
    if (h === 'exam') return { v: 'exam', n: '' };
    var ok = NAV.concat(ANAV).some(function (t) { return t[0] === h; });
    return { v: ok ? h : 'me', n: '' };
  }

  window.addEventListener('hashchange', function () {
    if (!me) return;
    var r = fromHash();
    if (r.v === view && r.n === pnick) return;
    if (!me.admin && (r.v === 'player' ||
      ANAV.some(function (t) { return t[0] === r.v; }))) {
      location.hash = '';
      return;
    }
    if (r.v === 'exam' && !me.exam) { location.hash = ''; return; }
    go(r.v, r.n);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && view === 'chat' && me) {
      loadChat(false).then(function (n) { if (n) paint(); }, function () { });
    }
  });

  /* ------------------------------------------------------------------ старт */

  if (!A.base()) {
    paintOffline();
  } else if (!A.token()) {
    paintLogin();
  } else {
    loadMe().then(function () {
      var r = fromHash();
      view = r.v; pnick = r.n;
      if (!me.admin && (view === 'player' ||
        ANAV.some(function (t) { return t[0] === view; }))) view = 'me';
      return need();
    }).then(paint, function (e) {
      /* Ключ вкладки протух — не пугаем человека, просто показываем вход. */
      if (e && e.code === 'auth') { me = null; A.setSession(null); paintLogin(); }
      else fail(e);
    });
  }
})();
