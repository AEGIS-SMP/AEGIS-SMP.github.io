/* AEGIS — один ценник у каждой позиции: живые деньги.

   Цена в лавке назначается в РУБЛЯХ, и другого ценника у товара нет.
   Червонцы отсюда убраны нарочно (16.09.2026): это валюта самого сервера,
   ее зарабатывают игрой и тратят в игре — на землю, налоги и торговлю, —
   а деньгами она не продается и в лавке не принимается.

   Задача этого файла осталась одна: подписать под рублевой ценой ту же
   сумму в валюте игрока. Играют не только из России, и строка «700 ₽»
   человеку из Алматы или Ташкента ничего не говорит.

   Три правила, из-за которых все сделано именно так:

   1. Курс НЕ выдумывается. Он берется из data/rates.json — туда его кладет
      site\tools\rates_build.py по официальному курсу ЦБ РФ, вместе с датой.
      Файла нет или он не догрузился — никакого пересчета не показываем,
      остается честная цена в рублях.
   2. Платеж все равно проходит в рублях. Это написано прямо у переключателя:
      пересчет справочный, банк посчитает по своему курсу.
   3. Автоопределение — только подсказка. Часовой пояс врет (VPN, чужой
      ноутбук, поездка), поэтому валюту всегда можно выбрать руками, и выбор
      запоминается.

   Наружу: window.AegisMoney — .alt(rub) дает строку «≈ 526 ₸» или пустую,
   .prices() дорисовывает строку в валюте игрока во все ценники на странице
   (звать после каждой перерисовки цены скриптом), событие 'aegis:currency'
   летит на document при смене валюты. */
