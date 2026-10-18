/* AEGIS SMP — 3D-персонаж из скина овнера (CSS 3D, без внешних библиотек).
   Декорации-механизмы — статичные изометрические рендеры (assets/img/iso_*.png),
   генерятся офлайн из текстур модов: site/tools/gen_iso.py. */

(() => {
  'use strict';

  const S = 7;                      // px экрана на 1 px скина
  const SKIN = 'assets/img/skin.png';
  const ICONS = 'assets/icons/';

  // uv: [u, v] верхнего левого угла каждой грани на скине; размеры в пикселях скина
  function box(parent, o) {
    const { w, h, d, uv, pos = [0, 0, 0], mul = 1, cls = '' } = o;
    const b = document.createElement('div');
    b.className = 'p3d ' + cls;
    b.style.transform = `translate3d(${pos[0] * S}px, ${-pos[1] * S}px, ${pos[2] * S}px)`;

    const faces = [
      [w, h, 'front', `rotateY(0deg) translateZ(${d * mul / 2 * S}px)`],
      [w, h, 'back', `rotateY(180deg) translateZ(${d * mul / 2 * S}px)`],
      [d, h, 'right', `rotateY(90deg) translateZ(${w * mul / 2 * S}px)`],
      [d, h, 'left', `rotateY(-90deg) translateZ(${w * mul / 2 * S}px)`],
      [w, d, 'top', `rotateX(90deg) translateZ(${h * mul / 2 * S}px)`],
      [w, d, 'bottom', `rotateX(-90deg) translateZ(${h * mul / 2 * S}px)`],
    ];
    for (const [fw, fh, key, tr] of faces) {
      if (!o.uv[key]) continue;
      const f = document.createElement('div');
      f.className = 'f';
      f.style.width = fw * mul * S + 'px';
      f.style.height = fh * mul * S + 'px';
      if (o.img) {
        f.style.backgroundImage = `url('${o.img}')`;
        f.style.backgroundSize = '100% 100%';
      } else {
        f.style.backgroundImage = `url('${SKIN}')`;
        f.style.backgroundSize = `${64 * S * mul}px ${64 * S * mul}px`;
        f.style.backgroundPosition = `${-uv[key][0] * S * mul}px ${-uv[key][1] * S * mul}px`;
      }
      f.style.transform = `translate(-50%,-50%) ${tr}`;
      b.appendChild(f);
    }
    parent.appendChild(b);
    return b;
  }

  // разметка UV классического скина 64×64, руки slim (3 px)
  const UV = {
    head: { right: [0, 8], front: [8, 8], left: [16, 8], back: [24, 8], top: [8, 0], bottom: [16, 0] },
    hat: { right: [32, 8], front: [40, 8], left: [48, 8], back: [56, 8], top: [40, 0], bottom: [48, 0] },
    body: { right: [16, 20], front: [20, 20], left: [28, 20], back: [32, 20], top: [20, 16], bottom: [28, 16] },
    armR: { right: [40, 20], front: [44, 20], left: [47, 20], back: [51, 20], top: [44, 16], bottom: [47, 16] },
    armL: { right: [32, 52], front: [36, 52], left: [39, 52], back: [43, 52], top: [36, 48], bottom: [39, 48] },
    legR: { right: [0, 20], front: [4, 20], left: [8, 20], back: [12, 20], top: [4, 16], bottom: [8, 16] },
    legL: { right: [16, 52], front: [20, 52], left: [24, 52], back: [28, 52], top: [20, 48], bottom: [24, 48] },
  };

  /* Шутка овнера: изредка фигура стоит без головы, а голова лежит рядом на
     земле. Примерно раз на двадцать заходов, весь день 1 апреля и 31 октября.
     Новичку в первый заход не показываем — без привычной фигуры шутка
     читается как поломка. Проверить: ?mc=headless */
  function headless() {
    if (/[?&]mc=headless\b/.test(location.search)) return true;
    let seen = false;
    try {
      seen = !!localStorage.getItem('aegis_mc_seen');
      localStorage.setItem('aegis_mc_seen', '1');
    } catch (e) { return false; }
    if (!seen) return false;
    const d = new Date(), md = d.getMonth() * 100 + d.getDate();
    return md === 301 || md === 931 || Math.random() < 0.05;
  }
  const NO_HEAD = headless();

  function buildChar(stage, pose) {
    // Разворот фигуры и её собственное дыхание — разные узлы: анимация
    // перебивает transform целиком, на одном узле они бы дрались.
    const aim = document.createElement('div');
    aim.className = 'mc-aim';
    const char = document.createElement('div');
    char.className = 'mc-char';

    box(char, { w: 4, h: 12, d: 4, uv: UV.legR, pos: [-2, 6, 0] });
    box(char, { w: 4, h: 12, d: 4, uv: UV.legL, pos: [2, 6, 0] });
    box(char, { w: 8, h: 12, d: 4, uv: UV.body, pos: [0, 18, 0] });

    const headSlot = document.createElement('div');
    headSlot.className = 'p3d head-sway';
    headSlot.style.setProperty('--head-y', -28 * S + 'px');
    box(headSlot, { w: 8, h: 8, d: 8, uv: UV.head });
    box(headSlot, { w: 8, h: 8, d: 8, uv: UV.hat, mul: 1.1 });
    if (pose === 'parade') {
      box(headSlot, { w: 9, h: 4.5, d: 9, img: ICONS + 'crown.png',
        uv: { front: [0, 0], back: [0, 0], right: [0, 0], left: [0, 0] }, pos: [0, 5.4, 0] });
    }
    if (NO_HEAD) {
      // лежит на боку у ног, справа; живёт на неподвижном узле, чтобы не
      // «дышать» вместе с телом
      headSlot.className = 'p3d head-drop';
      headSlot.style.transform =
        `translate3d(${12 * S}px, ${-4.4 * S}px, ${5 * S}px) rotateY(28deg) rotateZ(90deg)`;
      aim.appendChild(headSlot);
    } else {
      char.appendChild(headSlot);
    }

    box(char, { w: 3, h: 12, d: 4, uv: UV.armR, pos: [-5.5, 18, 0] });

    if (pose === 'wave') {
      const slot = document.createElement('div');
      slot.className = 'p3d';
      slot.style.transform = `translate3d(${5.5 * S}px, ${-23.5 * S}px, 0)`;
      const rot = document.createElement('div');
      rot.className = 'p3d arm-wave';
      box(rot, { w: 3, h: 12, d: 4, uv: UV.armL, pos: [0, -5.5, 0] });
      const tool = document.createElement('img');
      tool.src = ICONS + 'wrench.png';
      tool.className = 'mc-tool';
      tool.alt = '';
      tool.style.transform = `translate(-50%,-50%) translate3d(0, ${11.5 * S}px, ${3 * S}px) rotateZ(115deg)`;
      rot.appendChild(tool);
      slot.appendChild(rot);
      char.appendChild(slot);
    } else {
      box(char, { w: 3, h: 12, d: 4, uv: UV.armL, pos: [5.5, 18, 0] });
    }

    aim.appendChild(char);
    stage.appendChild(aim);
  }

  /* Пока фигура за краем экрана, её анимации незачем считать: сорок с лишним
     граней лежат внутри preserve-3d, видеокарте такой слой не отдать, и рисует
     их тот же поток, который двигает страницу. Именно это и отнимало кадры у
     прокрутки. Уходит из виду — ставим на паузу, возвращается — снимаем. */
  function watch(stage) {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(
      es => es.forEach(e => stage.classList.toggle('mc-off', !e.isIntersecting)),
      { rootMargin: '120px' }
    ).observe(stage);
  }

  /* Фигура провожает курсор взглядом. Это заменяет прежний вечный разворот
     корпуса: пока мышь стоит, персонаж стоит тоже — то есть в покое страница
     вообще ничего не пересчитывает. Углы маленькие и считаются от центра окна,
     чтобы не получилось «подсолнуха», который таращится в упор.
     На тач-экранах и при выключенной анимации не включаем вовсе. */
  function follow(stages) {
    if (!matchMedia('(pointer: fine)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let x = 0, y = 0, tick = 0;
    const clamp = v => v < -1 ? -1 : v > 1 ? 1 : v;

    const apply = () => {
      tick = 0;
      const ry = (-22 + x * 12).toFixed(1) + 'deg';
      const rx = (-4 - y * 4).toFixed(1) + 'deg';
      for (const s of stages) {
        if (s.classList.contains('mc-off')) continue;
        s.style.setProperty('--mc-ry', ry);
        s.style.setProperty('--mc-rx', rx);
      }
    };

    addEventListener('pointermove', e => {
      x = clamp((e.clientX - innerWidth / 2) / (innerWidth / 2));
      y = clamp((e.clientY - innerHeight / 2) / (innerHeight / 2));
      if (!tick) tick = requestAnimationFrame(apply);
    }, { passive: true });
  }

  const stages = [...document.querySelectorAll('[data-skin3d]')];
  stages.forEach(el => { buildChar(el, el.dataset.skin3d); watch(el); });
  if (stages.length) follow(stages);
})();
