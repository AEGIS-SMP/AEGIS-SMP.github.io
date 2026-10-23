/* AEGIS SMP — общий скрипт сайта */

/* Адрес без .html (24.10.2026). Файлы прежние, GitHub Pages отдает /wiki как
   wiki.html, поэтому старые ссылки из бота, Discord и закладок работают — а в
   строке адреса после загрузки остается короткий вид. Якорь и запрос не трогаем. */
if (/\.html$/.test(location.pathname) && history.replaceState) {
  const p = location.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  try { history.replaceState(history.state, '', p + location.search + location.hash); } catch (e) {}
}

/* Страница приёма переводов. Сам адрес лежит в js/config.js вместе со всеми
   остальными адресами проекта: переезд на арендный хостинг должен быть
   правкой одного файла, а не поиском ссылок по сайту. */
const DONATE_URL = (window.AEGIS && window.AEGIS.donate) || '';

/* Сайт выложен публично РАНЬШЕ, чем открыт приём платежей, поэтому кнопку
   «Перейти к оплате» нельзя пускать на недописанный адрес: живая страница
   с ведущей в никуда кнопкой оплаты хуже честной строки «ещё не открыто».
   Появится настоящий адрес — кнопка включится сама.
   Признак недописанного — кириллица внутри ссылки: у настоящей её не бывает. */
const DONATE_READY = /^https:\/\/[\w.-]+\//.test(DONATE_URL) && !/[А-Яа-яЁё]/.test(DONATE_URL);

/* Дата открытия сезона — ЕДИНСТВЕННОЕ место на сайте, где она записана числом.
   17.09.2026 овнер закрыл вилку «12 или 19»: сезон открывается 19 сентября
   2026 года в 15:00 МСК. Всё остальное на сайте — отсчёт на главной, подписи,
   ответы вики — считается от этой строки или повторяет её словами.
   Часовой пояс задан явно (+03:00), иначе у игрока из другого пояса отсчёт
   показывал бы своё время открытия, а открытие одно на всех.

   18.10.2026: первый вайп сезона «1936» закончился 17 октября, игровой
   сервер выключен, дата следующего вайпа пока неизвестна. null — значит
   вместо отсчета на главной стоит плашка «дата пока неизвестна», а темы
   обращений не ждут никакого числа. Назовут дату — вписать ее сюда так:
   new Date('ГГГГ-ММ-ДДTЧЧ:ММ:00+03:00'), — и отсчет вернется сам. */
const OPEN_DATE = null;

/* режим съёмки макета (?shot=1) — только для рендера превью */
if (new URLSearchParams(location.search).has('shot')) {
  document.documentElement.classList.add('shotmode');
}

/* --- бургер-меню ---
   Кнопка молча переключала класс: снаружи никак не узнать, открыто меню или
   нет, — ни читалке (нет aria-expanded), ни тому, кто промахнулся мимо пункта
   (меню оставалось висеть). Держим состояние в одном месте: класс, словесная
   пометка, Esc и щелчок мимо. Esc возвращает фокус на кнопку — иначе он
   остаётся на исчезнувшем пункте и следующий Tab начинает страницу сначала. */
