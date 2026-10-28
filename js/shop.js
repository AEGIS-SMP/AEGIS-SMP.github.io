/* AEGIS SMP — лавка: киты, кейсы с прокруткой, боевой пропуск,
   ускорение сервера и оформление заказа.
   Подключается только на donate.html, после main.js (оттуда берется
   DONATE_URL и хук window.aegisReveal).

   Правки 24.08.2026 по разбору RedBuzz: кейсы открываются как кейсы
   (анимация, мультиоткрытие, продажа приза), у китов есть иконки и
   выбор уровня, лимит «раз за сезон» снят, добавлен кит с оружием,
   ускорение сервера стало лестницей ×1.5…×5, у пропуска награда на
   каждом этапе. */

'use strict';

/* мелкие помощники: экранирование и «мягкая» анимация */
const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Во всех переключателях лавки выбранная кнопка отличается только заливкой —
   тому, кто слушает страницу, заливку не прочитают. mark() ставит рядом с
   классом «on» словесную пометку: для выбора из нескольких это aria-pressed,
   для ряда «прыгнуть к этапу» — aria-current, потому что там не нажатое
   состояние, а «ты сейчас здесь». Держим это в одном месте: переключателей
   шесть, и порознь их рано или поздно разведет. */
const mark = (sel, isOn, attr = 'aria-pressed') =>
  document.querySelectorAll(sel).forEach(b => {
    const on = isOn(b);
    b.classList.toggle('on', on);
    if (attr === 'aria-current') on ? b.setAttribute(attr, 'true') : b.removeAttribute(attr);
    else b.setAttribute(attr, on ? 'true' : 'false');
  });
/* Три окна лавки (кит, кейс, заказ) открывались и закрывались переключением
   класса — и фокус при этом оставался на странице ПОД окном. С клавиатуры это
   выглядело так: нажал «Подробнее», окно открылось, а Tab продолжает ходить по
   карточкам за ним, и до кнопок самого окна добираешься через всю страницу.
   openModal() переводит фокус внутрь, closeModal() возвращает его ровно на ту
   кнопку, которой окно открыли (иначе после закрытия фокус падает в начало
   страницы и место в списке теряется), а Tab заперт внутри открытого окна —
   так ведут себя все привычные окна, и того же ждет читалка от aria-modal. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];      /* заказ открывается поверх кита — потому стопкой */

const modalTabbable = wrap => [...wrap.querySelectorAll(FOCUSABLE)]
  .filter(el => el.offsetWidth || el.offsetHeight);

const openModal = (wrap, focusEl) => {
  if (!wrap || wrap.classList.contains('open')) return;
  modalStack.push({ wrap, back: document.activeElement });
  wrap.classList.add('open');
  (focusEl || wrap.querySelector('.m-close') || wrap).focus();
};

const closeModal = wrap => {
  if (!wrap || !wrap.classList.contains('open')) return;
  wrap.classList.remove('open');
  const i = modalStack.findIndex(s => s.wrap === wrap);
  const back = i < 0 ? null : modalStack.splice(i, 1)[0].back;
  if (back && back.isConnected && back.offsetParent !== null) back.focus();
};

addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !modalStack.length) return;
  const wrap = modalStack[modalStack.length - 1].wrap;
  const list = modalTabbable(wrap);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  const inside = wrap.contains(document.activeElement);
  if (e.shiftKey ? (!inside || document.activeElement === first)
                 : (!inside || document.activeElement === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});

const img = (file, cls) =>
  `<img${cls ? ` class="${cls}"` : ''} src="assets/icons/${file}.png" alt="">`;
/* иконки 16×16 и 32×32 тянутся пиксельно, крупные рендеры — сглаженно;
   корона 16×8 — единственная широкая, ей своя ширина */
/* Часть иконок — честные рендеры моделей (их делает tools\icons_render.py,
   сторона 128 px). Тянуть их пиксельно нельзя: image-rendering: pixelated
   на рендере, ужатом до 22-50 px, рвет края. Остальное — спрайты предметов
   16×16, вот им пиксельность как раз и нужна.
   Список повторяет ICONS из icons_render.py; скрипт сам ругается, если
   нарисовал то, чего здесь нет. */
const SMOOTH = new Set([
  'aegis_siren', 'aegis_siren_control', 'aegis_beacon_lamp',
  'aegis_vault', 'aegis_flow_collector', 'aegis_flow_splitter',
  'aegis_star_shell', 'aegis_salute_shell', 'aegis_thermite_shell',
  'aegis_concussion_shell', 'aegis_gas_shell', 'create_cogwheel',
  'create_large_cogwheel', 'create_axis', 'create_gearbox',
  'create_brass_casing', 'create_andesite_casing', 'create_mechanical_press',
  'create_stock_ticker', 'create_stock_link', 'create_packager',
  'create_radar_bearing',
  'create_radar_monitor', 'wrench', 'barrel', 'tfmg_steel_block',
  'cbc_he_shell', 'cbc_ap_shell', 'cbc_shrapnel_shell', 'cbc_powder_charge',
  'cannon_barrel_bronze', 'cannon_mount', 'tfmg_pump',
  'tfmg_steel_pipe', 'create_brass_funnel',
  'home_point', 'atlas',
  'bag',
]);
/* Правило простое: рендер — сглаженно, все остальное — пиксельно. Раньше
   пиксельность вешалась по префиксу имени, и спрайты без префикса
   (clipboard, brass_ingot, листы) браузер тянул сглаженно — отсюда и мыло. */
const PIX = f => f === 'crown' ? 'pix wide' : (SMOOTH.has(f) ? '' : 'pix');

/* Цена везде в РУБЛЯХ, под ней — та же сумма в валюте игрока; рисует ее
   js/money.js. Ценников в червонцах в лавке нет с 16.09.2026 — ни у одного
   товара; сами червонцы при этом с 17.09.2026 продаются отдельной позицией
   (раздел #coins), и ее ценник тоже рублевый. Разница важная: рубль покупает
   червонцы, но не покупает товар за червонцы. Здесь ценники то и дело переписываются скриптом (уровень кита,
   число кейсов, ступень ускорения, срок звания), и после каждой такой
   перерисовки строку валюты надо позвать заново — иначе под новой ценой
   останется старая сумма. */
const money = () => {
  /* Проверяем именно .prices, а не сам AegisMoney: у вернувшегося игрока
     в кэше может лежать старая money.js без этой функции, и тогда весь
     скрипт лавки падал бы на первой же перерисовке цены. */
  if (window.AegisMoney && AegisMoney.prices) AegisMoney.prices();
};

/* ============================================================
   1. КИТЫ. Пять профессий в продаже, по три уровня (боевые сняты 25.10.2026: off: true).
   Уровень — полнота комплекта, а не сила: все содержимое
   крафтится в игре, кит экономит вечер у станка. У каждой
   позиции проставлена своя цена в рублях — из них считается
   строка «по отдельности» в карточке кита.
   ============================================================ */

const KITS = [
  {
    name: 'Снабжение',
    sub: 'провиант, свет, ящики и рюкзак',
    icons: ['tfmg_coal_coke', 'clipboard', 'iron_sheet'],
    tiers: [
      { price: 29, items: [
        ['Печеная свинина и хлеб', '×128', 10],
        ['Факелы', '×256', 7],
        ['Железный инструмент', '2 комплекта', 12],
        ['Сундуки и воронки', '×24', 10],
        ['Уголь', '×128', 8]
      ] },
      { price: 69, items: [
        ['Провиант на неделю', '×256', 20],
        ['Факелы и фонари', '×512', 15],
        ['Алмазный инструмент', 'полный набор', 23],
        ['Рюкзак с апгрейдом стопок', '', 27],
        ['Коксовый уголь', '×128', 15],
        ['Сундуки и воронки', '×64', 15]
      ] },
      { price: 129, items: [
        ['Провиант на месяц', '×512', 37],
        ['Золотые яблоки', '×8', 15],
        ['Рюкзак: магнит, стопки, подбор', '', 53],
        ['Алмазный инструмент', '2 комплекта', 47],
        ['Коксовый уголь', '×256', 30],
        ['Фонари, сундуки, воронки', '×128', 23]
      ] }
    ]
  },
  {
    name: 'Инженер',
    sub: 'кинетика Create под ключ',
    icons: ['wrench', 'goggles', 'precision_mechanism'],
    tiers: [
      { price: 39, items: [
        ['Гаечный ключ и очки инженера', '', 13],
        ['Андезитовый сплав', '×256', 20],
        ['Валы и шестерни', '×192', 15],
        ['Ремни и приводы', '×32', 10]
      ] },
      { price: 89, items: [
        ['Гаечный ключ и очки инженера', '', 13],
        ['Механизм точности', '×16', 40],
        ['Латунный корпус', '×32', 23],
        ['Валы, шестерни, ремни', '×384', 30],
        ['Воронки, желоба, туннели', '×64', 18],
        ['Латунь и цинк', '×128', 20]
      ] },
      { price: 199, items: [
        ['Механизм точности', '×48', 100],
        ['Прочный лист', '×32', 43],
        ['Пресс, смеситель, миксер, печь', 'по 2', 60],
        ['Валы, шестерни, ремни', '×768', 50],
        ['Латунь, цинк, медь', '×512', 57],
        ['Ключ, очки, схематический стол', '', 20]
      ] }
    ]
  },
  {
    name: 'Строитель',
    sub: 'материал и схемы под стройку',
    icons: ['schematic', 'sturdy_sheet', 'copper_sheet'],
    tiers: [
      { price: 29, items: [
        ['Камень и кирпич', '×1024', 17],
        ['Доски и брус', '×512', 12],
        ['Стекло', '×256', 10],
        ['Леса', '×128', 8]
      ] },
      { price: 89, items: [
        ['Материал на выбор', '×4096', 53],
        ['Стекло и витраж', '×512', 20],
        ['Схематический стол и 8 схем', '', 30],
        ['Декор Create Deco на выбор', '×512', 27],
        ['Леса', '×256', 15]
      ] },
      { price: 199, items: [
        ['Материал на выбор', '×8192', 107],
        ['Схематическая пушка и порох ×256', '', 60],
        ['Пустые схемы', '×32', 40],
        ['Декор и медные листы', '×1024', 63],
        ['Копикэты и интерьер', '×512', 40],
        ['Леса', '×512', 20]
      ] }
    ]
  },
  {
    name: 'Нефтяник',
    sub: 'промысел и переработка TFMG',
    icons: ['tfmg_crude_oil_bucket', 'tfmg_pump', 'tfmg_steel_ingot'],
    tiers: [
      { price: 39, items: [
        ['Стальные трубы', '×128', 18],
        ['Сталь', '×32', 15],
        ['Коксовый уголь', '×128', 15],
        ['Ведра и канистры', '×8', 8]
      ] },
      { price: 89, items: [
        ['Стальные трубы', '×256', 33],
        ['Жидкостные баки', '×16', 30],
        ['Стальные помпы', '×8', 27],
        ['Вентили и краны', '×16', 18],
        ['Стальной механизм', '×12', 37]
      ] },
      { price: 199, items: [
        ['Комплект нефтяного насоса', 'под ключ', 87],
        ['Стальные трубы', '×512', 63],
        ['Жидкостные баки', '×32', 57],
        ['Стальной механизм', '×32', 93],
        ['Сталь и чугун', '×256', 30]
      ] }
    ]
  },
  {
    name: 'Артиллерист',
    off: true,
    sub: 'орудия и боекомплект Big Cannons',
    icons: ['cannon_barrel_bronze', 'cbc_powder_charge', 'createbigcannons_impact_fuze'],
    tiers: [
      { price: 39, items: [
        ['Бронзовый ствол', '×4', 20],
        ['Лафет и станина', '', 15],
        ['Пороховой заряд', '×32', 15],
        ['Мешок картечи', '×16', 10]
      ] },
      { price: 99, items: [
        ['Бронзовый ствол', '×8', 37],
        ['Чугунный ствол', '×4', 30],
        ['Пороховой заряд', '×96', 37],
        ['Взрыватели ударные и дистанционные', '×32', 27],
        ['Фугасные снаряды', '×32', 30]
      ] },
      { price: 209, items: [
        ['Стальной ствол', '×8', 87],
        ['Скорострельный затвор', '×2', 63],
        ['Автопушка с креплением', '', 57],
        ['Пороховой заряд', '×256', 67],
        /* Именно фугасные и бронебойные Big Cannons. «Снаряды на выбор»
           читались как «в том числе наши» — наши пять живут в наборе мода
           «Боекомплект» и стоят там своих денег. */
        ['Фугасные и бронебойные снаряды', '×96', 63]
      ] }
    ]
  },
  {
    /* Сирены и посты оповещения жили здесь до сентября 2026 — теперь это
       набор мода «Оповещение» (раздел «Мод AEGIS»), и продавать одно и то же
       в двух местах по разной цене нельзя. Связисту остается то, ради чего
       к нему и шли: глаза (радар), экраны и провода. */
    name: 'Связист',
    sub: 'радиолокация, мониторы и редстоун-связь',
    icons: ['create_radar_bearing', 'create_radar_monitor', 'create_gearbox'],
    tiers: [
      { price: 39, items: [
        ['Вращатель антенны и рефлекторы', '×8', 18],
        ['Приемник антенны радара', '', 12],
        ['Шестерни, валы, ремни', '×64', 12],
        ['Редстоуновая связь', '×8', 10]
      ] },
      { price: 89, items: [
        ['Радиолокационная станция', 'под ключ', 50],
        ['Монитор', '×4', 27],
        ['Передатчик радиолокационных данных', '×2', 23],
        ['Шестерни, валы, ремни', '×192', 23],
        ['Редстоуновая связь и наблюдатели', '×32', 15]
      ] },
      { price: 199, items: [
        ['Сеть радаров', '3 станции', 110],
        ['Монитор и большая доска', '×8', 57],
        ['Передатчик данных', '×6', 50],
        ['Механизм точности', '×12', 30],
        ['Латунь и цинк', '×256', 40],
        ['Редстоуновая связь', '×64', 23]
      ] }
    ]
  },
  {
    name: 'Штурмовик',
    off: true,
    sub: 'личное оружие, броня и зелья',
    icons: ['diamond_sword', 'diamond_chestplate', 'crossbow'],
    tiers: [
      { price: 49, items: [
        ['Железный меч и топор', '2 комплекта', 13],
        ['Лук и стрелы', '×256', 15],
        ['Железный доспех', '2 комплекта', 20],
        ['Щит', '×4', 8],
        ['Золотые яблоки', '×4', 10]
      ] },
      { price: 99, items: [
        ['Алмазный меч и топор', '', 30],
        ['Алмазный доспех', 'полный', 43],
        ['Арбалет и стрелы', '×512', 30],
        ['Зелья лечения и скорости', '×16', 27],
        ['Щиты и золотые яблоки', '×8', 20]
      ] },
      { price: 209, items: [
        ['Алмазный меч: Острота V', '', 63],
        ['Алмазный доспех: Защита IV', 'полный', 93],
        ['Арбалет: Быстрая перезарядка III', '', 43],
        ['Стрелы', '×1024', 43],
        ['Зелья и зачарованные яблоки', '×24', 57],
        ['Рюкзак бойца', '', 33]
      ] }
    ]
  }
];

const ROMAN = ['I', 'II', 'III'];

/* ---------- плитки китов ---------- */

function renderKitTiles() {
  const grid = document.getElementById('kitGrid');
  if (!grid) return;
  grid.textContent = '';

  KITS.forEach((k, ki) => {
    if (k.off) return;      // снят с продажи; индекс ki не сдвигаем — на нем держатся ссылки ?kit=
    const tile = document.createElement('div');
    tile.className = 'kit-tile reveal';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.dataset.kit = ki;

    const icons = k.icons.map(f =>
      `<span class="kt-cell">${img(f, PIX(f))}</span>`).join('');
    /* Что лежит в младшем уровне — три первые строки, чтобы было видно
       содержимое еще до клика. Остальное и старшие уровни — в карточке. */
    const t0 = k.tiers[0].items;
    const peek = t0.slice(0, 3).map(([what, n]) =>
      `<li><span>${esc(what)}</span>${n ? `<b>${esc(n)}</b>` : ''}</li>`).join('') +
      (t0.length > 3 ? `<li class="kt-more">и еще ${t0.length - 3} в уровне I</li>` : '');
    const chips = k.tiers.map((t, i) =>
      `<button type="button" class="kt-chip" data-kit="${ki}" data-tier="${i}">` +
      `<b>${ROMAN[i]}</b>${t.price} ₽</button>`).join('');

    tile.innerHTML =
      `<div class="kt-icons">${icons}</div>` +
      `<h3>${esc(k.name)}</h3>` +
      `<div class="kt-sub">${esc(k.sub)}</div>` +
      `<ul class="kt-peek">${peek}</ul>` +
      `<div class="kt-tiers">${chips}</div>` +
      `<div class="kt-open">Состав и цены <span>→</span></div>`;

    grid.appendChild(tile);
    if (window.aegisReveal) window.aegisReveal(tile);
  });
}

