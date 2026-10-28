/* AEGIS — общее для обращений: страница игрока (tickets.html) и пульт команды
   (admin.html). Здесь то, что обе страницы рисуют одинаково: вход, переписка,
   вложения, загрузка файлов, названия тем и стадий.

   Служба — мод сервера (Tickets.java): /tickets/* для игрока, /adm/* для команды.
   Вход один на весь сайт — POST /cab/login тем же ником и паролем, что в
   лаунчере; ключ сессии лежит в sessionStorage и уходит заголовком Bearer
   (это делает js/api.js сам).

   Текст обращений и ответов — данные: выводим только через esc(), ссылки не
   превращаем в кликабельные, HTML не пропускаем.

   Подключается после js/api.js и до скрипта страницы. */
(function (w) {
  'use strict';

  var A = w.AegisApi;
  var esc = A.esc;

  /* ------------------------------------------------------------ темы */

  var CATS = null, BY = {};
  function cats() {
    if (CATS) return Promise.resolve(CATS);
    return A.local('data/tickets.json').then(function (d) {
      CATS = (d && d.categories) || [];
      CATS.forEach(function (c) { BY[c.key] = c; });
      return CATS;
    });
  }
  function cleanName(s) {
    return String(s || '').split('|')[0].trim() || String(s || '');
  }
  function catName(key, fallback) {
    var c = BY[key];
    return c ? cleanName(c.name) : (fallback ? cleanName(fallback) : (key || 'Обращение'));
  }

  /* ---------------------------------------------------------- стадии */

  var STATE = { open: 'открыт', work: 'в работе', wait: 'ждет игрока', closed: 'закрыт' };
  var STATE_P = { open: 'принято', work: 'в работе', wait: 'ждет вашего ответа', closed: 'закрыто' };
  var STATE_CLS = { open: 'gold', work: 'green', wait: '', closed: '' };

  function pill(st, player) {
    var t = (player ? STATE_P : STATE)[st] || st || '';
    return '<span class="pill ' + (STATE_CLS[st] || '') + (st === 'closed' ? ' tk-off' : '') +
      '">' + esc(t) + '</span>';
  }

  /* «24 сентября, 14:05» — точное время рядом с «3 минуты назад». */
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
    'сентября', 'октября', 'ноября', 'декабря'];
  function stamp(ms) {
    if (!ms) return '';
    var d = new Date(Number(ms));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getDate() + ' ' + MON[d.getMonth()] + ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function when(ms) {
    if (!ms) return '';
    return '<time title="' + esc(stamp(ms)) + '">' + esc(A.ago(ms)) + '</time>';
  }

  /* Текст сообщения: только esc и переносы строк. Ссылки остаются текстом —
     кликабельная ссылка из обращения это приглашение на фишинг. */
  function text(s) {
    return esc(s).replace(/\r?\n/g, '<br>');
  }
  /* Ответ SIGEA пишет сама служба, не игрок: в нем кликабельны только ссылки
     на наш сайт — чужой адрес так и останется текстом. */
  function botText(s) {
    return text(s).replace(/https:\/\/(?:www\.)?aegis-smp\.com(?![-\w]|\.[-\w])(?:\/[^\s<]*[^\s<.,;:!?)»])?/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
  }

  /* ------------------------------------------------- головы скинов */

  /* Рядом с ником — объемная голова его скина на сервере (/skins/<ник>.png у
     службы мода). Своего скина нет — стандартный, как в игре: Minecraft берет
     его по UUID, а UUID офлайн-ника — это MD5 от «OfflinePlayer:ник». */
  var SKINS = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
  var MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], MD5_K = [];
  for (var ki = 0; ki < 64; ki++) MD5_K[ki] = Math.floor(Math.abs(Math.sin(ki + 1)) * 4294967296) | 0;

  function md5(b) {
    var n = b.length, len = (((n + 8) >>> 6) + 1) * 16, x = [], i, j;
    for (i = 0; i < len; i++) x[i] = 0;
    for (i = 0; i < n; i++) x[i >> 2] |= b[i] << ((i % 4) * 8);
    x[n >> 2] |= 0x80 << ((n % 4) * 8);
    x[len - 2] = n * 8;
    var h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (j = 0; j < len; j += 16) {
      var a = h[0], bb = h[1], c = h[2], d = h[3];
      for (i = 0; i < 64; i++) {
        var f, g;
        if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
        else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
        var s = MD5_S[(i >> 4) * 4 + (i % 4)], t = (a + f + MD5_K[i] + x[j + g]) | 0;
        a = d; d = c; c = bb;
        bb = (bb + ((t << s) | (t >>> (32 - s)))) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    var out = [];
    h.forEach(function (v) { for (var k = 0; k < 4; k++) out.push((v >>> (k * 8)) & 255); });
    return out;
  }

  /* Какой из стандартных скинов игра выдаст нику (UUID.hashCode по модулю 18,
     первые девять — тонкие руки, вторые — те же лица с широкими). */
  function defaultIdx(nick) {
    var u = unescape(encodeURIComponent('OfflinePlayer:' + nick)), b = [], i;
    for (i = 0; i < u.length; i++) b.push(u.charCodeAt(i));
    var m = md5(b);
    m[6] = (m[6] & 0x0f) | 0x30;
    m[8] = (m[8] & 0x3f) | 0x80;
    var int = function (o) { return (m[o] << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]; };
    var v = int(0) ^ int(4) ^ int(8) ^ int(12);
    return ((v % 18) + 18) % 18;
  }
  function defaultSkin(nick) { return SKINS[defaultIdx(nick) % 9]; }
  /* Стандартный скин ника целиком — для объемной фигуры: первые девять в
     игре тонкорукие, их текстуры лежат отдельно (у головы разницы нет). */
  function defaultFull(nick) {
    var i = defaultIdx(nick);
    return { src: 'assets/img/heads/' + (i < 9 ? 'slim/' : '') + SKINS[i % 9] + '.png', slim: i < 9 };
  }

  var SKIN_IMG = {};
  function img(src) {
    return new Promise(function (ok, bad) {
      var i = new Image();
      i.onload = function () { ok(i); };
      i.onerror = bad;
      i.src = src;
    });
  }
  function skin(nick) {
    var k = String(nick).toLowerCase();
    if (k === '#sigea' && !SKIN_IMG[k]) SKIN_IMG[k] = img('assets/img/sigea.png?v=0925');
    if (!SKIN_IMG[k]) {
      var std = function () { return img('assets/img/heads/' + defaultSkin(nick) + '.png'); };
      SKIN_IMG[k] = (A.base() ? img(A.base() + '/skins/' + encodeURIComponent(nick) + '.png') : Promise.reject())
        .then(function (i) { return i.width >= 64 && i.height >= 32 ? i : std(); }, std);
    }
    return SKIN_IMG[k];
  }

  /* Грань головы: кусок 8×8 скина (su, sv), натянутый на грань куба с началом p
     и осями e1, e2 (в пикселях скина), с затемнением на shade. */
  function face(ctx, sk, su, sv, p, e1, e2, shade, P) {
    var t = document.createElement('canvas');
    t.width = t.height = 8;
    var tc = t.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.drawImage(sk, su, sv, 8, 8, 0, 0, 8, 8);
    if (shade < 1) {
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = 'rgba(0,0,0,' + (1 - shade) + ')';
      tc.fillRect(0, 0, 8, 8);
    }
    var o = P(p[0], p[1], p[2]), a = P(p[0] + e1[0], p[1] + e1[1], p[2] + e1[2]),
      b = P(p[0] + e2[0], p[1] + e2[1], p[2] + e2[2]);
    ctx.setTransform(a[0] - o[0], a[1] - o[1], b[0] - o[0], b[1] - o[1], o[0], o[1]);
    ctx.drawImage(t, 0, 0, 8, 8, -0.03, -0.03, 8.06, 8.06);
  }

  /* Голова в изометрии: лицо слева, левый бок справа, макушка сверху; второй
     слой скина (шляпа) — чуть больше, как в игре. */
  function drawHead(cv, sk) {
    var r = w.devicePixelRatio || 1, W = Math.round((cv.clientWidth || 26) * r);
    var u = W / (18 * 0.866), c = 0.866 * u, s = 0.5 * u;
    cv.width = W;
    cv.height = Math.round(18 * u);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var ox = c, oy = 9 * s + 0.5 * u;
    var P = function (x, y, z) { return [ox + x * c + z * c, oy + x * s + y * u - z * s]; };
    [[0, 1], [32, 1.125]].forEach(function (L) {
      var d = L[0], e = L[1], q = function (v) { return 4 + (v - 4) * e; };
      face(ctx, sk, 8 + d, 0, [q(0), q(0), q(8)], [e, 0, 0], [0, 0, -e], 1, P);
      face(ctx, sk, 8 + d, 8, [q(0), q(0), q(0)], [e, 0, 0], [0, e, 0], 0.86, P);
      face(ctx, sk, 16 + d, 8, [q(8), q(0), q(0)], [0, 0, e], [0, e, 0], 0.7, P);
    });
    cv.classList.add('ok');
  }

  /* Дорисовать все головы внутри root (после каждой перерисовки переписки). */
  function heads(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('canvas.tk-av[data-nick]'), function (cv) {
      if (cv.classList.contains('ok')) return;
      skin(cv.getAttribute('data-nick')).then(function (sk) { drawHead(cv, sk); }, function () {});
    });
  }

  function av(nick) {
    return nick ? '<canvas class="tk-av" data-nick="' + esc(nick) + '" aria-hidden="true"></canvas>'
      : '<img class="tk-av tk-av-logo" src="assets/img/logo.png" alt="" aria-hidden="true">';
  }

  /* ---------------------------------------------------------- файлы */

  function size(n) {
    n = Number(n) || 0;
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' КБ';
    return (Math.round(n / 1024 / 1024 * 10) / 10).toString().replace('.', ',') + ' МБ';
  }

  function fileUrl(f) {
    var u = String((f && f.url) || '');
    if (!u) return '';
    if (/^https:\/\//i.test(u)) return u;
    if (u.charAt(0) !== '/') return '';
    return (A.base() || '') + u;
  }

  /* Вложения — превью; щелчок открывает окно просмотра прямо на странице
     (стрелки листают все вложения обращения). Ссылка остается ссылкой: средняя
     кнопка и «открыть в новой вкладке» работают как раньше. */
  function files(list) {
    if (!list || !list.length) return '';
    var h = '<div class="tk-att">';
    list.forEach(function (f) {
      var u = fileUrl(f);
      if (!u) return;
      var nm = esc(f.name || 'файл');
      var cap = '<span class="tk-att-c">' + nm + ' · ' + size(f.size) + '</span>';
      if (/^text\//i.test(f.type || '')) {
        // Лог — не в окно просмотра, а отдельной вкладкой: браузер покажет его текстом.
        var ext = /\.log$/i.test(f.name || '') ? 'LOG' : 'TXT';
        h += '<div class="tk-att-i txt"><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="Открыть текст">' +
          '<span class="tk-att-doc" aria-hidden="true"><b>' + ext + '</b><i></i><i></i><i></i></span>' + cap + '</a></div>';
        return;
      }
      var a ='<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" data-lb="' +
        (f.video ? 'v' : 'i') + '" data-name="' + nm + '">';
      h += '<div class="tk-att-i' + (f.video ? ' vid' : '') + '">' + a + (f.video
        ? '<video preload="metadata" muted playsinline src="' + esc(u) + '#t=0.1"></video><i class="tk-att-play" aria-hidden="true"></i>'
        : '<img loading="lazy" src="' + esc(u) + '" alt="' + esc(f.name || 'вложение') + '">') + cap + '</a></div>';
    });
    return h + '</div>';
  }

  /* ------------------------------------------------ окно просмотра */

  var LB = null;
  function lbOpen(items, at) {
    if (!LB) {
      LB = document.createElement('div');
      LB.className = 'tk-lb';
      LB.setAttribute('role', 'dialog');
      LB.setAttribute('aria-modal', 'true');
      LB.innerHTML = '<div class="tk-lb-top"><span class="tk-lb-n"></span><span class="tk-lb-c"></span>' +
        '<a class="tk-lb-o" target="_blank" rel="noopener noreferrer">Открыть отдельно</a>' +
        '<button type="button" class="tk-lb-x" aria-label="Закрыть">×</button></div>' +
        '<button type="button" class="tk-lb-a prev" aria-label="Предыдущее">‹</button>' +
        '<div class="tk-lb-s"></div>' +
        '<button type="button" class="tk-lb-a next" aria-label="Следующее">›</button>';
      document.body.appendChild(LB);
      LB.addEventListener('click', function (e) {
        if (e.target.closest('.tk-lb-x') || e.target === LB || e.target.classList.contains('tk-lb-s')) lbClose();
        else if (e.target.closest('.prev')) lbGo(-1);
        else if (e.target.closest('.next')) lbGo(1);
      });
      document.addEventListener('keydown', function (e) {
        if (!LB.classList.contains('on')) return;
        if (e.key === 'Escape') lbClose();
        else if (e.key === 'ArrowLeft') lbGo(-1);
        else if (e.key === 'ArrowRight') lbGo(1);
      });
    }
    LB.items = items;
    LB.at = at;
    LB.classList.add('on');
    document.documentElement.classList.add('tk-lb-lock');
    lbShow();
    LB.querySelector('.tk-lb-x').focus();
  }
  function lbShow() {
    var it = LB.items[LB.at], s = LB.querySelector('.tk-lb-s');
    s.innerHTML = it.v
      ? '<video controls autoplay playsinline src="' + esc(it.u) + '"></video>'
      : '<img src="' + esc(it.u) + '" alt="' + esc(it.n) + '">';
    LB.querySelector('.tk-lb-n').textContent = LB.items.length > 1 ? (LB.at + 1) + ' из ' + LB.items.length : '';
    LB.querySelector('.tk-lb-c').textContent = it.n;
    LB.querySelector('.tk-lb-o').href = it.u;
    LB.classList.toggle('one', LB.items.length < 2);
  }
  function lbGo(d) {
    if (LB.items.length < 2) return;
    LB.at = (LB.at + d + LB.items.length) % LB.items.length;
    lbShow();
  }
  function lbClose() {
    LB.classList.remove('on');
    LB.querySelector('.tk-lb-s').innerHTML = '';   // видео замолкает
    document.documentElement.classList.remove('tk-lb-lock');
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-lb]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    var box = a.closest('.tk-thread, .tkd-files, .tk-view, .tk-att') || document;
    var all = Array.prototype.slice.call(box.querySelectorAll('a[data-lb]'));
    lbOpen(all.map(function (x) {
      return { u: x.getAttribute('href'), v: x.getAttribute('data-lb') === 'v', n: x.getAttribute('data-name') || '' };
    }), Math.max(0, all.indexOf(a)));
  });

  /* ------------------------------------------------------ на связи */

  /* Кто из команды сейчас на связи: голова, ник, должность ее цветом и где он —
     на сайте, в игре. list — crew из службы. Для игрока невидимки служба не
     присылает вовсе; команде они приходят с пометкой hidden. */
  function color(c) {
    return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '';
  }
  function crew(list, staffView) {
    list = list || [];
    if (!list.length) {
      return '<div class="tk-crew empty"><p>' + (staffView
        ? 'Из команды сейчас никого нет ни на сайте, ни в игре.'
        : 'Сейчас никого из команды нет на связи — ответят, как только зайдут.') + '</p></div>';
    }
    return '<div class="tk-crew"><ul>' + list.map(function (c) {
      var col = color(c.color);
      var where = [];
      if (c.site) where.push('<span class="tk-crew-w site">на сайте</span>');
      if (c.game) where.push('<span class="tk-crew-w game">в игре</span>');
      if (staffView && c.hidden) where.push('<span class="tk-crew-w hid">невидим</span>');
      return '<li>' + av(c.nick) + '<div><b>' + esc(c.nick || '') + '</b>' +
        '<span class="tk-crew-r"' + (col ? ' style="color:' + col + '"' : '') + '>' + esc(c.title || 'команда') +
        '</span></div><div class="tk-crew-ws">' + where.join('') + '</div></li>';
    }).join('') + '</ul></div>';
  }

  /* ------------------------------------------------------- обращение */

  function fields(list) {
    if (!list || !list.length) return '';
    var h = '<dl class="tk-fields">';
    list.forEach(function (f) {
      h += '<dt>' + esc(f.label || '') + '</dt><dd>' + text(f.value || '') + '</dd>';
    });
    return h + '</dl>';
  }

  /* Переписка. me — ник смотрящего (его сообщения справа), staffView — пульт
     команды: там видны внутренние заметки и подписано, кто из команды писал. */
  function thread(list, me, staffView) {
    if (!list || !list.length) {
      return '<p class="tk-none">Переписки пока нет — ' +
        (staffView ? 'игрок ждет первого ответа.' : 'команда еще не ответила.') + '</p>';
    }
    var h = '<div class="tk-thread">';
    list.forEach(function (m) {
      if (m.sys) {
        h += '<div class="tk-sys"><span>' + text(m.text || '') + '</span>' + when(m.at) + '</div>';
        return;
      }
      var mine = me && String(m.who || '').toLowerCase() === String(me).toLowerCase();
      var nick = m.who || '';
      var name = m.staff ? (nick ? esc(nick) : 'Команда AEGIS') : esc(nick || 'игрок');
      // Должность пишет служба (rank + ее цвет); старые сообщения без нее — «команда».
      var role = m.staff ? (nick ? esc(m.rank || (staffView ? 'команда' : 'команда AEGIS')) : '') : (mine ? 'вы' : '');
      var rc = m.staff ? color(m.rankColor) : '';
      // В пульте ник игрока открывает его карточку.
      if (staffView && !m.staff && nick) {
        name = '<button type="button" class="tk-who" data-player="' + esc(nick) + '">' + name + '</button>';
      }
      var cls = 'tk-msg' + (m.staff ? ' st' : '') + (m.bot ? ' bot' : '') + (mine ? ' me' : '') + (m.internal ? ' int' : '');
      h += '<div class="' + cls + '">' + av(m.bot ? '#sigea' : nick) + '<div class="tk-mb"><div class="tk-mh"><b>' + name + '</b>' +
        (role ? '<span class="tk-role"' + (rc ? ' style="color:' + rc + ';border-color:' + rc + '55"' : '') +
          '>' + role + '</span>' : '') +
        (m.internal ? '<span class="pill">заметка для команды</span>' : '') +
        when(m.at) + '</div>' +
        (m.text ? '<div class="tk-mt">' + (m.bot ? botText(m.text) : text(m.text)) + '</div>' : '') +
        files(m.files) + '</div></div>';
    });
    return h + '</div>';
  }

  /* ------------------------------------------------------------ вход */

  /* Рисует форму входа в el. opts.title / opts.lead — свои слова страницы,
     opts.done() — что делать после входа. */
  function login(el, opts) {
    opts = opts || {};
    var id = 'tkL' + Math.floor(Math.random() * 1e6);
    el.innerHTML = '<div class="cab-login tk-login"><h2>' + esc(opts.title || 'Вход') + '</h2>' +
      '<p class="cl-lead">' + (opts.lead || 'Ник и пароль те же, что в лаунчере.') + '</p>' +
      '<form id="' + id + '" novalidate>' +
      '<div class="field"><label for="' + id + 'n">Игровое имя</label>' +
      '<input id="' + id + 'n" type="text" autocomplete="username" spellcheck="false" ' +
      'maxlength="16" placeholder="Например, VineZerro"></div>' +
      '<div class="field"><label for="' + id + 'p">Пароль</label>' +
      '<input id="' + id + 'p" type="password" autocomplete="current-password" ' +
      'placeholder="Пароль от лаунчера"></div>' +
      '<div class="form-go"><button class="btn btn-primary" type="submit">Войти</button>' +
      '<span class="fg-note" role="status"></span></div></form>' +
      (opts.after || '') + '</div>';
    var f = document.getElementById(id);
    var say = f.querySelector('.fg-note');
    var btn = f.querySelector('button');
    var nick = document.getElementById(id + 'n');
    var pass = document.getElementById(id + 'p');
    var s = A.session();
    if (s && s.nick) nick.value = s.nick;
    if (opts.focus !== false && w.innerWidth > 900) (nick.value ? pass : nick).focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = nick.value.trim(), p = pass.value;
      if (!n || !p) { say.textContent = 'Впишите имя и пароль.'; return; }
      btn.disabled = true; btn.textContent = 'Входим…'; say.textContent = '';
      A.call('/cab/login', { body: { nick: n, pass: p }, auth: false }).then(function (d) {
        A.setSession({ token: d.token, nick: d.nick || n, role: d.role || '',
          admin: !!d.admin, until: d.until || 0 });
        if (opts.done) opts.done(d);
      }, function (er) {
        btn.disabled = false; btn.textContent = 'Войти';
        say.textContent = er && er.code === 'auth'
          ? 'Имя или пароль не подходят.' : A.textOf(er);
      });
    });
  }

  function logout() {
    var t = A.token(), base = A.base();
    A.setSession(null);
    if (!t || !base) return Promise.resolve();
    return fetch(base + '/cab/logout', {
      method: 'POST', cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function () {}, function () {});
  }

  /* ------------------------------------------------- загрузка файлов */

  var IMG = /^image\/(png|jpe?g|gif|webp)$/i, VID = /^video\/(mp4|quicktime|webm|x-matroska)$/i;
  var IMG_EXT = /\.(png|jpe?g|gif|webp)$/i, VID_EXT = /\.(mp4|mov|webm|mkv)$/i;
  var TXT = /^text\/plain$/i, TXT_EXT = /\.(log|txt)$/i;

  /* Поле вложений. host — куда рисовать, lim — limits из службы.
     Возвращает {ids(), busy(), reset()}; файлы уходят на сервер сразу при
     выборе, в обращение едут только их номера. */
  function uploader(host, lim) {
    lim = lim || {};
    var IMG_MAX = lim.img || 10 * 1024 * 1024, VID_MAX = lim.vid || 200 * 1024 * 1024;
    var TXT_MAX = lim.txt || 0;   // 0 — служба еще старая и логов не примет
    var PER = lim.perMsg || 6;
    var list = [];       // {name, size, state:'up'|'ok'|'bad', pct, id, why}
    var active = 0;
    var id = 'tkF' + Math.floor(Math.random() * 1e6);

    host.innerHTML = '<div class="tk-up">' +
      '<label class="btn btn-dark btn-sm" for="' + id + '">' +
      (TXT_MAX ? 'Приложить скриншот, видео или лог' : 'Приложить скриншот или видео') + '</label>' +
      '<input id="' + id + '" type="file" multiple hidden ' +
      'accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm,.mkv' +
      (TXT_MAX ? ',.log,.txt,text/plain' : '') + '">' +
      '<span class="tk-up-n">Картинки до ' + size(IMG_MAX) + ', видео до ' + size(VID_MAX) +
      (TXT_MAX ? ', логи игры (latest.log, отчет о вылете) до ' + size(TXT_MAX) : '') +
      ', не больше ' + PER + ' за раз.</span><ul class="tk-up-l"></ul></div>';
    var input = document.getElementById(id);
    var ul = host.querySelector('.tk-up-l');

    function draw() {
      ul.innerHTML = list.map(function (x, i) {
        var st = x.state === 'up' ? (x.pct != null ? x.pct + '%' : 'грузится…')
          : x.state === 'ok' ? 'готово' : esc(x.why || 'не загрузилось');
        return '<li class="' + x.state + '"><span class="tk-up-f">' + esc(x.name) + ' · ' + size(x.size) +
          '</span><span class="tk-up-s">' + st + '</span>' +
          (x.state !== 'up' ? '<button type="button" data-i="' + i + '" aria-label="Убрать">×</button>' : '') +
          '</li>';
      }).join('');
    }

    ul.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (!b) return;
      var x = list[Number(b.getAttribute('data-i'))];
      if (!x) return;
      if (x.id) {  // файл уже на сервере, но еще ни к чему не привязан — просим забыть
        A.call('/tickets/drop', { body: { id: x.id } }).then(function () {}, function () {});
      }
      list.splice(list.indexOf(x), 1);
      draw();
    });

    function send(x, file) {
      var base = A.base();
      if (!base) { x.state = 'bad'; x.why = 'служба недоступна'; draw(); return; }
      active++;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', base + '/tickets/upload?name=' + encodeURIComponent(file.name));
      xhr.setRequestHeader('Authorization', 'Bearer ' + A.token());
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) { x.pct = Math.floor(e.loaded / e.total * 100); draw(); }
      };
      xhr.onload = function () {
        active--;
        var d = null;
        try { d = JSON.parse(xhr.responseText); } catch (er) { d = null; }
        if (xhr.status === 401) { x.state = 'bad'; x.why = 'вход устарел — войдите заново'; }
        else if (xhr.status === 413) { x.state = 'bad'; x.why = 'файл слишком большой'; }
        else if (d && d.ok && d.file) { x.state = 'ok'; x.id = d.file.id; }
        else { x.state = 'bad'; x.why = (d && d.text) || ('ошибка ' + xhr.status); }
        draw();
      };
      xhr.onerror = function () { active--; x.state = 'bad'; x.why = 'связь оборвалась'; draw(); };
      xhr.send(file);
    }

    input.addEventListener('change', function () {
      var fl = Array.prototype.slice.call(input.files || []);
      input.value = '';
      fl.forEach(function (file) {
        var x = { name: file.name, size: file.size, state: 'up', pct: 0 };
        var vid = VID.test(file.type) || VID_EXT.test(file.name);
        var img = !vid && (IMG.test(file.type) || IMG_EXT.test(file.name));
        var txt = !vid && !img && !!TXT_MAX && (TXT.test(file.type) || TXT_EXT.test(file.name));
        if (list.filter(function (y) { return y.state !== 'bad'; }).length >= PER) {
          x.state = 'bad'; x.why = 'не больше ' + PER + ' файлов за раз';
        } else if (!img && !vid && !txt) {
          x.state = 'bad'; x.why = 'только PNG, JPG, GIF, WebP, MP4, MOV, WebM, MKV' + (TXT_MAX ? ', .log, .txt' : '');
        } else if (vid && file.size > VID_MAX) {
          x.state = 'bad'; x.why = 'видео больше ' + size(VID_MAX);
        } else if (txt && file.size > TXT_MAX) {
          x.state = 'bad'; x.why = 'лог больше ' + size(TXT_MAX) + ' — пришлите latest.log или кусок с ошибкой';
        } else if (img && file.size > IMG_MAX) {
          x.state = 'bad'; x.why = 'картинка больше ' + size(IMG_MAX);
        }
        list.push(x);
        if (x.state === 'up') send(x, file);
      });
      draw();
    });

    return {
      ids: function () {
        return list.filter(function (x) { return x.state === 'ok' && x.id; })
          .map(function (x) { return x.id; });
      },
      busy: function () { return active > 0; },
      reset: function () { list = []; draw(); }
    };
  }

  /* ------------------------------------------------- живая переписка */

  /* Овнер 25.09.2026: «чтобы в тикете было видно, когда кто-то печатает, и даже
     ИИ-агент». Строка под перепиской: ники цветом должности, SIGEA — своим. */
  function typingLine(list) {
    if (!list || !list.length) return '';
    var names = list.map(function (x) {
      var c = color(x.rankColor);
      var n = x.bot ? 'SIGEA' : (x.who || (x.staff ? 'команда' : 'игрок'));
      return '<b' + (c ? ' style="color:' + c + '"' : '') +
        (x.rank ? ' title="' + esc(x.rank) + '"' : '') + '>' + esc(n) + '</b>' +
        (x.note ? ' <span class="tk-typing-n">(заметка)</span>' : '');
    });
    var verb = list.length > 1 ? 'печатают' : (list[0].bot ? 'пишет ответ' : 'печатает');
    return '<span class="tk-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span>' + names.join(', ') + ' ' + verb + '…</span>';
  }

  /* Раз в 3 с спрашивает у службы отпечаток ленты и кто печатает. Лента
     сменилась — o.changed(): страница сама перечитает обращение, не трогая
     поле ответа. Вкладка скрыта — молчим; служба не отвечает — реже; вход
     устарел, обращения нет или старая служба не знает двери — выключаемся.
       o.url — '/tickets/live' или '/adm/ticket/live', o.id — номер,
       o.box — элемент строки «печатает…»,
       o.type — '/tickets/typing' или '/adm/ticket/typing',
       o.extra() — добавка к пингу (пульт: { note: true }). */
  function live(o) {
    var ver = null, stopped = false, timer = 0, fails = 0;
    var pingOn = false, pingAt = 0, idle = 0;

    function show(list) {
      if (!o.box) return;
      var h = typingLine(list);
      if (o.box.innerHTML !== h) o.box.innerHTML = h;
      o.box.hidden = !h;
    }
    function later(ms) { if (!stopped) timer = setTimeout(tick, ms); }
    function tick() {
      timer = 0;
      if (stopped) return;
      if (o.box && !document.body.contains(o.box)) { stop(); return; }
      if (document.hidden) { later(3000); return; }
      A.call(o.url + '?id=' + encodeURIComponent(o.id), { timeout: 8000 }).then(function (r) {
        if (stopped) return;
        fails = 0;
        show(r.typing);
        if (ver === null) {
          // Первый ответ: сверяем со страницей — вдруг сообщение пришло, пока она грузилась.
          ver = r.ver;
          var p = String(r.ver || '').split(':');
          if (o.n != null && (p[0] !== String(o.n) || (o.status && p[2] !== o.status)) && o.changed) o.changed();
        } else if (r.ver && r.ver !== ver) { ver = r.ver; if (o.changed) o.changed(); }
        later(3000);
      }, function (e) {
        if (stopped) return;
        var c = e && e.code;
        if (c === 'auth' || c === 'no_ticket' || c === 'forbidden' || c === 'http' || c === 'offline') { show([]); stop(); return; }
        fails++;
        show([]);
        later(Math.min(60000, 3000 * Math.pow(2, fails)));
      });
    }
    function ping(on) {
      if (stopped || !o.type) return;
      var now = Date.now();
      if (on && pingOn && now - pingAt < 3000) return;
      if (!on && !pingOn) return;
      pingOn = on; pingAt = now;
      var body = { id: o.id, on: on };
      var x = o.extra ? o.extra() : null;
      if (x) Object.keys(x).forEach(function (k) { body[k] = x[k]; });
      A.call(o.type, { body: body, timeout: 8000 }).then(null, function () {});
    }
    /* Поле ответа: печатает — пинг не чаще раза в 3 с, замолчал на 4 с,
       стер все или ушел из поля — «перестал». */
    function watchInput(ta) {
      if (!ta) return;
      ta.addEventListener('input', function () {
        clearTimeout(idle);
        if (!ta.value.trim()) { ping(false); return; }
        ping(true);
        idle = setTimeout(function () { ping(false); }, 4000);
      });
      ta.addEventListener('blur', function () { clearTimeout(idle); ping(false); });
    }
    function stop() {
      if (stopped) return;
      clearTimeout(idle);
      ping(false);
      stopped = true;
      if (timer) { clearTimeout(timer); timer = 0; }
    }
    function sent() { clearTimeout(idle); pingOn = false; }
    function reset() { ver = null; }
    later(1200);
    return { stop: stop, ping: ping, input: watchInput, sent: sent, reset: reset };
  }

  /* «Назад» возвращает туда, где человек был, а не в самый верх (идеи команды 03.10).
     Позицию храним в самой записи истории: у новой записи (щелчок по ссылке) ее нет —
     открываем сверху, у старой (назад/вперед) есть — возвращаем, дождавшись, пока
     страница дорастет до нужной высоты. Хранить по адресу нельзя: повторный щелчок по той
     же теме открывал ее с середины. route() — перерисовать страницу под новый адрес. */
  function backScroll(route, top) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    var tmr = 0;
    function save() {
      clearTimeout(tmr); tmr = 0;
      try { history.replaceState({ y: window.scrollY }, ''); } catch (e) { /* Safari режет частые вызовы */ }
    }
    window.addEventListener('scroll', function () { if (!tmr) tmr = setTimeout(save, 200); }, { passive: true });
    document.addEventListener('click', function (e) {    // уходим по ссылке — запомнить точно
      if (e.target.closest && e.target.closest('a[href^="#"]')) save();
    }, true);
    window.addEventListener('hashchange', function () {
      clearTimeout(tmr); tmr = 0;   // недописанное относится к прошлой записи
      var st = history.state, y = st && st.y, tries = 0;
      if (route() === false) return;
      if (!y) { (top || function () { window.scrollTo(0, 0); })(); return; }
      (function go() {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max >= y - 4 || tries++ > 40) { window.scrollTo(0, Math.min(y, Math.max(0, max))); return; }
        setTimeout(go, 50);
      })();
    });
  }

  w.AegisTk = {
    backScroll: backScroll,
    typingLine: typingLine, live: live,
    cats: cats, catName: catName, cleanName: cleanName, byKey: function (k) { return BY[k]; },
    STATE: STATE, STATE_P: STATE_P, pill: pill, when: when, stamp: stamp, text: text,
    files: files, fields: fields, thread: thread, size: size, heads: heads, av: av,
    login: login, logout: logout, uploader: uploader, crew: crew, color: color,
    skin: skin, stdSkin: defaultFull, drawHead: drawHead, lightbox: lbOpen
  };
})(window);
