/* AEGIS SMP — витрина без ценников.

   Пока в js/config.js стоит shopClosed: true, лавка показывает все, что в ней
   есть — позиции, состав наборов, шансы кейсов, награды пропуска, — но не
   показывает, сколько это стоит, и никуда не ведет платить.

   Работа поделена на двоих:
     css/style.css (html.shop-closed) — прячет ценники, которые стоят прямо
       в разметке. Это делается стилем и до первой отрисовки, чтобы цифры
       не успели мигнуть на экране;
     этот файл — то, чего стилем не сделать: ценники, которые лавка рисует
       сама уже после загрузки (киты, кейсы, пропуск), рублевые хвосты внутри
       строк, которые нужны целиком, и кнопки, которые вели к оплате.

   Файл ничего не удаляет насовсем: он прячет, переподписывает и запоминает
   прежнюю подпись в data-shop-label. Снял флаг, перезагрузил — страница
   вернулась как была.

   Честно про предел: сами числа никуда не деваются из исходника страницы —
   они стоят в разметке и в data-атрибутах карточек, и тот, кто откроет код
   страницы, их увидит. Чтобы цен не было и там, их надо выносить из сайта
   в закрытый файл, а это уже переделка лавки, а не выключатель. */

'use strict';

(function () {
  if (!(window.AEGIS && AEGIS.shopClosed)) return;

  var LATER = 'цена позже';
  var LABEL = 'Пока не продается';
  var LINK  = 'Пока не оформляется';
  var RUB   = /₽/;

  /* Хвост «· 1,79 ₽ за червонец» и вообще все, что приписано к нужной строке
     через точку-разделитель, — режем по нему, оставляя саму строку. */
  function cutTail(el, sep) {
    var parts = el.textContent.split(sep);
    var keep = parts.filter(function (p) { return !RUB.test(p); });
    if (keep.length !== parts.length) el.textContent = keep.join(sep).trim();
  }

  /* В кнопке уровня кита цена лежит голым текстом рядом с римской цифрой
     в <b>: убираем текстовые узлы, оставляя разметку. */
  function dropMoneyText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && RUB.test(n.nodeValue)) n.nodeValue = '';
    }
  }

  function offButton(b) {
    if (b.textContent !== LABEL) {
      if (!b.hasAttribute('data-shop-label')) b.setAttribute('data-shop-label', b.textContent);
      b.textContent = LABEL;
    }
    b.classList.add('btn-off');
    if (b.tagName === 'BUTTON') b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
  }

  /* Ссылка кнопкой не выключается — у нее нет disabled. Снимаем адрес
     и убираем ее из обхода с клавиатуры, адрес кладем рядом. */
  function offLink(a) {
    if (a.hasAttribute('href')) {
      a.setAttribute('data-shop-href', a.getAttribute('href'));
      a.removeAttribute('href');
    }
    if (a.textContent !== LINK) {
      if (!a.hasAttribute('data-shop-label')) a.setAttribute('data-shop-label', a.textContent);
      a.textContent = LINK;
    }
    a.classList.add('btn-off');
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('tabindex', '-1');
  }

  function sweep() {
    /* 1. Ценник спрятан стилем — на его место встает короткая строка,
          чтобы карточка не выглядела сломанной. */
    document.querySelectorAll('.price:not([data-no-rub])').forEach(function (p) {
      var prev = p.previousElementSibling;
      if (prev && prev.classList.contains('price-off')) return;
      var off = document.createElement('div');
      off.className = 'price-off';
      off.textContent = LATER;
      p.parentNode.insertBefore(off, p);
    });

    /* 2. Строки, которые нужны целиком, а цена в них — приписка. */
    document.querySelectorAll('.g-sub').forEach(function (el) { cutTail(el, ' · '); });
    document.querySelectorAll('.kt-chip').forEach(dropMoneyText);

    /* Кнопка прокрутки кейса («Прокрутить ×3 — 447 ₽») здесь больше не
       трогается. Смотреть кейс можно, крутить нельзя — и подпись, и сам
       запрет живут в одном месте, в updateCaseFoot() из js/shop.js: он
       переписывает эту кнопку на каждом открытии карточки, и стирай мы
       цену еще и отсюда, два файла спорили бы за одну надпись. */

    /* Легенда пропуска: «Боевой ордер · 169 ₽ за круг». Линия остается,
       цена круга уходит. */
    document.querySelectorAll('.bp-lgd span').forEach(function (el) {
      if (RUB.test(el.textContent)) el.textContent = LATER;
    });

    /* 3. Все, что ведет к оплате. */
    document.querySelectorAll('[data-buy]').forEach(offButton);
    document.querySelectorAll('a[href*="#/punish"]').forEach(offLink);

    /* 4. Сетка безопасности: если лавка нарисовала ценник, которого здесь
          не ждали, он все равно не покажется. Берем только конечные узлы —
          те, внутри которых нет другой разметки, — иначе можно спрятать
          пол-страницы из-за одной цифры.

          Спрятанное окно кейса тоже проходим: его открывают снятием атрибута,
          а это не перерисовка — второго случая пройтись может и не быть. */
    document.querySelectorAll('body *').forEach(function (el) {
      if (el.children.length) return;
      var money = RUB.test(el.textContent);
      var off = el.hasAttribute('data-shop-off');
      if (money && !off) {
        el.setAttribute('data-shop-off', '1');
        el.style.display = 'none';
      } else if (off && !money) {
        /* Лавка перерисовала это место без цены — прятать больше нечего. */
        el.removeAttribute('data-shop-off');
        el.style.display = '';
      }
    });
  }

  /* Ждем обычным таймером, а НЕ requestAnimationFrame: кадров у скрытой
     вкладки нет, и на rAF уборка засыпает вместе с ней — флажок остается
     поднятым, а наблюдатель молча перестает срабатывать. */
  var timer = 0;
  var obs = new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      obs.disconnect();
      sweep();
      watch();
    }, 0);
  });

  function watch() {
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function start() {
    sweep();
    watch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
