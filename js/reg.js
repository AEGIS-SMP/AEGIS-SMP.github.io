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

  var elMode = document.getElementById('rMode');

  var prov = '';
  var minPass = 6;
  var busy = false;
  var base = null;
  /* rec — «Забыл пароль»: та же проверка, но вместо нового имени новый пароль к своему.
     Сам пароль здесь не вводят: его задают уже после проверки, в окне службы или по
     ссылке от бота, — иначе чужой мог бы начать смену и подсунуть хозяину ссылку. */
  var rec = false;
  var recOn = false;      // служба умеет восстановление (/reg/state → recover)
  var stateOk = false;

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

  /* ------------------------ режим: новое имя / забыл пароль ------------------------ */
  function setMode(on) {
    rec = on;
    var only = document.querySelectorAll('.reg-card [data-only]');
    for (var i = 0; i < only.length; i++) {
      only[i].hidden = only[i].getAttribute('data-only') !== (rec ? 'rec' : 'reg');
    }
    var mb = elMode ? elMode.querySelectorAll('button[data-m]') : [];
    for (var j = 0; j < mb.length; j++) {
      var me = (mb[j].getAttribute('data-m') === 'rec') === rec;
      mb[j].classList.toggle('on', me);
      mb[j].setAttribute('aria-pressed', me ? 'true' : 'false');
    }
    elNick.setAttribute('autocomplete', 'username');
    if (!elGo.classList.contains('btn-off')) {
      elGo.textContent = rec ? 'Пройти проверку и сменить пароль' : 'Пройти проверку и занять имя';
    }
    try {
      history.replaceState(null, '', rec ? '#recover' : location.pathname + location.search);
    } catch (e) {}
    if (!stateOk || busy) return;
    if (rec && !recOn) {
      elGo.disabled = true;
      say('Восстановление пароля включится после ближайшего перезапуска сервера. ' +
        'Пока напиши обращение на сайте — поможем вручную.', 'bad');
      return;
    }
    elGo.disabled = false;
    say(rec ? 'Введи имя и выбери службу, которой подтверждал регистрацию.'
            : 'Проверь имя и пароль, выбери службу проверки.');
  }

  if (elMode) {
    elMode.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-m]') : null;
      if (!b || busy) return;
      setMode(b.getAttribute('data-m') === 'rec');
    });
  }

  /* ------------------------------ выбор службы ------------------------------ */
  elPick.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-p]') : null;
    if (!b || b.disabled) return;
    prov = b.getAttribute('data-p');
    var all = elPick.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === b;
      all[i].classList.toggle('on', on);
      /* Выбранная служба отличается только рамкой — тому, кто не видит экрана,
         рамку не прочитают. aria-pressed говорит это словами. */
      all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (!busy) say('Служба выбрана. Осталось согласиться и нажать кнопку.');
  });

  /* -------------------------- что умеет сервер сейчас -------------------------- */
  function loadState() {
    /* Проверка закрыта словом овнера (js/config.js, regClosed). Спрашиваем об
       этом ДО того, как обратиться к службе: служба стоит на арендном сервере
       и уже отвечает, а значит на её ответе кнопки VK ID / Яндекс ID / Discord
       открылись бы сами. Ждать, что «служба всё равно молчит», — не закрытие,
       а везение.

       Поля тоже выключаем. Строки-отказа хватило бы, чтобы ничего не ушло
       (кнопка заперта, отправка отбивается), но человек успел бы набрать имя
       и пароль и только потом узнать, что занять имя пока нельзя. */
    if (window.AEGIS && AEGIS.regClosed) {
      dead('Проверка и бронь имени пока закрыты — сервер на перерыве между ' +
        'вайпами, откроются вместе с ним. Дату следующего вайпа объявим в Discord ' +
        'и Telegram. Страницу оставляем открытой нарочно: тут написано, чем будут ' +
        'проверять и что именно сохраняется.');
      var off = [elNick, elPass, elPass2, elOk1, elOk2];
      for (var i = 0; i < off.length; i++) if (off[i]) off[i].disabled = true;
      /* Закрытая дверь и выглядеть должна закрытой, а не сломанной: та же
         серая кнопка, что у закрытой лавки, и подпись без обещаний.
         is-wait снимаем — это вид «идёт проверка, подожди», а ждать нечего;
         красную окраску строки тоже: закрыли нарочно, это не отказ службы. */
      elGo.classList.remove('is-wait');
      elGo.classList.add('btn-off');
      elGo.textContent = 'Пока закрыто';
      elSay.className = 'reg-say';
      return;
    }
    base = findBase();
    if (!base) {
      dead('Регистрация сейчас недоступна. Попробуй позже или напиши в тикет ' +
        'в Discord.');
      return;
    }
    ask(base + '/reg/state').then(function (s) {
      if (!s || !s.ok) throw new Error('нет ответа');
      minPass = s.min_pass || 6;
      /* VK ID и Яндекс ID со страницы не убираем даже пока они не подключены:
         человек должен видеть, чем его будут проверять. Кнопка просто не нажимается. */
      ready('vk', s.vk);
      ready('ya', s.ya);
      ready('ds', s.ds);
      ready('tg', s.tg);
      show('local', s.local);
      if (!s.vk && !s.ya && !s.ds && !s.tg && !s.local) {
        dead('Проверка личности сейчас не подключена, поэтому регистрация ' +
          'недоступна. Попробуй позже или напиши в тикет в Discord.');
        return;
      }
      if (s.season_closed) {
        say('Имя можно занять уже сейчас: в мир пустят на открытии следующего вайпа.');
      }
      recOn = !!s.recover;
      stateOk = true;
      if (rec) setMode(true);
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
      if (s) s.textContent = 'подключим позже';
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
        } else if (s.state === 'verified') {
          say(s.text || 'Проверка пройдена. Задай новый пароль по ссылке.', 'good');
        } else if (s.state === 'fail') {
          try { sessionStorage.removeItem('aegis_reg_rid'); } catch (e) {}
          say(s.text || 'Проверка не прошла. Попробуй ещё раз.', 'bad');
        }
      })
      .catch(function () {});
  }

  /* ------------------------------ Telegram ------------------------------
     Подтверждает бот AEGIS: человек жмёт «Запустить», бот сам сообщает серверу.
     Страницу не уводим — ссылка открывается рядом (настоящий клик, его браузер
     не режет как всплывающее окно), а здесь ждём ответа сервера. */
  function tgWait(url, rid) {
    elSay.className = 'reg-say';
    elSay.textContent = 'Последний шаг: ';
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'открой бота AEGIS в Telegram';
    elSay.appendChild(a);
    elSay.appendChild(document.createTextNode(rec
      ? ' и нажми «Запустить» — бот пришлёт ссылку на новый пароль.'
      : ' и нажми «Запустить». Эту страницу не закрывай: ответ появится здесь сам.'));
    var tries = 0;
    function next() {
      if (++tries < 600) { setTimeout(poll, 3000); return; }
      lock(false);
      say('Бот так и не подтвердил. Начни заново.', 'bad');
    }
    function poll() {
      ask(base + '/reg/status?rid=' + encodeURIComponent(rid)).then(function (s) {
        if (s && s.ok && s.state === 'wait') return next();
        if (s && s.ok && s.state === 'verified') {
          /* Бот уже прислал ссылку; ждём, пока по ней зададут пароль. */
          say(s.text || 'Проверка пройдена. Ссылка на новый пароль пришла в Telegram.', 'good');
          return next();
        }
        try { sessionStorage.removeItem('aegis_reg_rid'); } catch (e) {}
        if (s && s.ok && s.state === 'done') {
          say(s.text || 'Имя закреплено за тобой. Заходи лаунчером.', 'good');
          return;
        }
        lock(false);
        say((s && s.text) || 'Проверка не прошла. Попробуй ещё раз.', 'bad');
      }, next);
    }
    setTimeout(poll, 3000);
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
    if (rec && !recOn) {
      say('Восстановление пароля включится после ближайшего перезапуска сервера. ' +
        'Пока напиши обращение на сайте — поможем вручную.', 'bad');
      return;
    }
    if (!rec && pass.length < minPass) {
      say('Пароль короче ' + minPass + ' знаков. Возьми подлиннее — это вход в лаунчер.', 'bad');
      elPass.focus();
      return;
    }
    if (!rec && pass !== elPass2.value) {
      say('Пароли не совпали.', 'bad');
      elPass2.focus();
      return;
    }
    if (!prov) {
      say(rec ? 'Выбери службу, которой подтверждал регистрацию.'
              : 'Выбери, чем подтвердить, что ты живой человек: Discord или Telegram.', 'bad');
      return;
    }
    if (rec ? !elOk1.checked : (!elOk1.checked || !elOk2.checked)) {
      say(rec ? 'Отметь согласие на обработку данных — без него проверку не пройти.'
              : 'Отметь оба согласия — без них регистрировать нельзя.', 'bad');
      return;
    }

    lock(true);
    say('Готовим проверку…');

    var body = rec ? { nick: nick, provider: prov, consent: 'true', mode: 'recover' }
                   : { nick: nick, pass: pass, provider: prov, consent: 'true' };
    ask(base + '/reg/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 15000).then(function (s) {
      if (!s || !s.ok) {
        lock(false);
        say((s && s.text) || 'Не вышло начать проверку. Попробуй ещё раз.', 'bad');
        return;
      }
      try { sessionStorage.setItem('aegis_reg_rid', s.rid || ''); } catch (e) {}
      elPass.value = '';
      elPass2.value = '';
      if (prov === 'tg') { tgWait(s.url, s.rid); return; }
      say('Открываем проверку…');
      location.href = s.url;
    }).catch(function () {
      lock(false);
      say('Служба регистрации не ответила. Попробуй позже или напиши в тикет в Discord.', 'bad');
    });
  });

  if (location.hash === '#recover') setMode(true);
  loadState();
})();
