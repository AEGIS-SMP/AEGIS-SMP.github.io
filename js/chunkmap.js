/* AEGIS SMP — живые карты из настоящих чанков сервера.

   Обе карты рисуются не из скриншотов, а из данных самого мира: картинки
   в assets/map пишет tools/chunkmap_build.py, один пиксель в них — один
   чанк. Поменялась карта — перезапустить скрипт, сайт подхватит сам.

   [data-mosaic] — мозаика Европы на первом экране главной (europe.png:
   белое — суша). Клетка мозаики — квадрат 2×2 чанка. Под указателем клетки
   загораются фирменным градиентом («фонарь»), случайные клетки суши
   время от времени вспыхивают, а в углу бегут широта и долгота места под
   фонарем. Без указателя фонарь сам медленно бродит по карте.
   С 20.10.2026 та же мозаика стоит в шапке каждой внутренней страницы
   (.page-hero): у каждой страницы свой участок Европы (data-focus).

   [data-archive-map] — карта сезона «1936» в архиве (s1936.png: в красном
   канале номер державы, в зеленом и синем — номер провинции, плюс имена
   и цвета из data/map-1936.json). Масштаб, перетаскивание, подсказка
   с державой и провинцией под указателем или пальцем.

   «Меньше движения» в системе: мозаика стоит, фонарь двигается только
   за указателем, без вспышек и без заставки. */
