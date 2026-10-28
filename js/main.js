/* AEGIS SMP — общий скрипт сайта */

/* Адрес без .html (24.10.2026). Файлы прежние, GitHub Pages отдает /wiki как
   wiki.html, поэтому старые ссылки из бота, Discord и закладок работают — а в
   строке адреса после загрузки остается короткий вид. Якорь и запрос не трогаем. */
if (/\.html$/.test(location.pathname) && history.replaceState) {
  const p = location.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  try { history.replaceState(history.state, '', p + location.search + location.hash); } catch (e) {}
}

/* Страница приема переводов. Сам адрес лежит в js/config.js вместе со всеми
   остальными адресами проекта: переезд на арендный хостинг должен быть
   правкой одного файла, а не поиском ссылок по сайту. */
const DONATE_URL = (window.AEGIS && window.AEGIS.donate) || '';

/* Сайт выложен публично РАНЬШЕ, чем открыт прием платежей, поэтому кнопку
   «Перейти к оплате» нельзя пускать на недописанный адрес: живая страница
   с ведущей в никуда кнопкой оплаты хуже честной строки «еще не открыто».
   Появится настоящий адрес — кнопка включится сама.
   Признак недописанного — кириллица внутри ссылки: у настоящей ее не бывает. */
const DONATE_READY = /^https:\/\/[\w.-]+\//.test(DONATE_URL) && !/[А-Яа-яЁё]/.test(DONATE_URL);

/* Дата открытия сезона — ЕДИНСТВЕННОЕ место на сайте, где она записана числом.
   17.09.2026 овнер закрыл вилку «12 или 19»: сезон открывается 19 сентября
   2026 года в 15:00 МСК. Все остальное на сайте — отсчет на главной, подписи,
   ответы вики — считается от этой строки или повторяет ее словами.
   Часовой пояс задан явно (+03:00), иначе у игрока из другого пояса отсчет
   показывал бы свое время открытия, а открытие одно на всех.

   18.10.2026: первый вайп сезона «1936» закончился 17 октября, игровой
   сервер выключен. 19.10.2026: новый сезон — карта Европы, ориентировочно
   30 октября — 18 декабря (SEASON_START ниже), точного часа пока нет.
   null — значит вместо табло на главной стоит панель «примерно N дней»,
   а темы обращений не ждут никакого числа. Назовут час — вписать его сюда
   так: new Date('ГГГГ-ММ-ДДTЧЧ:ММ:00+03:00'), — и табло вернется само. */
const OPEN_DATE = null;

/* режим съемки макета (?shot=1) — только для рендера превью */
if (new URLSearchParams(location.search).has('shot')) {
  document.documentElement.classList.add('shotmode');
}

/* --- бургер-меню ---
   Кнопка молча переключала класс: снаружи никак не узнать, открыто меню или
   нет, — ни читалке (нет aria-expanded), ни тому, кто промахнулся мимо пункта
   (меню оставалось висеть). Держим состояние в одном месте: класс, словесная
   пометка, Esc и щелчок мимо. Esc возвращает фокус на кнопку — иначе он
   остается на исчезнувшем пункте и следующий Tab начинает страницу сначала. */
