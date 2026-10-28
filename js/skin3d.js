/* AEGIS SMP — объемный скин игрока (CSS 3D, без внешних библиотек).

   AegisSkin3d.mount(el, {nick, has, slim}) строит в el фигуру по скину игрока:
   оба слоя (шляпа, куртка, рукава, штанины), тонкие или обычные руки, старые
   скины 64×32. Скина своего нет — берем тот стандартный, что игра выдает этому
   нику (AegisTk.stdSkin), вместе с его руками.

   Повернуть — тянуть мышью или пальцем (по вертикали палец листает страницу),
   стрелками с клавиатуры; двойной щелчок ставит лицом к зрителю. В покое фигура
   стоит: только едва заметное дыхание и руки, как на главной. Сама по кругу не
   крутится — вечный разворот овнер уже однажды убрал с главной. */
(function (w) {
  'use strict';
  var A = w.AegisApi, T = w.AegisTk;
  var S = 8;                              // px экрана на пиксель скина
  var RY = -28, RX = -10;                 // начальный ракурс: лицо и правый бок

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function load(src, cors) {
    return new Promise(function (ok, bad) {
      var i = new Image();
      if (cors) i.crossOrigin = 'anonymous';
      i.onload = function () { ok(i); };
      i.onerror = bad;
      i.src = src;
    });
  }

  /* Картинку приводим к виду, в каком ее показывает игра: старый скин 64×32
     достраиваем до 64×64 (левые рука и нога — зеркало правых, те же копии, что
     делает сам Minecraft), основной слой делаем непрозрачным, а сплошную
     «шляпу» старого скина — пустой. Для этого картинку надо прочесть; если
     браузер не дал (чужой адрес без разрешения) — рисуем как есть, а левые
     конечности зеркалим трансформом. */
  var LEGACY = [
    [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12],
    [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12], [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4],
    [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12]
  ];
  function prep(img) {
    var legacy = img.height * 2 === img.width;
    var raw = { src: img.src, h: legacy ? 32 : 64, legacy: legacy };
    try {
      var k = img.width / 64, c = el('canvas'), x = c.getContext('2d');
      c.width = c.height = 64;
      x.imageSmoothingEnabled = false;
      x.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, legacy ? 32 : 64);
      if (legacy) {
        LEGACY.forEach(function (r) {
          x.save();
          x.translate(r[0] + r[2] + r[4], r[1] + r[3]);
          x.scale(-1, 1);
          x.drawImage(img, r[0] * k, r[1] * k, r[4] * k, r[5] * k, 0, 0, r[4], r[5]);
          x.restore();
        });
      }
      var d = x.getImageData(0, 0, 64, 64), p = d.data;
      var solid = function (x0, y0, x1, y1) {
        for (var y = y0; y < y1; y++) for (var i = x0; i < x1; i++) p[(y * 64 + i) * 4 + 3] = 255;
      };
      solid(0, 0, 32, 16);
      solid(0, 16, 64, 32);
      solid(16, 48, 48, 64);
      if (legacy) {
        var clear = true, y, i;
        for (y = 0; y < 32 && clear; y++) for (i = 32; i < 64; i++) if (p[(y * 64 + i) * 4 + 3] < 128) { clear = false; break; }
        if (clear) for (y = 0; y < 32; y++) for (i = 32; i < 64; i++) p[(y * 64 + i) * 4 + 3] = 0;
      }
      x.putImageData(d, 0, 0);
      return { src: c.toDataURL('image/png'), h: 64, legacy: false };
    } catch (e) {
      return raw;
    }
  }

  /* Откуда брать скин. Свой — с адреса службы (с разрешением на чтение, чтобы
     привести картинку к игровому виду); не вышло или своего нет — стандартный. */
  function source(o) {
    var std = T && T.stdSkin ? T.stdSkin(o.nick) : { src: 'assets/img/heads/steve.png', slim: false };
    var fall = function () {
      return load(std.src).then(function (i) { return { img: i, slim: std.slim }; });
    };
    if (!o.has || !A || !A.base()) return fall();
    var url = A.base() + '/skins/' + encodeURIComponent(o.nick) + '.png';
    var mine = function (i) {
      if (i.width < 64 || (i.height !== i.width && i.height * 2 !== i.width)) throw new Error('size');
      return { img: i, slim: !!o.slim };
    };
    return load(url, true).then(mine)
      .catch(function () { return load(url, false).then(mine); })
      .catch(fall);
  }

  /* Развертка коробки u,v шириной w, высотой h, глубиной d — как в игре.
     right/left — бока самого персонажа: правый бок у него слева от зрителя. */
  function uvs(u, v, w, h, d) {
    return {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h], back: [u + d + w + d, v + d, w, h]
    };
  }

  /* Коробка с центром at (x вправо, y вверх, z к зрителю; в пикселях скина),
     g — насколько второй слой шире первого с каждой стороны. */
  function box(parent, tex, o) {
    var g = o.g || 0, W = o.w + 2 * g, H = o.h + 2 * g, D = o.d + 2 * g;
    var b = el('div', 'p3d');
    b.style.transform = 'translate3d(' + o.at[0] * S + 'px,' + (-o.at[1] * S) + 'px,' + o.at[2] * S + 'px)' +
      (o.mirror ? ' scaleX(-1)' : '');
    var r = uvs(o.uv[0], o.uv[1], o.w, o.h, o.d);
    [
      ['front', W, H, 'translateZ(' + D / 2 * S + 'px)'],
      ['back', W, H, 'rotateY(180deg) translateZ(' + D / 2 * S + 'px)'],
      ['left', D, H, 'rotateY(90deg) translateZ(' + W / 2 * S + 'px)'],
      ['right', D, H, 'rotateY(-90deg) translateZ(' + W / 2 * S + 'px)'],
      ['top', W, D, 'rotateX(90deg) translateZ(' + H / 2 * S + 'px)'],
      ['bottom', W, D, 'rotateX(-90deg) translateZ(' + H / 2 * S + 'px)']
    ].forEach(function (f) {
      var t = r[f[0]], fw = f[1] * S, fh = f[2] * S, sx = fw / t[2], sy = fh / t[3];
      var e = el('div', 'f');
      e.style.width = fw + 'px';
      e.style.height = fh + 'px';
      e.style.backgroundSize = 64 * sx + 'px ' + tex.h * sy + 'px';
      e.style.backgroundPosition = -t[0] * sx + 'px ' + -t[1] * sy + 'px';
      e.style.transform = 'translate(-50%,-50%) ' + f[3];
      b.appendChild(e);
    });
    parent.appendChild(b);
    return b;
  }

  /* Сама фигура. Центр вращения — середина роста (16 пикселей от земли), чтобы
     наклон не уводил ее за край сцены. Руки висят на плечах: у каждой свой узел
     с точкой поворота там же, где в игре. */
  function build(aim, tex, slim) {
    var ch = el('div', 'sk3-char'), aw = slim ? 3 : 4, old = tex.legacy;
    var y = function (v) { return v - 16; };
    var part = function (parent, base, over, o) {
      box(parent, tex, { w: o.w, h: o.h, d: o.d, at: o.at, uv: base, mirror: o.mirror });
      if (over && !old) box(parent, tex, { w: o.w, h: o.h, d: o.d, at: o.at, uv: over, g: o.g || .25 });
    };
    // ноги: правая у персонажа — слева от зрителя
    part(ch, [0, 16], [0, 32], { w: 4, h: 12, d: 4, at: [-2, y(6), 0] });
    part(ch, old ? [0, 16] : [16, 48], [0, 48], { w: 4, h: 12, d: 4, at: [2, y(6), 0], mirror: old });
    part(ch, [16, 16], [16, 32], { w: 8, h: 12, d: 4, at: [0, y(18), 0] });
    var head = el('div', 'p3d sk3-head');
    head.style.transform = 'translate3d(0,' + -y(28) * S + 'px,0)';
    box(head, tex, { w: 8, h: 8, d: 8, at: [0, 0, 0], uv: [0, 0] });
    box(head, tex, { w: 8, h: 8, d: 8, at: [0, 0, 0], uv: [32, 0], g: .5 });
    ch.appendChild(head);
    [[-1, [40, 16], [40, 32]], [1, old ? [40, 16] : [32, 48], [48, 48]]].forEach(function (a) {
      var slot = el('div', 'p3d');
      slot.style.transform = 'translate3d(' + a[0] * (4 + aw / 2) * S + 'px,' + -y(22) * S + 'px,0)';
      var arm = el('div', 'p3d sk3-arm ' + (a[0] < 0 ? 'r' : 'l'));
      part(arm, a[1], a[2], { w: aw, h: 12, d: 4, at: [0, -4, 0], mirror: old && a[0] > 0 });
      slot.appendChild(arm);
      ch.appendChild(slot);
    });
    aim.appendChild(ch);
  }

  function mount(stage, o) {
    if (!stage || !o || !o.nick) return;
    stage.classList.add('sk3');
    stage.classList.remove('sk3-ok', 'sk3-bad');
    stage.textContent = '';
    var aim = el('div', 'sk3-aim');
    stage.appendChild(aim);

    var calm = w.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ry = RY - (calm ? 0 : 55), rx = RX, vy = 0, spin = 0, drag = null;
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
    var paint = function () {
      aim.style.transform = 'rotateX(' + rx.toFixed(1) + 'deg) rotateY(' + ry.toFixed(1) + 'deg)';
    };
    var ease = function (on) { aim.classList.toggle('sk3-ease', !!on); };
    var stop = function () { if (spin) cancelAnimationFrame(spin); spin = 0; };
    var home = function () { stop(); ease(true); ry = RY; rx = RX; paint(); };
    paint();

    source(o).then(function (r) {
      var tex = prep(r.img);
      stage.style.setProperty('--sk3', 'url("' + tex.src + '")');
      build(aim, tex, r.slim);
      stage.classList.add('sk3-ok');
      // Фигура выходит из-за плеча и встает в свой ракурс — один раз, при показе.
      if (!calm) requestAnimationFrame(function () { requestAnimationFrame(home); });
    }, function () { stage.classList.add('sk3-bad'); });

    stage.tabIndex = 0;
    stage.setAttribute('role', 'img');
    stage.setAttribute('aria-label', 'Скин ' + o.nick + ' в объеме. Повернуть — потянуть или стрелками.');

    stage.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      stop();
      ease(false);
      drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      vy = 0;
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* нет — и ладно */ }
      stage.classList.add('sk3-grab');
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(8, e.timeStamp - drag.t);
      ry += dx * .6;
      if (e.pointerType === 'mouse') rx = clamp(rx - dy * .35, -40, 30);
      vy = dx * .6 * 16 / dt;
      drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      paint();
    });
    var up = function () {
      if (!drag) return;
      drag = null;
      stage.classList.remove('sk3-grab');
      if (calm || Math.abs(vy) < .4) return;
      // Отпустили с разгона — фигура докручивается и плавно встает.
      var run = function () {
        ry += vy;
        vy *= .93;
        paint();
        spin = Math.abs(vy) > .05 ? requestAnimationFrame(run) : 0;
      };
      spin = requestAnimationFrame(run);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', home);
    stage.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') ry += k === 'ArrowLeft' ? -20 : 20;
      else if (k === 'ArrowUp' || k === 'ArrowDown') rx = clamp(rx + (k === 'ArrowUp' ? -10 : 10), -40, 30);
      else if (k === 'Home' || k === 'Enter' || k === ' ') { home(); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      stop();
      ease(true);
      paint();
    });

    // Дыхание и руки не считаем, пока фигура за краем экрана.
    if ('IntersectionObserver' in w) {
      new IntersectionObserver(function (es) {
        es.forEach(function (x) { stage.classList.toggle('sk3-off', !x.isIntersecting); });
      }, { rootMargin: '80px' }).observe(stage);
    }
  }

  w.AegisSkin3d = { mount: mount };
})(window);