/* ---------- карточка кита ---------- */

const kitModal = document.getElementById('kitModal');
let kmKit = 0, kmTier = 0;

function fillKit(ki, ti) {
  kmKit = ki; kmTier = ti;
  const k = KITS[ki], t = k.tiers[ti];

  document.getElementById('kmIcons').innerHTML =
    k.icons.map(f => `<span class="kt-cell">${img(f, PIX(f))}</span>`).join('');
  document.getElementById('kmName').textContent = `${k.name} · ${ROMAN[ti]}`;
  document.getElementById('kmSub').textContent = k.sub;

  const parts = t.items.reduce((s, it) => s + it[2], 0);
  document.getElementById('kmItems').innerHTML = t.items.map(([what, n, v]) =>
    `<li><span class="ki-what">${esc(what)}</span>` +
    `<span class="ki-n">${esc(n)}</span>` +
    `<span class="ki-v">${v} ₽</span></li>`).join('');

  document.getElementById('kmParts').textContent = parts + ' ₽';
  document.getElementById('kmSave').textContent =
    Math.round((1 - t.price / parts) * 100) + '%';
  document.getElementById('kmPrice').textContent = t.price;

  money();

  const buy = document.getElementById('kmBuy');
  buy.dataset.rub = t.price;
  buy.dataset.buy = `Кит «${k.name}» · уровень ${ROMAN[ti]}`;

  mark('#kmSwitch button', b => +b.dataset.t === ti);
}

function openKit(ki, ti) {
  if (!kitModal) return;
  fillKit(ki, ti);
  openModal(kitModal);
}

if (kitModal) {
  renderKitTiles();

  document.addEventListener('click', e => {
    const chip = e.target.closest('.kt-chip');
    if (chip) { openKit(+chip.dataset.kit, +chip.dataset.tier); return; }
    const tile = e.target.closest('.kit-tile');
    if (tile) openKit(+tile.dataset.kit, 0);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (!t || !t.closest) return;
    /* Кнопки тиров лежат ВНУТРИ плитки и нажимаются сами: перехватив их здесь,
       мы гасили бы их клик и с клавиатуры всегда открывался бы первый тир. */
    if (t.closest('a, button, input, select, textarea')) return;
    const tile = t.closest('.kit-tile');
    if (tile) { e.preventDefault(); openKit(+tile.dataset.kit, 0); }
  });

  document.getElementById('kmSwitch').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (b) fillKit(kmKit, +b.dataset.t);
  });
}

/* ============================================================
   2. КЕЙСЫ. Пять ступеней редкости. Сам кейс стоит денег, а поле
   sell — это цена продажи приза В ИГРЕ, в червонцах: ненужный приз
   не мусор. Выкуп привязан к пакету червонцев: K = цена × 0.671
   (сколько Ч дал бы на эти деньги лучший пакет), ступени —
   0.12 / 0.30 / 0.60 / 1.25 / 3.0 от K, округление до 5. В среднем
   кейс возвращает ~35–38% от пакета, так что покупать кейсы ради
   червонцев невыгодно — иначе кейсы обходили бы дневной предел 2000 Ч.
   Правила выдачи (сервер, ЛАВКА-ДОНАТ §5): червонцы с продажи призов
   из купленного кейса помечены paid; они, червонцы этапов пропуска и
   продажа призов из кейсов пропуска вместе с пакетами укладываются
   в предел 2000 Ч/сутки (лишнее ждет следующих суток, не сгорает).
   При смене цены кейса выкуп пересчитывать по той же формуле.
   ============================================================ */

const RAR = [
  { label: 'Обычное',     cls: 'r-common' },
  { label: 'Необычное',   cls: 'r-often' },
  { label: 'Редкое',      cls: 'r-rare' },
  { label: 'Эпическое',   cls: 'r-epic' },
  { label: 'Легендарное', cls: 'r-leg' }
];
/* с этой ступени выпадение объявляется в чат — ниже видит только владелец */
const SHOUT_FROM = 3;

const CASES = [
  {
    id: 'field', name: 'Полевой склад', sub: 'первые дни на карте',
    price: 69, icon: 'tfmg_coal_coke',
    drops: [
      { c: 48, n: 'Провиант и свет', w: 'свинина ×64, факелы ×128, уголь ×64', sell: 5, icon: 'tfmg_coal_coke' },
      { c: 30, n: 'Инструмент бригады', w: 'железный набор ×2, наковальня, сундуки ×16', sell: 15, icon: 'iron_sheet' },
      { c: 15, n: 'Андезитовый обоз', w: 'андезитовый сплав ×256', sell: 30, icon: 'andesite_alloy' },
      { c: 5, n: 'Алмазный набор', w: 'алмазный инструмент ×3 и алмазы ×24', sell: 60, icon: 'sturdy_sheet' },
      { c: 2, n: 'Кит «Снабжение» III', w: 'полный комплект третьего уровня', sell: 140, icon: 'clipboard' }
    ]
  },
  {
    id: 'plant', name: 'Заводской наряд', sub: 'производство Create',
    price: 99, icon: 'precision_mechanism',
    drops: [
      { c: 48, n: 'Металл и кокс', w: 'латунь ×64, коксовый уголь ×64', sell: 10, icon: 'brass_ingot' },
      { c: 30, n: 'Кинетика россыпью', w: 'валы ×128, шестерни ×128, ремни ×32, воронки ×32', sell: 20, icon: 'create_cogwheel' },
      { c: 15, n: 'Механизмы точности', w: 'механизм точности ×16, латунный корпус ×32', sell: 40, icon: 'precision_mechanism' },
      { c: 5, n: 'Линия под ключ', w: 'пресс, смеситель, чаша и прочный лист ×16', sell: 85, icon: 'create_mechanical_press' },
      { c: 2, n: 'Кит «Инженер» III', w: 'полный комплект третьего уровня', sell: 200, icon: 'wrench' }
    ]
  },
  {
    id: 'oil', name: 'Нефтяной контракт', sub: 'промысел TFMG',
    price: 119, icon: 'tfmg_crude_oil_bucket',
    drops: [
      { c: 48, n: 'Сырье промысла', w: 'коксовый уголь ×128, сырая нефть ×8 ведер', sell: 10, icon: 'tfmg_coal_coke' },
      { c: 30, n: 'Трубный обоз', w: 'стальные трубы ×128, сталь ×32', sell: 25, icon: 'tfmg_steel_pipe' },
      { c: 15, n: 'Насосная станция', w: 'баки ×16, помпы ×8, вентили ×16', sell: 50, icon: 'tfmg_pump' },
      { c: 5, n: 'Скважина под ключ', w: 'комплект нефтяного насоса, стальной механизм ×16', sell: 100, icon: 'tfmg_steel_mechanism' },
      { c: 2, n: 'Кит «Нефтяник» III', w: 'полный комплект третьего уровня', sell: 240, icon: 'tfmg_steel_ingot' }
    ]
  },
  {
    id: 'arsenal', name: 'Арсенал', sub: 'боекомплект Big Cannons',
    price: 139, off: true, icon: 'cbc_shrapnel_shell',
    drops: [
      { c: 48, n: 'Порох и картечь', w: 'пороховой заряд ×32, мешок картечи ×16', sell: 10, icon: 'cbc_powder_charge' },
      { c: 30, n: 'Фугасы и дымы', w: 'фугасные ×8 и дымовые ×8, взрыватели ×16', sell: 30, icon: 'cbc_he_shell' },
      { c: 15, n: 'Тяжелый боекомплект', w: 'шрапнель ×16, бронебойные ×16, взрыватели ×32', sell: 55, icon: 'cbc_ap_shell' },
      { c: 5, n: 'Скорострельная батарея', w: 'бронзовый затвор и стволы ×4', sell: 115, icon: 'cannon_barrel_bronze' },
      { c: 2, n: 'Кит «Артиллерист» III', w: 'полный комплект третьего уровня', sell: 280, icon: 'cannon_wheels' }
    ]
  },
  {
    id: 'parade', name: 'Парадный расчет', sub: 'салют и косметика',
    price: 89, off: true, later: true, icon: 'aegis_salute_shell',
    drops: [
      { c: 48, n: 'Салют и знамена', w: 'салютные снаряды ×32, цветные знамена ×16', sell: 5, icon: 'aegis_salute_shell' },
      { c: 30, n: 'Значок к нику', w: 'пиксельный значок у ника · в игре позже, приз сохраняется', sell: 20, icon: 'crown' },
      { c: 15, n: 'Цвет и префикс', w: 'цветной ник и свой префикс · в игре позже, приз сохраняется', sell: 35, icon: 'cape' },
      { c: 5, n: 'Плащ сезона', w: 'косметический плащ · в игре позже, приз сохраняется', sell: 75, icon: 'aegis_star_shell' },
      { c: 2, n: 'Накидка «Парад» и позывной', w: 'скин-накидка и сигнал входа · в игре позже, приз сохраняется', sell: 180, icon: 'aegis_siren_remote' }
    ]
  },
  {
    id: 'staff', name: 'Генштаб', sub: 'редкое и статусное',
    price: 189, off: true, icon: 'crown', top: true,
    drops: [
      { c: 48, n: 'Парадный залп', w: 'осветительные ×16, салютные ×32, знамена ×16', sell: 15, icon: 'aegis_star_shell' },
      { c: 30, n: '«Гвардеец» на 7 дней', w: 'звание второго тира на неделю', sell: 40, icon: 'aegis_stock_module' },
      { c: 15, n: 'Кит III уровня на выбор', w: 'любая из семи профессий', sell: 75, icon: 'clipboard' },
      { c: 5, n: '«Командор» на 30 дней', w: 'звание третьего тира на месяц', sell: 160, icon: 'golden_sheet' },
      { c: 2, n: '«Маршал» до конца вайпа', w: 'четвертая ступень до вайпа', sell: 380, icon: 'crown' }
    ]
  },
  {
    id: 'convoy', name: 'Промышленный обоз', sub: 'ресурсы в промышленном масштабе',
    price: 0, off: true, from: 'падает из пропуска', icon: 'andesite_alloy',
    drops: [
      { c: 48, n: 'Андезитовый сплав ×1024', w: 'основа всей кинетики, целый обоз', sell: 5, icon: 'andesite_alloy' },
      { c: 30, n: 'Стройматериал ×2048', w: 'камень, кирпич или доски на выбор', sell: 15, icon: 'sturdy_sheet' },
      { c: 15, n: 'Латунь ×512 и цинк ×512', w: 'цветной металл вагоном', sell: 30, icon: 'brass_ingot' },
      { c: 5, n: 'Сталь ×512 и трубы ×256', w: 'на промысел и на броню', sell: 60, icon: 'tfmg_steel_ingot' },
      { c: 2, n: 'Конвейер под ключ', w: 'пресс, смеситель, печь и ремни ×64', sell: 140, icon: 'create_mechanical_press' }
    ]
  },
  {
    id: 'points', name: 'Штабные очки', sub: 'очки прокачки пропуска',
    price: 0, off: true, from: 'падает из пропуска', icon: 'clipboard', noSell: true,
    drops: [
      // очки — награда неосязаемая, картинку ей даем по возрастанию «веса»:
      // планшет → чертеж → картостол → золотой лист → корона. Раньше два
      // соседних выигрыша делили одну иконку, и в ленте кейса рядом стояли
      // две одинаковые картинки — читалось как ошибка верстки.
      { c: 48, n: '400 очков пропуска', w: 'почти половина этапа', sell: null, icon: 'clipboard' },
      { c: 30, n: '700 очков пропуска', w: 'дневная норма среднего задания', sell: null, icon: 'schematic' },
      { c: 15, n: '1200 очков пропуска', w: 'этап целиком и немного сверху', sell: null, icon: 'atlas' },
      { c: 5, n: '2000 очков пропуска', w: 'два этапа за раз', sell: null, icon: 'golden_sheet' },
      { c: 2, n: '3500 очков и ротации ×3', w: 'три с половиной этапа', sell: null, icon: 'crown' }
    ]
  }
];

const caseById = id => CASES.find(c => c.id === id && !c.off);
const avgSell = c => c.noSell ? null
  : Math.round(c.drops.reduce((s, d) => s + d.c * d.sell, 0) / 100);

function rollDrop(c) {
  let r = Math.random() * 100;
  for (let i = 0; i < c.drops.length; i++) {
    r -= c.drops[i].c;
    if (r <= 0) return i;
  }
  return 0;
}

/* ---------- плитки кейсов ---------- */

/* шанс «редкое и выше» за одно открытие — сумма трех верхних ступеней */
function rareUp(c) { return c.drops.slice(2).reduce((a, d) => a + d.c, 0); }
function pc(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }

function renderCaseTiles() {
  const grid = document.getElementById('caseGrid');
  if (!grid) return;
  grid.textContent = '';

  CASES.forEach(c => {
    if (c.off) return;      // снят с продажи 25.10.2026 (сезон 2)
    const tile = document.createElement('div');
    tile.className = 'case-tile reveal' + (c.top ? ' ct-top' : '') + (c.from ? ' ct-pass' : '');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.dataset.case = c.id;

    const strip = c.drops.slice(1).map((d, i) =>
      `<span class="ct-mini ${RAR[i + 1].cls}">${img(d.icon, PIX(d.icon))}</span>`).join('');

    tile.innerHTML =
      `<div class="ct-crate">` +
        `<span class="ct-lid"></span>` +
        `<span class="ct-icon">${img(c.icon, PIX(c.icon))}</span>` +
        `<span class="ct-shine"></span>` +
      `</div>` +
      `<h3>${esc(c.name)}</h3>` +
      `<div class="ct-sub">${esc(c.sub)}</div>` +
      `<div class="ct-strip">${strip}</div>` +
      `<div class="ct-odds">${c.later ? 'косметики в игре пока нет — <b>откроется позже</b>' : `редкое и выше <b>${pc(rareUp(c))}%</b> · легендарное <b>${pc(c.drops[4].c)}%</b>`}</div>` +
      `<div class="ct-foot">` +
        (c.price
          ? `<span class="ct-price">${c.price} <small>₽</small></span>`
          : `<span class="ct-free">${esc(c.from)}</span>`) +
        `<span class="ct-open">Открыть</span>` +
      `</div>`;

    grid.appendChild(tile);
    if (window.aegisReveal) window.aegisReveal(tile);
  });
}

/* ---------- карточка кейса и прокрутка ---------- */

const caseModal = document.getElementById('caseModal');
let cmCase = CASES[0], cmCount = 1, cmSlow = true, cmBusy = false;

const CELL = { 1: 116, 3: 78, 5: 62, 10: 44 };

function fillCase(c) {
  cmCase = c;
  document.getElementById('cmIcon').innerHTML = img(c.icon, PIX(c.icon));
  document.getElementById('cmName').textContent = c.name;
  document.getElementById('cmSub').textContent = c.sub;

  const price = document.getElementById('cmPrice');
  price.innerHTML = c.price
    ? `${c.price} <small>₽</small>`
    : `<span class="ct-free">${esc(c.from)}</span>`;
  money();

  const odds = document.getElementById('cmOdds');
  if (odds) odds.innerHTML =
    `<div class="co-bar" aria-hidden="true">` +
      c.drops.map((d, i) => `<span class="${RAR[i].cls}" style="flex-grow:${d.c}"></span>`).join('') +
    `</div>` +
    `<ul class="co-legend">` +
      c.drops.map((d, i) => `<li><i class="${RAR[i].cls}"></i>${RAR[i].label}<b>${pc(d.c)}%</b></li>`).join('') +
    `</ul>` +
    `<p class="co-note">Редкое и выше — <b>${pc(rareUp(c))}%</b> каждого открытия. ` +
      `Девять кейсов этого вида подряд без редкого — десятый дает редкое или выше гарантированно.</p>`;

  document.getElementById('cmDrops').innerHTML = c.drops.map((d, i) =>
    `<li class="cd-lv${i}">` +
      `<span class="cd-icon ${RAR[i].cls}">${img(d.icon, PIX(d.icon))}</span>` +
      `<span class="cd-body">` +
        `<em class="cd-rar">${RAR[i].label}</em>` +
        `<b>${esc(d.n)}</b>` +
        `<i>${esc(d.w)}</i>` +
      `</span>` +
      `<span class="cd-side">` +
        `<span class="r ${RAR[i].cls}">${pc(d.c)}%</span>` +
        `<span class="cd-sell">${d.sell == null ? 'не продается' : 'продажа ' + d.sell + ' Ч'}</span>` +
      `</span>` +
    `</li>`).join('');

  const back = avgSell(c);
  document.getElementById('cmBack').innerHTML = back == null
    ? 'Очки прокачки не продаются — они сразу уходят в пропуск.'
    : c.price
      ? `Ненужный приз продается <b>в игре</b>, в среднем за <b>${back} Ч</b> — ` +
        `это около трети того, что дал бы пакет червонцев за ту же цену: кейс берут ` +
        `ради призов, а не ради червонцев. Червонцы с продажи идут в дневной предел ` +
        `<b>2000 Ч</b> вместе с пакетами; обратно на деньги они не меняются.`
      : `Ненужный приз продается <b>в игре</b>, в среднем за <b>${back} Ч</b>; ` +
        `эпическое и легендарное — в разы дороже обычного. Червонцы обратно ` +
        `на деньги не меняются.`;

  const shout = c.drops.map((d, i) => i >= SHOUT_FROM ? d.c : 0).reduce((a, b) => a + b, 0);
  document.getElementById('cmShout').innerHTML =
    `В общий чат уходит только <b>эпическое и легендарное</b> — это ${shout}% открытий. ` +
    `Остальное видит лично владелец: лента не превращается в спам.`;

  resetSpin();
  updateCaseFoot();
}