(function () {
  'use strict';

  var KEY = 'aegis.currency';
  var items = [];        /* из data/rates.json */
  var extra = {};        /* доллары и евро: в списке выбора их нет, нужны оплате донатом */
  var date = '';
  var cur = 'RUB';       /* код текущей валюты; RUB = ничего не пересчитываем */

  /* Часовой пояс → валюта. Список короткий нарочно: тут только страны, откуда
     реально заходят и где ЦБ дает курс. Незнакомый пояс — рубли. */
  var TZ = {
    'Europe/Minsk': 'BYN',
    'Asia/Almaty': 'KZT', 'Asia/Aqtobe': 'KZT', 'Asia/Aqtau': 'KZT',
    'Asia/Atyrau': 'KZT', 'Asia/Oral': 'KZT', 'Asia/Qostanay': 'KZT',
    'Asia/Qyzylorda': 'KZT', 'Asia/Tashkent': 'UZS', 'Asia/Samarkand': 'UZS',
    'Asia/Bishkek': 'KGS', 'Asia/Dushanbe': 'TJS', 'Asia/Ashgabat': 'TMT',
    'Asia/Baku': 'AZN', 'Asia/Yerevan': 'AMD', 'Asia/Tbilisi': 'GEL',
    'Europe/Chisinau': 'MDL', 'Europe/Tiraspol': 'MDL',
    'Europe/Kyiv': 'UAH', 'Europe/Kiev': 'UAH', 'Europe/Uzhgorod': 'UAH',
    'Europe/Zaporozhye': 'UAH'
  };
  /* Запасной путь, если часового пояса нет: язык интерфейса. */
  var LANG = { 'be': 'BYN', 'kk': 'KZT', 'uz': 'UZS', 'ky': 'KGS',
    'tg': 'TJS', 'az': 'AZN', 'hy': 'AMD', 'ka': 'GEL', 'uk': 'UAH',
    'ro-md': 'MDL', 'mo': 'MDL' };

  function stored() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function remember(code) {
    try { localStorage.setItem(KEY, code); } catch (e) { /* приватный режим */ }
  }

  function guess() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (TZ[tz]) return TZ[tz];
    var l = (navigator.language || '').toLowerCase();
    if (LANG[l]) return LANG[l];
    l = l.split('-')[0];
    return LANG[l] || 'RUB';
  }

  function find(code) {
    for (var i = 0; i < items.length; i++) if (items[i].code === code) return items[i];
    return null;
  }

  /* Округляем по величине суммы: 3,55 Br — с копейками, 13 622 сум — целыми.
     Знак «≈» стоит не для красоты: курс дневной, банк посчитает свой. */
  function num(v) {
    if (v < 10) return v.toFixed(2).replace('.', ',');
    if (v < 100) return v.toFixed(1).replace('.', ',');
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function alt(rub) {
    var it = find(cur);
    var v = parseFloat(rub);
    if (!it || !isFinite(v) || v <= 0) return '';
    return '≈ ' + num(v * it.per) + ' ' + it.sign;
  }

  /* --- разметка --------------------------------------------------------- */

  /* Строка в валюте игрока под ценой. Ценники по всему сайту устроены
     одинаково — «<число> ₽» внутри .price, — поэтому число берем из самого
     ценника, а не из кнопки рядом: у кнопки кейса в data-rub лежит сумма
     за несколько прокруток, и подпись под ценой одного кейса тогда бы врала.

     Класс .pr-rub дорисовывается и удаляется целиком, так что звать
     prices() можно сколько угодно раз — дублей не будет. Выбраны рубли или
     курсы не догрузились — строки просто нет, цена и так рублевая. */
  function prices() {
    var boxes = document.querySelectorAll('.price');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var old = box.querySelector('.pr-rub');
      if (old) box.removeChild(old);
      if (box.hasAttribute('data-no-rub')) continue;

      var m = box.textContent.replace(/ /g, ' ').match(/(\d[\d ]*)\s*₽/);
      var r = m ? parseInt(m[1].replace(/\D/g, ''), 10) : 0;
      var a = r ? alt(r) : '';
      if (!a) continue;

      var s = document.createElement('span');
      s.className = 'pr-rub';
      s.appendChild(document.createTextNode(a));
      box.appendChild(s);
    }
  }

  function paint() {
    var nodes = document.querySelectorAll('[data-rub-alt]');
    for (var i = 0; i < nodes.length; i++) {
      var s = alt(nodes[i].getAttribute('data-rub-alt'));
      nodes[i].textContent = s;
      nodes[i].hidden = !s;
    }
    prices();
  }

  /* Свой список вместо системного <select>. Дело не в красоте: раскрытый
     список рисует не страница, а операционная система — на Windows он белый,
     чужим шрифтом и с чужими отступами, и посреди темной лавки выглядит как
     окно из другой программы. Свой список — та же посуда, что у всего сайта:
     знак валюты фишкой, страна строкой, код справа.

     Доступность при этом не теряется: и кнопка, и пункты — настоящие
     <button>, так что Tab, Enter и пробел работают сами; стрелки, Home/End
     и Esc дописаны руками, выбранный пункт помечен aria-selected, а связь
     кнопки со списком — через aria-expanded и role="listbox". */
  function pick() {
    var box = document.getElementById('curPick');
    if (!box || !items.length) return;

    /* Рубль — такая же строка списка, как остальные, просто первая:
       иначе «вернуть как было» пришлось бы искать глазами отдельно. */
    var all = [{ code: 'RUB', country: 'Россия', sign: '₽' }].concat(items);

    function row(it) {
      return '<span class="cur-sign">' + it.sign + '</span>' +
        '<span class="cur-name">' + it.country + '</span>' +
        '<span class="cur-code">' + it.code + '</span>';
    }

    var opts = '';
    for (var i = 0; i < all.length; i++) {
      opts += '<button type="button" class="cur-opt" role="option" ' +
        'data-code="' + all[i].code + '" aria-selected="false">' +
        row(all[i]) + '</button>';
    }

    box.innerHTML =
      '<span class="cur-lab" id="curLab">Показывать цены в валюте</span>' +
      '<div class="cur-box">' +
        '<button type="button" class="cur-btn" id="curBtn" ' +
          'aria-haspopup="listbox" aria-expanded="false" ' +
          'aria-labelledby="curLab curBtn"></button>' +
        '<div class="cur-menu" role="listbox" aria-labelledby="curLab" hidden>' +
          opts + '</div>' +
      '</div>' +
      '<span class="cur-note">Пересчет справочный, по курсу ЦБ РФ на ' +
      (date || '—') + '. Платеж все равно проходит <b>в рублях</b> — ' +
      'банк посчитает по своему курсу.</span>';
    box.hidden = false;

    var wrap = box.querySelector('.cur-box');
    var btn = box.querySelector('.cur-btn');
    var menu = box.querySelector('.cur-menu');
    var list = menu.querySelectorAll('.cur-opt');

    function byCode(code) {
      for (var i = 0; i < all.length; i++) if (all[i].code === code) return all[i];
      return all[0];
    }

    function show(code) {
      var it = byCode(code);
      btn.innerHTML = row(it) +
        '<svg class="cur-arr" viewBox="0 0 12 8" aria-hidden="true">' +
        '<path d="M1 1.6 6 6.4 11 1.6" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      for (var i = 0; i < list.length; i++) {
        var on = list[i].getAttribute('data-code') === it.code;
        list[i].classList.toggle('on', on);
        list[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }

    function roll(yes) {
      menu.hidden = !yes;
      wrap.classList.toggle('open', yes);
      btn.setAttribute('aria-expanded', yes ? 'true' : 'false');
      if (yes) (menu.querySelector('.cur-opt.on') || list[0]).focus();
    }

    function choose(code) {
      cur = code;
      remember(cur);
      show(cur);
      paint();
      document.dispatchEvent(new CustomEvent('aegis:currency', { detail: cur }));
    }

    btn.addEventListener('click', function () { roll(menu.hidden); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); roll(true); }
    });

    menu.addEventListener('click', function (e) {
      var o = e.target.closest ? e.target.closest('.cur-opt') : null;
      if (!o) return;
      choose(o.getAttribute('data-code'));
      roll(false);
      btn.focus();
    });

    /* Стрелками ходим по пунктам, Esc возвращает к кнопке. Tab из списка
       просто закрывает его: уводить фокус дальше по странице — дело браузера,
       а висящий поверх раскрытый список выглядел бы забытым. */
    menu.addEventListener('keydown', function (e) {
      var i = Array.prototype.indexOf.call(list, document.activeElement);
      if (e.key === 'Escape') { roll(false); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, i + 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, i - 1)].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === 'Tab') { roll(false); }
    });

    /* Нажали мимо — закрываем. Слушаем весь документ, потому что «мимо» это
       и шапка, и любая карточка лавки. */
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !wrap.contains(e.target)) roll(false);
    });

    show(find(cur) ? cur : 'RUB');
  }

  window.AegisMoney = {
    alt: alt,
    prices: prices,
    code: function () { return cur; },
    date: function () { return date; },
    /* сколько единиц валюты за рубль по тому же курсу ЦБ; нет курса — 0 */
    per: function (code) {
      var it = find(code);
      return it ? it.per : Number(extra[code]) || 0;
    }
  };

  /* Файл курсов лежит рядом с остальными данными сайта; читаем тем же
     помощником, что и все прочее, чтобы работало и с file:// у овнера. */
  function boot(d) {
    if (!d || !d.items || !d.items.length) return;
    items = d.items;
    extra = d.extra || {};
    date = d.date || '';
    var saved = stored();
    cur = (saved && (saved === 'RUB' || find(saved))) ? saved : guess();
    if (cur !== 'RUB' && !find(cur)) cur = 'RUB';
    pick();
    paint();
    /* Курсы приходят файлом, то есть позже разметки: к этому моменту скрипты
       страницы уже нарисовали свои подписи с суммами и про валюту игрока еще
       не знали (в разделе «Поддержать» так пропадал минимум «≈ 136 сум»).
       Тем же событием, что и при ручной смене валюты, говорим им перерисоваться. */
    document.dispatchEvent(new CustomEvent('aegis:currency', { detail: cur }));
  }

  function start() {
    /* Без курсов ЦБ подписывать нечего: рублевая цена уже стоит
       в разметке. Валюта игрока появится, когда придет rates.json; не придет —
       страница останется честно рублевой. */
    if (!window.AegisApi) return;
    AegisApi.local('data/rates.json').then(boot, function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
