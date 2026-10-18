/* AEGIS — лента: ролики и снимки, снятые камерой в игре (feed.html).

   Служба — aegis-feed (dev/feed/feed.py) за api.aegis-smp.com/feed/*.
   Смотреть может любой. Лайк, комментарий, жалоба и скачивание — после входа
   тем же ником и паролем, что в лаунчере: ключ сессии сайта уходит Bearer.
   Скачивается копия со знаком автора; оригинал без знака — только владельцу.

   Подписи и комментарии — данные: всё через esc(), #теги и @упоминания
   красятся уже после разбора, HTML не пропускаем.

   Запрос свой, не AegisApi.call: тот на любой 401/403 стирает вход на всём
   сайте, а здесь 403 — обычное «нельзя» (чужой пост, закрытый файл), и
   выкидывать игрока из кабинета из-за него нельзя. */
(function (w, d) {
  'use strict';

  var A = w.AegisApi, T = w.AegisTk;
  var root = d.getElementById('fdBody');
  if (!root || !A || !T) return;
  var esc = A.esc;

  var TABS = [['video', 'Ролики'], ['photo', 'Снимки'], ['top', 'Топ'], ['mine', 'Мои']];
  var PERIODS = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['season', 'Сезон']];
  var PERIOD_FOR = { day: 'день', week: 'неделю', month: 'месяц', season: 'сезон' };
  var REASONS = ['Оскорбления', 'Чужое / украдено', '18+ или мерзость', 'Спам', 'Другое'];
  var PAGE = 8, MAX_CARDS = 240, NEAR = 1200;
  var TOKEN = /([#@])([0-9A-Za-zА-Яа-яЁё_]{2,32})/g;
  var NICK = /^[A-Za-z0-9_]{3,16}$/, ID = /^[a-z2-7]{10}$/;

  function svg(p, fill) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (fill ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }
  var HEART = '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/>';
  var I = {
    heart: svg(HEART),
    heartOn: svg(HEART, true),
    com: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>'),
    dl: svg('<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', true),
    play: svg('<path d="M7 4.5v15l12.5-7.5z"/>', true),
    snd: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
    mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>'),
    x: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
    link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
    flag: svg('<path d="M5 21V4"/><path d="M5 4.5h11l-2 4 2 4H5"/>'),
    hide: svg('<path d="M3 3l18 18"/><path d="M10.6 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7"/><path d="M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1.1"/>'),
    back: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4.5h4.5"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>'),
    orig: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 16l5-5 4 4 3-3 5 5"/>')
  };

  /* ---------------------------------------------------------- память */

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('aegis.feed') || '{}') || {}; } catch (e) { saved = {}; }
  function remember() {
    try {
      localStorage.setItem('aegis.feed', JSON.stringify({ tab: st.tab, kind: st.kind, period: st.period }));
    } catch (e) { /* личный режим — не беда */ }
  }

  var st = {
    tab: /^(video|photo|top|mine)$/.test(saved.tab) ? saved.tab : 'video',
    kind: saved.kind === 'photo' ? 'photo' : 'video',
    period: /^(day|week|month|season)$/.test(saved.period) ? saved.period : 'week',
    me: { in: false }, cur: null, end: false, busy: false, gen: 0, n: 0, first: null, failed: false,
    // нажатый #тег: пока он задан, вместо вкладки — все посты с ним
    tag: null, tkind: 'video', tagCount: null, tagAuto: false
  };
  var cards = {}, active = null, muted = true, viewed = {}, ratios = {};
  var list, tail, hint, sub, meBox, tagBox;
  var TAG = /^[0-9A-Za-zА-Яа-яЁё_]{2,32}$/;

  /* ---------------------------------------------------------- запрос */

  function fail(code, text, status) { return { aegis: true, code: code, text: text, status: status || 0 }; }

  function req(path, opts) {
    opts = opts || {};
    var base = A.base();
    if (!base) return Promise.reject(fail('offline', 'Лента сейчас недоступна.'));
    var init = { method: opts.body ? 'POST' : 'GET', cache: 'no-store', headers: {} };
    var t = A.token();
    if (t) init.headers.Authorization = 'Bearer ' + t;
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(base + '/feed' + path, init).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok && j && j.ok !== false) return j;
        if (!j || !j.code) throw fail('closed', 'Лента откроется вместе с обновлением сервера — позже.', r.status);
        throw fail(j.code, j.text || 'Лента не ответила.', r.status);
      });
    }, function () {
      throw fail('offline', 'Нет связи с лентой. Проверьте интернет и попробуйте ещё раз.');
    });
  }

  function url(p) { return p ? A.base() + p : ''; }

  /* ---------------------------------------------------------- слова */

  function plural(n, f) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return f[2];
    if (b === 1) return f[0];
    if (b >= 2 && b <= 4) return f[1];
    return f[2];
  }

  function rich(s) {
    s = String(s || '');
    var out = '', at = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      var prev = m.index > 0 ? s.charAt(m.index - 1) : '';
      if (/[0-9A-Za-zА-Яа-яЁё_#@]/.test(prev)) continue;
      out += esc(s.slice(at, m.index));
      if (m[1] === '@' && NICK.test(m[2])) {
        out += '<a class="m" href="players.html#/p/' + encodeURIComponent(m[2]) + '">' + esc(m[0]) + '</a>';
      } else if (m[1] === '#') {
        // нажал — все посты с этим тегом; ссылка настоящая, чтобы открывалась и в новой вкладке
        out += '<a class="t" href="feed.html?t=' + encodeURIComponent(m[2]) + '" data-tag="' + esc(m[2]) + '">' +
          esc(m[0]) + '</a>';
      } else {
        out += esc(m[0]);
      }
      at = m.index + m[0].length;
    }
    return out + esc(s.slice(at));
  }

  function who(nick) {
    return NICK.test(nick || '') ? 'players.html#/p/' + encodeURIComponent(nick) : 'players.html';
  }

  function topSay(it) {
    if (!it.top || !it.top.say) return '';
    var n = Number(it.top.days) || 0;
    return it.top.say + (n >= 1 ? ' · в топе ' + n + ' ' + plural(n, ['день', 'дня', 'дней']) : '');
  }

  var STATUS = { processing: 'обрабатывается', hidden: 'скрыт до проверки', archived: 'убран из ленты',
    failed: 'не обработан' };

  /* ---------------------------------------------------------- каркас */

  function frame() {
    root.innerHTML = '<div class="fd">' +
      '<div class="fd-bar"><div class="live-tabs" id="fdTabs" role="tablist" aria-label="Что смотреть">' +
      TABS.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div><div class="fd-me" id="fdMe"></div></div>' +
      '<div class="fd-sub" id="fdSub" hidden>' +
      '<div class="live-tabs" id="fdPer" role="tablist" aria-label="За какой срок">' +
      PERIODS.map(function (p) {
        return '<button type="button" role="tab" data-per="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="live-tabs" id="fdKind" role="tablist" aria-label="Ролики или снимки">' +
      '<button type="button" role="tab" data-kind="video">Ролики</button>' +
      '<button type="button" role="tab" data-kind="photo">Снимки</button></div></div>' +
      '<div class="fd-tag" id="fdTag" hidden></div>' +
      '<p class="fd-hint" id="fdHint"></p>' +
      '<div class="fd-list" id="fdList"></div>' +
      '<div id="fdTail"></div></div>';
    list = d.getElementById('fdList');
    tail = d.getElementById('fdTail');
    hint = d.getElementById('fdHint');
    sub = d.getElementById('fdSub');
    meBox = d.getElementById('fdMe');
    tagBox = d.getElementById('fdTag');

    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', function (e) {
      if (e.target.closest('.fd-media')) e.preventDefault();
    });
  }

  function paintTabs() {
    Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) {
      var on = !st.tag && b.getAttribute('data-tab') === st.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    sub.hidden = !!st.tag || st.tab !== 'top';
    tagBox.hidden = !st.tag;
    if (st.tag) {
      paintTag();
      hint.textContent = 'Все публикации, где в подписи стоит #' + st.tag + '. Новые — сверху.';
      return;
    }
    Array.prototype.forEach.call(root.querySelectorAll('[data-per]'), function (b) {
      var on = b.getAttribute('data-per') === st.period;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-kind]'), function (b) {
      var on = b.getAttribute('data-kind') === st.kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var h = {
      video: 'Ролики снимают камерой прямо в игре (клавиша F6). Листайте вниз: когда новые ' +
        'кончатся, лента пойдёт по кругу, а чаще будет попадаться то, что понравилось людям.',
      photo: 'Снимки из игры — той же камерой (F6), режим «снимок». Лента бесконечная: листайте вниз.',
      top: 'Самое популярное за ' + PERIOD_FOR[st.period] + ': лайки и комментарии игроков, свежие весят ' +
        'больше. Накрутка не засчитывается.',
      mine: 'Всё, что вы сняли и опубликовали. Убрать пост из ленты — кнопка «Ещё».'
    };
    hint.textContent = h[st.tab];
  }

  /* ------------------------------------------------------------ #тег */

  function paintTag() {
    var c = st.tagCount, nv = c ? Number(c.video) || 0 : -1, np = c ? Number(c.photo) || 0 : -1;
    function kb(k, name, n) {
      var on = st.tkind === k;
      return '<button type="button" role="tab" data-tkind="' + k + '" class="' + (on ? 'on' : '') +
        '" aria-selected="' + (on ? 'true' : 'false') + '">' + name + (n >= 0 ? ' <small>' + A.num(n) + '</small>' : '') +
        '</button>';
    }
    tagBox.innerHTML = '<div class="fd-tag-h"><b>#' + esc(st.tag) + '</b><span>' + (c
      ? A.num(nv) + ' ' + plural(nv, ['ролик', 'ролика', 'роликов']) + ' · ' +
        A.num(np) + ' ' + plural(np, ['снимок', 'снимка', 'снимков'])
      : 'ищем публикации…') + '</span></div>' +
      '<div class="live-tabs" role="tablist" aria-label="Ролики или снимки">' +
      kb('video', 'Ролики', nv) + kb('photo', 'Снимки', np) + '</div>' +
      '<button type="button" class="btn btn-dark btn-sm fd-untag" data-untag>' + I.x + 'Вся лента</button>';
  }

  function openTag(tag, kind, push) {
    tag = String(tag || '').replace(/^#/, '');
    if (!TAG.test(tag)) return;
    if (drawer && drawer.classList.contains('on')) closeComs();
    st.tag = tag;
    st.tkind = kind === 'photo' ? 'photo' : 'video';
    st.tagCount = null;
    st.tagAuto = true;
    st.first = null;
    if (push !== false) setUrl(tag);
    reset();
    toFeed();
  }

  // к началу ленты (не страницы): заголовок тега сразу на виду, шапка сайта его не закрывает
  function toFeed() {
    var y = root.getBoundingClientRect().top + w.pageYOffset - 84;
    w.scrollTo(0, Math.max(0, y));
  }

  function closeTag(push) {
    st.tag = null;
    st.tagCount = null;
    if (push !== false) setUrl(null);
  }

  // адрес ?t=тег — чтобы им можно было поделиться, а «назад» в браузере возвращал в ленту
  function setUrl(tag) {
    try {
      history.pushState({ t: tag || '' }, '', location.pathname + (tag ? '?t=' + encodeURIComponent(tag) : ''));
    } catch (e) { /* без истории — не беда */ }
  }

  w.addEventListener('popstate', function () {
    var t = new URLSearchParams(location.search).get('t') || '';
    if (TAG.test(t)) { if (t !== st.tag) openTag(t, st.tkind, false); }
    else if (st.tag) { closeTag(false); reset(); }
  });

  function paintMe() {
    var m = st.me;
    if (m && m.in) {
      meBox.innerHTML = '<span>Вы вошли как <b>' + esc(m.nick) + '</b>' +
        (m.banned ? ' — аккаунт заблокирован' : '') + '</span>';
    } else {
      meBox.innerHTML = '<span>Лайки, комментарии и скачивание — после входа.</span>' +
        '<button type="button" class="btn btn-dark btn-sm" data-login>Войти</button>';
    }
  }

  /* -------------------------------------------------------- загрузка */

  function reset(tab) {
    st.gen++;
    st.tab = tab || st.tab;
    st.cur = null;
    st.end = false;
    st.busy = false;
    st.failed = false;
    stopActive();
    Object.keys(cards).forEach(function (k) { unwatch(cards[k]); });
    cards = {};
    ratios = {};
    st.n = 0;
    list.innerHTML = '';
    remember();
    paintTabs();
    more();
  }

  function more() {
    if (st.busy || st.end || st.failed) return;
    if (!st.tag && st.tab === 'mine' && !st.me.in) {
      st.end = true;
      tail.innerHTML = '<div class="empty"><h4>Здесь будут ваши ролики и снимки</h4>' +
        '<p>Войдите тем же ником и паролем, что в лаунчере, — и тут появится всё, что вы сняли.</p>' +
        '<div class="fd-more"><button type="button" class="btn btn-primary btn-sm" data-login>Войти</button></div></div>';
      return;
    }
    if (st.n >= MAX_CARDS) {
      st.end = true;
      tail.innerHTML = '<div class="fd-end">Вы пролистали ' + MAX_CARDS + ' публикаций подряд.' +
        '<div class="fd-more"><button type="button" class="btn btn-dark btn-sm" data-again>Начать сначала</button></div></div>';
      return;
    }
    st.busy = true;
    tail.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    var g = st.gen, p, cur = st.cur ? '&cur=' + encodeURIComponent(st.cur) : '';
    if (st.tag) p = req('/tag?t=' + encodeURIComponent(st.tag) + '&kind=' + st.tkind + '&n=' + PAGE + cur);
    else if (st.tab === 'top') p = req('/top?kind=' + st.kind + '&period=' + st.period);
    else if (st.tab === 'mine') p = req('/mine');
    else p = req('/list?kind=' + st.tab + '&n=' + PAGE + cur);
    p.then(function (r) {
      if (g !== st.gen) return;
      st.busy = false;
      if (st.tag && r.count) {
        st.tagCount = r.count;
        // у тега нет роликов, но есть снимки (или наоборот) — сразу показываем то, что есть
        var other = st.tkind === 'video' ? 'photo' : 'video';
        if (st.tagAuto && !st.n && !(r.items || []).length && Number(r.count[other]) > 0) {
          st.tagAuto = false;
          st.tkind = other;
          reset();
          return;
        }
        st.tagAuto = false;
        paintTag();
      }
      var its = (r.items || []).filter(function (it) {
        return it && ID.test(it.id) && !(st.first && it.id === st.first && !it.again) &&
          !(st.tag && Object.keys(cards).some(function (k) { return cards[k].it.id === it.id; }));
      });
      its.forEach(function (it) { add(it, false); });
      if ((!st.tag && (st.tab === 'top' || st.tab === 'mine')) || !r.next || !(r.items || []).length) st.end = true;
      else st.cur = r.next;
      paintTail();
      if (!st.end) setTimeout(nearEnd, 60);
    }, function (e) {
      if (g !== st.gen) return;
      st.busy = false;
      st.failed = true;
      tail.innerHTML = '<div class="empty"><h4>' +
        (e.code === 'closed' ? 'Лента ещё не открыта' : 'Лента не загрузилась') + '</h4><p>' + esc(e.text) + '</p>' +
        (e.code === 'closed' ? '' : '<div class="fd-more"><button type="button" class="btn btn-dark btn-sm" data-retry>Повторить</button></div>') +
        '</div>';
    });
  }

  function paintTail() {
    if (!st.end) { tail.innerHTML = ''; return; }
    if (st.tag) {
      var vid = st.tkind === 'video';
      tail.innerHTML = st.n
        ? '<div class="fd-end">Это все ' + (vid ? 'ролики' : 'снимки') + ' с #' + esc(st.tag) + '.' +
          '<div class="fd-more"><button type="button" class="btn btn-dark btn-sm" data-untag>Вернуться в ленту</button></div></div>'
        : '<div class="empty"><h4>' + (vid ? 'Роликов' : 'Снимков') + ' с #' + esc(st.tag) + ' пока нет</h4>' +
          '<p>Снимите своё в игре (F6) и впишите #' + esc(st.tag) + ' в подпись — публикация появится здесь.</p>' +
          '<div class="fd-more"><button type="button" class="btn btn-dark btn-sm" data-untag>Вернуться в ленту</button></div></div>';
      return;
    }
    if (st.n) {
      var s = { top: 'Это весь топ за ' + PERIOD_FOR[st.period] + '.', mine: 'Это все ваши публикации.' }[st.tab] ||
        'Дальше пусто.';
      tail.innerHTML = '<div class="fd-end">' + esc(s) + '</div>';
      return;
    }
    var e = {
      video: ['Роликов пока нет', 'Будьте первым: в игре нажмите F6, выберите «ролик», снимите до 30 секунд, ' +
        'подпишите и опубликуйте — ролик появится здесь.'],
      photo: ['Снимков пока нет', 'В игре нажмите F6, выберите «снимок», подпишите и опубликуйте.'],
      top: ['За ' + PERIOD_FOR[st.period] + ' в топе пусто', 'Лайков и комментариев за этот срок ещё не ' +
        'набралось. Загляните в «Ролики» и «Снимки» — и поддержите тех, кто снимает.'],
      mine: ['Вы ещё ничего не сняли', 'В игре нажмите F6 — камера снимет ролик или снимок, а тут появится всё опубликованное.']
    }[st.tab];
    tail.innerHTML = '<div class="empty"><h4>' + esc(e[0]) + '</h4><p>' + esc(e[1]) + '</p></div>';
  }

  function nearEnd() {
    if (st.end || st.busy || st.failed) return;
    var r = tail.getBoundingClientRect();
    if (r.top < w.innerHeight + NEAR) more();
  }

  /* -------------------------------------------------------- карточка */

  function add(it, open) {
    var key = it.id + '-' + (++st.n);
    var el = d.createElement('article');
    el.className = 'fd-card' + (open ? ' fd-open' : '');
    el.setAttribute('data-k', key);
    el.innerHTML = cardHtml(it);
    list.appendChild(el);
    var c = { key: key, it: it, el: el, v: el.querySelector('video'), bar: el.querySelector('.fd-prog i') };
    cards[key] = c;
    T.heads(el);
    watch(c);
    measure(c);
    return c;
  }

  function cardHtml(it) {
    var ar = it.w > 0 && it.h > 0 ? Math.max(.4, Math.min(2.4, it.w / it.h)) : (it.kind === 'video' ? .5625 : 1.7778);
    var ready = it.status !== 'processing' && it.status !== 'failed' && it.site;
    var media;
    if (!ready) {
      media = '<div class="fd-wait">' + (it.status === 'failed'
        ? 'Файл не обработался. Снимите заново — этот пост никто не видит.'
        : '<div class="loading" aria-hidden="true"><i></i><i></i><i></i></div>Ещё обрабатывается — появится через минуту.') +
        '</div>';
    } else if (it.kind === 'video') {
      media = '<video playsinline loop muted preload="none" disablepictureinpicture' +
        ' poster="' + esc(url(it.site.poster)) + '" aria-label="Ролик ' + esc(it.author) + '"></video>' +
        '<span class="fd-big">' + I.play + '</span>' +
        // кнопка звука — только у роликов со звуковой дорожкой (ролики до 02.10 сняты без неё)
        (it.audio === false ? '' : '<button type="button" class="fd-snd" data-a="snd" aria-label="' +
          (muted ? 'Включить звук' : 'Выключить звук') + '">' + (muted ? I.mute : I.snd) + '</button>') +
        '<div class="fd-prog"><i></i></div>';
    } else {
      media = '<img class="fd-pic" loading="lazy" decoding="async" src="' + esc(url(it.site.image)) +
        '" alt="Снимок ' + esc(it.author) + (it.caption ? ': ' + esc(it.caption.slice(0, 120)) : '') + '">';
    }
    var chips = '';
    var ts = topSay(it);
    if (ts) chips += '<span class="fd-chip top">' + esc(ts) + '</span>';
    if (it.again) chips += '<span class="fd-chip">повтор</span>';
    if (it.status !== 'live' && STATUS[it.status]) chips += '<span class="fd-chip warn">' + STATUS[it.status] + '</span>';

    var views = Number(it.views) || 0;
    // подпись — на самом кадре (как в TikTok): кадр не съезжает вбок, длинное — по «подробнее»
    var info = '<div class="fd-info"><div class="fd-who"><a href="' + who(it.author) + '">' + esc(it.author) + '</a>' +
      '<span>' + esc(A.ago(it.at)) + '</span>' +
      (views ? '<span>· ' + A.num(views) + ' ' + plural(views, ['просмотр', 'просмотра', 'просмотров']) + '</span>' : '') +
      '</div>' + (it.caption ? '<p class="fd-cap">' + rich(it.caption) + '</p>' +
        '<button type="button" class="fd-xpb" data-a="xp" aria-expanded="false">подробнее</button>' : '') +
      (it.note && it.status !== 'live' ? '<p class="fd-note">' + esc(it.note) + '</p>' : '') + '</div>';
    return '<div class="fd-media" style="--ar:' + ar.toFixed(4) + '">' + media +
      (chips ? '<div class="fd-chips">' + chips + '</div>' : '') + info + '</div>' +
      '<div class="fd-acts">' +
      '<a class="fd-face" href="' + who(it.author) + '" title="' + esc(it.author) + '">' + T.av(it.author) + '</a>' +
      '<button type="button" class="fd-act like' + (it.liked ? ' on' : '') + '" data-a="like" aria-pressed="' +
      (it.liked ? 'true' : 'false') + '" aria-label="Нравится"><span>' + (it.liked ? I.heartOn : I.heart) +
      '</span><b>' + A.num(it.likes) + '</b></button>' +
      '<button type="button" class="fd-act" data-a="com" aria-label="Комментарии"><span>' + I.com +
      '</span><b>' + A.num(it.comments) + '</b></button>' +
      '<button type="button" class="fd-act" data-a="dl" aria-label="Скачать со знаком автора"' +
      (ready ? '' : ' disabled') + '><span>' + I.dl + '</span><b>Скачать</b></button>' +
      '<button type="button" class="fd-act" data-a="more" aria-label="Ещё"><span>' + I.more + '</span><b>Ещё</b></button>' +
      '</div>';
  }

  /* «подробнее» — только там, где текст правда не влез в две строки */
  function measure(c) {
    var p = c.el.querySelector('.fd-cap');
    if (!p) return;
    if (c.el.classList.contains('fd-xp')) { fitOpen(c); return; }
    c.el.classList.toggle('fd-long', p.scrollHeight > p.clientHeight + 2);
  }

  // раскрытый текст — не выше половины кадра, дальше прокрутка внутри
  function fitOpen(c) {
    c.el.style.setProperty('--fd-h', c.el.querySelector('.fd-media').clientHeight + 'px');
  }

  function expand(c, on) {
    var b = c.el.querySelector('.fd-xpb'), p = c.el.querySelector('.fd-cap');
    if (!b || !p) return;
    if (on) fitOpen(c);
    c.el.classList.toggle('fd-xp', on);
    b.textContent = on ? 'свернуть' : 'подробнее';
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    p.scrollTop = 0;
    if (!on) measure(c);
  }

  /* Все показы одного поста (в бесконечной ленте он повторяется) — одним махом. */
  function each(id, fn) {
    Object.keys(cards).forEach(function (k) { if (cards[k].it.id === id) fn(cards[k]); });
  }

  function paintCounts(id) {
    each(id, function (c) {
      var it = c.it, b = c.el.querySelector('[data-a="like"]');
      b.classList.toggle('on', !!it.liked);
      b.setAttribute('aria-pressed', it.liked ? 'true' : 'false');
      b.querySelector('span').innerHTML = it.liked ? I.heartOn : I.heart;
      b.querySelector('b').textContent = A.num(it.likes);
      c.el.querySelector('[data-a="com"] b').textContent = A.num(it.comments);
    });
  }

  /* ---------------------------------------------------- показ роликов */

  var near = null, seen = null, tailObs = null;

  function observers() {
    if (!('IntersectionObserver' in w)) return;
    near = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var c = cards[e.target.getAttribute('data-k')];
        if (!c || !c.v) return;
        if (e.isIntersecting) {
          if (!c.v.getAttribute('src')) {
            c.v.preload = 'metadata';
            c.v.src = url(c.it.site.video);
          }
        } else if (c !== active && c.v.getAttribute('src')) {
          // далеко ушёл — отпускаем файл, обложка остаётся
          c.v.pause();
          c.v.removeAttribute('src');
          c.v.load();
        }
      });
    }, { rootMargin: '900px 0px' });
    seen = new IntersectionObserver(function (es) {
      es.forEach(function (e) { ratios[e.target.getAttribute('data-k')] = e.intersectionRatio; });
      pick();
    }, { threshold: [0, .25, .5, .6, .75, 1] });
    tailObs = new IntersectionObserver(function (es) {
      if (es[0] && es[0].isIntersecting) more();
    }, { rootMargin: NEAR + 'px 0px' });
    tailObs.observe(tail);
  }

  function watch(c) {
    if (near) near.observe(c.el);
    if (seen) seen.observe(c.el);
    if (!near && c.v) c.v.src = url(c.it.site.video);
  }

  function unwatch(c) {
    if (near) near.unobserve(c.el);
    if (seen) seen.unobserve(c.el);
    if (c.v) { c.v.pause(); c.v.removeAttribute('src'); c.v.load(); }
  }

  function pick() {
    var best = null, br = .6;
    Object.keys(ratios).forEach(function (k) {
      if (ratios[k] >= br && cards[k]) { br = ratios[k]; best = cards[k]; }
    });
    if (best === active) return;
    if (!best && active && (ratios[active.key] || 0) >= .35) return;
    stopActive();
    active = best;
    if (!active) return;
    if (active.v && !active.el.classList.contains('paused')) play(active);
    clearTimeout(active.viewT);
    var c = active;
    c.viewT = setTimeout(function () { if (active === c) view(c.it); }, 2000);
  }

  function stopActive() {
    if (!active) return;
    clearTimeout(active.viewT);
    if (active.v) active.v.pause();
    active = null;
  }

  function play(c) {
    var v = c.v;
    if (!v) return;
    if (!v.getAttribute('src')) { v.preload = 'auto'; v.src = url(c.it.site.video); }
    v.muted = muted;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        // браузер не дал играть со звуком без нажатия — играем без звука
        if (!v.muted) {
          muted = true;
          paintSound();
          v.muted = true;
          v.play().catch(function () { c.el.classList.add('paused'); });
        } else {
          c.el.classList.add('paused');
        }
      });
    }
  }

  function togglePlay(c) {
    if (!c.v) return;
    if (c.v.paused) {
      c.el.classList.remove('paused');
      if (active !== c) { stopActive(); active = c; }
      play(c);
    } else {
      c.v.pause();
      c.el.classList.add('paused');
    }
  }

  function paintSound() {
    Array.prototype.forEach.call(list.querySelectorAll('.fd-snd'), function (b) {
      b.innerHTML = muted ? I.mute : I.snd;
      b.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
    });
  }

  function tick() {
    if (active && active.v && active.bar && active.v.duration) {
      active.bar.style.width = Math.min(100, active.v.currentTime / active.v.duration * 100) + '%';
    }
    w.requestAnimationFrame(tick);
  }

  function view(it) {
    if (!st.me.in || viewed[it.id] || it.status !== 'live') return;
    viewed[it.id] = 1;
    req('/view', { body: { id: it.id } }).catch(function () {});
  }

  /* --------------------------------------------------------- действия */

  var clickT = null;

  // #тег в подписи или комментарии; с Ctrl/Shift/колёсиком — пусть браузер откроет новую вкладку
  function tagClick(e, kind) {
    var a = e.target.closest('[data-tag]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return !!a;
    e.preventDefault();
    openTag(a.getAttribute('data-tag'), kind);
    return true;
  }

  function onClick(e) {
    var t = e.target;
    var tc = t.closest('.fd-card'), tcc = tc && cards[tc.getAttribute('data-k')];
    if (tagClick(e, tcc ? tcc.it.kind : st.tkind)) return;
    var b = t.closest('[data-tab]');
    if (b) {
      var was = !!st.tag;
      if (was) closeTag();
      if (was || b.getAttribute('data-tab') !== st.tab || st.failed) reset(b.getAttribute('data-tab'));
      return;
    }
    b = t.closest('[data-tkind]');
    if (b) {
      if (b.getAttribute('data-tkind') !== st.tkind || st.failed) {
        st.tkind = b.getAttribute('data-tkind');
        st.tagAuto = false;
        reset();
      }
      return;
    }
    if (t.closest('[data-untag]')) { closeTag(); reset(); toFeed(); return; }
    b = t.closest('[data-per]');
    if (b) { st.period = b.getAttribute('data-per'); reset(); return; }
    b = t.closest('[data-kind]');
    if (b) { st.kind = b.getAttribute('data-kind'); reset(); return; }
    if (t.closest('[data-login]')) { login('Войдите тем же ником и паролем, что в лаунчере.'); return; }
    if (t.closest('[data-retry]')) { st.failed = false; more(); return; }
    if (t.closest('[data-again]')) { reset(); w.scrollTo(0, 0); return; }

    var el = t.closest('.fd-card');
    var c = el && cards[el.getAttribute('data-k')];
    if (!c) return;
    b = t.closest('[data-a]');
    if (b) {
      var a = b.getAttribute('data-a');
      if (a === 'like') like(c, false);
      else if (a === 'com') openComs(c);
      else if (a === 'dl') download(c, false);
      else if (a === 'more') menu(c);
      else if (a === 'xp') expand(c, !el.classList.contains('fd-xp'));
      else if (a === 'snd') {
        muted = !muted;
        paintSound();
        if (active && active.v) active.v.muted = muted;
        if (active !== c && c.v) togglePlay(c);
      }
      return;
    }
    var m = t.closest('.fd-media');
    if (!m || t.closest('a')) return;
    // нажатие по длинному описанию раскрывает его, а не ставит ролик на паузу
    if (t.closest('.fd-cap') && el.classList.contains('fd-long')) {
      if (!el.classList.contains('fd-xp')) expand(c, true);
      return;
    }
    // двойной щелчок — лайк с сердцем, одиночный — пауза
    if (clickT && clickT.c === c) {
      clearTimeout(clickT.t);
      clickT = null;
      var r = m.getBoundingClientRect();
      burst(m, e.clientX - r.left, e.clientY - r.top);
      like(c, true);
      return;
    }
    if (clickT) clearTimeout(clickT.t);
    clickT = { c: c, t: setTimeout(function () { clickT = null; togglePlay(c); }, 260) };
  }

  function burst(m, x, y) {
    var s = d.createElement('span');
    s.className = 'fd-burst';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.innerHTML = I.heartOn;
    m.appendChild(s);
    setTimeout(function () { s.remove(); }, 800);
  }

  function needIn(why) {
    if (st.me.in && !st.me.banned) return true;
    if (st.me.banned) { toast('Аккаунт заблокирован — в ленте можно только смотреть.'); return false; }
    login(why);
    return false;
  }

  function like(c, onlyOn) {
    var it = c.it;
    if (it.status !== 'live') { toast('Пост сейчас не в ленте — лайки ему не ставятся.'); return; }
    if (!needIn('Лайки ставят игроки AEGIS — войдите тем же ником и паролем, что в лаунчере.')) return;
    if (onlyOn && it.liked) return;
    if (it.likeBusy) return;
    var on = !it.liked, was = { liked: it.liked, likes: it.likes };
    each(it.id, function (x) { x.it.likeBusy = true; x.it.liked = on; x.it.likes = Math.max(0, x.it.likes + (on ? 1 : -1)); });
    paintCounts(it.id);
    req('/like', { body: { id: it.id, on: on } }).then(function (r) {
      each(it.id, function (x) { x.it.likes = Number(r.likes) || 0; x.it.liked = !!r.liked; });
    }, function (e) {
      each(it.id, function (x) { x.it.liked = was.liked; x.it.likes = was.likes; });
      toast(e.text);
      if (e.status === 401) relogin();
    }).then(function () {
      each(it.id, function (x) { x.it.likeBusy = false; });
      paintCounts(it.id);
    });
  }

  function download(c, orig) {
    var it = c.it;
    if (!needIn('Скачивать могут игроки AEGIS — войдите тем же ником и паролем, что в лаунчере.')) return;
    if (c.dlBusy) return;
    var base = A.base();
    if (!base) { toast('Лента сейчас недоступна.'); return; }
    var btn = c.el.querySelector('[data-a="dl"]');
    c.dlBusy = true;
    btn.classList.add('busy');
    toast(orig ? 'Готовим оригинал…' : 'Готовим файл со знаком автора…');
    fetch(base + '/feed/' + (orig ? 'orig/' : 'dl/') + it.id, {
      cache: 'no-store', headers: { Authorization: 'Bearer ' + A.token() }
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (j) {
          throw fail(j && j.code || 'error', j && j.text || 'Не скачалось — попробуйте ещё раз.', r.status);
        });
      }
      return r.blob();
    }, function () {
      throw fail('offline', 'Нет связи с лентой — не скачалось.');
    }).then(function (blob) {
      var u = URL.createObjectURL(blob);
      var a = d.createElement('a');
      a.href = u;
      a.download = 'AEGIS-' + it.author + '-' + it.id + (orig ? '-original' : '') + '.' + (it.kind === 'video' ? 'mp4' : 'jpg');
      d.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      toast(orig ? 'Оригинал без знака скачан.' : 'Скачано — со знаком автора.');
    }, function (e) {
      toast(e.text);
      if (e.status === 401) relogin();
    }).then(function () {
      c.dlBusy = false;
      btn.classList.remove('busy');
    });
  }

  function link(it) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'feed.html?p=' + it.id;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Ссылка скопирована.'); },
        function () { w.prompt('Скопируйте ссылку:', text); });
    } else {
      w.prompt('Скопируйте ссылку:', text);
    }
  }

  function menu(c) {
    var it = c.it, m = st.me, rows = [];
    rows.push(['link', I.link, 'Скопировать ссылку']);
    if (m.owner && it.status !== 'processing' && it.status !== 'failed') rows.push(['orig', I.orig, 'Скачать оригинал без знака', 'только вам']);
    if (!it.mine && it.status === 'live') rows.push(['rep', I.flag, 'Пожаловаться']);
    if (m.staff && it.status === 'live') rows.push(['mhide', I.hide, 'Скрыть до проверки', 'команда']);
    if (m.staff && (it.status === 'hidden' || it.status === 'archived')) rows.push(['mback', I.back, 'Вернуть в ленту', 'команда']);
    if (it.mine && it.status !== 'archived' && it.status !== 'processing') rows.push(['rm', I.trash, 'Убрать из ленты', '', 'bad']);
    modal('<h3>Публикация</h3><div class="fd-menu">' + rows.map(function (r) {
      return '<button type="button" data-m="' + r[0] + '"' + (r[4] ? ' class="' + r[4] + '"' : '') + '>' + r[1] +
        esc(r[2]) + (r[3] ? '<small>' + esc(r[3]) + '</small>' : '') + '</button>';
    }).join('') + '</div>', function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-m]');
        if (!b) return;
        var a = b.getAttribute('data-m');
        if (a === 'link') { closeModal(); copy(link(it)); }
        else if (a === 'orig') { closeModal(); download(c, true); }
        else if (a === 'rep') report('post', it.id);
        else if (a === 'mhide') modPost(it, 'hidden');
        else if (a === 'mback') modPost(it, 'live');
        else if (a === 'rm') confirmRemove(it);
      });
    });
  }

  function report(what, id) {
    if (!needIn('Жаловаться могут игроки AEGIS — войдите тем же ником и паролем, что в лаунчере.')) return;
    modal('<h3>Пожаловаться</h3><p>' + (what === 'post' ? 'Что не так с публикацией?' : 'Что не так с комментарием?') +
      ' Команда посмотрит.</p><div class="fd-menu">' + REASONS.map(function (r, i) {
        return '<button type="button" data-r="' + i + '">' + esc(r) + '</button>';
      }).join('') + '</div>', function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-r]');
        if (!b || b.disabled) return;
        b.disabled = true;
        req('/report', { body: { what: what, id: what === 'post' ? id : Number(id), reason: REASONS[+b.getAttribute('data-r')] } })
          .then(function (r) { closeModal(); toast(r.text || 'Жалоба у команды. Спасибо.'); },
            function (er) { b.disabled = false; toast(er.text); });
      });
    });
  }

  function modPost(it, status) {
    req('/mod/post', { body: { id: it.id, status: status, note: status === 'hidden' ? 'скрыт командой до проверки' : '' } })
      .then(function () {
        closeModal();
        each(it.id, function (x) {
          x.it.status = status;
          x.it.note = status === 'hidden' ? 'скрыт командой до проверки' : '';
        });
        if (status === 'hidden' && st.tab !== 'mine') drop(it.id);
        else each(it.id, refresh);
        toast(status === 'hidden' ? 'Скрыто до проверки.' : 'Возвращено в ленту.');
      }, function (e) { toast(e.text); });
  }

  function confirmRemove(it) {
    modal('<h3>Убрать из ленты?</h3><p>Пост пропадёт из ленты и топа. Совсем он не стирается: если ' +
      'передумаете, команда вернёт его по обращению.</p><div class="fd-row">' +
      '<button type="button" class="btn btn-dark btn-sm" data-no>Отмена</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-yes>Убрать</button></div>', function (box) {
      box.querySelector('[data-no]').addEventListener('click', closeModal);
      box.querySelector('[data-yes]').addEventListener('click', function (e) {
        e.currentTarget.disabled = true;
        req('/remove', { body: { id: it.id } }).then(function () {
          closeModal();
          if (st.tab === 'mine') {
            each(it.id, function (x) {
              x.it.status = 'archived';
              x.it.note = 'убран автором';
              refresh(x);
            });
          } else {
            drop(it.id);
          }
          toast('Убрано из ленты.');
        }, function (er) { e.target.disabled = false; toast(er.text); });
      });
    });
  }

  function refresh(c) {
    unwatch(c);
    if (active === c) active = null;
    c.el.innerHTML = cardHtml(c.it);
    c.v = c.el.querySelector('video');
    c.bar = c.el.querySelector('.fd-prog i');
    T.heads(c.el);
    watch(c);
  }

  function drop(id) {
    each(id, function (c) {
      unwatch(c);
      if (active === c) active = null;
      delete ratios[c.key];
      delete cards[c.key];
      c.el.remove();
    });
    if (!Object.keys(cards).length) paintTail();
    else setTimeout(nearEnd, 60);
  }

  /* ----------------------------------------------------- комментарии */

  var drawer = null, shade = null, com = null;

  function shadeOn() {
    if (!shade) {
      shade = d.createElement('div');
      shade.className = 'fd-shade';
      shade.addEventListener('click', function () { if (box) closeModal(); else closeComs(); });
      d.body.appendChild(shade);
      void shade.offsetWidth;
    }
    shade.classList.add('on');
    d.body.classList.add('fd-lock');
  }

  function shadeOff() {
    if (box || (drawer && drawer.classList.contains('on'))) return;
    if (shade) shade.classList.remove('on');
    d.body.classList.remove('fd-lock');
    setTimeout(function () {
      if (shade && !shade.classList.contains('on')) { shade.remove(); shade = null; }
    }, 250);
  }

  function openComs(c) {
    if (c.it.status === 'processing' || c.it.status === 'failed') return;
    com = { c: c, it: c.it, items: [], canHide: false, back: d.activeElement };
    if (!drawer) {
      drawer = d.createElement('aside');
      drawer.className = 'fd-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-labelledby', 'fdComT');
      d.body.appendChild(drawer);
      drawer.addEventListener('click', onComClick);
    }
    drawer.innerHTML = '<div class="fd-dh"><h3 id="fdComT">Комментарии<small></small></h3>' +
      '<button type="button" class="fd-x" data-close aria-label="Закрыть">' + I.x + '</button></div>' +
      '<div class="fd-coms" id="fdComs"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>' +
      '<div class="fd-form" id="fdForm"></div>';
    paintForm();
    shadeOn();
    void drawer.offsetWidth;
    drawer.classList.add('on');
    var f = drawer.querySelector('textarea');
    (f && w.innerWidth > 900 ? f : drawer.querySelector('[data-close]')).focus();
    loadComs();
  }

  function closeComs() {
    if (!drawer || !drawer.classList.contains('on')) return;
    drawer.classList.remove('on');
    var back = com && com.back;
    com = null;
    shadeOff();
    if (back && back.focus) back.focus();
  }

  function loadComs() {
    var mine = com;
    if (!mine) return;
    req('/comments?id=' + mine.it.id).then(function (r) {
      if (com !== mine) return;
      mine.items = (r.items || []).slice().reverse();
      mine.canHide = !!r.canHide;
      var live = mine.items.filter(function (x) { return x.status === 'live'; }).length;
      each(mine.it.id, function (x) { x.it.comments = live; });
      paintCounts(mine.it.id);
      paintComs();
    }, function (e) {
      if (com !== mine) return;
      d.getElementById('fdComs').innerHTML = '<div class="empty"><p>' + esc(e.text) + '</p></div>';
    });
  }

  function paintComs() {
    var box = d.getElementById('fdComs');
    var live = com.items.filter(function (x) { return x.status === 'live'; }).length;
    drawer.querySelector('#fdComT small').textContent = live ? String(live) : '';
    if (!com.items.length) {
      box.innerHTML = '<div class="empty"><h4>Пока тихо</h4><p>Напишите первым — автору будет приятно.</p></div>';
      return;
    }
    var m = st.me;
    var canRe = m.in && !m.banned && com.it.status === 'live';
    box.innerHTML = threads(com.items).map(function (x) {
      var off = x.status !== 'live';
      var acts = '';
      if (canRe && x.status === 'live') {
        acts += '<button type="button" data-c="re" data-id="' + x.id + '" data-who="' + esc(x.who) + '">Ответить</button>';
      }
      if (m.in && !x.mine && x.status === 'live') acts += '<button type="button" data-c="rep" data-id="' + x.id + '">Пожаловаться</button>';
      if (com.canHide && x.status !== 'archived') {
        acts += '<button type="button" data-c="hide" data-id="' + x.id + '" data-on="' + (x.status === 'live' ? 1 : 0) + '">' +
          (x.status === 'live' ? 'Скрыть' : 'Вернуть') + '</button>';
      }
      if (m.staff && x.status !== 'archived') acts += '<button type="button" data-c="arch" data-id="' + x.id + '">Убрать (команда)</button>';
      if (m.staff && x.status === 'archived') acts += '<button type="button" data-c="unarch" data-id="' + x.id + '">Вернуть (команда)</button>';
      return '<div class="fd-com' + (off ? ' off' : '') + (x.sub ? ' sub' : '') + '">' + T.av(x.who) + '<div class="fd-com-b">' +
        '<div class="fd-com-h"><a href="' + who(x.who) + '">' + esc(x.who) + '</a>' +
        (x.reply && x.replyTo ? '<span class="fd-re">в ответ <b>' + esc(x.replyTo) + '</b></span>' : '') +
        '<span>' + esc(A.ago(x.at)) + '</span>' +
        (x.status === 'hidden' ? '<span>· скрыт</span>' : '') + (x.status === 'archived' ? '<span>· убран командой</span>' : '') +
        '</div><div class="fd-com-t">' + rich(x.text) + '</div>' + (acts ? '<div class="fd-com-a">' + acts + '</div>' : '') +
        '</div></div>';
    }).join('');
    T.heads(box);
  }

  // Ветки: сверху новые комментарии, ответы — под своим, по порядку. Если начало ветки скрыто,
  // ответ стоит сам по себе (с «в ответ ник»).
  function threads(items) {
    var have = {}, kids = {}, out = [];
    items.forEach(function (x) { have[x.id] = 1; });
    items.forEach(function (x) {
      if (x.root && have[x.root]) (kids[x.root] = kids[x.root] || []).push(x);
    });
    items.forEach(function (x) {
      if (x.root && have[x.root]) return;
      x.sub = false;
      out.push(x);
      (kids[x.id] || []).slice().reverse().forEach(function (k) { k.sub = true; out.push(k); });
    });
    return out;
  }

  function paintReply() {
    var r = drawer && drawer.querySelector('.fd-re-to');
    if (!r || !com) return;
    r.hidden = !com.reply;
    if (com.reply) r.querySelector('b').textContent = com.reply.who;
    var ta = drawer.querySelector('#fdForm textarea');
    if (ta) {
      ta.placeholder = com.reply ? 'Ответ ' + com.reply.who + '…' : 'Комментарий… #тег @ник';
      ta.setAttribute('aria-label', com.reply ? 'Ответ ' + com.reply.who : 'Комментарий');
    }
  }

  function paintForm() {
    var f = d.getElementById('fdForm'), m = st.me;
    if (!m.in) {
      f.innerHTML = '<p>Комментировать могут игроки AEGIS.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-login>Войти</button>';
      return;
    }
    if (m.banned) { f.innerHTML = '<p>Аккаунт заблокирован — комментировать нельзя.</p>'; return; }
    if (com.it.status !== 'live') { f.innerHTML = '<p>Пост сейчас не в ленте — комментарии закрыты.</p>'; return; }
    var max = m.limits && m.limits.comment || 300;
    f.innerHTML = '<div class="fd-re-to" hidden>Ответ <b></b><button type="button" data-c="re-x" ' +
      'aria-label="Не отвечать, обычный комментарий">' + I.x + '</button></div>' +
      '<form novalidate><textarea rows="1" maxlength="' + max + '" placeholder="Комментарий… #тег @ник" ' +
      'aria-label="Комментарий"></textarea><button class="btn btn-primary btn-sm" type="submit">Отправить</button></form>' +
      '<div class="fd-form-n"><span class="say" role="status"></span><span class="cnt">0/' + max + '</span></div>';
    var ta = f.querySelector('textarea'), cnt = f.querySelector('.cnt'), say = f.querySelector('.say');
    function grow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px';
      cnt.textContent = ta.value.length + '/' + max;
    }
    ta.addEventListener('input', function () { grow(); say.textContent = ''; say.classList.remove('bad'); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    f.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); send(); });
    function send() {
      var text = ta.value.replace(/\s+/g, ' ').trim(), btn = f.querySelector('button[type=submit]');
      if (!text || btn.disabled) return;
      var mine = com;
      btn.disabled = true;
      var body = { id: mine.it.id, text: text };
      if (mine.reply) body.reply = mine.reply.id;
      req('/comment', { body: body }).then(function () {
        ta.value = '';
        grow();
        if (com === mine) {
          var wasReply = !!mine.reply;
          mine.reply = null;
          paintReply();
          loadComs();
          if (!wasReply) d.getElementById('fdComs').scrollTop = 0;
        }
      }, function (e) {
        say.textContent = e.text;
        say.classList.add('bad');
        if (e.status === 401) relogin();
      }).then(function () { btn.disabled = false; });
    }
  }

  function onComClick(e) {
    if (e.target.closest('[data-close]')) { closeComs(); return; }
    if (tagClick(e, com ? com.it.kind : st.tkind)) return;
    if (e.target.closest('[data-login]')) { login('Комментировать могут игроки AEGIS — войдите тем же ником и паролем, что в лаунчере.'); return; }
    var b = e.target.closest('[data-c]');
    if (!b || !com || b.disabled) return;
    var a = b.getAttribute('data-c'), id = Number(b.getAttribute('data-id'));
    if (a === 'rep') { report('comment', id); return; }
    if (a === 're' || a === 're-x') {
      com.reply = a === 're' ? { id: id, who: b.getAttribute('data-who') } : null;
      paintReply();
      var ta = drawer.querySelector('#fdForm textarea');
      if (ta) ta.focus();
      return;
    }
    b.disabled = true;
    var p = a === 'hide'
      ? req('/comment/hide', { body: { cid: id, on: b.getAttribute('data-on') === '1' } })
      : req('/mod/comment', { body: { cid: id, status: a === 'arch' ? 'archived' : 'live' } });
    p.then(loadComs, function (er) { b.disabled = false; toast(er.text); });
  }

  /* ---------------------------------------------------- окна и вход */

  var box = null, boxBack = null;

  function modal(html, init) {
    if (box) closeModal(true);
    boxBack = d.activeElement;
    shadeOn();
    box = d.createElement('div');
    box.className = 'fd-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = html + '';
    d.body.appendChild(box);
    if (init) init(box);
    var f = box.querySelector('input, button, textarea');
    if (f && w.innerWidth > 900) f.focus();
  }

  function closeModal(keep) {
    if (!box) return;
    box.remove();
    box = null;
    if (keep !== true) {
      shadeOff();
      if (boxBack && boxBack.focus && d.body.contains(boxBack)) boxBack.focus();
    }
  }

  function login(why) {
    modal('<div id="fdLogin"></div>', function (b) {
      T.login(b.querySelector('#fdLogin'), {
        title: 'Вход',
        lead: esc(why) + ' Нет аккаунта? Он появляется при первом входе в игру через лаунчер.',
        done: function () {
          closeModal();
          loadMe().then(function () {
            toast('Вы вошли как ' + (st.me.nick || '') + '.');
            if (com && drawer) { paintForm(); loadComs(); }
            reset();
          });
        }
      });
    });
  }

  /* Ключ сайта служба ленты не приняла (сменили пароль, вышли в другом
     окне). Весь сайт из-за этого не выключаем — просто спрашиваем вход. */
  function relogin() {
    st.me = { in: false };
    paintMe();
    login('Вход устарел — войдите ещё раз.');
  }

  var toastEl = null, toastT = 0;
  function toast(text) {
    if (!toastEl) {
      toastEl = d.createElement('div');
      toastEl.className = 'fd-toast';
      toastEl.setAttribute('role', 'status');
      d.body.appendChild(toastEl);
      void toastEl.offsetWidth;
    }
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }

  d.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (box) closeModal();
    else if (drawer && drawer.classList.contains('on')) closeComs();
  });

  // ширина кадра зависит от окна, шрифт догружается позже — «подробнее» пересчитываем
  var measureT = null;
  function measureAll() {
    clearTimeout(measureT);
    measureT = setTimeout(function () { Object.keys(cards).forEach(function (k) { measure(cards[k]); }); }, 120);
  }
  w.addEventListener('resize', measureAll);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(measureAll);

  d.addEventListener('visibilitychange', function () {
    if (!active || !active.v) return;
    if (d.hidden) active.v.pause();
    else if (!active.el.classList.contains('paused')) play(active);
  });

  /* ---------------------------------------------------------- начало */

  function loadMe() {
    if (!A.token()) { st.me = { in: false }; paintMe(); return Promise.resolve(); }
    return req('/me').then(function (r) { st.me = r.in ? r : { in: false }; paintMe(); },
      function () { st.me = { in: false }; paintMe(); });
  }

  function start() {
    frame();
    observers();
    paintTabs();
    paintMe();
    w.requestAnimationFrame(tick);
    var qs = new URLSearchParams(location.search);
    var pid = qs.get('p') || '', tg = qs.get('t') || '';
    loadMe().then(function () {
      if (TAG.test(tg)) { openTag(tg, 'video', false); return; }
      if (!ID.test(pid)) { reset(); return; }
      req('/post/' + pid).then(function (r) {
        var it = r.item;
        st.tab = it.kind === 'photo' ? 'photo' : 'video';
        st.first = it.id;
        reset();
        var c = add(it, true);
        list.insertBefore(c.el, list.firstChild);
      }, function (e) {
        if (e.code !== 'closed' && e.code !== 'offline') toast('Этой публикации нет или её убрали.');
        reset();
      });
    });
  }

  start();
})(window, document);
