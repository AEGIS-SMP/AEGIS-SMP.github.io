/* AEGIS — страница эфиров.
   Читает готовый data/streams.json: кто из отслеживаемых каналов сейчас
   в эфире. Файл раз в десять минут обновляет tools/streams_fetch.py из
   GitHub Actions — своей службы у страницы нет, поэтому эфиры работают
   и на бесплатном хостинге, и ключи площадок в браузер не попадают.

   Кого отслеживаем — data/streamers.json. Если обход ещё ни разу не
   проходил, показываем сам список каналов и честно пишем, что состояние
   пока не проверено, вместо пустоты. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var body = document.getElementById('lvBody');
  if (!body || !A) return;

  var PLAT = {
    twitch: 'Twitch',
    youtube: 'YouTube',
    vkvideo: 'VK Видео'
  };
  var ORDER = ['twitch', 'youtube', 'vkvideo'];

  var rows = [];        // каналы как их видит сборщик
  var at = 0;           // когда был последний обход
  var tab = 'all';
  var lastAt = -1;      // чтобы не перерисовывать одно и то же
  var poll = 0;

  /* ------------------------------------------------------------- загрузка */

  function load(first) {
    return A.local('data/streams.json').then(function (d) {
      var list = (d && d.channels) || [];
      at = Number(d && d.at) || 0;
      if (list.length) return list;
      /* Обхода ещё не было — покажем хотя бы, за кем следим. */
      return A.local('data/streamers.json').then(function (s) {
        return ((s && s.channels) || []).map(function (c) {
          return {
            id: c.id || c.channel, name: c.name || c.channel,
            platform: c.platform, url: c.url || '', note: c.note || '',
            official: !!c.official, live: false, known: false
          };
        });
      }, function () { return []; });
    }).then(function (list) {
      rows = list;
      if (first || at !== lastAt) {
        lastAt = at;
        draw();
      }
    });
  }

  function fail() {
    body.innerHTML =
      '<div class="empty"><h4>Не получилось загрузить эфиры</h4>' +
      '<p>Список каналов не открылся. Обнови страницу — обычно это разовая ' +
      'заминка со связью.</p></div>';
  }

  /* --------------------------------------------------------------- отрисовка */

  function liveCount() {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].live) n++;
    return n;
  }

  function tabs() {
    var live = liveCount();
    var out = [['all', 'Все']];
    if (live) out.push(['live', 'В эфире · ' + live]);
    ORDER.forEach(function (p) {
      var n = 0;
      for (var i = 0; i < rows.length; i++) if (rows[i].platform === p) n++;
      if (n) out.push([p, PLAT[p]]);
    });

    return '<div class="live-tabs">' + out.map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '"' +
        (tab === t[0] ? ' class="on"' : '') + '>' + A.esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }

  function when() {
    if (!at) {
      return 'Каналы ещё ни разу не обходили — состояние ниже не проверено.';
    }
    var live = liveCount();
    return 'Проверено ' + A.ago(at) + ' · ' +
      (live ? 'в эфире ' + live : 'сейчас никто не стримит') +
      ' · список обновляется сам каждые десять минут';
  }

  /* Сколько идёт эфир: «в эфире 2 ч». Время площадка отдаёт по Гринвичу,
     разбираем через Date — часовой пояс игрока при этом не важен. */
  function since(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!t) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'только начал';
    if (m < 60) return 'в эфире ' + m + ' мин';
    var h = Math.floor(m / 60);
    if (h < 24) return 'в эфире ' + h + ' ч';
    return 'в эфире ' + Math.floor(h / 24) + ' дн';
  }

  function card(r) {
    var href = r.watch || r.url || '';
    var thumb = r.live ? (r.thumb || '') : '';
    var letter = A.esc((r.name || '?').trim().charAt(0).toUpperCase());

    var top;
    if (r.live) top = '<span class="pill live">в эфире</span>';
    else if (r.known) top = '<span class="lv-st">не в эфире</span>';
    else top = '<span class="lv-st">не проверяли</span>';

    /* Буква канала лежит подложкой всегда: если превью не загрузилось
       (площадка убрала картинку, эфир кончился минуту назад), на её месте
       остаётся спокойный фон, а не битый значок. */
    var head =
      '<div class="live-thumb">' +
      '<div class="lv-noimg">' + letter + '</div>' +
      (thumb
        ? '<img src="' + A.esc(thumb) + '" alt="" loading="lazy" ' +
          'onerror="this.style.display=\'none\'">'
        : '') +
      top +
      '<span class="l-plat">' + A.esc(PLAT[r.platform] || r.platform) + '</span>' +
      (r.live && r.viewers
        ? '<span class="l-view">' + A.esc(A.num(r.viewers)) + ' смотрят</span>'
        : '') +
      '</div>';

    /* Заголовок: у живого эфира — название трансляции, у остальных —
       чем канал занят вообще. Пустую строку не рисуем. */
    var title = (r.live ? r.title : (r.note || r.title)) || '';
    if (!title) title = r.live ? 'Эфир идёт' : 'Канал проекта';

    var right = r.live ? since(r.started) : '';
    var meta =
      '<div class="live-meta">' +
      '<h3>' + A.esc(title) + '</h3>' +
      '<div class="live-who">' +
      (r.avatar ? '<img src="' + A.esc(r.avatar) + '" alt="" loading="lazy">' : '') +
      '<span class="lw-n">' + A.esc(r.name) +
      (r.official ? ' · канал проекта' : '') + '</span>' +
      (right ? '<span class="lw-off">' + A.esc(right) + '</span>' : '') +
      '</div></div>';

    var cls = 'live-card' + (r.live ? '' : ' off');
    if (!href) return '<div class="' + cls + '">' + head + meta + '</div>';
    return '<a class="' + cls + '" href="' + A.esc(href) +
      '" target="_blank" rel="noopener">' + head + meta + '</a>';
  }

  function grid(list) {
    return '<div class="live-grid">' + list.map(card).join('') + '</div>';
  }

  function cta() {
    var dis = A.link('discord');
    return '<div class="lv-cta"><h4>Стримишь на AEGIS?</h4>' +
      '<p>Канал попадает на эту страницу вручную — оставь заявку через ' +
      '<a href="tickets.html#/streamer">обращение «Стать стримером проекта»</a>, ' +
      'и после проверки он появится тут вместе с остальными. Площадка любая ' +
      'из трёх: Twitch, YouTube или VK Видео.</p>' +
      '<p>Отдельного «стримерского» режима на сервере нет: играешь как все, ' +
      'просто зрители видят, что ты в эфире' +
      (dis ? ', а команда — что тебя стоит подсветить в <a href="' + A.esc(dis) +
        '" target="_blank" rel="noopener">Discord</a>' : '') +
      '.</p></div>';
  }

  function draw() {
    if (!rows.length) {
      body.innerHTML =
        '<div class="empty"><h4>Пока никого не отслеживаем</h4>' +
        '<p>Список стримеров ещё пустой. Как только каналы появятся, здесь будет ' +
        'видно, кто сейчас в эфире.</p></div>' + cta();
      return;
    }

    var list = rows.filter(function (r) {
      if (tab === 'all') return true;
      if (tab === 'live') return r.live;
      return r.platform === tab;
    });

    var html = '<div class="lv-head">' + tabs() +
      '<div class="lv-when">' + A.esc(when()) + '</div></div>';

    if (!list.length) {
      html += '<div class="empty"><h4>Сейчас тут пусто</h4>' +
        '<p>' + (tab === 'live'
          ? 'Никто из наших не в эфире. Загляни позже — страница обновляется сама.'
          : 'На этой площадке пока нет отслеживаемых каналов.') + '</p></div>';
    } else if (tab === 'all') {
      var on = list.filter(function (r) { return r.live; });
      var off = list.filter(function (r) { return !r.live; });
      if (on.length) html += '<div class="lv-gt">Сейчас в эфире</div>' + grid(on);
      if (off.length) {
        html += '<div class="lv-gt">' +
          (on.length ? 'Остальные каналы' : 'Каналы проекта и друзей') +
          '</div>' + grid(off);
      }
    } else {
      html += grid(list);
    }

    body.innerHTML = html + cta();

    var btns = body.querySelectorAll('.live-tabs button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var t = this.getAttribute('data-tab');
        if (t === tab) return;
        tab = t;
        location.hash = t === 'all' ? '' : '#/' + t;
        draw();
      });
    }
  }

  /* ------------------------------------------------------------- маршруты */

  function fromHash() {
    var t = (location.hash || '').replace(/^#\/?/, '');
    if (t === 'live' || PLAT[t]) return t;
    return 'all';
  }

  window.addEventListener('hashchange', function () {
    var t = fromHash();
    if (t === tab) return;
    tab = t;
    draw();
  });

  /* Файл статический и лёгкий — перечитываем раз в две минуты, но только
     пока вкладку смотрят: фоновая вкладка сеть не дёргает. */
  function watch() {
    clearInterval(poll);
    poll = setInterval(function () {
      if (document.visibilityState === 'visible') load(false).catch(function () { });
    }, 120000);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') load(false).catch(function () { });
  });

  tab = fromHash();
  load(true).then(watch, fail);
})();