const burger = document.querySelector('.burger');
const topnav = document.getElementById('topnav');
if (burger && topnav) {
  const bar = document.querySelector('.topbar');
  const setNav = open => {
    topnav.classList.toggle('open', open);
    /* Прозрачная шапка над первым экраном главной залита, пока меню открыто
       (для браузеров без :has — css/style.css). */
    if (bar) bar.classList.toggle('nav-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  burger.addEventListener('click', () => setNav(!topnav.classList.contains('open')));
  topnav.addEventListener('click', e => {
    if (e.target.closest('a')) setNav(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !topnav.classList.contains('open')) return;
    setNav(false);
    burger.focus();
  });
  /* Щелчок мимо меню закрывает его — но только если он пришелся вне шапки:
     иначе нажатие на саму кнопку сначала закроет меню здесь, а потом ее
     собственный обработчик откроет обратно. */
  document.addEventListener('click', e => {
    if (!topnav.classList.contains('open')) return;
    if (e.target.closest('.topnav') || e.target.closest('.burger')) return;
    setNav(false);
  });
}

/* --- обратный отсчет на главной ---

   Раньше до открытия оставалась одна строчка в плашке («12 дней 4 ч»), и
   обновлялась она раз в полминуты. Овнер попросил крупные цифры с днями,
   часами, минутами и секундами — и чтобы они красиво шли.

   Как это устроено. Разметка в index.html пустая: все, что ниже, строит
   ячейки само. Причина не в красоте кода — число в разметке рано или поздно
   разошлось бы с настоящей датой, а так его там просто нет.

   Каждая цифра живет в своей клетке с двумя слоями: текущий и следующий.
   Когда цифра меняется, текущий уезжает вверх, следующий приходит снизу —
   отсюда ощущение табло, а не прыгающего текста. Меняется при этом одна
   клетка, а не все число: 59 → 00 крутит обе, 58 → 59 только правую.

   Секунда считается не «плюс один тик», а от самой даты: вкладка в фоне
   тормозит таймеры, и счетчик, который складывает секунды сам, за ночь
   отстает на минуты. Здесь же каждый тик — это разность с OPEN_DATE, а
   возвращение на вкладку сразу пересчитывает ее заново. */
const cdEl = document.getElementById('cdown');

/* Сроки нового сезона (овнер, 19.10.2026): ориентировочно 30 октября —
   18 декабря. Это не дата открытия: точного часа нет, табло по ним не
   строится. По ним живут панель ниже и таймлайн сезона на главной. */
const SEASON_START = new Date('2026-10-30T00:00:00+03:00');
const SEASON_END = new Date('2026-12-18T00:00:00+03:00');

/* Точного часа нет — отсчитывать по секундам нечего: нули на табло читались
   бы как поломка. Вместо табло одна панель: сколько примерно дней осталось,
   сроки сезона и куда смотреть за точным часом. */
if (cdEl && !OPEN_DATE) {
  const tg = 'https://t.me/aegis_smp';
  const ds = (window.AEGIS && window.AEGIS.discord) || '';
  const days = Math.ceil((SEASON_START - Date.now()) / 864e5);
  const word = n => {
    const a = n % 100, b = n % 10;
    return a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b > 1 && b < 5 ? 'дня' : 'дней';
  };
  cdEl.removeAttribute('role');
  cdEl.innerHTML =
    '<div class="ss">' +
      '<div class="ss-big">' + (days > 0
        ? '<b>~' + days + '</b><span>' + word(days) + ' до старта<br><i>ориентировочно</i></span>'
        : '<b>Скоро</b><span>старт нового сезона<br><i>точный час объявим</i></span>') +
      '</div>' +
      '<div class="ss-meta">' +
        '<div class="ss-dates">Новый сезон: <b>~30 октября — 18 декабря</b></div>' +
        '<p>Точный час старта объявим в ' +
          (ds ? '<a href="' + ds + '" target="_blank" rel="noopener">Discord</a>' : 'Discord') +
          ' и <a href="' + tg + '" target="_blank" rel="noopener">Telegram</a>. ' +
          'Пока сервера нет, лаунчер запускает сборку в одиночном мире.</p>' +
      '</div>' +
    '</div>';
}

if (cdEl && OPEN_DATE) {
  const decl = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  /* Бережем тех, кому от движения плохо: системная настройка «меньше
     анимации» выключает и прокрутку цифр, и появление ячеек. */
  const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const UNITS = [
    ['d', ['день', 'дня', 'дней']],
    ['h', ['час', 'часа', 'часов']],
    ['m', ['минута', 'минуты', 'минут']],
    ['s', ['секунда', 'секунды', 'секунд']]
  ];

  /* Табло целиком спрятано от читалок: диктовать «5 8 3 2» посекундно нельзя.
     Вместо него читалка получает одну живую строку словами (.cd-say) — ее
     обновляем раз в минуту, а не каждую секунду. */
  const row = document.createElement('div');
  row.className = 'cd-row';
  row.setAttribute('aria-hidden', 'true');
  const say = document.createElement('div');
  say.className = 'cd-say';
  const open = document.createElement('div');
  open.className = 'cd-open';
  open.textContent = 'Сезон открыт';

  const cells = {};
  UNITS.forEach(([k, words], i) => {
    const cell = document.createElement('div');
    cell.className = 'cd-cell';
    cell.style.setProperty('--i', i);          /* задержка появления по очереди */
    cell.innerHTML = '<div class="cd-num"></div><div class="cd-lbl"></div>';
    row.appendChild(cell);
    cells[k] = { cell: cell, num: cell.firstChild, lbl: cell.lastChild, words: words };
  });
  cdEl.appendChild(row);
  cdEl.appendChild(open);
  cdEl.appendChild(say);

  /* Клеток ровно столько, сколько цифр в числе (у дней их может стать три). */
  const fit = (num, n) => {
    while (num.children.length < n) {
      const s = document.createElement('span');
      s.className = 'cd-slot';
      s.innerHTML = '<b class="cd-cur"></b><b class="cd-nxt"></b>';
      num.appendChild(s);
    }
    while (num.children.length > n) num.removeChild(num.lastChild);
  };

  const put = (slot, ch) => {
    const cur = slot.firstChild, nxt = slot.lastChild;
    if (cur.textContent === ch) return false;
    /* Первый показ и «спокойный режим» — без прокрутки: крутить цифру из
       пустоты незачем, это выглядит как сбой, а не как ход табло. */
    if (CALM || cur.textContent === '') { cur.textContent = ch; return true; }
    nxt.textContent = ch;
    slot.classList.remove('roll');
    void slot.offsetWidth;                     /* перезапуск анимации */
    slot.classList.add('roll');
    return true;
  };

  /* Доехала верхняя цифра — новая становится текущей. Если бы мы вместо этого
     ждали по таймеру, вкладка в фоне оставила бы клетку в середине хода. */
  row.addEventListener('animationend', e => {
    if (e.animationName !== 'cd-in') return;
    const slot = e.target.parentNode;
    slot.firstChild.textContent = slot.lastChild.textContent;
    slot.classList.remove('roll');
  });

  let lastMin = -1;
  const tick = () => {
    let ms = OPEN_DATE - Date.now();
    const over = ms <= 0;
    if (over) ms = 0;
    const v = {
      d: Math.floor(ms / 864e5),
      h: Math.floor(ms % 864e5 / 36e5),
      m: Math.floor(ms % 36e5 / 6e4),
      s: Math.floor(ms % 6e4 / 1e3)
    };
    UNITS.forEach(([k]) => {
      const c = cells[k], t = String(v[k]).padStart(2, '0');
      fit(c.num, t.length);
      let moved = false;
      for (let i = 0; i < t.length; i++) moved = put(c.num.children[i], t[i]) || moved;
      /* Смена минуты, часа, дня — событие; секунды идут сами по себе, и
         подсвечивать каждую было бы мельтешением. По верхней кромке ячейки
         один раз проходит светлая искра. */
      if (moved && k !== 's' && !CALM) {
        c.cell.classList.remove('bump');
        void c.cell.offsetWidth;
        c.cell.classList.add('bump');
      }
      const w = decl(v[k], c.words[0], c.words[1], c.words[2]);
      if (c.lbl.textContent !== w) c.lbl.textContent = w;
    });
    cdEl.classList.toggle('is-open', over);
    if (over) {
      say.textContent = 'Сезон открыт.';
    } else if (v.m !== lastMin) {
      lastMin = v.m;
      say.textContent = 'До открытия сезона: ' +
        v.d + ' ' + decl(v.d, 'день', 'дня', 'дней') + ', ' +
        v.h + ' ' + decl(v.h, 'час', 'часа', 'часов') + ', ' +
        v.m + ' ' + decl(v.m, 'минута', 'минуты', 'минут') + '.';
    }
  };

  /* Шаг привязан к границе секунды, а не «через 1000 мс»: иначе цифры
     переключаются на четверть секунды позже настоящего времени, и рядом
     с часами на экране это заметно. */
  const loop = () => {
    tick();
    setTimeout(loop, 1000 - Date.now() % 1000);
  };
  loop();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

/* --- размер мира: числа из data/world.json ---

   Нарезку мира меняли уже трижды (1076 -> 1053 -> 495 провинций), и каждый
   раз числа на сайте оставались старыми, потому что лежали прямо в тексте.
   Теперь они живут в data/world.json (его собирает site\tools\world_build.py
   из данных карты), а в разметке остается последнее известное значение —
   оно и показывается, если файл не догрузился.

   data-world="countries"                       — подставить число
   data-plural="countries|форма1|форма2|форма5" — согласовать слово с числом
   data-count                                   — набежать от нуля при показе */
{
  const forms = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  /* Разряды отбиваем только с пяти знаков: 638 978 без пробела не читается,
     а масштаб 1:1000 с пробелом превращается в 1:1 000. */
  const spaced = n => n < 10000
    ? String(n)
    : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /* Плавный счет от нуля. Число дорисовывается ровно до целевого — на
     последнем кадре присваиваем его напрямую, чтобы округление не оставило
     «494» вместо «495». */
  const runUp = (el, to) => {
    const t0 = performance.now(), ms = 900;
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? spaced(Math.round(to * eased)) : spaced(to);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('shotmode');

  const apply = w => {
    document.querySelectorAll('[data-world]').forEach(el => {
      const v = w[el.getAttribute('data-world')];
      if (typeof v !== 'number') return;
      if (!el.hasAttribute('data-count') || still) { el.textContent = spaced(v); return; }
      /* Считаем только когда полосу видно: иначе анимация проходит впустую,
         пока человек еще листает шапку. */
      el.textContent = '0';
      const once = new IntersectionObserver(es => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          once.disconnect();
          runUp(el, v);
        }
      }, { threshold: .4 });
      once.observe(el);
    });
    document.querySelectorAll('[data-plural]').forEach(el => {
      const p = el.getAttribute('data-plural').split('|');
      const v = w[p[0]];
      if (typeof v === 'number' && p.length === 4) el.textContent = forms(v, p[1], p[2], p[3]);
    });
  };

  if (document.querySelector('[data-world]') && window.AegisApi) {
    window.AegisApi.local('data/world.json').then(d => { if (d) apply(d); }, () => {});
  }
}

/* «Меньше движения» и режим съемки: без автосмены вкладок и без набегания. */
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.classList.contains('shotmode');

/* --- арсенал на главной: вкладки ---
   В разметке шесть обычных карточек (без JS — сетка). Здесь из них же
   строим список слева (иконка + заголовок) и показываем по одной карточке.
   Пока человек ничего не выбрал, вкладки сменяются сами: полоса под
   активной вкладкой — это и есть таймер, по ее концу (animationend)
   включается следующая. Мышь над блоком или фокус внутри — пауза; блок
   ушел с экрана — тоже пауза. Выбрал сам — автосмена выключается насовсем.
   Клавиатура — как у обычных вкладок: стрелки, Home, End. */
{
  const ars = document.querySelector('[data-ars]');
  const box = ars && ars.querySelector('.ars-panels');
  const cards = box ? [...box.children].filter(c => c.classList.contains('card')) : [];
  if (cards.length > 1) {
    const two = n => String(n).padStart(2, '0');
    const list = document.createElement('div');
    list.className = 'ars-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Механики мода AegisLive');
    const tabs = cards.map((card, i) => {
      const id = 'ars-tab-' + (i + 1);
      const h = card.querySelector('h3');
      const icon = card.querySelector('.icon-plate img');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ars-tab';
      b.id = id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', id + '-p');
      if (icon) {
        const im = icon.cloneNode(false);
        im.alt = '';
        b.appendChild(im);
      }
      const t = document.createElement('span');
      t.textContent = h ? h.textContent : 'Механика ' + (i + 1);
      b.appendChild(t);
      const barEl = document.createElement('i');
      barEl.className = 'ars-bar';
      barEl.setAttribute('aria-hidden', 'true');
      b.appendChild(barEl);
      list.appendChild(b);

      card.id = id + '-p';
      card.setAttribute('role', 'tabpanel');
      card.setAttribute('aria-labelledby', id);
      /* Появляется весь блок разом, а не каждая карточка: скрытые
         карточки лежат стопкой в одной клетке сетки. */
      card.classList.remove('reveal');
      const n = document.createElement('div');
      n.className = 'ars-n';
      n.setAttribute('aria-hidden', 'true');
      n.innerHTML = '<b>' + two(i + 1) + '</b> / ' + two(cards.length);
      card.appendChild(n);
      return b;
    });

    let cur = 0;
    const select = (i, focus) => {
      cur = (i + tabs.length) % tabs.length;
      tabs.forEach((b, k) => {
        const on = k === cur;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        cards[k].classList.toggle('is-on', on);
      });
      if (focus) tabs[cur].focus();
    };
    const stopAuto = () => ars.classList.remove('is-auto');

    list.addEventListener('click', e => {
      const b = e.target.closest('.ars-tab');
      if (!b) return;
      stopAuto();
      select(tabs.indexOf(b));
    });
    list.addEventListener('keydown', e => {
      const k = e.key;
      // от вкладки под фокусом, а не от выбранной: автосмена могла уйти вперед
      const at = tabs.indexOf(e.target.closest('.ars-tab'));
      const from = at < 0 ? cur : at;
      let to = null;
      if (k === 'ArrowDown' || k === 'ArrowRight') to = from + 1;
      else if (k === 'ArrowUp' || k === 'ArrowLeft') to = from - 1;
      else if (k === 'Home') to = 0;
      else if (k === 'End') to = tabs.length - 1;
      if (to === null) return;
      e.preventDefault();
      stopAuto();
      select(to, true);
    });
    list.addEventListener('animationend', e => {
      if (e.animationName !== 'ars-bar' || !ars.classList.contains('is-auto')) return;
      select(cur + 1);
    });
    ars.addEventListener('focusin', () => ars.classList.add('is-paused'));
    ars.addEventListener('focusout', e => {
      if (!ars.contains(e.relatedTarget)) ars.classList.remove('is-paused');
    });
    if (window.IntersectionObserver) {
      new IntersectionObserver(es => {
        for (const e of es) ars.classList.toggle('is-off', !e.isIntersecting);
      }).observe(ars);
    }

    ars.insertBefore(list, box);
    ars.classList.add('js-tabs', 'reveal');
    select(0);
    if (!STILL) ars.classList.add('is-auto');
  }
}

/* --- оферта: какой раздел сейчас читают --- */
/* Ссылка оглавления текущего раздела подсвечивается. Текущий — последний,
   чей верх уже ушел выше линии чуть ниже шапки; у самого низа — последний. */
{
  const toc = document.querySelectorAll('.offer-toc a[href^="#"]');
  const secs = [...toc].map(a => document.getElementById(a.getAttribute('href').slice(1)));
  if (toc.length && secs.every(Boolean)) {
    let on = -1, raf = 0;
    const spy = () => {
      raf = 0;
      let i = 0;
      secs.forEach((s, k) => { if (s.getBoundingClientRect().top < 140) i = k; });
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) i = secs.length - 1;
      if (i === on) return;
      if (on >= 0) toc[on].classList.remove('on');
      toc[i].classList.add('on');
      on = i;
    };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
    spy();
  }
}

