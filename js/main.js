/* AEGIS SMP — общий скрипт сайта */

/* НАСТРОЙКА: страница приёма доната (DonationAlerts / ЮMoney и т.п.).
   Пока стоит заглушка — заменить на реальную ссылку овнера. */
const DONATE_URL = 'https://www.donationalerts.com/r/ЗАМЕНИ_НА_СВОЙ';

/* Сайт выложен публично РАНЬШЕ, чем открыт приём платежей, поэтому кнопку
   «Перейти к оплате» нельзя пускать на заглушку: живая страница с ведущей
   в никуда кнопкой оплаты хуже, чем честная строка «ещё не открыто».
   Заменишь ссылку выше на настоящую — кнопка включится сама, править
   больше нечего. */
const DONATE_READY = !/ЗАМЕНИ_НА_СВОЙ/i.test(DONATE_URL);

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

/* Модалка покупки, каталог китов и переключатели сроков переехали в js/shop.js:
   там две разные покупки (рубли за червонцы и червонцы за товар), и держать
   это вместе с общим скриптом главной было незачем. */
