/* AEGIS SMP — лавка: киты, кейсы с прокруткой, боевой пропуск,
   ускорение сервера и оформление заказа.
   Подключается только на donate.html, после main.js (оттуда берётся
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
const img = (file, cls) =>
  `<img${cls ? ` class="${cls}"` : ''} src="assets/icons/${file}.png" alt="">`;
/* иконки 16×16 и 32×32 тянутся пиксельно, крупные рендеры — сглаженно;
   корона 16×8 — единственная широкая, ей своя ширина */
const PIX = f => f === 'crown' ? 'pix wide'
  : (/^(aegis_|cbc_|tfmg_|create_|createbigcannons_)/.test(f) ? 'pix' : '');

/* ============================================================
   1. КИТЫ. Семь профессий по три уровня.
   Уровень — полнота комплекта, а не сила: всё содержимое
   крафтится в игре, кит экономит вечер у станка. У каждой
   позиции проставлена своя цена в червонцах — из них считается
   строка «по отдельности» в карточке кита.
   ============================================================ */

const KITS = [
  {
    name: 'Снабжение',
    sub: 'провиант, свет, ящики и рюкзак',
    icons: ['tfmg_coal_coke', 'clipboard', 'iron_sheet'],
    tiers: [
      { price: 89, items: [
        ['Печёная свинина и хлеб', '×128', 30],
        ['Факелы', '×256', 20],
        ['Железный инструмент', '2 комплекта', 35],
        ['Сундуки и воронки', '×24', 30],
        ['Уголь', '×128', 25]
      ] },
      { price: 219, items: [
        ['Провиант на неделю', '×256', 60],
        ['Факелы и фонари', '×512', 45],
        ['Алмазный инструмент', 'полный набор', 70],
        ['Рюкзак с апгрейдом стопок', '', 80],
        ['Коксовый уголь', '×128', 45],
        ['Сундуки и воронки', '×64', 45]
      ] },
      { price: 389, items: [
        ['Провиант на месяц', '×512', 110],
        ['Золотые яблоки', '×8', 45],
        ['Рюкзак: магнит, стопки, зачарование', '', 160],
        ['Алмазный инструмент', '2 комплекта', 140],
        ['Коксовый уголь', '×256', 90],
        ['Фонари, сундуки, воронки', '×128', 70]
      ] }
    ]
  },
  {
    name: 'Инженер',
    sub: 'кинетика Create под ключ',
    icons: ['wrench', 'goggles', 'precision_mechanism'],
    tiers: [
      { price: 109, items: [
        ['Гаечный ключ и очки инженера', '', 40],
        ['Андезитовый сплав', '×256', 60],
        ['Валы и шестерни', '×192', 45],
        ['Ремни и приводы', '×32', 30]
      ] },
      { price: 279, items: [
        ['Гаечный ключ и очки инженера', '', 40],
        ['Механизм точности', '×16', 120],
        ['Латунный корпус', '×32', 70],
        ['Валы, шестерни, ремни', '×384', 90],
        ['Воронки, жёлоба, туннели', '×64', 55],
        ['Латунь и цинк', '×128', 60]
      ] },
      { price: 599, items: [
        ['Механизм точности', '×48', 300],
        ['Прочный лист', '×32', 130],
        ['Пресс, смеситель, миксер, печь', 'по 2', 180],
        ['Валы, шестерни, ремни', '×768', 150],
        ['Латунь, цинк, медь', '×512', 170],
        ['Ключ, очки, схематический стол', '', 60]
      ] }
    ]
  },
  {
    name: 'Строитель',
    sub: 'материал и схемы под стройку',
    icons: ['schematic', 'sturdy_sheet', 'copper_sheet'],
    tiers: [
      { price: 89, items: [
        ['Камень и кирпич', '×1024', 50],
        ['Доски и брус', '×512', 35],
        ['Стекло', '×256', 30],
        ['Леса', '×128', 25]
      ] },
      { price: 279, items: [
        ['Материал на выбор', '×4096', 160],
        ['Стекло и витраж', '×512', 60],
        ['Схематический стол и 8 схем', '', 90],
        ['Декор Create Deco на выбор', '×512', 80],
        ['Леса', '×256', 45]
      ] },
      { price: 599, items: [
        ['Материал на выбор', '×8192', 320],
        ['Схематическая пушка и порох ×256', '', 180],
        ['Пустые схемы', '×32', 120],
        ['Декор и медные листы', '×1024', 190],
        ['Копикэты и интерьер', '×512', 120],
        ['Леса', '×512', 60]
      ] }
    ]
  },
  {
    name: 'Нефтяник',
    sub: 'промысел и переработка TFMG',
    icons: ['tfmg_crude_oil_bucket', 'oil', 'tfmg_steel_ingot'],
    tiers: [
      { price: 109, items: [
        ['Стальные трубы', '×128', 55],
        ['Сталь', '×32', 45],
        ['Коксовый уголь', '×128', 45],
        ['Вёдра и канистры', '×8', 25]
      ] },
      { price: 279, items: [
        ['Стальные трубы', '×256', 100],
        ['Жидкостные баки', '×16', 90],
        ['Стальные помпы', '×8', 80],
        ['Вентили и краны', '×16', 55],
        ['Стальной механизм', '×12', 110]
      ] },
      { price: 599, items: [
        ['Комплект нефтяного насоса', 'под ключ', 260],
        ['Стальные трубы', '×512', 190],
        ['Жидкостные баки', '×32', 170],
        ['Стальной механизм', '×32', 280],
        ['Сталь и чугун', '×256', 90]
      ] }
    ]
  },
  {
    name: 'Артиллерист',
    sub: 'орудия и боекомплект Big Cannons',
    icons: ['cannon_barrel_bronze', 'cbc_powder_charge', 'createbigcannons_impact_fuze'],
    tiers: [
      { price: 119, items: [
        ['Бронзовый ствол', '×4', 60],
        ['Лафет и станина', '', 45],
        ['Пороховой заряд', '×32', 45],
        ['Мешок картечи', '×16', 30]
      ] },
      { price: 299, items: [
        ['Бронзовый ствол', '×8', 110],
        ['Чугунный ствол', '×4', 90],
        ['Пороховой заряд', '×96', 110],
        ['Взрыватели ударные и дистанционные', '×32', 80],
        ['Фугасные снаряды', '×32', 90]
      ] },
      { price: 629, items: [
        ['Стальной ствол', '×8', 260],
        ['Скорострельный затвор', '×2', 190],
        ['Автопушка с креплением', '', 170],
        ['Пороховой заряд', '×256', 200],
        ['Снаряды на выбор', '×96', 190]
      ] }
    ]
  },
  {
    name: 'Связист',
    sub: 'сирены, радар и сеть оповещения',
    icons: ['aegis_siren_remote', 'aegis_siren_front', 'create_gearbox'],
    tiers: [
      { price: 99, items: [
        ['Сирена и пульт', '', 60],
        ['Шестерни, валы, ремни', '×64', 35],
        ['Латунь', '×32', 30],
        ['Радар Create', '', 40]
      ] },
      { price: 259, items: [
        ['Сирена', '×4', 130],
        ['Пульт сирены', '×2', 60],
        ['Радар и антенны', '×2', 90],
        ['Шестерни, валы, ремни', '×192', 70],
        ['Латунь и цинк', '×128', 60]
      ] },
      { price: 599, items: [
        ['Сеть оповещения под ключ', '8 постов', 320],
        ['Сирена', '×8', 240],
        ['Пульт сирены', '×6', 150],
        ['Радарная станция', '', 130],
        ['Механизм точности', '×12', 90],
        ['Латунь', '×256', 60]
      ] }
    ]
  },
  {
    name: 'Штурмовик',
    sub: 'личное оружие, броня и зелья',
    icons: ['shield', 'autocannon', 'cbc_grapeshot'],
    tiers: [
      { price: 129, items: [
        ['Железный меч и топор', '2 комплекта', 40],
        ['Лук и стрелы', '×256', 45],
        ['Железный доспех', '2 комплекта', 60],
        ['Щит', '×4', 25],
        ['Золотые яблоки', '×4', 30]
      ] },
      { price: 289, items: [
        ['Алмазный меч и топор', '', 90],
        ['Алмазный доспех', 'полный', 130],
        ['Арбалет и стрелы', '×512', 90],
        ['Зелья лечения и скорости', '×16', 80],
        ['Щиты и золотые яблоки', '×8', 60]
      ] },
      { price: 629, items: [
        ['Алмазный меч: Острота V', '', 190],
        ['Алмазный доспех: Защита IV', 'полный', 280],
        ['Арбалет: Быстрая перезарядка III', '', 130],
        ['Стрелы и снаряды', '×1024', 130],
        ['Зелья и зачарованные яблоки', '×24', 170],
        ['Рюкзак бойца', '', 100]
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
    const tile = document.createElement('div');
    tile.className = 'kit-tile reveal';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.dataset.kit = ki;

    const icons = k.icons.map(f =>
      `<span class="kt-cell">${img(f, PIX(f))}</span>`).join('');
    const chips = k.tiers.map((t, i) =>
      `<button type="button" class="kt-chip" data-kit="${ki}" data-tier="${i}">` +
      `<b>${ROMAN[i]}</b>${t.price} Ч</button>`).join('');

    tile.innerHTML =
      `<div class="kt-icons">${icons}</div>` +
      `<h3>${esc(k.name)}</h3>` +
      `<div class="kt-sub">${esc(k.sub)}</div>` +
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
    `<span class="ki-v">${v} Ч</span></li>`).join('');

  document.getElementById('kmParts').textContent = parts + ' Ч';
  document.getElementById('kmSave').textContent =
    Math.round((1 - t.price / parts) * 100) + '%';
  document.getElementById('kmPrice').textContent = t.price;

  const buy = document.getElementById('kmBuy');
  buy.dataset.coin = t.price;
  buy.dataset.buy = `Кит «${k.name}» · уровень ${ROMAN[ti]}`;

  document.querySelectorAll('#kmSwitch button').forEach(b =>
    b.classList.toggle('on', +b.dataset.t === ti));
}

function openKit(ki, ti) {
  if (!kitModal) return;
  fillKit(ki, ti);
  kitModal.classList.add('open');
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
   2. КЕЙСЫ. Пять ступеней редкости; «окуп» — эпическое и выше:
   там цена продажи приза не ниже цены самого кейса. Продажа
   считается от ценности содержимого, средний возврат по кейсу —
   около двух третей его цены (написано на странице честно).
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
    price: 199, icon: 'tfmg_coal_coke',
    drops: [
      { c: 50, n: 'Провиант и свет', w: 'свинина ×64, факелы ×128, уголь ×64', sell: 45, icon: 'tfmg_coal_coke' },
      { c: 28, n: 'Инструмент бригады', w: 'железный набор ×2, наковальня, сундуки ×16', sell: 130, icon: 'iron_sheet' },
      { c: 15, n: 'Андезитовый обоз', w: 'андезитовый сплав ×256', sell: 240, icon: 'andesite_alloy' },
      { c: 5.5, n: 'Алмазный набор', w: 'алмазный инструмент ×3 и алмазы ×24', sell: 420, icon: 'sturdy_sheet' },
      { c: 1.5, n: 'Кит «Снабжение» III', w: 'полный комплект третьего уровня', sell: 700, icon: 'clipboard' }
    ]
  },
  {
    id: 'plant', name: 'Заводской наряд', sub: 'производство Create',
    price: 299, icon: 'precision_mechanism',
    drops: [
      { c: 50, n: 'Металл и кокс', w: 'латунь, медь или цинк ×64, коксовый уголь ×64', sell: 70, icon: 'brass_ingot' },
      { c: 28, n: 'Кинетика россыпью', w: 'валы ×128, шестерни ×128, ремни ×32, воронки ×32', sell: 190, icon: 'create_cogwheel' },
      { c: 15, n: 'Механизмы точности', w: 'механизм точности ×16, латунный корпус ×32', sell: 360, icon: 'precision_mechanism' },
      { c: 5.5, n: 'Линия под ключ', w: 'пресс, смеситель, миксер и прочный лист ×16', sell: 620, icon: 'create_mechanical_press_head' },
      { c: 1.5, n: 'Кит «Инженер» III', w: 'полный комплект третьего уровня', sell: 1000, icon: 'wrench' }
    ]
  },
  {
    id: 'oil', name: 'Нефтяной контракт', sub: 'промысел TFMG',
    price: 349, icon: 'tfmg_crude_oil_bucket',
    drops: [
      { c: 50, n: 'Сырьё промысла', w: 'коксовый уголь ×128, сырая нефть ×8 вёдер', sell: 85, icon: 'tfmg_coal_coke' },
      { c: 28, n: 'Трубный обоз', w: 'стальные трубы ×128, сталь ×32', sell: 230, icon: 'tfmg_rebar' },
      { c: 15, n: 'Насосная станция', w: 'баки ×16, помпы ×8, вентили ×16', sell: 430, icon: 'oil' },
      { c: 5.5, n: 'Скважина под ключ', w: 'комплект нефтяного насоса, стальной механизм ×16', sell: 780, icon: 'tfmg_steel_mechanism' },
      { c: 1.5, n: 'Кит «Нефтяник» III + 200 Ч', w: 'полный комплект и червонцы сверху', sell: 1200, icon: 'tfmg_steel_ingot' }
    ]
  },
  {
    id: 'arsenal', name: 'Арсенал', sub: 'боекомплект Big Cannons',
    price: 399, icon: 'cbc_shrapnel_shell',
    drops: [
      { c: 50, n: 'Порох и картечь', w: 'пороховой заряд ×32, мешок картечи ×16', sell: 95, icon: 'cbc_powder_charge' },
      { c: 28, n: 'Фугасы и дымы', w: 'снаряды ×16 на выбор, взрыватели ×16', sell: 250, icon: 'cbc_he_shell' },
      { c: 15, n: 'Тяжёлый боекомплект', w: 'шрапнель ×16, бронебойные ×16, взрыватели ×32', sell: 480, icon: 'cbc_ap_shell' },
      { c: 5.5, n: 'Скорострельная батарея', w: 'бронзовый затвор и стволы ×4', sell: 850, icon: 'cannon_barrel_bronze' },
      { c: 1.5, n: 'Кит «Артиллерист» III', w: 'полный комплект третьего уровня', sell: 1400, icon: 'autocannon' }
    ]
  },
  {
    id: 'parade', name: 'Парадный расчёт', sub: 'только косметика',
    price: 249, icon: 'aegis_salute_shell',
    drops: [
      { c: 50, n: 'Салют и знамёна', w: 'салютные снаряды ×32, цветные знамёна ×16', sell: 60, icon: 'aegis_salute_shell' },
      { c: 28, n: 'Значок к нику', w: 'один из двенадцати пиксельных значков', sell: 150, icon: 'crown' },
      { c: 15, n: 'Цвет и префикс', w: 'цветной ник и свой префикс до конца сезона', sell: 260, icon: 'banner_cloth' },
      { c: 5.5, n: 'Плащ сезона', w: 'косметический плащ, вне кейса не выдаётся', sell: 500, icon: 'aegis_star_shell' },
      { c: 1.5, n: 'Накидка «Парад» и позывной', w: 'скин-накидка и свой звук входа', sell: 900, icon: 'aegis_siren_remote' }
    ]
  },
  {
    id: 'staff', name: 'Генштаб', sub: 'редкое и статусное',
    price: 549, icon: 'crown', top: true,
    drops: [
      { c: 50, n: 'Парадный залп', w: 'осветительные ×16, салютные ×32, знамёна ×16', sell: 150, icon: 'aegis_star_shell' },
      { c: 28, n: '«Ефрейтор» на 7 дней', w: 'звание второго тира на неделю', sell: 330, icon: 'aegis_stock_module' },
      { c: 15, n: 'Кит III уровня на выбор', w: 'любая из семи профессий', sell: 700, icon: 'clipboard' },
      { c: 5.5, n: '«Офицер» на 30 дней', w: 'звание третьего тира на месяц', sell: 1250, icon: 'golden_sheet' },
      { c: 1.5, n: '«Маршал» на сезон + плащ «Ставка»', w: 'высшее звание до вайпа', sell: 2600, icon: 'crown' }
    ]
  },
  {
    id: 'convoy', name: 'Промышленный обоз', sub: 'ресурсы в промышленном масштабе',
    price: 0, from: 'падает из пропуска', icon: 'andesite_alloy',
    drops: [
      { c: 50, n: 'Андезитовый сплав ×1024', w: 'основа всей кинетики, целый обоз', sell: 200, icon: 'andesite_alloy' },
      { c: 28, n: 'Стройматериал ×2048', w: 'камень, кирпич или доски на выбор', sell: 260, icon: 'sturdy_sheet' },
      { c: 15, n: 'Латунь ×512 и цинк ×512', w: 'цветной металл вагоном', sell: 420, icon: 'brass_ingot' },
      { c: 5.5, n: 'Сталь ×512 и трубы ×256', w: 'на промысел и на броню', sell: 700, icon: 'tfmg_steel_ingot' },
      { c: 1.5, n: 'Конвейер под ключ', w: 'пресс, смеситель, печь и ремни ×64', sell: 1100, icon: 'belt_connector' }
    ]
  },
  {
    id: 'points', name: 'Штабные очки', sub: 'очки прокачки пропуска',
    price: 0, from: 'падает из пропуска', icon: 'clipboard', noSell: true,
    drops: [
      { c: 50, n: '400 очков пропуска', w: 'почти половина этапа', sell: null, icon: 'clipboard' },
      { c: 28, n: '700 очков пропуска', w: 'дневная норма среднего задания', sell: null, icon: 'clipboard' },
      { c: 15, n: '1200 очков пропуска', w: 'этап целиком и немного сверху', sell: null, icon: 'schematic' },
      { c: 5.5, n: '2000 очков пропуска', w: 'два этапа за раз', sell: null, icon: 'schematic' },
      { c: 1.5, n: '3500 очков и ротации ×3', w: 'три с половиной этапа', sell: null, icon: 'golden_sheet' }
    ]
  }
];

const caseById = id => CASES.find(c => c.id === id);
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

function renderCaseTiles() {
  const grid = document.getElementById('caseGrid');
  if (!grid) return;
  grid.textContent = '';

  CASES.forEach(c => {
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
      `<div class="ct-foot">` +
        (c.price
          ? `<span class="ct-price">${c.price} <small>Ч</small></span>`
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
    ? `${c.price} <small>Ч</small>`
    : `<span class="ct-free">${esc(c.from)}</span>`;

  document.getElementById('cmDrops').innerHTML = c.drops.map((d, i) =>
    `<li>` +
      `<span class="cd-icon ${RAR[i].cls}">${img(d.icon, PIX(d.icon))}</span>` +
      `<span class="cd-body">` +
        `<b>${esc(d.n)}</b>` +
        `<i>${esc(d.w)}</i>` +
      `</span>` +
      `<span class="cd-side">` +
        `<span class="r ${RAR[i].cls}">${d.c}%</span>` +
        `<span class="cd-sell">${d.sell == null ? 'не продаётся' : 'продажа ' + d.sell + ' Ч'}</span>` +
      `</span>` +
    `</li>`).join('');

  const back = avgSell(c);
  document.getElementById('cmBack').innerHTML = back == null
    ? 'Очки прокачки не продаются — они сразу уходят в пропуск.'
    : `Средний возврат при продаже приза — <b>${back} Ч</b> из ${c.price} Ч цены кейса. ` +
      `Эпическое и легендарное продаются <b>дороже самого кейса</b> — это и есть окуп.`;

  const shout = c.drops.map((d, i) => i >= SHOUT_FROM ? d.c : 0).reduce((a, b) => a + b, 0);
  document.getElementById('cmShout').innerHTML =
    `В общий чат уходит только <b>эпическое и легендарное</b> — это ${shout}% открытий. ` +
    `Остальное видит лично владелец: лента не превращается в спам.`;

  resetSpin();
  updateCaseFoot();
}

function updateCaseFoot() {
  const total = cmCase.price * cmCount;
  const btn = document.getElementById('cmSpin');
  btn.textContent = cmCase.price
    ? `Прокрутить ×${cmCount} — ${total} Ч`
    : `Прокрутить ×${cmCount}`;
  const buy = document.getElementById('cmBuy');
  if (cmCase.price) {
    buy.hidden = false;
    buy.dataset.coin = total;
    buy.dataset.buy = cmCount > 1
      ? `Кейс «${cmCase.name}» ×${cmCount}`
      : `Кейс «${cmCase.name}»`;
    buy.textContent = `Купить в игре за ${total} Ч`;
  } else {
    buy.hidden = true;
  }
  document.querySelectorAll('#cmCount button').forEach(b =>
    b.classList.toggle('on', +b.dataset.n === cmCount));
  document.querySelectorAll('#cmSpeed button').forEach(b =>
    b.classList.toggle('on', (b.dataset.s === 'slow') === cmSlow));
}

function resetSpin() {
  const reels = document.getElementById('cmReels');
  const res = document.getElementById('cmResult');
  if (reels) reels.innerHTML = '';
  if (res) { res.innerHTML = ''; res.classList.remove('on'); }
}

function cellHTML(c, i, win) {
  const d = c.drops[i];
  return `<span class="cell ${RAR[i].cls}${win ? ' win' : ''}">` +
    `${img(d.icon, PIX(d.icon))}<i>${esc(d.n)}</i></span>`;
}

function spin() {
  if (cmBusy) return;
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
  const spent = cmCase.price * cmCount;
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
        ? `<span>Продажа всего выпавшего — <b>${sum} Ч</b>${spent ? ` при ${spent} Ч затрат` : ''}.</span>`
        : `<span>Очки уходят в пропуск сразу — продавать нечего.</span>`) +
      (shout
        ? `<span class="cr-shout">В чате объявится ${shout} из ${wins.length}: эпическое и выше.</span>`
        : `<span class="cr-quiet">В чат ничего не уйдёт — до эпического не дотянуло.</span>`) +
    `</div>` +
    `<div class="cr-demo">Это демонстрация прокрутки: сайт ничего не списывает и не выдаёт. ` +
      `Настоящее открытие — в игре по <code>/лавка</code>.</div>`;
  res.classList.add('on');
}

function openCase(id) {
  if (!caseModal) return;
  const c = caseById(id);
  if (!c) return;
  fillCase(c);
  caseModal.classList.add('open');
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
    if (!b || cmBusy) return;
    cmCount = +b.dataset.n;
    resetSpin();
    updateCaseFoot();
  });
  document.getElementById('cmSpeed').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (!b || cmBusy) return;
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
  40: ['Кейс «Арсенал»', 'Кейс «Парадный расчёт» ×2'],
  50: ['Кейс «Парадный расчёт»', 'Кейс «Генштаб»'],
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
  '40 Ч',
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
      `<div class="bp-cell bp-lgd">Боевой ордер<span>499 Ч за круг</span></div>` +
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
    bpJump.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
}

/* ============================================================
   4. УСКОРЕНИЕ СЕРВЕРА. Лестница ×1.5…×5: чем выше множитель,
   тем короче окно и тем дороже шаг. Буст общий — работает всем,
   кто в этот момент онлайн.
   ============================================================ */

const BOOST = [
  { x: '1.5', min: 60, price: 199 },
  { x: '2',   min: 50, price: 249 },
  { x: '2.5', min: 43, price: 299 },
  { x: '3',   min: 37, price: 349 },
  { x: '3.5', min: 31, price: 399 },
  { x: '4',   min: 26, price: 449 },
  { x: '4.5', min: 20, price: 499 },
  { x: '5',   min: 15, price: 549 }
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
    document.getElementById('boostPrice').innerHTML = `${b.price} <small>Ч</small>`;
    const btn = document.getElementById('boostBuy');
    btn.dataset.coin = b.price;
    btn.dataset.buy = `Ускорение сервера ×${b.x} на ${b.min} минут`;
    if (marks) marks.querySelectorAll('button').forEach(x =>
      x.classList.toggle('on', +x.dataset.i === i));
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
   выгода считается здесь, чтобы проценты в вёрстке не расходились.
   ============================================================ */

const PERIODS = {
  m: {
    key: 'm', label: '/ месяц', word: 'месяц',
    hint: 'Помесячно — чтобы попробовать. Списывается один раз, само не продлевается.'
  },
  s: {
    key: 's', label: '/ сезон', word: 'сезон',
    hint: 'Действует до конца сезона «1936» и сгорает вместе с вайпом. Основной вариант: сезон идёт около трёх месяцев.'
  },
  f: {
    key: 'f', label: 'навсегда', word: 'навсегда',
    hint: 'Цена трёх сезонов — звание остаётся на все следующие вайпы, включая новые сезоны и их темы.'
  }
};

function setPeriod(p) {
  const per = PERIODS[p];
  document.querySelectorAll('.rank').forEach(card => {
    const price = +card.dataset[per.key];
    const parts = +card.dataset['p' + per.key];
    const name = card.dataset.name;

    card.querySelector('.pv').textContent = price;
    card.querySelector('.per').textContent = per.label;
    card.querySelector('.parts').textContent = parts + ' Ч';
    card.querySelector('.save-pc').textContent = Math.round((1 - price / parts) * 100) + '%';

    const btn = card.querySelector('button[data-coin]');
    btn.dataset.coin = price;
    btn.dataset.buy = `Привилегия «${name}» · ${per.word}`;
  });
  const hint = document.getElementById('periodHint');
  if (hint) hint.textContent = per.hint;
}

const periodSwitch = document.getElementById('periodSwitch');
if (periodSwitch) {
  setPeriod('s');
  periodSwitch.addEventListener('click', e => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    periodSwitch.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    setPeriod(b.dataset.period);
  });
}

/* ============================================================
   6. ОФОРМЛЕНИЕ ЗАКАЗА
   За рубли покупаются только червонцы (курс 1 к 1, скидку даёт
   промокод и премиум), всё остальное берётся в игре за них же —
   поэтому модалка работает в двух режимах.
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
  const mAlt = document.getElementById('mAlt');
  const mLabel = modal.querySelector('label[for="mNick"]');
  const mPromoLabel = modal.querySelector('label[for="mPromo"]');

  let mode = 'topup';
  let order = null;          /* текущий заказ на сервере, пока ждём оплату */
  let payUrl = '';           /* его страница оплаты — чтобы открыть повторно */
  let poll = 0;              /* таймер опроса; гасим при закрытии окна */

  /* Три состояния приёма денег, от лучшего к худшему:
       'api'    — служба сервера жива: заказ заводится на сервере, и червонцы
                  прилетают на счёт сами, как только платёжка подтвердит перевод;
       'manual' — службы нет, но есть страница приёма переводов: платим туда,
                  ник пишем в комментарии, зачисляет человек;
       'off'    — принимать деньги пока некуда, и врать об этом нельзя. */
  const payMode = () => {
    if (window.AegisApi && AegisApi.base()) return 'api';
    if (DONATE_READY) return 'manual';
    return 'off';
  };

  const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

  const openTopup = (item, rub, coin) => {
    mode = 'topup';
    order = null;
    payUrl = '';
    stopPoll();
    mGo.hidden = false;
    mTitle.textContent = 'Пополнение казны';
    mItem.textContent = item;
    mItem.dataset.sku = item;
    mItem.dataset.rub = rub;
    mItem.dataset.coin = coin;
    mPrice.innerHTML = `${rub} ₽ <small>→ ${coin} червонцев</small>`;
    mLabel.hidden = false;
    mNick.hidden = false;
    mPromoLabel.hidden = false;
    mPromo.hidden = false;
    mGo.textContent = 'Перейти к оплате';
    mGo.disabled = false;
    mAlt.hidden = true;

    const how = payMode();
    if (how === 'api') {
      mSteps.innerHTML = 'Укажи <b>игровой ник</b> — червонцы придут на этот счёт ' +
        'автоматически, сразу после оплаты. Промокод и −5% премиума посчитаются ' +
        'в заказе. Баланс в игре: <b>/казна</b>.';
    } else if (how === 'manual') {
      mSteps.innerHTML = 'В комментарии к переводу — <b>игровой ник</b>, а следом промокод, ' +
        'если он есть. Скидка по промокоду и −5% премиума считаются при зачислении. ' +
        'Баланс в игре: <b>/казна</b>.';
    } else {
      /* Пускать человека на несуществующую страницу оплаты нельзя: живая
         кнопка, ведущая в никуда, хуже честной строки. Поля ника и промокода
         тоже убираем — вводить их пока некуда. */
      mSteps.innerHTML = 'Приём платежей <b>ещё не открыт</b> — страница оплаты появится ' +
        'к старту сезона. Цены и состав уже окончательные, так что выбрать можно заранее.';
      mLabel.hidden = true;
      mNick.hidden = true;
      mPromoLabel.hidden = true;
      mPromo.hidden = true;
      mGo.textContent = 'Оплата откроется к старту';
      mGo.disabled = true;
    }

    modal.classList.add('open');
    if (!mNick.hidden) mNick.focus();
  };

  const openItem = (item, coin) => {
    mode = 'item';
    stopPoll();
    mGo.hidden = false;
    mTitle.textContent = 'Покупка за червонцы';
    mItem.textContent = item;
    mPrice.innerHTML = `${coin} <small>червонцев</small>`;
    mSteps.innerHTML = 'Эта позиция покупается <b>в игре</b> командой <b>/лавка</b> — ' +
      'сайт ничего не списывает. Червонцы можно пополнить рублями, а можно заработать ' +
      'пропуском и ивентами: за сезон активной игры набегает около 1500.';
    mLabel.hidden = true;
    mNick.hidden = true;
    mPromoLabel.hidden = true;
    mPromo.hidden = true;
    mGo.textContent = 'Пополнить казну';
    mGo.disabled = false;
    mAlt.hidden = false;
    modal.classList.add('open');
  };

  /* Кнопки китов, кейсов и буста рисуются скриптом, поэтому слушаем
     документ целиком, а не вешаем обработчик на каждую. */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    /* заказ поверх карточки кита или кейса — ту карточку закрываем */
    const host = btn.closest('.modal-wrap');
    if (host && host !== modal) host.classList.remove('open');
    const { buy, rub, coin } = btn.dataset;
    if (rub) openTopup(buy, rub, coin);
    else openItem(buy, coin);
  });

  const closeAll = () => {
    document.querySelectorAll('.modal-wrap.open').forEach(m => m.classList.remove('open'));
    if (poll) { clearInterval(poll); poll = 0; }
  };

  document.querySelectorAll('.modal-wrap').forEach(wrap => {
    const x = wrap.querySelector('.m-close');
    if (x) x.addEventListener('click', () => wrap.classList.remove('open'));
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.classList.remove('open'); });
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  /* Опрос заказа. Платёжка подтверждает перевод не мгновенно и не браузеру,
     а серверу, поэтому окно ждёт и само переписывает строку состояния.
     Опрос конечный: пять минут, дальше человеку предлагается проверить
     /казна в игре — вечно крутящаяся надпись хуже честного «проверь сам». */
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = 0; } };

  const watchOrder = id => {
    let left = 60;
    stopPoll();
    poll = setInterval(() => {
      if (--left < 0) {
        stopPoll();
        mSteps.innerHTML = 'Оплату пока не видно. Если деньги ушли — червонцы придут ' +
          'сами, проверь <b>/казна</b> в игре через пару минут или напиши в ' +
          '<a href="tickets.html">обращения</a>.';
        return;
      }
      AegisApi.call('/shop/order?id=' + encodeURIComponent(id)).then(r => {
        if (r.status === 'paid') {
          stopPoll();
          mGo.hidden = true;
          mSteps.innerHTML = '<b>Оплачено.</b> На счёт зачислено ' +
            AegisApi.esc(String(r.coins || '')) + ' червонцев — они уже в игре, ' +
            'команда <b>/казна</b>.';
        } else if (r.status === 'failed') {
          stopPoll();
          mGo.hidden = false;
          mGo.disabled = false;
          mGo.textContent = 'Попробовать ещё раз';
          mSteps.innerHTML = 'Платёж не прошёл. Деньги, если списались, вернёт ' +
            'платёжная служба — с нашей стороны заказ отменён.';
        }
      }, () => { /* сеть моргнула — просто ждём следующего круга */ });
    }, 5000);
  };

  mGo.addEventListener('click', () => {
    if (mode === 'item') {
      closeAll();
      document.getElementById('treasury').scrollIntoView({ behavior: CALM ? 'auto' : 'smooth' });
      return;
    }

    /* Заказ уже заведён — второе нажатие открывает ту же оплату, а не плодит
       новый заказ (окно платёжки часто закрывают случайно). */
    if (order && payUrl) { open(payUrl, '_blank', 'noopener'); return; }

    const nick = mNick.value.trim();
    if (!NICK_RE.test(nick)) {
      mNick.focus();
      mNick.value = '';
      mNick.placeholder = 'Ник: 3–16 знаков, латиница и цифры';
      return;
    }
    const promo = mPromo.value.trim();

    /* Ник и промокод помним, чтобы во второй раз не набирать. */
    try {
      localStorage.setItem('aegis_nick', nick);
      if (promo) localStorage.setItem('aegis_promo', promo);
    } catch (err) { /* приватный режим — не критично */ }

    const how = payMode();
    if (how === 'off') return;                 /* кнопка уже отключена выше */

    if (how === 'manual') {
      /* Службы нет: ведём на страницу переводов, зачисление — руками. */
      open(AegisApi.link('donate') || DONATE_URL, '_blank', 'noopener');
      mSteps.innerHTML = 'Открылась страница оплаты. Не забудь <b>ник в комментарии</b> — ' +
        'без него зачисление задержится до разбора вручную.';
      return;
    }

    /* Служба жива: заказ заводит сервер, он же считает скидки и он же
       зачисляет червонцы, когда платёжка подтвердит перевод. Сайт цену
       не считает и на баланс не влияет — иначе её можно было бы подправить
       прямо в браузере. */
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
      if (payUrl) open(payUrl, '_blank', 'noopener');
      mGo.textContent = 'Открыть оплату ещё раз';
      mGo.disabled = false;
      mSteps.innerHTML = 'Заказ <b>№' + AegisApi.esc(order) + '</b> на ' +
        AegisApi.esc(String(r.rub != null ? r.rub : mItem.dataset.rub)) + ' ₽ ' +
        (r.coins ? '(' + AegisApi.esc(String(r.coins)) + ' червонцев) ' : '') +
        'ждёт оплату. Окно можно не закрывать — как оплатишь, здесь появится ' +
        'подтверждение.';
      if (order) watchOrder(order);
    }, e => {
      mGo.disabled = false;
      mGo.textContent = 'Перейти к оплате';
      mSteps.textContent = AegisApi.textOf(e);
    });
  });

  mAlt.addEventListener('click', closeAll);

  try {
    const saved = localStorage.getItem('aegis_nick');
    if (saved) mNick.value = saved;
    const savedPromo = localStorage.getItem('aegis_promo');
    if (savedPromo) mPromo.value = savedPromo;
  } catch (err) { /* ignore */ }
}
