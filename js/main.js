/* AEGIS SMP — общий скрипт сайта */

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

/* Дата открытия сезона.
   Перенос объявлен 22.08.2026: старт сдвинут на сентябрь, овнер назвал вилку
   «12 или 19, может раньше». Обратному отсчёту нужна ОДНА дата, поэтому здесь
   стоит поздняя граница — 19.09.2026 18:00 МСК (как в настройках бота и в
   событии Discord). Сдвинуть открытие на более ранний день можно спокойно,
   наоборот — уже нет. Появится точное число — править только эту строку и
   подписи «12 или 19 сентября» в index.html. */
const OPEN_DATE = new Date('2026-09-19T18:00:00+03:00');

/* режим съёмки макета (?shot=1) — только для рендера превью */
if (new URLSearchParams(location.search).has('shot')) {
  document.documentElement.classList.add('shotmode');
}

/* --- бургер-меню --- */
const burger = document.querySelector('.burger');
const topnav = document.getElementById('topnav');
if (burger && topnav) {
  burger.addEventListener('click', () => topnav.classList.toggle('open'));
  topnav.addEventListener('click', e => {
    if (e.target.tagName === 'A') topnav.classList.remove('open');
  });
}

/* --- обратный отсчёт на главной --- */
const cd = document.getElementById('cd');
if (cd) {
  const decl = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  const tick = () => {
    const ms = OPEN_DATE - Date.now();
    if (ms <= 0) { cd.textContent = 'Открыто!'; return; }
    const d = Math.floor(ms / 864e5);
    const h = Math.floor(ms % 864e5 / 36e5);
    const m = Math.floor(ms % 36e5 / 6e4);
    cd.textContent = d > 0
      ? `${d} ${decl(d, 'день', 'дня', 'дней')} ${h} ч`
      : `${h} ч ${m} мин`;
  };
  tick();
  setInterval(tick, 30000);
}

/* --- появление блоков при скролле --- */
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* Карточки, нарисованные скриптом (киты в лавке), появляются уже после этого
   обхода — наблюдатель о них не знает и они остались бы прозрачными навсегда.
   shop.js зовёт этот хук на каждый новый блок. */
window.aegisReveal = el => io.observe(el);

/* --- подсветка активной вкладки магазина --- */
const tabs = document.querySelectorAll('.shop-tabs a');
if (tabs.length) {
  const sections = [...tabs].map(a => document.querySelector(a.hash)).filter(Boolean);
  const setActive = () => {
    let cur = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top < 180) cur = s;
    }
    tabs.forEach(a => a.classList.toggle('active', a.hash === '#' + cur.id));
  };
  setActive();
  addEventListener('scroll', setActive, { passive: true });
}

/* --- новости с главной ---
   В index.html шесть карточек лежат прямо в разметке: они видны сразу, до
   всякого скрипта, и остаются, если ниже ничего не пришло. Если пришло —
   заменяем их. Источник: служба сервера (её правят из админ-панели), а пока
   службы нет — data/news.json. */
{
  const grid = document.querySelector('.news-grid');
  if (grid && window.AegisApi) {
    const A = window.AegisApi;
    const draw = list => {
      if (!Array.isArray(list) || !list.length) return;
      /* Первая в списке — самая свежая, она и рисуется крупной во всю ширину.
         Никакого отдельного «главного» поля у новости нет: добавили новую —
         она встала первой, прежняя сама ушла в общий ряд. */
      grid.innerHTML = list.slice(0, 12).map((n, i) =>
        '<div class="card news reveal' + (i === 0 ? ' news-lead' : '') + '">' +
        (i === 0
          ? '<div class="news-top"><span class="date">' + A.esc(n.date || '') +
            '</span><span class="news-fresh">Свежее</span></div>'
          : '<span class="date">' + A.esc(n.date || '') + '</span>') +
        '<h3>' + A.esc(n.title || '') + '</h3>' +
        '<p>' + A.esc(n.text || '') + '</p></div>').join('');
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
   там две разные покупки (рубли за червонцы и червонцы за товар), и держать
   это вместе с общим скриптом главной было незачем. */
