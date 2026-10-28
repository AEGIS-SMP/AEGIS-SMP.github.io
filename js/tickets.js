/* AEGIS — обращения с сайта.
   Темы и вопросы в них берутся из data/tickets.json — того же файла, что
   собран из бота Discord. Значит, спрашивают одно и то же в обоих местах
   и ответ приходит одинаковый; расходиться им неоткуда.

   Куда уходит написанное: POST /tickets/new на службу сервера. Службы может
   не быть (сезон еще готовится, переезд, служба выключена) — тогда
   форма не притворяется рабочей, а собирает из ответов готовый текст:
   его можно скопировать одной кнопкой и отправить в Discord. Человек уходит
   с решением, а не с надписью «попробуйте позже».

   Подключается на tickets.html после js/api.js. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var T = window.AegisTk;
  var body = document.getElementById('tkBody');
  var crumbs = document.getElementById('tkCrumbs');
  if (!body) return;

  /* Перерыв между вайпами (18.10.2026): службы за сайтом нет, обращения с сайта
     не уходят. Темы и форма остаются — из формы собирается готовый текст для
     тикета в Discord. Сервер вернется (в config.js снова api) — плашка уйдет сама. */
  var PAUSE = !A.base();
  if (PAUSE) {
    var dcl = A.link('discord');
    var lead = document.querySelector('.page-hero .lead');
    if (lead) lead.innerHTML = 'Вопрос, баг, жалоба, апелляция, заявка на награду или ' +
      'в команду. Темы те же, что и в Discord, и разбирает их та же команда.';
    var pb = document.createElement('div');
    pb.className = 'nbox warn';
    pb.style.marginBottom = '24px';
    pb.innerHTML = '<span class="n-ic">!</span><div><b>Сервер на перерыве между вайпами</b> — ' +
      'с сайта обращения сейчас не уходят. Открой тикет в ' +
      (dcl ? '<a href="' + dcl + '" target="_blank" rel="noopener">Discord</a>' : 'Discord') +
      ', канал «тикеты»: там те же темы. Можно заполнить форму здесь — она соберет ' +
      'готовый текст, останется скопировать его в тикет.</div>';
    body.parentNode.insertBefore(pb, body);
  }

  var CATS = [];
  var BY = {};

  /* Какая служба за сайтом. Новая (с 24.09.2026) отвечает на /tickets/info:
     обращения пишут вошедшие игроки, ответ команды приходит сюда же, в «Мои
     обращения», к ним можно приложить скриншот или видео. Старая такой двери
     не знает (404) — тогда форма работает по-прежнему: без входа, с полем
     «куда ответить». NEW решается один раз при загрузке страницы. */
  var INFO = null;
  var NEW = false;
  /* Написанное в форме не теряется, если отправка сорвалась: вернулись к теме —
     ответы на месте. Живет до перезагрузки страницы. */
  var DRAFT = {};

  /* Девятнадцать тем подряд — стена, в которой не найти свою. Раскладываем
     по четырем понятным кучкам; порядок внутри кучки — от частого к редкому. */
  var GROUPS = [
    ['Помощь и разбор', ['help', 'bug', 'appeal', 'staff']],
    ['Жалобы', ['complaint', 'grief', 'rpclaim', 'demolish']],
    ['Державы и мир', ['build', 'dispute', 'war', 'rppost', 'dcverify']],
    ['Проекту', ['event', 'streamer', 'video', 'offer', 'award', 'intern']]
  ];

  /* Темы, закрытые до открытия сезона.

     Слово овнера 17.09.2026: «Закрой еще обращения на сайте кроме тех, что и в
     дискорде открыты, откроешь их как вайп начнется, кроме подачи в
     администрацию». Здесь перечислено то, чему до старта нечего разбирать: ни
     держав, ни построек, ни войн, ни наказаний на сервере еще нет, и принять
     такую заявку — значит положить ее в стол до вайпа.

     Остальное работает и сейчас, потому что живет в Discord, а не на сервере:
     вопросы, баги (в том числе Discord и Telegram), стрим, ролики,
     предложения, проверка Discord-сервера, апелляции и жалобы на команду.
     «Стажировка» — это и есть подача в администрацию, ее овнер велел оставить
     открытой отдельной оговоркой.

     Список лежит ЗДЕСЬ, а не в data/tickets.json: тот файл собирается из бота
     (site/tools/export_from_bot.py), и правку в нем затрет следующая сборка.

     Снимать руками ничего не нужно: с открытием сезона closed() перестает
     закрывать темы само — см. ниже. */
  var CLOSED = {
    complaint: 1, grief: 1, demolish: 1, dispute: 1, war: 1,
    rppost: 1, rpclaim: 1, event: 1, award: 1
  };

  /* Дата открытия записана числом в одном месте на весь сайт — js/main.js.
     Здесь ее не повторяем: перенос вайпа уже был, и второе число пережило бы
     правку первого. Если main.js почему-то не подключили — темы НЕ закрываем:
     лучше лишняя открытая тема, чем страница, где закрыто все и навсегда. */
  var OPENS = (typeof OPEN_DATE !== 'undefined' && OPEN_DATE) ? OPEN_DATE : null;

  function closed(key) {
    if (!CLOSED[key] || !OPENS) return false;
    return new Date().getTime() < OPENS.getTime();
  }

  /* «19 сентября, 15:00 МСК». Час берем московский, а не часы смотрящего:
     открытие одно на всех, и подпись должна совпасть с отсчетом на главной. */
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function msk() { return new Date(OPENS.getTime() + 3 * 3600 * 1000); }
  function openDay() {
    if (!OPENS) return 'открытия сезона';
    var m = msk();
    return m.getUTCDate() + ' ' + MONTHS[m.getUTCMonth()];
  }
  function openWhen() {
    if (!OPENS) return 'открытия сезона';
    var m = msk();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return openDay() + ', ' + p(m.getUTCHours()) + ':' + p(m.getUTCMinutes()) + ' МСК';
  }

  /* Карточка темы. Закрытая остается на месте и с тем же описанием: человек
     должен видеть, что тема есть и когда ее примут, а не решать, что ее убрали
     или что он ее выдумал. Ссылки у нее нет — нажимать нечего. */
  function card(c) {
    var t = icon(c) + '<div><h3>' + esc(cleanName(c.name)) + '</h3>' +
      '<p>' + esc(c.short || '') + '</p></div>';
    if (!closed(c.key)) {
      return '<a class="tk-card" href="#/' + esc(c.key) + '">' + t + '</a>';
    }
    /* На метке только день: она не переносится по словам, а карточка в сетке
       бывает шириной в 250px — час с поясом в нее уже не влезал и вылезал за
       край. Полное «19 сентября, 15:00 МСК» стоит во вступлении списка и на
       экране самой закрытой темы. */
    return '<div class="tk-card off" aria-disabled="true">' + t +
      '<span class="pill">откроется ' + esc(openDay()) + '</span></div>';
  }

  /* Значки тем. В data/tickets.json у каждой темы стоит эмодзи — он нужен боту:
     в списке Discord выбор идет именно по нему. На сайте же системный эмодзи
     рисует шрифт операционной системы: красный вопрос, синий щит, лиловые мечи,
     на телефоне — свои картинки. Рядом с латунью и темной базой это выглядит
     как чужие наклейки, да и вид страницы зависит от того, с чего смотрят.
     Поэтому эмодзи остается в данных (бот его берет), а на странице рисуем свой
     штриховой значок — тем же пером, что боковая вики. Темы, которой тут нет
     (бот заводит новые раньше, чем я про них узнаю), достается общий значок
     обращения: лучше ровный ряд, чем один чужой смайлик посреди него. */
  var ICON = {
    help: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM8 8a2 2 0 0 1 4 .2c0 1.4-2 1.6-2 3M10 14.4v.3',
    bug: 'M7 8.5a3 3 0 0 1 6 0v2.5a3 3 0 0 1-6 0zM7 9.5H4M7 12.5H4.5M13 9.5h3M13 12.5h2.5M8.2 6.3L7 4.2M11.8 6.3L13 4.2',
    appeal: 'M4 8v4h3l6 3V5L7 8zM15.6 8.4a3 3 0 0 1 0 3.2',
    staff: 'M10 2.5l6 2.3v5c0 3.5-2.6 5.7-6 6.7-3.4-1-6-3.2-6-6.7v-5z',
    complaint: 'M4.5 3.5l8.5 8.7M15.5 3.5L7 12.2M11.4 13.8l3 3M8.6 13.8l-3 3',
    grief: 'M3 6.2l7-3 7 3v7.6l-7 3-7-3zM10 3.2v3.6L7.6 9l3 2-1.2 3.6',
    rpclaim: 'M7 4H5.2v13h9.6V4H13M8 3h4v2.2H8zM8 9.5h4M8 12.5h3',
    /* Молот, а не динамит со шнуром: шнур дугой поверх коробки читался как
       навесной замок — ровно противоположный смысл. */
    demolish: 'M12.3 3.6l4.1 4.1-2.6 2.6-4.1-4.1zM9.3 7.4L3.5 13.2a1.6 1.6 0 0 0 2.3 2.3l5.8-5.8',
    dispute: 'M10 3.6v12.8M6 16.4h8M10 4.6L5 6.6M10 4.6l5 2M5 6.6L3 11h4zM15 6.6L13 11h4z',
    war: 'M5 3v14M5 4.2h9l-2 3 2 3H5',
    rppost: 'M5 3h7l3 3v11H5zM12 3v3h3M8 10h4M8 13h3',
    dcverify: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM3 10h14M10 3c2.2 2.6 2.2 11.4 0 14M10 3c-2.2 2.6-2.2 11.4 0 14',
    event: 'M10 3L3 16h14zM10 3v13M6.4 16l3.6-6.2 3.6 6.2',
    streamer: 'M3 7h9v7.4H3zM12 9.6l4-2.6v7.6l-4-2.6z',
    video: 'M3 8h14v8.4H3zM3 8l.9-3.1L16 3.4l.6 3.1zM7.2 4.5l1 3M11.2 4.1l1 3',
    offer: 'M4 4h12v9H8.4L4 16zM10 6.6v4M8 8.6h4',
    award: 'M10 3a3.8 3.8 0 1 0 0 7.6A3.8 3.8 0 0 0 10 3zM7.6 10.2L6.2 17l3.8-2 3.8 2-1.4-6.8',
    intern: 'M2.4 8L10 5l7.6 3-7.6 3zM5.6 9.4V13c0 1.4 2 2.5 4.4 2.5s4.4-1.1 4.4-2.5V9.4',
    build: 'M3 7h14v10H3zM3 11h14M8 7v4M12 11v6',
    /* тема, которой еще нет в этом списке */
    '': 'M3.5 4h13v9.5H8L3.5 17zM7 7.5h6M7 10.5h4'
  };

  function icon(c) {
    var d = ICON[c && c.key] || ICON[''];
    return '<span class="tk-e"><svg viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg></span>';
  }

  /* Обратная связь. В Discord обратный адрес не нужен — ответ приходит в тот же
     тикет. С сайта человек может уйти и закрыть вкладку, поэтому спрашиваем,
     куда ответить. Поле общее для всех тем, поэтому живет здесь, а не в JSON.

     ГОТЧА по тексту: на «Обращениях» обращаемся на «вы» — так написаны все
     вопросы в data/tickets.json. Остальной сайт говорит «ты», и это нормально:
     заявление в команду и рекламная страница звучат по-разному везде. Плохо
     другое — когда в ОДНОЙ форме рядом стоят «Ваш ник в игре» и «Куда тебе
     ответить». Поэтому подписи, подсказки и ответы этой страницы держим на
     «вы», даже если их собирает скрипт, а не JSON. */
  var CONTACT = {
    label: 'Куда вам ответить',
    hint: 'Discord-ник, Telegram или почта — что угодно, лишь бы дошло',
    style: 'short', required: true, max: 80
  };

  /* Выбор из готовых вариантов вместо текстового поля. В Discord выпадающих
     списков у формы нет, там человек пишет ответ сам, а бот угадывает его по
     словам («дс», «майн»). Создание тикетов в Discord выключено, заявки идут
     только отсюда, поэтому на сайте выбор сделан кнопками: в кнопке не ошибешься.
     Живет здесь, а не в data/tickets.json: файл собирается из бота заново и
     ручную правку затрет. Команда получает поле под прежней подписью из бота,
     меняется только вид. long — какую фразу в описании темы заменить. */
  var PICKS = {
    intern: {
      match: /^куда\s+пода[её]тесь/i,
      label: 'Куда подаетесь',
      err: 'Выберите, в какую администрацию подаетесь.',
      options: [
        { value: 'Майнкрафт администрация',
          hint: 'Игровой сервер: помощь игрокам и порядок в игре' },
        { value: 'Дискорд администрация',
          hint: 'Discord: порядок в чатах и каналах сообщества' }
      ],
      long: [/Выбрать нужно одно из двух[^\n]*/,
        'Выбрать нужно одно из двух — **Майнкрафт администрация** (игровой сервер) ' +
        'или **Дискорд администрация** (Discord).']
    }
  };

  function esc(s) { return A.esc(s); }

  /* Описания тем приходят из бота в разметке Discord: **жирный** и переносы
     строк. Через одно esc они выходили со звездочками и сплошным абзацем.
     Сначала экранируем, потом размечаем — в разметку попадает уже безопасное. */
  function rich(s) {
    return String(s || '').split(/\n+/).map(function (p) {
      p = p.trim();
      return p ? '<p>' + esc(p).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>') + '</p>' : '';
    }).join('');
  }

  /* ------------------------------------------------------------ витрина тем */

  function drawList() {
    crumbs.innerHTML = '<a href="/">Главная</a><span>/</span>Обращения';
    var h = '';

    var off = CATS.filter(function (c) { return closed(c.key); }).length;
    h += meBar();
    h += '<div class="nbox"><span class="n-ic">i</span><div>' +
      'Выберите тему — под каждой свои вопросы, и чем точнее ответы, тем быстрее ' +
      'разбор. Одно обращение = одна тема: две просьбы в одном тексте теряются.' +
      (off ? ' Часть тем ждет открытия сезона — они помечены и включатся ' +
        esc(openWhen()) + ', вместе с сервером.' : '') +
      '</div></div>';

    GROUPS.forEach(function (g) {
      var items = g[1].map(function (k) { return BY[k]; }).filter(Boolean);
      if (!items.length) return;
      h += '<h2 class="tk-gt">' + esc(g[0]) + '</h2><div class="tk-grid">';
      items.forEach(function (c) { h += card(c); });
      h += '</div>';
    });

    /* Темы, которых нет ни в одной кучке: файл собирается из бота, и новая
       тема там появится раньше, чем я про нее узнаю. Пусть будет видна. */
    var known = {};
    GROUPS.forEach(function (g) { g[1].forEach(function (k) { known[k] = 1; }); });
    var rest = CATS.filter(function (c) { return !known[c.key]; });
    if (rest.length) {
      h += '<h2 class="tk-gt">Разное</h2><div class="tk-grid">';
      rest.forEach(function (c) { h += card(c); });
      h += '</div>';
    }

    if (!NEW) h += statusBox();
    body.innerHTML = h;
    bindStatus();
    bindOut(function () { drawList(); });
    countMine();
    document.title = 'Обращения — AEGIS SMP';
  }

  /* В боте названия тем записаны как «Вопросы | Помощь» — вертикальная черта
     нужна в списке Discord, на карточке она лишняя. */
  function cleanName(s) {
    return String(s || '').split('|')[0].trim() || String(s || '');
  }

  /* ------------------------------------------------------------------ форма */

  /* Колонка справа от формы. Здесь нет ничего декоративного: это три вопроса,
     которые человек задает в Discord сразу после отправки («дошло?», «когда
     ответят?», «куда ответят?»), и три причины, по которым обращение потом
     возвращают на уточнение. Отвечаем до отправки, а не после. */
  function sideBox() {
    return '<aside class="tk-side">' +
      '<div class="tk-sc"><h3>Что будет дальше</h3><ul>' +
      '<li><b>Сразу</b> — обращение уходит тем, кто ведет эту тему, а не всей команде подряд.</li>' +
      (NEW
        ? '<li><b>Обычно за сутки</b> — ответ придет сюда же, на сайт: раздел ' +
          '<a href="#/mine">«Мои обращения»</a>. Там же можно дописать и ответить команде. ' +
          'Об ответе сообщим в чат игры, а если аккаунт привязан к Discord — еще и в личные сообщения.</li>' +
          '<li><b>Номер</b> выдается при отправке — писать второй раз не нужно, ' +
          'стадия разбора видна в «Моих обращениях».</li>'
        : '<li><b>Обычно за сутки</b> — ответ придет туда, куда вы попросили в последнем поле.</li>' +
          '<li><b>Номер</b> выдается при отправке: по нему внизу витрины тем видно стадию ' +
          'разбора — писать второй раз не нужно.</li>') +
      '</ul></div>' +
      '<div class="tk-sc"><h3>Чтобы разобрали быстрее</h3><ul>' +
      '<li>Одно обращение = одна тема. Две просьбы в одном тексте теряются.</li>' +
      '<li>Конкретика вместо оценок: когда, где, чьи ники, что именно произошло.</li>' +
      (NEW
        ? '<li>Скриншот или запись приложите файлом прямо к обращению — ссылки на ' +
          'сторонние сайты открываются не всегда.</li>'
        : '<li>Скриншот или запись — ссылкой в тексте. Файлы форма не принимает.</li>') +
      '<li>Жалобы и апелляции разбирает не тот, на кого жалуются.</li>' +
      '</ul></div>' +
      '</aside>';
  }

  function drawForm(cat) {
    crumbs.innerHTML = '<a href="/">Главная</a><span>/</span>' +
      '<a href="#/">Обращения</a><span>/</span>' + esc(cleanName(cat.name));

    var pk = PICKS[cat.key];
    var fields = (cat.fields || []).map(function (f) {
      return pk && pk.match.test(f.label || '') ? Object.assign({}, f, { pick: pk }) : f;
    }).concat(NEW ? [] : [CONTACT]);
    /* Форма — колонка в 720px: строка длиннее читается плохо, и поле во весь
       экран выглядит как приглашение писать простыню. Но на широком мониторе
       справа оставалось полэкрана черноты. Туда и кладем то, что человек все
       равно спрашивает, пока заполняет: сколько ждать ответа и как потом
       узнать, на какой стадии разбор. Ниже 1040px колонка уезжает под форму. */
    var h = '<div class="tk-two">';
    h += '<div class="tk-col">';
    /* Шапка темы и вход стоят ДО <form>: у входа своя форма, а форма внутри
       формы браузером выбрасывается молча (поля входа прилипли бы к обращению). */
    h += '<div class="tk-form">';
    h += '<div class="tk-head">' + icon(cat) +
      '<h2>' + esc(cleanName(cat.name)) + '</h2></div>';
    var lead = cat.long || cat.short || '';
    if (lead && pk && pk.long) lead = String(lead).replace(pk.long[0], pk.long[1]);
    if (lead) h += '<div class="tk-long">' + rich(lead) + '</div>';
    if (NEW) h += '<div id="tkAuth"></div>';
    h += '</div>';
    h += '<form class="tk-form" id="tkForm" novalidate>';

    /* Пока служба сервера не поднята, отправка все равно упрется в Discord —
       и человек узнавал об этом только после того, как заполнил всю форму.
       Говорим сразу: заполнять все равно стоит, текст соберется сам. */
    if (NEW && INFO && INFO.on === false) {
      h += '<div class="nbox warn"><span class="n-ic">!</span><div>' +
        '<b>Прием обращений с сайта сейчас закрыт.</b> Команда откроет его в ближайшее ' +
        'время — написанное здесь не пропадет, пока открыта страница.</div></div>';
    }
    if (!A.base()) {
      h += '<div class="nbox warn"><span class="n-ic">!</span><div>' +
        '<b>Прием обращений прямо с сайта включится вместе с сервером.</b> ' +
        'Заполняйте как есть: на последнем шаге ответы соберутся в готовый текст, ' +
        'его останется вставить в тикет Discord — там ответят так же.' +
        '</div></div>';
    }

    /* Игровое имя человек уже вводил при входе — незачем заставлять набирать
       его снова. Если вошел, подставляем; если нет — хотя бы разрешаем браузеру
       предложить сохраненное (поля называются f0…f3, сам он не догадается).
       Поле узнаем по подписи: список полей приходит из бота, своей пометки
       «это ник» в нем нет. Список закрытый и намеренно узкий — рядом живут
       «Ник нарушителя» и «Ник грифера», и подставить туда СВОЕ имя было бы
       уже не удобством, а подставой. */
    var MY_NICK = /^(ваш\s+)?ник(\s+в\s+игре)?$/i;
    var mine = (A.session() || {}).nick || '';

    fields.forEach(function (f, i) {
      var id = 'f' + i;
      var long = f.style === 'long';
      if (f.pick) {
        /* Радиокнопки без id fN: черновик и проверка ищут их по data-pick. */
        h += '<div class="field" data-i="' + i + '" data-pick="1">' +
          '<label id="' + id + 'l">' + esc(f.pick.label) + ' <span class="req">*</span></label>' +
          '<div class="tk-pick" role="radiogroup" aria-labelledby="' + id + 'l" aria-required="true">';
        f.pick.options.forEach(function (o) {
          h += '<label class="tk-pk"><input type="radio" name="' + id + '" value="' + esc(o.value) + '">' +
            '<span class="tk-pk-t"><b>' + esc(o.value) + '</b><span>' + esc(o.hint) + '</span></span></label>';
        });
        h += '</div><div class="err">' + esc(f.pick.err) + '</div></div>';
        return;
      }
      var isNick = !long && MY_NICK.test((f.label || '').trim());
      h += '<div class="field" data-i="' + i + '">' +
        '<label for="' + id + '">' + esc(f.label) +
        (f.required ? ' <span class="req">*</span>' : ' <em>— по желанию</em>') +
        '</label>' +
        (long
          ? '<textarea id="' + id + '" maxlength="' + (f.max || 900) + '" ' +
            'placeholder="' + esc(f.hint || '') + '"></textarea>'
          : '<input id="' + id + '" type="text" maxlength="' + (f.max || 200) + '" ' +
            (isNick ? 'autocomplete="username" spellcheck="false" ' : '') +
            (isNick && mine ? 'value="' + esc(mine) + '" ' : '') +
            'placeholder="' + esc(f.hint || '') + '">') +
        '<div class="err">Это поле нужно заполнить.</div>' +
        (long ? '<div class="cnt"><span>0</span>/' + (f.max || 900) + '</div>' : '') +
        '</div>';
    });

    if (NEW) h += '<div class="field"><label>Скриншоты и видео <em>— по желанию</em></label>' +
      '<div id="tkUp"></div></div>';
    h += '<div class="form-go">' +
      '<button class="btn btn-primary" type="submit" id="tkGo">Отправить обращение</button>' +
      '<div class="fg-note" role="status" id="tkSay">' +
      (NEW ? 'Ответ придет сюда же, в «Мои обращения». Обычно в течение суток.'
        : 'Ответ приходит туда, куда вы попросили. Обычно в течение суток.') + '</div></div>';
    h += '</form>';
    h += '</div>';
    h += sideBox();
    h += '</div>';
    /* Ссылка «ко всем темам» стоит ПОСЛЕ обеих колонок: когда подсказка
       уезжает под форму, выход должен остаться последним на странице. */
    h += '<p class="tk-back"><a href="#/">← ко всем темам</a></p>';

    body.innerHTML = h;
    document.title = cleanName(cat.name) + ' — обращения AEGIS SMP';
    var was = DRAFT[cat.key];
    if (was) {
      was.forEach(function (v, i) {
        if (!v || !v.value) return;
        var box = body.querySelector('.field[data-i="' + i + '"][data-pick]');
        if (box) {
          box.querySelectorAll('input[type=radio]').forEach(function (r) {
            if (r.value === v.value) r.checked = true;
          });
          return;
        }
        var el = document.getElementById('f' + i);
        if (el && !el.value) el.value = v.value;
      });
    }
    bindForm(cat, fields);
    /* Курсор ставим в первое НЕзаполненное поле: если ник подставился сам,
       прыгать в него и стирать подставленное человеку незачем. У радиокнопки
       value заполнен всегда, поэтому в этот счет она не идет. */
    var all = body.querySelectorAll('input:not([type=radio]), textarea');
    var first = null;
    for (var k = 0; k < all.length && !first; k++) if (!all[k].value) first = all[k];
    if (!first) first = all[0];
    if (first && window.innerWidth > 900) first.focus();
  }

  function bindForm(cat, fields) {
    var form = document.getElementById('tkForm');
    var go = document.getElementById('tkGo');
    var say = document.getElementById('tkSay');
    var auth = document.getElementById('tkAuth');
    var upHost = document.getElementById('tkUp');
    var up = null;

    /* Вход — прямо над вопросами: без него ответ некуда прислать. Вошедшему —
       одна строка «отправляете как …», чтобы было видно, от чьего имени уйдет. */
    function drawAuth() {
      if (!auth) return;
      var s = A.session();
      if (s && s.token) {
        auth.innerHTML = '<div class="tk-me"><div>Отправляете как <b>' + esc(s.nick || '') +
          '</b>. Ответ придет в <a href="#/mine">«Мои обращения»</a>.</div>' +
          '<button type="button" class="btn btn-dark btn-sm" data-out>Выйти</button></div>';
        bindOut(function () { drawAuth(); });
        if (upHost && !up) up = T.uploader(upHost, INFO && INFO.limits);
      } else {
        T.login(auth, {
          title: 'Войдите, чтобы написать',
          lead: 'Ник и пароль те же, что в лаунчере. Ответ команды придет сюда же, в ' +
            '«Мои обращения» — Discord и почта не нужны. Аккаунта нет? ' +
            '<a href="reg">Заведите его</a>, это пара минут.',
          focus: false,
          done: function () {
            drawAuth();
            var mine = (A.session() || {}).nick || '';
            body.querySelectorAll('input[autocomplete="username"]').forEach(function (el) {
              if (!el.value && /^f[0-9]+$/.test(el.id || '')) el.value = mine;
            });
            say.textContent = 'Вы вошли — можно отправлять.';
          }
        });
        if (upHost) {
          up = null;
          upHost.innerHTML = '<span class="tk-up-n">Файлы можно приложить после входа.</span>';
        }
      }
    }
    drawAuth();

    /* Счетчик знаков у длинных полей: лимит приходит из бота, и упереться
       в него на середине мысли обиднее, чем видеть остаток заранее. */
    body.querySelectorAll('textarea').forEach(function (t) {
      var box = t.closest('.field');
      var cnt = box.querySelector('.cnt span');
      if (!cnt) return;
      var upd = function () {
        cnt.textContent = t.value.length;
        cnt.parentNode.classList.toggle('over', t.value.length >= Number(t.maxLength) - 20);
      };
      t.addEventListener('input', upd);
      upd();
    });

    var unbad = function (e) {
      var box = e.target.closest && e.target.closest('.field');
      if (box) box.classList.remove('bad');
    };
    body.addEventListener('input', unbad);
    body.addEventListener('change', unbad);

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var vals = [], bad = null;
      fields.forEach(function (f, i) {
        var box = body.querySelector('.field[data-i="' + i + '"]');
        var el = f.pick ? box.querySelector('input:checked') : box.querySelector('input, textarea');
        var v = el ? el.value.trim() : '';
        if (f.required && !v) {
          box.classList.add('bad');
          if (!bad) bad = el || box.querySelector('input');
        }
        vals.push({ label: f.label, value: v });
      });
      if (bad) {
        bad.focus();
        say.textContent = 'Не хватает обязательных ответов — они отмечены.';
        return;
      }
      if (!fixGate(cat, say)) return;

      DRAFT[cat.key] = vals;
      var sendVals = fixTag(cat, fields, vals);
      if (NEW && !A.token()) {
        drawAuth();
        if (auth) auth.scrollIntoView({ block: 'start', behavior: 'smooth' });
        say.textContent = 'Сначала войдите — без входа ответ некуда прислать. Написанное не пропадет.';
        return;
      }
      if (up && up.busy()) {
        say.textContent = 'Дождитесь, пока загрузятся файлы.';
        return;
      }

      go.disabled = true;
      go.textContent = 'Отправляем…';
      say.textContent = '';

      var send = { cat: cat.key, name: cleanName(cat.name), fields: sendVals };
      if (up) send.files = up.ids();
      A.call('/tickets/new', { body: send }).then(function (r) {
        delete DRAFT[cat.key];
        done(cat, sendVals, r && r.id, r && r.no);
      }, function (err) {
        go.disabled = false;
        go.textContent = 'Отправить обращение';
        if (err && err.code === 'auth') {
          drawAuth();
          say.textContent = 'Вход устарел — войдите еще раз и отправьте снова. Написанное на месте.';
          return;
        }
        /* Службы нет — не тупик: отдаем готовый текст, который остается
           только вставить в Discord. */
        if (err && (err.code === 'offline' || err.code === 'net' || err.code === 'timeout')) {
          offlineWay(cat, sendVals);
        } else {
          say.textContent = A.textOf(err);
        }
      });
    });
  }

  /* --------------------------------------------------------------- итог */

  function done(cat, vals, id, no) {
    if (NEW && id) {
      body.innerHTML = '<div class="tk-form">' +
        '<div class="nbox ok"><span class="n-ic">✓</span><div>' +
        '<b>Обращение №' + esc(no || '') + ' принято.</b> Команда уже получила уведомление. ' +
        'Ответ придет сюда, на сайт, — в «Мои обращения»: там видна переписка и стадия ' +
        'разбора, там же можно дописать или приложить файл.</div></div>' +
        '<div class="form-go">' +
        '<a class="btn btn-primary" href="#/t/' + esc(id) + '">Открыть обращение</a>' +
        '<a class="btn btn-dark" href="#/mine">Все мои обращения</a></div>' +
        '<p class="tk-back"><a href="#/">← написать еще</a></p></div>';
      scrollTop();
      return;
    }
    var h = '<div class="tk-form">' +
      '<div class="nbox ok"><span class="n-ic">✓</span><div>' +
      '<b>Обращение принято.</b> ' +
      (id ? 'Его номер — <b>' + esc(no || id) + '</b>. Запишите: по нему можно узнать, ' +
            'на какой стадии разбор.' : 'Ответ придет туда, куда вы просили.') +
      '</div></div>' +
      '<h2 style="margin:26px 0 12px">Что дальше</h2>' +
      '<div class="row-list">' +
      '<div class="row"><div><div class="rw-t">Обращение читает дежурный</div>' +
      '<div class="rw-s">Тема попадает тем, кто ей занимается, а не всей команде подряд</div></div>' +
      '<div class="rw-r">сразу</div></div>' +
      '<div class="row"><div><div class="rw-t">Ответ или уточняющий вопрос</div>' +
      '<div class="rw-s">Туда, куда вы просили ответить</div></div>' +
      '<div class="rw-r">обычно за сутки</div></div>' +
      '<div class="row"><div><div class="rw-t">Решение</div>' +
      '<div class="rw-s">Жалобы и апелляции разбирает не тот, кто выдал наказание</div></div>' +
      '<div class="rw-r">по сложности</div></div>' +
      '</div>' +
      '<p class="tk-back"><a href="#/">← написать еще</a></p></div>';
    body.innerHTML = h;
    scrollTop();
  }

  /* Служба недоступна: собираем ровно то, что человек написал, в текст для
     Discord. Ничего не теряем и не просим набирать заново. */
  function offlineWay(cat, vals) {
    var text = 'Тема: ' + cleanName(cat.name) + '\n\n' +
      vals.filter(function (v) { return v.value; })
        .map(function (v) { return v.label + ': ' + v.value; })
        .join('\n');

    var dc = A.link('discord');
    var h = '<div class="tk-form">' +
      '<div class="nbox warn"><span class="n-ic">!</span><div>' +
      (PAUSE ? '<b>Сервер на перерыве между вайпами</b> — с сайта обращения сейчас ' +
        'не уходят. Ниже готовый текст: скопируй его и открой тикет в Discord, ' +
        'канал «тикеты». Разбирает та же команда.'
      : '<b>Сервер сейчас не принимает обращения</b> — скорее всего, он перезапускается. ' +
      'Написанное не пропало: вернитесь к форме через пару минут и отправьте снова — ' +
      'ответы останутся на месте. Ниже тот же текст целиком, на всякий случай.') +
      '</div></div>' +
      '<div class="form-go"><a class="btn btn-primary" href="#/' + esc(cat.key) + '">' +
      'Вернуться к форме</a></div>' +
      '<div class="field"><label for="tkDraft">Готовый текст обращения</label>' +
      '<textarea id="tkDraft" style="min-height:200px">' + esc(text) + '</textarea></div>' +
      '<div class="form-go">' +
      '<button class="btn btn-primary" type="button" id="tkCopy">Скопировать текст</button>' +
      (dc && (!NEW || PAUSE) ? '<a class="btn btn-dark" href="' + esc(dc) + '" target="_blank" ' +
            'rel="noopener">Открыть Discord</a>' : '') +
      '<div class="fg-note" role="status" id="tkCopySay">Текст уже собран — набирать заново ничего не надо.</div>' +
      '</div>' +
      '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
    body.innerHTML = h;
    scrollTop();

    document.getElementById('tkCopy').addEventListener('click', function () {
      var ta = document.getElementById('tkDraft');
      var say = document.getElementById('tkCopySay');
      var ok = function () { say.textContent = 'Скопировано.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(ok, function () { pick(ta, say); });
      } else {
        pick(ta, say);
      }
    });
  }

  /* Запасной способ: буфер обмена закрыт (старый браузер, http) — выделяем
     текст, дальше человек копирует сам. */
  function pick(ta, say) {
    ta.focus();
    ta.select();
    say.textContent = 'Текст выделен — скопируйте его сочетанием Ctrl+C.';
  }

  /* ------------------------------------------------------- проверка по номеру */

  function statusBox() {
    return '<div class="tk-status">' +
      '<h2 class="tk-gt">Уже писали?</h2>' +
      '<p class="tk-st-p">Номер обращения выдается при отправке. По нему видно, ' +
      'на какой стадии разбор — заново писать не нужно.</p>' +
      '<form class="tk-st-form" id="tkSt">' +
      '<label class="search"><svg class="s-ic" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<circle cx="9" cy="9" r="6"/><path d="M13.5 13.5 17 17"/></svg>' +
      '<input id="tkStId" type="text" maxlength="24" autocomplete="off" ' +
      'placeholder="номер обращения" aria-label="Номер обращения"></label>' +
      '<button class="btn btn-dark" type="submit">Проверить</button>' +
      '</form><div class="tk-st-say" id="tkStSay"></div></div>';
  }

  function bindStatus() {
    var f = document.getElementById('tkSt');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('tkStId').value.trim();
      var say = document.getElementById('tkStSay');
      if (!id) { say.textContent = 'Впишите номер, который выдали при отправке.'; return; }
      say.textContent = 'Смотрим…';
      A.call('/tickets/status?id=' + encodeURIComponent(id)).then(function (r) {
        var st = { open: 'в работе', wait: 'ждет вашего ответа', done: 'закрыто' };
        say.innerHTML = 'Обращение <b>' + esc(id) + '</b>: ' +
          esc(st[r.status] || r.status || 'найдено') +
          (r.note ? '. ' + esc(r.note) : '.');
      }, function (err) {
        say.textContent = A.textOf(err);
      });
    });
  }

  /* ----------------------------------------------------------------- маршрут */

  function scrollTop() {
    var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  }

  /* Прямая ссылка на закрытую тему (ее могли сохранить в закладки или прислать
     в ответ на вопрос) не должна молча выкидывать на витрину: человек пришел по
     делу и должен получить ответ «когда», а не гадать, куда делась страница. */
  function drawClosed(cat) {
    crumbs.innerHTML = '<a href="/">Главная</a><span>/</span>' +
      '<a href="#/">Обращения</a><span>/</span>' + esc(cleanName(cat.name));
    var dc = A.link('discord');
    body.innerHTML = '<div class="tk-form">' +
      '<div class="tk-head">' + icon(cat) + '<h2>' + esc(cleanName(cat.name)) +
      '</h2></div>' +
      '<div class="nbox warn"><span class="n-ic">!</span><div>' +
      '<b>Эта тема откроется вместе с сезоном — ' + esc(openWhen()) + '.</b> ' +
      'Пока сезон не начался, разбирать нечего: ни держав, ни построек, ни ' +
      'наказаний на сервере еще нет. Остальные темы на витрине работают уже ' +
      'сейчас, а срочное быстрее спросить в Discord.' +
      '</div></div>' +
      '<div class="form-go">' +
      '<a class="btn btn-primary" href="#/">Ко всем темам</a>' +
      (dc ? '<a class="btn btn-dark" href="' + esc(dc) + '" target="_blank" ' +
            'rel="noopener">Открыть Discord</a>' : '') +
      '</div></div>';
    document.title = cleanName(cat.name) + ' — обращения AEGIS SMP';
  }

  /* ------------------------------------------------------ мои обращения */

  /* Строка над витриной: кто вошел и где ответы. Не вошел — подсказка, что
     ответы живут здесь же, а не в Discord. */
  function meBar() {
    if (!NEW) return '';
    var s = A.session();
    if (s && s.token) {
      return '<div class="tk-me"><div>Вы вошли как <b>' + esc(s.nick || '') + '</b> · ' +
        '<a href="#/mine">Мои обращения</a><span id="tkMeN"></span></div>' +
        '<button type="button" class="btn btn-dark btn-sm" data-out>Выйти</button></div>';
    }
    return '<div class="tk-me"><div>Уже писали? Ответ команды — в ' +
      '<a href="#/mine">«Моих обращениях»</a>. Вход тем же ником и паролем, что в лаунчере.</div></div>';
  }

  /* «· 1 новый ответ» рядом со ссылкой — чтобы не заходить наугад. */
  function countMine() {
    var el = document.getElementById('tkMeN');
    if (!el || !NEW || !A.token()) return;
    A.call('/tickets/mine').then(function (r) {
      var n = (r && r.unread) || 0;
      if (n && document.getElementById('tkMeN') === el) {
        el.innerHTML = ' <span class="pill red">' + (n === 1 ? 'новый ответ' : 'новых ответов: ' + n) + '</span>';
      }
    }, function () {});
  }

  function bindOut(cb) {
    body.querySelectorAll('[data-out]').forEach(function (b) {
      if (b.getAttribute('data-bound')) return;
      b.setAttribute('data-bound', '1');
      b.addEventListener('click', function () {
        b.disabled = true;
        T.logout().then(cb, cb);
      });
    });
  }

  function crumbsTo(last, mid) {
    crumbs.innerHTML = '<a href="/">Главная</a><span>/</span>' +
      '<a href="#/">Обращения</a><span>/</span>' +
      (mid ? '<a href="#/mine">Мои обращения</a><span>/</span>' : '') + esc(last);
  }

  /* Старая служба сервера «Моих обращений» не знает — говорим прямо. */
  function notYet() {
    body.innerHTML = '<div class="tk-form"><div class="nbox warn"><span class="n-ic">!</span><div>' +
      '<b>«Мои обращения» заработают после обновления сервера.</b> Отправленное не ' +
      'потерялось — команда его видит и ответит.</div></div>' +
      '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
  }

  function gate(title, then) {
    body.innerHTML = '<div class="tk-form"><div id="tkGate"></div>' +
      '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
    T.login(document.getElementById('tkGate'), {
      title: title,
      lead: 'Ник и пароль те же, что в лаунчере. Аккаунта нет? ' +
        '<a href="reg">Заведите его</a>, это пара минут.',
      done: then
    });
  }

  function failBox(err, retry) {
    if (err && err.code === 'auth') { retry(); return; }
    if (err && err.code === 'http') { notYet(); return; }
    body.innerHTML = '<div class="tk-form"><div class="nbox warn"><span class="n-ic">!</span><div>' +
      esc(A.textOf(err)) + '</div></div><div class="form-go">' +
      '<button type="button" class="btn btn-primary" id="tkAgain">Попробовать еще раз</button></div>' +
      '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
    document.getElementById('tkAgain').addEventListener('click', retry);
  }

  function drawMine() {
    crumbsTo('Мои обращения');
    document.title = 'Мои обращения — AEGIS SMP';
    if (!NEW) { notYet(); return; }
    if (!A.token()) { gate('Войдите, чтобы увидеть свои обращения', drawMine); return; }
    body.innerHTML = '<div class="loading" aria-label="Загружаем ваши обращения…"><i></i><i></i><i></i></div>';
    A.call('/tickets/mine').then(function (r) {
      if (location.hash !== '#/mine') return;
      var items = (r && r.items) || [];
      var h = '<div class="tk-form tk-mine">';
      h += '<div class="tk-me"><div>Вы вошли как <b>' + esc(r.nick || '') + '</b></div>' +
        '<button type="button" class="btn btn-dark btn-sm" data-out>Выйти</button></div>';
      h += '<div class="tk-head"><h2>Мои обращения</h2></div>';
      if (!items.length) {
        h += '<div class="empty"><h4>Обращений пока нет</h4><p>Выберите тему ' +
          '<a href="#/">на витрине</a> — ответ команды придет сюда.</p></div>';
      } else {
        h += '<div class="row-list">';
        items.forEach(function (t) {
          h += '<a class="row r2 tk-row' + (t.unread ? ' tk-new' : '') + '" href="#/t/' +
            encodeURIComponent(t.id) + '"><div><div class="rw-t"><b>№' + esc(t.no) + '</b> · ' +
            esc(T.catName(t.cat, t.name)) +
            (t.unread ? ' <span class="pill red">новый ответ</span>' : '') + '</div>' +
            '<div class="rw-s">отправлено ' + esc(T.stamp(t.at)) + ' · обновлено ' +
            T.when(t.touched) + '</div></div>' +
            '<div class="rw-r">' + T.pill(t.status, true) + '</div></a>';
        });
        h += '</div>';
      }
      h += '<p class="tk-back"><a href="#/">← ко всем темам</a></p></div>';
      body.innerHTML = h;
      bindOut(route);
    }, function (err) { failBox(err, drawMine); });
  }

  function drawTicket(id) {
    crumbsTo('Обращение', true);
    document.title = 'Обращение — AEGIS SMP';
    if (!NEW) { notYet(); return; }
    if (!A.token()) { gate('Войдите, чтобы открыть обращение', function () { drawTicket(id); }); return; }
    body.innerHTML = '<div class="loading" aria-label="Загружаем обращение…"><i></i><i></i><i></i></div>';
    A.call('/tickets/get?id=' + encodeURIComponent(id)).then(function (r) {
      if (location.hash !== '#/t/' + id) return;
      showTicket(r.ticket);
    }, function (err) {
      if (err && err.code === 'no_ticket') {
        body.innerHTML = '<div class="tk-form"><div class="empty"><h4>Такого обращения нет среди ваших</h4>' +
          '<p>Возможно, вы вошли под другим ником. <a href="#/mine">Все мои обращения</a></p></div></div>';
        return;
      }
      failBox(err, function () { drawTicket(id); });
    });
  }

  /* Живая переписка открытого обращения: одна на страницу. */
  var LIVE = null;
  function stopLive() { if (LIVE) { LIVE.stop(); LIVE = null; } }

  function topOf(t) {
    var h = '<div class="tk-meta">' + T.pill(t.status, true) + '<span>' + esc(T.catName(t.cat, t.name)) +
      '</span><span>отправлено ' + esc(T.stamp(t.at)) + '</span></div>';
    var hint = { open: 'Обращение у команды. Ответ появится ниже, в переписке.',
      work: 'Команда уже разбирается. Ответ появится ниже, в переписке.',
      wait: 'Команда ответила и ждет вас — прочитайте переписку и напишите ответ внизу. ' +
        'Если не ответить больше суток, обращение закроется само; вопрос остался — напишите новое.' }[t.status];
    if (hint) h += '<p class="tk-hint">' + esc(hint) + '</p>';
    return h;
  }

  function crewOf(t) {
    /* Овнер 25.09.2026: «видно какой админ онлайн на сайте и сервере и какая
       должность, а то пишется в общем что команда». Только открытым: по
       закрытому обращению ждать уже некого. */
    var cr = t.crew || (INFO && INFO.crew);
    return t.canReply && cr ? '<h3 class="tk-h3">Кто из команды на связи</h3>' + T.crew(cr, false) : '';
  }

  function showTicket(t) {
    if (!t) return;
    stopLive();
    var me = (A.session() || {}).nick || '';
    crumbsTo('№' + (t.no || ''), true);
    document.title = 'Обращение №' + (t.no || '') + ' — AEGIS SMP';
    var lim = (INFO && INFO.limits) || {};
    var h = '<div class="tk-form tk-one">';
    h += '<div class="tk-head"><h2>Обращение №' + esc(t.no || '') + '</h2></div>';
    h += '<div id="tkTop">' + topOf(t) + '</div>';
    h += '<div class="tk-cols"><div class="tk-main">';
    h += '<h3 class="tk-h3 tk-h3-first">Ваша заявка</h3>' + T.fields(t.fields) + T.files(t.attach);
    h += '<h3 class="tk-h3">Переписка</h3><div id="tkFeed">' + T.thread(t.thread, me, false) + '</div>';
    if (t.canReply) h += '<div class="tk-typing" id="tkTyping" role="status" aria-live="polite" hidden></div>';
    if (t.canReply) {
      h += '<form id="tkRe" class="tk-reply" novalidate>' +
        '<div class="field"><label for="tkReT">Ваш ответ</label>' +
        '<textarea id="tkReT" maxlength="' + (lim.text || 4000) + '" ' +
        'placeholder="Дополнение, ответ на вопрос команды, новые подробности"></textarea></div>' +
        '<div class="field"><div id="tkReUp"></div></div>' +
        '<div class="form-go"><button class="btn btn-primary" type="submit">Отправить</button>' +
        '<button type="button" class="btn btn-dark" id="tkClose">Вопрос решен — закрыть</button>' +
        '<div class="fg-note" role="status" id="tkReSay"></div></div></form>';
    } else {
      h += '<div class="nbox"><span class="n-ic">i</span><div>Обращение закрыто' +
        (t.closedAt ? ' ' + esc(T.stamp(t.closedAt)) : '') + '. Если вопрос остался — ' +
        '<a href="#/">напишите новое</a>.</div></div>';
    }
    /* Овнер 28.09.2026: «на связи» — сбоку, а не под перепиской. */
    h += '</div><aside class="tk-side" id="tkCrew">' + crewOf(t) + '</aside></div>';
    h += '<p class="tk-back"><a href="#/mine">← все мои обращения</a></p></div>';
    body.innerHTML = h;
    T.heads(body);
    bindReply(t, lim);
    if (t.canReply && T.live) startLive(t);
  }

  /* Пришел ответ, сменилась стадия — перечитываем обращение и меняем только
     шапку, переписку и «на связи»: набранный текст, фокус и приложенные файлы
     остаются как были. Закрыли — рисуем заново: формы больше нет. */
  function startLive(t) {
    var busy = false;
    LIVE = T.live({
      url: '/tickets/live', type: '/tickets/typing', id: t.id,
      n: (t.thread || []).length, status: t.status,
      box: document.getElementById('tkTyping'),
      changed: function () {
        if (busy) return;
        busy = true;
        A.call('/tickets/get?id=' + encodeURIComponent(t.id)).then(function (r) {
          busy = false;
          var t2 = r.ticket;
          if (!t2 || location.hash !== '#/t/' + t.id || !document.getElementById('tkFeed')) return;
          if (!t2.canReply) { showTicket(t2); return; }
          var me = (A.session() || {}).nick || '';
          var top = document.getElementById('tkTop');
          var feed = document.getElementById('tkFeed');
          var crew = document.getElementById('tkCrew');
          top.innerHTML = topOf(t2);
          feed.innerHTML = T.thread(t2.thread, me, false);
          crew.innerHTML = crewOf(t2);
          T.heads(feed); T.heads(crew);
        }, function () { busy = false; });
      }
    });
    LIVE.input(document.getElementById('tkReT'));
  }

  function bindReply(t, lim) {
    var f = document.getElementById('tkRe');
    if (!f) return;
    var ta = document.getElementById('tkReT');
    var say = document.getElementById('tkReSay');
    var go = f.querySelector('button[type="submit"]');
    var up = T.uploader(document.getElementById('tkReUp'), lim);
    var key = 're:' + t.id;
    if (DRAFT[key]) ta.value = DRAFT[key];
    ta.addEventListener('input', function () { DRAFT[key] = ta.value; });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      var files = up.ids();
      if (up.busy()) { say.textContent = 'Дождитесь, пока загрузятся файлы.'; return; }
      if (!text && !files.length) { say.textContent = 'Напишите ответ или приложите файл.'; return; }
      go.disabled = true; go.textContent = 'Отправляем…'; say.textContent = '';
      if (LIVE) LIVE.sent();
      A.call('/tickets/reply', { body: { id: t.id, text: text, files: files } }).then(function (r) {
        delete DRAFT[key];
        showTicket(r.ticket);
        var s2 = document.getElementById('tkReSay');
        if (s2) s2.textContent = 'Отправлено — команда увидит ответ.';
      }, function (err) {
        go.disabled = false; go.textContent = 'Отправить';
        if (err && err.code === 'auth') { drawTicket(t.id); return; }
        say.textContent = A.textOf(err);
      });
    });

    document.getElementById('tkClose').addEventListener('click', function () {
      if (!confirm('Закрыть обращение? Команда перестанет его разбирать. Если вопрос вернется — напишите новое.')) return;
      this.disabled = true;
      A.call('/tickets/close', { body: { id: t.id } }).then(function (r) {
        showTicket(r.ticket);
      }, function (err) {
        say.textContent = A.textOf(err);
        document.getElementById('tkClose').disabled = false;
      });
    });
  }

  /* ------------------------------------------------------ частые ошибки

     Слово овнера 15.10.2026: «чтобы с одними и теми же проблемами не
     создавали тикеты, которые возникают как раз по вине игрока». Частая
     ошибка запуска (антивирус унес файлы, мало памяти, кончился диск)
     лечится за пару минут по шагам, а тикет по ней — сутки ожидания и ответ
     теми же шагами.

     Каталог data/hints.json — копия resources/hints.json лаунчера: ошибка
     узнается по тем же словам, шаги те же. Правишь подсказку — правь оба
     файла. Лаунчер присылает hint=<id> (подсказку он уже показал, ошибка
     узнана точно) и tried=1 (игрок нажал там «Не помогло — тикет») — тогда
     галочка уже стоит и шаги второй раз не навязываем.

     Подсказка не запрет: «Я сделал эти шаги — не помогло» пускает дальше, а
     при совпадении только по словам есть еще «Это не моя ошибка» — слово
     могло попасть в текст случайно. Что выбрал игрок, команда увидит: к
     обращению дописывается строка-метка. */
  var FIX_CATS = { bug: 1, help: 1 };
  var FIX = null;
  var HINTS = null;

  function hintsLoad() {
    if (!HINTS) HINTS = fetch('data/hints.json?v=1015a').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) { return d && d.hints && d.hints.length ? d : null; },
      function () { return null; });
    return HINTS;
  }

  /* Тот же порядок, что в лаунчере (Hints.match): сначала точные подсказки,
     общие (weak, «игра упала») — только если точной не нашлось. */
  function hintFind(list, text) {
    var t = String(text || '').toLowerCase();
    if (!t) return null;
    var hit = function (h) {
      return (h.any || []).some(function (a) { return a && t.indexOf(String(a).toLowerCase()) >= 0; });
    };
    for (var i = 0; i < list.length; i++) if (!list[i].weak && hit(list[i])) return list[i];
    for (var j = 0; j < list.length; j++) if (list[j].weak && hit(list[j])) return list[j];
    return null;
  }

  /* Текст обращения без ника: в нике слова ошибки не ищем. */
  function formText() {
    var t = [];
    body.querySelectorAll('#tkForm .field[data-i] textarea, #tkForm .field[data-i] input[type=text]')
      .forEach(function (el) {
        if (el.getAttribute('autocomplete') !== 'username') t.push(el.value);
      });
    return t.join('\n');
  }

  function stampDate(s) {
    return s.slice(6, 8) + '.' + s.slice(4, 6) + '.' + s.slice(0, 4);
  }

  function fixWire(cat, query) {
    FIX = null;
    if (!FIX_CATS[cat.key]) return;
    var q = null;
    try { q = new URLSearchParams(query || ''); } catch (e) {}
    var st = { key: cat.key, h: null, pin: false, ok: false, off: {}, skipped: null, old: '', drawn: null };
    FIX = st;
    var want = (q && q.get('hint')) || '';
    var tried = !!(q && q.get('tried') === '1');
    hintsLoad().then(function (d) {
      var form = document.getElementById('tkForm');
      if (!d || FIX !== st || !form) return;
      d.hints.forEach(function (h) { if (want && h.id === want) st.h = h; });
      st.pin = !!st.h;
      st.ok = st.pin && tried;
      /* Старый лаунчер: метку сборки он сам кладет в отчет («лаунчер собран:
         2026…»). Сборки до помощника ошибку не узнают — им сперва обновиться. */
      var m = /лаунчер собран:\s*(\d{14})/.exec(formText());
      st.old = m && d.build && m[1] < String(d.build) ? m[1] : '';
      var again = function () {
        if (FIX !== st || !document.getElementById('tkForm')) return;
        if (!st.pin) {
          var h = hintFind(d.hints, formText());
          if (h && st.off[h.id]) h = null;
          if (h !== st.h) { st.h = h; st.ok = false; }
        }
        fixDraw(st);
      };
      var tm = 0;
      form.addEventListener('input', function (e) {
        if (e.target && e.target.closest && e.target.closest('#tkFix')) return;
        clearTimeout(tm);
        tm = setTimeout(again, 300);
      });
      again();
    });
  }

  function fixDraw(st) {
    var form = document.getElementById('tkForm');
    if (!form) return;
    var key = (st.h ? st.h.id : '') + '|' + st.old;
    if (st.drawn === key) return;
    st.drawn = key;
    ['tkFix', 'tkOld'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.parentNode.removeChild(el);
    });
    var at = form.querySelector('.field');
    if (st.old) {
      var o = document.createElement('div');
      o.className = 'nbox warn';
      o.id = 'tkOld';
      o.innerHTML = '<span class="n-ic">!</span><div><b>Лаунчер у вас старый</b> (собран ' +
        esc(stampDate(st.old)) + '). Закройте его и откройте снова — он обновится сам, а новый ' +
        'частые ошибки узнает и сразу подскажет, что делать. Не обновляется — ' +
        '<a href="/#join">скачайте его заново</a>.</div>';
      form.insertBefore(o, at);
    }
    if (!st.h) return;
    var h = st.h;
    var gate = h.block !== false;
    var n = document.createElement('div');
    n.className = 'nbox tk-fix';
    n.id = 'tkFix';
    var s = '<span class="n-ic">?</span><div>' +
      '<b>Похоже на известную проблему: ' + esc(h.title) + '</b>' +
      (h.why ? '<p>' + esc(h.why) + '</p>' : '') +
      /* Шаги общие с лаунчером, а там кнопка «ниже» — в его окне ошибки. */
      ((h.steps || []).length ? '<ol>' + h.steps.map(function (x) {
        return '<li>' + esc(String(x).replace(/»\s+ниже/g, '» в окне ошибки лаунчера')) + '</li>';
      }).join('') + '</ol>' : '') +
      (h.act ? '<p class="tk-fix-n">Кнопки из шагов — в лаунчере AEGIS: в окне ошибки и в «Настройках».</p>' : '');
    if (gate) {
      s += '<label class="tk-fix-ok"><input type="checkbox" id="tkFixOk"' + (st.ok ? ' checked' : '') + '>' +
        '<span>Я сделал эти шаги — не помогло</span></label>';
      if (!st.pin) s += '<button type="button" class="tk-fix-x" id="tkFixX">Это не моя ошибка</button>';
    } else {
      s += '<p class="tk-fix-n">Обращение по этой теме подать можно, но сначала загляните в шаги: ' +
        'часто ответ уже здесь.</p>';
    }
    n.innerHTML = s + '</div>';
    form.insertBefore(n, at);
    var ok = document.getElementById('tkFixOk');
    if (ok) ok.addEventListener('change', function () {
      st.ok = ok.checked;
      n.classList.remove('bad');
    });
    var x = document.getElementById('tkFixX');
    if (x) x.addEventListener('click', function () {
      st.off[h.id] = 1;
      st.skipped = h;
      st.h = null;
      st.ok = false;
      fixDraw(st);
    });
  }

  /* Не пройдены шаги частой ошибки — отправку держим. true — можно слать. */
  function fixGate(cat, say) {
    var st = FIX;
    if (!st || st.key !== cat.key || !st.h || st.h.block === false || st.ok) return true;
    var box = document.getElementById('tkFix');
    var ok = document.getElementById('tkFixOk');
    if (box) {
      box.classList.add('bad');
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (ok) try { ok.focus({ preventScroll: true }); } catch (e) { ok.focus(); }
    say.textContent = 'Сначала шаги из подсказки выше — частая ошибка обычно решается ими за пару минут. ' +
      'Сделали, а ошибка осталась — отметьте галочку и отправьте.';
    return false;
  }

  /* Метка для команды: какую подсказку показали и что выбрал игрок. Дописываем
     в последнее длинное поле, не вылезая за его предел. Черновик (DRAFT) метку
     не хранит — иначе вторая отправка дописала бы ее дважды. */
  function fixTag(cat, fields, vals) {
    var st = FIX;
    var h = st && st.key === cat.key ? (st.h || st.skipped) : null;
    if (!h) return vals;
    var tag = '[подсказка: ' + h.title + ' — ' +
      (st.h ? (h.block === false ? 'показана' : 'шаги пройдены') : 'игрок отметил, что это не его ошибка') + ']';
    var out = vals.map(function (v) { return { label: v.label, value: v.value }; });
    for (var i = fields.length - 1; i >= 0; i--) {
      if (fields[i].style !== 'long' || fields[i].pick) continue;
      var v = out[i].value;
      var room = (fields[i].max || 900) - tag.length - 2;
      if (room < 0) return vals;
      out[i].value = (v.length > room ? v.slice(0, room) : v) + (v ? '\n\n' : '') + tag;
      return out;
    }
    return vals;
  }

  /* Заполнение формы по ссылке: лаунчер при сбое открывает
     tickets.html#/bug?src=launcher&nick=…&what=…&err=… — все в якоре, так что
     текст ошибки и пути с диска не уходят на сервер и в журналы. Поля берем
     только из закрытого списка, пишем лишь в ПУСТЫЕ и только как текст;
     отправляет форму все равно человек сам — ссылка не может ничего подать
     от чужого имени. */
  var PREFILL = {
    bug: { nick: /^ник(\s+в\s+игре)?$/i, what: /^что\s+сломалось/i, err: /^шаги/i, want: /^что\s+должно/i },
    help: { nick: /^ник(\s+в\s+игре)?$/i, err: /^в\s+ч[её]м\s+вопрос/i }
  };

  function prefill(cat, query) {
    var map = PREFILL[cat.key];
    if (!map || !query) return;
    var q;
    try { q = new URLSearchParams(query); } catch (e) { return; }
    var put = 0;
    Object.keys(map).forEach(function (name) {
      var v = q.get(name);
      if (!v) return;
      v = v.replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '')
        .trim();
      if (!v) return;
      var boxes = body.querySelectorAll('#tkForm .field[data-i]');
      for (var i = 0; i < boxes.length; i++) {
        var lab = boxes[i].querySelector('label');
        var el = boxes[i].querySelector('input, textarea');
        if (!lab || !el || el.value) continue;
        if (!map[name].test((lab.firstChild && lab.firstChild.nodeValue || '').trim())) continue;
        var max = Number(el.maxLength) > 0 ? Number(el.maxLength) : 900;
        el.value = v.length > max ? v.slice(0, max) : v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        put++;
        break;
      }
    });
    if (!put) return;
    var form = document.getElementById('tkForm');
    if (form && q.get('src') === 'launcher') {
      var n = document.createElement('div');
      n.className = 'nbox ok';
      n.innerHTML = '<span class="n-ic">✓</span><div><b>Форму заполнил лаунчер.</b> ' +
        'Проверьте текст, допишите, что делали перед ошибкой, и отправьте. ' +
        'Полный отчет лаунчер еще и скопировал — его можно вставить (Ctrl+V).</div>';
      form.insertBefore(n, form.firstChild);
    }
    var all = body.querySelectorAll('#tkForm input, #tkForm textarea');
    for (var k = 0; k < all.length; k++) {
      if (!all[k].value) { if (window.innerWidth > 900) all[k].focus(); break; }
    }
  }

  function route() {
    stopLive();
    var key = (location.hash || '').replace(/^#\/?/, '').trim();
    var qi = key.indexOf('?'), query = '';
    if (qi >= 0) { query = key.slice(qi + 1); key = key.slice(0, qi); }
    if (key === 'mine') { drawMine(); return; }
    var m = /^t\/([A-Za-z0-9_-]{1,64})$/.exec(key);
    if (m) { drawTicket(m[1]); return; }
    if (key && BY[key]) {
      if (closed(key)) { drawClosed(BY[key]); return; }
      drawForm(BY[key]);
      if (query) {
        prefill(BY[key], query);
        /* Из адресной строки текст убираем: обновление страницы или ссылка,
           скопированная из нее, не должны тащить чужой отчет дальше. */
        try { history.replaceState(null, '', location.pathname + location.search + '#/' + key); } catch (e) {}
      }
      fixWire(BY[key], query);
    } else drawList();
  }

  /* Какая служба за сайтом, узнаем одним вопросом. Не ответила (старая —
     404, или связи нет) — работаем по-старому, форма от этого не ломается. */
  var probe = !A.base() ? Promise.resolve(null)
    : A.call('/tickets/info', { timeout: 6000 }).then(function (r) { return r; }, function () { return null; });

  Promise.all([T.cats(), probe]).then(function (res) {
    CATS = res[0] || [];
    CATS.forEach(function (c) { BY[c.key] = c; });
    INFO = res[1];
    NEW = !!(INFO && INFO.ok !== false && INFO.limits);
    /* Переход в пульт видят только свои: игроку он ни к чему. */
    var go = document.getElementById('tkStaffGo');
    if (go && INFO && INFO.me && INFO.me.staff) {
      go.hidden = false;
      var on = (INFO.crew || []).length;
      if (on) document.getElementById('tkStaffGoS').textContent =
        'Все обращения по вашим темам · на связи из команды: ' + on;
    }
    if (!CATS.length) {
      body.innerHTML = '<div class="empty"><h4>Темы не загрузились</h4>' +
        '<p>Обновите страницу — список тем лежит прямо на сайте и грузится быстро.</p></div>';
      return;
    }
    route();
    /* «Назад» возвращает туда, где человек был в списке, а не в самый верх. */
    T.backScroll(route, scrollTop);
  }, function () {
    body.innerHTML = '<div class="empty"><h4>Темы не загрузились</h4>' +
      '<p>Похоже, оборвалась связь. Обновите страницу — список тем лежит прямо ' +
      'на сайте и грузится быстро.</p></div>';
  });
})();
