/* Профиль игрока: скин. Страница только собирает имя, пароль и картинку —
   проверяет и хранит все служба AegisSkins в моде сервера. Пароль уходит
   одним запросом и нигде не остается: ни в адресе, ни в памяти браузера.

   Почему скин ставится так, а не в лаунчере: сервер в offline-режиме, у Mojang
   наших имен нет, и подпись на скин он нам не выдаст. Поэтому картинку держит
   AEGIS, а клиент из лаунчера забирает ее сам при заходе. */
(function () {
  'use strict';

  var form = document.getElementById('pfForm');
  if (!form) return;

  var elNick = document.getElementById('pNick');
  var elPass = document.getElementById('pPass');
  var elDrop = document.getElementById('pDrop');
  var elFile = document.getElementById('pFile');
  var elName = document.getElementById('pDropName');
  var elModel = document.getElementById('pModel');
  var elGo = document.getElementById('pGo');
  var elOff = document.getElementById('pOff');
  var elSay = document.getElementById('pSay');
  var elCanvas = document.getElementById('pCanvas');
  var elTitle = document.getElementById('pViewTitle');
  var elText = document.getElementById('pViewText');

  var ctx = elCanvas.getContext('2d');
  var base = null;
  var busy = false;
  var model = 'classic';
  var picked = null;      /* выбранный файл: {data, img, w, h} */
  var live = null;        /* что стоит на сервере: {img, w, h, model, at} */
  var FILE_MAX = 160 * 1024;

  /* На телефоне тащить картинку некуда — пальцем файл не перетащишь. Поэтому
     на сенсорном вводе поле подписано «Нажми и выбери png», а на мыши остается
     привычное «перетащи». Текст один на все три места, где поле сбрасывается,
     иначе после отправки на телефоне снова появлялось бы «перетащи». */
  var TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var DROP_IDLE = TOUCH ? 'Нажми и выбери png' : 'Перетащи png сюда';

  /* Где живет служба — спрашиваем у js/api.js, а не ищем сами. Правила там одни
     на весь сайт: адрес берется из js/config.js, http-служба с https-страницы
     не дергается (браузер режет такой запрос молча), а ?svc= работает только на
     своей машине. При переезде правится один config.js. */
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
    elOff.disabled = on;
    elGo.classList.toggle('is-wait', on);
  }

  function dead(text) {
    lock(true);
    elGo.disabled = true;
    elOff.disabled = true;
    elDrop.classList.add('is-off');
    say(text, 'bad');
  }

  /* ------------------------------- предпросмотр ------------------------------- */

  /* Рисуем игрока спереди прямо из текстуры скина: те же куски, что берет игра.
     Старый скин 64×32 — вторые рука и нога зеркальные, как их достроит сервер. */
  function draw(img, w, h, slim) {
    var S = 8;
    ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = false;

    var legacy = h === 32;
    var aw = slim ? 3 : 4;
    var ax = slim ? 1 : 0;   /* сдвиг внутри куска руки у тонкой модели */

    function put(sx, sy, sw, sh, dx, dy) {
      ctx.drawImage(img, sx, sy, sw, sh, dx * S, dy * S, sw * S, sh * S);
    }
    function mir(sx, sy, sw, sh, dx, dy) {
      ctx.save();
      ctx.translate((dx + sw) * S, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, sw, sh, 0, dy * S, sw * S, sh * S);
      ctx.restore();
    }

    put(8, 8, 8, 8, 4, 0);                          /* голова */
    put(20, 20, 8, 12, 4, 8);                       /* тело */
    put(44 + ax, 20, aw, 12, 4 - aw, 8);            /* правая рука */
    put(4, 20, 4, 12, 4, 20);                       /* правая нога */
    if (legacy) {
      mir(44 + ax, 20, aw, 12, 12, 8);
      mir(4, 20, 4, 12, 8, 20);
    } else {
      put(36 + ax, 52, aw, 12, 12, 8);              /* левая рука */
      put(20, 52, 4, 12, 8, 20);                    /* левая нога */
    }

    put(40, 8, 8, 8, 4, 0);                         /* шапка — есть и у старых */
    if (!legacy) {
      put(20, 36, 8, 12, 4, 8);                     /* куртка */
      put(44 + ax, 36, aw, 12, 4 - aw, 8);          /* правый рукав */
      put(52 + ax, 52, aw, 12, 12, 8);              /* левый рукав */
      put(4, 36, 4, 12, 4, 20);                     /* правая штанина */
      put(4, 52, 4, 12, 8, 20);                     /* левая штанина */
    }
  }

  function when(ms) {
    var t = Number(ms || 0);
    if (!t) return '';
    var d = new Date(t);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear()
      + ' в ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function view() {
    if (picked) {
      draw(picked.img, picked.w, picked.h, model === 'slim');
      elTitle.textContent = 'Выбранная картинка';
      elText.textContent = 'Так скин сядет на игрока: ' + picked.w + '×' + picked.h
        + ', руки ' + (model === 'slim' ? 'тонкие' : 'классические')
        + '. Нажми «Поставить скин», чтобы он попал на сервер.';
      return;
    }
    if (live) {
      draw(live.img, live.w, live.h, live.model === 'slim');
      elTitle.textContent = 'Сейчас на сервере';
      var at = when(live.at);
      elText.textContent = 'Твой скин, руки '
        + (live.model === 'slim' ? 'тонкие' : 'классические')
        + (at ? ', поставлен ' + at : '') + '. Выбери другую картинку, чтобы заменить.';
      return;
    }
    draw(null);
    elTitle.textContent = 'Пока смотреть нечего';
    elText.textContent = 'Выбери картинку — покажу, как она сядет на игрока. '
      + 'Здесь же видно, какой скин стоит на сервере сейчас.';
  }

  /* Картинку разбираем через blob: так холст остается «своим» и размеры честные. */
  function open(blob, done, fail) {
    var url = URL.createObjectURL(blob);
    var im = new Image();
    im.onload = function () {
      URL.revokeObjectURL(url);
      done(im, im.naturalWidth, im.naturalHeight);
    };
    im.onerror = function () {
      URL.revokeObjectURL(url);
      fail();
    };
    im.src = url;
  }

  /* --------------------------------- выбор файла --------------------------------- */

  function take(file) {
    if (!file) return;
    if (file.size > FILE_MAX) {
      say('Файл тяжелее ' + Math.round(FILE_MAX / 1024) + ' КБ. Скин 64×64 весит '
        + 'единицы килобайт — похоже, это не он.', 'bad');
      return;
    }
    open(file, function (im, w, h) {
      if (w !== 64 || (h !== 64 && h !== 32)) {
        say('Скин должен быть 64×64 (или старый 64×32), а тут ' + w + '×' + h + '.', 'bad');
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        picked = { data: String(fr.result), img: im, w: w, h: h };
        elName.textContent = file.name;
        elDrop.classList.add('is-set');
        view();
        say('Картинка подходит. Введи имя с паролем и нажми «Поставить скин».');
      };
      fr.onerror = function () { say('Файл не прочитался. Попробуй другой.', 'bad'); };
      fr.readAsDataURL(file);
    }, function () {
      say('Это не картинка png.', 'bad');
    });
  }

  elDrop.addEventListener('click', function () {
    if (!elDrop.classList.contains('is-off')) elFile.click();
  });
  /* Поле выбора файла спрятано, видимая кнопка — сама рамка. Значит рамка
     обязана работать и с клавиатуры: иначе без мыши скин не поставить. */
  elDrop.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    if (!elDrop.classList.contains('is-off')) elFile.click();
  });
  elFile.addEventListener('change', function () {
    take(elFile.files && elFile.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (n) {
    elDrop.addEventListener(n, function (e) {
      e.preventDefault();
      elDrop.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    elDrop.addEventListener(n, function (e) {
      e.preventDefault();
      elDrop.classList.remove('is-over');
    });
  });
  elDrop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) take(e.dataTransfer.files[0]);
  });

  /* Выбранные руки отличаются только рамкой и цветом заголовка — тому, кто не
     видит экрана, это не прочитают. aria-pressed говорит выбор словами. Отмечают
     кнопки два места (клик и ответ сервера о том, что уже стоит), поэтому пометка
     вынесена сюда: иначе одно из них рано или поздно забудут обновить. */
  function markModel() {
    var all = elModel.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) {
      var on = all[i].getAttribute('data-m') === model;
      all[i].classList.toggle('on', on);
      all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  elModel.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-m]') : null;
    if (!b) return;
    model = b.getAttribute('data-m');
    markModel();
    view();
  });

  /* ------------------------------ что стоит сейчас ------------------------------ */

  var asked = '';

  function loadState() {
    var nick = (elNick.value || '').trim();
    if (!base || nick === asked) return;
    asked = nick;
    live = null;
    view();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return;
    ask(base + '/skin/state?nick=' + encodeURIComponent(nick))
      .then(function (s) {
        if (!s || !s.ok || !s.has) return;
        if (s.model === 'slim' || s.model === 'classic') {
          model = s.model;
          markModel();
        }
        return fetch(base + '/skins/' + encodeURIComponent(nick) + '.png',
          { cache: 'no-store' }).then(function (r) {
            if (!r.ok) return null;
            return r.blob();
          }).then(function (b) {
            if (!b) return;
            open(b, function (im, w, h) {
              live = { img: im, w: w, h: h, model: s.model, at: s.at };
              view();
            }, function () {});
          });
      })
      .catch(function () {});
  }

  elNick.addEventListener('blur', loadState);
  elNick.addEventListener('change', loadState);

  /* --------------------------------- отправка --------------------------------- */

  function check() {
    var nick = (elNick.value || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      say('Имя — 3–16 знаков: латиница, цифры, подчеркивание.', 'bad');
      elNick.focus();
      return null;
    }
    if ((elPass.value || '').length < 6) {
      say('Пароль короче шести знаков — это не он.', 'bad');
      elPass.focus();
      return null;
    }
    return nick;
  }

  function send(door, body, good) {
    lock(true);
    /* Картинка уходит целиком в теле запроса, поэтому срок больше: на слабом
       канале 160 КБ в base64 успевают не всегда за общие двенадцать секунд. */
    ask(base + door, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 25000).then(function (s) {
      lock(false);
      if (!s || !s.ok) {
        say((s && s.text) || 'Не вышло. Попробуй еще раз.', 'bad');
        return;
      }
      say(s.text || 'Готово.', 'good');
      good(s);
    }).catch(function () {
      lock(false);
      say('Служба AEGIS не ответила. Попробуй позже или напиши в тикет в Discord.', 'bad');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var nick = check();
    if (!nick) return;
    if (!picked) {
      say('Сначала выбери картинку скина.', 'bad');
      return;
    }
    say('Отправляем картинку…');
    send('/skin/set', { nick: nick, pass: elPass.value, model: model, png: picked.data },
      function () {
        /* Пароль в поле больше не нужен — держать его на странице незачем. */
        elPass.value = '';
        live = { img: picked.img, w: picked.w, h: picked.h, model: model, at: Date.now() };
        picked = null;
        elFile.value = '';
        elName.textContent = DROP_IDLE;
        elDrop.classList.remove('is-set');
        view();
      });
  });

  elOff.addEventListener('click', function () {
    if (busy) return;
    var nick = check();
    if (!nick) return;
    say('Снимаем скин…');
    send('/skin/clear', { nick: nick, pass: elPass.value }, function () {
      elPass.value = '';
      live = null;
      picked = null;
      elFile.value = '';
      elName.textContent = DROP_IDLE;
      elDrop.classList.remove('is-set');
      view();
    });
  });

  /* ---------------------------------- запуск ---------------------------------- */

  base = findBase();
  /* Подпись поля выставляем кодом, а не в разметке: в html лежит «перетащи» —
     вариант для мыши, и он же остается, если скрипт не выполнился. */
  if (TOUCH) {
    elName.textContent = DROP_IDLE;
    var elHow = document.getElementById('pDropHow');
    if (elHow) elHow.textContent = 'png 64×64, старые 64×32 тоже подойдут';
  }
  var fromLauncher = new URLSearchParams(location.search).get('nick') || '';
  if (/^[A-Za-z0-9_]{3,16}$/.test(fromLauncher)) {
    elNick.value = fromLauncher;
    elPass.focus();
  }
  view();
  if (!base) {
    dead('Смена скина сейчас недоступна. Попробуй позже или напиши в тикет в Discord.');
  } else {
    /* Сначала спрашиваем службу, жива ли она вообще. Без этой проверки страница
       выглядела бы рабочей: человек вводил бы имя с паролем, выбирал картинку
       и только по нажатию кнопки узнавал, что сервер выключен. Спрашиваем
       /reg/state — служба на сервере одна, этот ответ приходит без имени
       и ничего не меняет. Важен сам факт ответа, а не что в нем. */
    ask(base + '/reg/state', null, 8000).then(function () {
      loadState();
    }, function () {
      dead('Служба скинов сейчас не отвечает. Это на нашей стороне — попробуй позже '
        + 'или напиши в тикет в Discord.');
    });
  }
})();