function updateCaseFoot() {
  /* Лавка закрыта (js/config.js) — цену в подписи не пишем вовсе, а не стираем
     потом: иначе сумма успевает мигнуть в кнопке на кадр.

     И барабаны при закрытой лавке не крутятся. Раньше здесь стояло обратное —
     «прокрутка бесплатная, это показ шансов», — но слово овнера прямое:
     «просматривать да, но не прокручивать же». Смотреть кейс можно целиком:
     состав, шансы каждого приза, среднюю цену продажи, — а прокрутка это уже
     действие лавки, и пока лавка закрыта, его нет. Выключаются все три
     управления сразу: кнопка, «сколько крутить» и «анимация» — последние два
     настраивают именно прокрутку, и живыми при мертвой кнопке они бы только
     обманывали. На их месте стоит честная строка (.cm-shut в donate.html). */
  const closed = !!(window.AEGIS && AEGIS.shopClosed);
  const total = cmCase.price * cmCount;
  /* 24.09: прокрутки на сайте нет и при открытой лавке (см. SITE_SPIN) —
     кнопка и «Анимация» спрятаны, «сколько» решает только сумму покупки. */
  document.getElementById('cmSpin').style.display = 'none';
  document.getElementById('cmSpeed').closest('.cm-row').style.display = 'none';
  document.getElementById('cmInGame').textContent = closed
    ? 'Кейс открыт на просмотр: что внутри, с каким шансом и за сколько продается — все ниже. ' +
      'Купить можно будет, когда откроется лавка.'
    : 'Крутится только в игре: купленный кейс приходит письмом, открыть его — /кейсы. ' +
      'Здесь — что внутри и с каким шансом.';
  if (closed) {
    document.querySelectorAll('#cmCount button, #cmSpeed button')
      .forEach(b => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); });
  }
  const buy = document.getElementById('cmBuy');
  if (cmCase.price && closed) {
    buy.hidden = false;
    buy.textContent = 'Пока не продается';
    buy.classList.add('btn-off');
    buy.disabled = true;
  } else if (cmCase.price) {
    buy.hidden = false;
    /* Косметики из этого кейса в игре еще нет — кейс не продается (shop-soon.js
       закрывает кнопку, касса отказывает по флагу later из prices.json). */
    if (cmCase.later) buy.setAttribute('data-later', '');
    else buy.removeAttribute('data-later');
    buy.dataset.rub = total;
    buy.dataset.buy = cmCount > 1
      ? `Кейс «${cmCase.name}» ×${cmCount}`
      : `Кейс «${cmCase.name}»`;
    buy.textContent = `Купить за ${total} ₽`;
  } else {
    buy.hidden = true;
  }
  mark('#cmCount button', b => +b.dataset.n === cmCount);
  mark('#cmSpeed button', b => (b.dataset.s === 'slow') === cmSlow);
}

function resetSpin() {
  const reels = document.getElementById('cmReels');
  const res = document.getElementById('cmResult');
  if (res) { res.innerHTML = ''; res.classList.remove('on'); }
  if (!reels) return;
  /* Лента стоит на месте еще до прокрутки: видно, что крутится и где
     остановится стрелка. Порядок — по кругу от обычного к легендарному,
     без случайности, чтобы витрина не «подсказывала» приз. */
  let html = '';
  for (let i = 0; i < 15; i++) html += cellHTML(cmCase, i % cmCase.drops.length, false);
  /* Восьмая ячейка (индекс 7) встает под стрелку отступом от середины
     ленты — чистым CSS, без замеров: окно в этот момент еще может быть скрыто. */
  reels.innerHTML =
    `<div class="reel reel-idle" style="--cell:${CELL[1]}px">` +
      `<div class="reel-track" style="margin-left:calc(50% - 7.5 * var(--cell))">${html}</div>` +
      `<span class="reel-mark"></span>` +
    `</div>`;
}

function cellHTML(c, i, win) {
  const d = c.drops[i];
  return `<span class="cell ${RAR[i].cls}${win ? ' win' : ''}">` +
    `${img(d.icon, PIX(d.icon))}<i>${esc(d.n)}</i></span>`;
}

/* Закрыта ли лавка. Сама прокрутка спрашивает об этом отдельно от подписей:
   подпись рисуется один раз при открытии карточки, а запуск барабанов надо
   отбивать в момент нажатия — на выключенную кнопку клик можно послать и
   мимо мышки (скриптом, клавишей, из консоли). */
function shopShut() {
  return !!(window.AEGIS && AEGIS.shopClosed);
}

/* Прокрутка на сайте выключена совсем (овнер, 24.09: «могут крутить крутки не
   заплатив рубли»). Барабан в браузере ничего не выдавал, но с ценой на кнопке
   читался как бесплатная крутка. Крутится только купленный кейс, в игре. */
const SITE_SPIN = false;

function spin() {
  if (!SITE_SPIN || cmBusy || shopShut()) return;
  cmBusy = true;

  const reels = document.getElementById('cmReels');
  const res = document.getElementById('cmResult');
  res.innerHTML = ''; res.classList.remove('on');
  reels.innerHTML = '';

  const cell = CELL[cmCount] || 60;
  const CELLS = 44, WIN_AT = 38;
  const wins = [];

  for (let n = 0; n < cmCount; n++) {
    const w = rollDrop(cmCase);
    wins.push(w);

    const reel = document.createElement('div');
    reel.className = 'reel';
    reel.style.setProperty('--cell', cell + 'px');

    let html = '';
    for (let i = 0; i < CELLS; i++) {
      const idx = i === WIN_AT ? w : Math.floor(Math.random() * cmCase.drops.length);
      html += cellHTML(cmCase, idx, i === WIN_AT);
    }
    reel.innerHTML = `<div class="reel-track">${html}</div><span class="reel-mark"></span>`;
    reels.appendChild(reel);
  }

  const base = CALM ? 0.5 : (cmSlow ? 5.4 : 1.3);
  const tracks = [...reels.querySelectorAll('.reel-track')];
  const width = reels.firstChild.clientWidth;

  requestAnimationFrame(() => {
    tracks.forEach((t, n) => {
      const jitter = (Math.random() - 0.5) * cell * 0.55;
      const dur = base + n * (CALM ? 0.02 : (cmSlow ? 0.22 : 0.09));
      t.style.transition = `transform ${dur}s cubic-bezier(.11,.72,.15,1)`;
      t.style.transform = `translateX(${-(WIN_AT * cell + cell / 2 - width / 2 + jitter)}px)`;
    });
  });

  const wait = (base + (cmCount - 1) * (CALM ? 0.02 : (cmSlow ? 0.22 : 0.09)) + 0.25) * 1000;
  setTimeout(() => {
    reels.querySelectorAll('.reel').forEach(r => r.classList.add('done'));
    showResult(wins);
    cmBusy = false;
  }, wait);
}

function showResult(wins) {
  const res = document.getElementById('cmResult');
  const sellable = !cmCase.noSell;
  const sum = sellable ? wins.reduce((s, i) => s + cmCase.drops[i].sell, 0) : 0;
  const shout = wins.filter(i => i >= SHOUT_FROM).length;

  res.innerHTML =
    `<div class="cr-cards">` +
      wins.map(i => {
        const d = cmCase.drops[i];
        return `<div class="cr-card ${RAR[i].cls}">` +
          `<span class="cr-ic">${img(d.icon, PIX(d.icon))}</span>` +
          `<b>${esc(d.n)}</b>` +
          `<i>${esc(RAR[i].label)}</i>` +
          (sellable ? `<span class="cr-sell">продать за ${d.sell} Ч</span>` : '') +
        `</div>`;
      }).join('') +
    `</div>` +
    `<div class="cr-sum">` +
      (sellable
        ? `<span>Продажа всего выпавшего в игре — <b>${sum} Ч</b>.</span>`
        : `<span>Очки уходят в пропуск сразу — продавать нечего.</span>`) +
      (shout
        ? `<span class="cr-shout">В чате объявится ${shout} из ${wins.length}: эпическое и выше.</span>`
        : `<span class="cr-quiet">В чат ничего не уйдет — до эпического не дотянуло.</span>`) +
    `</div>` +
    `<div class="cr-demo">Это демонстрация прокрутки: сайт ничего не списывает и не выдает. ` +
      `Настоящее открытие — в игре по <code>/кейсы</code>.</div>`;
  res.classList.add('on');
}

function openCase(id) {
  if (!caseModal) return;
  const c = caseById(id);
  if (!c) return;
  fillCase(c);
  openModal(caseModal);
}

if (caseModal) {
  renderCaseTiles();

  document.addEventListener('click', e => {
    const tile = e.target.closest('.case-tile');
    if (tile) openCase(tile.dataset.case);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tile = e.target.closest && e.target.closest('.case-tile');
    if (tile) { e.preventDefault(); openCase(tile.dataset.case); }
  });

  document.getElementById('cmCount').addEventListener('click', e => {
    const b = e.target.closest('button[data-n]');
    if (!b || cmBusy || shopShut()) return;
    cmCount = +b.dataset.n;
    resetSpin();
    updateCaseFoot();
  });
  document.getElementById('cmSpeed').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (!b || cmBusy || shopShut()) return;
    cmSlow = b.dataset.s === 'slow';
    updateCaseFoot();
  });
  document.getElementById('cmSpin').addEventListener('click', spin);
}

/* ============================================================
   3. БОЕВОЙ ПРОПУСК. Этап = 1000 очков, круг = 60 этапов,
   награда стоит на КАЖДОМ этапе. Юбилейные (каждый десятый) —
   единственное место, где лежат обычные лавочные кейсы;
   остальные этапы дают ресурсы, очки и косметику.
   Раскладка детерминированная: пул перебирается по номеру
   этапа, поэтому страница всегда рисует одно и то же.
   ============================================================ */

const PASS_MILE = {
  10: ['Кейс «Полевой склад»', 'Кейс «Заводской наряд»'],
  20: ['Кейс «Заводской наряд»', 'Кейс «Нефтяной контракт»'],
  30: ['Кейс «Нефтяной контракт»', 'Кейс «Арсенал»'],
  40: ['Кейс «Арсенал»', 'Кейс «Парадный расчет» ×2'],
  50: ['Кейс «Парадный расчет»', 'Кейс «Генштаб»'],
  60: ['Кейс «Генштаб» + 150 Ч', 'Кейс «Генштаб» ×2 + плащ круга']
};

const PASS_HALF = {
  5:  ['Кит «Снабжение» I', 'Плащ круга'],
  15: ['Кит I уровня на выбор', 'Кит II уровня на выбор'],
  25: ['Знамя круга', 'Значок «Ставка»'],
  35: ['60 Ч', 'Кит II уровня на выбор'],
  45: ['Кит II уровня на выбор', 'Скин-накидка круга'],
  55: ['Значок круга', 'Кит III уровня на выбор']
};

const PASS_FREE_POOL = [
  'Кейс «Штабные очки»',
  'Андезитовый сплав ×1024',
  '25 Ч',
  'Кейс «Промышленный обоз»',
  'Ротация задания ×2',
  'Коксовый уголь ×512',
  'Кейс «Штабные очки»',
  'Цветной ник на 7 дней',
  'Стальные трубы ×256'
];

const PASS_PAID_POOL = [
  'Кейс «Промышленный обоз»',
  'Механизм точности ×16',
  'Сталь ×256',
  'Кейс «Штабные очки» ×2',
  'Пропуск этапа ×1',
  'Латунь ×512',
  'Значок круга на выбор'
];

function passLevel(lvl) {
  if (PASS_MILE[lvl]) return { free: PASS_MILE[lvl][0], paid: PASS_MILE[lvl][1], mile: true };
  if (PASS_HALF[lvl]) return { free: PASS_HALF[lvl][0], paid: PASS_HALF[lvl][1], half: true };
  return {
    free: PASS_FREE_POOL[(lvl - 1) % PASS_FREE_POOL.length],
    paid: PASS_PAID_POOL[(lvl - 1) % PASS_PAID_POOL.length]
  };
}

function renderPass() {
  const grid = document.getElementById('bpGrid');
  if (!grid) return;

  let html =
    `<div class="bp-col bp-legend">` +
      `<div class="bp-lvl">Этап</div>` +
      `<div class="bp-cell bp-lgd">Бесплатно<span>всем и всегда</span></div>` +
      `<div class="bp-cell bp-lgd">Боевой ордер<span>169 ₽ за круг</span></div>` +
    `</div>`;

  for (let lvl = 1; lvl <= 60; lvl++) {
    const r = passLevel(lvl);
    const cls = r.mile ? ' mile' : (r.half ? ' half' : '');
    html +=
      `<div class="bp-col${cls}${lvl === 60 ? ' last' : ''}" id="bp-${lvl}">` +
        `<div class="bp-lvl">${lvl}</div>` +
        `<div class="bp-cell free">${esc(r.free)}</div>` +
        `<div class="bp-cell paid">${esc(r.paid)}</div>` +
      `</div>`;
  }
  grid.innerHTML = html;
}

renderPass();

const bpJump = document.getElementById('bpJump');
if (bpJump) {
  bpJump.addEventListener('click', e => {
    const b = e.target.closest('button[data-lvl]');
    if (!b) return;
    const col = document.getElementById('bp-' + b.dataset.lvl);
    const box = document.getElementById('bpScroll');
    if (col && box) {
      box.scrollTo({ left: col.offsetLeft - 170, behavior: CALM ? 'auto' : 'smooth' });
    }
    mark('#bpJump button', x => x === b, 'aria-current');
  });
}

/* ============================================================
   4. УСКОРЕНИЕ СЕРВЕРА. Лестница ×1.5…×5: чем выше множитель,
   тем короче окно и тем дороже шаг. Буст общий — работает всем,
   кто в этот момент онлайн.
   ============================================================ */

const BOOST = [
  { x: '1.5', min: 60, price: 259 },
  { x: '2',   min: 50, price: 339 },
  { x: '2.5', min: 43, price: 399 },
  { x: '3',   min: 37, price: 479 },
  { x: '3.5', min: 31, price: 539 },
  { x: '4',   min: 26, price: 599 },
  { x: '4.5', min: 20, price: 659 },
  { x: '5',   min: 15, price: 739 }
];

const boostRange = document.getElementById('boostRange');
if (boostRange) {
  const marks = document.getElementById('boostMarks');
  if (marks) marks.innerHTML = BOOST.map((b, i) =>
    `<button type="button" data-i="${i}">×${b.x}</button>`).join('');

  const setBoost = i => {
    const b = BOOST[i];
    boostRange.value = i;
    document.getElementById('boostX').textContent = '×' + b.x;
    document.getElementById('boostMin').textContent = b.min + ' минут';
    document.getElementById('boostPrice').innerHTML = `${b.price} <small>₽</small>`;
    money();
    const btn = document.getElementById('boostBuy');
    btn.dataset.rub = b.price;
    btn.dataset.buy = `Ускорение сервера ×${b.x} на ${b.min} минут`;
    if (marks) mark('#boostMarks button', x => +x.dataset.i === i);
  };

  boostRange.addEventListener('input', () => setBoost(+boostRange.value));
  if (marks) marks.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) setBoost(+b.dataset.i);
  });
  setBoost(0);
}

/* ============================================================
   5. СРОК ДЕЙСТВИЯ ЗВАНИЯ
   Цены и «по отдельности» лежат в data-атрибутах карточки —
   выгода считается здесь, чтобы проценты в верстке не расходились.
   ============================================================ */

/* С сезона 2 (25.10.2026, слово овнера) срок один — весь вайп. Подсказку под заголовком
   больше не переписываем: в ней ссылка на повышение за разницу. */
