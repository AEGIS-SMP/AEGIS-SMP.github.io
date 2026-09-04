/* AEGIS — один слой связи сайта со службой сервера.
   Раньше каждая страница сама искала адрес и сама ловила ошибки; теперь это
   лежит здесь, чтобы правка была в одном месте, а поведение — одинаковым.

   Адрес службы задаётся ТОЛЬКО в js/config.js (window.AEGIS_REG_BASE).
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

  /* Готовый к показу адрес: пустой и недописанный не отдаём, чтобы кнопка
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

  function session() {
    try {
      var raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(obj) {
    try {
      if (obj) sessionStorage.setItem(KEY, JSON.stringify(obj));
      else sessionStorage.removeItem(KEY);
    } catch (e) { /* приватный режим — просто живём без памяти */ }
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
        throw err('timeout', 'Служба не ответила вовремя. Попробуйте ещё раз.');
      }
      throw err('net', 'Не получилось связаться со службой сервера.');
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
      'Этот раздел включится вместе с сервером — сезон ещё готовится.');
  }

  /* Человеческий текст любой беды: страницы печатают его как есть. */
  function textOf(e) {
    if (e && e.aegis) return e.text;
    return 'Что-то пошло не так. Попробуйте ещё раз позже.';
  }

  /* ------------------------------------------------------- мелкие помощники */

  /* Локальный файл (data/*.json) — берём тем же способом, но без службы. */
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

  /* «3 минуты назад», «вчера» — время показываем словами, так понятнее. */
  function ago(ts) {
    if (!ts) return '';
    var d = (Date.now() - Number(ts)) / 1000;
    if (d < 0) d = 0;
    if (d < 60) return 'только что';
    if (d < 3600) return Math.floor(d / 60) + ' мин назад';
    if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
    if (d < 172800) return 'вчера';
    return Math.floor(d / 86400) + ' дн назад';
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
