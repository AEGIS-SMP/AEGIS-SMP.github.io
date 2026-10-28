/* AEGIS — витрина провинций («Земли»).

   Страница нужна человеку, который еще НЕ на сервере: он должен понимать,
   сколько стоит земля и где селиться, до того как ставить лаунчер.

   Цены лежат в data/lands.json — их считает карта (prov_price.py), сюда они
   попадают через site\tools\lands_build.py. Сайт цену не пересчитывает: две
   формулы в двух местах разъедутся в первый же день.

   Свободна провинция или занята — знает только сервер. Пока службы нет
   (js/config.js → api пустой), список честно говорит, что занятость появится
   вместе с сервером, и не выдумывает «свободно» за него.

   От службы нужен один запрос:
   GET /lands/state
     -> {ok, at, taken:[{id, owner, state:"owned|debt"}]}
   Все, чего в taken нет, считается свободным. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var body = document.getElementById('lnBody');
  if (!body || !A) return;

  var esc = A.esc;

  var data = null;      // data/lands.json
  var taken = null;     // id -> {owner, state}, если служба ответила
  var q = '';           // строка поиска
  var country = '';     // фильтр по державе
  var sort = 'up';      // up | down
  var only = '';        // '' | 'cheap' | 'sea' | 'cap' | 'free'
  var shown = 40;       // сколько строк уже показано

  var STEP = 40;

  function money(n) {
    n = Math.round(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /* Суточный налог с 17.09.2026 считается СТУПЕНЬКОЙ от цены и только целыми
     червонцами — процентов в механике больше нет (ЭКОНОМИКА.md 4.4). Ступень
     сгорает всегда, сверху держава кладет надбавку себе: малый ×1, средний ×2,
     большой ×3. Поэтому показываем вилку: у одной и той же земли в разных
     странах налог разный. Поле tax из прайса врет (оно недельное и одно на
     всех) — считаем сами от цены. */
  var TAX_STEPS = [[30, 1], [80, 2], [150, 3], [250, 5], [400, 8], [1e9, 12]];
  function taxStep(price) {
    price = Number(price) || 0;
    for (var i = 0; i < TAX_STEPS.length; i++) {
      if (price <= TAX_STEPS[i][0]) return TAX_STEPS[i][1];
    }
    return 12;
  }
  function taxDay(price) {
    var s = taxStep(price);
    return s + '–' + s * 3;
  }

  /* Дата в виде «10.09.2026». Своя, а не toLocaleDateString: у части игроков
     локаль браузера нерусская, и дата приезжает как «9/10/2026». */
  function day(ms) {
    var d = new Date(Number(ms) || 0);
    if (!ms || isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function plural(n, f) {
    n = Math.abs(Math.floor(n)) % 100;
    var d = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (d > 1 && d < 5) return f[1];
    if (d === 1) return f[0];
    return f[2];
  }

  /* Поиск без оглядки на регистр и на «е». */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е');
  }

  /* Порог «дешевой» провинции приходит из данных (lands_build.py считает его
     по нижней четверти цен). Зашивать сюда число нельзя: цены карты уже
     переезжали с 100-6000 на 12-600, и «дешевле 300 Ч» после такого переезда
     называло дешевыми три четверти мира. */
  function cheapEdge() {
    return (data && data.cheap_to) || 60;
  }

  /* ------------------------------------------------------------- отбор строк */

  function rows() {
    var all = (data && data.rows) || [];
    var nq = norm(q);
    var out = all.filter(function (r) {
      if (country && r.country !== country) return false;
      if (only === 'cheap' && r.price >= cheapEdge()) return false;
      if (only === 'sea' && !r.coast) return false;
      if (only === 'cap' && !r.capital) return false;
      if (only === 'free' && taken && taken[r.id]) return false;
      if (nq && norm(r.name).indexOf(nq) < 0 && norm(r.country).indexOf(nq) < 0) return false;
      return true;
    });
    if (sort === 'down') out = out.slice().reverse();  // файл уже отсортирован по цене
    return out;
  }

  /* ------------------------------------------------------------- отрисовка */

  function paintWait() {
    var why = (data && data.why) ||
      'Цены пересчитываются под свежую нарезку карты.';
    body.innerHTML =
      '<div class="empty"><h4>Таблица цен еще считается</h4>' +
      '<p>' + esc(why) + ' Правила выше уже окончательные: землю покупают ' +
      'один раз у государства и каждые сутки платят с нее налог. Полный ' +
      'список с ценой каждой земли появится здесь, как только карта отдаст ' +
      'пересчитанный прайс.</p></div>';
  }

  function bar() {
    var cs = (data.countries || []).slice(0, 80);
    var opts = '<option value="">Все державы</option>' + cs.map(function (c) {
      return '<option value="' + esc(c.name) + '"' +
        (country === c.name ? ' selected' : '') + '>' + esc(c.name) +
        ' · ' + c.n + '</option>';
    }).join('');

    var chips = [
      ['', 'все'],
      ['cheap', 'дешевле ' + money(cheapEdge()) + ' Ч'],
      ['sea', 'с выходом к морю'],
      ['cap', 'столицы']
    ];
    if (taken) chips.splice(1, 0, ['free', 'только свободные']);

    return '<div class="ln-bar">' +
      '<label class="search' + (q ? ' has' : '') + '">' +
      '<svg class="s-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="lnQ" type="search" placeholder="Провинция или держава" ' +
      'value="' + esc(q) + '">' +
      '<button type="button" class="s-clear" data-act="clear" aria-label="Очистить">✕</button>' +
      '</label>' +
      '<select id="lnC" aria-label="Держава">' + opts + '</select>' +
      '<select id="lnS" aria-label="Порядок">' +
      '<option value="up"' + (sort === 'up' ? ' selected' : '') + '>Сначала дешевые</option>' +
      '<option value="down"' + (sort === 'down' ? ' selected' : '') + '>Сначала дорогие</option>' +
      '</select></div>' +
      /* Выбранный отбор отличается только заливкой — читалке это не видно,
         поэтому рядом с классом «on» ставится aria-pressed. */
      '<div class="ln-chips" role="group" aria-label="Что показывать">' +
      chips.map(function (c) {
        var on = only === c[0];
        return '<button type="button" data-only="' + c[0] + '"' +
          (on ? ' class="on"' : '') + ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
          esc(c[1]) + '</button>';
      }).join('') + '</div>';
  }

  function head(list) {
    var d = data;
    var t = list.length + ' ' + plural(list.length, ['провинция', 'провинции', 'провинций']);
    if (list.length !== d.count) t += ' из ' + d.count;

    /* Разброс цен считаем по тому, что человек СЕЙЧАС видит, а не по всему
       файлу. Раньше строка всегда говорила «от 100 до 6 000 Ч, медиана 490» —
       и рядом со списком одних столиц, где каждая стоит 900, читалась как
       обещание найти среди них землю за сотню. */
    var p = list.map(function (r) { return r.price; }).sort(function (a, b) {
      return a - b;
    });
    var s;
    if (!p.length) s = '';
    else if (p[0] === p[p.length - 1]) s = 'все по ' + money(p[0]) + ' Ч';
    else {
      s = 'от ' + money(p[0]) + ' до ' + money(p[p.length - 1]) + ' Ч, медиана ' +
        money(p[p.length >> 1]) + ' Ч';
    }
    if (!taken) s += (s ? ' · ' : '') + 'занятость появится вместе с сервером';
    /* Возраст таблицы — не мелочь: нарезку мира правят чаще, чем пересчитывают
       прайс, и тогда цены в списке старше самой карты. Пусть это видно, а не
       выясняется уже на сервере. */
    var src = day(d.src_at);
    if (src) s += ' · цены посчитаны ' + src;

    /* Список из четырех с лишним сотен строк сам по себе выглядит полным, и
       никто не догадается, что часть земель в него не попала. Если сборка
       нашла провинции без ценника (lands_build.py сверяет прайс с живой
       нарезкой) — говорим это прямо, отдельной строкой. */
    var gap = '';
    if (d.no_price > 0) {
      gap = '<div class="ln-note">На карте ' + money(d.live) + ' ' +
        plural(d.live, ['провинция', 'провинции', 'провинций']) + ', и у ' +
        money(d.no_price) + ' из них ценника еще нет: карту перерезали позже, ' +
        'чем считали цены. Эти земли появятся в списке после пересчета — ' +
        'придумывать им цену сайт не станет.</div>';
    }
    return '<div class="ln-sum"><b>' + esc(t) + '</b> · ' + esc(s) + '</div>' + gap;
  }

  function line(r) {
    var sub = [esc(r.country)];
    if (r.capital) sub.push('столица');
    if (r.coast) sub.push('порт');
    if (r.chunks) sub.push(money(r.chunks) + ' ' +
      plural(r.chunks, ['чанк', 'чанка', 'чанков']));
    if (r.why) sub.push(esc(r.why));

    var st = '';
    if (taken) {
      var t = taken[r.id];
      st = t
        ? '<span class="pill' + (t.state === 'debt' ? ' red' : '') + '">' +
          (t.state === 'debt' ? 'недоимка' : 'занята') + '</span>'
        : '<span class="pill green">свободна</span>';
    }

    return '<div class="row r2"><div>' +
      '<div class="rw-t">' + esc(r.name) + (st ? ' ' + st : '') + '</div>' +
      '<div class="rw-s">' + sub.join(' · ') + '</div></div>' +
      '<div class="rw-r ln-r"><b>' + money(r.price) + ' Ч</b>' +
      '<span>налог ' + taxDay(r.price) + ' Ч в сутки</span></div></div>';
  }

  function paint() {
    if (!data || !data.ready || !(data.rows || []).length) return paintWait();

    var list = rows();
    var part = list.slice(0, shown);
    var body_ = part.length
      ? '<div class="row-list">' + part.map(line).join('') + '</div>' +
        (list.length > shown
          ? '<div class="ln-more"><button class="btn btn-dark" data-act="more">' +
            'Показать еще ' + Math.min(STEP, list.length - shown) + '</button></div>'
          : '')
      /* Числа берем из самого файла, а не из головы: и нарезку карты, и сам
         прайс переделывали уже не раз (1076 -> 1053 -> 507 -> 495 провинций,
         цены 100-6000 -> 10-600), а число в тексте такую правку переживает. */
      : '<div class="empty"><h4>Ничего не нашлось</h4><p>Попробуй другое название ' +
        'или сними фильтр — в списке ' + (data.count || 0) + ' ' +
        plural(data.count || 0, ['провинция', 'провинции', 'провинций']) +
        ', что-нибудь подходящее есть точно.</p></div>';

    body.innerHTML = bar() + head(list) + body_;
  }

  /* --------------------------------------------------------------- события */

  body.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.getAttribute('data-act') === 'more') {
      shown += STEP;
      paint();
      return;
    }
    if (b.getAttribute('data-act') === 'clear') {
      q = ''; shown = STEP; paint();
      var i = document.getElementById('lnQ');
      if (i) i.focus();
      return;
    }
    if (b.hasAttribute('data-only')) {
      only = b.getAttribute('data-only');
      shown = STEP;
      paint();
    }
  });

  /* Ищем по ходу набора, но перерисовываем не на каждую букву. */
  var timer = 0;
  body.addEventListener('input', function (e) {
    if (e.target.id !== 'lnQ') return;
    var v = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      q = v; shown = STEP; paint();
      var i = document.getElementById('lnQ');
      if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
    }, 180);
  });

  /* Enter в поиске: список и так обновляется по ходу набора, но нажатие ждут
     все — а оно ничего не делало. Дорисовываем сразу, не дожидаясь паузы, и
     уводим фокус: на телефоне клавиатура закрывает собой половину найденного. */
  body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.id !== 'lnQ') return;
    e.preventDefault();
    clearTimeout(timer);
    q = e.target.value; shown = STEP; paint();
    var i = document.getElementById('lnQ');
    if (i) i.blur();
  });

  body.addEventListener('change', function (e) {
    if (e.target.id === 'lnC') { country = e.target.value; shown = STEP; paint(); }
    if (e.target.id === 'lnS') { sort = e.target.value; shown = STEP; paint(); }
  });

  /* ----------------------------------------------------------------- пуск */

  A.local('data/lands.json').then(function (d) {
    data = d || {};
  }, function () {
    data = { ready: false, why: 'Файл с ценами сейчас недоступен.' };
  }).then(function () {
    /* Занятость — необязательный слой: нет службы или она молчит, значит
       показываем цены без пометок, а не пустую страницу. */
    if (!A.base()) return paint();
    return A.call('/lands/state').then(function (d) {
      taken = {};
      ((d && d.taken) || []).forEach(function (t) {
        taken[t.id] = { owner: t.owner || '', state: t.state || 'owned' };
      });
      paint();
    }, function () { paint(); });
  });
})();