/* --- появление блоков при скролле --- */
/* Блок с классом reveal прозрачен, пока к нему не добавят «in». Если
   наблюдателя в браузере нет, конструктор бросает ошибку — и на ней умирал бы
   весь main.js: вместе с анимацией отвалились бы меню-бутерброд и остальное, а
   страница осталась бы пустой. Поэтому запасной путь — показать все сразу. */
let io;
try {
  io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: .12 });
} catch (_) {
  io = { observe: el => el.classList.add('in'), unobserve: () => {} };
}
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* Карточки, нарисованные скриптом (киты в лавке), появляются уже после этого
   обхода — наблюдатель о них не знает и они остались бы прозрачными навсегда.
   shop.js зовет этот хук на каждый новый блок. */
window.aegisReveal = el => io.observe(el);

/* --- таймлайн сезона на главной: что пройдено, что идет сейчас ---
   В разметке состояние на день сборки (перерыв). Пункт «Перерыв» кончается
   стартом; старт — OPEN_DATE, если час уже назван, иначе ориентировочная
   SEASON_START. После финала пройдены все пункты. */
{
  const items = [...document.querySelectorAll('.tl li')];
  if (items.length === 4) {
    const now = Date.now();
    const start = OPEN_DATE || SEASON_START;
    const stage = now < start ? 1 : now < SEASON_END ? 2 : 4;
    items.forEach((li, i) => {
      li.classList.toggle('is-done', i < stage);
      li.classList.toggle('is-now', i === stage);
    });
    if (stage > 1) items[1].querySelector('.tl-d').textContent = 'Октябрь';
    if (OPEN_DATE) {
      const p = n => String(n).padStart(2, '0');
      /* Дата и час — по Москве, как объявляем, а не по часам игрока. */
      const msk = new Date(OPEN_DATE.getTime() + 3 * 3600e3);
      items[2].querySelector('.tl-d').textContent = p(msk.getUTCDate()) + '.' + p(msk.getUTCMonth() + 1);
      items[2].querySelector('.tl-t').textContent =
        'В ' + p(msk.getUTCHours()) + ':' + p(msk.getUTCMinutes()) + ' по Москве.';
    }
  }
}

