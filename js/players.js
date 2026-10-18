/* Игроки AEGIS: список всех, кто заходил на сервер, поиск и карточка.
   Овнер 25.09.2026: «добавить на сайт список профилей игроков, чтобы можно было
   листать их и находить и смотреть».
   Служба отдаёт только публичное: ник, должность, державу, город, привилегию,
   сколько наиграно и когда был. Координат, наказаний, почты, Discord и
   Telegram на этой странице нет и не будет. */
(function () {
  'use strict';
  var A = window.AegisApi;
  var T = window.AegisTk;
  var esc = A.esc;
  var root = document.getElementById('plBody');
  if (!root) return;

  var PAGE = 30;
  var SORTS = [['', 'Сейчас в игре'], ['time', 'Больше всех наиграли'], ['new', 'Новенькие'], ['name', 'По имени']];
  var S = { q: '', sort: '', items: [], found: 0, total: 0, online: 0, busy: false, ask: 0 };
  var DLG = null, lastFocus = null;

  function color(c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : ''; }
  function plural(n, f) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (n1 > 1 && n1 < 5) return f[1];
    if (n1 === 1) return f[0];
    return f[2];
  }
  function date(ms) {
    if (!ms) return '';
    try {
      return new Date(Number(ms)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return ''; }
  }
  function hours(sec) {
    var h = Math.floor((Number(sec) || 0) / 3600);
    if (h < 1) return 'меньше часа';
    return h + ' ' + plural(h, ['час', 'часа', 'часов']);
  }
  function seenText(p) {
    if (p.online) return 'в игре сейчас';
    return p.seen ? 'в сети ' + A.ago(p.seen) : 'давно не в сети';
  }
  function head(nick, big) {
    var h = T && T.av ? T.av(nick) : '';
    return big ? h.replace('class="tk-av"', 'class="tk-av pl-big"') : h;
  }
  function drawHeads(el) { if (T && T.heads) T.heads(el); }

  /* ------------------------------------------------------------ каркас */

  function frame() {
    root.innerHTML = '<div class="pl">' +
      '<div class="pl-bar">' +
        '<label class="pl-find"><span class="sr-only">Поиск игрока</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
          '<input type="search" id="plQ" maxlength="40" autocomplete="off" spellcheck="false" ' +
          'placeholder="Ник, держава или город"></label>' +
        '<div class="live-tabs" role="group" aria-label="Порядок">' +
          SORTS.map(function (s) {
            return '<button type="button" data-sort="' + s[0] + '"' + (s[0] === S.sort ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') +
              '>' + esc(s[1]) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="pl-sum" id="plSum" role="status" aria-live="polite"></div>' +
      '<div id="plList"><div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div></div>' +
      '</div>' +
      '<div class="pl-dlg pl" id="plDlg" hidden><div class="pl-box" role="dialog" aria-modal="true" aria-labelledby="plDlgT">' +
        '<button type="button" class="pl-x" id="plX" aria-label="Закрыть">×</button><div id="plCard"></div></div></div>';

    var q = document.getElementById('plQ');
    var t = 0;
    q.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var v = q.value.trim();
        if (v === S.q) return;
        S.q = v;
        load(false);
      }, 350);
    });
    root.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-sort');
        if (v === S.sort) return;
        S.sort = v;
        root.querySelectorAll('[data-sort]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        load(false);
      });
    });

    DLG = document.getElementById('plDlg');
    document.getElementById('plX').addEventListener('click', closeCard);
    DLG.addEventListener('click', function (e) { if (e.target === DLG) closeCard(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && DLG && !DLG.hidden) closeCard();
    });
  }

  /* ------------------------------------------------------------ список */

  function load(more) {
    var my = ++S.ask;
    var offset = more ? S.items.length : 0;
    var list = document.getElementById('plList');
    if (!more) list.innerHTML = '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    S.busy = true;
    var path = '/pub/players?limit=' + PAGE + '&offset=' + offset +
      (S.sort ? '&sort=' + encodeURIComponent(S.sort) : '') +
      (S.q ? '&q=' + encodeURIComponent(S.q) : '');
    A.call(path, { auth: false }).then(function (r) {
      if (my !== S.ask) return;
      S.busy = false;
      S.found = r.found || 0; S.total = r.total || 0; S.online = r.online || 0;
      S.items = more ? S.items.concat(r.items || []) : (r.items || []);
      draw(more ? (r.items || []) : null);
    }, function (err) {
      if (my !== S.ask) return;
      S.busy = false;
      if (more) {
        var b = document.getElementById('plMore');
        if (b) { b.disabled = false; b.textContent = 'Показать ещё'; }
        var s = document.getElementById('plSum');
        if (s) s.textContent = A.textOf(err);
        return;
      }
      list.innerHTML = '<div class="empty"><h4>Список не загрузился</h4><p>' + esc(A.textOf(err)) +
        '</p><p style="margin-top:14px"><button type="button" class="btn btn-dark btn-sm" id="plRetry">Попробовать ещё раз</button></p></div>';
      document.getElementById('plRetry').addEventListener('click', function () { load(false); });
    });
  }

  function summary() {
    var s = document.getElementById('plSum');
    if (!s) return;
    var h = 'Всего <b>' + S.total + '</b> ' + plural(S.total, ['игрок', 'игрока', 'игроков']) +
      ', в игре сейчас <b class="pl-on">' + S.online + '</b>';
    if (S.q) h += ' · по запросу «' + esc(S.q) + '» — <b>' + S.found + '</b>';
    s.innerHTML = h;
  }

  function card(p) {
    var nick = p.nick || '';
    var bc = color(p.badgeColor);
    var h = '<a class="pl-card" href="#/p/' + encodeURIComponent(nick) + '">' + head(nick) +
      '<div class="pl-card-b"><div class="pl-nick">' + (p.online ? '<i class="pl-dot" title="в игре"></i>' : '') +
      '<span>' + esc(nick) + '</span></div>';
    if (p.badge) {
      h += '<span class="pl-badge"' + (bc ? ' style="color:' + bc + ';border-color:' + bc + '55"' : '') + '>' + esc(p.badge) + '</span>';
    }
    if (p.privilege) h += '<span class="pl-badge priv">' + esc(p.privilege) + '</span>';
    h += '<div class="pl-lines">';
    if (p.country) {
      var cc = color(p.countryColor);
      h += '<div><i class="pl-sw"' + (cc ? ' style="background:' + cc + '"' : '') + '></i><b>' + esc(p.country) + '</b>' +
        (p.countryRank ? ' · ' + esc(p.countryRank.toLowerCase()) : '') + '</div>';
    }
    if (p.town) h += '<div>Город <b>' + esc(p.town) + '</b>' + (p.townRank ? ' · ' + esc(p.townRank.toLowerCase()) : '') + '</div>';
    h += '<div class="pl-when' + (p.online ? ' on' : '') + '">' + esc(seenText(p)) + '</div>';
    h += '<div>Наиграно <b>' + esc(hours(p.playtime)) + '</b></div>';
    return h + '</div></div></a>';
  }

  function draw(added) {
    summary();
    var list = document.getElementById('plList');
    if (!S.items.length) {
      list.innerHTML = '<div class="empty"><h4>' + (S.q ? 'Никого не нашли' : 'Пока никого') + '</h4><p>' +
        (S.q ? 'Проверьте ник или поищите по державе и городу.' : 'Список появится, как только игроки зайдут на сервер.') +
        '</p></div>';
      return;
    }
    var grid = list.querySelector('.pl-grid');
    if (added && grid) {
      var tmp = document.createElement('div');
      tmp.innerHTML = added.map(card).join('');
      var fresh = Array.prototype.slice.call(tmp.children);
      fresh.forEach(function (el) { grid.appendChild(el); });
      fresh.forEach(drawHeads);
    } else {
      list.innerHTML = '<div class="pl-grid">' + S.items.map(card).join('') + '</div>';
      drawHeads(list);
    }
    var more = document.getElementById('plMoreBox');
    if (more) more.parentNode.removeChild(more);
    if (S.items.length < S.found) {
      var left = S.found - S.items.length;
      var box = document.createElement('div');
      box.className = 'pl-more';
      box.id = 'plMoreBox';
      box.innerHTML = '<button type="button" class="btn btn-dark" id="plMore">Показать ещё (' + left + ')</button>';
      list.appendChild(box);
      document.getElementById('plMore').addEventListener('click', function () {
        if (S.busy) return;
        this.disabled = true;
        this.textContent = 'Загружаем…';
        load(true);
      });
    }
  }

  /* ------------------------------------------------------------ карточка */

  function nickOf() {
    var m = /^#\/p\/([A-Za-z0-9_]{3,16})$/.exec(decodeURIComponent(location.hash || ''));
    return m ? m[1] : '';
  }

  function openCard(nick) {
    if (!DLG) return;
    if (DLG.hidden) lastFocus = document.activeElement;
    var box = document.getElementById('plCard');
    box.innerHTML = '<h2 id="plDlgT" class="sr-only">' + esc(nick) + '</h2>' +
      '<div class="loading" aria-label="Загрузка"><i></i><i></i><i></i></div>';
    DLG.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('plX').focus();
    document.title = nick + ' — игроки AEGIS SMP';
    A.call('/pub/player?nick=' + encodeURIComponent(nick), { auth: false }).then(function (r) {
      if (nickOf().toLowerCase() !== nick.toLowerCase()) return;
      showCard(r.player || {});
    }, function (err) {
      if (nickOf().toLowerCase() !== nick.toLowerCase()) return;
      box.innerHTML = '<h2 id="plDlgT">' + esc(nick) + '</h2><p class="pl-note">' + esc(A.textOf(err)) + '</p>';
    });
  }

  function showCard(p) {
    var box = document.getElementById('plCard');
    var nick = p.nick || '';
    var bc = color(p.badgeColor);
    var h = '<div class="pl-top">' + head(nick, true) + '<div><h2 id="plDlgT">' + esc(nick) + '</h2>';
    if (p.badge) h += '<span class="pl-badge"' + (bc ? ' style="color:' + bc + ';border-color:' + bc + '55"' : '') + '>' + esc(p.badge) + '</span>';
    if (p.privilege) h += '<span class="pl-badge priv">' + esc(p.privilege) + '</span>';
    h += '<div class="pl-state' + (p.online ? ' on' : '') + '">' + esc(seenText(p)) + '</div></div></div>';

    h += '<dl class="pl-dl">';
    var cc = color(p.countryColor);
    h += '<dt>Держава</dt><dd>' + (p.country
      ? '<i class="pl-sw"' + (cc ? ' style="background:' + cc + '"' : '') + '></i>' + esc(p.country) +
        (p.countryRank ? '<small>' + esc(p.countryRank) + '</small>' : '')
      : 'без гражданства') + '</dd>';
    h += '<dt>Город</dt><dd>' + (p.town
      ? esc(p.town) + '<small>' + esc([p.townRank, p.province ? 'провинция ' + p.province : ''].filter(Boolean).join(' · ')) + '</small>'
      : 'не живёт в городе') + '</dd>';
    h += '<dt>Наиграно</dt><dd>' + esc(p.playtimeText || hours(p.playtime)) + '</dd>';
    if (p.created) h += '<dt>С нами</dt><dd>с ' + esc(date(p.created)) + '</dd>';
    if (!p.online && p.seen) h += '<dt>Последний вход</dt><dd>' + esc(date(p.seen)) + '<small>' + esc(A.ago(p.seen)) + '</small></dd>';
    h += '</dl>';
    if (p.kills != null || p.deaths != null) {
      h += '<div class="pl-fights"><div><b>' + (Number(p.kills) || 0) + '</b><span>убийства игроков</span></div>' +
        '<div><b>' + (Number(p.deaths) || 0) + '</b><span>смерти</span></div></div>';
    }
    box.innerHTML = h;
    drawHeads(box);
  }

  function closeCard() {
    if (!DLG || DLG.hidden) return;
    DLG.hidden = true;
    document.body.style.overflow = '';
    document.title = 'Игроки — AEGIS SMP';
    if (nickOf()) {
      if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      else location.hash = '';
    }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function route() {
    var n = nickOf();
    if (n) openCard(n);
    else closeCard();
  }

  frame();
  load(false);
  route();
  window.addEventListener('hashchange', route);
})();