const burger = document.querySelector('.burger');
const topnav = document.getElementById('topnav');
if (burger && topnav) {
  const setNav = open => {
    topnav.classList.toggle('open', open);
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
  /* Щелчок мимо меню закрывает его — но только если он пришёлся вне шапки:
     иначе нажатие на саму кнопку сначала закроет меню здесь, а потом её
     собственный обработчик откроет обратно. */
  document.addEventListener('click', e => {
    if (!topnav.classList.contains('open')) return;
    if (e.target.closest('.topnav') || e.target.closest('.burger')) return;
    setNav(false);
  });
}

/* --- обратный отсчёт на главной ---

   Раньше до открытия оставалась одна строчка в плашке («12 дней 4 ч»), и
   обновлялась она раз в полминуты. Овнер попросил крупные цифры с днями,
   часами, минутами и секундами — и чтобы они красиво шли.

   Как это устроено. Разметка в index.html пустая: всё, что ниже, строит
   ячейки само. Причина не в красоте кода — число в разметке рано или поздно
   разошлось бы с настоящей датой, а так его там просто нет.

   Каждая цифра живёт в своей клетке с двумя слоями: текущий и следующий.
   Когда цифра меняется, текущий уезжает вверх, следующий приходит снизу —
   отсюда ощущение табло, а не прыгающего текста. Меняется при этом одна
   клетка, а не всё число: 59 → 00 крутит обе, 58 → 59 только правую.

   Секунда считается не «плюс один тик», а от самой даты: вкладка в фоне
   тормозит таймеры, и счётчик, который складывает секунды сам, за ночь
   отстаёт на минуты. Здесь же каждый тик — это разность с OPEN_DATE, а
   возвращение на вкладку сразу пересчитывает её заново. */
const cdEl = document.getElementById('cdown');

/* Даты нет — отсчитывать нечего. Нули на табло читались бы как поломка,
   поэтому вместо табло одна плашка словами и куда смотреть за новостями. */
if (cdEl && !OPEN_DATE) {
  const tg = 'https://t.me/aegis_smp';
  const ds = (window.AEGIS && window.AEGIS.discord) || '';
  cdEl.removeAttribute('role');
  cdEl.innerHTML =
    '<div class="cd-pause">' +
      '<div class="cd-pause-h">Следующий вайп — дата пока неизвестна</div>' +
      '<p>Первый вайп сезона «1936» завершился 17 октября 2026 года. Сервер на перерыве: ' +
        'дату следующего вайпа объявим в ' +
        (ds ? '<a href="' + ds + '" target="_blank" rel="noopener">Discord</a>' : 'Discord') +
        ' и <a href="' + tg + '" target="_blank" rel="noopener">Telegram</a>. ' +
        'А пока в лаунчере можно поиграть со сборкой в одиночном мире.</p>' +
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

  /* Бережём тех, кому от движения плохо: системная настройка «меньше
     анимации» выключает и прокрутку цифр, и появление ячеек. */
  const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const UNITS = [
    ['d', ['день', 'дня', 'дней']],
    ['h', ['час', 'часа', 'часов']],
    ['m', ['минута', 'минуты', 'минут']],
    ['s', ['секунда', 'секунды', 'секунд']]
  ];

  /* Табло целиком спрятано от читалок: диктовать «5 8 3 2» посекундно нельзя.
     Вместо него читалка получает одну живую строку словами (.cd-say) — её
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
   из данных карты), а в разметке остаётся последнее известное значение —
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

  /* Плавный счёт от нуля. Число дорисовывается ровно до целевого — на
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
         пока человек ещё листает шапку. */
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

/* --- появление блоков при скролле --- */
/* Блок с классом reveal прозрачен, пока к нему не добавят «in». Если
   наблюдателя в браузере нет, конструктор бросает ошибку — и на ней умирал бы
   весь main.js: вместе с анимацией отвалились бы меню-бутерброд и остальное, а
   страница осталась бы пустой. Поэтому запасной путь — показать всё сразу. */
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
   shop.js зовёт этот хук на каждый новый блок. */
window.aegisReveal = el => io.observe(el);

/* --- горизонтальные полосы: видно, что их можно листать ---
   Вкладки лавки и сетка боевого пропуска на узком экране обрезаются по краю,
   и человек не догадывается, что справа есть продолжение. Вешаем затухание у
   того края, за которым ещё осталось содержимое: затухание пропало — доехали.
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
       причём заменяя узел целиком) — следим за самим деревом, а не за узлом. */
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
     краем — полоса перестаёт отвечать на вопрос «где я сейчас». Подтягиваем
     её к активной вкладке, когда та меняется.
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
    /* Только на смене раздела: иначе полоса дёргалась бы обратно каждый раз,
       когда её отлистали рукой. */
    if (cur !== was) {
      was = cur;
      keep([...tabs].find(a => a.hash === '#' + cur.id));
    }
  };
  /* Считаем раз в кадр, а не на каждое событие прокрутки. Колесо шлёт событий
     больше, чем браузер успевает рисовать кадров, а setActive читает положение
     всех пятнадцати разделов и тут же пишет прокрутку полосы — то есть посреди
     прокрутки заставляет браузер пересчитать вёрстку заново. Полоса от этого
     подрагивала. Кадр — ровно та частота, с которой её всё равно рисуют. */
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
   заменяем их. Источник: служба сервера (её правят из админ-панели), а пока
   службы нет — data/news.json. */
{
  const grid = document.querySelector('.news-grid');

  /* Метка «Свежее» на новости полуторамесячной давности — это враньё в глаза:
     человек видит её первой и делает вывод, что проект стоит. Показываем метку
     только две недели со дня новости, дальше остаётся просто дата.
     Дата приходит строкой «ДД.ММ.ГГГГ» — new Date() её не понимает, разбираем
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
     image, путь внутри сайта). Берём только свою картинку из assets/img/news:
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
   его статуса и пересчёт валюты — держать это вместе с общим скриптом главной
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