/* --- прокрутка: шапка, рельс разделов, шаги «Как зайти» ---
   Все считается раз в кадр, а не на каждое событие прокрутки.
   - Полоса прочитанного по кромке шапки (--sp, css/style.css) — на всех страницах.
   - Главная: над первым экраном шапка прозрачная (.is-top), пункты меню и
     точки рельса слева подсвечивают раздел, который сейчас на экране,
     рельс появляется, когда первый экран ушел вверх.
   - «Как зайти»: рельс шагов заполняется до середины экрана (--jp), точки
     пройденных шагов загораются (.passed). */
{
  const bar = document.querySelector('.topbar');
  const hero = document.querySelector('.hero-map');
  const rail = document.querySelector('.rail');
  const spyLinks = [...document.querySelectorAll('.topnav a[href^="#"], .rail a[href^="#"]')];
  const spyIds = [...new Set(spyLinks.map(a => a.hash.slice(1)))];
  /* В порядке страницы, а не ссылок: в шапке «Карта» (#archive) стоит раньше,
     чем «Новости» в рельсе, и без сортировки на архиве горели бы новости. */
  const spySecs = spyIds.map(id => document.getElementById(id)).filter(Boolean)
    .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const jSteps = document.querySelector('.join-steps');
  const jItems = jSteps ? [...jSteps.querySelectorAll('.step')] : [];
  const root = document.documentElement;

  let curId = null;
  const update = () => {
    const y = scrollY, vh = innerHeight;
    const max = root.scrollHeight - vh;
    if (bar) bar.style.setProperty('--sp', max > 0 ? Math.min(1, Math.max(0, y / max)).toFixed(4) : '0');
    if (bar && hero) bar.classList.toggle('is-top', y < 8);
    if (rail && hero) rail.classList.toggle('on', hero.getBoundingClientRect().bottom < vh * .4);

    if (spySecs.length) {
      let id = null;
      for (const s of spySecs) if (s.getBoundingClientRect().top < vh * .35) id = s.id;
      /* Долистали до самого низа — последний раздел, даже если его верх
         не дошел до отметки. */
      if (max > 0 && y >= max - 2 && spySecs[spySecs.length - 1].getBoundingClientRect().top < vh) {
        id = spySecs[spySecs.length - 1].id;
      }
      if (id !== curId) {
        curId = id;
        spyLinks.forEach(a => {
          const on = a.hash === '#' + id;
          a.classList.toggle('active', on);
          if (on) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
      }
    }

    if (jSteps && jItems.length) {
      const r = jSteps.getBoundingClientRect();
      const line = vh * .55;
      const len = r.height - 68;
      const k = len > 0 ? Math.min(1, Math.max(0, (line - r.top - 34) / len)) : 0;
      jSteps.style.setProperty('--jp', k.toFixed(4));
      jItems.forEach(s => s.classList.toggle('passed', s.getBoundingClientRect().top + 42 <= line));
    }
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; update(); });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  /* Высота страницы растет после загрузки (новости, картинки) — полоса
     прочитанного должна пересчитаться и без прокрутки. */
  addEventListener('load', onScroll);
  update();
}

/* --- фонарик на карточках ---
   Под мышью по карточке идет мягкое теплое пятно (css/sector.css, класс
   fl-on). С 20.10.2026 — на всех страницах. Карточку со своей картинкой
   фоном (новость с обложкой, событие) пятно бы затерло, поэтому при первом
   наведении смотрим ее фон: есть картинка — карточку не трогаем. Пишем
   только координаты; на телефоне и с пером ничего не делаем. */
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const FLASH = '.card, .tile, .live-card, .pl-card, .fd-card, .tk-card, .reg-why, .lv-cta';
  const flashOk = new WeakMap();
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !e.target.closest) return;
    const c = e.target.closest(FLASH);
    if (!c) return;
    let ok = flashOk.get(c);
    if (ok === undefined) {
      ok = getComputedStyle(c).backgroundImage === 'none';
      flashOk.set(c, ok);
      if (ok) c.classList.add('fl-on');
    }
    if (!ok) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
    c.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
  }, { passive: true });
}

