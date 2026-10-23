/* AEGIS — вики. Один и тот же текст, что бот выдаёт в Discord, только здесь
   его можно читать целиком, искать словом и давать ссылку на нужный пункт.

   Содержимое НЕ вшито в страницу: оно лежит в data/wiki.json (его собирает
   tools/export_from_bot.py прямо из бота) и в data/wiki-site.json (страницы,
   написанные для сайта). Поэтому правка правил в боте доезжает до сайта одной
   командой, и два ответа на один вопрос разойтись не могут.

   Адрес страницы — #/раздел и #/раздел/пункт: ссылку можно кинуть человеку,
   и он попадёт ровно туда. */
(function () {
  'use strict';

  var A = window.AegisApi;
  var elNav = document.getElementById('wNav');
  var elFound = document.getElementById('wFound');
  var elBody = document.getElementById('wBody');
  var elToc = document.getElementById('wToc');
  var elSide = document.getElementById('wSide');
  var elScrim = document.getElementById('wScrim');
  var elOpen = document.getElementById('wOpen');
  var elSearch = document.getElementById('wSearch');
  var elSbox = elSearch ? elSearch.parentNode : null;
  var elClear = document.getElementById('wClear');
  if (!elBody) return;

  var pages = [];
  var byslug = {};
  var index = [];
  var spy = null;

  /* Разделы боковой колонки. Слаг, которого тут нет, просто попадёт
     в «Разное» — вики не сломается, если в боте появится новая страница. */
  var GROUPS = [
    ['Начало', ['start', 'commands', 'season']],
    ['Правила', ['rules-game', 'rules-discord']],
    ['Мир', ['map', 'faith', 'mobs']],
    ['Экономика', ['economy', 'earn', 'market', 'trade']],
    ['Держава', ['states', 'land', 'town', 'diplomacy']],
    ['Война', ['war', 'raid', 'pvp-blasts', 'revolts']],
    ['Игра', ['tech', 'limits', 'changes', 'modpack', 'streamers', 'faq']],
    ['Команда', ['duties']]
  ];

  /* Значок — набор кусков, а не одна строка: так их можно двигать по отдельности,
     когда на строку наводят мышь. Порядок кусков = классы .p1, .p2, …, само
     движение — в css/pages.css, раздел «ЗНАЧКИ БОКОВОЙ». Один кусок можно
     оставить строкой. У страницы начала добавлен загнутый угол — тот самый,
     который и отгибается при наведении. */
  var ICON = {
    start: ['M4 4h9l4 4v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M13 4v4h4'],
    season: ['M4 5h12v12H4z', 'M4 9h12', 'M7 3v4', 'M13 3v4'],
    commands: ['M3 4h14v12H3z', 'M6 8l3 2-3 2', 'M11 12h3'],
    'rules-game': ['M5 3h11v15H5z', 'M8 7h5', 'M8 11h5'],
    'rules-discord': ['M5 3h11v15H5z', 'M8 7h5', 'M8 11h5'],
    economy: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M8 7h3a2 2 0 0 1 0 4H8v3M7 11h4'],
    earn: ['M3 15l4-5 3 3 6-7', 'M13 6h4v4'],
    market: ['M3 8h14l-1 9H4z', 'M7 8V5a3 3 0 0 1 6 0v3'],
    trade: ['M4 7h11l-3-3', 'M16 13H5l3 3'],
    map: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M3 10h14',
          'M10 3c3 3.5 3 10.5 0 14', 'M10 3c-3 3.5-3 10.5 0 14'],
    faith: ['M4 17V9a6 6 0 0 1 12 0v8', 'M2 17h16',
            'M10 13.5c1.4-1 1.8-2.4 0-4.5-1.8 2.1-1.4 3.5 0 4.5z'],
    mobs: ['M3 3h14v14H3z', 'M3 10h14', 'M10 3v14'],
    states: 'M10 2l7 3v6c0 4-3 6-7 7-4-1-7-3-7-7V5z',
    land: ['M3 6l5-2 4 2 5-2v11l-5 2-4-2-5 2z', 'M8 4v11', 'M12 6v11'],
    town: ['M3 17h14', 'M5 17V9l4-3 4 3v8', 'M13 17v-5h3v5', 'M8 17v-3h2v3'],
    diplomacy: ['M3 10l4-4 3 3 3-3 4 4', 'M7 13l3 3 3-3'],
    war: ['M4 16L15 5', 'M12 4h4v4', 'M5 12l3 3', 'M3 17l2-2'],
    raid: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M10 1v4M10 15v4M1 10h4M15 10h4'],
    'pvp-blasts': ['M10 2l2 5 5-2-3 5 4 3-5 1 1 5-4-3-4 3 1-5-5-1 4-3-3-5 5 2z'],
    revolts: ['M6 18V3', 'M6 4h9l-2 3 2 3H6'],
    modpack: 'M10 2l7 4v8l-7 4-7-4V6z',
    tech: ['M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
           'M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1'],
    limits: ['M3 16a7 7 0 0 1 14 0', 'M10 16l3-5'],
    changes: ['M4 5h9', 'M4 10h6', 'M4 15h4', 'M11 17v-2.5l5-5 2.5 2.5-5 5z'],
    streamers: ['M3 6h10v8H3z', 'M13 9l4-2v6l-4-2'],
    faq: ['M10 15v.5', 'M10 12c0-2 2-2 2-3.5A2 2 0 0 0 8 8'],
    duties: ['M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M4 17c0-3 3-5 6-5s6 2 6 5']
  };

  /* --------------------------------------------------------------- разметка */

  function esc(s) { return A.esc(s); }

  /* Ссылку берём только «свою» или https — на случай, если текст когда-нибудь
     начнут править не мы. */
  function href(u) {
    u = String(u || '').trim();
    /* Свои абсолютные ссылки — в относительные: так они ведут на ту же
       страницу и на aegis-smp.com, и на локальном просмотре. Текст вики не трогаем. */
    var own = /^https?:\/\/(www\.)?aegis-smp\.com\/?/i;
    if (own.test(u)) {
      u = u.replace(own, '');
      if (!u || u.charAt(0) === '#') u = '/' + u;
    }
    /* Адреса страниц без .html (24.10.2026): в текстах вики остались
       «wiki.html#/…» и «index.html#join» — показываем короткий вид. */
    u = u.replace(/^\/?index\.html(?=$|[#?])/i, '/').replace(/^(\/?[\w-]+)\.html(?=$|[#?])/i, '$1');
    if (/^https:\/\//i.test(u)) return u;
    if (/^[\w./#?=&%-]+$/.test(u)) return u;
    return '';
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      var h = href(u);
      if (!h) return t;
      var out = /^https:/i.test(h) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + h + '"' + out + '>' + t + '</a>';
    });
    return s;
  }

  /* Картинки и ролики. Отдельная строка текста
         ![Подпись под картинкой](assets/wiki/war/flag.webp 1280x720)
     становится картинкой с подписью, а такая же строка с .mp4 — роликом,
     который играет сам, без звука и по кругу, как гифка, но весит в разы
     меньше гифки. Размер «ШxВ» можно не писать, но с ним место под картинку
     занято сразу и текст не прыгает, пока она грузится.
     Обложка ролика — его первый кадр рядом с ним: имя.poster.webp.
     Файлы берутся ТОЛЬКО из assets/wiki/ — чужой адрес через текст на
     страницу не попадёт. */
  var MEDIA = /^!\[([^\]]*)\]\((assets\/wiki\/[\w\/.-]+\.(webp|png|jpe?g|gif|mp4))(?:[ \t]+(\d{2,4})x(\d{2,4}))?\)$/i;

  function figure(m) {
    var cap = m[1].trim(), src = m[2], vid = /^mp4$/i.test(m[3]);
    if (src.indexOf('..') >= 0) return '';
    var alt = esc(cap.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, ''));
    var size = m[4] ? ' width="' + m[4] + '" height="' + m[5] + '"' +
      ' style="aspect-ratio:' + m[4] + '/' + m[5] + '"' : '';
    var media = vid
      /* Ни src, ни обложку сразу не ставим: их подставит watchMedia(), когда
         ролик подъедет к экрану, — иначе раздел с десятком роликов качал бы
         их все разом. */
      ? '<video class="dv" muted loop playsinline disablepictureinpicture ' +
        'disableremoteplayback preload="none"' + size + ' aria-label="' + alt + '"' +
        ' data-src="' + src + '" data-poster="' + src.replace(/\.mp4$/i, '.poster.webp') + '"></video>'
      : '<img src="' + src + '" alt="' + alt + '"' + size + ' loading="lazy" decoding="async">';
    return '<figure class="doc-fig' + (vid ? ' is-vid' : '') + '">' +
      '<div class="df-m"' + (vid ? ' tabindex="0" role="button" ' +
        'aria-label="Остановить или продолжить ролик"' : '') + '>' + media + '</div>' +
      (cap ? '<figcaption>' + inline(cap) + '</figcaption>' : '') + '</figure>';
  }

  /* Абзацы, списки и заголовки уровня «##». Больше в текстах ничего нет.
     Осторожно со звёздочкой: «* » — это пункт списка, а «**» — жирный текст,
     и путать их нельзя, иначе от жирного остаётся висящая звёздочка. */
  var LI = /^(?:•\s*|[-*](?!\*)[ \t]+|(\d+)\.[ \t]+)(.+)$/;

  function blocks(text, out) {
    var lines = String(text || '').split('\n');
    var buf = [], list = [], figs = [], ord = false;

    function flushP() {
      if (!buf.length) return;
      out.push('<p class="doc-p">' + inline(buf.join(' ')) + '</p>');
      buf = [];
    }
    function flushL() {
      if (!list.length) return;
      var tag = ord ? 'ol' : 'ul';
      out.push('<' + tag + ' class="doc-ul' + (ord ? ' doc-ol' : '') + '">' +
        list.map(function (x, n) {
          return '<li class="doc-li">' + inline(x) + (figs[n] || '') + '</li>';
        }).join('') + '</' + tag + '>');
      list = [];
      figs = [];
      ord = false;
    }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) { flushP(); flushL(); continue; }
      /* Картинка сразу под пунктом списка (без пустой строки между ними)
         встаёт внутрь этого пункта: иначе нумерованный список порвался бы
         на два, и шаг 2 снова стал бы шагом 1. */
      var md = ln.match(MEDIA);
      if (md) {
        flushP();
        if (list.length) figs[list.length - 1] = (figs[list.length - 1] || '') + figure(md);
        else out.push(figure(md));
        continue;
      }
      var li = ln.match(LI);
      if (li) {
        flushP();
        /* Смена вида списка — новый список, а не продолжение старого. */
        if (list.length && ord !== !!li[1]) flushL();
        ord = !!li[1];
        list.push(li[2]);
        continue;
      }
      flushL();
      buf.push(ln);
    }
    flushP(); flushL();
  }

  /* Якорь из заголовка: латиницей, чтобы ссылку было не стыдно кинуть. */
  var TR = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
  };
  function slugify(s) {
    var t = String(s || '').toLowerCase().replace(/<[^>]+>/g, '');
    var r = '';
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      r += TR[c] !== undefined ? TR[c] : (/[a-z0-9]/.test(c) ? c : '-');
    }
    return r.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'p';
  }

  /* ------------------------------------------------------------- страницы */

  /* Перерыв между вайпами (18.10.2026): в статьях расписание первого вайпа —
     «с 24 сентября», «с 26 сентября». Правила не переписываем, а говорим прямо,
     к чему эти числа. Дата следующего вайпа появится в main.js — пометка уйдет. */
  var PAUSED = typeof OPEN_DATE !== 'undefined' && OPEN_DATE === null;
  var OLD_DATES = /\d{1,2} (сентября|октября)/;

  function head(p) {
    var dated = PAUSED && OLD_DATES.test((p.intro || '') + (p.body || '') +
      JSON.stringify(p.sections || ''));
    return '<div class="dh"><h1>' + esc(p.title) + '</h1>' +
      (p.intro ? '<p>' + inline(p.intro) + '</p>' : '') + '</div>' +
      (dated ? '<div class="nbox"><span class="n-ic">!</span><div>Даты в статье — ' +
        'расписание первого вайпа сезона «1936» (19 сентября — 17 октября 2026). ' +
        'Расписание следующего вайпа объявим вместе с его датой.</div></div>' : '');
  }

  function h2(title, id) {
    return '<h2 class="doc-h2" id="' + id + '">' + esc(title) +
      '<a class="anchor" href="#/' + cur + '/' + id + '" ' +
      'aria-label="Ссылка на раздел">#</a></h2>';
  }

  function drawDoc(p, out, toc) {
    var parts = String(p.body || '').split(/^##\s+/m);
    if (parts[0].trim()) blocks(parts[0], out);
    for (var i = 1; i < parts.length; i++) {
      var nl = parts[i].indexOf('\n');
      var title = (nl < 0 ? parts[i] : parts[i].slice(0, nl)).trim();
      var body = nl < 0 ? '' : parts[i].slice(nl + 1);
      var id = slugify(title);
      toc.push([title, id]);
      out.push(h2(title, id));
      blocks(body, out);
    }
  }

  function drawRules(p, out, toc) {
    for (var i = 0; i < p.sections.length; i++) {
      var s = p.sections[i];
      var id = slugify(s.title);
      toc.push([s.title, id]);
      out.push(h2(s.title, id));
      for (var j = 0; j < s.rules.length; j++) {
        var r = s.rules[j], n = (i + 1) + '.' + (j + 1);
        out.push('<div class="rule"><div class="r-n">' + n +
          '</div><div class="r-t">' + inline(r.text) +
          ruleNote('Пример', r.example, '') + ruleNote('Исключения', r.except, ' r-x-ex') + '</div>' +
          (r.penalty ? '<div class="r-p">' + esc(r.penalty) + '</div>' : '') +
          '</div>');
        // подпункты: 1.3.1, 1.3.2 — со своей мерой, если она отличается
        (r.subs || []).forEach(function (u, k) {
          out.push('<div class="rule rule-sub"><div class="r-n">' + n + '.' + (k + 1) +
            '</div><div class="r-t">' + inline(u.text) + '</div>' +
            (u.penalty ? '<div class="r-p">' + esc(u.penalty) + '</div>' : '') +
            '</div>');
        });
      }
    }
  }

  /* «Пример» и «Исключения» под текстом пункта; переносы строк сохраняются. */
  function ruleNote(label, text, cls) {
    if (!text) return '';
    return '<div class="r-x' + cls + '"><span class="r-xl">' + label + ':</span> ' +
      String(text).split('\n').map(inline).join('<br>') + '</div>';
  }

  function drawDuties(p, out, toc) {
    var tier = '';
    for (var i = 0; i < p.blocks.length; i++) {
      var b = p.blocks[i];
      if (b.tier && b.tier !== tier) {
        tier = b.tier;
        var id = slugify(tier);
        toc.push([tier, id]);
        out.push(h2(tier, id));
      }
      out.push('<div class="duty"><div class="duty-h"><h3>' + esc(b.title) +
        '</h3></div><div class="duty-cols">' +
        '<div><h6>Обязанности</h6><ul class="doc-ul">' +
        b.must.map(function (x) { return '<li class="doc-li">' + inline(x) + '</li>'; }).join('') +
        '</ul></div><div><h6>Права</h6><ul class="doc-ul">' +
        b.may.map(function (x) { return '<li class="doc-li">' + inline(x) + '</li>'; }).join('') +
        '</ul></div></div></div>');
    }
  }

  function drawMods(p, out, toc) {
    var id = 'spisok';
    toc.push(['Весь список', id]);
    out.push(h2('Всего модов: ' + p.total, id));
    out.push('<div class="mods-groups">');
    for (var i = 0; i < p.groups.length; i++) {
      var g = p.groups[i];
      out.push('<div class="mod-group"><h3>' + esc(g.name) +
        ' <em>' + g.items.length + '</em></h3>');
      for (var j = 0; j < g.items.length; j++) {
        out.push('<div class="mod-row"><span>' + esc(g.items[j].name) + '</span>' +
          (g.items[j].version ? '<em>' + esc(g.items[j].version) + '</em>' : '') +
          '</div>');
      }
      out.push('</div>');
    }
    out.push('</div>');
  }

  function drawFaq(p, out, toc) {
    var id = 'voprosy';
    toc.push(['Все вопросы', id]);
    out.push(h2('Все вопросы', id));
    for (var i = 0; i < p.items.length; i++) {
      var q = p.items[i];
      var body = [];
      blocks(q.a, body);
      /* Раскрыт вопрос или нет, видно только по значку «+/−» — словами это не
         сказано, поэтому кнопке нужен aria-expanded, а ответу — свой id, на
         который она ссылается. */
      out.push('<div class="qa" data-q="' + i + '"><button class="qa-q" type="button" ' +
        'aria-expanded="false" aria-controls="qa-a-' + i + '">' +
        esc(q.q) + '<span class="qa-x"></span></button>' +
        '<div class="qa-wrap" id="qa-a-' + i + '"><div class="qa-a"><div>' + body.join('') +
        '</div></div></div></div>');
    }
  }

  /* -------------------------------------------------------------- отрисовка */

  var cur = '';
  var swapT = 0;

  /* Смена раздела — переход, а не подмена одним кадром. Слово овнера
     17.09.2026: «переход между категориями должен плавно осуществляться,
     а не резко».

     Важен порядок. Раньше разметка менялась мгновенно, а страница ПОСЛЕ
     этого ещё ехала к началу: в css/style.css у сайта scroll-behavior:
     smooth, и window.scrollTo(0, 0) его слушается. Получалось худшее из
     двух — текст сменился рывком, а прокрутка потом долго доезжала, и
     новый заголовок человек видел где-то посреди дороги.

     Теперь наоборот: сначала гасим текст и оглавление, и только под
     затемнением, когда их не видно, прыгаем к началу — мгновенно, чтобы
     прыжок закончился раньше, чем текст проявится обратно.

     Переход только при СМЕНЕ раздела. Ссылка оглавления ведёт на ту же
     страницу: гасить там нечего, человек просто едет к своему заголовку,
     и эта поездка плавная сама по себе. Первую отрисовку и «спокойный
     режим» (prefers-reduced-motion) рисуем сразу, без перехода. */
  function fade(on) {
    elBody.classList.toggle('is-swap', on);
    if (elToc) elToc.classList.toggle('is-swap', on);
  }

  /* Мгновенная прокрутка. Просить behavior: 'instant' напрямую нельзя:
     браузер, который такого значения не знает, бросает ошибку прямо на
     разборе настроек — и подмена текста не доедет до конца. Снимаем
     плавность у самой страницы на один вызов и возвращаем как было. */
  function hardScroll(go) {
    var st = document.documentElement.style;
    var was = st.scrollBehavior;
    st.scrollBehavior = 'auto';
    go();
    st.scrollBehavior = was;
  }

  function show(slug, anchor) {
    var p = byslug[slug] || pages[0];
    if (!p) return;
    if (CALM || !cur || p.slug === cur) { draw(p, anchor, false); return; }

    /* Успел щёлкнуть по третьему разделу, пока гас второй — считаем от
       последнего щелчка: страница и так уже не видна, гасить её заново
       не нужно, а нарисоваться должно то, что выбрали последним. */
    if (swapT) clearTimeout(swapT);
    fade(true);
    swapT = setTimeout(function () {
      swapT = 0;
      draw(p, anchor, true);
      fade(false);
    }, 150);
  }

  /* Разметка страницы целиком. Отдельно от draw(): тем же кодом редактор
     (js/wiki-edit.js) рисует «как будет выглядеть» и старые версии — правка
     выглядит ровно так, как её потом увидят. */
  function render(p) {
    var out = [head(p)], toc = [];
    if (p.type === 'rules') drawRules(p, out, toc);
    else if (p.type === 'duties') drawDuties(p, out, toc);
    else if (p.type === 'modpack') drawMods(p, out, toc);
    else if (p.type === 'faq') drawFaq(p, out, toc);
    else drawDoc(p, out, toc);
    return { html: out.join(''), toc: toc };
  }

  /* jump = «мы сейчас под затемнением»: прокрутку в этот миг двигаем рывком,
     её всё равно не видно. */
  function draw(p, anchor, jump) {
    cur = p.slug;
    var r = render(p), toc = r.toc;

    elBody.innerHTML = r.html;
    watchMedia();
    if (W.hooks.draw) W.hooks.draw(p);
    document.title = p.title + ' — вики AEGIS SMP';

    var links = elNav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active',
        links[i].getAttribute('data-s') === p.slug);
    }

    if (toc.length > 1) {
      elToc.innerHTML = '<div class="dn-t">На этой странице</div>' + toc.map(function (t) {
        return '<a href="#/' + p.slug + '/' + t[1] + '" data-a="' + t[1] + '">' +
          esc(t[0]) + '</a>';
      }).join('');
    } else {
      elToc.innerHTML = '';
    }
    watchToc();

    function go() {
      if (anchor) {
        var el = document.getElementById(anchor);
        if (el) { el.scrollIntoView(); return; }
      }
      window.scrollTo(0, 0);
    }
    if (jump) hardScroll(go);
    else go();
  }

  /* Подсветка пункта «на этой странице» по мере прокрутки.

     Раньше это считал наблюдатель пересечений: пункт горел, только пока сам
     заголовок находился в узкой полосе у верха окна. Разделы в вики длинные —
     стоило отъехать от заголовка вниз, как из полосы уходили все, и подсветка
     гасла целиком. Человек смотрит в оглавление именно для того, чтобы понять,
     где он сейчас, и пустой список отвечает «нигде».

     Считаем прямо: текущий — последний заголовок, который уже проехал верх
     окна. Пока не доехали до первого, горит первый. Так же сделана полоса
     вкладок в лавке (js/main.js) — две одинаковые вещи работают одинаково. */
  function watchToc() {
    if (spy) { spy(); spy = null; }
    var heads = elBody.querySelectorAll('.doc-h2');
    if (!heads.length || !elToc.children.length) return;
    var links = elToc.querySelectorAll('a');

    function pick() {
      var id = heads[0].id;
      for (var i = 0; i < heads.length; i++) {
        /* 120px — высота шапки с запасом: заголовок считается пройденным,
           когда он уходит под неё, а не когда касается края окна. */
        if (heads[i].getBoundingClientRect().top <= 120) id = heads[i].id;
      }
      for (var k = 0; k < links.length; k++) {
        links[k].classList.toggle('active', links[k].getAttribute('data-a') === id);
      }
    }
    /* Заголовков на странице десяток — считать их положение прямо на событие
       дешевле, чем городить откладывание на кадр (и надёжнее: в фоновой
       вкладке кадры не рисуются вовсе, а подсветку всё равно надо успеть
       поставить к моменту, когда на вкладку вернутся). */
    addEventListener('scroll', pick, { passive: true });
    addEventListener('resize', pick);
    spy = function () {
      removeEventListener('scroll', pick);
      removeEventListener('resize', pick);
    };
    pick();
  }

  /* Ролики играют, только пока их видно. Подъехал ближе чем на 400 пикселей
     к экрану — подставляем файл и обложку, и он начинает грузиться; виден
     хоть на четверть — играет; ушёл с экрана — пауза. Трафик уходит только
     на то, что человек правда листает, а телефон не крутит десяток роликов
     за кадром.
     «Спокойный режим» (prefers-reduced-motion) и «экономия трафика» — сами
     не запускаем: стоит обложка со значком ▶, ролик пускается касанием.
     Касание по играющему ролику ставит его на паузу — чтобы разглядеть шаг;
     такой ролик уже не оживает сам при прокрутке, пока его не тронут снова. */
  var nearIO = null, seenIO = null;
  var SAVE = !!(navigator.connection && navigator.connection.saveData);

  function arm(v) {
    if (v.getAttribute('src')) return;
    v.setAttribute('poster', v.getAttribute('data-poster'));
    v.preload = 'auto';
    v.src = v.getAttribute('data-src');
  }

  function play(v) {
    arm(v);
    v.muted = true;            /* без звука браузер пускает ролик без касания */
    var f = v.parentNode.parentNode;
    f.classList.remove('is-stopped');
    var p = v.play();
    /* Отказ — это, например, айфон в режиме энергосбережения: там ролики
       сами не стартуют вообще. Показываем ▶, касание запустит. */
    if (p && p.catch) p.catch(function () { f.classList.add('is-stopped'); });
  }

  function watchMedia() {
    if (nearIO) { nearIO.disconnect(); nearIO = null; }
    if (seenIO) { seenIO.disconnect(); seenIO = null; }
    var vids = elBody.querySelectorAll('video.dv');
    if (!vids.length) return;
    var auto = !CALM && !SAVE;
    var i;

    if (!auto || !('IntersectionObserver' in window)) {
      for (i = 0; i < vids.length; i++) {
        vids[i].setAttribute('poster', vids[i].getAttribute('data-poster'));
        if (auto) play(vids[i]);
        else vids[i].parentNode.parentNode.classList.add('is-stopped');
      }
      return;
    }

    nearIO = new IntersectionObserver(function (es) {
      for (var k = 0; k < es.length; k++) {
        if (!es[k].isIntersecting) continue;
        arm(es[k].target);
        nearIO.unobserve(es[k].target);
      }
    }, { rootMargin: '400px 0px' });

    seenIO = new IntersectionObserver(function (es) {
      for (var k = 0; k < es.length; k++) {
        var v = es[k].target;
        if (es[k].isIntersecting) {
          if (!v.parentNode.parentNode.classList.contains('is-held')) play(v);
        } else if (!v.paused) {
          v.pause();
        }
      }
    }, { threshold: 0.25 });

    for (i = 0; i < vids.length; i++) {
      nearIO.observe(vids[i]);
      seenIO.observe(vids[i]);
    }
  }

  /* Касание или Enter/пробел на ролике — пауза или продолжение. */
  function toggleVid(box) {
    var f = box.parentNode, v = box.querySelector('video');
    if (!v) return;
    if (v.paused) { f.classList.remove('is-held'); play(v); }
    else { v.pause(); f.classList.add('is-held', 'is-stopped'); }
  }
  elBody.addEventListener('click', function (e) {
    var box = e.target.closest ? e.target.closest('.doc-fig.is-vid .df-m') : null;
    if (box) toggleVid(box);
  });
  elBody.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var box = e.target.closest ? e.target.closest('.doc-fig.is-vid .df-m') : null;
    if (!box) return;
    e.preventDefault();
    toggleVid(box);
  });

  /* ---------------------------------------------------------------- поиск */

  /* Индекс — плоский список кусочков текста. Страниц шесть, кусочков пара
     сотен: перебирать их на каждое нажатие дешевле, чем городить дерево. */
  function buildIndex() {
    index = [];
    function add(p, title, id, text) {
      /* От строки с картинкой в поиск идёт только подпись, без адреса файла. */
      text = String(text || '').replace(/^!\[([^\]]*)\]\([^)]*\)[ \t]*$/gm, '$1')
        .replace(/[*`]/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
      if (!text) return;
      index.push({ slug: p.slug, page: p.title, title: title, id: id,
        text: text, low: text.toLowerCase() });
    }
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.type === 'rules') {
        p.sections.forEach(function (s) {
          s.rules.forEach(function (r) {
            var t = [r.text].concat((r.subs || []).map(function (u) { return u.text; }));
            if (r.example) t.push(r.example);
            if (r.except) t.push(r.except);
            add(p, s.title, slugify(s.title), t.join('. '));
          });
        });
      } else if (p.type === 'duties') {
        p.blocks.forEach(function (b) {
          add(p, b.title, slugify(b.tier), b.must.concat(b.may).join('. '));
        });
      } else if (p.type === 'faq') {
        p.items.forEach(function (q) { add(p, q.q, 'voprosy', q.q + '. ' + q.a); });
      } else if (p.type === 'modpack') {
        p.groups.forEach(function (g) {
          add(p, g.name, 'spisok', g.items.map(function (m) { return m.name; }).join(', '));
        });
      } else {
        String(p.body || '').split(/^##\s+/m).forEach(function (part, n) {
          if (!n) { add(p, p.title, '', part); return; }
          var nl = part.indexOf('\n');
          var t = (nl < 0 ? part : part.slice(0, nl)).trim();
          add(p, t, slugify(t), nl < 0 ? '' : part.slice(nl + 1));
        });
      }
      add(p, p.title, '', p.intro);
    }
  }

  function find(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    var words = q.split(/\s+/).slice(0, 5);
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i], score = 0, first = -1;
      for (var w = 0; w < words.length; w++) {
        var at = it.low.indexOf(words[w]);
        if (at < 0) { score = 0; break; }
        score += 1;
        if (first < 0 || at < first) first = at;
      }
      if (!score) continue;
      if (it.title.toLowerCase().indexOf(q) >= 0) score += 3;
      hits.push({ it: it, score: score, at: first });
    }
    hits.sort(function (a, b) { return b.score - a.score || a.at - b.at; });
    return hits.slice(0, 24);
  }

  function cut(text, at) {
    var from = Math.max(0, at - 40);
    var s = text.slice(from, from + 150);
    return (from ? '…' : '') + s + (from + 150 < text.length ? '…' : '');
  }

  function mark(html, words) {
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      var re = new RegExp('(' + words[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      html = html.replace(re, '<mark>$1</mark>');
    }
    return html;
  }

  function runSearch() {
    var q = elSearch.value;
    elSbox.classList.toggle('has', !!q);
    if (q.trim().length < 2) {
      elFound.hidden = true;
      elNav.hidden = false;
      return;
    }
    var hits = find(q);
    var words = q.trim().toLowerCase().split(/\s+/).slice(0, 5);
    elNav.hidden = true;
    elFound.hidden = false;
    if (!hits.length) {
      elFound.innerHTML = '<div class="df-n">Ничего не нашлось. Попробуйте другое слово ' +
        'или откройте <a href="#/faq">частые вопросы</a>.</div>';
      return;
    }
    elFound.innerHTML = '<div class="df-n">Нашлось: ' + hits.length + '</div>' +
      hits.map(function (h) {
        var it = h.it;
        var link = '#/' + it.slug + (it.id ? '/' + it.id : '');
        return '<a href="' + link + '"><b>' + mark(esc(it.title), words) +
          '</b><s>' + mark(esc(cut(it.text, h.at)), words) + '</s></a>';
      }).join('');
  }

  /* -------------------------------------------------------------- боковая */

  function drawNav() {
    var used = {}, html = '';
    function item(p) {
      used[p.slug] = 1;
      var d = ICON[p.slug] || ICON.start;
      var parts = typeof d === 'string' ? [d] : d;
      var body = '';
      for (var k = 0; k < parts.length; k++) {
        body += '<path class="p' + (k + 1) + '" d="' + parts[k] + '"/>';
      }
      return '<a href="#/' + p.slug + '" data-s="' + p.slug + '">' +
        '<svg class="dn-ic" data-i="' + esc(p.slug) + '" viewBox="0 0 20 20" fill="none" ' +
        'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        body + '</svg>' + esc(p.title) +
        (p.hidden ? '<em class="dn-draft">черновик</em>' : '') + '</a>';
    }
    /* Раздел страницы — её поле group (его ставят в редакторе), а без него
       тот, где слаг записан в GROUPS. Раздел, которого в GROUPS нет, встаёт
       после известных: команда может завести свой, ничего не ломая. */
    var names = GROUPS.map(function (x) { return x[0]; });
    pages.forEach(function (p) {
      if (p.group && p.group !== 'Разное' && names.indexOf(p.group) < 0) names.push(p.group);
    });
    for (var g = 0; g < names.length; g++) {
      var rows = '', known = g < GROUPS.length ? GROUPS[g][1] : [];
      for (var i = 0; i < known.length; i++) {
        var p = byslug[known[i]];
        if (p && (!p.group || p.group === names[g])) rows += item(p);
      }
      for (var k = 0; k < pages.length; k++) {
        if (!used[pages[k].slug] && pages[k].group === names[g]) rows += item(pages[k]);
      }
      if (rows) html += '<div class="dn-t">' + esc(names[g]) + '</div>' + rows;
    }
    var rest = '';
    for (var j = 0; j < pages.length; j++) {
      if (!used[pages[j].slug]) rest += item(pages[j]);
    }
    if (rest) html += '<div class="dn-t">Разное</div>' + rest;
    elNav.innerHTML = html;
    if (W.hooks.nav) W.hooks.nav(elNav);
  }

  /* Значок в боковой оживает один раз за наведение и всегда доигрывает.
     Раньше движение висело прямо на :hover (css/pages.css): курсор ушёл в
     середине — рисунок бросал позу и вставал на место одним кадром, овнер
     назвал это подёргиванием. Теперь курсор только ставит метку .ani, а
     снимает её сам значок, когда все его движения закончились; уводить
     курсор можно когда угодно. Пока метка стоит, лишние переходы мышью
     внутри той же ссылки движение не перезапускают — иначе значок дёргался
     бы от каждого шевеления. */
  var navHot = null;
  var CALM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  elNav.addEventListener('mouseover', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a === navHot) return;
    navHot = a;
    if (!a || CALM) return;
    a.classList.remove('ani');
    void a.offsetWidth;          /* иначе метка снимется и встанет одним махом */
    a.classList.add('ani');
  });

  /* Курсор ушёл из боковой целиком — забываем, на чём стояли, иначе
     возвращение на ту же ссылку не оживит значок второй раз. */
  elNav.addEventListener('mouseleave', function () { navHot = null; });

  elNav.addEventListener('animationend', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.classList.contains('ani')) return;
    if (a.getAnimations) {
      var live = a.getAnimations({ subtree: true });
      for (var i = 0; i < live.length; i++) {
        if (live[i].playState === 'running') return;   /* другие куски ещё идут */
      }
    }
    a.classList.remove('ani');
  });

  /* Кнопка «Содержание и поиск» выдвигает панель, но сама об этом молчала, а
     фокус оставался на странице под ней: с клавиатуры панель открывалась и
     оставалась недосягаемой. Открыли — фокус уходит в панель, закрыли —
     возвращается на кнопку (только если она на экране: на широком экране
     панель стоит на месте и кнопки нет). */
  function drawer(on) {
    var was = elSide.classList.contains('open');
    elSide.classList.toggle('open', on);
    elScrim.classList.toggle('on', on);
    document.body.style.overflow = on ? 'hidden' : '';
    if (elOpen) elOpen.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on === was) return;
    if (on) elSide.focus();
    else if (elOpen && elOpen.offsetParent !== null) elOpen.focus();
  }

  /* Панель закрывает страницу затемнением, значит и вести себя должна как
     окно: Tab с последней ссылки возвращается к первой, а не уходит в текст,
     которого сейчас не видно. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !elSide.classList.contains('open')) return;
    var list = [];
    var all = elSide.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])');
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetWidth || all[i].offsetHeight) list.push(all[i]);
    }
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    var inside = elSide.contains(document.activeElement);
    if (e.shiftKey ? (!inside || document.activeElement === first)
                   : (!inside || document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });

  /* --------------------------------------------------------------- маршрут */

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var bits = h.split('/');
    show(bits[0] || 'start', bits[1] || '');
    if (window.matchMedia('(max-width: 900px)').matches) drawer(false);
  }

  /* ----------------------------------------------------------------- пуск */

  /* Числа мира в тексте — живые. Нарезку карты меняли уже не раз, и число,
     набранное руками, в тот же день становится враньём. Поэтому в тексте
     стоит метка «{мир:provinces|495}»: до вертикальной черты — ключ из
     data/world.json (его собирает site\tools\world_build.py прямо из данных
     карты), после — что показать, если файл не догрузился.

     Подставляем ДО сборки поиска, а не при отрисовке: иначе метка попадёт
     в поисковый указатель и человек будет искать по фигурным скобкам. */
  function spaced(n) {
    return n < 10000 ? String(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function worldNums(text, w) {
    if (typeof text !== 'string' || text.indexOf('{мир:') < 0) return text;
    return text.replace(/\{мир:(\w+)(?:\|([^}]*))?\}/g, function (m, key, alt) {
      var v = w && w[key];
      return typeof v === 'number' ? spaced(v) : (alt || '');
    });
  }

  /* Правки команды (овнер 03.10.2026: вышке — править любую страницу вики).
     Тексты из файлов — основа. Правки, сделанные на сайте редактором
     (js/wiki-edit.js), живут в службе — выкладка сайта подменяет файлы
     целиком и стёрла бы их — и ложатся поверх по слагу. Служба молчит —
     вики показывает тексты из файлов, как раньше.
     Редактору нужен СЫРОЙ текст, с метками «{мир:…}», а не с числами: иначе
     первая же правка навсегда вморозила бы сегодняшнее число в страницу.
     Поэтому храним сырые страницы, а числа подставляем на копии (cook). */
  var files = [], fileRaw = {}, edits = {}, world = null, staff = false;

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function cook(raw) {
    var p = copy(raw);
    p.intro = worldNums(p.intro, world);
    p.body = worldNums(p.body, world);
    return p;
  }

  /* Черновик (hidden) игрокам служба не отдаёт вовсе; команде он виден
     с пометкой, а у страницы из файлов вместо него игроки видят прежний текст. */
  function rebuild() {
    var list = [], seen = {};
    files.forEach(function (f) {
      var e = edits[f.slug];
      seen[f.slug] = 1;
      list.push(cook(e && (!e.hidden || staff) ? e : f));
    });
    Object.keys(edits).forEach(function (s) {
      if (!seen[s] && (!edits[s].hidden || staff)) list.push(cook(edits[s]));
    });
    pages = list;
    byslug = {};
    for (var i = 0; i < pages.length; i++) byslug[pages[i].slug] = pages[i];
    buildIndex();
    drawNav();
  }

  var W = window.AegisWiki = {
    hooks: { draw: null, nav: null },
    cur: function () { return cur; },
    page: function (s) { return byslug[s] || null; },
    fileRaw: function (s) { return fileRaw[s] ? copy(fileRaw[s]) : null; },
    edit: function (s) { return edits[s] ? copy(edits[s]) : null; },
    raw: function (s) { return W.edit(s) || W.fileRaw(s); },
    exists: function (s) { return !!(fileRaw[s] || edits[s]); },
    groups: function () {
      var n = GROUPS.map(function (x) { return x[0]; });
      Object.keys(edits).forEach(function (s) {
        var g = edits[s].group;
        if (g && g !== 'Разное' && n.indexOf(g) < 0) n.push(g);
      });
      return n;
    },
    groupOf: function (s) {
      for (var g = 0; g < GROUPS.length; g++) {
        if (GROUPS[g][1].indexOf(s) >= 0) return GROUPS[g][0];
      }
      return 'Разное';
    },
    render: function (raw) { return render(cook(raw)); },
    setEdit: function (s, raw) {
      if (raw) edits[s] = copy(raw);
      else delete edits[s];
      rebuild();
    },
    setStaff: function (on) { staff = !!on; rebuild(); },
    redraw: function () {
      var p = byslug[cur];
      if (p) draw(p, '', false);
      else route();
    },
    slugify: slugify,
    closeSide: function () { drawer(false); },
    body: elBody
  };

  W.ready = Promise.all([
    A.local('data/wiki-site.json').catch(function () { return { pages: [] }; }),
    A.local('data/wiki.json'),
    A.local('data/world.json').catch(function () { return null; }),
    /* Живые правки лежат на сервере (WikiEdits). Сервера нет (18.10.2026 дедик
       не продлен) — берем их последнюю копию из data/wiki-edits.json, иначе
       сайт показал бы правила в редакции до правок Kreenchik. */
    A.call('/wiki/edits', { auth: false, timeout: 5000 }).catch(function () {
      return A.local('data/wiki-edits.json').catch(function () { return null; });
    })
  ]).then(function (r) {
    files = (r[0].pages || []).concat(r[1].pages || []);
    if (!files.length) throw A.err('file', 'Вики пуста.');
    world = r[2];
    files.forEach(function (f) { fileRaw[f.slug] = f; });
    ((r[3] && r[3].pages) || []).forEach(function (p) {
      if (!p || typeof p.slug !== 'string' || !p.title) return;
      var c = copy(p);
      delete c._at;
      edits[c.slug] = c;
    });
    rebuild();
    route();
    window.addEventListener('hashchange', route);
  });
  W.ready.catch(function (e) {
    elBody.innerHTML = '<div class="empty"><h4>Вики не загрузилась</h4><p>' +
      esc(A.textOf(e)) + ' Обновите страницу — если не поможет, напишите нам ' +
      'через <a href="tickets">обращение</a>.</p></div>';
  });

  /* аккордеон вопросов */
  elBody.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.qa-q') : null;
    if (!b) return;
    var open = !b.parentNode.classList.contains('open');
    b.parentNode.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  if (elSearch) {
    elSearch.addEventListener('input', runSearch);
    elSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { elSearch.value = ''; runSearch(); }
      /* Набрал слово, нажал Enter — и ничего не происходит: найденное лежит
         рядом, но открыть его можно только мышкой. Enter открывает первое
         найденное, как в любой документации. Не нашлось ничего — убираем
         клавиатуру с телефона, иначе она закрывает собой сам ответ. */
      if (e.key !== 'Enter') return;
      e.preventDefault();
      /* Только прямые ссылки-находки: в блоке «ничего не нашлось» тоже есть
         ссылка (на частые вопросы), и открывать её по Enter — значит уносить
         человека со страницы за опечатку. */
      var hit = elFound.hidden ? null : elFound.querySelector(':scope > a');
      if (hit) hit.click();
      else elSearch.blur();
    });
  }
  if (elClear) {
    elClear.addEventListener('click', function () {
      elSearch.value = '';
      runSearch();
      elSearch.focus();
    });
  }
  elFound.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a')) {
      elSearch.value = '';
      runSearch();
    }
  });

  if (elOpen) elOpen.addEventListener('click', function () { drawer(true); });
  if (elScrim) elScrim.addEventListener('click', function () { drawer(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') drawer(false);
    /* Ctrl+K — привычка из документаций, пусть работает и у нас. */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && elSearch) {
      e.preventDefault();
      if (window.matchMedia('(max-width: 900px)').matches) drawer(true);
      elSearch.focus();
      elSearch.select();
    }
  });
})();