const PERIODS = {
  s: { key: 's', label: '/ весь вайп', word: 'весь вайп' }
};

function setPeriod(p) {
  const per = PERIODS[p];
  document.querySelectorAll('.rank').forEach(card => {
    const price = +card.dataset[per.key];
    const parts = +card.dataset['p' + per.key];
    const name = card.dataset.name;

    card.querySelector('.pv').textContent = price;
    card.querySelector('.per').textContent = per.label;

    /* У высших званий сравнивать не с чем: их услуги поштучно не продаются.
       Такие карточки идут без «по отдельности» — и выдумывать им процент
       выгоды нельзя, иначе ценник врет. */
    const pEl = card.querySelector('.parts');
    const sEl = card.querySelector('.save-pc');
    if (pEl && sEl && parts > 0) {
      pEl.textContent = parts + ' ₽';
      sEl.textContent = Math.round((1 - price / parts) * 100) + '%';
    }

    const btn = card.querySelector('button[data-rub]');
    btn.dataset.rub = price;
    btn.dataset.buy = `Привилегия «${name}» · ${per.word}`;
  });
  money();
}

// Переключателя срока нет: звание только на весь вайп.
if (document.querySelector('.rank[data-name]')) setPeriod('s');

/* Повышение за разницу. Лестница берется из самих карточек званий (data-s — цена
   на вайп), доплата = разница цен. Имя позиции совпадает с тем, что строит
   make_prices.py, — «Повышение «A» → «B»», иначе касса заказ не примет.
   «Сейчас» — все звания, кроме старшего; «Хочу» — только те, что выше. */
(() => {
  const from = document.getElementById('upgFrom');
  const to = document.getElementById('upgTo');
  const pv = document.getElementById('upgPv');
  const btn = document.getElementById('upgBuy');
  if (!from || !to || !pv || !btn) return;
  const ladder = [...document.querySelectorAll('.rank[data-name][data-s]')]
    .map(r => ({ name: r.dataset.name, rub: +r.dataset.s }));
  if (ladder.length < 2) return;
  let a = 0, b = Math.min(3, ladder.length - 1);

  const chip = (i, on) => {
    const x = document.createElement('button');
    x.type = 'button';
    x.dataset.i = i;
    x.textContent = ladder[i].name;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', on ? 'true' : 'false');
    return x;
  };
  function draw() {
    if (b <= a) b = a + 1;
    from.replaceChildren(...ladder.slice(0, -1).map((_, i) => chip(i, i === a)));
    to.replaceChildren(...ladder.map((_, i) => i).filter(i => i > a).map(i => chip(i, i === b)));
    const A = ladder[a], B = ladder[b];
    const rub = B.rub - A.rub;
    pv.textContent = rub;
    btn.dataset.rub = rub;
    btn.dataset.buy = `Повышение «${A.name}» → «${B.name}»`;
    money();
  }
  from.addEventListener('click', e => {
    const x = e.target.closest('button[data-i]');
    if (x) { a = +x.dataset.i; draw(); }
  });
  to.addEventListener('click', e => {
    const x = e.target.closest('button[data-i]');
    if (x) { b = +x.dataset.i; draw(); }
  });
  draw();
})();

/* ============================================================
   5б. НАБОРЫ МОДА AEGIS
   Ни одного числа тут нет нарочно: цена набора лежит в data-price
   карточки, цена каждой позиции — в data-v строки состава. Отсюда
   считаются и ценники по позициям, и «по отдельности», и выгода,
   и то, насколько полный арсенал дешевле четырех наборов порознь.
   Правится цена — правится одно место, а витрина пересчитывается сама.
   ============================================================ */