/* --- горизонтальные полосы: видно, что их можно листать ---
   Вкладки лавки и сетка боевого пропуска на узком экране обрезаются по краю,
   и человек не догадывается, что справа есть продолжение. Вешаем затухание у
   того края, за которым еще осталось содержимое: затухание пропало — доехали.
   Ширину пересчитываем наблюдателем, потому что сетку пропуска рисует shop.js
   уже после этого обхода. */
{
  const edge = el => {
    el.classList.add('hscroll');
    const upd = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('sc-l', el.scrollLeft > 4);
      el.classList.toggle('sc-r', el.scrollLeft < max - 4);
    };
    el.addEventListener('scroll', upd, { passive: true });
    addEventListener('resize', upd);
    if (window.ResizeObserver) new ResizeObserver(upd).observe(el);
    /* Содержимое полосы может появиться позже (сетку пропуска рисует shop.js,
       причем заменяя узел целиком) — следим за самим деревом, а не за узлом. */
    if (window.MutationObserver) {
      new MutationObserver(upd).observe(el, { childList: true, subtree: true });
    }
    upd();
  };
  document.querySelectorAll('.shop-tabs-in, .bp-scroll').forEach(edge);
}

/* --- подсветка активной вкладки магазина --- */
const tabs = document.querySelectorAll('.shop-tabs a');
if (tabs.length) {
  const sections = [...tabs].map(a => document.querySelector(a.hash)).filter(Boolean);
  const strip = document.querySelector('.shop-tabs-in');

  /* Подсветка бесполезна, если сама вкладка уехала за край полосы: на узком
     экране видно «Цены… Пропуск», а подсвечена «Амнистия» где-то справа за
     краем — полоса перестает отвечать на вопрос «где я сейчас». Подтягиваем
     ее к активной вкладке, когда та меняется.
     Двигаем именно полосу, а не страницу: scrollIntoView утащил бы заодно и
     вертикаль, то есть отобрал бы прокрутку у человека прямо под пальцем.
     Если полоса не листается (широкий экран, вкладки в две строки) — выходим
     сразу и ничего не трогаем. */
  const keep = a => {
    if (!a || !strip || strip.scrollWidth <= strip.clientWidth + 4) return;
    const l = a.offsetLeft, r = l + a.offsetWidth;
    const from = strip.scrollLeft;
    if (l < from + 24) strip.scrollLeft = Math.max(0, l - 24);
    else if (r > from + strip.clientWidth - 24) strip.scrollLeft = r - strip.clientWidth + 24;
  };

  let was = null;
  const setActive = () => {
    let cur = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top < 180) cur = s;
    }
    tabs.forEach(a => a.classList.toggle('active', a.hash === '#' + cur.id));
    /* Только на смене раздела: иначе полоса дергалась бы обратно каждый раз,
       когда ее отлистали рукой. */
    if (cur !== was) {
      was = cur;
      keep([...tabs].find(a => a.hash === '#' + cur.id));
    }
  };
  /* Считаем раз в кадр, а не на каждое событие прокрутки. Колесо шлет событий
     больше, чем браузер успевает рисовать кадров, а setActive читает положение
     всех пятнадцати разделов и тут же пишет прокрутку полосы — то есть посреди
     прокрутки заставляет браузер пересчитать верстку заново. Полоса от этого
     подрагивала. Кадр — ровно та частота, с которой ее все равно рисуют. */
  let tick = 0;
  const onScroll = () => {
    if (tick) return;
    tick = requestAnimationFrame(() => { tick = 0; setActive(); });
  };
  setActive();
  addEventListener('scroll', onScroll, { passive: true });
}

