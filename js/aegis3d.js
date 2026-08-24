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

  function buildChar(stage, pose) {
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
    char.appendChild(headSlot);

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

    stage.appendChild(char);
  }

  document.querySelectorAll('[data-skin3d]').forEach(el => buildChar(el, el.dataset.skin3d));
})();