(function packs() {
  const cards = [].slice.call(document.querySelectorAll('.pack[data-price]'));
  if (!cards.length) return;

  let sum = 0;    // сколько стоят наборы, если брать их по одному
  let parts = 0;  // сколько стоило бы все это по позициям

  cards.forEach(card => {
    const price = +card.dataset.price || 0;
    let p = 0;
    card.querySelectorAll('.pk-list li[data-v]').forEach(li => {
      const v = +li.dataset.v || 0;
      p += v;
      const em = li.querySelector('em');
      if (em) em.textContent = v + ' ₽';
    });
    sum += price;
    parts += p;

    const pv = card.querySelector('.parts');
    const sv = card.querySelector('.save-pc');
    if (pv) pv.textContent = p + ' ₽';
    if (sv) sv.textContent = p ? Math.round((1 - price / p) * 100) + '%' : '—';
  });

  const all = document.querySelector('.pack-all[data-price]');
  if (!all) return;
  const price = +all.dataset.price || 0;

  function word(n) {
    const d = n % 10, t = n % 100;
    if (d === 1 && t !== 11) return 'набор';
    if (d > 1 && d < 5 && (t < 12 || t > 14)) return 'набора';
    return 'наборов';
  }
  function put(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  put('paSum', sum + ' ₽');
  put('paCnt', 'за ' + cards.length + ' ' + word(cards.length) + ' порознь');
  put('paParts', parts + ' ₽');

  /* Плашка со скидкой появляется, только если скидка есть на самом деле.
     Пустой красный ярлык «−0%» врал бы ровно там, где обещана выгода. */
  const save = document.getElementById('paSave');
  if (save) {
    const pc = sum > price ? Math.round((1 - price / sum) * 100) : 0;
    if (pc > 0) save.textContent = '−' + pc + '%';
    else save.remove();
  }
})();

/* ============================================================
   5.9 ПОДДЕРЖАТЬ ПРОЕКТ
   Раздел без товара: сумму называет сам человек, и взамен не
   выдается ничего. Готовые кнопки и поле показывают одно и то же
   число — платится то, что стоит в итоговой строке.

   Порог 10 ₽ взят снизу: меньше десятки не пропускают сами
   платежные службы, а отказ принять десятку читается хуже самой
   десятки. Потолок нужен по другой причине — опечатка в поле
   («10000» вместо «1000») не должна доходить до банка.
   ============================================================ */
(function () {
  const sw = document.getElementById('supSwitch');
  const own = document.getElementById('supOwn');
  const price = document.getElementById('supPrice');
  const go = document.getElementById('supGo');
  const note = document.getElementById('supNote');
  if (!sw || !own || !price || !go || !note) return;

  const MIN = 10, MAX = 30000;

  /* В поле прилетает всякое: пусто, «100 ₽» из буфера, дробное, минус.
     Вытаскиваем число, округляем до рубля и держим в пределах. */
  const clamp = v => {
    const n = Math.round(
      Number(String(v).replace(/[^\d.,]/g, '').replace(',', '.')) || 0);
    return Math.min(MAX, Math.max(MIN, n || MIN));
  };

  const paint = rub => {
    price.innerHTML = rub + ' <small>₽</small>';
    go.dataset.rub = rub;
    /* Строку «≈ 526 ₸» под ценой рисует js/money.js — он же знает курс
       и выбранную валюту. Зовем после каждой перерисовки числа. */
    if (window.AegisMoney) AegisMoney.prices();

    sw.querySelectorAll('button').forEach(b => {
      const on = Number(b.dataset.sum) === rub;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    /* Минимум называем и в валюте игрока: «от 10 ₽» человеку из Ташкента
       ничего не говорит, а «≈ 136 сум» говорит сразу. */
    const alt = window.AegisMoney ? AegisMoney.alt(MIN) : '';
    note.innerHTML = 'Списывается <b>рублевая</b> сумма — минимум ' + MIN + ' ₽' +
      (alt ? ' (' + alt + ')' : '') + ', за один раз не больше ' +
      MAX.toLocaleString('ru-RU') + ' ₽. В окне заказа ник можно не указывать: ' +
      'поддержка ничего не выдает, ник нужен только чтобы знать, кого благодарить.';
  };

  sw.addEventListener('click', e => {
    const b = e.target.closest('button[data-sum]');
    if (!b) return;
    own.value = b.dataset.sum;
    paint(Number(b.dataset.sum));
  });

  /* Пока набирают — только пересчитываем итог, само поле не трогаем: иначе
     «5» превратится в «10» под пальцами и дописать «00» уже не выйдет.
     Ровняем значение, когда из поля ушли. */
  own.addEventListener('input', () => paint(clamp(own.value)));
  own.addEventListener('change', () => { own.value = clamp(own.value); paint(Number(own.value)); });
  own.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    own.value = clamp(own.value);
    paint(Number(own.value));
    go.click();
  });

  /* Валюту меняют переключателем в разделе «Цены» — тогда меняется и
     минимум в подписи. */
  document.addEventListener('aegis:currency', () => paint(Number(go.dataset.rub) || MIN));

  paint(clamp(own.value));
})();

/* ============================================================
   5.91 СВОЕ ЧИСЛО ЧЕРВОНЦЕВ
   Пакеты выше — только ступени цены. Между ними цена идет по прямой,
   после самого крупного — по его цене за червонец, копейки вверх:
   так 149 Ч никогда не стоят дороже пакета на 150. Ступени берутся
   из самих карточек пакетов, а служба (shop.py, coins_rub) считает
   той же формулой по тем же пакетам — поменял цену пакета в разметке,
   поменялось и здесь, и у службы после shop-push.py.

   Потолок 2000 — суточный предел на аккаунт; сверх него служба
   заказ все равно не примет, так что поле его и не предлагает.
   ============================================================ */
(function () {
  const sw = document.getElementById('coinSwitch');
  const own = document.getElementById('coinOwn');
  const price = document.getElementById('coinPrice');
  const per = document.getElementById('coinPer');
  const go = document.getElementById('coinGo');
  if (!sw || !own || !price || !per || !go) return;

  const steps = [...document.querySelectorAll('#coins .goods [data-buy][data-rub]')]
    .map(b => [parseInt(b.dataset.buy, 10), Number(b.dataset.rub)])
    .filter(s => s[0] > 0 && s[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  if (steps.length < 2) return;

  const MIN = steps[0][0];
  const MAX = Number(own.max) || 2000;

  /* Целыми, как в shop.py: ceil(a / b) без дробей в середине. */
  const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
  const coinsRub = n => {
    for (let i = 0; i + 1 < steps.length; i++) {
      const [a, ra] = steps[i], [b, rb] = steps[i + 1];
      if (n >= a && n <= b) return ra + ceilDiv((n - a) * (rb - ra), b - a);
    }
    const [last, rl] = steps[steps.length - 1];
    return ceilDiv(n * rl, last);
  };

  /* Название позиции — то же, что собирает служба (coins_name). */
  const coinsName = n => {
    const d = n % 10, h = n % 100;
    if (d === 1 && h !== 11) return n + ' золотой червонец';
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return n + ' золотых червонца';
    return n + ' золотых червонцев';
  };

  const clamp = v => {
    const n = Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0);
    return Math.min(MAX, Math.max(MIN, n || MIN));
  };

  const paint = n => {
    const rub = coinsRub(n);
    price.innerHTML = rub + ' <small>₽</small>';
    per.textContent = n + ' Ч · ' +
      (rub / n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      ' ₽ за червонец';
    go.dataset.rub = rub;
    go.dataset.buy = coinsName(n);
    if (window.AegisMoney) AegisMoney.prices();

    sw.querySelectorAll('button').forEach(b => {
      const on = Number(b.dataset.n) === n;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  sw.addEventListener('click', e => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    own.value = b.dataset.n;
    paint(Number(b.dataset.n));
  });

  /* Как у поддержки: пока набирают — только пересчет, ровняем на выходе
     из поля, иначе «1» превратится в «50» под пальцами. */
  own.addEventListener('input', () => paint(clamp(own.value)));
  own.addEventListener('change', () => { own.value = clamp(own.value); paint(Number(own.value)); });
  own.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    own.value = clamp(own.value);
    paint(Number(own.value));
    go.click();
  });

  paint(clamp(own.value));
})();

/* ============================================================
   5.95 ЧЕКИ ЗАКАЗОВ
   Человек ошибается в нике чаще, чем кажется: «l» вместо «I»,
   старый ник, ник друга. Деньги при этом уходят, а покупка —
   не туда, и в обращениях остается только «я точно платил».
   Чек закрывает ровно эту дыру: номер заказа, позиция, сумма,
   ник и время в одном тексте, который кладется в буфер одной
   кнопкой. По номеру платеж находится сразу, выдачу поправят.

   Список лежит в браузере самого человека и никуда не уходит:
   сайт статический, чужих заказов он не видит и видеть не должен.
   Это не замена чеку платежной службы — тот приходит на почту
   и является документом; наш нужен поддержке, а не банку.
   ============================================================ */
const AegisRcpt = (function () {
  const KEY = 'aegis_orders';
  const LIMIT = 12;                /* больше и не нужно: чек живет до разбора */
  const ST = { new: 'Ждет оплату', paid: 'Оплачено', failed: 'Платеж не прошел' };
  const esc = s => (window.AegisApi ? AegisApi.esc(s) : String(s == null ? '' : s));

  const all = () => {
    try {
      const l = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(l) ? l : [];
    } catch (e) { return []; }      /* приватный режим или мусор в хранилище */
  };
  const put = l => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, LIMIT))); } catch (e) { } };

  /* Дату держим числом, а не строкой: строку пришлось бы разбирать обратно,
     а формат у нее зависит от языка браузера. */
  const when = ts => {
    const d = new Date(ts || Date.now());
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
      ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  const text = r =>
    'AEGIS SMP — чек заказа\n' +
    'Номер: ' + r.id + '\n' +
    'Позиция: ' + r.sku + '\n' +
    'Сумма: ' + r.rub + ' ₽\n' +
    'Ник: ' + (r.nick || 'не указан') + '\n' +
    'Оформлен: ' + when(r.at) + '\n' +
    'Состояние: ' + (ST[r.status] || ST.new);

  /* Буфер обмена дается не всем: старый браузер, file:// у овнера, отказ
     в разрешении. Поэтому у каждой карточки есть и сам текст — если положить
     не вышло, он раскрывается и выделяется, чтобы скопировать руками. */
  const toClipboard = txt => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt);
    }
    return new Promise((ok, no) => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta);
      done ? ok() : no();
    });
  };

  let focusId = '';                /* заказ, с оплаты которого человек вернулся */

  const card = r =>
    '<div class="rcpt' + (r.id === focusId ? ' is-focus' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="rcpt-top"><b>' + esc(r.sku) + '</b>' +
        '<span class="rcpt-sum">' + esc(String(r.rub)) + ' ₽</span></div>' +
      '<div class="rcpt-meta">№ ' + esc(r.id) + ' · ' + when(r.at) +
        (r.nick ? ' · ник ' + esc(r.nick) : ' · ник не указан') + '</div>' +
      (r.note ? '<div class="rcpt-note">' + esc(r.note) + '</div>' : '') +
      '<div class="rcpt-foot">' +
        '<span class="rcpt-st is-' + esc(r.status || 'new') + '">' +
          (ST[r.status] || ST.new) + '</span>' +
        '<button type="button" class="rcpt-copy">Скопировать чек</button>' +
      '</div>' +
      '<pre class="rcpt-text" hidden>' + esc(text(r)) + '</pre>' +
    '</div>';

  const draw = () => {
    const box = document.getElementById('rcpts');
    const list = document.getElementById('rcptsList');
    if (!box || !list) return;
    const l = all();
    box.hidden = !l.length;
    /* Блок появляется после того, как страница уже проехала мимо, — значит
       своего появления по прокрутке он не дождется. Показываем сразу. */
    if (l.length) box.classList.add('in');
    list.innerHTML = l.map(card).join('');
  };

  document.addEventListener('click', e => {
    const b = e.target.closest('.rcpt-copy');
    if (!b) return;
    const pre = b.closest('.rcpt').querySelector('.rcpt-text');
    toClipboard(pre.textContent).then(() => {
      b.textContent = 'Скопировано';
      setTimeout(() => { b.textContent = 'Скопировать чек'; }, 2000);
    }, () => {
      pre.hidden = false;
      b.textContent = 'Скопируй вручную';
      const rng = document.createRange();
      rng.selectNodeContents(pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(rng);
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', draw);
  } else {
    draw();
  }

  return {
    text: text,
    copy: toClipboard,
    add: r => { const l = all().filter(x => x.id !== r.id); l.unshift(r); put(l); draw(); },
    get: id => all().find(x => x.id === id) || null,
    all: all,
    mark: (id, status, note, fin) => {
      const l = all();
      const r = l.find(x => x.id === id);
      if (!r) return;
      r.status = status;
      if (note !== undefined) r.note = note;
      if (fin !== undefined) r.fin = !!fin;
      put(l);
      draw();
    },
    focus: id => {
      focusId = id;
      draw();
      const el = document.querySelector('.rcpt.is-focus');
      if (el) el.scrollIntoView({ block: 'center' });
    }
  };
})();

/* Возврат с оплаты. Платежка отправляет человека обратно на
   donate.html?order=№ — это новая вкладка, окна заказа в ней нет, и без
   этого блока он видел бы просто витрину, а чек так и висел бы «Ждет
   оплату»: отметку ставит только открытое окно заказа, а его часто
   закрывают. Поэтому при каждом заходе спрашиваем службу о чеках, что еще
   не закрыты, а вернувшийся заказ показываем сверху и следим за ним, пока
   оплата и выдача не пройдут.

   Касса (Robokassa) возвращает на donate.html?Shp_order=№ и с удачной, и
   с неудачной оплаты: адрес с параметрами при GET кабинет не принимает.
   Удачный возврат несет SignatureValue, неудачный — нет (а без номера
   берем последний неоплаченный чек этого браузера). Старый ?fail=1 тоже
   понимаем; параметры ищем по всему адресу.

   Карты Украины, Азербайджана и других стран Robokassa не берет — их
   принимает второй способ, PayPalych. Его кнопка ведет на службу
   (/pay/go/pp), та заводит счет и отправляет на оплату, а если нельзя —
   возвращает сюда с ?order=№&pp=причина.

   ?pay=№ — ссылка «оплатить за меня»: заплатить может и другой человек —
   он видит, что, кому и сколько, и платит без входа, а покупка приходит
   на аккаунт оформившего. Такой заказ — не свой, чеком его не заводим. */

/* Какой картой платит этот браузер: 'ru' — России или СНГ (Robokassa) либо
   российского банка (ЮMoney), 'world' — Украины, Азербайджана или другой
   страны (PayPalych или донат на DonationAlerts). Не выбирал — угадываем по
   валюте из js/money.js: гривна и манат — это 'world', а при ЮMoney (strict)
   и любая не рублевая: карты банков вне России он не берет. */
const payCard = {
  get(strict) {
    try {
      const v = localStorage.getItem('aegis_card');
      if (v === 'ru' || v === 'world') return v;
    } catch (e) { /* приватный режим — угадываем */ }
    const cur = window.AegisMoney ? AegisMoney.code() : '';
    return (strict ? cur && cur !== 'RUB' : cur === 'UAH' || cur === 'AZN') ? 'world' : 'ru';
  },
  set(v) {
    try { localStorage.setItem('aegis_card', v === 'world' ? 'world' : 'ru'); }
    catch (e) { /* не запомним — в другой раз угадаем снова */ }
  },
  /* адрес оплаты под выбранную карту; второго способа нет — первый */
  url(pay, pay2, card) { return (card || this.get()) === 'world' && pay2 ? pay2 : pay; }
};

/* Донат на DonationAlerts — запасной способ для карт, которые не берет
   основной (ЮMoney принимает только карты российских банков): там платят
   картой любой страны и в своей валюте. Подставить сумму и текст на их
   страницу снаружи нельзя, поэтому показываем их здесь с «Скопировать».
   Номер заказа в сообщении доната — и служба лавки находит заказ сама.
   Суммы во всех восьми валютах страницы доната считает служба (da.amounts)
   по курсу ЦБ с запасом 3% и запоминает в заказе: игрок платит ровно то,
   что увидел, и завтрашний курс его не подведет. Не хватило — служба
   складывает донаты и присылает остаток (da.got, da.left). */
const AegisDA = {
  /* Валюты страницы доната DonationAlerts — других она не принимает. */
  CURS: ['RUB', 'USD', 'EUR', 'KZT', 'UZS', 'TRY', 'PLN', 'BRL'],
  SIGN: { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', UZS: 'сўм', TRY: '₺', PLN: 'zł', BRL: 'R$' },
  NAME: { RUB: 'рубли', USD: 'доллары', EUR: 'евро', KZT: 'тенге', UZS: 'сумы', TRY: 'лиры',
    PLN: 'злотые', BRL: 'реалы' },
  KEY: 'aegis_da_cur',
  /* Какую валюту показать: выбранную тут раньше, иначе валюту сайта, если
     страница доната ее берет, иначе доллары. */
  pick(a) {
    let c = '';
    try { c = localStorage.getItem(this.KEY) || ''; } catch (e) { /* приватный режим */ }
    if (a[c]) return c;
    const M = window.AegisMoney;
    c = M && M.code ? M.code() : '';
    if (a[c]) return c;
    return a.USD ? 'USD' : 'RUB';
  },
  /* Число как его вписывают в поле суммы: точка, без пробелов. */
  raw(v) { return String(Math.round(Number(v) * 100) / 100); },
  show(v) {
    const [i, f] = this.raw(v).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + f : '');
  },
  html(id, rub, da, nick) {
    const esc = s => AegisApi.esc(String(s == null ? '' : s));
    const d = da || {};
    const part = !!(d.got && d.got.length && d.left);
    /* сколько платить в каждой валюте: остаток, если часть уже пришла */
    const src = part ? d.left : d.amounts || {};
    const a = {};
    this.CURS.forEach(c => { if (Number(src[c]) > 0) a[c] = Number(src[c]); });
    if (!a.RUB) a.RUB = part ? Number(d.left_rub) || Number(rub) : Number(rub);
    const cur = this.pick(a);
    const code = 'AEGIS ' + (d.code || id);
    const row = (label, value, cls) => `<span class="m-da-lab">${label}</span>` +
      `<div class="m-friend-row${cls ? ' ' + cls : ''}"><input type="text" readonly value="${esc(value)}" ` +
      `aria-label="${esc(label.replace(/<[^>]+>/g, ''))}"><button type="button" class="m-out">Скопировать</button></div>`;
    const chips = this.CURS.filter(c => a[c]).map(c =>
      `<button type="button" class="m-da-cur${c === cur ? ' on' : ''}" data-cur="${c}" ` +
      `data-v="${esc(this.raw(a[c]))}" aria-pressed="${c === cur}">` +
      `<b>${esc(this.show(a[c]))} ${esc(this.SIGN[c])}</b><span>${c}</span></button>`).join('');
    const who = nick ? esc(nick) : 'твой ник в игре';
    const cn = `<b class="m-da-cn">${cur}</b>`;
    /* Куда ведет кнопка — адресом, как у оплаты картой: недоверчивый
       покупатель сверит его с адресной строкой, а «v1nezerro» на той
       странице перестает быть загадкой. */
    let where = '';
    try {
      const u = new URL(d.page);
      where = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
    } catch (e) { /* адреса нет — промолчим */ }
    return (part
      ? '<p class="m-da-part"><b>Пришло не все.</b> Через DonationAlerts уже дошло ' +
        `<b>${esc(d.got.join(' + '))}</b> — этого меньше цены. Доплати остаток тем же способом ` +
        'и с тем же сообщением — заказ проведется сам, донаты сложатся.</p>'
      : '<p><b>Оплата донатом на DonationAlerts</b> — картой любой страны. Донат здесь и есть ' +
        'оплата: по номеру в сообщении служба сама находит заказ и выдает покупку.' +
        (where ? ` Страница доната проекта — <b>${esc(where)}</b>, кнопка ниже ведет только туда.` : '') +
        ' Выбери валюту: сумма в ней уже посчитана и закреплена за заказом.</p>') +
      `<div class="m-da-curs" role="group" aria-label="Валюта доната">${chips}</div>` +
      row(`${part ? 'Доплатить' : 'Сумма'} в ${cn}`, this.raw(a[cur]), 'm-da-sum') +
      row('Сообщение', code) +
      '<ol class="m-da-steps">' +
      '<li>Нажми <b>«Открыть страницу доната»</b>.</li>' +
      `<li>Справа от суммы выбери валюту ${cn} и вставь сумму ровно как здесь — лишнего не надо.</li>` +
      `<li>Имя — <b>${who}</b>.</li>` +
      `<li>Переключатель — <b>«Текст»</b>, не «Аудио». В сообщение вставь <b>${esc(code)}</b>.</li>` +
      '<li>Оплати картой — любой страны.</li></ol>' +
      '<p class="m-da-note">' + (d.auto === false
        ? 'Донат сверим по номеру и проведем заказ вручную — статус виден в чеке внизу страницы. '
        : 'Заказ проведется сам: через минуту-две после доната здесь появится «Оплачено». ' +
          'Окно можно закрыть — покупка все равно придет на почту в игре. ' +
          'Перепутал номер в сообщении — служба все равно найдет заказ по сумме и нику. ') +
      'Имя и сообщение доната могут показаться на стриме — ничего личного туда не пиши.</p>';
  },
  wire(root) {
    root.querySelectorAll('.m-da-cur').forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.cur;
      try { localStorage.setItem(this.KEY, c); } catch (e) { /* приватный режим */ }
      root.querySelectorAll('.m-da-cur').forEach(x => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      root.querySelectorAll('.m-da-cn').forEach(x => { x.textContent = c; });
      const inp = root.querySelector('.m-da-sum input');
      if (inp) inp.value = b.dataset.v;
    }));
    root.querySelectorAll('.m-da .m-friend-row').forEach(row => {
      const inp = row.querySelector('input');
      const b = row.querySelector('button');
      inp.addEventListener('focus', () => inp.select());
      b.addEventListener('click', () => AegisRcpt.copy(inp.value).then(() => {
        b.textContent = 'Скопировано';
        setTimeout(() => { b.textContent = 'Скопировать'; }, 2000);
      }, () => { inp.focus(); inp.select(); b.textContent = 'Выделено — Ctrl+C'; }));
    });
  }
};

(function () {
  if (!window.AegisApi || !AegisApi.base()) return;
  const href = location.href;
  const back = (href.match(/[?&](?:order|shp_order)=([A-Z0-9]{4,24})\b/i) || [])[1] || '';
  const forId = (href.match(/[?&]pay=([A-Z0-9]{4,24})\b/i) || [])[1] || '';
  /* Почему служба не пустила на оплату картой другой страны (см. pp_go
     в shop.py). Неизвестную причину не показываем вовсе. */
  const PP_SAY = {
    off: ['Оплата картой другой страны сейчас выключена',
      'Деньги не списывались. Попробуй позже или картой России или СНГ.'],
    pay: ['Сервис оплаты не ответил — деньги не списаны',
      'Попробуй еще раз через пару минут.'],
    slow: ['Слишком много попыток подряд',
      'Деньги не списывались. Подожди минут десять и попробуй снова.'],
    many: ['У заказа кончились попытки оплаты картой другой страны', ''],
    under: ['Деньги пришли не полностью', '']
  };
  const ppRaw = (href.match(/[?&]pp=([a-z]{2,8})\b/) || [])[1] || '';
  const ppWhy = back && Object.prototype.hasOwnProperty.call(PP_SAY, ppRaw) ? ppRaw : '';
  /* Robokassa не берет Fail URL с параметрами при GET, поэтому Success и Fail
     у нее один адрес — donate.html. Отличаем по подписи: SignatureValue она
     кладет только в возврат с удачной оплаты. */
  const rkFail = /[?&]shp_order=/i.test(href) && !/[?&]SignatureValue=/i.test(href);
  const fail = /[?&]fail=1\b/.test(href) || rkFail || !!ppWhy;
  let ppNow = ppWhy;
  const WEEK = 7 * 864e5;
  /* Закрытые чеки (выдано, поддержка дошла, платеж не прошел) и совсем
     старые больше не трогаем. */
  const pending = r => !r.fin && r.status !== 'failed' && Date.now() - (r.at || 0) < WEEK;
  const box = document.getElementById('payfor');
  const esc = s => AegisApi.esc(String(s == null ? '' : s));

  /* Номера, которые этот браузер оплачивал за других: вернувшись с кассы,
     такой номер показываем блоком «оплата за игрока», а не своим чеком. */
  const PF = 'aegis_payfor';
  const pfList = () => {
    try { const l = JSON.parse(localStorage.getItem(PF) || '[]'); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  };
  const pfAdd = id => {
    try { localStorage.setItem(PF, JSON.stringify([id].concat(pfList().filter(x => x !== id)).slice(0, 10))); }
    catch (e) { /* приватный режим — вернемся обычным чеком, не беда */ }
  };

  /* ---- блок #payfor
     kind: 'for' — открыта ссылка «оплатить за меня»;
           'own' — своя оплата сорвалась (вернулись с ?fail=1). */
  let pfTimer = 0, pfLeft = 0, pfHtml = '';
  const payLink = id => location.origin + location.pathname + '?pay=' + encodeURIComponent(id);

  const drawPay = (id, kind, r, failNow) => {
    if (!box) return;
    const nick = r.nick ? esc(r.nick) : '';
    const alt = window.AegisMoney ? AegisMoney.alt(r.rub) : '';
    const rows =
      `<div><dt>Покупка</dt><dd>${esc(r.sku)}</dd></div>` +
      `<div><dt>Сумма</dt><dd><b class="pf-sum">${esc(r.rub)} ₽</b>` +
      (alt ? ` <small>${esc(alt)} по курсу ЦБ</small>` : '') + `</dd></div>` +
      (nick ? `<div><dt>${kind === 'own' ? 'Аккаунт' : 'Придет игроку'}</dt><dd>${nick}</dd></div>` : '') +
      `<div><dt>Номер заказа</dt><dd class="pf-id">${esc(id)}</dd></div>`;
    let kick = kind === 'own' ? 'Оплата не завершена' : 'Оплата за игрока';
    let title = '', text = '', acts = '', friend = false;
    /* причина от службы — только у заказа, с которым сюда вернулись, и
       только пока снова не нажали «оплатить» */
    const why = id === back ? ppNow : '';
    const renew = kind === 'own' ? 'оформи покупку заново в лавке ниже'
      : `пусть ${nick || 'игрок'} оформит новый заказ и пришлет свежую ссылку`;
    /* ЮMoney берет только карты российских банков — остальным донат на
       DonationAlerts (AegisDA): блок с суммой и номером идет под кнопками. */
    const ym = r.main === 'yoomoney';
    /* донат уже частью пришел — доплату показываем, даже если способ
       с тех пор сменили: служба сложит ее с прошлым донатом */
    const daPart = !!(r.da && r.da.page && r.da.got && r.da.got.length && r.status !== 'paid');
    const daOn = daPart || !!(r.da && r.da.page && !r.pay2 && r.status === 'wait');
    let da = false;
    const daSay = ' Карта другой страны — донат на DonationAlerts: ниже все, что туда вписать.';

    /* Кнопки оплаты. Второго способа нет — одна; есть — две, и первой идет
       та карта, которой этот браузер платил в прошлый раз. only: 'ru' —
       только первый способ (второй по этому заказу уже не откроется). */
    const btn = (url, card, label, main) =>
      `<a class="btn ${main ? 'btn-primary' : 'btn-dark'}" data-card="${card}" href="${esc(url)}" ` +
      `target="_blank" rel="noopener">${label}</a>`;
    const payBtns = (one, only) => {
      if (!r.pay2 || only === 'ru') return btn(r.pay, 'ru', one, true);
      const w = payCard.get(ym) === 'world';
      const ru = btn(r.pay, 'ru', ym ? 'Карта российского банка' : 'Карта России или СНГ', !w);
      const world = btn(r.pay2, 'world', ym ? 'Карта другой страны'
        : 'Карта Украины, Азербайджана или другой страны', w);
      return w ? world + ru : ru + world;
    };

    if (r.status === 'paid') {
      title = 'Оплачено — спасибо!';
      text = r.support ? 'Поддержка дошла.'
        : r.given ? `${nick || 'Игрок'} уже забрал покупку в игре.`
        : r.mail ? `Покупка ждет ${nick || 'игрока'} на почте сервера — в игре он заберет ее ` +
                   'командой <code>/mail</code>.'
        : esc(r.note);
      /* Robokassa сама шлет чек самозанятого на почту плательщика; у второго
         способа чек выписывается вручную — выдаем его по обращению. */
      /* у ЮMoney и доната чек на почту не приходит — не обещаем */
      text += r.via === 'pp'
        ? ' Чек самозанятого пришлем по <a href="tickets">обращению</a> с номером заказа.'
        : r.via ? '' : ' Чек об оплате приходит на почту, указанную при оплате.';
    } else if (daPart) {
      title = 'Не хватает доплаты';
      text = 'Донат дошел, но на меньшую сумму, чем цена. Деньги не пропали — они записаны ' +
        'на этот заказ. Доплати остаток донатом, как ниже, и заказ проведется сам.';
      da = true;
    } else if (r.status === 'failed') {
      title = 'Заказ закрыт';
      text = 'Оплатить его уже нельзя — ' + renew + '.';
    } else if (!r.pay && daOn) {
      /* карту сейчас не принять, но донат дойдет так же */
      title = kind === 'own' ? 'Оплата донатом' : `Оплати покупку для ${nick || 'игрока'}`;
      text = (kind === 'own' ? '' : 'Вход не нужен: покупка придет на аккаунт ' + (nick || 'игрока') +
        ' — на почту сервера. ') + 'Оплата картой сейчас выключена — заплати донатом на ' +
        'DonationAlerts, это можно картой любой страны.' +
        (pfLeft > 0 ? ' Ждем донат — как дойдет, здесь появится «Оплачено».' : '');
      da = true;
    } else if (!r.pay) {
      title = 'Оплата сейчас недоступна';
      text = 'Платежный сервис не отвечает. Деньги не списывались — попробуй через несколько минут.';
    } else if (why === 'under') {
      /* часть денег уже пришла: вторая оплата целиком — это переплата */
      title = PP_SAY.under[0];
      text = 'Оплата картой другой страны пришла не на всю сумму. Платить еще раз не нужно — ' +
        'напиши <a href="tickets">обращение</a> с номером заказа, разберемся вручную.';
    } else if (why) {
      title = PP_SAY[why][0];
      text = why === 'many'
        ? 'Если деньги списались — напиши <a href="tickets">обращение</a> с номером ' +
          'заказа. Если нет — ' + renew + (r.pay2 ? (ym ? ' или оплати картой российского банка.'
          : ' или оплати картой России или СНГ.') : '.')
        : PP_SAY[why][1];
      acts = payBtns('Попробовать снова', why === 'many' || why === 'off' ? 'ru' : '');
      friend = kind === 'own';
      da = daOn;
    } else if (kind === 'own') {
      title = 'Деньги не списаны';
      text = r.pay2
        ? 'Заказ еще ждет оплаты. Карта не прошла — выбери другой способ: карты ' +
          (ym ? 'не российских банков' : 'Украины, Азербайджана и других стран') + ' принимает второй.'
        : ym ? 'Заказ еще ждет оплаты — можно попробовать снова: другой картой российского банка ' +
          'или кошельком ЮMoney.' + (daOn ? daSay : '')
        : 'Заказ еще ждет оплаты — можно попробовать снова: другой картой или через СБП.';
      acts = payBtns('Попробовать снова');
      friend = true;
      da = daOn;
    } else if (failNow) {
      title = 'Оплата не прошла — деньги не списаны';
      text = r.pay2 ? 'Можно попробовать еще раз — другой картой или другим способом.'
        : ym ? 'Можно попробовать еще раз — другой картой российского банка или кошельком ЮMoney.' +
          (daOn ? daSay : '')
        : 'Можно попробовать еще раз: другой картой или через СБП.';
      acts = payBtns('Попробовать снова');
      da = daOn;
    } else if (pfLeft > 0) {
      title = 'Ждем подтверждение оплаты';
      /* Вернулись с оплаты — она уже ушла, второй кнопки не даем. Нажали
         «Оплатить» здесь — окно оплаты могли закрыть раньше времени. */
      if (back === id) {
        text = 'Обычно это меньше минуты — страница обновится сама.';
      } else {
        const card = payCard.get(ym);
        text = 'Как только платеж подтвердится, здесь появится «Оплачено»' +
          (daOn ? ' — донат проверяется раз в полминуты' : '') + '. ' +
          'Закрыл окно оплаты раньше времени — открой его снова.';
        acts = btn(payCard.url(r.pay, r.pay2, card), r.pay2 ? card : 'ru', 'Открыть оплату снова', false);
        da = daOn;            /* донат ищется дольше — номер и сумма пусть остаются на виду */
      }
    } else {
      title = nick ? `Оплати покупку для ${nick}` : 'Оплати покупку для игрока';
      text = 'Вход не нужен: покупка придет на аккаунт ' + (nick || 'игрока') + ' — на почту сервера. ' +
        (ym ? 'Картой любого российского банка или кошельком ЮMoney — кнопка ниже.' +
            (r.pay2 ? ' Карта другой страны — Казахстана, Беларуси, Украины и остальных — вторая кнопка, ' +
              'сумма в рублях, банк пересчитает сам.' : daOn ? daSay : '')
          : 'Карта России, Казахстана, Беларуси, Узбекистана и других стран СНГ платит в своей ' +
            'валюте — банк пересчитает сам.' +
            (r.pay2 ? ' Карта Украины, Азербайджана или другой страны — вторая кнопка.'
              : daOn ? daSay : ''));
      acts = payBtns(ym ? `Оплатить картой · ${esc(r.rub)} ₽` : `Оплатить ${esc(r.rub)} ₽`);
      da = daOn;
    }

    const html =
      `<div class="pf-head"><span class="pf-kick">${kick}</span><h2>${title}</h2></div>` +
      `<dl class="pf-rows">${rows}</dl>` +
      `<p class="pf-text">${text}</p>` +
      (acts ? `<div class="pf-acts">${acts}</div>` : '') +
      (da ? `<div class="m-friend m-da"><span class="m-da-head">${daPart ? 'Доплата донатом'
        : r.pay ? 'Карта другой страны' : 'Оплата донатом'}</span>` + AegisDA.html(id, r.rub, r.da, r.nick) +
        `<a class="btn btn-dark m-da-go" href="${esc(r.da.page)}" target="_blank" rel="noopener">` +
        'Открыть страницу доната</a></div>' : '') +
      (friend ? `<div class="pf-friend"><span>Ссылка «оплатить за меня»</span>` +
        `<div class="m-friend-row"><input type="text" readonly value="${esc(payLink(id))}" ` +
        `aria-label="Ссылка «оплатить за меня»"><button type="button" class="m-out">Скопировать</button>` +
        `</div></div>` : '') +
      `<p class="pf-foot">Что-то не так — <a href="tickets">обращение</a> с номером заказа.</p>`;
    /* Пока ждем оплату, блок перерисовывается каждые пять секунд: тот же
       текст не трогаем, иначе посреди копирования номера все мигало бы. */
    if (html === pfHtml && !box.hidden) return;
    pfHtml = html;
    box.innerHTML = html;
    box.hidden = false;

    box.querySelectorAll('.pf-acts [data-card]').forEach(go => go.addEventListener('click', () => {
      if (r.pay2) payCard.set(go.dataset.card);
      ppNow = '';
      watchPay(id, kind);
    }));
    AegisDA.wire(box);
    const daGo = box.querySelector('.m-da-go');
    if (daGo) daGo.addEventListener('click', () => { ppNow = ''; watchPay(id, kind, 240); });
    const cp = box.querySelector('.pf-friend button');
    if (cp) {
      const inp = box.querySelector('.pf-friend input');
      inp.addEventListener('focus', () => inp.select());
      cp.addEventListener('click', () => AegisRcpt.copy(inp.value).then(() => {
        cp.textContent = 'Скопировано';
        setTimeout(() => { cp.textContent = 'Скопировать'; }, 2000);
      }, () => { inp.focus(); inp.select(); cp.textContent = 'Выделено — Ctrl+C'; }));
    }
  };

  const failBox = (kind, text) => {
    if (!box) return;
    box.innerHTML = `<div class="pf-head"><span class="pf-kick">${kind === 'own' ? 'Оплата не завершена'
      : 'Оплата за игрока'}</span><h2>${esc(text)}</h2></div>`;
    box.hidden = false;
  };

  /* Касса подтверждает перевод серверу, а не браузеру, — поэтому после
     нажатия «Оплатить» блок сам переспрашивает службу пять минут. */
  const askPay = (id, kind, failNow) =>
    AegisApi.call('/shop/pay?id=' + encodeURIComponent(id), { auth: false }).then(r => {
      if (kind === 'own' && r.status === 'paid') {
        /* своя оплата прошла — хватит и чека внизу, блок не нужен */
        if (box) box.hidden = true;
        ask(id).catch(() => { });
        return r;
      }
      drawPay(id, kind, r, failNow);
      return r;
    });

  /* n — сколько раз переспросить: донат служба ищет раз в полминуты, и
     человек еще заполняет форму, поэтому ему даем двадцать минут, а не пять */
  const watchPay = (id, kind, n) => {
    clearTimeout(pfTimer);
    pfLeft = n || 60;
    const tick = () => askPay(id, kind).then(r => {
      if (r.status === 'wait' && --pfLeft > 0) { pfTimer = setTimeout(tick, 5000); return; }
      /* пять минут вышли, а оплаты нет — возвращаем обычный вид с кнопкой */
      if (pfLeft > 0 || r.status !== 'wait') { pfLeft = 0; return; }
      drawPay(id, kind, r);
    }, () => { if (--pfLeft > 0) pfTimer = setTimeout(tick, 5000); });
    pfTimer = setTimeout(tick, 5000);
  };

  const toBox = scroll => { if (scroll && box && !box.hidden) box.scrollIntoView({ block: 'start' }); };
  const showPay = (id, kind, failNow, scroll) => askPay(id, kind, failNow).then(() => toBox(scroll), e => {
    if (e.code === 'none') {
      /* выдуманный номер у своего чека не рисуем; у ссылки — говорим честно */
      if (kind === 'for') failBox(kind, 'Ссылка не найдена — проверь, что она скопирована целиком.');
    } else {
      failBox(kind, 'Не удалось связаться с лавкой — обнови страницу через минуту.');
    }
    toBox(scroll);
  });

  const ask = id => AegisApi.call('/shop/order?id=' + encodeURIComponent(id), { auth: false })
    .then(r => {
      if (!AegisRcpt.get(id)) {
        /* Оплатил в другом браузере или почистил хранилище — чек заводим
           по ответу службы, ник она не отдает. */
        AegisRcpt.add({ id: id, sku: r.sku || 'Заказ', rub: r.rub, nick: '', at: r.at || Date.now(),
          status: 'new' });
      }
      const st = r.status === 'paid' ? 'paid' : r.status === 'failed' ? 'failed' : 'new';
      AegisRcpt.mark(id, st, r.note || '', r.fin);
      return r;
    });

  /* Оплата за другого: открыли ссылку или вернулись с кассы после нее. */
  const other = forId || (back && pfList().indexOf(back) >= 0 ? back : '');
  if (other) {
    pfAdd(other);
    if (back === other && !fail) {
      pfLeft = 60;                    /* «ждем подтверждение», а не «оплати» */
      showPay(other, 'for', false, true).then(() => watchPay(other, 'for'));
    } else {
      showPay(other, 'for', fail && back === other, true);
    }
  }

  AegisRcpt.all().filter(r => r.id !== back && r.id !== other && pending(r))
    .forEach(r => ask(r.id).catch(() => { }));
  if (other) return;

  /* Своя оплата сорвалась: номер от кассы, а нет его — последний
     неоплаченный чек этого браузера за сутки. */
  let mine = back;
  if (!mine && fail) {
    const r = AegisRcpt.all().find(x => x.status === 'new' && !x.fin && Date.now() - (x.at || 0) < 864e5);
    mine = r ? r.id : '';
  }
  if (fail && mine) showPay(mine, 'own', false, true);
  if (!back) return;

  let left = 60, shown = false;
  const tick = () => ask(back).then(r => {
    /* с неудачной оплаты листаем к блоку «попробовать снова», а не к чеку */
    if (!shown) { shown = true; if (!fail) AegisRcpt.focus(back); }
    if ((r.status === 'wait' || r.wait_give) && --left > 0) setTimeout(tick, 5000);
  }, e => {
    /* Номера нет у службы — молчим: подделанная ссылка не должна рисовать чек. */
    if (e.code !== 'none' && --left > 0) setTimeout(tick, 5000);
  });
  tick();
})();

/* ============================================================
   6. ОФОРМЛЕНИЕ ЗАКАЗА
   Ценник у позиции один и сразу в рублях. Покупку оформляет только
   вошедший игрок — тем же ником и паролем, что в лаунчере: так служба
   знает, на чей аккаунт выдавать и кому прислать чек в Discord, а набрать
   чужой ник с ошибкой просто негде. Поддержке проекта вход не нужен —
   выдавать там нечего.
   ============================================================ */

const modal = document.getElementById('buyModal');
if (modal) {
  const mTitle = document.getElementById('mTitle');
  const mItem = document.getElementById('mItem');
  const mPrice = document.getElementById('mPrice');
  const mNick = document.getElementById('mNick');
  const mPromo = document.getElementById('mPromo');
  const mSteps = document.getElementById('mSteps');
  const mGo = document.getElementById('mGo');
  const mLabel = modal.querySelector('label[for="mNick"]');
  const mNickOpt = document.getElementById('mNickOpt');
  const mPromoLabel = modal.querySelector('label[for="mPromo"]');
  const mCopy = document.getElementById('mCopy');
  const mAcc = document.getElementById('mAcc');
  const mAccLead = document.getElementById('mAccLead');
  const mAccNick = document.getElementById('mAccNick');
  const mOut = document.getElementById('mOut');
  const mLogin = document.getElementById('mLogin');
  const mLNick = document.getElementById('mLNick');
  const mLPass = document.getElementById('mLPass');
  const mLGo = document.getElementById('mLGo');
  const mLSay = document.getElementById('mLSay');
  const mFriend = document.getElementById('mFriend');
  const mFLink = document.getElementById('mFLink');
  const mFCopy = document.getElementById('mFCopy');
  const mCard = document.getElementById('mCard');
  const mCardIn = mCard ? Array.from(mCard.querySelectorAll('input[name="mCard"]')) : [];
  const mSure = document.getElementById('mSure');
  const mDa = document.getElementById('mDa');
  const LOGIN_HELP = mLSay.innerHTML;

  let support = false;       /* окно открыто для поддержки, а не для покупки */
  let order = null;          /* текущий заказ на сервере, пока ждем оплату */
  let payUrl = '';           /* его страница оплаты — чтобы открыть повторно */
  let payUrl2 = '';          /* то же для карт Украины, Азербайджана и других стран */
  let pay2On = false;        /* служба сказала в расчете цены, что второй способ есть */
  let mainRail = '';         /* чья страница оплаты у первого способа (из расчета цены) */
  let daOn = false;          /* донат на DonationAlerts подключен (из того же расчета) */
  let daInfo = null;         /* у заведенного заказа: {page, auto, code, amounts[, got, left]} */
  let daGot = '';            /* что из донатов уже дошло — перерисовываем, только когда меняется */
  let orderNick = '';        /* на чей ник заказ — его же вписать в имя доната */
  let orderNote = '';        /* что служба сказала про заказ при его заведении */
  let payOpened = false;     /* страницу оплаты картой по этому заказу уже открывали */
  let lastQ = {};            /* как дойдет покупка (auto/mail) — из того же расчета */
  let price = 0;             /* сумма к оплате: ее же пишем на кнопке */
  let poll = 0;              /* таймер опроса; гасим при закрытии окна */
  let quoteSeq = 0;          /* номер последнего расчета цены — старые ответы не слушаем */
  let quoteTimer = 0;

  /* Три состояния приема денег, от лучшего к худшему:
       'api'    — служба сервера жива: заказ заводится на сервере, и покупка
                  выдается сама, как только платежка подтвердит перевод;
       'manual' — службы нет, но есть страница приема переводов: платим туда,
                  ник пишем в комментарии, выдает человек;
       'off'    — принимать деньги пока некуда, и врать об этом нельзя. */
  const payMode = () => {
    if (window.AegisApi && AegisApi.base()) return 'api';
    if (DONATE_READY) return 'manual';
    return 'off';
  };

  const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
  const esc = s => AegisApi.esc(String(s == null ? '' : s));

  /* Вход живет там же, где у кабинета (js/api.js, sessionStorage): вошел
     в кабинете — лавка уже знает тебя, и наоборот. */
  const who = () => {
    const s = window.AegisApi ? AegisApi.session() : null;
    return s && s.token && s.nick ? s : null;
  };

  /* Сумма — прямо на кнопке: человек видит, сколько спишут, еще до ухода
     на страницу оплаты. Остальные подписи кнопки (заказ уже заведен, прием
     закрыт) ставятся напрямую и суммы не несут. */
  const goLabel = () => (daPath() ? 'Оформить заказ' : 'Перейти к оплате') +
    (price ? ' · ' + price + ' ₽' : '');

  const showPrice = (rub, base) => {
    price = Number(rub) || 0;
    /* Валюта игрока — только подписью: списывается все равно рублевая сумма,
       и заказ на сервер уходит в рублях. См. js/money.js. */
    const inCur = window.AegisMoney ? AegisMoney.alt(rub) : '';
    mPrice.innerHTML = (base && base !== rub ? `<s class="m-was">${base} ₽</s> ` : '') +
      `${rub} <small>₽</small>` +
      (inCur ? `<span class="m-alt">${inCur} по курсу ЦБ на ${AegisMoney.date()}</span>` : '');
  };

  const show = (el, on) => { if (el) el.hidden = !on; };

  /* Подсказка «сейчас действует код» под полем промокода. Сам код не
     подставляем: он дается на аккаунт один раз, и тратить его на покупку,
     которую человек только разглядывает, нельзя. Видна, пока поле пустое
     и заказ не заведен. */
  const mPromoHint = document.getElementById('mPromoHint');
  let promoHint = null;      /* {code, pc, until} из расчета цены */
  const hintUntil = u => {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d:\d\d))?$/.exec(u || '');
    if (!m) return '';
    return m[4] ? ` до ${m[3]}.${m[2]}, ${m[4]} МСК` : ` до ${m[3]}.${m[2]} включительно`;
  };
  const drawHint = () => {
    const h = promoHint;
    const on = !!(h && !mPromo.hidden && !order && !mPromo.value.trim());
    show(mPromoHint, on);
    if (!on || !mPromoHint) return;
    mPromoHint.innerHTML = `Сейчас действует <b>${esc(h.code)}</b> — −${Number(h.pc)}%` +
      `${hintUntil(h.until)}, один раз на аккаунт. ` +
      '<button type="button" class="m-promo-use">Применить</button>';
  };

  /* Выбор карты. Второй способ — для карт, которые основной не берет:
     PayPalych рядом с Robokassa или донат на DonationAlerts рядом с ЮMoney
     (тот принимает только карты российских банков). Показываем выбор, только
     когда служба подтвердила, что второй способ подключен; до заказа отметку
     ставим по прошлому выбору или по валюте (payCard). После заказа выбор
     остается: не прошла карта — переключил и заплатил другим способом. */
  const card = () => {
    const c = mCardIn.find(i => i.checked);
    return c ? c.value : payCard.get(mainRail === 'yoomoney');
  };
  const twoWays = () => pay2On || (daOn && !!mainRail);
  /* Платим донатом: до заказа — по расчету цены, после — по тому, что
     служба дала этому заказу (способ могли выключить между ними). */
  const daPath = () => order
    ? !!daInfo && (!!daGot || !payUrl2 && (!payUrl || card() === 'world'))
    : !pay2On && daOn && (!mainRail || card() === 'world');
  /* Подписи вариантов — под то, что подключено: в разметке стоят подписи
     пары Robokassa + PayPalych. */
  const CARD_TXT = mCardIn.map(i => i.nextElementSibling ? i.nextElementSibling.innerHTML : '');
  const cardText = () => {
    const ym = mainRail === 'yoomoney';
    mCardIn.forEach((inp, k) => {
      const s = inp.nextElementSibling;
      if (!s) return;
      if (pay2On && ym) {
        /* ЮMoney берет только российские банки — все остальное идет на PayPalych */
        s.innerHTML = inp.value === 'ru'
          ? '<b>Карта российского банка</b><small>Через ЮMoney: картой любого российского банка ' +
            'или кошельком ЮMoney.</small>'
          : '<b>Карта другой страны</b><small>Казахстан, Беларусь, Украина, Азербайджан и остальные — ' +
            'через PayPalych. Сумма в рублях — банк пересчитает в твою валюту.</small>';
      } else if (pay2On) s.innerHTML = CARD_TXT[k];
      else if (inp.value === 'ru') {
        s.innerHTML = ym ? '<b>Карта российского банка</b><small>Через ЮMoney: картой любого ' +
          'российского банка или кошельком ЮMoney.</small>' : CARD_TXT[k];
      } else {
        s.innerHTML = '<b>Карта другой страны</b><small>' + (ym
          ? 'Украина, Азербайджан, Казахстан, Беларусь и остальные'
          : 'Украина, Азербайджан и остальные') +
          ' — донатом на DonationAlerts: в тенге, долларах, евро и еще пяти валютах.</small>';
      }
    });
  };
  const showCard = on => {
    show(mCard, on);
    if (!on) return;
    cardText();
    if (mCardIn.some(i => i.checked)) return;
    const want = payCard.get(mainRail === 'yoomoney');
    mCardIn.forEach(i => { i.checked = i.value === want; });
  };
  mCardIn.forEach(i => i.addEventListener('change', () => {
    if (!i.checked) return;
    payCard.set(i.value);
    /* до заказа меняются шаги и подпись кнопки, после — блок доната */
    if (order) { drawOrder(false); return; }
    drawHow();                 /* в шагах меняется имя сервиса оплаты и чек */
    if (payMode() === 'api') mGo.textContent = goLabel();
  }));

  /* Чья страница оплаты откроется — называем заранее: уход с сайта на чужой
     адрес не пугает, когда о нем сказали до нажатия. Карты другой страны
     идут через PayPalych или донатом; первый способ служба называет в
     расчете цены. */
  const railName = () => {
    if (daPath()) return 'DonationAlerts';
    if ((pay2On && card() === 'world') || mainRail === 'paypalych') return 'PayPalych';
    return { robokassa: 'Robokassa', yoomoney: 'ЮMoney' }[mainRail] || '';
  };

  /* «Что будет дальше» — тремя шагами вместо абзаца: где платишь, где ждать
     покупку, где чек. Как дойдет покупка, решает служба и сообщает в расчете
     цены: mail — оплаченное ложится на почту сервера и забирается в игре
     командой /mail (так приходит и купленное до старта сезона); auto —
     служба зачисляет сама; иначе выдает команда сервера. Пока расчет не
     пришел, обещаем только то, что верно в любом случае. Чек об оплате
     Robokassa шлет сама, у PayPalych его выписывают вручную — по обращению;
     сообщение в личку Discord присылает бот, если Discord привязан. */
  const stepPay = () => {
    const rail = railName();
    if (rail === 'DonationAlerts') {
      return '<b>Оплата донатом на DonationAlerts.</b> Сначала оформишь заказ — покажем сумму и ' +
        'номер, которые вписать в донат. Данные карты вводишь там — сайт AEGIS их не видит.';
    }
    return '<b>Оплата на странице ' + (rail || 'платежного сервиса') + '.</b> Данные карты ' +
      'вводишь там — сайт AEGIS их не видит и не хранит.';
  };
  const howList = (me, auto, mail) => {
    const give = mail === true
      ? '<b>Покупка ляжет на почту сервера.</b> В игре придет письмо, забрать — командой ' +
        '<code>/mail</code>. Если ты еще не заходил на сервер, письмо дождется первого входа.'
      : auto === true
        ? '<b>Покупка придет на аккаунт сама</b> — сразу после оплаты.'
        : auto === false
          ? '<b>Заказ сразу уходит команде сервера</b> — она выдает покупку на этот ник.'
          : '<b>Покупка придет на этот аккаунт</b> — ник набирать не нужно.';
    /* Чек на почту шлет только Robokassa; у ЮMoney и доната его нет —
       подтверждение дает само окно и чек внизу страницы. */
    const rail = railName();
    const rcpt = (rail === 'PayPalych'
      ? '<b>Чек самозанятого</b> пришлем по <a href="tickets">обращению</a> с номером заказа'
      : rail === 'Robokassa'
        ? '<b>Чек об оплате</b> придет на почту, которую укажешь при оплате'
        : '<b>Подтверждение оплаты</b> появится здесь и в чеке внизу страницы') +
      (me.ds === true ? ', а в личку Discord бот пришлет подтверждение с номером заказа.'
        : me.ds === false ? '. Discord к аккаунту не привязан — в личку ничего не придет, ' +
          'на выдачу это не влияет.'
        : '.');
    return '<ol class="m-how"><li>' + stepPay() + '</li><li>' + give + '</li><li>' + rcpt +
      '</li></ol>';
  };
  const supList = me => '<ol class="m-how"><li>' + stepPay() + '</li><li><b>Это не покупка</b> — ' +
    'взамен ничего не выдается. ' + (me ? 'Поблагодарим тебя по нику.'
      : 'Ник можно оставить, чтобы мы знали, кого благодарить, а можно и не оставлять.') +
    '</li></ol>';

  /* Шаги перерисовываются при выборе карты и по ответу расчета — но только
     пока заказа нет: дальше в этой строке живет его состояние. */
  const drawHow = () => {
    if (order || payMode() !== 'api') return;
    const me = who();
    if (support) mSteps.innerHTML = supList(me);
    else if (me) mSteps.innerHTML = howList(me, lastQ.auto, lastQ.mail);
    else return;
    if (quoteNote.textContent) mSteps.appendChild(quoteNote);
  };

  /* Под кнопкой — что будет, если что-то пойдет не так, и на каких условиях.
     Обещание ровно то, что в оферте (п. 7): пока покупка не пришла на почту,
     деньги возвращаются по заявке. Продавец и ссылка на оферту берутся из
     js/config.js и появляются, когда они там вписаны. */
  const drawSure = on => {
    if (!mSure) return;
    show(mSure, on);
    if (!on) return;
    const A = window.AEGIS || {};
    mSure.innerHTML = (support
      ? 'Списалось дважды или не та сумма — напиши <a href="tickets">обращение</a>, вернем.'
      : 'Покупка не пришла — вернем деньги или выдадим вручную: напиши ' +
        '<a href="tickets">обращение</a> с номером заказа.') +
      (A.seller ? ' Продавец — ' + esc(A.seller) + '.' : '') +
      (A.offer ? ' Оплачивая, соглашаешься с <a href="' + esc(A.offer) + '">офертой</a>.' : '');
  };

  /* Раскладка окна под режим приема денег и под то, вошел ли человек.
     Вызывается при открытии, после входа и после выхода. */
  const render = () => {
    const how = payMode();
    const me = how === 'api' ? who() : null;
    const gate = how === 'api' && !support && !me;   /* покупка без входа */

    show(mLogin, gate);
    show(mAcc, !!me);
    show(mOut, true);          /* прошлый заказ мог ее спрятать (lockOrder) */
    show(mSteps, !gate);
    show(mGo, !gate);
    showCard(how === 'api' && !gate && twoWays());
    drawSure(how === 'api' && !gate);
    mGo.disabled = false;
    showPrice(Number(mItem.dataset.rub), 0);
    mGo.textContent = how === 'api' ? goLabel() : 'Перейти к оплате';

    /* Поле ника: у покупки его заменяет вход, у поддержки оно по желанию
       и только пока человек не вошел. */
    const nickOn = how !== 'off' && (how === 'manual' || (support && !me));
    show(mLabel, nickOn);
    show(mNick, nickOn);
    show(mNickOpt, support);
    /* У поддержки промокода нет и быть не может: скидка на пожертвование —
       это просто другая сумма, а поле рядом с ней сбивает с толку. */
    const promoOn = !support && how !== 'off' && (how === 'manual' || !!me);
    show(mPromoLabel, promoOn);
    show(mPromo, promoOn);
    drawHint();

    if (me) {
      mAccLead.textContent = support ? 'Поддержка от имени' : 'Покупка придет на аккаунт';
      mAccNick.textContent = me.nick;
    }

    if (gate) {
      mLSay.innerHTML = LOGIN_HELP;
      mLSay.className = 'm-login-help';
      try { if (!mLNick.value) mLNick.value = localStorage.getItem('aegis_nick') || ''; }
      catch (err) { /* приватный режим */ }
      return;
    }

    if (how === 'api') {
      lastQ = {};
      drawHow();
      askQuote();              /* у поддержки цена та же, но так узнаем про второй способ */
    } else if (how === 'manual' && support) {
      mSteps.innerHTML = 'Спасибо. Взамен ничего не выдается — это <b>не покупка</b>, ' +
        'и в комментарии к переводу ничего писать не надо.';
    } else if (how === 'manual') {
      mSteps.innerHTML = 'В комментарии к переводу — <b>игровой ник</b>, а следом промокод, ' +
        'если он есть. Скидка по промокоду и −5% премиума считаются при выдаче.';
    } else {
      /* Пускать человека на несуществующую страницу оплаты нельзя: живая
         кнопка, ведущая в никуда, хуже честной строки. */
      mSteps.innerHTML = support
        ? 'Прием платежей <b>пока не открыт</b> — страница оплаты появится ' +
          'позже. Спасибо за намерение: оно тут не пропадет, но и денег сейчас ' +
          'взять неоткуда.'
        : 'Прием платежей <b>пока не открыт</b> — страница оплаты появится ' +
          'позже. Цены и состав уже окончательные, так что выбрать можно заранее.';
      mGo.textContent = 'Оплата пока закрыта';
      mGo.disabled = true;
    }
  };

  /* Вход устарел или его сняли — возвращаем окно к форме входа и говорим
     почему, а не молча прячем кнопку оплаты. */
  const lost = text => {
    AegisApi.setSession(null);
    render();
    if (!text) return;
    if (!mLogin.hidden) {
      mLSay.innerHTML = esc(text) + '<br>' + LOGIN_HELP;
      mLSay.className = 'm-login-help is-bad';
    } else {
      /* у поддержки формы входа нет — пишем в строку под ценой */
      mSteps.textContent = text + ' Поддержку можно отправить и без входа.';
    }
  };

  /* Итоговая цена считается на сервере — промокод, −5% премиума и лимит
     червонцев в сутки знает только он. Сайт показывает ответ как есть и
     сам ничего не вычитает: иначе цену можно было бы подправить в браузере. */
  const quoteNote = document.createElement('span');
  quoteNote.className = 'm-q';
  const askQuote = () => {
    clearTimeout(quoteTimer);
    const seq = ++quoteSeq;
    const promo = mPromo.value.trim();
    const q = '/shop/quote?sku=' + encodeURIComponent(mItem.dataset.sku) +
      '&rub=' + encodeURIComponent(mItem.dataset.rub) +
      '&promo=' + encodeURIComponent(promo);
    AegisApi.call(q).then(r => {
      if (seq !== quoteSeq || order) return;
      showPrice(r.rub, r.base);
      pay2On = !!r.pay2;
      mainRail = r.main || '';
      daOn = !!r.da;
      promoHint = r.hint || null;
      drawHint();
      lastQ = { auto: r.auto, mail: r.mail };
      showCard(twoWays());
      quoteNote.textContent = r.lines && r.lines.length
        ? 'Скидка: ' + r.lines.join(', ') + '.' : '';
      quoteNote.remove();
      drawHow();               /* сама добавит строку скидки, если она есть */
      mGo.disabled = false;
      mGo.textContent = goLabel();
    }, e => {
      if (seq !== quoteSeq || order) return;
      if (e.code === 'auth' || e.code === 'login') { lost(AegisApi.textOf(e)); return; }
      /* Сеть моргнула — не страшно: заказ все равно пересчитает цену. А вот
         отказ по делу (промокод, лимит червонцев, устаревшая цена) показываем. */
      if (['net', 'timeout', 'http', 'bad'].indexOf(e.code) >= 0) return;
      showPrice(Number(mItem.dataset.rub), 0);
      mGo.textContent = goLabel();
      quoteNote.textContent = AegisApi.textOf(e);
      mSteps.appendChild(quoteNote);
      /* С неверным промокодом оплату не блокируем — поле можно очистить.
         С лимитом и устаревшей ценой заказ все равно не пройдет. */
      mGo.disabled = e.code !== 'promo';
    });
  };
  mPromo.addEventListener('input', () => {
    drawHint();
    if (payMode() !== 'api' || support || !who() || order) return;
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(askQuote, 450);
  });
  if (mPromoHint) mPromoHint.addEventListener('click', e => {
    if (!e.target.closest('.m-promo-use') || !promoHint || order) return;
    mPromo.value = promoHint.code;
    drawHint();
    askQuote();
  });

  /* Карточка «Промокоды»: есть у службы действующий код для всех — пишем
     его вместо общей строки; не ответила — строка остается прежней. */
  const pcCode = document.getElementById('pcCode');
  if (pcCode && payMode() === 'api') {
    AegisApi.call('/shop/promo', { auth: false }).then(r => {
      const h = (r.items || [])[0];
      if (!h) return;
      pcCode.innerHTML = `сейчас: <b>${esc(h.code)}</b> — −${Number(h.pc)}%` +
        `${hintUntil(h.until)} · один раз на аккаунт, ввод в окне оплаты`;
    }, () => {});
  }

  const openBuy = (item, rub, isSup) => {
    order = null;
    payUrl = '';
    payUrl2 = '';
    daInfo = null;
    daGot = '';
    promoHint = null;          /* подсказку пришлет свежий расчет цены */
    orderNote = '';
    payOpened = false;
    support = !!isSup;
    stopPoll();
    show(mDa, false);
    quoteSeq++;
    quoteNote.remove();
    quoteNote.textContent = '';  /* скидка прошлой позиции сюда не переезжает */
    /* Чек показывается, только когда у заказа есть номер: копировать
       «номер: —» смысла нет. */
    if (mCopy) { mCopy.hidden = true; mCopy.textContent = 'Скопировать чек'; }
    show(mFriend, false);
    mTitle.textContent = support ? 'Поддержка проекта' : 'Оформление заказа';
    mItem.textContent = item;
    mItem.dataset.sku = item;
    mItem.dataset.rub = rub;
    render();

    /* Фокус — на первое, что надо заполнить; если заполнять нечего,
       его берет крестик, как в остальных окнах. */
    let first = null;
    if (!mLogin.hidden) first = mLNick.value ? mLPass : mLNick;
    else if (!mNick.hidden) first = mNick;
    openModal(modal, first);
  };

  /* ------------------------------------------------------------ вход */

  const doLogin = () => {
    const nick = mLNick.value.trim();
    const pass = mLPass.value;
    if (!NICK_RE.test(nick)) {
      mLSay.textContent = 'Ник — от 3 до 16 латинских букв, цифр или «_».';
      mLSay.className = 'm-login-help is-bad';
      mLNick.focus();
      return;
    }
    if (!pass) {
      mLSay.textContent = 'Впиши пароль — тот же, что в лаунчере.';
      mLSay.className = 'm-login-help is-bad';
      mLPass.focus();
      return;
    }
    mLGo.disabled = true;
    mLGo.textContent = 'Входим…';
    AegisApi.call('/cab/login', { body: { nick: nick, pass: pass }, auth: false }).then(r => {
      AegisApi.setSession({
        token: r.token, nick: r.nick, role: r.role || '', admin: !!r.admin,
        until: r.until, ds: r.ds
      });
      mLPass.value = '';
      try { localStorage.setItem('aegis_nick', r.nick); } catch (err) { /* ignore */ }
      render();
    }, e => {
      mLSay.innerHTML = esc(AegisApi.textOf(e)) + '<br>' + LOGIN_HELP;
      mLSay.className = 'm-login-help is-bad';
      mLPass.select();
    }).then(() => {
      mLGo.disabled = false;
      mLGo.textContent = 'Войти';
    });
  };
  mLGo.addEventListener('click', doLogin);
  [mLNick, mLPass].forEach(el => el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || mLGo.disabled) return;
    e.preventDefault();
    doLogin();
  }));

  /* «Сменить» — выйти и войти другим ником: у кого два аккаунта, тот
     должен видеть, на какой уйдет покупка, и уметь это поменять. */
  mOut.addEventListener('click', () => {
    if (order) return;
    AegisApi.call('/cab/logout', { body: {} }).catch(() => { /* ключ все равно забываем */ });
    AegisApi.setSession(null);
    render();
    if (!mLogin.hidden) mLNick.focus();
  });

  /* Кнопки китов, кейсов и буста рисуются скриптом, поэтому слушаем
     документ целиком, а не вешаем обработчик на каждую. */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    /* Лавка закрыта (js/config.js): кнопки уже выключены и переподписаны
       в js/shop-closed.js, но до окна заказа не должно доходить и в обход —
       с клавиатуры или через только что перерисованную карточку. */
    if (window.AEGIS && AEGIS.shopClosed) return;
    /* «Откроется позже» (js/shop-soon.js): касса такую позицию все равно не примет. */
    if (btn.hasAttribute('data-soon')) return;
    /* заказ поверх карточки кита или кейса — ту карточку закрываем */
    const host = btn.closest('.modal-wrap');
    if (host && host !== modal) closeModal(host);
    const { buy, rub } = btn.dataset;
    if (rub) openBuy(buy, rub, btn.hasAttribute('data-support'));
  });

  const closeAll = () => {
    document.querySelectorAll('.modal-wrap.open').forEach(closeModal);
    if (poll) { clearInterval(poll); poll = 0; }
  };

  document.querySelectorAll('.modal-wrap').forEach(wrap => {
    const x = wrap.querySelector('.m-close');
    if (x) x.addEventListener('click', () => closeModal(wrap));
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(wrap); });
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  /* Опрос заказа. Платежка подтверждает перевод не мгновенно и не браузеру,
     а серверу, поэтому окно ждет и само переписывает строку состояния.
     Текст берем у службы: только она знает, выдается покупка сама или
     ее выдает команда. Опрос конечный: пять минут, дальше человеку
     предлагается заглянуть в игру — вечно крутящаяся надпись хуже
     честного «проверь сам». */
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = 0; } };

  /* Заказ заведен — аккаунт и промокод в нем уже записаны. Кнопку «Сменить»
     и поле промокода прячем, чтобы не казалось, что их еще можно поменять;
     оплата не прошла — возвращаем, заказ оформят заново. */
  const lockOrder = on => {
    show(mOut, !on);
    const promoOn = !on && !support && !!who();
    show(mPromoLabel, promoOn);
    show(mPromo, promoOn);
    drawHint();
  };

  const AFTER = ' Если что-то не так — скопируй чек и приложи к ' +
    '<a href="tickets">обращению</a>: по номеру заказа платеж находится сразу.';

  /* long — ждем донат: служба ищет его раз в полминуты, а человек еще
     заполняет форму на DonationAlerts, поэтому двадцать минут, а не пять. */
  const watchOrder = (id, long) => {
    let left = long ? 240 : 60;
    let seen = false;          /* оплату уже показали — ждем только зачисления */
    stopPoll();
    poll = setInterval(() => {
      if (--left < 0) {
        stopPoll();
        if (!seen) {
          mSteps.innerHTML = (long
            ? 'Донат пока не найден. Если он ушел — проверь, что в сообщении был номер ' +
              'заказа, и напиши в <a href="tickets">обращения</a>, приложив чек — кнопка ниже.'
            : 'Оплату пока не видно. Если деньги ушли — покупка придет ' +
              'сама, загляни в кабинет или в игру через пару минут, либо напиши в ' +
              '<a href="tickets">обращения</a> и приложи чек — кнопка ниже.');
        }
        return;
      }
      AegisApi.call('/shop/order?id=' + encodeURIComponent(id), { auth: false }).then(r => {
        if (r.status === 'paid') {
          if (!r.wait_give) stopPoll();
          if (!seen || !r.wait_give) { seen = true; AegisRcpt.mark(id, 'paid', r.note, r.fin); }
          mGo.hidden = true;
          if (mCopy) mCopy.hidden = false;
          mSteps.innerHTML = '<b>' + esc(r.note) + '</b>' + (support ? '' : AFTER);
          show(mFriend, false);    /* оплачено — платить за него больше некому */
          show(mDa, false);
          showCard(false);
          drawSure(false);         /* что делать при ошибке — уже сказано в AFTER */
        } else if (r.da && r.da.page && r.da.got && r.da.got.length) {
          /* донат дошел не весь — показываем остаток; ждать доплату снова
             двадцать минут: человеку еще идти на страницу доната */
          const got = r.da.got.join(' + ');
          if (got !== daGot) {
            daGot = got;
            daInfo = r.da;
            orderNote = r.note || orderNote;
            left = 240;
            drawOrder();
            mGo.hidden = false;
          }
        } else if (r.status === 'failed') {
          stopPoll();
          show(mFriend, false);    /* заказ закрыт — ссылка на него мертва */
          show(mDa, false);
          AegisRcpt.mark(id, 'failed', r.note, true);
          order = null;
          payUrl = '';
          payUrl2 = '';
          daInfo = null;
          daGot = '';
          payOpened = false;
          showCard(twoWays());
          mGo.hidden = false;
          mGo.disabled = false;
          mGo.textContent = 'Оформить заново';
          mSteps.textContent = r.note || 'Оплата не прошла.';
          lockOrder(false);
        }
      }, () => { /* сеть моргнула — просто ждем следующего круга */ });
    }, 5000);
  };

  /* Строка заказа под выбранный способ. Донат — сумма и номер на виду
     (вписать их надо самому) и кнопка на страницу доната; карта — адрес
     страницы оплаты, чтобы новая вкладка не казалась чужой. opened —
     страница оплаты картой только что открылась. */
  const drawOrder = opened => {
    if (!order) return;
    const da = daPath();
    show(mDa, da);
    if (da) {
      mDa.innerHTML = AegisDA.html(order, price, daInfo, orderNick);
      AegisDA.wire(mDa);
      /* При недоплате служба пишет остаток в рублях, а платить его в валюте
         доната — эту строку не дублируем, остаток уже в рамке ниже. */
      const part = !!(daInfo.got && daInfo.got.length && daInfo.left);
      mSteps.innerHTML = 'Заказ <b>№' + esc(order) + '</b>. ' +
        (part ? 'Ждем доплату — сколько, написано ниже.' : esc(orderNote)) +
        ' Номер заказа сохранен в чеке внизу страницы.';
      mGo.textContent = 'Открыть страницу доната';
      return;
    }
    const url = payCard.url(payUrl, payUrl2, card());
    let host = '';
    try { host = url ? new URL(url).hostname : ''; } catch (err) { /* кривой адрес — промолчим */ }
    mSteps.innerHTML = 'Заказ <b>№' + esc(order) + '</b>. ' + esc(orderNote) +
      (host ? (opened ? ' Страница оплаты открылась в новой вкладке — адрес <b>'
        : ' Кнопка ниже откроет страницу оплаты — адрес <b>') + esc(host) + '</b>.' : '') +
      ' Окно можно не закрывать — как оплатишь, здесь появится подтверждение. ' +
      'Номер заказа сохранен в чеке внизу страницы.';
    mGo.textContent = payOpened ? 'Снова к оплате' : 'Перейти к оплате';
  };

  mGo.addEventListener('click', () => {
    /* Заказ уже заведен — второе нажатие открывает ту же оплату, а не плодит
       новый заказ (окно платежки часто закрывают случайно). */
    if (order && daPath()) {
      open(daInfo.page, '_blank', 'noopener');
      watchOrder(order, true);
      return;
    }
    if (order && payUrl) {
      open(payCard.url(payUrl, payUrl2, card()), '_blank', 'noopener');
      payOpened = true;
      drawOrder(true);
      watchOrder(order);
      return;
    }

    const how = payMode();
    if (how === 'off') return;                 /* кнопка уже отключена в render() */
    const me = how === 'api' ? who() : null;

    /* Покупка без входа сюда не доходит (кнопки нет), но вход мог
       истечь, пока окно было открыто. */
    if (how === 'api' && !support && !me) { lost(''); return; }

    let nick = me ? me.nick : mNick.value.trim();
    /* Поддержке ник не нужен: выдавать нечего. Пустое поле пропускаем, а вот
       набранное с ошибкой — нет, иначе «спасибо» уйдет не тому. */
    if (!me && !NICK_RE.test(nick) && !(support && nick === '')) {
      mNick.focus();
      mNick.value = '';
      mNick.placeholder = 'Ник: 3–16 знаков, латиница и цифры';
      return;
    }
    const promo = support ? '' : mPromo.value.trim();

    /* Ник и промокод помним, чтобы во второй раз не набирать. */
    try {
      if (nick) localStorage.setItem('aegis_nick', nick);
      if (promo) localStorage.setItem('aegis_promo', promo);
    } catch (err) { /* приватный режим — не критично */ }

    if (how === 'manual') {
      /* Службы нет: ведем на страницу переводов, выдача — руками. */
      open(AegisApi.link('donate') || DONATE_URL, '_blank', 'noopener');
      mSteps.innerHTML = 'Открылась страница оплаты. Не забудь <b>ник в комментарии</b> — ' +
        'без него выдача задержится до разбора вручную.';
      return;
    }

    /* Служба жива: заказ заводит сервер, он же считает скидки и он же
       выдает покупку, когда платежка подтвердит перевод. Ник покупки служба
       берет из входа, а не из тела запроса. */
    /* Окно платежки открываем сразу, по нажатию: браузер пускает новое окно
       только в ответ на клик, а ответ службы приходит уже после него —
       и тогда окно режется как всплывающее. Адрес подставим, когда придет.
       Донату окно сразу не нужно: сначала человек копирует сумму и номер. */
    const win = daPath() ? null : open('', '_blank');
    mGo.disabled = true;
    mGo.textContent = 'Готовим заказ…';
    AegisApi.call('/shop/order', {
      body: {
        sku: mItem.dataset.sku || mItem.textContent,
        rub: Number(mItem.dataset.rub) || 0,
        nick: nick,
        promo: promo
      }
    }).then(r => {
      order = r.order || '';
      payUrl = r.pay || '';
      payUrl2 = r.pay2 || '';
      daInfo = r.da && r.da.page ? r.da : null;
      daGot = '';
      orderNick = nick;
      orderNote = r.note || '';
      /* второй способ успели выключить между расчетом и заказом — выбор прячем */
      showCard(!!payUrl2 || (!!daInfo && !!payUrl));
      const url = daPath() ? '' : payCard.url(payUrl, payUrl2, card());
      if (url && win && !win.closed) { win.opener = null; win.location.href = url; }
      else {
        if (win) win.close();
        if (url) open(url, '_blank', 'noopener');
      }
      payOpened = !!url;
      mGo.disabled = false;
      quoteNote.remove();
      lockOrder(true);
      if (r.rub != null) showPrice(r.rub, r.base);
      /* Чек заводим сразу, а не после оплаты: ошибку замечают уже на
         платежной странице, и в обращения идут, не дождавшись выдачи. */
      if (order) {
        AegisRcpt.add({
          id: order,
          sku: mItem.dataset.sku || mItem.textContent,
          rub: r.rub != null ? r.rub : Number(mItem.dataset.rub) || 0,
          nick: nick,
          at: Date.now(),
          status: 'new'
        });
        if (mCopy) mCopy.hidden = false;
      }
      /* Адрес страницы оплаты называем прямо: так видно, что новая вкладка —
         та самая, а не чужая страница, выдающая себя за оплату. */
      drawOrder(!!url);
      /* «Оплатить за меня»: заплатить может и другой человек — без входа,
         а покупка придет на этот аккаунт. */
      if (!support && order && r.link && mFriend) {
        mFLink.value = r.link;
        mFCopy.textContent = 'Скопировать';
        show(mFriend, true);
      }
      if (order) watchOrder(order, daPath());
    }, e => {
      if (win) win.close();
      mGo.disabled = false;
      mGo.textContent = goLabel();
      if (e.code === 'auth' || e.code === 'login') { lost(AegisApi.textOf(e)); return; }
      mSteps.textContent = AegisApi.textOf(e);
    });
  });

  /* Ник набран, палец сам тянется к Enter — а окно молчало: кнопка стоит
     отдельно, формы тут нет. Делаем ровно то же, что и нажатие кнопки, но
     только пока она рабочая: если прием платежей закрыт, Enter не должен
     делать вид, что заказ ушел. */
  const enterGo = e => {
    if (e.key !== 'Enter' || mGo.disabled || mGo.hidden) return;
    e.preventDefault();
    mGo.click();
  };
  mNick.addEventListener('keydown', enterGo);
  mPromo.addEventListener('keydown', enterGo);

  /* Чек прямо из окна заказа: закрывать его и искать список внизу страницы,
     когда только что увидел ошибку, — лишний шаг. */
  if (mCopy) {
    mCopy.addEventListener('click', () => {
      const r = order ? AegisRcpt.get(order) : null;
      if (!r) return;
      AegisRcpt.copy(AegisRcpt.text(r)).then(() => {
        mCopy.textContent = 'Чек скопирован';
        setTimeout(() => { mCopy.textContent = 'Скопировать чек'; }, 2000);
      }, () => {
        /* Буфер не дался — показываем чек списком внизу страницы, там его
           можно выделить руками. */
        mCopy.textContent = 'Чек — в списке внизу страницы';
      });
    });
  }

  if (mFCopy) {
    mFLink.addEventListener('focus', () => mFLink.select());
    mFCopy.addEventListener('click', () => {
      AegisRcpt.copy(mFLink.value).then(() => {
        mFCopy.textContent = 'Скопировано';
        setTimeout(() => { mFCopy.textContent = 'Скопировать'; }, 2000);
      }, () => {
        /* Буфер не дался — выделяем ссылку, дальше Ctrl+C руками. */
        mFLink.focus();
        mFLink.select();
        mFCopy.textContent = 'Выделено — Ctrl+C';
      });
    });
  }

  try {
    const saved = localStorage.getItem('aegis_nick');
    if (saved) mNick.value = saved;
    const savedPromo = localStorage.getItem('aegis_promo');
    if (savedPromo) mPromo.value = savedPromo;
  } catch (err) { /* ignore */ }
}

/* Прямые ссылки на карточку: donate.html?case=staff или ?kit=2 (номер с нуля,
   можно ?kit=2&tier=1). Удобно давать в Discord ссылку сразу на нужный кейс. */
(function deepLink() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (err) { return; }
  const cid = q.get('case'), kid = q.get('kit');
  if (cid && typeof openCase === 'function' && caseById(cid)) {
    setTimeout(() => openCase(cid), 60);
  } else if (kid !== null && typeof openKit === 'function' && KITS[+kid] && !KITS[+kid].off) {
    const t = Math.max(0, Math.min(+(q.get('tier') || 0), KITS[+kid].tiers.length - 1));
    setTimeout(() => openKit(+kid, t), 60);
  }
})();
