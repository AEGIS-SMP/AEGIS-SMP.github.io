/* AEGIS — правка вики прямо на сайте.

   Слово овнера 03.10.2026: координатору и всей вышке — права редактировать
   ЛЮБУЮ информацию на вики, удобный редактор на сайте, кто и когда правил,
   откат. Права — по роли, как панель по человеку.

   У игрока этот файл не делает ничего: служба выдаёт право «wiki» только
   Координатору и выше (и овнеру) и проверяет его на КАЖДЫЙ запрос правки —
   здесь только интерфейс, обойти его в браузере нечего.

   Как устроено:
   • Тексты из файлов сайта — основа. Правка ложится поверх по адресу страницы
     и живёт в службе (выкладка сайта файлы подменяет и стёрла бы её).
   • Сохраняется страница целиком, вместе с номером версии, от которой
     правили. Успел кто-то сохранить раньше — служба откажет «конфликтом», и
     редактор предложит сравнить или сохранить поверх. Молча чужую правку
     не затираем.
   • Каждая правка — строка истории: кто, когда, что написал в «что
     поменяли». Любую строку можно посмотреть, сравнить с предыдущей и
     вернуть; откат — тоже правка, его самого можно откатить.
   • Пока правишь, текст каждые полсекунды ложится в память браузера:
     закрыл вкладку, упал свет — при следующем открытии «Продолжить правку».
   • «Черновик» — страница, которую видит только команда. */