/* --- новости с главной ---
   В index.html шесть карточек лежат прямо в разметке: они видны сразу, до
   всякого скрипта, и остаются, если ниже ничего не пришло. Если пришло —
   заменяем их. Источник: служба сервера (ее правят из админ-панели), а пока
   службы нет — data/news.json. */
{
  const grid = document.querySelector('.news-grid');

  /* Метка «Свежее» на новости полуторамесячной давности — это вранье в глаза:
     человек видит ее первой и делает вывод, что проект стоит. Показываем метку
     только две недели со дня новости, дальше остается просто дата.
     Дата приходит строкой «ДД.ММ.ГГГГ» — new Date() ее не понимает, разбираем
     сами; непонятную дату считаем несвежей, чтобы метка не висела вечно. */
  const FRESH_DAYS = 14;
  const isFresh = s => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim());
    if (!m) return false;
    const t = new Date(+m[3], +m[2] - 1, +m[1]).getTime();
    return Date.now() - t < FRESH_DAYS * 864e5;
  };

  /* Шесть карточек лежат прямо в разметке и видны до всякой загрузки —
     метку на них проверяем тут же, не дожидаясь списка с сервера. */
  document.querySelectorAll('.news-top').forEach(top => {
    const d = top.querySelector('.date'), f = top.querySelector('.news-fresh');
    if (f && !(d && isFresh(d.textContent))) f.remove();
  });

  /* Картинка новости — та же, что ушла с постом в Discord и Telegram (поле
     image, путь внутри сайта). Берем только свою картинку из assets/img/news:
     список новостей может прийти со службы, и чужой адрес сюда не пролезет. */
  const newsImg = (n, A) => {
    const src = String(n.image || '');
    if (!/^assets\/img\/news\/[\w.-]+\.(jpe?g|png|webp)$/i.test(src)) return '';
    return '<a class="news-img" href="' + A.esc(src) + '" target="_blank" rel="noopener">' +
      '<img src="' + A.esc(src) + '" alt="" loading="lazy" decoding="async" width="1280" height="720"></a>';
  };

  if (grid && window.AegisApi) {
    const A = window.AegisApi;
    const draw = list => {
      if (!Array.isArray(list) || !list.length) return;
      /* Первая в списке — самая свежая, она и рисуется крупной во всю ширину.
         Никакого отдельного «главного» поля у новости нет: добавили новую —
         она встала первой, прежняя сама ушла в общий ряд. */
      grid.innerHTML = list.slice(0, 12).map((n, i) => {
        const img = newsImg(n, A);
        const body =
          (i === 0
            ? '<div class="news-top"><span class="date">' + A.esc(n.date || '') + '</span>' +
              (isFresh(n.date) ? '<span class="news-fresh">Свежее</span>' : '') + '</div>'
            : '<span class="date">' + A.esc(n.date || '') + '</span>') +
          '<h3>' + A.esc(n.title || '') + '</h3>' +
          '<p>' + A.esc(n.text || '') + '</p>';
        return '<div class="card news reveal' + (i === 0 ? ' news-lead' : '') + (img ? ' has-img' : '') + '">' +
          img + (img ? '<div class="news-body">' + body + '</div>' : body) + '</div>';
      }).join('');
      grid.querySelectorAll('.reveal').forEach(el => io.observe(el));
    };
    const fromFile = () => A.local('data/news.json').then(d => draw(d && d.items), () => {});
    if (A.base()) {
      A.call('/site/news').then(d => draw(d && d.items), fromFile);
    } else {
      fromFile();
    }
  }
}

