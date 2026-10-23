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
            discord:{linked, name, how}, telegram:{linked, name, how, can},
            punish:[P], prizes:[Z], orders:[O], lands:{n, short}}
        link — чем подтвердили регистрацию ({provider:'discord'|'telegram', name}).
        discord — привязка к боту Discord (с 18.09.2026 служба её знает: бот
        раз в минуту сверяется с ней, /shop/links). how: 'reg' — Discord из
        регистрации, привязан сам; 'code' — принесли код в /гражданство.
        Роль державы бот выдаёт и меняет сам по державе в игре.
        telegram — how: 'reg' из регистрации, 'bot' через ссылку /cab/tg-link;
        can:false — бот Telegram ещё не отметился, ссылку не дадут.
        Старая служба этих двух полей не отдаёт — тогда строка Discord только
        даёт код, а строки Telegram нет.
   POST /cab/discord-pass                            (Bearer)
        -> {ok, code, life:15, until(мс), country}
        Код для /гражданство в Discord — тот же пропуск, что в игре /discord,
        подписан ключом игры. Берут заранее, до открытия, без входа в игру.
        Не чаще раза в 5 с (иначе {ok:false, code:'slow'}).
   POST /cab/tg-link                                 (Bearer)
        -> {ok, url, life:15, until(мс)}
        Разовая ссылка на бота Telegram (t.me/<бот>?start=link_…): открыл,
        нажал «Запустить» — Telegram привязан. Не чаще раза в 5 с.
   GET  /cab/coins?limit=60                           (Bearer)
        -> {ok, coins, rows:[{at, delta, why, by}]}
   GET  /cab/lands                                    (Bearer)
        -> {ok, max, taxLevel, nextAt, rows:[L]}
        taxLevel — положение налога в стране игрока: 1 малый, 2 средний,
        3 большой (ЭКОНОМИКА.md 4.4). Процентов больше нет: налог считается
        ступенькой от цены земли и всегда целыми червонцами, а положение
        говорит, во сколько ступеней он обходится мэру.
        nextAt — ближайшая полночь МСК, когда движок пойдёт списывать
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
   L = {id, name, country, chunks, price, tax, boughtAt, nextAt, capital}
       price и tax считает игра, сайт их только показывает: два счёта в двух
       местах разойдутся, и на сайте будет одна сумма, а спишется другая.
       tax — сколько спишется В БЛИЖАЙШУЮ ПОЛНОЧЬ по этой земле. Всегда целое
       число червонцев: ступень по цене (1/2/3/5/8/12) умножить на положение
       страны. capital:true — столичная провинция: за неё платит казна
       державы, и за налог её не отбирают (ЭКОНОМИКА.md 4.4).
       Полей debt и cutAt больше нет: рассрочки в 14 суток не существует с
       17.09.2026 — не хватило в 00:00, и мэр в ту же полночь перестаёт быть мэром
   Z = {id, name, text, coins, at, taken}
   O = {id, name, rub, at, status:"wait|paid|failed"}  — те же слова,
       что отдаёт GET /shop/order, чтобы у заказа было одно состояние на всё.
       Поле coin умерло вместе с ценниками в червонцах (16.09.2026): платят
       за заказ всегда рублями. Пакет червонцев — такой же заказ, как любой
       другой: rub — цена, а сколько червонцев пришло, видно в истории счёта

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
  var dsPass = null;          // код для Discord: {code, until, country} или {err}
  var tgLink = null;          // ссылка привязки Telegram: {url, until} или {err}

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
    var reg = 'reg', dis = A.link('discord');
    body.innerHTML =
      '<div class="cab-login"><h2>Кабинет включится вместе с сервером</h2>' +
      '<p class="cl-lead">Личный кабинет работает от службы игрового сервера. ' +
      'Пока сезон готовится, показывать тут нечего — как только сервер поднимется, ' +
      'вход появится на этой же странице.</p></div>' +
      '<div class="cab-why"><h3>Что будет внутри</h3><ul>' +
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
      '<p class="cl-lead">Имя и пароль те же, что в лаунчере. Вход запоминается ' +
      'на этом устройстве и не пускает в игру — это только сайт.</p>' +
      '<div class="field"><label for="cbNick">Игровое имя</label>' +
      '<input id="cbNick" type="text" autocomplete="username" ' +
      'spellcheck="false" placeholder="Например, VineZerro"></div>' +
      '<div class="field"><label for="cbPass">Пароль</label>' +
      '<input id="cbPass" type="password" autocomplete="current-password" ' +
      'placeholder="Пароль от аккаунта"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="in">Войти</button>' +
      '<span class="fg-note" role="status" id="cbSay"></span></div></div>' +
      '<div class="cab-why"><h3>Если не заходит</h3><ul>' +
      '<li>аккаунта ещё нет — <a href="reg">заведи его</a>, это пара минут;</li>' +
      '<li>забыл пароль — <a href="reg#recover">сбрось его сам</a>: ссылку на новый пароль ' +
      'пришлёт то, чем подтверждал регистрацию; не выходит — напиши <a href="tickets#/help">обращение</a>;</li>' +
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
    /* Голова того скина, что стоит у игрока, объёмом — как в обращениях.
       Своего скина нет — голова стандартного, какой игра выдаёт этому нику.
       Пока картинка грузится, видна буква. Рисует AegisTk.heads после вставки. */
    var av = '<div class="cm-av"><span class="cm-let">' + letter + '</span>' +
      '<canvas class="tk-av cm-face" data-nick="' + esc(me.nick) + '" aria-hidden="true"></canvas></div>';

    var sub = me.online ? 'сейчас на сервере'
      : (me.lastAt ? 'заходил ' + A.ago(me.lastAt) : 'ещё не заходил');
    if (me.role) sub = esc(me.role) + ' · ' + sub;

    var n = '<nav class="cab-nav" aria-label="Разделы кабинета">';
    NAV.forEach(function (t) {
      var b = '';
      if (t[0] === 'coins') b = money(me.coins);
      /* Значок у «Провинций» — восклицательный знак, когда на ближайшее
         списание не хватает: это единственное место в кабинете, где
         промедление до полуночи стоит земли. */
      if (t[0] === 'lands') b = me.lands && me.lands.short ? '!' : String(me.lands && me.lands.n || '');
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
      n += '<a class="cn-go" href="admin"><svg viewBox="0 0 20 20" aria-hidden="true">' +
        '<path d="M10 2.5l6 2.3v5c0 3.5-2.6 5.7-6 6.7-3.4-1-6-3.2-6-6.7v-5z"/></svg>' +
        '<span><b>Пульт обращений</b><small>тикеты игроков по вашим темам</small></span></a>';
    }
    n += '</nav>';

    return '<aside class="cab-side">' +
      '<div class="cab-me">' + av + '<div><div class="cm-n">' + esc(me.nick) +
      '</div><div class="cm-s">' + sub + '</div></div></div>' + n +
      '<div class="cab-out">Вход запомнен на этом устройстве. ' +
      '<button type="button" data-act="out">Выйти</button></div></aside>';
  }

  /* Открытый раздел меню отличается только заливкой — читалке это не видно.
     Это не нажатая кнопка, а «сейчас открыто вот это»: aria-current. */
  function btn(id, title, badge) {
    var on = (view === id) || (view === 'player' && id === 'players');
    return '<button type="button" data-nav="' + id + '"' +
      (on ? ' class="on" aria-current="true"' : '') + '>' + esc(title) +
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

  /* Значок мессенджера перед названием строки привязки — чтобы Discord и
     Telegram читались с одного взгляда, а не голым словом. Рисуем в цвете
     бренда встроенным SVG (лишних файлов не тащим), 17 px, класс rw-ic ловит
     выравнивание в pages.css. */
  var BRAND = {
    discord: ['#5865F2', 'M20.317 4.3698a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.74 19.74 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.245.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.029zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419z'],
    telegram: ['#29A9EA', 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z']
  };
  function brand(kind, label) {
    var b = BRAND[kind];
    if (!b) return label;
    return '<svg class="rw-ic" viewBox="0 0 24 24" width="17" height="17" ' +
      'fill="' + b[0] + '" aria-hidden="true"><path d="' + b[1] + '"/></svg>' + label;
  }

  /* Шапка профиля: скин в объёме и главное о человеке. Саму фигуру строит
     js/skin3d.js уже после вставки разметки (skinFig в paint). Наигранное и
     заходы служба берёт из данных мода (aegis-playtime.json). */
  function hero() {
    var st = me.online ? '<span class="pill green">сейчас в игре</span>'
      : '<span class="ch-st">' + (me.lastAt ? 'был в игре ' + esc(A.ago(me.lastAt)) : 'ещё не заходил в игру') + '</span>';
    var tags = '';
    if (me.role) tags += '<span class="pill gold">' + esc(me.role) + '</span>';
    if (me.priv && me.priv.title) {
      tags += '<span class="pill">' + esc(me.priv.title) +
        (me.priv.until ? ' · до ' + esc(day(me.priv.until)) : '') + '</span>';
    }
    var fact = function (k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; };
    var sk = me.skin && me.skin.has
      ? (me.skin.model === 'slim' ? 'свой скин, тонкие руки' : 'свой скин')
      : 'стандартный скин игры';
    return '<section class="cab-hero" aria-label="Профиль">' +
      '<div class="ch-fig"><div class="sk3" id="cabSkin"></div>' +
      '<div class="ch-hint" aria-hidden="true">потяни, чтобы повернуть</div></div>' +
      '<div class="ch-info"><div class="ch-nick">' + esc(me.nick) + '</div>' +
      '<div class="ch-tags">' + st + tags + '</div>' +
      '<dl class="ch-facts">' +
      fact('Последний вход', me.online ? 'сейчас в игре' : (me.lastAt ? esc(date(me.lastAt)) : 'ещё не было')) +
      fact('Наиграно', me.playedMin ? esc(hours(me.playedMin)) : 'нисколько') +
      fact('Играет с', me.firstAt ? esc(day(me.firstAt)) : '—') +
      fact('Город', me.town ? esc(me.town) : 'нет') +
      '</dl>' +
      '<div class="ch-go"><a class="btn btn-dark btn-sm" href="profile">Поменять скин</a>' +
      '<span>' + sk + '</span></div>' +
      '</div></section>';
  }

  function viewMe() {
    var act = actives(me.punish);
    var tiles =
      tile('Червонцы', money(me.coins),
        'Заработок игрой · <a href="donate#free">откуда берутся</a>') +
      tile('Привилегия', me.priv && me.priv.title ? me.priv.title : 'нет',
        me.priv && me.priv.title
          ? (me.priv.until ? 'до ' + esc(day(me.priv.until)) : 'бессрочно')
          : '<a href="donate">что она даёт</a>') +
      tile('Страна', me.countryName || me.country || 'нет',
        me.countryName ? 'приват по историческим границам' : 'выбирается на сервере') +
      tile('Наказания', act.length ? String(act.length) : 'нет',
        act.length ? 'смотри раздел «Наказания»' : 'чисто, так держать');

    var PROV = { discord: 'Discord', telegram: 'Telegram', vk: 'VK ID', yandex: 'Яндекс ID' };
    var link = me.link && me.link.provider
      ? esc(PROV[me.link.provider] || me.link.provider) +
        (me.link.name && me.link.name !== PROV[me.link.provider] ? ' · ' + esc(me.link.name) : '')
      : 'не привязан';

    /* Discord — связка ника с ботом: роль державы и города, подпись
       обращений. Привязка ОБЯЗАТЕЛЬНА (решение овнера). Служба знает, привязан
       ли человек (me.discord, бот сверяется раз в минуту): кто регистрировался
       через Discord, привязан сам, остальным — код /cab/discord-pass, тот же
       пропуск, что в игре /discord. Старая служба поля не отдаёт — тогда
       строка, как раньше, только даёт код. */
    var dsNew = !!(me.discord && typeof me.discord.linked === 'boolean');
    var dsOn = dsNew && me.discord.linked;
    var dsVal, dsSub;
    if (dsOn) {
      dsVal = (me.discord.name ? '<span class="rw-v">' + esc(me.discord.name) + '</span>' : '') +
        '<span class="pill green">привязан</span>';
      dsSub = (me.discord.how === 'reg' ? 'привязан при регистрации' : 'привязан кодом') +
        ' · роль державы бот выдаёт и меняет сам · сменить Discord — ' +
        '/отвязаться в Discord, потом новый код здесь';
    } else {
      dsVal = '<button class="btn btn-dark btn-sm" data-act="dspass">' +
        (dsPass && dsPass.code ? 'Новый код' : 'Получить код') + '</button>';
      dsSub = dsNew
        ? 'не привязан · без привязки бот не выдаст роль державы и города · код нужен один раз'
        : 'код для бота: без него роль державы и города выдать некому · ' +
          'привязался — повторять не надо, пока не вступишь в державу';
    }

    /* Напоминание сверху. Служба знает привязку — висит, пока Discord не
       привязан; старая служба — пока человек ни разу не брал код в этом браузере. */
    var dsWarn = dsOn || (!dsNew && dsSeen()) ? '' :
      '<div class="nbox"><span class="n-ic">!</span><div>' +
      '<b>Привяжи Discord</b> — один раз, заходить в игру для этого не нужно. ' +
      'Роль державы и города выдаёт бот в нашем Discord, и без привязки он не ' +
      'знает, чей это ник. Нажми <b>«Получить код»</b> в строке Discord ниже — ' +
      'там же подсказка, куда его вставить.' +
      (dsNew ? '' : ' Кнопка Discord или Telegram при регистрации — это другое: ' +
        'она только подтвердила, что ты живой человек.') +
      '</div></div>';

    /* Telegram — по желанию: туда бот пришлёт чек покупки. Строка есть,
       только если служба знает привязки. */
    var tgRow = '';
    if (me.telegram && typeof me.telegram.linked === 'boolean') {
      tgRow = me.telegram.linked
        ? row(brand('telegram', 'Telegram'),
          (me.telegram.how === 'reg' ? 'привязан при регистрации' : 'привязан через бота') +
          ' · сюда бот присылает чеки покупок',
          (me.telegram.name ? '<span class="rw-v">' + esc(me.telegram.name) + '</span>' : '') +
          '<span class="pill green">привязан</span>')
        : row(brand('telegram', 'Telegram'), 'не привязан · по желанию: бот будет присылать туда чеки покупок',
          '<button class="btn btn-dark btn-sm" data-act="tglink">' +
          (tgLink && tgLink.url ? 'Новая ссылка' : 'Привязать') + '</button>');
    }

    var acc = '<div class="row-list">' +
      row('Игровое имя', 'меняется только через обращение', esc(me.nick)) +
      row('Регистрация', 'чем подтвердили, что ты живой человек', link) +
      row(brand('discord', 'Discord'), dsSub, dsVal) +
      tgRow +
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
            esc(date(o.at)) + (o.rub ? ' · ' + esc(o.rub) + ' ₽' : ''), st);
        }).join('') + '</div></div>';
    }

    return dsWarn + hero() + '<div class="cab-tiles">' + tiles + '</div>' +
      '<div class="cab-block"><h2>Аккаунт</h2>' + acc + (dsOn ? '' : dsBox()) +
      (me.telegram && me.telegram.linked ? '' : tgBox()) + pw + '</div>' + ord;
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
      '<span class="fg-note" role="status" id="pwSay"></span></div></div></div>';
  }

  /* ------------------------------------------------ код для Discord */

  /* Брал ли человек код в этом браузере — только чтобы не висело напоминание.
     Хранилище может быть закрыто (приватное окно) — тогда напоминание просто
     остаётся. */
  function dsSeen() {
    try { return localStorage.getItem('aegis-ds-code') === '1'; } catch (x) { return false; }
  }

  function hhmm(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function dsBox() {
    if (!dsPass) return '';
    if (dsPass.err) {
      return '<div class="nbox warn ds-box"><span class="n-ic">!</span><div>' +
        esc(dsPass.err) + '</div></div>';
    }
    var inv = A.link('discord');
    var ds = inv ? '<a href="' + esc(inv) + '" target="_blank" rel="noopener">наш Discord</a>'
      : 'наш Discord';
    return '<div class="nbox ds-box"><div>' +
      '<b>Код для Discord</b> — действует до ' + esc(hhmm(dsPass.until)) +
      ' (15 минут) и срабатывает один раз.' +
      '<div class="ds-code"><code id="dsCode">' + esc(dsPass.code) + '</code>' +
      '<button class="btn btn-primary btn-sm" data-act="dscopy">Скопировать</button></div>' +
      '<ol class="ds-steps">' +
      '<li>Открой ' + ds + '.</li>' +
      '<li>В любом канале, где можно писать, набери <b>/гражданство</b> и выбери ' +
      'команду бота AEGIS.</li>' +
      '<li>В поле «пропуск» вставь код и отправь. Бот ответит, что аккаунт привязан, ' +
      'и выдаст роль.</li></ol>' +
      (dsPass.country
        ? '<div class="ds-note">Держава в коде: ' + esc(dsPass.country) + '.</div>'
        : (me && me.discord && typeof me.discord.linked === 'boolean'
          ? '<div class="ds-note">Державы у тебя пока нет — не страшно: когда тебя ' +
            'примут в державу, бот сам выдаст её роль, код второй раз не нужен.</div>'
          : '<div class="ds-note">Державы у тебя пока нет — привязка пройдёт без её ' +
            'роли. Когда тебя примут в державу, возьми код ещё раз и отправь его снова.</div>')) +
      (me && me.discord && typeof me.discord.linked === 'boolean'
        ? '<div class="ds-note">Бот ответил — вернись на эту вкладку: в течение минуты ' +
          'строка Discord покажет «привязан».</div>' : '') +
      '</div></div>';
  }

  /* ------------------------------------------------ ссылка для Telegram */

  function tgBox() {
    if (!tgLink) return '';
    if (tgLink.err) {
      return '<div class="nbox warn ds-box"><span class="n-ic">!</span><div>' +
        esc(tgLink.err) + '</div></div>';
    }
    return '<div class="nbox ds-box"><div>' +
      '<b>Привязка Telegram</b> — ссылка действует до ' + esc(hhmm(tgLink.until)) +
      ' (15 минут) и срабатывает один раз.' +
      '<div class="ds-code"><a class="btn btn-primary btn-sm" href="' + esc(tgLink.url) +
      '" target="_blank" rel="noopener">Открыть бота в Telegram</a></div>' +
      '<ol class="ds-steps">' +
      '<li>Нажми кнопку — откроется наш бот в Telegram.</li>' +
      '<li>Нажми «Запустить» (или «Start»). Бот ответит, что Telegram привязан.</li>' +
      '<li>Вернись на эту вкладку — строка Telegram покажет «привязан».</li></ol>' +
      '<div class="ds-note">Ссылку никому не отправляй: кто откроет её первым, ' +
      'к тому Telegram и привяжется.</div>' +
      '</div></div>';
  }

  /* Пока открыт код или ссылка — раз в 30 с спрашиваем, не привязался ли:
     Discord доходит до службы со сверкой бота (до минуты), Telegram сразу.
     Перерисовываем, только если что-то поменялось, — иначе сбили бы выделение
     кода. Старая служба привязок не знает — там и спрашивать нечего. */
  var linkT = 0;

  function knowsLinks() {
    return !!(me && me.discord && typeof me.discord.linked === 'boolean');
  }

  function refreshLinks() {
    var ds0 = !!(me && me.discord && me.discord.linked);
    var tg0 = !!(me && me.telegram && me.telegram.linked);
    return loadMe().then(function () {
      if (!me) return;
      var ds1 = !!(me.discord && me.discord.linked);
      var tg1 = !!(me.telegram && me.telegram.linked);
      if (ds1) dsPass = null;
      if (tg1) tgLink = null;
      if (ds1 !== ds0 || tg1 !== tg0) paint();
    }, function () { });
  }

  function watchLinks() {
    if (linkT || !knowsLinks()) return;
    linkT = setInterval(function () {
      var open = (dsPass && dsPass.code) || (tgLink && tgLink.url);
      var end = Math.max((dsPass && dsPass.until) || 0, (tgLink && tgLink.until) || 0);
      if (!me || !open || Date.now() > end + 2 * 60000) {
        clearInterval(linkT); linkT = 0; return;
      }
      if (view !== 'me' || showPass || document.visibilityState !== 'visible') return;
      refreshLinks();
    }, 30000);
  }

  function getTgLink(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Получаем…'; }
    A.call('/cab/tg-link', { body: {} }).then(function (d) {
      var u = String(d.url || '');
      tgLink = /^https:\/\/t\.me\//.test(u)
        ? { url: u, until: Number(d.until) || Date.now() + 15 * 60000 }
        : { err: 'Служба не дала ссылку. Попробуй ещё раз через минуту.' };
      paint();
      watchLinks();
    }, function (e) {
      tgLink = { err: A.textOf(e) };
      paint();
    });
  }

  function getDsPass(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Получаем…'; }
    A.call('/cab/discord-pass', { body: {} }).then(function (d) {
      dsPass = { code: String(d.code || ''), country: d.country || '',
        until: Number(d.until) || Date.now() + 15 * 60000 };
      try { localStorage.setItem('aegis-ds-code', '1'); } catch (x) { }
      paint();
      watchLinks();
    }, function (e) {
      dsPass = { err: A.textOf(e) };
      paint();
    });
  }

  function copyDs(btn) {
    var t = dsPass && dsPass.code;
    if (!t) return;
    function pick() {
      var c = el('dsCode');
      if (c && window.getSelection) {
        var r = document.createRange();
        r.selectNodeContents(c);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      btn.textContent = 'Выделено — нажми Ctrl+C';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { btn.textContent = 'Скопировано'; }, pick);
    } else pick();
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
      '<span class="fg-note" role="status" id="exSay"></span></div></div>';
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

    return '<div class="cab-tiles">' +
      tile('На счету', money(bal),
        plural(bal, ['червонец', 'червонца', 'червонцев']) +
        ' · <a href="donate#free">как заработать</a>') +
      tile('Пришло', money(got), 'за последние ' + rows.length + ' ' +
        plural(rows.length, ['движение', 'движения', 'движений'])) +
      tile('Потрачено', money(spent), 'земля, налоги и торговля') +
      '</div>' +
      '<div class="cab-block"><h2>История</h2>' +
      '<p class="cab-hint">Червонец — валюта самого сервера: его <b>дают за игру</b>, ' +
      'и тратят его в игре. Докупить червонцы можно в ' +
      '<a href="donate#coins">лавке</a>, обратно на деньги они не меняются. ' +
      'Счёт <b>переживает вайп</b> и остаётся с тобой в новом сезоне; вещи, ' +
      'постройки и земля — нет, их выдаёт мир, а мир начинается заново.</p>' +
      list + '</div>';
  }

  /* Как называется положение налога в стране игрока (ЭКОНОМИКА.md 4.4).
     Само число червонцев считает игра, сайт его только показывает. */
  var TAX_LEVELS = ['малый', 'средний', 'большой'];

  function landRow(r) {
    var sub = [];
    if (r.country) sub.push(esc(r.country));
    if (r.chunks) {
      sub.push(money(r.chunks) + ' ' + plural(r.chunks, ['чанк', 'чанка', 'чанков']));
    }
    if (r.boughtAt) sub.push('куплена ' + esc(day(r.boughtAt)));
    if (r.capital) {
      sub.push('столица — платит казна державы');
    } else if (r.nextAt) {
      sub.push('спишется ' + esc(day(r.nextAt)) + ', ' + leftDays(r.nextAt));
    }

    return '<div class="row r2"><div>' +
      '<div class="rw-t">' + esc(r.name || 'Провинция') +
      (r.capital ? ' <span class="pill">столица</span>' : '') +
      '</div><div class="rw-s">' + sub.join(' · ') + '</div></div>' +
      '<div class="rw-r ln-r"><b>' + money(r.price) + ' Ч</b>' +
      '<span>налог ' + money(r.tax) + ' Ч в сутки</span></div></div>';
  }

  /* «Провинции». Земля — единственное в кабинете, что можно потерять,
     ничего не нарушив: просто не хватило червонцев на налог. С 17.09.2026
     это ещё и происходит в ту же ночь, без рассрочки, поэтому главное здесь —
     не «сколько долга», а «хватит ли сегодня». */
  function viewLands() {
    var d = lands || {};
    var rows = d.rows || [];
    var max = Number(d.max) || 3;
    var lvl = Number(d.taxLevel) || 2;

    if (!rows.length) {
      return empty('Своей земли пока нет',
        'Провинции покупаются на сервере у государства: свободная стоит от ' +
        '12 червонцев. Что где стоит, видно в списке ' +
        '<a href="lands">земель и налогов</a>.');
    }

    /* Столицу за налог не отбирают: за неё платит казна державы (4.4).
       Поэтому в «хватит ли сегодня» её списание не считаем. */
    var tax = 0, own = 0, next = 0;
    rows.forEach(function (r) {
      var t = Number(r.tax) || 0;
      tax += t;
      if (!r.capital) own += t;
      var n = Number(r.nextAt) || 0;
      if (n && (!next || n < next)) next = n;
    });
    if (d.nextAt) next = Number(d.nextAt) || next;

    var coins = Number(me.coins) || 0;
    var days = own > 0 ? Math.floor(coins / own) : 0;
    var short = own > 0 && coins < own;

    var tiles =
      tile('Провинций', rows.length + ' из ' + max,
        max > 3 ? 'больше даёт звание' : 'звание Командора даёт +1, Маршала +2') +
      tile('Налог в сутки', money(tax) + ' Ч',
        (TAX_LEVELS[lvl - 1] || 'средний') + ' налог державы, списывается в 00:00') +
      /* Крупно — «через сколько», мелко — дата: человеку сначала важно,
         успевает он или нет, и только потом — какое это число. */
      tile('Ближайшее списание', next ? leftDays(next) : '—',
        next ? esc(day(next)) : 'сроки придут с сервера') +
      (short
        ? tile('Не хватит сегодня', money(own - coins) + ' Ч',
          'в 00:00 провинция уйдёт в продажу · <a href="donate#free">где взять</a>')
        : tile('Хватит червонцев', days
          ? 'на ' + days + ' ' + plural(days, ['сутки', 'суток', 'суток'])
          : 'меньше суток',
          days ? 'при нынешнем налоге' : 'налог спишется не полностью'));

    var hint = short
      ? '<p class="cab-hint">На ближайшее списание не хватает. Рассрочки нет: ' +
        'в 00:00 ты перестанешь быть мэром и останешься обычным жителем своей же ' +
        'провинции — дом, участок и сундуки при тебе, а земля уйдёт в продажу ' +
        'со скидкой 25%. Выкупить её обратно можно, если хватит денег.</p>'
      : '<p class="cab-hint">Налог списывается со счёта сам, каждые сутки в 00:00. ' +
        'Не хватило — в ту же полночь земля уходит в продажу, и мэром становится ' +
        'тот, кто её выкупит. Все правила: цена, ставка державы, продажа, переезд — ' +
        'на странице <a href="lands">Земли и налоги</a>.</p>';

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
        'За тобой ничего не числится. Правила лежат в <a href="wiki#/rules-game">вики</a> — ' +
        'загляни, чтобы так и осталось.');
    }
    var act = all.filter(function (p) { return p.active; });
    var old = all.filter(function (p) { return !p.active; });
    var h = '';
    if (act.length) {
      h += '<div class="cab-block"><h2>Действуют сейчас</h2>' +
        '<p class="cab-hint">Считаешь, что наказание несправедливо — не спорь в чате, ' +
        'а напиши <a href="tickets#/appeal">обжалование</a>. Разберут по логам.</p>' +
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
      '<button type="button" class="s-clear" data-act="qclear" aria-label="Очистить">✕</button>' +
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
      '<span class="fg-note" role="status" id="pnSay"></span></div></div></div>';
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
      '<input id="gvWhy" type="text" placeholder="Победа в розыгрыше в Discord"></div>' +
      '<div class="form-go"><button class="btn btn-primary" data-act="give">Выдать</button>' +
      '<span class="fg-note" role="status" id="gvSay"></span></div></div></div>';
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
      '<button type="button" class="s-clear" data-act="chclear" aria-label="Очистить">✕</button>' +
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
    if (window.AegisTk) window.AegisTk.heads(body);
    skinFig();

    if (view === 'chat') {
      var lg = el('chLog');
      if (lg) lg.scrollTop = lg.scrollHeight;
      startPoll();
    }
  }

  /* Фигура строится один раз на человека, дальше переезжает из старой
     разметки в новую: иначе каждое нажатие в профиле заново грузило бы скин
     и сбрасывало поворот, который человек себе выставил. */
  var fig = null;
  function skinFig() {
    var slot = el('cabSkin');
    if (!slot || !window.AegisSkin3d) return;
    var key = me.nick + '|' + (me.skin && me.skin.has ? me.skin.model || 'classic' : '-');
    if (fig && fig.key === key) {
      slot.parentNode.replaceChild(fig.node, slot);
      return;
    }
    window.AegisSkin3d.mount(slot, {
      nick: me.nick,
      has: !!(me.skin && me.skin.has),
      slim: !!(me.skin && me.skin.model === 'slim')
    });
    fig = { key: key, node: slot };
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
    else if (act === 'dspass') { e.preventDefault(); getDsPass(n); }
    else if (act === 'dscopy') { e.preventDefault(); copyDs(n); }
    else if (act === 'tglink') { e.preventDefault(); getTgLink(n); }
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
    me = null; coins = null; players = null; bans = null; pcard = null; dsPass = null;
    tgLink = null;
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
    /* вернулись из Discord или Telegram — привязка могла уже пройти */
    if (document.visibilityState === 'visible' && view === 'me' && !showPass &&
      knowsLinks() && ((dsPass && dsPass.code) || (tgLink && tgLink.url))) {
      refreshLinks();
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
