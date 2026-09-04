/* Регистрация AEGIS: страница только собирает имя-пароль и уводит к службе
   проверки. Всё важное считает сервер (класс AegisReg в моде): и совпадение
   личности, и «одно имя на человека». Здесь нет ни одного секрета — обмен
   токенами идёт на сервере, браузер их не видит. */
(function () {
  'use strict';

  var form = document.getElementById('regForm');
  if (!form) return;

  var elNick = document.getElementById('rNick');
  var elPass = document.getElementById('rPass');
  var elPass2 = document.getElementById('rPass2');
  var elPick = document.getElementById('rPick');
  var elOk1 = document.getElementById('rOk1');
  var elOk2 = document.getElementById('rOk2');
  var elGo = document.getElementById('rGo');
  var elSay = document.getElementById('rSay');

  var prov = '';
  var minPass = 6;
  var busy = false;
  var base = null;

  /* Где живёт служба регистрации — спрашиваем у js/api.js, а не ищем сами.
     Правила там одни на весь сайт: адрес берётся из js/config.js, http-служба
     с https-страницы не дёргается (браузер режет такой запрос молча), а ?svc=
     работает только на своей машине — иначе подсунутая ссылка увела бы имя и
     пароль игрока на чужой адрес. При переезде правится один config.js. */
  function findBase() {
    return window.AegisApi ? window.AegisApi.base() : null;
  }

  /* Запрос к службе: крышка по времени и проверка ответа. Без них зависшая
     служба держала бы кнопку «занята» вечно, а страница ошибки от прокси
     (там HTML, а не JSON) роняла бы разбор — человек видел бы пустоту. */
  function ask(url, opts, ms) {
    opts = opts || {};
    opts.cache = 'no-store';
    var timer = null;
    if (typeof AbortController === 'function') {
      var ctl = new AbortController();
      opts.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, ms || 12000);
    }
    function done() { if (timer) clearTimeout(timer); }
    return fetch(url, opts).then(function (r) {
      done();
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }, function (e) { done(); throw e; });
  }

  function say(text, kind) {
    elSay.textContent = text;
    elSay.className = 'reg-say' + (kind ? ' is-' + kind : '');
  }

  function lock(on) {
    busy = on;
    elGo.disabled = on;
    elGo.classList.toggle('is-wait', on);
  }

  /* --- нерабочее состояние: честно говорим, а не делаем вид, что кнопка живая --- */
  function dead(text) {
    lock(true);
    elGo.disabled = true;
    say(text, 'bad');
    var b = elPick.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].disabled = true;
  }

  /* ------------------------------ выбор службы ------------------------------ */
  elPick.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-p]') : null;
    if (!b || b.disabled) return;
    prov = b.getAttribute('data-p');
    var all = elPick.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === b);
    if (!busy) say('Служба выбрана. Осталось согласиться и нажать кнопку.');
  });

  /* -------------------------- что умеет сервер сейчас -------------------------- */
  function loadState() {
    base = findBase();
    if (!base) {
      dead('Регистрация откроется вместе с сервером — сезон ещё готовится. ' +
        'Следи за новостями AEGIS.');
      return;
    }
    ask(base + '/reg/state').then(function (s) {
      if (!s || !s.ok) throw new Error('нет ответа');
      minPass = s.min_pass || 6;
      /* VK ID и Яндекс ID со страницы не убираем даже пока они не подключены:
         человек должен видеть, чем его будут проверять. Кнопка просто не нажимается. */
      ready('vk', s.vk);
      ready('ya', s.ya);
      show('local', s.local);
      if (!s.vk && !s.ya && !s.local) {
        dead('Проверка личности ещё не подключена — регистрация откроется вместе ' +
          'с сервером. Следи за новостями AEGIS.');
        return;
      }
      if (s.season_closed) {
        say('Имя можно занять уже сейчас: в мир пустят на открытии, сентябрь 2026.');
      }
      resume();
    }).catch(function () {
      dead('Служба регистрации сейчас не отвечает. Это на нашей стороне — ' +
        'попробуй позже или напиши в тикет в Discord.');
    });
  }

  function show(name, on) {
    var b = elPick.querySelector('button[data-p="' + name + '"]');
    if (b) b.hidden = !on;
  }

  function ready(name, on) {
    var b = elPick.querySelector('button[data-p="' + name + '"]');
    if (!b) return;
    b.hidden = false;
    b.disabled = !on;
    if (!on) {
      var s = b.querySelector('span');
      if (s) s.textContent = 'подключим до открытия';
    }
  }

  /* ---------------- если человек вернулся на страницу после проверки ---------------- */
  function resume() {
    var rid = '';
    try { rid = sessionStorage.getItem('aegis_reg_rid') || ''; } catch (e) { rid = ''; }
    if (!rid) return;
    ask(base + '/reg/status?rid=' + encodeURIComponent(rid))
      .then(function (s) {
        if (!s || !s.ok || !s.state) return;
        if (s.state === 'done') {
          try { sessionStorage.removeItem('aegis_reg_rid'); } catch (e) {}
          say(s.text || 'Имя закреплено за тобой. Заходи лаунчером.', 'good');
        } else if (s.state === 'fail') {
          try { sessionStorage.removeItem('aegis_reg_rid'); } catch (e) {}
          say(s.text || 'Проверка не прошла. Попробуй ещё раз.', 'bad');
        }
      })
      .catch(function () {});
  }

  /* --------------------------------- отправка --------------------------------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var nick = (elNick.value || '').trim();
    var pass = elPass.value || '';

    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      say('Имя — 3–16 знаков: латиница, цифры, подчёркивание. Так требует сама игра.', 'bad');
      elNick.focus();
      return;
    }
    if (pass.length < minPass) {
      say('Пароль короче ' + minPass + ' знаков. Возьми подлиннее — это вход в лаунчер.', 'bad');
      elPass.focus();
      return;
    }
    if (pass !== elPass2.value) {
      say('Пароли не совпали.', 'bad');
      elPass2.focus();
      return;
    }
    if (!prov) {
      say('Выбери, чем подтвердить, что ты живой человек: VK ID или Яндекс ID.', 'bad');
      return;
    }
    if (!elOk1.checked || !elOk2.checked) {
      say('Отметь оба согласия — без них регистрировать нельзя.', 'bad');
      return;
    }

    lock(true);
    say('Готовим проверку…');

    ask(base + '/reg/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick: nick, pass: pass, provider: prov, consent: 'true' })
    }, 15000).then(function (s) {
      if (!s || !s.ok) {
        lock(false);
        say((s && s.text) || 'Не вышло начать проверку. Попробуй ещё раз.', 'bad');
        return;
      }
      try { sessionStorage.setItem('aegis_reg_rid', s.rid || ''); } catch (e) {}
      elPass.value = '';
      elPass2.value = '';
      say('Открываем проверку…');
      location.href = s.url;
    }).catch(function () {
      lock(false);
      say('Служба регистрации не ответила. Попробуй позже или напиши в тикет в Discord.', 'bad');
    });
  });

  loadState();
})();
