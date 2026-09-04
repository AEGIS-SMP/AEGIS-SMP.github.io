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
    ['Начало', ['start']],
    ['Правила', ['rules-game', 'rules-discord']],
    ['Игра', ['modpack', 'faq']],
    ['Команда', ['duties']]
  ];

  var ICON = {
    start: 'M4 4h9l4 4v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'rules-game': 'M5 3h11v15H5zM8 7h5M8 11h5',
    'rules-discord': 'M5 3h11v15H5zM8 7h5M8 11h5',
    modpack: 'M10 2l7 4v8l-7 4-7-4V6z',
    faq: 'M10 15v.5M10 12c0-2 2-2 2-3.5A2 2 0 0 0 8 8',
    duties: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c0-3 3-5 6-5s6 2 6 5'
  };

  /* --------------------------------------------------------------- разметка */

  function esc(s) { return A.esc(s); }

  /* Ссылку берём только «свою» или https — на случай, если текст когда-нибудь
     начнут править не мы. */
  function href(u) {
    u = String(u || '').trim();
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

  /* Абзацы, списки и заголовки уровня «##». Больше в текстах ничего нет.
     Осторожно со звёздочкой: «* » — это пункт списка, а «**» — жирный текст,
     и путать их нельзя, иначе от жирного остаётся висящая звёздочка. */
  var LI = /^(?:•\s*|[-*](?!\*)[ \t]+|(\d+)\.[ \t]+)(.+)$/;

  function blocks(text, out) {
    var lines = String(text || '').split('\n');
    var buf = [], list = [], ord = false;

    function flushP() {
      if (!buf.length) return;
      out.push('<p class="doc-p">' + inline(buf.join(' ')) + '</p>');
      buf = [];
    }
    function flushL() {
      if (!list.length) return;
      var tag = ord ? 'ol' : 'ul';
      out.push('<' + tag + ' class="doc-ul' + (ord ? ' doc-ol' : '') + '">' +
        list.map(function (x) {
          return '<li class="doc-li">' + inline(x) + '</li>';
        }).join('') + '</' + tag + '>');
      list = [];
      ord = false;
    }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) { flushP(); flushL(); continue; }
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

  function head(p) {
    return '<div class="dh"><h1>' + esc(p.title) + '</h1>' +
      (p.intro ? '<p>' + inline(p.intro) + '</p>' : '') + '</div>';
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
        var r = s.rules[j];
        out.push('<div class="rule"><div class="r-n">' + (i + 1) + '.' + (j + 1) +
          '</div><div class="r-t">' + inline(r.text) + '</div>' +
          (r.penalty ? '<div class="r-p">' + esc(r.penalty) + '</div>' : '') +
          '</div>');
      }
    }
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
      out.push('<div class="qa" data-q="' + i + '"><button class="qa-q" type="button">' +
        esc(q.q) + '<span class="qa-x"></span></button>' +
        '<div class="qa-wrap"><div class="qa-a"><div>' + body.join('') +
        '</div></div></div></div>');
    }
  }

  /* -------------------------------------------------------------- отрисовка */

  var cur = '';

  function show(slug, anchor) {
    var p = byslug[slug] || pages[0];
    cur = p.slug;
    var out = [head(p)], toc = [];

    if (p.type === 'rules') drawRules(p, out, toc);
    else if (p.type === 'duties') drawDuties(p, out, toc);
    else if (p.type === 'modpack') drawMods(p, out, toc);
    else if (p.type === 'faq') drawFaq(p, out, toc);
    else drawDoc(p, out, toc);

    elBody.innerHTML = out.join('');
    document.title = p.title + ' — вики AEGIS SMP';

    var links = elNav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active',
        links[i].getAttribute('data-s') === p.slug);
    }

    if (toc.length > 1) {
      elToc.innerHTML = '<h5>На этой странице</h5>' + toc.map(function (t) {
        return '<a href="#/' + p.slug + '/' + t[1] + '" data-a="' + t[1] + '">' +
          esc(t[0]) + '</a>';
      }).join('');
    } else {
      elToc.innerHTML = '';
    }
    watchToc();

    if (anchor) {
      var el = document.getElementById(anchor);
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }

  /* Подсветка пункта «на этой странице» по мере прокрутки. */
  function watchToc() {
    if (spy) { spy.disconnect(); spy = null; }
    var heads = elBody.querySelectorAll('.doc-h2');
    if (!heads.length || !elToc.children.length) return;
    if (typeof IntersectionObserver !== 'function') return;
    var seen = {};
    spy = new IntersectionObserver(function (rows) {
      for (var i = 0; i < rows.length; i++) {
        seen[rows[i].target.id] = rows[i].isIntersecting;
      }
      var pick = '';
      for (var j = 0; j < heads.length; j++) {
        if (seen[heads[j].id]) { pick = heads[j].id; break; }
      }
      var links = elToc.querySelectorAll('a');
      for (var k = 0; k < links.length; k++) {
        links[k].classList.toggle('active',
          !!pick && links[k].getAttribute('data-a') === pick);
      }
    }, { rootMargin: '-90px 0px -70% 0px' });
    for (var m = 0; m < heads.length; m++) spy.observe(heads[m]);
  }

  /* ---------------------------------------------------------------- поиск */

  /* Индекс — плоский список кусочков текста. Страниц шесть, кусочков пара
     сотен: перебирать их на каждое нажатие дешевле, чем городить дерево. */
  function buildIndex() {
    index = [];
    function add(p, title, id, text) {
      text = String(text || '').replace(/[*`]/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
      if (!text) return;
      index.push({ slug: p.slug, page: p.title, title: title, id: id,
        text: text, low: text.toLowerCase() });
    }
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.type === 'rules') {
        p.sections.forEach(function (s) {
          s.rules.forEach(function (r) { add(p, s.title, slugify(s.title), r.text); });
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
      return '<a href="#/' + p.slug + '" data-s="' + p.slug + '">' +
        '<svg class="dn-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="' + d + '"/></svg>' + esc(p.title) + '</a>';
    }
    for (var g = 0; g < GROUPS.length; g++) {
      var rows = '';
      for (var i = 0; i < GROUPS[g][1].length; i++) {
        var p = byslug[GROUPS[g][1][i]];
        if (p) rows += item(p);
      }
      if (rows) html += '<h5>' + GROUPS[g][0] + '</h5>' + rows;
    }
    var rest = '';
    for (var j = 0; j < pages.length; j++) {
      if (!used[pages[j].slug]) rest += item(pages[j]);
    }
    if (rest) html += '<h5>Разное</h5>' + rest;
    elNav.innerHTML = html;
  }

  function drawer(on) {
    elSide.classList.toggle('open', on);
    elScrim.classList.toggle('on', on);
    document.body.style.overflow = on ? 'hidden' : '';
  }

  /* --------------------------------------------------------------- маршрут */

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var bits = h.split('/');
    show(bits[0] || 'start', bits[1] || '');
    if (window.matchMedia('(max-width: 900px)').matches) drawer(false);
  }

  /* ----------------------------------------------------------------- пуск */

  Promise.all([
    A.local('data/wiki-site.json').catch(function () { return { pages: [] }; }),
    A.local('data/wiki.json')
  ]).then(function (r) {
    pages = (r[0].pages || []).concat(r[1].pages || []);
    if (!pages.length) throw A.err('file', 'Вики пуста.');
    for (var i = 0; i < pages.length; i++) byslug[pages[i].slug] = pages[i];
    buildIndex();
    drawNav();
    route();
    window.addEventListener('hashchange', route);
  }).catch(function (e) {
    elBody.innerHTML = '<div class="empty"><h4>Вики не загрузилась</h4><p>' +
      esc(A.textOf(e)) + ' Обновите страницу — если не поможет, напишите нам ' +
      'через <a href="tickets.html">обращение</a>.</p></div>';
  });

  /* аккордеон вопросов */
  elBody.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.qa-q') : null;
    if (!b) return;
    b.parentNode.classList.toggle('open');
  });

  if (elSearch) {
    elSearch.addEventListener('input', runSearch);
    elSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { elSearch.value = ''; runSearch(); }
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