(function () {
  'use strict';

  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = function () { return !!(RM && RM.matches); };
  var CPD = 6.4;  // чанков на градус: X = lon*102.4 блока = lon*6.4 чанка

  function loadImg(src) {
    return new Promise(function (ok, fail) {
      var im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { fail(new Error('нет картинки ' + src)); };
      im.src = src;
    });
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function pixels(im) {
    var c = makeCanvas(im.naturalWidth, im.naturalHeight);
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  }
  /* Перемешивание номера клетки: оттенок суши не должен складываться
     в узор, а простое i*a ^ j*b в младших битах дает ровную шахматку. */
  function hash(i, j) {
    var h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function degrees(lat, lon) {
    var f = function (v) { return Math.abs(v).toFixed(1).replace('.', ','); };
    return f(lat) + '° ' + (lat >= 0 ? 'с. ш.' : 'ю. ш.') + ' · ' +
           f(lon) + '° ' + (lon >= 0 ? 'в. д.' : 'з. д.');
  }
  function spaced(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /* ================= мозаика первого экрана ================= */

  var EU_CX = -160, EU_CZ = -461;  // чанк левого верхнего угла europe.png
  var K = 2;                       // клетка мозаики — K×K чанков
  var FOCUS_COL = 144, FOCUS_ROW = 64;  // 20° в. д., 52° с. ш. — середина Европы
  var SHADES = ['#1b1b20', '#1e1e24', '#222228', '#26262d'];
  var COAST = '#3a2d25';
  var SEA_DOT = '#18181d';
  var PING_LIFE = 1700;
  /* Точки открытого моря для страницы 404 («чанк не найден»): фонарь
     бродит там, где суши нет. */
  var SEA = [[-18, 46], [-12, 53], [4, 57], [-6, 44], [5, 40], [18, 35], [33, 34], [34, 43], [20, 57]];
  // картинка мозаики — рядом со скриптом, а не с текущим адресом (404 живет по любому пути)
  var ME = document.currentScript && document.currentScript.src;
  var MOSAIC_SRC = ME ? new URL('../assets/map/europe.png', ME).href : 'assets/map/europe.png';

  function Mosaic(cv) {
    var host = cv.closest('.hero, .page-hero') || cv.parentElement;
    var hud = host.querySelector('[data-mosaic-hud]');
    // шкала по нижнему краю шапки: метка на ней идет за фонарем
    var edge = host.querySelector('[data-mosaic-edge] i');
    var page = host.classList.contains('page-hero');
    var ctx = cv.getContext('2d');
    var cols = 0, rows = 0, land = null, coast = null;
    var cw = 0, ch = 0, dpr = 1, P = 8, S = 7, OX = 0, OY = 0, focusX = .62;
    var edgeX = -1;
    /* Своя середина у каждой страницы: data-focus="долгота,широта" на шапке
       (или "sea" — случайное море). Без него — середина Европы. */
    var fCol = FOCUS_COL, fRow = FOCUS_ROW;
    var fAttr = host.getAttribute('data-focus') || '';
    var fPt = fAttr === 'sea' ? SEA[(Math.random() * SEA.length) | 0] : fAttr.split(',').map(Number);
    if (fPt.length === 2 && isFinite(fPt[0]) && isFinite(fPt[1])) {
      fCol = (fPt[0] * CPD - EU_CX) / K;
      fRow = (-fPt[1] * CPD - EU_CZ) / K;
    }
    // на внутренних страницах фонарь ходит ближе к своей точке
    var wanderX = page ? .1 : .2, wanderY = page ? .2 : .24;
    var base = null, lit = null, fx = null, fxc = null, R = 0, fxGrad = null;
    var landVis = [];
    var pings = [], nextPing = 0;
    var raf = 0, last = 0, introAt = 0, seen = true, ready = false;
    var cur = null, aim = null, pointerOn = false, pointerUntil = 0;
    var hudText = '';

    function cells(im) {
      var d = pixels(im), w = im.naturalWidth;
      cols = Math.floor(w / K); rows = Math.floor(im.naturalHeight / K);
      land = new Uint8Array(cols * rows);
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var n = 0;
          for (var b = 0; b < K; b++) {
            for (var a = 0; a < K; a++) {
              if (d[((j * K + b) * w + i * K + a) * 4] > 127) n++;
            }
          }
          land[j * cols + i] = n * 2 >= K * K ? 1 : 0;
        }
      }
      // берег — суша, у которой сбоку море; край картинки берегом не считаем
      coast = new Uint8Array(cols * rows);
      var at = function (i, j) {
        return i < 0 || j < 0 || i >= cols || j >= rows ? 1 : land[j * cols + i];
      };
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          if (land[y * cols + x] && !(at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1))) {
            coast[y * cols + x] = 1;
          }
        }
      }
    }

    /* Вся раскладка — в пикселях экрана (не CSS): так квадраты ложатся
       ровно на пиксели и не мылятся на экранах с масштабом 125–150 %. */
    function layout() {
      var r = cv.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = Math.round(r.width * dpr); ch = Math.round(r.height * dpr);
      cv.width = cw; cv.height = ch;
      var p = Math.max(6, Math.min(10, Math.round(r.height / 118)));
      P = Math.round(p * dpr);
      S = P - Math.max(1, Math.round(dpr));
      focusX = r.width < 760 ? .5 : page ? .74 : .62;
      OX = Math.round(cw * focusX - (fCol + .5) * P);
      OY = Math.round(ch / 2 - fRow * P);

      base = makeCanvas(cw, ch);
      lit = makeCanvas(cw, ch);
      var b = base.getContext('2d'), l = lit.getContext('2d');
      var i0 = Math.floor(-OX / P) - 1, i1 = Math.ceil((cw - OX) / P);
      var j0 = Math.floor(-OY / P) - 1, j1 = Math.ceil((ch - OY) / P);
      var buckets = [[], [], [], [], [], []];  // 4 оттенка суши, берег, точки моря
      landVis = [];
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var x = OX + i * P, y = OY + j * P;
          var inside = i >= 0 && j >= 0 && i < cols && j < rows;
          if (inside && land[j * cols + i]) {
            buckets[coast[j * cols + i] ? 4 : hash(i, j) % 4].push(x, y);
            if (x >= 0 && y >= 0 && x + S <= cw && y + S <= ch) landVis.push(x, y);
          } else if (!(i & 1) && !(j & 1)) {
            buckets[5].push(x, y);
          }
        }
      }
      var D = Math.max(2, Math.round(2 * dpr)), dOff = Math.round((S - D) / 2);
      var fills = SHADES.concat([COAST, SEA_DOT]);
      for (var k = 0; k < 6; k++) {
        var q = buckets[k], w = k === 5 ? D : S, o = k === 5 ? dOff : 0;
        b.fillStyle = fills[k];
        b.beginPath();
        for (var m = 0; m < q.length; m += 2) b.rect(q[m] + o, q[m + 1] + o, w, w);
        b.fill();
      }
      // тот же рисунок в фирменном градиенте — его и открывает фонарь
      var g = l.createLinearGradient(0, ch, cw * .35, 0);
      g.addColorStop(0, '#F58620');
      g.addColorStop(1, '#FCE68F');
      l.fillStyle = g;
      l.beginPath();
      for (var t = 0; t < 5; t++) {
        var qq = buckets[t];
        for (var n = 0; n < qq.length; n += 2) l.rect(qq[n], qq[n + 1], S, S);
      }
      l.fill();

      R = Math.round(Math.max(120, Math.min(250, Math.min(r.width, r.height) * .27)) * dpr);
      fx = makeCanvas(2 * R, 2 * R);
      fxc = fx.getContext('2d');
      fxGrad = fxc.createRadialGradient(R, R, 0, R, R, R);
      fxGrad.addColorStop(0, 'rgba(0,0,0,1)');
      fxGrad.addColorStop(.38, 'rgba(0,0,0,.62)');
      fxGrad.addColorStop(1, 'rgba(0,0,0,0)');
      var home = { x: cw * focusX, y: ch * .5 };
      if (!cur) cur = { x: home.x, y: home.y };
      cur.x = Math.min(cw, Math.max(0, cur.x)); cur.y = Math.min(ch, Math.max(0, cur.y));
      if (!aim) aim = { x: home.x, y: home.y };
      pings = [];
      return true;
    }

    function lantern(x, y, alpha) {
      if (alpha <= 0) return;
      var x0 = Math.round(x - R), y0 = Math.round(y - R);
      var sx0 = Math.max(0, x0), sy0 = Math.max(0, y0);
      var sx1 = Math.min(cw, x0 + 2 * R), sy1 = Math.min(ch, y0 + 2 * R);
      if (sx1 <= sx0 || sy1 <= sy0) return;
      // мягкое тепло под фонарем
      var glow = ctx.createRadialGradient(x, y, 0, x, y, R * 1.7);
      glow.addColorStop(0, 'rgba(245,134,32,' + (.11 * alpha) + ')');
      glow.addColorStop(1, 'rgba(245,134,32,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - R * 1.7, y - R * 1.7, R * 3.4, R * 3.4);
      // клетки в градиенте, вырезанные мягким кругом
      fxc.globalCompositeOperation = 'source-over';
      fxc.clearRect(0, 0, 2 * R, 2 * R);
      fxc.drawImage(lit, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - x0, sy0 - y0, sx1 - sx0, sy1 - sy0);
      fxc.globalCompositeOperation = 'destination-in';
      fxc.fillStyle = fxGrad;
      fxc.fillRect(0, 0, 2 * R, 2 * R);
      ctx.globalAlpha = alpha;
      ctx.drawImage(fx, x0, y0);
      ctx.globalAlpha = 1;
    }

    function updateHud() {
      if (!hud) return;
      var i = (cur.x - OX) / P, j = (cur.y - OY) / P;
      var lon = (EU_CX + i * K) / CPD, lat = -(EU_CZ + j * K) / CPD;
      var t = degrees(lat, lon);
      if (t !== hudText) { hudText = t; hud.textContent = t; }
    }

    function frame(now) {
      raf = 0;
      if (!ready) return;
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;
      var still = reduced();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cw, ch);

      // заставка: карта проявляется волной слева направо
      var q = introAt && !still ? (now - introAt) / 1500 : 1;
      if (q < 1) {
        var e = 1 - Math.pow(1 - q, 3), xw = Math.round(cw * 1.15 * e);
        var xs = Math.min(cw, xw);
        if (xs > 0) ctx.drawImage(base, 0, 0, xs, ch, 0, 0, xs, ch);
        var bands = [[.14, .5], [.05, .9]];  // ширина доли экрана и яркость
        for (var bi = 0; bi < bands.length; bi++) {
          var bw = Math.round(cw * bands[bi][0]), bx = Math.max(0, xw - bw), bx1 = Math.min(cw, xw);
          if (bx1 > bx) {
            ctx.globalAlpha = bands[bi][1] * (1 - q * q);
            ctx.drawImage(lit, bx, 0, bx1 - bx, ch, bx, 0, bx1 - bx, ch);
          }
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(base, 0, 0);
      }

      if (!still) {
        // вспышки: клетка суши загорается и гаснет
        if (now >= nextPing && landVis.length && q >= 1) {
          var pick = (Math.random() * (landVis.length / 2)) | 0;
          pings.push({ x: landVis[pick * 2], y: landVis[pick * 2 + 1], t: now });
          nextPing = now + 90 + Math.random() * 120;
        }
        for (var pi = pings.length - 1; pi >= 0; pi--) {
          var pg = pings[pi], life = (now - pg.t) / PING_LIFE;
          if (life >= 1) { pings.splice(pi, 1); continue; }
          var a = Math.sin(Math.PI * life);
          ctx.globalAlpha = a * a * .85;
          ctx.drawImage(lit, pg.x, pg.y, S, S, pg.x, pg.y, S, S);
        }
        ctx.globalAlpha = 1;

        // фонарь: за указателем, а без него бродит по Европе
        if (!pointerOn && now > pointerUntil) {
          var tt = now / 1000;
          aim.x = cw * focusX + cw * wanderX * Math.sin(tt * .23);
          aim.y = ch * .5 + ch * wanderY * Math.sin(tt * .31 + 1.3);
        }
        var kk = 1 - Math.exp(-dt / (pointerOn ? 110 : 420));
        cur.x += (aim.x - cur.x) * kk;
        cur.y += (aim.y - cur.y) * kk;
      } else {
        cur.x = aim.x; cur.y = aim.y;
      }
      lantern(cur.x, cur.y, q < 1 ? q : 1);
      updateHud();
      if (edge) {
        var ex = Math.round(cur.x / dpr);
        if (ex !== edgeX) { edgeX = ex; edge.style.transform = 'translateX(' + ex + 'px)'; }
      }

      if (!still && seen && !document.hidden) raf = requestAnimationFrame(frame);
    }

    function kick() {
      if (!raf && ready) { last = 0; raf = requestAnimationFrame(frame); }
    }

    function onMove(e) {
      if (!ready) return;
      var r = cv.getBoundingClientRect();
      var x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      if (x < 0 || y < 0 || x > cw || y > ch) return;
      aim.x = x; aim.y = y;
      pointerOn = e.pointerType === 'mouse' || e.pointerType === 'pen';
      pointerUntil = performance.now() + 2500;
      kick();
    }
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerdown', onMove, { passive: true });
    host.addEventListener('pointerleave', function () {
      pointerOn = false;
      pointerUntil = performance.now() + 900;
    });

    var pend = 0;
    function relayout() {
      pend = 0;
      if (!land) return;
      if (layout()) { ready = true; kick(); }
    }
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (!pend) pend = requestAnimationFrame(relayout); }).observe(cv);
    } else {
      window.addEventListener('resize', function () { if (!pend) pend = requestAnimationFrame(relayout); });
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        seen = es[es.length - 1].isIntersecting;
        if (seen) kick();
      }).observe(cv);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    if (RM && RM.addEventListener) RM.addEventListener('change', kick);

    loadImg(cv.getAttribute('data-mosaic') || MOSAIC_SRC).then(function (im) {
      cells(im);
      if (!layout()) return;
      ready = true;
      introAt = performance.now();
      host.classList.add('mosaic-on');
      kick();
    }).catch(function () {
      // нет картинки — остается статичный фон из CSS, ничего не ломаем
      host.classList.add('mosaic-off');
    });
  }

  /* ================= карта сезона «1936» ================= */

  var Y0 = 64, Y1 = 948;           // строки чанков: 80° с. ш. … 58° ю. ш. (без Антарктиды)
  var SEA = '#111116';
  var NEUTRAL = [58, 58, 66];       // ничья суша у полюсов
  var MAX_S = 7;                    // крупнее 7 экранных точек на чанк не растим

  function hexRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var v = parseInt(h, 16);
    return isNaN(v) ? [120, 120, 128] : [v >> 16 & 255, v >> 8 & 255, v & 255];
  }
  /* Цвета держав взяты из игры, где фон светлый. На темной странице
     черная Германия пропала бы — темные цвета подтягиваем к серому,
     а слишком кричащие чуть приглушаем к фону. */
  function tone(c) {
    var lum = (.2126 * c[0] + .7152 * c[1] + .0722 * c[2]) / 255;
    var up = Math.max(0, Math.min(1, (.26 - lum) / .26)) * .55;
    return c.map(function (v) {
      v = v + (176 - v) * up;
      return Math.round(v * .86 + 18 * .14);
    });
  }

  function ArchiveMap(el) {
    var cv = el.querySelector('canvas');
    var ctx = cv.getContext('2d');
    var tip = el.querySelector('.amap-tip');
    var data = null, nat = null, prv = null, img = null, cols = [];
    var W = 0, H = 0, dpr = 1, minS = 1;
    var view = { s: 1, x: 0, y: Y0 };
    var hl = -1, hlCache = {}, pin = null;
    var raf = 0;
    var GW = 2304, GH = 1152;

    function build(im, json) {
      data = json; GW = json.w; GH = json.h;
      var d = pixels(im);
      nat = new Uint8Array(GW * GH);
      prv = new Uint16Array(GW * GH);
      for (var q = 0, o = 0; q < GW * GH; q++, o += 4) {
        nat[q] = d[o];
        prv[q] = d[o + 1] | d[o + 2] << 8;
      }
      cols = [null];
      json.countries.forEach(function (c) { cols.push(tone(hexRgb(c.c))); });
      var cnv = makeCanvas(GW, GH), cc = cnv.getContext('2d');
      var id = cc.createImageData(GW, GH), px = id.data;
      for (var z = 0; z < GH; z++) {
        for (var x = 0; x < GW; x++) {
          var i = z * GW + x, n = nat[i];
          if (!n) continue;
          var c = n === 255 ? NEUTRAL : (cols[n] || NEUTRAL);
          // кромка державы (и берег) темнее, граница провинций — чуть-чуть
          var pv = prv[i], f = 1;
          var l = x > 0 ? i - 1 : i, r = x < GW - 1 ? i + 1 : i;
          var u = z > 0 ? i - GW : i, dn = z < GH - 1 ? i + GW : i;
          if (nat[l] !== n || nat[r] !== n || nat[u] !== n || nat[dn] !== n) f = .58;
          else if (prv[l] !== pv || prv[r] !== pv || prv[u] !== pv || prv[dn] !== pv) f = .84;
          var p4 = i * 4;
          px[p4] = c[0] * f; px[p4 + 1] = c[1] * f; px[p4 + 2] = c[2] * f; px[p4 + 3] = 255;
        }
      }
      cc.putImageData(id, 0, 0);
      img = cnv;
    }

    function fill(name, val) {
      document.querySelectorAll('[data-a1936="' + name + '"]').forEach(function (n) { n.textContent = val; });
    }

    function size() {
      var r = cv.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var keep = W ? { cx: view.x + W / view.s / 2, cy: view.y + H / view.s / 2, z: view.s / minS } : null;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      minS = Math.max(W / GW, H / (Y1 - Y0));
      if (keep) {
        view.s = Math.min(MAX_S, minS * keep.z);
        view.x = keep.cx - W / view.s / 2; view.y = keep.cy - H / view.s / 2;
      } else {
        home();
      }
      clamp();
      return true;
    }
    function home() {
      view.s = minS;
      // на узком экране карта шире окна — начинаем с Европы
      view.x = 1240 - W / view.s / 2;
      view.y = Y0;
      clamp();
    }
    function clamp() {
      view.s = Math.max(minS, Math.min(MAX_S, view.s));
      var vw = W / view.s, vh = H / view.s;
      view.x = Math.max(0, Math.min(GW - vw, view.x));
      view.y = Math.max(Y0, Math.min(Y1 - vh, view.y));
      el.classList.toggle('zoomed', view.s > minS * 1.02);
    }
    function zoomAt(f, sx, sy) {
      var wx = view.x + sx / view.s, wy = view.y + sy / view.s;
      view.s = Math.max(minS, Math.min(MAX_S, view.s * f));
      view.x = wx - sx / view.s; view.y = wy - sy / view.s;
      clamp(); req();
    }

    function hlCanvas(n) {
      if (hlCache[n]) return hlCache[n];
      var c = data.countries[n - 1], b = c && c.b;
      if (!b) return null;
      var w = b[2] - b[0] + 1, h = b[3] - b[1] + 1;
      var src = img.getContext('2d').getImageData(b[0], b[1], w, h);
      var sp = src.data;
      for (var z = 0; z < h; z++) {
        for (var x = 0; x < w; x++) {
          if (nat[(b[1] + z) * GW + b[0] + x] !== n) sp[(z * w + x) * 4 + 3] = 0;
        }
      }
      var cnv = makeCanvas(w, h);
      cnv.getContext('2d').putImageData(src, 0, 0);
      hlCache[n] = { c: cnv, b: b };
      return hlCache[n];
    }

    // Подписи — фирменный Montserrat обычным регистром, кегль растет
    // с размером страны: крупные державы читаются первыми, как в атласе.
    // Вместо жесткой черной обводки — тонкая полупрозрачная и мягкая тень.
    var LABEL_FONT = 'Montserrat, Inter, system-ui, sans-serif';
    var spacing = 'letterSpacing' in ctx;

    function labels() {
      var placed = [];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      // lk — чанки того куска, где стоит подпись (метрополия без колоний):
      // по нему решаем, влезет ли надпись, иначе «Бельгия» за счет Конго
      // подписывалась бы поверх соседей уже на общем плане.
      var size = function (c) { return c.lk || c.k; };
      var list = data.countries.map(function (c, i) { return { c: c, n: i + 1 }; })
        .filter(function (o) { return o.c.l && o.c.k; })
        .sort(function (a, b) { return size(b.c) - size(a.c); });
      for (var t = 0; t < list.length; t++) {
        var c = list[t].c, span = Math.sqrt(size(c)) * view.s;
        if (span < 44) break;
        var x = (c.l[0] + .5 - view.x) * view.s, y = (c.l[1] + .5 - view.y) * view.s;
        if (x < -40 || y < -10 || x > W + 40 || y > H + 10) continue;
        var fs = Math.round(Math.max(11, Math.min(18, 8 + span / 20)));
        ctx.font = '700 ' + fs + 'px ' + LABEL_FONT;
        if (spacing) ctx.letterSpacing = (fs * .02).toFixed(2) + 'px';
        var text = c.n;
        var w = ctx.measureText(text).width + 6, hh = fs * .75;
        if (w > span * 1.9) continue;
        var box = [x - w / 2, y - hh, x + w / 2, y + hh];
        if (box[0] < 2 || box[2] > W - 2 || box[1] < 2 || box[3] > H - 2) continue;
        var hit = false;
        for (var p = 0; p < placed.length && !hit; p++) {
          var o = placed[p];
          hit = !(box[2] < o[0] || box[0] > o[2] || box[3] < o[1] || box[1] > o[3]);
        }
        if (hit) continue;
        placed.push(box);
        var dim = hl > 0 && list[t].n !== hl;
        ctx.globalAlpha = dim ? .4 : 1;
        // shadowBlur не масштабируется матрицей, поэтому умножаем на dpr
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 5 * dpr;
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(14,14,16,.5)';
        ctx.strokeText(text, x, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#F7F4EE';
        ctx.fillText(text, x, y);
      }
      ctx.globalAlpha = 1;
      if (spacing) ctx.letterSpacing = '0px';
    }

    function draw() {
      raf = 0;
      if (!img) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = SEA;
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = view.s < 1;
      ctx.drawImage(img, view.x, view.y, W / view.s, H / view.s, 0, 0, W, H);
      if (hl > 0) {
        var h = hlCanvas(hl);
        if (h) {
          ctx.fillStyle = 'rgba(14,14,16,.55)';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(h.c, (h.b[0] - view.x) * view.s, (h.b[1] - view.y) * view.s,
            h.c.width * view.s, h.c.height * view.s);
        }
      }
      labels();
    }
    function req() { if (!raf) raf = requestAnimationFrame(draw); }

    function at(sx, sy) {
      var x = Math.floor(view.x + sx / view.s), z = Math.floor(view.y + sy / view.s);
      if (x < 0 || z < 0 || x >= GW || z >= GH) return null;
      var i = z * GW + x;
      return { n: nat[i], p: prv[i] };
    }

    function showTip(sx, sy) {
      var a = at(sx, sy);
      var n = a && a.n > 0 && a.n < 255 ? a.n : -1;
      if (n !== hl) { hl = n; req(); }
      if (n < 0) { tip.hidden = true; return; }
      var c = data.countries[n - 1], pr = a.p ? data.provinces[a.p - 1] : null;
      tip.textContent = '';
      var h = document.createElement('b');
      var sw = document.createElement('i');
      sw.style.background = c.c;
      h.appendChild(sw);
      h.appendChild(document.createTextNode(c.n));
      tip.appendChild(h);
      if (pr && pr.n) {
        var s1 = document.createElement('span');
        s1.textContent = 'Провинция ' + pr.n;
        tip.appendChild(s1);
      }
      var s2 = document.createElement('span');
      s2.className = 'amap-tip-n';
      s2.textContent = spaced(c.k) + ' ' + plural(c.k, 'чанк', 'чанка', 'чанков') + ' · ' +
        c.p + ' ' + plural(c.p, 'провинция', 'провинции', 'провинций');
      tip.appendChild(s2);
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var lx = sx + 16, ly = sy + 16;
      if (lx + tw > W - 8) lx = sx - tw - 16;
      if (ly + th > H - 8) ly = sy - th - 16;
      tip.style.transform = 'translate(' + Math.max(8, lx) + 'px,' + Math.max(8, ly) + 'px)';
    }
    function hideTip() {
      tip.hidden = true;
      if (hl !== -1) { hl = -1; req(); }
    }
    function plural(n, one, few, many) {
      var m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
      return many;
    }

    /* --- указатель: мышь водит подсказку, палец и мышь таскают карту,
       двумя пальцами — масштаб. Короткое касание без сдвига — подсказка. */
    var ptrs = {}, drag = null, pinch = null;
    function local(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!img || e.button > 0) return;
      var p = local(e);
      ptrs[e.pointerId] = p;
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s };
        drag = null;
      } else {
        drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false, type: e.pointerType };
      }
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    });
    cv.addEventListener('pointermove', function (e) {
      if (!img) return;
      var p = local(e);
      if (ptrs[e.pointerId]) ptrs[e.pointerId] = p;
      var ids = Object.keys(ptrs);
      if (pinch && ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomAt(pinch.s * d / pinch.d / view.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      if (drag) {
        var dx = p.x - drag.x, dy = p.y - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
          drag.moved = true;
          el.classList.add('dragging');
          hideTip();
        }
        if (drag.moved) {
          view.x = drag.vx - dx / view.s;
          view.y = drag.vy - dy / view.s;
          clamp(); req();
        }
        return;
      }
      if (e.pointerType === 'mouse') showTip(p.x, p.y);
    });
    function up(e, cancel) {
      var was = drag;
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch = null;
      drag = null;
      el.classList.remove('dragging');
      if (!cancel && was && !was.moved) {
        var p = local(e);
        showTip(p.x, p.y);
      }
    }
    cv.addEventListener('pointerup', function (e) { up(e, false); });
    cv.addEventListener('pointercancel', function (e) { up(e, true); });
    cv.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse' && !drag) hideTip();
    });
    cv.addEventListener('dblclick', function (e) {
      var p = local(e);
      zoomAt(2, p.x, p.y);
    });
    /* Колесо без Ctrl листает страницу, как везде: карта посреди длинной
       страницы не должна ловить прокрутку. С Ctrl (и щипком на тачпаде,
       он приходит так же) — масштаб. */
    cv.addEventListener('wheel', function (e) {
      if (!img || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var p = local(e);
      zoomAt(Math.exp(-e.deltaY * .0025), p.x, p.y);
    }, { passive: false });
    el.addEventListener('keydown', function (e) {
      if (!img || e.target.closest('button')) return;
      var step = 80 / view.s, k = e.key;
      if (k === 'ArrowLeft') view.x -= step;
      else if (k === 'ArrowRight') view.x += step;
      else if (k === 'ArrowUp') view.y -= step;
      else if (k === 'ArrowDown') view.y += step;
      else if (k === '+' || k === '=') { zoomAt(1.5, W / 2, H / 2); e.preventDefault(); return; }
      else if (k === '-' || k === '_') { zoomAt(1 / 1.5, W / 2, H / 2); e.preventDefault(); return; }
      else if (k === '0') { home(); req(); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      clamp(); req();
    });
    el.querySelectorAll('[data-amap]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-amap');
        hideTip();
        if (a === 'in') zoomAt(1.6, W / 2, H / 2);
        else if (a === 'out') zoomAt(1 / 1.6, W / 2, H / 2);
        else { home(); req(); }
      });
    });
    document.addEventListener('pointerdown', function (e) {
      if (!tip.hidden && !el.contains(e.target)) hideTip();
    });

    var pend = 0;
    function resize() { pend = 0; if (img && size()) { hideTip(); draw(); } }
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (!pend) pend = requestAnimationFrame(resize); }).observe(cv);
    } else {
      window.addEventListener('resize', function () { if (!pend) pend = requestAnimationFrame(resize); });
    }

    /* Карта весит под сотню килобайт и стоит внизу страницы — грузим,
       только когда до нее докрутили. */
    var started = false;
    function start() {
      if (started) return;
      started = true;
      Promise.all([
        loadImg(el.getAttribute('data-src') || 'assets/map/s1936.png'),
        fetch(el.getAttribute('data-json') || 'data/map-1936.json').then(function (r) {
          if (!r.ok) throw new Error('map json ' + r.status);
          return r.json();
        }),
        // канвас не ждет веб-шрифт сам: без этого подписи легли бы системным
        document.fonts ? document.fonts.load('700 14px Montserrat', 'Ая').catch(function () {}) : null
      ]).then(function (res) {
        build(res[0], res[1]);
        var live = res[1].countries.filter(function (c) { return c.k; });
        fill('countries', live.length);
        fill('provinces', res[1].provinces.filter(function (p) { return p.k; }).length);
        fill('chunks', spaced(live.reduce(function (s, c) { return s + c.k; }, 0)));
        el.classList.add('is-ready');
        size();
        draw();
      }).catch(function () {
        el.classList.add('is-failed');
      });
    }
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); start(); }
      }, { rootMargin: '600px 0px' });
      io.observe(el);
    } else {
      start();
    }
  }

  /* Шапка внутренней страницы (.page-hero): холст мозаики, координаты
     и шкала по нижнему краю вставляются сюда, в разметке их нет — без JS
     там остается мозаика картинкой (css/style.css). data-mosaic-skip
     на шапке оставляет ее как есть. */
  function pageHero(h) {
    if (h.hasAttribute('data-mosaic-skip') || h.querySelector('canvas[data-mosaic]')) return;
    var c = document.createElement('canvas');
    c.className = 'hero-mosaic';
    c.setAttribute('data-mosaic', '');
    c.setAttribute('aria-hidden', 'true');
    h.insertBefore(c, h.firstChild);
    var hud = document.createElement('div');
    hud.className = 'ph-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML = '<span data-mosaic-hud></span>';
    var edge = document.createElement('div');
    edge.className = 'ph-edge';
    edge.setAttribute('data-mosaic-edge', '');
    edge.setAttribute('aria-hidden', 'true');
    edge.innerHTML = '<i></i>';
    h.appendChild(hud);
    h.appendChild(edge);
  }

  function boot() {
    document.querySelectorAll('.page-hero').forEach(pageHero);
    document.querySelectorAll('canvas[data-mosaic]').forEach(function (c) { Mosaic(c); });
    document.querySelectorAll('[data-archive-map]').forEach(function (m) { ArchiveMap(m); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
