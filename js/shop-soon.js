/* AEGIS SMP — продается только то, что уже выдается в игре.

   Слово овнера 18.09.2026: «что не реализовано, то не должно продаваться
   пока». Касса (shop.py) отказывает во всем, чего нет в ее списке sell_kinds,
   и отдает этот список по GET /shop/open → {ok, kinds:[…]}. Этот файл
   приводит витрину к тому же списку: на всем остальном вместо кнопки покупки
   стоит «Откроется позже», позиции и цены остаются видны.

   Поддержка проекта продается всегда — ей нечего выдавать в игре.
   Ручка не ответила — считаем, что продаются только червонцы: лучше лишний
   раз закрыть, чем принять деньги за то, что не выдается.

   Вид позиции сайт берет из раздела страницы, а не из названия: названия
   правятся, разделы — нет. Незнакомый раздел = закрыто. Чтобы открыть вид,
   на сайте ничего менять не надо — его добавляют в sell_kinds кассы. */

'use strict';

(function () {
  if (window.AEGIS && AEGIS.shopClosed) return;   // тогда все закрывает shop-closed.js

  var LABEL = 'Откроется позже';
  var LINK  = 'Откроется позже';

  var BY_SECTION = {
    coins: 'coins', ranks: 'rank', premium: 'premium', pass: 'item',
    cases: 'case', kits: 'kit', mod: 'item', bags: 'item', goods: 'item',
    bundles: 'item'
  };
  var NAMES = {
    coins: 'червонцы', rank: 'привилегии', premium: 'Мандат Ставки',
    item: 'арсенал, ранцы, предметы, комбо', boost: 'ускорения', kit: 'киты', case: 'кейсы'
  };
  /* Порядок в строке «Сейчас продаются…» — как разделы на странице, а не как ответ службы. */
  var ORDER = ['rank', 'premium', 'kit', 'case', 'item', 'coins', 'boost'];

  var kinds = ['coins'];

  function kindOf(b) {
    if (b.hasAttribute('data-support')) return 'support';
    if (b.id === 'cmBuy') return 'case';
    if (b.id === 'kmBuy') return 'kit';
    if (/^Ускорение сервера/.test(b.getAttribute('data-buy') || '')) return 'boost';
    var sec = b.closest('section[id]');
    return sec ? BY_SECTION[sec.id] || '' : '';
  }

  function sells(b) {
    /* data-later — позиция, которую мод еще не выдает, хотя ее вид уже продается
       (префикс, накидка, пропуск, кейс с косметикой). Касса откажет по тому же флагу. */
    if (b.hasAttribute('data-later')) return false;
    var k = kindOf(b);
    return k === 'support' || kinds.indexOf(k) >= 0;
  }

  function off(b) {
    if (!b.hasAttribute('data-soon')) {
      b.setAttribute('data-soon', '1');
      b.setAttribute('data-soon-label', b.textContent);
    }
    /* На узких кнопках длинная подпись не влезает в строку на телефоне. */
    var label = b.classList.contains('btn-sm') ? 'Позже' : LABEL;
    if (b.textContent !== label) b.textContent = label;
    if (!b.classList.contains('btn-off')) b.classList.add('btn-off');
    if (b.tagName === 'BUTTON' && !b.disabled) b.disabled = true;
    if (b.getAttribute('aria-disabled') !== 'true') b.setAttribute('aria-disabled', 'true');
  }

  function on(b) {
    if (!b.hasAttribute('data-soon')) return;
    b.textContent = b.getAttribute('data-soon-label');
    b.removeAttribute('data-soon');
    b.removeAttribute('data-soon-label');
    b.classList.remove('btn-off');
    if (b.tagName === 'BUTTON') b.disabled = false;
    b.removeAttribute('aria-disabled');
  }

  /* Амнистия оформляется в кабинете, а оплаты там пока нет вовсе. */
  function offLink(a) {
    if (!a.hasAttribute('data-soon-href')) {
      a.setAttribute('data-soon-href', a.getAttribute('href'));
      a.setAttribute('data-soon-label', a.textContent);
    }
    if (a.hasAttribute('href')) a.removeAttribute('href');
    if (a.textContent !== LINK) a.textContent = LINK;
    if (!a.classList.contains('btn-off')) a.classList.add('btn-off');
    if (a.getAttribute('aria-disabled') !== 'true') a.setAttribute('aria-disabled', 'true');
    if (a.getAttribute('tabindex') !== '-1') a.setAttribute('tabindex', '-1');
  }

  function note() {
    var box = document.querySelector('.notice');
    if (!box) return;
    var el = document.getElementById('shopSoon');
    if (!el) {
      el = document.createElement('span');
      el.id = 'shopSoon';
      el.className = 'shop-soon';
      box.appendChild(el);
    }
    var list = ORDER.filter(function (k) { return kinds.indexOf(k) >= 0; })
      .map(function (k) { return NAMES[k]; });
    var html = '<b>Сейчас продаются ' + (list.length ? list.join(', ') + ' и ' : '') +
      'поддержка проекта.</b> Остальное откроется позже — выдачу в игре еще доделываем.';
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function sweep() {
    document.querySelectorAll('[data-buy]').forEach(function (b) {
      if (sells(b)) on(b); else off(b);
    });
    document.querySelectorAll('a[href*="#/punish"], a[data-soon-href]').forEach(offLink);
    /* «Прокрутить» в окне кейса — пробная прокрутка, денег не берет, но с ценой
       в подписи читается как покупка. Пока кейсы не продаются — без цены. */
    var sp = document.getElementById('cmSpin');
    if (sp && kinds.indexOf('case') < 0 && /₽/.test(sp.textContent)) {
      sp.textContent = sp.textContent.replace(/\s*—\s*[\d\s ]+₽/, '');
    }
    note();
  }

  var timer = 0;
  function later() {
    if (!timer) timer = setTimeout(function () { timer = 0; sweep(); }, 60);
  }

  function start() {
    sweep();
    /* Лавка переписывает кнопки сама (подвал кейса, окно кита) — снимаем
       заново после каждой ее правки. */
    new MutationObserver(later).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'data-later']
    });
    var api = (window.AEGIS && AEGIS.api) || '';
    if (!api || !window.fetch) return;
    fetch(api + '/shop/open', { credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && Array.isArray(j.kinds)) { kinds = j.kinds.map(String); sweep(); }
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
