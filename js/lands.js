/* AEGIS — витрина провинций («Земли»).

   Страница нужна человеку, который ещё НЕ на сервере: он должен понимать,
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
   Всё, чего в taken нет, считается свободным. */
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

  function plural(n, f) {
    n = Math.abs(Math.floor(n)) % 100;
    var d = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (d > 1 && d < 5) return f[1];
    if (d === 1) return f[0];
    return f[2];
  }

  /* Поиск без оглядки на регистр и на «ё». */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е');
  }

  /* ------------------------------------------------------------- отбор строк */

  function rows() {
    var all = (data && data.rows) || [];
    var nq = norm(q);
    var out = all.filter(function (r) {
      if (country && r.country !== country) return false;
      if (only === 'cheap' && r.price >= 300) return false;
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
      '<div class="empty"><h4>Таблица цен ещё считается</h4>' +
      '<p>' + esc(why) + ' Правила выше уже окончательные: минимальная ' +
      'провинция стоит 100 червонцев, налог — 3% от цены в неделю. Полный ' +
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
      ['cheap', 'дешевле 300 Ч'],
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
      '<button type="button" class="s-clear" data-act="clear" aria-label="Очистить">×</button>' +
      '</label>' +
      '<select id="lnC" aria-label="Держава">' + opts + '</select>' +
      '<select id="lnS" aria-label="Порядок">' +
      '<option value="up"' + (sort === 'up' ? ' selected' : '') + '>Сначала дешёвые</option>' +
      '<option value="down"' + (sort === 'down' ? ' selected' : '') + '>Сначала дорогие</option>' +
      '</select></div>' +
      '<div class="ln-chips">' + chips.map(function (c) {
        return '<button type="button" data-only="' + c[0] + '"' +
          (only === c[0] ? ' class="on"' : '') + '>' + esc(c[1]) + '</button>';
      }).join('') + '</div>';
  }

  function head(list) {
    var d = data;
    var t = list.length + ' ' + plural(list.length, ['провинция', 'провинции', 'провинций']);
    if (list.length !== d.count) t += ' из ' + d.count;
    var s = 'от ' + money(d.min) + ' до ' + money(d.max) + ' Ч, медиана ' +
      money(d.med) + ' Ч';
    if (!taken) s += ' · занятость появится вместе с сервером';
    return '<div class="ln-sum"><b>' + esc(t) + '</b> · ' + esc(s) + '</div>';
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
      '<span>налог ' + money(r.tax) + ' Ч в неделю</span></div></div>';
  }

  function paint() {
    if (!data || !data.ready || !(data.rows || []).length) return paintWait();

    var list = rows();
    var part = list.slice(0, shown);
    var body_ = part.length
      ? '<div class="row-list">' + part.map(line).join('') + '</div>' +
        (list.length > shown
          ? '<div class="ln-more"><button class="btn btn-dark" data-act="more">' +
            'Показать ещё ' + Math.min(STEP, list.length - shown) + '</button></div>'
          : '')
      /* Числа берём из самого файла, а не из головы: нарезку карты меняли уже
         дважды (1076 -> 487), и «больше тысячи» в тексте пережило бы правку. */
      : '<div class="empty"><h4>Ничего не нашлось</h4><p>Попробуй другое название ' +
        'или сними фильтр — всего провинций ' + (data.count || 0) +
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
