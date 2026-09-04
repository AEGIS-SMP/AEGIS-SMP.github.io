/* AEGIS — обращения с сайта.
   Темы и вопросы в них берутся из data/tickets.json — того же файла, что
   собран из бота Discord. Значит, спрашивают одно и то же в обоих местах
   и ответ приходит одинаковый; расходиться им неоткуда.

   Куда уходит написанное: POST /tickets/new на службу сервера. Службы может
   не быть (сезон ещё готовится, переезд, домашний сервер выключен) — тогда
   форма не притворяется рабочей, а собирает из ответов готовый текст:
   его можно скопировать одной кнопкой и отправить в Discord. Человек уходит
   с решением, а не с надписью «попробуйте позже».

   Подключается на tickets.html после js/api.js. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var body = document.getElementById('tkBody');
  var crumbs = document.getElementById('tkCrumbs');
  if (!body) return;

  var CATS = [];
  var BY = {};

  /* Девятнадцать тем подряд — стена, в которой не найти свою. Раскладываем
     по четырём понятным кучкам; порядок внутри кучки — от частого к редкому. */
  var GROUPS = [
    ['Помощь и разбор', ['help', 'bug', 'appeal', 'staff']],
    ['Жалобы', ['complaint', 'grief', 'rpclaim', 'demolish']],
    ['Державы и мир', ['build', 'dispute', 'war', 'rppost', 'dcverify']],
    ['Проекту', ['event', 'streamer', 'video', 'offer', 'award', 'intern']]
  ];

  /* Обратная связь. В Discord обратный адрес не нужен — ответ приходит в тот же
     тикет. С сайта человек может уйти и закрыть вкладку, поэтому спрашиваем,
     куда ответить. Поле общее для всех тем, поэтому живёт здесь, а не в JSON. */
  var CONTACT = {
    label: 'Куда тебе ответить',
    hint: 'Discord-ник, Telegram или почта — что угодно, лишь бы дошло',
    style: 'short', required: true, max: 80
  };

  function esc(s) { return A.esc(s); }

  /* ------------------------------------------------------------ витрина тем */

  function drawList() {
    crumbs.innerHTML = '<a href="index.html">Главная</a><span>/</span>Обращения';
    var h = '';

    h += '<div class="nbox"><span class="n-ic">i</span><div>' +
      'Выбери тему — под каждой свои вопросы, и чем точнее ответы, тем быстрее ' +
      'разбор. Одно обращение = одна тема: две просьбы в одном тексте теряются.' +
      '</div></div>';

    GROUPS.forEach(function (g) {
      var items = g[1].map(function (k) { return BY[k]; }).filter(Boolean);
      if (!items.length) return;
      h += '<h2 class="tk-gt">' + esc(g[0]) + '</h2><div class="tk-grid">';
      items.forEach(function (c) {
        h += '<a class="tk-card" href="#/' + esc(c.key) + '">' +
          '<span class="tk-e">' + esc(c.emoji || '•') + '</span>' +
          '<div><h3>' + esc(cleanName(c.name)) + '</h3>' +
          '<p>' + esc(c.short || '') + '</p></div></a>';
      });
      h += '</div>';
    });

    /* Темы, которых нет ни в одной кучке: файл собирается из бота, и новая
       тема там появится раньше, чем я про неё узнаю. Пусть будет видна. */
    var known = {};
    GROUPS.forEach(function (g) { g[1].forEach(function (k) { known[k] = 1; }); });
    var rest = CATS.filter(function (c) { return !known[c.key]; });
    if (rest.length) {
      h += '<h2 class="tk-gt">Разное</h2><div class="tk-grid">';
      rest.forEach(function (c) {
        h += '<a class="tk-card" href="#/' + esc(c.key) + '">' +
          '<span class="tk-e">' + esc(c.emoji || '•') + '</span>' +
          '<div><h3>' + esc(cleanName(c.name)) + '</h3>' +
          '<p>' + esc(c.short || '') + '</p></div></a>';
      });
      h += '</div>';
    }

    h += statusBox();
    body.innerHTML = h;
    bindStatus();
    document.title = 'Обращения — AEGIS SMP';
  }

  /* В боте названия тем записаны как «Вопросы | Помощь» — вертикальная черта
     нужна в списке Discord, на карточке она лишняя. */
  function cleanName(s) {
    return String(s || '').split('|')[0].trim() || String(s || '');
  }

  /* ------------------------------------------------------------------ форма */

  function drawForm(cat) {
    crumbs.innerHTML = '<a href="index.html">Главная</a><span>/</span>' +
      '<a href="#/">Обращения</a><span>/</span>' + esc(cleanName(cat.name));

    var fields = (cat.fields || []).concat([CONTACT]);
    var h = '<form class="tk-form" id="tkForm" novalidate>';
    h += '<div class="tk-head"><span class="tk-e">' + esc(cat.emoji || '•') + '</span>' +
      '<h2>' + esc(cleanName(cat.name)) + '</h2></div>';
    if (cat.long) h += '<div class="tk-long">' + esc(cat.long) + '</div>';
    else if (cat.short) h += '<div class="tk-long">' + esc(cat.short) + '</div>';

    fields.forEach(function (f, i) {
      var id = 'f' + i;
      var long = f.style === 'long';
      h += '<div class="field" data-i="' + i + '">' +
        '<label for="' + id + '">' + esc(f.label) +
        (f.required ? ' <span class="req">*</span>' : ' <em>— по желанию</em>') +
        '</label>' +
        (long
          ? '<textarea id="' + id + '" maxlength="' + (f.max || 900) + '" ' +
            'placeholder="' + esc(f.hint || '') + '"></textarea>'
          : '<input id="' + id + '" type="text" maxlength="' + (f.max || 200) + '" ' +
            'placeholder="' + esc(f.hint || '') + '">') +
        '<div class="err">Это поле нужно заполнить.</div>' +
        (long ? '<div class="cnt"><span>0</span>/' + (f.max || 900) + '</div>' : '') +
        '</div>';
    });

    h += '<div class="form-go">' +
      '<button class="btn btn-primary" type="submit" id="tkGo">Отправить обращение</button>' +
      '<div class="fg-note" id="tkSay">Ответ приходит туда, куда ты попросил. ' +
      'Обычно в течение суток.</div></div>';
    h += '</form>';
    h += '<p class="tk-back"><a href="#/">← ко всем темам</a></p>';

    body.innerHTML = h;
    document.title = cleanName(cat.name) + ' — обращения AEGIS SMP';
    bindForm(cat, fields);
    var first = body.querySelector('input, textarea');
    if (first && window.innerWidth > 900) first.focus();
  }

  function bindForm(cat, fields) {
    var form = document.getElementById('tkForm');
    var go = document.getElementById('tkGo');
    var say = document.getElementById('tkSay');

    /* Счётчик знаков у длинных полей: лимит приходит из бота, и упереться
       в него на середине мысли обиднее, чем видеть остаток заранее. */
    body.querySelectorAll('textarea').forEach(function (t) {
      var box = t.closest('.field');
      var cnt = box.querySelector('.cnt span');
      if (!cnt) return;
      var upd = function () {
        cnt.textContent = t.value.length;
        cnt.parentNode.classList.toggle('over', t.value.length >= Number(t.maxLength) - 20);
      };
      t.addEventListener('input', upd);
      upd();
    });

    body.addEventListener('input', function (e) {
      var box = e.target.closest && e.target.closest('.field');
      if (box) box.classList.remove('bad');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var vals = [], bad = null;
      fields.forEach(function (f, i) {
        var box = body.querySelector('.field[data-i="' + i + '"]');
        var el = box.querySelector('input, textarea');
        var v = el.value.trim();
        if (f.required && !v) {
          box.classList.add('bad');
          if (!bad) bad = el;
        }
        vals.push({ label: f.label, value: v });
      });
      if (bad) {
        bad.focus();
        say.textContent = 'Не хватает обязательных ответов — они отмечены.';
        return;
      }

      go.disabled = true;
      go.textContent = 'Отправляем…';
      say.textContent = '';

      A.call('/tickets/new', {
        body: { cat: cat.key, name: cleanName(cat.name), fields: vals }
      }).then(function (r) {
        done(cat, vals, r && r.id);
      }, function (err) {
        go.disabled = false;
        go.textContent = 'Отправить обращение';
        /* Службы нет — не тупик: отдаём готовый текст, который остаётся
           только вставить в Discord. */
        if (err && (err.code === 'offline' || err.code === 'net' || err.code === 'timeout')) {
          offlineWay(cat, vals);
        } else {
          say.textContent = A.textOf(err);
        }
      });
    });
  }

  /* --------------------------------------------------------------- итог */

  function done(cat, vals, id) {
    var h = '<div class="tk-form">' +
      '<div class="nbox ok"><span class="n-ic">✓</span><div>' +
      '<b>Обращение принято.</b> ' +
      (id ? 'Его номер — <b>' + esc(id) + '</b>. Запиши: по нему можно узнать, ' +
            'на какой стадии разбор.' : 'Ответ придёт туда, куда ты просил.') +
      '</div></div>' +
      '<h2 style="margin:26px 0 12px">Что дальше</h2>' +
      '<div class="row-list">' +
      '<div class="row"><div><div class="rw-t">Обращение читает дежурный</div>' +
      '<div class="rw-s">Тема попадает тем, кто ей занимается, а не всей команде подряд</div></div>' +
      '<div class="rw-r">сразу</div></div>' +
      '<div class="row"><div><div class="rw-t">Ответ или уточняющий вопрос</div>' +
      '<div class="rw-s">Туда, куда ты просил ответить</div></div>' +
      '<div class="rw-r">обычно за сутки</div></div>' +
      '<div class="row"><div><div class="rw-t">Решение</div>' +
      '<div class="rw-s">Жалобы и апелляции разбирает не тот, кто выдал наказание</div></div>' +
      '<div class="rw-r">по сложности</div></div>' +
      '</div>' +
      '<p class="tk-back"><a href="#/">← написать ещё</a></p></div>';
    body.innerHTML = h;
    scrollTop();
  }

  /* Служба недоступна: собираем ровно то, что человек написал, в текст для
     Discord. Ничего не теряем и не просим набирать заново. */
  function offlineWay(cat, vals) {
    var text = 'Тема: ' + cleanName(cat.name) + '\n\n' +
      vals.filter(function (v) { return v.value; })
        .map(function (v) { return v.label + ': ' + v.value; })
        .join('\n');

    var dc = A.link('discord');
    var h = '<div class="tk-form">' +
      '<div class="nbox warn"><span class="n-ic">!</span><div>' +
      '<b>Приём обращений с сайта включится вместе с сервером.</b> ' +
      'Написанное не пропало: ниже готовый текст — скопируй его одной кнопкой ' +
      'и отправь в тикет Discord, там ответят так же.' +
      '</div></div>' +
      '<div class="field"><label for="tkDraft">Готовый текст обращения</label>' +
      '<textarea id="tkDraft" style="min-height:200px">' + esc(text) + '</textarea></div>' +
      '<div class="form-go">' +
      '<button class="btn btn-primary" type="button" id="tkCopy">Скопировать текст</button>' +
      (dc ? '<a class="btn btn-dark" href="' + esc(dc) + '" target="_blank" ' +
            'rel="noopener">Открыть Discord</a>' : '') +
      '<div class="fg-note" id="tkCopySay">Текст уже собран — набирать заново ничего не надо.</div>' +
      '</div>' +
      '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
    body.innerHTML = h;
    scrollTop();

    document.getElementById('tkCopy').addEventListener('click', function () {
      var ta = document.getElementById('tkDraft');
      var say = document.getElementById('tkCopySay');
      var ok = function () { say.textContent = 'Скопировано — вставляй в тикет Discord.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(ok, function () { pick(ta, say); });
      } else {
        pick(ta, say);
      }
    });
  }

  /* Запасной способ: буфер обмена закрыт (старый браузер, http) — выделяем
     текст, дальше человек копирует сам. */
  function pick(ta, say) {
    ta.focus();
    ta.select();
    say.textContent = 'Текст выделен — скопируй его сочетанием Ctrl+C.';
  }

  /* ------------------------------------------------------- проверка по номеру */

  function statusBox() {
    return '<div class="tk-status">' +
      '<h2 class="tk-gt">Уже писал?</h2>' +
      '<p class="tk-st-p">Номер обращения выдаётся при отправке. По нему видно, ' +
      'на какой стадии разбор — заново писать не нужно.</p>' +
      '<form class="tk-st-form" id="tkSt">' +
      '<label class="search"><svg class="s-ic" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<circle cx="9" cy="9" r="6"/><path d="M13.5 13.5 17 17"/></svg>' +
      '<input id="tkStId" type="text" maxlength="24" autocomplete="off" ' +
      'placeholder="номер обращения" aria-label="Номер обращения"></label>' +
      '<button class="btn btn-dark" type="submit">Проверить</button>' +
      '</form><div class="tk-st-say" id="tkStSay"></div></div>';
  }

  function bindStatus() {
    var f = document.getElementById('tkSt');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('tkStId').value.trim();
      var say = document.getElementById('tkStSay');
      if (!id) { say.textContent = 'Впиши номер, который выдали при отправке.'; return; }
      say.textContent = 'Смотрим…';
      A.call('/tickets/status?id=' + encodeURIComponent(id)).then(function (r) {
        var st = { open: 'в работе', wait: 'ждёт твоего ответа', done: 'закрыто' };
        say.innerHTML = 'Обращение <b>' + esc(id) + '</b>: ' +
          esc(st[r.status] || r.status || 'найдено') +
          (r.note ? '. ' + esc(r.note) : '.');
      }, function (err) {
        say.textContent = A.textOf(err);
      });
    });
  }

  /* ----------------------------------------------------------------- маршрут */

  function scrollTop() {
    var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  }

  function route() {
    var key = (location.hash || '').replace(/^#\/?/, '').trim();
    if (key && BY[key]) drawForm(BY[key]);
    else drawList();
  }

  A.local('data/tickets.json').then(function (d) {
    CATS = (d && d.categories) || [];
    CATS.forEach(function (c) { BY[c.key] = c; });
    if (!CATS.length) {
      body.innerHTML = '<div class="empty"><h4>Темы не загрузились</h4>' +
        '<p>Обнови страницу. Если не помогло — напиши в Discord, там те же темы.</p></div>';
      return;
    }
    route();
    window.addEventListener('hashchange', function () { route(); scrollTop(); });
  }, function () {
    body.innerHTML = '<div class="empty"><h4>Темы не загрузились</h4>' +
      '<p>Похоже, оборвалась связь. Обнови страницу — список тем лежит прямо ' +
      'на сайте и грузится быстро.</p></div>';
  });
})();
