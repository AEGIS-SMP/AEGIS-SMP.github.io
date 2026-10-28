/* AEGIS — один слой связи сайта со службой сервера.
   Раньше каждая страница сама искала адрес и сама ловила ошибки; теперь это
   лежит здесь, чтобы правка была в одном месте, а поведение — одинаковым.

   Адрес службы задается ТОЛЬКО в js/config.js (window.AEGIS_REG_BASE).
   Пока он пуст, страницы честно пишут, что раздел включится вместе с
   сервером, и не притворяются рабочими.

   Как отвечает служба: HTTP 200 и тело {ok:true, ...} либо
   {ok:false, code:"...", text:"..."} — «нет» это тоже нормальный ответ,
   а не поломка. Настоящая поломка (сеть, прокси, HTML вместо JSON) прилетает
   сюда исключением, и мы показываем человеку не «TypeError», а фразу.

   Подключается ПОСЛЕ js/config.js и ДО скрипта страницы. */
(function (w) {
  'use strict';

  var KEY = 'aegis.session';

  function isLocal(h) {
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' ||
      h === '::1' || h === '';
  }

  /* Любой адрес из js/config.js. Больше нигде адреса не записаны — переезд
     на арендный хостинг правит один тот файл. */
  function cfg(name) {
    var c = w.AEGIS || {};
    return String(c[name] == null ? '' : c[name]).trim();
  }

  /* Готовый к показу адрес: пустой и недописанный не отдаем, чтобы кнопка
     не вела в никуда. Признак недописанного — кириллица внутри ссылки. */
  function link(name) {
    var v = cfg(name);
    if (!/^https:\/\/[\w.-]+/i.test(v)) return '';
    if (/[А-Яа-яЁё]/.test(v)) return '';
    return v;
  }

  /* Адрес службы. ?svc= работает только на своей машине: иначе подсунутая
     ссылка увела бы имя и пароль игрока на чужой адрес. */
  function base() {
    var local = isLocal(location.hostname);
    var raw = '';
    if (local) raw = new URLSearchParams(location.search).get('svc') || '';
    if (!raw) raw = cfg('api');
    if (!raw && w.AEGIS_REG_BASE) raw = String(w.AEGIS_REG_BASE);
    raw = raw.trim().replace(/\/+$/, '');
    if (!raw && local) raw = 'http://127.0.0.1:25580';
    if (!/^https?:\/\/[^\s]+$/i.test(raw)) return null;
    /* Сайт по https до http-службы не дотянется — браузер режет такой запрос
       молча. Лучше сразу сказать правду, чем ждать пустоты. */
    if (location.protocol === 'https:' && /^http:\/\//i.test(raw)) return null;
    return raw;
  }

  /* ------------------------------------------------------------- сессия */

  /* Вход живет в localStorage до срока, который выдала служба (until, мс).
     Раньше лежал в sessionStorage — и каждая новая вкладка (ссылка из ЛС бота
     на обращение, «открыть в новой вкладке») снова просила пароль. Овнер
     25.09.2026: «чтобы у админов постоянно не слетала верификация». Старую
     запись из sessionStorage один раз переносим, чтобы уже вошедших не выкинуло. */
  function session() {
    var s = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        raw = sessionStorage.getItem(KEY);
        if (raw) { localStorage.setItem(KEY, raw); sessionStorage.removeItem(KEY); }
      }
      s = raw ? JSON.parse(raw) : null;
    } catch (e) {
      try { var r2 = sessionStorage.getItem(KEY); s = r2 ? JSON.parse(r2) : null; } catch (e2) { s = null; }
    }
    if (s && s.until && Number(s.until) < Date.now()) { setSession(null); return null; }
    return s;
  }

  function setSession(obj) {
    try {
      if (obj) localStorage.setItem(KEY, JSON.stringify(obj));
      else { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); }
    } catch (e) {
      /* localStorage закрыт (строгий приватный режим) — держим вход хотя бы во вкладке */
      try {
        if (obj) sessionStorage.setItem(KEY, JSON.stringify(obj));
        else sessionStorage.removeItem(KEY);
      } catch (e2) { /* живем без памяти */ }
    }
  }

  function token() {
    var s = session();
    return s && s.token ? s.token : '';
  }

  /* --------------------------------------------------------------- запрос */

  /* Всегда с крышкой по времени: зависшая служба не должна держать кнопку
     «занята» вечно. Ответ разбираем сами — страница ошибки от прокси приедет
     как HTML, и JSON.parse на ней падает без внятного текста. */
  function call(path, opts) {
    opts = opts || {};
    var root = base();
    if (!root) return Promise.reject(offline());

    var init = { method: opts.method || 'GET', cache: 'no-store', headers: {} };
    if (opts.body !== undefined) {
      init.method = opts.method || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false && token()) {
      init.headers['Authorization'] = 'Bearer ' + token();
    }

    var timer = null;
    if (typeof AbortController === 'function') {
      var ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, opts.timeout || 12000);
    }
    function done() { if (timer) clearTimeout(timer); }

    return fetch(root + path, init).then(function (r) {
      done();
      if (r.status === 401 || r.status === 403) {
        setSession(null);
        throw err('auth', 'Вход устарел — войдите заново.');
      }
      if (!r.ok) throw err('http', 'Служба ответила ошибкой ' + r.status + '.');
      return r.text();
    }, function (e) {
      done();
      if (e && e.aegis) throw e;
      if (e && e.name === 'AbortError') {
        throw err('timeout', 'Служба не ответила вовремя. Попробуйте еще раз.');
      }
      /* Текст называет причину и говорит, что делать. «Не получилось связаться
         со службой сервера» верно по сути, но человеку под кнопкой «Войти»
         читается как поломка сайта, и дальше он идет писать обращение. А беда
         почти всегда одна: сервер выключен или перезапускается. */
      throw err('net', 'Сервер не отвечает — похоже, он сейчас выключен. ' +
        'Попробуйте позже.');
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e2) {
        throw err('bad', 'Служба ответила не тем, чего мы ждали.');
      }
      if (data && data.ok === false) {
        throw err(data.code || 'no', data.text || 'Служба отказала.');
      }
      return data;
    });
  }

  function err(code, text) {
    var e = new Error(text);
    e.aegis = true;
    e.code = code;
    e.text = text;
    return e;
  }

  function offline() {
    return err('offline',
      'Сервер на перерыве между вайпами: этот раздел заработает вместе с ним. ' +
      'Вопросы — в тикет в Discord.');
  }

  /* Человеческий текст любой беды: страницы печатают его как есть. */
  function textOf(e) {
    if (e && e.aegis) return e.text;
    return 'Что-то пошло не так. Попробуйте еще раз позже.';
  }

  /* ------------------------------------------------------- мелкие помощники */

  /* Локальный файл (data/*.json) — берем тем же способом, но без службы. */
  function local(path, ms) {
    var timer = null, init = { cache: 'no-store' };
    if (typeof AbortController === 'function') {
      var ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, ms || 15000);
    }
    return fetch(path, init).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw err('file', 'Не удалось загрузить данные страницы.');
      return r.json();
    }, function () {
      if (timer) clearTimeout(timer);
      throw err('file', 'Не удалось загрузить данные страницы.');
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Согласование слова с числом. Такой же помощник уже есть в cabinet.js,
     lands.js и admin.js — там он нужен своим спискам; здесь он нужен ago(),
     который живет ниже всех и не может тянуть их к себе. */
  function plural(n, f) {
    var a = Math.abs(Math.floor(n)) % 100, b = a % 10;
    if (a > 10 && a < 20) return f[2];
    if (b > 1 && b < 5) return f[1];
    if (b === 1) return f[0];
    return f[2];
  }

  /* «3 минуты назад», «вчера» — время показываем словами, так понятнее.

     Раньше тут стояли сокращения и последней строкой выходило «6 дн назад».
     «мин» и «ч» — законные сокращения, а «дн» ни в одном словаре нет: рядом
     с остальным сайтом, который везде пишет «6 дней» и «2 недели», это
     читалось как недоделанный перевод. Пишем словом целиком. */
  function ago(ts) {
    if (!ts) return '';
    var d = (Date.now() - Number(ts)) / 1000;
    if (d < 0) d = 0;
    if (d < 60) return 'только что';
    var n;
    if (d < 3600) {
      n = Math.floor(d / 60);
      return n + ' ' + plural(n, ['минуту', 'минуты', 'минут']) + ' назад';
    }
    if (d < 86400) {
      n = Math.floor(d / 3600);
      return n + ' ' + plural(n, ['час', 'часа', 'часов']) + ' назад';
    }
    if (d < 172800) return 'вчера';
    n = Math.floor(d / 86400);
    return n + ' ' + plural(n, ['день', 'дня', 'дней']) + ' назад';
  }

  /* 1200 → «1,2 тыс» */
  function num(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) return String(Math.round(n / 100) / 10).replace('.', ',') + ' тыс';
    return String(Math.round(n / 100000) / 10).replace('.', ',') + ' млн';
  }

  w.AegisApi = {
    base: base, cfg: cfg, link: link, call: call, local: local,
    session: session, setSession: setSession, token: token,
    offline: offline, err: err, textOf: textOf,
    esc: esc, ago: ago, num: num
  };
})(window);