/* Модалка покупки, каталог китов и переключатели сроков переехали в js/shop.js:
   покупка одна (рубли за товар), но к ней цепляются заказ на сервере, опрос
   его статуса и пересчет валюты — держать это вместе с общим скриптом главной
   было незачем. */

/* Скачивание лаунчера (#download): кнопку своей системы делаем основной и
   ставим первой, из подсказок оставляем ее. Телефон — только подсказка, что
   играть можно с компьютера. Нажал другую систему — подсказка переключается. */
(function () {
  var box = document.getElementById('download');
  if (!box) return;
  var ua = navigator.userAgent || '', pf = navigator.platform || '';
  var os = /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(pf) && navigator.maxTouchPoints > 1) ? 'mobile'
    : /Win/i.test(pf) || /Windows/i.test(ua) ? 'win'
    : /Mac/i.test(pf) || /Mac OS X/i.test(ua) ? 'mac'
    : /Linux|X11|CrOS/i.test(pf + ' ' + ua) ? 'linux' : 'win';
  var row = box.querySelector('.dl-row');
  var show = function (k) {
    box.querySelectorAll('.dl-hint').forEach(function (h) { h.hidden = h.getAttribute('data-os') !== k; });
  };
  row.querySelectorAll('.btn').forEach(function (b) {
    var mine = b.getAttribute('data-os') === os;
    b.classList.toggle('btn-primary', mine);
    b.classList.toggle('btn-dark', !mine);
    if (mine) row.insertBefore(b, row.firstChild);
    b.addEventListener('click', function () { show(b.getAttribute('data-os')); });
  });
  show(os);
})();