(function () {
  'use strict';

  var A = window.AegisApi, W = window.AegisWiki;
  if (!A || !W || !W.ready || !A.token()) return;

  var esc = A.esc;
  var DRAFT = 'aegis.wiki.draft.';
  var NEWKEY = '~new';
  var SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
  var GNEW = '*new*';
  var TYPES = [
    ['doc', 'Обычная страница'],
    ['rules', 'Правила с мерами'],
    ['duties', 'Обязанности команды'],
    ['faq', 'Вопросы и ответы'],
    ['modpack', 'Список модов']
  ];

  /* Те же пределы, что проверяет служба (WikiEdits.clean). Поле не даёт
     набрать больше, а не отказывает потом. */
  var L = {
    title: 120, intro: 3000, group: 40, body: 150000, note: 200,
    sec: 80, secTitle: 200, rules: 150, rule: 6000, pen: 400, subs: 40, sub: 2000, xnote: 3000,
    blocks: 80, tier: 120, duty: 200, lines: 80, line: 2000,
    items: 300, q: 500, a: 12000, tags: 60, tag: 120,
    groups: 80, gname: 120, mods: 600, mod: 200, ver: 80,
    page: 220000
  };

  var state = {};     /* слаг → {v, by, at, versions, lastBy, lastAt, lastAct} */
  var ed = null;      /* открытый редактор */
  var flash = null;   /* {slug, text} — плашка «сохранено» после перерисовки */
  var pop = null;     /* открытое окно истории */
  var draftT = 0;
  var docEl = W.body.closest ? W.body.closest('.doc') : W.body.parentNode;

  /* ------------------------------------------------------------ помощники */

  function lsGet(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* память браузера закрыта — живём без черновиков */ }
  }

  function when(sec) {
    if (!sec) return '';
    var d = new Date(sec * 1000);
    var s = d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    return s.replace(/,? в /, ', ');
  }
  function whenAgo(sec) { return A.ago(sec * 1000); }

  function plural(n, f) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return f[0];
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1];
    return f[2];
  }
  function spaced(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function canon(o) {
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') {
      return '{' + Object.keys(o).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canon(o[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(o);
  }

  function hashSlug() { return location.hash.replace(/^#\/?/, '').split('/')[0] || 'start'; }

  function pageReq(slug) {
    return A.call('/adm/wiki/page?slug=' + encodeURIComponent(slug), { timeout: 15000 });
  }
  function histAt(r, v) {
    var h = r && r.hist || [];
    for (var i = 0; i < h.length; i++) if (h[i].v === v) return h[i];
    return null;
  }

  /* -------------------------------------------------------- пуск и сверка */

  function loadState() {
    return A.call('/adm/wiki', { timeout: 15000 }).then(function (r) {
      state = (r && r.state) || {};
      Object.keys(state).forEach(function (s) {
        var st = state[s];
        if (st.page) W.setEdit(s, st.page);              /* черновик команды */
        else if (!st.v && W.edit(s)) W.setEdit(s, null); /* вернули к тексту сайта */
      });
    });
  }

  A.call('/adm/me').then(function (me) {
    if (!me || (me.rights || []).indexOf('wiki') < 0) return;
    return Promise.all([W.ready, loadState()]).then(function () {
      W.hooks.draw = onDraw;
      W.hooks.nav = onNav;
      W.setStaff(true);
      /* Ссылка вела прямо на черновик: до входа его не было, вики
         открыла первую страницу. Теперь он есть — открываем его. */
      if (hashSlug() !== W.cur() && W.page(hashSlug())) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        W.redraw();
      }
    });
  }).catch(function () { /* не команда или служба молчит — вики как у всех */ });

  /* --------------------------------------------------- полоса над страницей */

  function onDraw(p) {
    if (ed) leaveEditor();
    var dh = W.body.querySelector('.dh');
    if (!dh) return;
    var st = state[p.slug] || {};
    var file = W.fileRaw(p.slug);
    var line;
    if (st.v) {
      line = 'Последняя правка: <b>' + esc(st.by) + '</b>, ' + esc(whenAgo(st.at));
    } else if (st.versions && st.lastAct === 'revert') {
      line = 'Сейчас — текст сайта · вернул <b>' + esc(st.lastBy) + '</b>, ' + esc(whenAgo(st.lastAt));
    } else {
      line = file ? 'Текст сайта — на сайте ещё не правили' : '';
    }
    var d = lsGet(DRAFT + p.slug);
    var bar = document.createElement('div');
    bar.className = 'we-bar';
    bar.innerHTML =
      '<div class="we-st">' +
        (p.hidden ? '<span class="we-tag">Черновик — игроки не видят</span>' : '') +
        '<span>' + line + '</span>' +
        (d && d.work ? '<span class="we-has">есть несохранённый текст · ' + esc(A.ago(d.at)) + '</span>' : '') +
      '</div>' +
      '<div class="we-acts">' +
        '<button class="we-b we-b-main" type="button" data-we="edit">' +
          (d && d.work ? 'Продолжить правку' : 'Править') + '</button>' +
        '<button class="we-b" type="button" data-we="hist"' + (st.versions ? '' : ' disabled') + '>' +
          'История' + (st.versions ? ' · ' + st.versions : '') + '</button>' +
      '</div>';
    dh.insertBefore(bar, dh.firstChild);
    if (flash && flash.slug === p.slug) {
      var f = document.createElement('div');
      f.className = 'nbox ok we-flash';
      f.innerHTML = '<div>' + flash.text + '</div>';
      bar.parentNode.insertBefore(f, bar.nextSibling);
    }
    flash = null;
  }

  function onNav(nav) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'we-new';
    b.textContent = '+ Новая страница';
    b.addEventListener('click', function () {
      W.closeSide();
      openNew();
    });
    nav.appendChild(b);
  }

  /* ------------------------------------------------------- рабочая модель */

  /* Форма правит не саму страницу, а её «рабочий» вид: списки обязанностей —
     одной строкой на пункт, моды — «Название | версия», слова для поиска —
     через запятую. Обратно в страницу собирает finalize(). */
  function toWork(p, slug) {
    p = p || {};
    var t = p.type || 'doc';
    var w = {
      type: t,
      title: p.title || '',
      intro: p.intro || '',
      group: p.group || W.groupOf(slug),
      hidden: !!p.hidden
    };
    if (t === 'doc') {
      w.body = p.body || '';
    } else if (t === 'rules') {
      w.sections = (p.sections || []).map(function (s) {
        return {
          title: s.title || '',
          rules: (s.rules || []).map(function (r) {
            return {
              text: r.text || '', penalty: r.penalty || '',
              subs: (r.subs || []).map(function (u) { return u.text + (u.penalty ? ' | ' + u.penalty : ''); }).join('\n'),
              example: r.example || '', except: r.except || ''
            };
          })
        };
      });
    } else if (t === 'duties') {
      w.blocks = (p.blocks || []).map(function (b) {
        return { tier: b.tier || '', title: b.title || '', must: (b.must || []).join('\n'), may: (b.may || []).join('\n') };
      });
    } else if (t === 'faq') {
      w.items = (p.items || []).map(function (q) {
        return { q: q.q || '', a: q.a || '', tags: (q.tags || []).join(', ') };
      });
    } else if (t === 'modpack') {
      w.groups = (p.groups || []).map(function (g) {
        return {
          name: g.name || '',
          items: (g.items || []).map(function (m) { return m.name + (m.version ? ' | ' + m.version : ''); }).join('\n')
        };
      });
    }
    return w;
  }

  var TPL = {
    section: function () { return { title: '', rules: [TPL.rule()] }; },
    rule: function () { return { text: '', penalty: '', subs: '', example: '', except: '' }; },
    block: function () { return { tier: '', title: '', must: '', may: '' }; },
    item: function () { return { q: '', a: '', tags: '' }; },
    group: function () { return { name: '', items: '' }; }
  };

  function blankContent(w) {
    delete w.body; delete w.sections; delete w.blocks; delete w.items; delete w.groups;
    if (w.type === 'doc') w.body = '';
    else if (w.type === 'rules') w.sections = [TPL.section()];
    else if (w.type === 'duties') w.blocks = [TPL.block()];
    else if (w.type === 'faq') w.items = [TPL.item()];
    else if (w.type === 'modpack') w.groups = [TPL.group()];
  }

  function lines(s) {
    return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Рабочий вид → страница, ровно в том виде, как её примет служба. Пустые
     карточки молча выпадают; карточка, где что-то начато, но не хватает
     обязательного, — ошибка с указанием поля (k — путь к нему в форме). */
  function finalize(w) {
    var err = null;
    function bad(msg, k) { if (!err) err = { msg: msg, k: k }; }
    var p = { type: w.type, title: w.title.trim() };
    if (!p.title) bad('У страницы должен быть заголовок.', 'title');
    var intro = w.intro.trim();
    if (intro) p.intro = intro;
    if (w.hidden) p.hidden = true;
    var g = (w.group || '').trim();
    if (g && ed && (ed.hadGroup || g !== W.groupOf(ed.slug))) p.group = g;

    if (w.type === 'doc') {
      p.body = w.body.replace(/\s+$/, '');
      if (p.body.length > L.body) bad('Текст длиннее 150 000 знаков — разбейте страницу на две.', 'body');
    } else if (w.type === 'rules') {
      p.sections = [];
      w.sections.forEach(function (s, i) {
        var rules = [];
        s.rules.forEach(function (r, j) {
          var text = r.text.trim(), pen = r.penalty.replace(/\s*\n\s*/g, ' ').trim();
          var ex = (r.example || '').replace(/\s+$/, '').replace(/^\s+/, ''),
              exc = (r.except || '').replace(/\s+$/, '').replace(/^\s+/, '');
          // подпункты — по одному в строке, мера после « | »
          var subs = [];
          String(r.subs || '').split('\n').forEach(function (line) {
            var bar = line.lastIndexOf(' | ');
            var st = (bar < 0 ? line : line.slice(0, bar)).trim(), sp = bar < 0 ? '' : line.slice(bar + 3).trim();
            if (!st && !sp) return;
            if (!st) bad('В подпунктах ' + (i + 1) + '.' + (j + 1) + ' есть мера без текста.', 'sections.' + i + '.rules.' + j + '.subs');
            if (st.length > L.sub) bad('Подпункт длиннее ' + L.sub + ' знаков.', 'sections.' + i + '.rules.' + j + '.subs');
            var u = { text: st };
            if (sp) u.penalty = sp.slice(0, L.pen);
            subs.push(u);
          });
          if (!text && !pen && !subs.length && !ex && !exc) return;
          if (!text) bad('У пункта ' + (i + 1) + '.' + (j + 1) + ' нет текста.', 'sections.' + i + '.rules.' + j + '.text');
          if (subs.length > L.subs) bad('У пункта ' + (i + 1) + '.' + (j + 1) + ' больше ' + L.subs + ' подпунктов.', 'sections.' + i + '.rules.' + j + '.subs');
          var o = { text: text };
          if (pen) o.penalty = pen;
          if (subs.length) o.subs = subs;
          if (ex) o.example = ex;
          if (exc) o.except = exc;
          rules.push(o);
        });
        var title = s.title.trim();
        if (!title && !rules.length) return;
        if (!title) bad('У раздела ' + (i + 1) + ' нет названия.', 'sections.' + i + '.title');
        if (rules.length > L.rules) bad('В разделе ' + (i + 1) + ' больше ' + L.rules + ' пунктов — разделите его.', 'sections.' + i + '.title');
        p.sections.push({ title: title, rules: rules });
      });
      if (p.sections.length > L.sec) bad('Разделов больше ' + L.sec + '.', 'title');
    } else if (w.type === 'duties') {
      p.blocks = [];
      w.blocks.forEach(function (b, i) {
        var must = lines(b.must), may = lines(b.may);
        var title = b.title.trim(), tier = b.tier.trim();
        if (!title && !tier && !must.length && !may.length) return;
        if (!title) bad('У карточки ' + (i + 1) + ' не указана должность.', 'blocks.' + i + '.title');
        ['must', 'may'].forEach(function (k) {
          var list = k === 'must' ? must : may;
          if (list.length > L.lines) bad('В карточке ' + (i + 1) + ' больше ' + L.lines + ' строк.', 'blocks.' + i + '.' + k);
          list.forEach(function (x) {
            if (x.length > L.line) bad('В карточке ' + (i + 1) + ' строка длиннее 2000 знаков.', 'blocks.' + i + '.' + k);
          });
        });
        p.blocks.push({ tier: tier, title: title, must: must, may: may });
      });
      if (p.blocks.length > L.blocks) bad('Карточек больше ' + L.blocks + '.', 'title');
    } else if (w.type === 'faq') {
      p.items = [];
      w.items.forEach(function (q, i) {
        var qq = q.q.trim(), a = q.a.trim();
        var tags = q.tags.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!qq && !a) return;
        if (!qq) bad('У ответа ' + (i + 1) + ' нет вопроса.', 'items.' + i + '.q');
        if (tags.length > L.tags) bad('У вопроса ' + (i + 1) + ' больше ' + L.tags + ' слов для поиска.', 'items.' + i + '.tags');
        tags.forEach(function (x) {
          if (x.length > L.tag) bad('Слово для поиска у вопроса ' + (i + 1) + ' длиннее 120 знаков.', 'items.' + i + '.tags');
        });
        var o = { q: qq, a: a };
        if (tags.length) o.tags = tags;
        p.items.push(o);
      });
      if (p.items.length > L.items) bad('Вопросов больше ' + L.items + '.', 'title');
    } else if (w.type === 'modpack') {
      p.groups = [];
      var total = 0;
      w.groups.forEach(function (gr, i) {
        var items = [];
        lines(gr.items).forEach(function (ln) {
          var k = ln.lastIndexOf('|');
          var name = (k < 0 ? ln : ln.slice(0, k)).trim();
          var ver = k < 0 ? '' : ln.slice(k + 1).trim();
          if (!name) { bad('В группе ' + (i + 1) + ' есть строка без названия мода.', 'groups.' + i + '.items'); return; }
          if (name.length > L.mod) bad('В группе ' + (i + 1) + ' название мода длиннее 200 знаков.', 'groups.' + i + '.items');
          var o = { name: name };
          if (ver) o.version = ver.slice(0, L.ver);
          items.push(o);
        });
        var name = gr.name.trim();
        if (!name && !items.length) return;
        if (!name) bad('У группы ' + (i + 1) + ' нет названия.', 'groups.' + i + '.name');
        if (items.length > L.mods) bad('В группе ' + (i + 1) + ' больше ' + L.mods + ' модов.', 'groups.' + i + '.items');
        total += items.length;
        p.groups.push({ name: name, items: items });
      });
      if (p.groups.length > L.groups) bad('Групп больше ' + L.groups + '.', 'title');
      p.total = total;
    }
    if (!err && JSON.stringify(p).length > L.page) bad('Страница слишком большая — разбейте её на две.', 'title');
    return { page: p, err: err };
  }

  /* ------------------------------------------------------ открыть редактор */

  function draftKey() { return DRAFT + (ed.isNew ? NEWKEY : ed.slug); }

  function setBarNote(text) {
    var st = W.body.querySelector('.we-bar .we-st');
    if (st) st.innerHTML = '<span class="we-err">' + esc(text) + '</span>';
  }

  function openEdit(slug) {
    var btn = W.body.querySelector('.we-bar [data-we="edit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Открываю…'; }
    pageReq(slug).then(function (r) {
      var page = null;
      if (r.v > 0) {
        var h = histAt(r, r.v);
        page = h && h.page;
        if (page) W.setEdit(slug, page);
      } else {
        page = W.fileRaw(slug);
        if (W.edit(slug)) W.setEdit(slug, null);
      }
      if (!page) page = W.raw(slug);
      if (!page) throw A.err('gone', 'Этой страницы уже нет — обновите вики.');
      start({ slug: slug, isNew: false, base: r.v || 0, page: page });
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Править'; }
      setBarNote(e && e.code === 'auth' ? 'Вход истёк — войдите в кабинет заново.' : A.textOf(e));
    });
  }

  function openNew() {
    var w = { type: 'doc', title: '', intro: '', group: 'Разное', hidden: true };
    blankContent(w);
    start({ slug: '', isNew: true, base: 0, page: null, work: w });
  }

  function start(o) {
    ed = {
      slug: o.slug,
      isNew: o.isNew,
      base: o.base,
      orig: o.page,
      work: o.work || toWork(o.page, o.slug),
      hadGroup: !!(o.page && o.page.group),
      slugAuto: o.isNew,
      tab: 'text',
      undo: [],
      note: '',
      newGroup: false,
      msg: '',
      dirty: false
    };
    ed.origCanon = o.isNew ? '' : canon(finalize(ed.work).page);
    var d = lsGet(draftKey());
    if (d && d.work && d.work.type && (o.isNew || d.work.type === ed.work.type)) {
      if (o.isNew || canon(finalize(d.work).page) !== ed.origCanon) {
        ed.work = d.work;
        ed.note = d.note || '';
        if (o.isNew) { ed.slug = d.slug || ''; ed.slugAuto = d.slugAuto !== false; }
        else ed.base = d.base;                         /* правили от этой версии */
        ed.dirty = true;
        ed.restored = { at: d.at, stale: !o.isNew && d.base !== o.base };
      } else {
        lsSet(draftKey(), null);
      }
    }
    if (ed.work.group && W.groups().concat('Разное').indexOf(ed.work.group) < 0) ed.newGroup = true;
    if (docEl) docEl.classList.add('is-edit');
    document.title = (ed.isNew ? 'Новая страница' : 'Правка: ' + (o.page.title || ed.slug)) + ' — вики AEGIS SMP';
    paint();
    window.scrollTo(0, 0);
    var first = W.body.querySelector(ed.isNew ? '[data-k="title"]' : '.we-ed');
    if (first && ed.isNew) first.focus();
  }

  /* Ушли со страницы, не закрыв редактор (ссылка в боковой, «назад») —
     набранное уже лежит в памяти браузера, ничего не теряется. */
  function leaveEditor() {
    if (draftT) { clearTimeout(draftT); draftT = 0; keepDraft(); }
    ed = null;
    if (docEl) docEl.classList.remove('is-edit');
  }

  function closeEditor() {
    var slug = ed.isNew ? '' : ed.slug;
    if (draftT) { clearTimeout(draftT); draftT = 0; }
    ed = null;
    if (docEl) docEl.classList.remove('is-edit');
    if (slug && hashSlug() !== slug) location.hash = '#/' + slug;
    else W.redraw();
  }

  /* --------------------------------------------------------------- форма */

  function attr(s) { return esc(s == null ? '' : String(s)); }

  function cnt(k, len, max, always) {
    var show = always || len >= max * 0.7;
    return '<em class="we-cnt' + (len > max ? ' over' : '') + '" data-c="' + k + '" data-max="' + max + '"' +
      (always ? ' data-always="1"' : '') + '>' +
      (show ? spaced(len) + ' из ' + spaced(max) : '') + '</em>';
  }

  function inp(k, v, max, ph, label, hint) {
    return '<div class="field"><label for="we-' + k + '">' + label + cnt(k, v.length, max) + '</label>' +
      '<input id="we-' + k + '" type="text" data-k="' + k + '" maxlength="' + max + '" value="' + attr(v) + '"' +
      (ph ? ' placeholder="' + attr(ph) + '"' : '') + ' autocomplete="off">' +
      (hint ? '<div class="we-hint">' + hint + '</div>' : '') + '</div>';
  }

  function area(k, v, max, ph, label, rows, hint, cls) {
    return '<div class="field' + (cls ? ' ' + cls : '') + '"><label for="we-' + k + '">' + label + cnt(k, v.length, max) + '</label>' +
      '<textarea id="we-' + k + '" data-k="' + k + '" maxlength="' + max + '" rows="' + (rows || 2) + '"' +
      (ph ? ' placeholder="' + attr(ph) + '"' : '') + ' spellcheck="true">' + esc(v) + '</textarea>' +
      (hint ? '<div class="we-hint">' + hint + '</div>' : '') + '</div>';
  }

  function ops(path, i, n, what) {
    return '<span class="we-ops">' +
      '<button class="we-op" type="button" data-op="up" data-p="' + path + '" data-i="' + i + '"' +
        (i === 0 ? ' disabled' : '') + ' aria-label="' + what + ' выше" title="Выше">↑</button>' +
      '<button class="we-op" type="button" data-op="down" data-p="' + path + '" data-i="' + i + '"' +
        (i === n - 1 ? ' disabled' : '') + ' aria-label="' + what + ' ниже" title="Ниже">↓</button>' +
      '<button class="we-op we-op-del" type="button" data-op="del" data-p="' + path + '" data-i="' + i + '"' +
        ' aria-label="Удалить: ' + what + '" title="Удалить">✕</button>' +
      '</span>';
  }

  function addBtn(path, tpl, label) {
    return '<button class="we-add" type="button" data-op="add" data-p="' + path + '" data-t="' + tpl + '">+ ' + label + '</button>';
  }

  function groupField() {
    var gs = W.groups();
    if (gs.indexOf('Разное') < 0) gs.push('Разное');
    var cur = ed.work.group || 'Разное';
    var custom = ed.newGroup;
    var html = '<div class="field"><label for="we-group">Раздел в меню</label>' +
      '<select id="we-group" data-g="1">' +
      gs.map(function (g) {
        return '<option value="' + attr(g) + '"' + (!custom && g === cur ? ' selected' : '') + '>' + esc(g) + '</option>';
      }).join('') +
      '<option value="' + GNEW + '"' + (custom ? ' selected' : '') + '>Свой раздел…</option></select>';
    if (custom) {
      html += '<input class="we-gnew" type="text" data-k="group" maxlength="' + L.group + '" value="' + attr(ed.work.group) +
        '" placeholder="Название раздела" autocomplete="off">';
    }
    return html + '</div>';
  }

  function slugHint() {
    var s = ed.slug;
    if (!s) return 'Латиница, цифры и дефис, 2–40 знаков. Подставится из заголовка.';
    if (!SLUG.test(s)) return '<span class="we-err">Только латиница, цифры и дефис, 2–40 знаков, в начале — буква или цифра.</span>';
    if (W.exists(s)) return '<span class="we-err">Такой адрес уже есть — придумайте другой.</span>';
    return 'Ссылка будет: <b>wiki#/' + esc(s) + '</b>';
  }

  function headFields() {
    var w = ed.work, h = '';
    h += inp('title', w.title, L.title, ed.isNew ? 'Например: Как построить завод' : '', 'Заголовок');
    h += '<div class="we-grid">' + groupField();
    if (ed.isNew) {
      h += '<div class="field"><label for="we-type">Вид страницы</label><select id="we-type" data-type="1">' +
        TYPES.map(function (t) {
          return '<option value="' + t[0] + '"' + (t[0] === w.type ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select></div>';
    }
    h += '</div>';
    if (ed.isNew) {
      h += '<div class="field"><label for="we-slug">Адрес страницы</label>' +
        '<input id="we-slug" type="text" data-k="slug" maxlength="40" value="' + attr(ed.slug) + '" ' +
        'autocomplete="off" spellcheck="false" placeholder="kak-postroit-zavod">' +
        '<div class="we-hint" data-slughint="1">' + slugHint() + '</div></div>';
    }
    h += area('intro', w.intro, L.intro, 'Одна-две фразы о том, что на странице', 'Подзаголовок', 2);
    h += '<div class="field we-check"><label><input type="checkbox" data-k="hidden"' + (w.hidden ? ' checked' : '') + '>' +
      '<span><b>Черновик</b> — страницу видит только команда. Снимите галочку, когда будет готово.</span></label></div>';
    return h;
  }

  var MD_HELP =
    '<details class="we-help"><summary>Как оформлять текст</summary><div>' +
    '<p>Пустая строка — новый абзац. Строка, начатая с <code>## </code>, — заголовок раздела; ' +
    'разделы попадают в оглавление справа.</p>' +
    '<p>Списки: строки с <code>• </code> или <code>- </code>; нумерованный — <code>1. </code>, <code>2. </code>…</p>' +
    '<p><code>**жирный**</code>, <code>`команда`</code>, <code>[текст ссылки](https://…)</code> — ' +
    'работают во всех текстовых полях, не только здесь.</p>' +
    '<p>Картинка или ролик — отдельной строкой: <code>![Подпись](assets/wiki/имя.webp 1280x720)</code>. ' +
    'Файлы берутся только из папки сайта assets/wiki; загрузка своих картинок прямо отсюда появится позже.</p>' +
    '<p>Живые числа мира пишутся меткой, например <code>{мир:provinces|495}</code> — сайт сам подставит ' +
    'нынешнее число. Метки не трогайте, иначе число застынет.</p>' +
    '</div></details>';

  function docFields() {
    var b = ed.work.body;
    return '<div class="field we-docf"><label for="we-body">Текст страницы' + cnt('body', b.length, L.body, true) + '</label>' +
      '<div class="we-tools" role="toolbar" aria-label="Оформление">' +
        '<button type="button" data-md="b" title="Жирный (Ctrl+B)"><b>Ж</b></button>' +
        '<button type="button" data-md="code" title="Команда или код">`к`</button>' +
        '<button type="button" data-md="link" title="Ссылка (Ctrl+K)">Ссылка</button>' +
        '<span class="we-sep"></span>' +
        '<button type="button" data-md="h2" title="Заголовок раздела">## Раздел</button>' +
        '<button type="button" data-md="ul" title="Список">• Список</button>' +
        '<button type="button" data-md="ol" title="Нумерованный список">1. Список</button>' +
        '<span class="we-sep"></span>' +
        '<button type="button" data-md="img" title="Картинка или ролик">Картинка</button>' +
      '</div>' +
      '<textarea id="we-body" class="we-body" data-k="body" maxlength="' + L.body + '" rows="18" spellcheck="true">' +
        esc(b) + '</textarea>' + MD_HELP + '</div>';
  }

  function rulesFields() {
    var S = ed.work.sections, h = '';
    S.forEach(function (s, i) {
      h += '<section class="we-card"><div class="we-card-h"><span class="we-n">Раздел ' + (i + 1) + '</span>' +
        ops('sections', i, S.length, 'раздел') + '</div>' +
        inp('sections.' + i + '.title', s.title, L.secTitle, 'Например: Общение', 'Название раздела');
      s.rules.forEach(function (r, j) {
        var p = 'sections.' + i + '.rules.' + j;
        h += '<div class="field we-rule"><div class="we-rule-h"><span class="we-rn">' + (i + 1) + '.' + (j + 1) + '</span>' +
          ops('sections.' + i + '.rules', j, s.rules.length, 'пункт') + '</div>' +
          '<textarea data-k="' + p + '.text" maxlength="' + L.rule + '" rows="2" aria-label="Текст пункта ' + (i + 1) + '.' + (j + 1) +
            '" placeholder="Текст правила">' + esc(r.text) + '</textarea>' +
          /* Мера — одна строка, но длинная: в поле ввода на телефоне её не
             видно целиком, поэтому растущее поле, где Enter не ставит перенос. */
          '<span class="we-pl" aria-hidden="true">Мера</span>' +
          '<textarea class="we-one" data-k="' + p + '.penalty" maxlength="' + L.pen + '" rows="1"' +
            ' placeholder="Мера за нарушение — по желанию" aria-label="Мера за пункт ' + (i + 1) + '.' + (j + 1) + '">' +
            esc(r.penalty) + '</textarea>' +
          /* Подпункты, пример, исключения — свернуты, пока пусты: у большинства
             пунктов их нет, а раскрытые поля растянули бы список вдвое. */
          '<details class="we-more"' + (r.subs || r.example || r.except ? ' open' : '') + '>' +
            '<summary>Подпункты, пример, исключения</summary>' +
            '<span class="we-pl">Подпункты ' + (i + 1) + '.' + (j + 1) + '.1, ' + (i + 1) + '.' + (j + 1) + '.2… — по одному в строке, мера после « | »</span>' +
            '<textarea data-k="' + p + '.subs" maxlength="' + (L.sub * 4) + '" rows="3" aria-label="Подпункты ' + (i + 1) + '.' + (j + 1) +
              '" placeholder="Нельзя делать то-то | бан 1д">' + esc(r.subs) + '</textarea>' +
            '<span class="we-pl">Пример</span>' +
            '<textarea data-k="' + p + '.example" maxlength="' + L.xnote + '" rows="2" aria-label="Пример к пункту ' + (i + 1) + '.' + (j + 1) +
              '" placeholder="Как это выглядит на деле — по желанию">' + esc(r.example) + '</textarea>' +
            '<span class="we-pl">Исключения</span>' +
            '<textarea data-k="' + p + '.except" maxlength="' + L.xnote + '" rows="2" aria-label="Исключения к пункту ' + (i + 1) + '.' + (j + 1) +
              '" placeholder="Когда пункт не действует — по желанию">' + esc(r.except) + '</textarea>' +
          '</details>' +
          '</div>';
      });
      h += addBtn('sections.' + i + '.rules', 'rule', 'пункт') + '</section>';
    });
    return h + addBtn('sections', 'section', 'раздел');
  }

  function dutiesFields() {
    var B = ed.work.blocks, h = '';
    B.forEach(function (b, i) {
      var p = 'blocks.' + i;
      h += '<section class="we-card"><div class="we-card-h"><span class="we-n">Карточка ' + (i + 1) + '</span>' +
        ops('blocks', i, B.length, 'карточку') + '</div>' +
        '<div class="we-grid">' +
          inp(p + '.tier', b.tier, L.tier, 'Например: Вышка', 'Ступень',
            'Заголовок над карточкой. Соседние карточки одной ступени идут под одним заголовком.') +
          inp(p + '.title', b.title, L.duty, 'Например: Координатор', 'Должность') +
        '</div><div class="we-grid">' +
          area(p + '.must', b.must, 80 * 2001, 'По одной на строку', 'Обязанности', 4, 'Каждая строка — отдельный пункт.') +
          area(p + '.may', b.may, 80 * 2001, 'По одному на строку', 'Права', 4, 'Каждая строка — отдельный пункт.') +
        '</div></section>';
    });
    return h + addBtn('blocks', 'block', 'карточка');
  }

  function faqFields() {
    var Q = ed.work.items, h = '';
    Q.forEach(function (q, i) {
      var p = 'items.' + i;
      h += '<section class="we-card"><div class="we-card-h"><span class="we-n">Вопрос ' + (i + 1) + '</span>' +
        ops('items', i, Q.length, 'вопрос') + '</div>' +
        inp(p + '.q', q.q, L.q, 'Как…?', 'Вопрос') +
        area(p + '.a', q.a, L.a, 'Ответ. Пустая строка — новый абзац.', 'Ответ', 3) +
        inp(p + '.tags', q.tags, 60 * 122, 'приват, земля, территория', 'Слова для поиска',
          'Через запятую. По ним вопрос находится в поиске, даже если слов нет в тексте.') +
        '</section>';
    });
    return h + addBtn('items', 'item', 'вопрос');
  }

  function modsFields() {
    var G = ed.work.groups, h = '';
    G.forEach(function (g, i) {
      var p = 'groups.' + i, n = lines(g.items).length;
      h += '<section class="we-card"><div class="we-card-h"><span class="we-n">Группа ' + (i + 1) +
        ' <i data-mods="' + i + '">' + n + ' ' + plural(n, ['мод', 'мода', 'модов']) + '</i></span>' +
        ops('groups', i, G.length, 'группу') + '</div>' +
        inp(p + '.name', g.name, L.gname, 'Например: Техника', 'Название группы') +
        area(p + '.items', g.items, 600 * 290, 'Create | 6.0.4', 'Моды', 6,
          'По моду на строку: <code>Название | версия</code>. Версию можно не писать.', 'we-mono') +
        '</section>';
    });
    return h + addBtn('groups', 'group', 'группа');
  }

  function bodyFields() {
    var t = ed.work.type;
    if (t === 'rules') return rulesFields();
    if (t === 'duties') return dutiesFields();
    if (t === 'faq') return faqFields();
    if (t === 'modpack') return modsFields();
    return docFields();
  }

  function msgBox() {
    var h = '';
    if (ed.restored) {
      h += '<div class="nbox"><div>Восстановлен несохранённый текст (набран ' + esc(A.ago(ed.restored.at)) + ').' +
        (ed.restored.stale ? ' Страницу с тех пор меняли — при сохранении предложу сравнить версии.' : '') +
        ' <button class="we-link" type="button" data-we="fresh">Начать заново</button></div></div>';
    }
    if (ed.msg) h += ed.msg;
    return h;
  }

  function paint() {
    var tabs = '<div class="we-tabs" role="tablist" aria-label="Вид редактора">' +
      '<button type="button" role="tab" data-we="tab" data-t="text" aria-selected="' + (ed.tab === 'text') + '">Текст</button>' +
      '<button type="button" role="tab" data-we="tab" data-t="prev" aria-selected="' + (ed.tab === 'prev') + '">Как будет выглядеть</button>' +
      '</div>';
    var top = '<div class="we-top">' +
      '<button class="we-back" type="button" data-we="cancel">← ' + (ed.isNew ? 'Назад' : 'К странице') + '</button>' +
      tabs +
      (ed.undo.length ? '<button class="we-b" type="button" data-we="undo">Отменить</button>' : '') +
      '</div>';
    var title = ed.isNew ? 'Новая страница' : 'Правка страницы';
    var main;
    if (ed.tab === 'prev') {
      var f = finalize(ed.work);
      main = (f.err ? '<div class="nbox warn"><div>' + esc(f.err.msg) + '</div></div>' : '') +
        '<div class="we-prev">' + W.render(f.page).html + '</div>';
    } else {
      main = '<div class="we-form">' + headFields() + '<div class="we-body-f we-t-' + ed.work.type + '">' + bodyFields() + '</div></div>';
    }
    var foot = '<div class="we-foot">' +
      '<input class="we-note" type="text" data-k="note" maxlength="' + L.note + '" value="' + attr(ed.note) +
        '" placeholder="Что поменяли (необязательно)" aria-label="Что поменяли" autocomplete="off">' +
      '<span class="we-status" role="status" aria-live="polite"></span>' +
      '<span class="we-fbtn">' +
        '<button class="btn btn-dark btn-sm" type="button" data-we="cancel">Отмена</button>' +
        '<button class="btn btn-primary btn-sm" type="button" data-we="save">Сохранить</button>' +
      '</span></div>';
    W.body.innerHTML = '<div class="we-ed">' + top +
      '<div class="dh we-dh"><h1>' + title + '</h1>' +
        (ed.isNew ? '' : '<p>' + esc(ed.orig.title || ed.slug) + ' · <a href="wiki#/' + attr(ed.slug) + '">wiki#/' + esc(ed.slug) + '</a></p>') +
      '</div>' +
      '<div class="we-msg">' + msgBox() + '</div>' + main + foot + '</div>';
    if (ed.tab === 'prev') armPreview();
    else growAll();
  }

  function armPreview() {
    var vids = W.body.querySelectorAll('.we-prev video[data-src]');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v.getAttribute('data-poster')) v.setAttribute('poster', v.getAttribute('data-poster'));
      v.preload = 'none';
      v.controls = true;
      v.src = v.getAttribute('data-src');
    }
  }

  /* Поля растут под текст: правка длинного пункта в окошке на две строки —
     мучение. Сначала всем «auto», потом читаем высоты, потом пишем: так
     браузер пересчитывает вёрстку один раз, а не на каждом поле. */
  function growAll() {
    var t = W.body.querySelectorAll('.we-ed textarea');
    var i, h = [];
    for (i = 0; i < t.length; i++) t[i].style.height = 'auto';
    for (i = 0; i < t.length; i++) h.push(t[i].scrollHeight);
    for (i = 0; i < t.length; i++) t[i].style.height = (h[i] + 2) + 'px';
  }
  function grow(t) {
    var y = window.scrollY;
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  function status(text, bad) {
    var s = W.body.querySelector('.we-status');
    if (!s) return;
    s.textContent = text || '';
    s.classList.toggle('we-err', !!bad);
  }

  function setMsg(html) {
    ed.msg = html;
    var m = W.body.querySelector('.we-msg');
    if (m) m.innerHTML = msgBox();
  }

  /* ----------------------------------------------------------- изменения */

  function getAt(path) {
    var o = ed.work, ks = path.split('.');
    for (var i = 0; i < ks.length; i++) o = o[ks[i]];
    return o;
  }
  function setAt(path, v) {
    var o = ed.work, ks = path.split('.');
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }

  function touched() {
    ed.dirty = true;
    if (draftT) clearTimeout(draftT);
    draftT = setTimeout(function () { draftT = 0; keepDraft(); }, 600);
  }

  function keepDraft() {
    if (!ed) return;
    var same = !ed.isNew && canon(finalize(ed.work).page) === ed.origCanon;
    var empty = ed.isNew && !ed.work.title.trim() && canon(finalize(ed.work).page) === canon(finalize(newBlank(ed.work.type)).page);
    if (same || empty) { lsSet(draftKey(), null); return; }
    lsSet(draftKey(), {
      base: ed.base, work: ed.work, note: ed.note, at: Date.now(),
      slug: ed.isNew ? ed.slug : undefined, slugAuto: ed.isNew ? ed.slugAuto : undefined
    });
  }

  function newBlank(type) {
    var w = { type: type, title: '', intro: '', group: ed.work.group, hidden: ed.work.hidden };
    blankContent(w);
    return w;
  }

  function pushUndo() {
    ed.undo.push(JSON.stringify(ed.work));
    if (ed.undo.length > 40) ed.undo.shift();
  }

  function autoSlug(title) {
    var s = W.slugify(title).slice(0, 40).replace(/-+$/, '');
    return s.length >= 2 ? s : '';
  }

  function updCounter(k, len) {
    var c = W.body.querySelector('.we-cnt[data-c="' + k + '"]');
    if (!c) return;
    var max = +c.getAttribute('data-max');
    var show = c.getAttribute('data-always') || len >= max * 0.7;
    c.textContent = show ? spaced(len) + ' из ' + spaced(max) : '';
    c.classList.toggle('over', len > max);
  }

  W.body.addEventListener('input', function (e) {
    if (!ed) return;
    var t = e.target, k = t.getAttribute && t.getAttribute('data-k');
    if (!k) return;
    var fld = t.closest('.field');
    if (fld) fld.classList.remove('bad');
    if (k === 'note') { ed.note = t.value; touched(); return; }
    if (k === 'slug') {
      ed.slug = t.value.trim().toLowerCase();
      ed.slugAuto = !ed.slug;
      var hs = W.body.querySelector('[data-slughint]');
      if (hs) hs.innerHTML = slugHint();
      touched();
      return;
    }
    setAt(k, t.type === 'checkbox' ? t.checked : t.value);
    if (t.tagName === 'TEXTAREA') grow(t);
    if (t.type !== 'checkbox') updCounter(k, t.value.length);
    if (k === 'title' && ed.isNew && ed.slugAuto) {
      ed.slug = autoSlug(t.value);
      var si = W.body.querySelector('[data-k="slug"]');
      if (si) si.value = ed.slug;
      var sh = W.body.querySelector('[data-slughint]');
      if (sh) sh.innerHTML = slugHint();
    }
    var m = /^groups\.(\d+)\.items$/.exec(k);
    if (m) {
      var n = lines(t.value).length, el = W.body.querySelector('[data-mods="' + m[1] + '"]');
      if (el) el.textContent = n + ' ' + plural(n, ['мод', 'мода', 'модов']);
    }
    touched();
  });

  W.body.addEventListener('change', function (e) {
    if (!ed) return;
    var t = e.target;
    if (t.getAttribute('data-g')) {
      if (t.value === GNEW) {
        ed.newGroup = true;
        ed.work.group = '';
        paint();
        var gi = W.body.querySelector('.we-gnew');
        if (gi) gi.focus();
      } else {
        var was = ed.newGroup;
        ed.newGroup = false;
        ed.work.group = t.value;
        if (was) paint();
      }
      touched();
    } else if (t.getAttribute('data-type')) {
      pushUndo();
      ed.work.type = t.value;
      blankContent(ed.work);
      paint();
      status('Вид сменён — содержимое начато заново.');
      touched();
    }
  });

  /* --------------------------------------------------- кнопки оформления */

  function put(ta, text, selFrom, selTo) {
    ta.focus();
    var s = ta.selectionStart, ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (x) { ok = false; }
    if (!ok) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selFrom != null) ta.setSelectionRange(s + selFrom, s + selTo);
  }

  function lineBounds(ta) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    var from = v.lastIndexOf('\n', a - 1) + 1;
    var to = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
    if (to < 0) to = v.length;
    return [from, to];
  }

  function md(kind, ta) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = v.slice(a, b);
    if (kind === 'b' || kind === 'code') {
      var m = kind === 'b' ? '**' : '`';
      if (sel) put(ta, m + sel + m);
      else put(ta, m + 'текст' + m, m.length, m.length + 5);
    } else if (kind === 'link') {
      var txt = sel || 'текст ссылки';
      put(ta, '[' + txt + '](https://)', txt.length + 3, txt.length + 11);
    } else if (kind === 'h2' || kind === 'ul' || kind === 'ol') {
      var lb = lineBounds(ta);
      ta.setSelectionRange(lb[0], lb[1]);
      var ls = v.slice(lb[0], lb[1]).split('\n'), n = 0;
      var out = ls.map(function (x) {
        var bare = x.replace(/^(##\s+|[•*-]\s+|\d+\.\s+)/, '');
        if (kind === 'h2') return '## ' + (bare || 'Название раздела');
        if (kind === 'ul') return '• ' + bare;
        n++;
        return n + '. ' + bare;
      }).join('\n');
      /* Заголовок и список отделяются от текста пустой строкой — иначе
         строка приклеится к абзацу выше. */
      var before = lb[0] > 0 && v[lb[0] - 1] === '\n' && lb[0] > 1 && v[lb[0] - 2] !== '\n' ? '\n' : '';
      put(ta, before + out);
    } else if (kind === 'img') {
      var lb2 = lineBounds(ta);
      ta.setSelectionRange(lb2[1], lb2[1]);
      var pre = lb2[1] > 0 ? '\n\n' : '';
      var cap = 'Подпись';
      put(ta, pre + '![' + cap + '](assets/wiki/имя.webp 1280x720)\n', pre.length + 2, pre.length + 2 + cap.length);
    }
  }

  /* -------------------------------------------------------------- щелчки */

  W.body.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-we],[data-op],[data-md],.we-prev a') : null;
    if (!t) return;
    var we = t.getAttribute('data-we');

    if (!ed) {
      if (we === 'edit') openEdit(W.cur());
      else if (we === 'hist') openHist(W.cur());
      return;
    }

    if (t.matches('.we-prev a')) {
      /* В показе страницы ссылки не уводят из редактора. */
      var href = t.getAttribute('href') || '';
      if (/^https:/i.test(href)) { t.target = '_blank'; t.rel = 'noopener'; return; }
      e.preventDefault();
      return;
    }

    var md0 = t.getAttribute('data-md');
    if (md0) { var ta = W.body.querySelector('#we-body'); if (ta) md(md0, ta); return; }

    var op = t.getAttribute('data-op');
    if (op) { doOp(op, t.getAttribute('data-p'), +t.getAttribute('data-i'), t.getAttribute('data-t')); return; }

    if (we === 'tab') {
      ed.tab = t.getAttribute('data-t');
      paint();
      var top = W.body.querySelector('.we-ed');
      if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView();
    } else if (we === 'save') {
      save(false);
    } else if (we === 'over') {
      ed.base = (state[ed.slug] && state[ed.slug].v) || 0;
      setMsg('');
      save(true);
    } else if (we === 'cmp') {
      compareTheirs();
    } else if (we === 'cancel') {
      var changed = ed.isNew ? !!(ed.work.title.trim() || ed.dirty) : canon(finalize(ed.work).page) !== ed.origCanon;
      if (changed && !window.confirm('Выйти без сохранения? Набранный текст пропадёт.')) return;
      lsSet(draftKey(), null);
      closeEditor();
    } else if (we === 'undo') {
      if (!ed.undo.length) return;
      ed.work = JSON.parse(ed.undo.pop());
      paint();
      touched();
    } else if (we === 'fresh') {
      if (!window.confirm('Выбросить восстановленный текст и начать с того, что сейчас на сайте?')) return;
      lsSet(draftKey(), null);
      if (ed.isNew) { openNew(); return; }
      var s = ed.slug;
      ed = null;
      openEdit(s);
    }
  });

  function doOp(op, path, i, tpl) {
    var arr = getAt(path);
    pushUndo();
    if (op === 'add') {
      arr.push(TPL[tpl]());
    } else if (op === 'del') {
      arr.splice(i, 1);
      /* Пустой список форма не показывает вовсе, и добавить в него было бы
         некуда, кроме кнопки — оставляем одну пустую карточку. */
      if (!arr.length && path.indexOf('.') < 0) arr.push(TPL[{ sections: 'section', blocks: 'block', items: 'item', groups: 'group' }[path]]());
    } else if (op === 'up' && i > 0) {
      arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
    } else if (op === 'down' && i < arr.length - 1) {
      arr.splice(i + 1, 0, arr.splice(i, 1)[0]);
    }
    paint();
    touched();
    if (op === 'del') status('Удалено. «Отменить» вверху вернёт.');
    if (op === 'add') {
      var all = W.body.querySelectorAll('[data-k^="' + path + '.' + (arr.length - 1) + '."]');
      if (all.length) { all[0].focus(); all[0].scrollIntoView({ block: 'center' }); }
    } else {
      var moved = op === 'up' ? i - 1 : op === 'down' ? i + 1 : -1;
      var b = moved >= 0 ? W.body.querySelector('[data-op="' + op + '"][data-p="' + path + '"][data-i="' + moved + '"]') : null;
      if (b && !b.disabled) b.focus();
    }
  }

  W.body.addEventListener('keydown', function (e) {
    if (!ed) return;
    var k = e.key ? e.key.toLowerCase() : '';
    if (k === 'enter' && e.target.classList && e.target.classList.contains('we-one')) { e.preventDefault(); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (k === 's' || k === 'ы') {
      e.preventDefault();
      save(false);
    } else if (k === 'k' || k === 'л' || k === 'b' || k === 'и') {
      /* Ctrl+K на вики открывает поиск — в редакторе он ставит ссылку. */
      e.stopPropagation();
      var t = e.target;
      if (t.tagName !== 'TEXTAREA' || !t.getAttribute('data-k')) return;
      e.preventDefault();
      md(k === 'k' || k === 'л' ? 'link' : 'b', t);
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (!ed || !ed.dirty) return;
    if (draftT) { clearTimeout(draftT); draftT = 0; keepDraft(); }
    e.preventDefault();
    e.returnValue = '';
  });

  function focusKey(k) {
    if (ed.tab !== 'text') { ed.tab = 'text'; paint(); }
    var el = W.body.querySelector('[data-k="' + k + '"]');
    if (!el) return;
    var f = el.closest('.field') || el.closest('.we-rule');
    if (f) f.classList.add('bad');
    el.focus();
    el.scrollIntoView({ block: 'center' });
  }

  /* ----------------------------------------------------------- сохранение */

  var saving = false;

  function save(force) {
    if (saving || !ed) return;
    var f = finalize(ed.work);
    if (f.err) { focusKey(f.err.k); status(f.err.msg, true); return; }
    if (ed.isNew) {
      if (!ed.slug) ed.slug = autoSlug(ed.work.title);
      if (!SLUG.test(ed.slug)) { focusKey('slug'); status('Адрес страницы — латиница, цифры и дефис, от 2 до 40 знаков.', true); return; }
      if (W.exists(ed.slug)) { focusKey('slug'); status('Такой адрес уже есть — придумайте другой.', true); return; }
    } else if (!force && canon(f.page) === ed.origCanon) {
      status('Ничего не изменилось — сохранять нечего.');
      return;
    }
    saving = true;
    var btn = W.body.querySelector('[data-we="save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
    status('');
    var slug = ed.slug, isNew = ed.isNew, oldKey = draftKey(), hid = !!f.page.hidden;
    A.call('/adm/wiki/save', {
      body: { slug: slug, page: f.page, base: ed.base, note: ed.note.trim(), isNew: isNew },
      timeout: 20000
    }).then(function (r) {
      lsSet(oldKey, null);
      return afterChange(slug, r.v).then(function () {
        if (draftT) { clearTimeout(draftT); draftT = 0; }
        ed = null;
        if (docEl) docEl.classList.remove('is-edit');
        flash = {
          slug: slug,
          text: hid ? '<b>Сохранено как черновик.</b> Игроки его не видят — снимите галочку «Черновик», когда будет готово.'
                    : '<b>Сохранено.</b> Игроки уже видят новую версию.'
        };
        if (hashSlug() !== slug) location.hash = '#/' + slug;
        else W.redraw();
      });
    }).catch(function (e) {
      if (!ed) return;
      var b2 = W.body.querySelector('[data-we="save"]');
      if (b2) { b2.disabled = false; b2.textContent = 'Сохранить'; }
      if (e && e.code === 'conflict') {
        loadState().catch(function () {}).then(function () {
          if (!ed) return;
          /* Текст службы зовёт «открыть заново», а здесь есть путь короче:
             сравнить и решить на месте, не теряя набранного. */
          var st = state[ed.slug] || {};
          var who = st.v ? 'Пока вы правили, страницу сохранил <b>' + esc(st.by || 'кто-то') + '</b>' +
                (st.at ? ', ' + esc(whenAgo(st.at)) : '') + '.'
              : 'Пока вы правили, страницу вернули к тексту сайта.';
          setMsg('<div class="nbox warn"><div>' + who + ' Ваш текст на месте: сравните его с их версией ' +
            'или сохраните поверх — их версия останется в истории.<div class="we-row">' +
            '<button class="we-b" type="button" data-we="cmp">Сравнить с их версией</button>' +
            '<button class="we-b" type="button" data-we="over">Сохранить мой текст поверх</button>' +
            '</div></div></div>');
          var m = W.body.querySelector('.we-msg');
          if (m) m.scrollIntoView({ block: 'center' });
        });
        status('Страницу успели изменить — выберите, что делать.', true);
      } else if (e && e.code === 'auth') {
        keepDraft();
        status('Вход истёк — войдите в кабинет заново. Текст сохранён в этом браузере.', true);
      } else {
        status(A.textOf(e), true);
      }
    }).then(function () { saving = false; }, function () { saving = false; });
  }

  /* После правки или отката берём из службы то, что она на самом деле
     сохранила (она чистит страницу по своим правилам), и кладём в вики. */
  function afterChange(slug, v) {
    var p = v ? pageReq(slug).then(function (r) {
      var h = histAt(r, r.v);
      W.setEdit(slug, r.v && h && h.page ? h.page : null);
    }) : Promise.resolve(W.setEdit(slug, null));
    return p.then(function () { return loadState().catch(function () {}); });
  }

  function compareTheirs() {
    var mine = finalize(ed.work).page;
    pageReq(ed.slug).then(function (r) {
      var h = histAt(r, r.v);
      var theirs = r.v ? h && h.page : W.fileRaw(ed.slug);
      openPop('Их версия → ваш текст',
        '<p class="we-pop-note">Красным — то, чего в вашем тексте нет (это есть у них), зелёным — что добавили вы. ' +
        'Если сохранить поверх, останется ваш вариант; их версия останется в истории.</p>' +
        diffHtml(pageLines(theirs), pageLines(mine)));
    }).catch(function (e) { status(A.textOf(e), true); });
  }

  /* -------------------------------------------------------------- история */

  function openPop(title, html) {
    closePop();
    var back = document.activeElement;
    var el = document.createElement('div');
    el.className = 'we-pop';
    el.innerHTML = '<div class="we-pop-in" role="dialog" aria-modal="true" aria-label="' + attr(title) + '">' +
      '<div class="we-pop-h"><h3>' + esc(title) + '</h3>' +
      '<button class="we-x" type="button" data-pop="close" aria-label="Закрыть">✕</button></div>' +
      '<div class="we-pop-b">' + html + '</div></div>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    pop = { el: el, back: back };
    el.addEventListener('click', function (e) {
      if (e.target === el) { closePop(); return; }
      var b = e.target.closest ? e.target.closest('[data-pop]') : null;
      if (b) popAction(b);
    });
    el.querySelector('.we-x').focus();
    return el;
  }

  function closePop() {
    if (!pop) return;
    var back = pop.back;
    pop.el.parentNode.removeChild(pop.el);
    pop = null;
    document.body.style.overflow = '';
    if (back && back.focus && document.contains(back)) back.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (!pop) return;
    if (e.key === 'Escape') { e.stopPropagation(); closePop(); return; }
    if (e.key !== 'Tab') return;
    var f = pop.el.querySelectorAll('button:not([disabled]), a[href], video');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }, true);

  var hist = null;   /* {slug, r} — что показано в окне истории */

  function openHist(slug) {
    openPop('История страницы', '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>');
    pageReq(slug).then(function (r) {
      hist = { slug: slug, r: r };
      drawHist();
    }).catch(function (e) {
      if (pop) pop.el.querySelector('.we-pop-b').innerHTML = '<div class="nbox warn"><div>' + esc(A.textOf(e)) + '</div></div>';
    });
  }

  function actText(h, list) {
    if (h.act === 'new') return 'Создание страницы';
    if (h.act === 'edit') return 'Правка';
    if (h.act === 'revert') {
      if (!h.page) return W.fileRaw(hist.slug) ? 'Возврат к тексту сайта' : 'Страница убрана';
      var ref = null;
      for (var i = 0; i < list.length; i++) if (list[i].v === h.ref) ref = list[i];
      return 'Откат к версии' + (ref ? ' от ' + when(ref.at) : '');
    }
    return h.act;
  }

  function drawHist() {
    if (!pop || !hist) return;
    var r = hist.r, list = r.hist || [], slug = hist.slug, file = W.fileRaw(slug);
    var rows = '';
    for (var i = list.length - 1; i >= 0; i--) {
      var h = list[i], now = r.v && h.v === r.v;
      rows += '<li class="we-h' + (now ? ' now' : '') + '">' +
        '<div class="we-h-t"><b>' + esc(actText(h, list)) + '</b>' + (now ? '<span class="we-tag">сейчас на сайте</span>' : '') + '</div>' +
        '<div class="we-h-m">' + esc(h.by) + ' · ' + esc(when(h.at)) + ' · ' + esc(whenAgo(h.at)) + '</div>' +
        (h.note ? '<div class="we-h-n">«' + esc(h.note) + '»</div>' : '') +
        '<div class="we-row">' +
          (h.page ? '<button class="we-b" type="button" data-pop="view" data-i="' + i + '">Посмотреть</button>' : '') +
          '<button class="we-b" type="button" data-pop="diff" data-i="' + i + '">Что изменилось</button>' +
          (h.page && !now ? '<button class="we-b" type="button" data-pop="back" data-i="' + i + '">Вернуть эту</button>' : '') +
        '</div></li>';
    }
    var cur0 = !r.v;
    rows += '<li class="we-h we-h-file' + (cur0 && file ? ' now' : '') + '">' +
      '<div class="we-h-t"><b>' + (file ? 'Текст сайта' : 'До создания страницы') + '</b>' +
        (cur0 && file ? '<span class="we-tag">сейчас на сайте</span>' : '') + '</div>' +
      '<div class="we-h-m">' + (file ? 'то, что лежит в файлах сайта, — основа страницы' : 'страницы нет в файлах сайта, её создали здесь') + '</div>' +
      '<div class="we-row">' +
        (file ? '<button class="we-b" type="button" data-pop="view" data-i="-1">Посмотреть</button>' : '') +
        (!cur0 ? '<button class="we-b" type="button" data-pop="back" data-i="-1">' +
          (file ? 'Вернуть текст сайта' : 'Убрать страницу') + '</button>' : '') +
      '</div></li>';
    var note = list.length >= 30 ? '<p class="we-pop-note">Хранятся последние 30 правок — более ранние уже стёрты.</p>' : '';
    pop.el.querySelector('.we-pop-b').innerHTML = note + '<ol class="we-hist">' + rows + '</ol>';
    pop.el.querySelector('h3').textContent = 'История: ' + ((W.page(slug) || {}).title || slug);
  }

  /* Что было до строки i: предыдущая правка, а для самой первой — текст сайта. */
  function prevOf(i) {
    var list = hist.r.hist || [];
    if (i <= 0) return W.fileRaw(hist.slug);
    return list[i - 1].page || W.fileRaw(hist.slug);
  }
  function pageAt(i) {
    if (i < 0) return W.fileRaw(hist.slug);
    var h = hist.r.hist[i];
    return h.page || W.fileRaw(hist.slug);
  }

  function popAction(b) {
    var a = b.getAttribute('data-pop'), i = +b.getAttribute('data-i');
    if (a === 'close') { closePop(); return; }
    if (a === 'list') { drawHist(); return; }
    var body = pop.el.querySelector('.we-pop-b');
    var backBtn = '<div class="we-row we-pop-back"><button class="we-b" type="button" data-pop="list">← К истории</button></div>';
    if (a === 'view') {
      var p = pageAt(i);
      body.innerHTML = backBtn + '<div class="we-prev we-prev-pop">' + (p ? W.render(p).html : '') + '</div>';
      var vids = body.querySelectorAll('video[data-src]');
      for (var k = 0; k < vids.length; k++) {
        vids[k].setAttribute('poster', vids[k].getAttribute('data-poster') || '');
        vids[k].preload = 'none';
        vids[k].controls = true;
        vids[k].src = vids[k].getAttribute('data-src');
      }
      body.scrollTop = 0;
    } else if (a === 'diff') {
      var list = hist.r.hist || [];
      var before = prevOf(i), after = list[i].page || W.fileRaw(hist.slug);
      body.innerHTML = backBtn +
        '<p class="we-pop-note">' + (i <= 0 ? 'По сравнению с текстом сайта. ' : 'По сравнению с предыдущей правкой. ') +
        'Красным — убрано, зелёным — добавлено.</p>' + diffHtml(pageLines(before), pageLines(after));
      body.scrollTop = 0;
    } else if (a === 'back') {
      revert(i, b);
    }
  }

  function revert(i, btn) {
    var r = hist.r, slug = hist.slug, file = W.fileRaw(slug);
    var h = i >= 0 ? r.hist[i] : null;
    var q = h ? 'Вернуть страницу к версии от ' + when(h.at) + '? Нынешняя останется в истории, её можно будет вернуть.'
      : file ? 'Вернуть страницу к тексту сайта? Все правки останутся в истории.'
        : 'Убрать страницу из вики? Её текст останется в истории, вернуть можно отсюда же.';
    if (!window.confirm(q)) return;
    btn.disabled = true;
    A.call('/adm/wiki/revert', {
      body: { slug: slug, ref: h ? h.v : 0, base: r.v || 0, note: '' },
      timeout: 20000
    }).then(function (res) {
      lsSet(DRAFT + slug, null);
      return afterChange(slug, res.v).then(function () {
        closePop();
        flash = { slug: slug, text: h ? '<b>Страница возвращена</b> к версии от ' + esc(when(h.at)) + '.'
          : '<b>Страница возвращена</b> к тексту сайта.' };
        if (!W.page(slug)) { flash = null; location.hash = '#/start'; return; }
        if (W.cur() !== slug) location.hash = '#/' + slug;
        else W.redraw();
      });
    }).catch(function (e) {
      btn.disabled = false;
      if (!pop) return;
      var msg = e && e.code === 'conflict' ? 'Пока окно было открыто, страницу изменили. Открываю историю заново.' : A.textOf(e);
      var n = document.createElement('div');
      n.className = 'nbox warn';
      n.innerHTML = '<div>' + esc(msg) + '</div>';
      var bd = pop.el.querySelector('.we-pop-b');
      bd.insertBefore(n, bd.firstChild);
      bd.scrollTop = 0;
      if (e && e.code === 'conflict') {
        pageReq(slug).then(function (r2) { hist = { slug: slug, r: r2 }; drawHist(); }).catch(function () {});
      }
    });
  }

  /* --------------------------------------------------------------- отличия */

  /* Страница → строки для сравнения. Номера пунктов не пишем: вставка одного
     правила сдвинула бы номера у всех следующих, и «изменилось» было бы всё. */
  function pageLines(p) {
    if (!p) return [];
    var out = ['Заголовок: ' + (p.title || '')];
    function push(prefix, text) {
      String(text || '').split('\n').forEach(function (x, k) { out.push((k ? '   ' : prefix) + x); });
    }
    if (p.intro) push('Подзаголовок: ', p.intro);
    if (p.group) out.push('Раздел в меню: ' + p.group);
    if (p.hidden) out.push('Черновик — игроки не видят');
    var t = p.type || 'doc';
    if (t === 'doc') {
      out.push('');
      out = out.concat(String(p.body || '').split('\n'));
    } else if (t === 'rules') {
      (p.sections || []).forEach(function (s) {
        out.push('', '## ' + s.title);
        (s.rules || []).forEach(function (r) {
          push('• ', r.text);
          if (r.penalty) out.push('   мера: ' + r.penalty);
          (r.subs || []).forEach(function (u) {
            out.push('   – ' + u.text + (u.penalty ? ' (мера: ' + u.penalty + ')' : ''));
          });
          if (r.example) out.push('   пример: ' + r.example);
          if (r.except) out.push('   исключения: ' + r.except);
        });
      });
    } else if (t === 'duties') {
      var tier = '';
      (p.blocks || []).forEach(function (b) {
        if (b.tier && b.tier !== tier) { tier = b.tier; out.push('', '## ' + tier); }
        out.push('', '### ' + b.title);
        (b.must || []).forEach(function (x) { push('Обязанность: ', x); });
        (b.may || []).forEach(function (x) { push('Право: ', x); });
      });
    } else if (t === 'faq') {
      (p.items || []).forEach(function (q) {
        out.push('', 'Вопрос: ' + q.q);
        push('   ', q.a);
        if (q.tags && q.tags.length) out.push('   слова для поиска: ' + q.tags.join(', '));
      });
    } else if (t === 'modpack') {
      (p.groups || []).forEach(function (g) {
        out.push('', '## ' + g.name);
        (g.items || []).forEach(function (m) { out.push(m.name + (m.version ? ' | ' + m.version : '')); });
      });
    }
    return out;
  }

  function diff(a, b) {
    var pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    var suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    var x = a.slice(pre, a.length - suf), y = b.slice(pre, b.length - suf);
    var n = x.length, m = y.length, mid = [], i, j;
    if (n * m > 4e6) {
      x.forEach(function (s) { mid.push(['-', s]); });
      y.forEach(function (s) { mid.push(['+', s]); });
    } else {
      /* Наибольшая общая часть — обычная таблица. Длина общей части не больше
         меньшего из списков, а при n·m ≤ 4 млн это заведомо меньше 65 536. */
      var w = m + 1, T = new Uint16Array((n + 1) * w);
      for (i = n - 1; i >= 0; i--) {
        for (j = m - 1; j >= 0; j--) {
          T[i * w + j] = x[i] === y[j] ? T[(i + 1) * w + j + 1] + 1
            : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < n && j < m) {
        if (x[i] === y[j]) { mid.push([' ', x[i]]); i++; j++; }
        else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) mid.push(['-', x[i++]]);
        else mid.push(['+', y[j++]]);
      }
      while (i < n) mid.push(['-', x[i++]]);
      while (j < m) mid.push(['+', y[j++]]);
    }
    var res = [];
    for (i = 0; i < pre; i++) res.push([' ', a[i]]);
    res = res.concat(mid);
    for (i = a.length - suf; i < a.length; i++) res.push([' ', a[i]]);
    return res;
  }

  function diffHtml(a, b) {
    var d = diff(a, b), CTX = 2, out = [], i = 0, changed = false;
    for (var k = 0; k < d.length; k++) if (d[k][0] !== ' ') { changed = true; break; }
    if (!changed) return '<div class="nbox"><div>Отличий в тексте нет.</div></div>';
    function line(op, s) {
      var cls = op === '+' ? 'we-d-add' : op === '-' ? 'we-d-del' : 'we-d-eq';
      return '<div class="we-dl ' + cls + '"><i>' + (op === ' ' ? '' : op) + '</i><span>' + (s ? esc(s) : '&nbsp;') + '</span></div>';
    }
    while (i < d.length) {
      if (d[i][0] !== ' ') { out.push(line(d[i][0], d[i][1])); i++; continue; }
      var j = i;
      while (j < d.length && d[j][0] === ' ') j++;
      var run = j - i, head = i === 0 ? 0 : CTX, tail = j === d.length ? 0 : CTX;
      if (run > head + tail + 1) {
        for (var h = i; h < i + head; h++) out.push(line(' ', d[h][1]));
        var skip = run - head - tail;
        out.push('<div class="we-dl we-d-gap">… ' + skip + ' ' + plural(skip, ['строка', 'строки', 'строк']) + ' без изменений</div>');
        for (var t = j - tail; t < j; t++) out.push(line(' ', d[t][1]));
      } else {
        for (var q = i; q < j; q++) out.push(line(' ', d[q][1]));
      }
      i = j;
    }
    return '<div class="we-diff">' + out.join('') + '</div>';
  }
})();
