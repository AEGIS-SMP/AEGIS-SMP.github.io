# Качественные изометрические рендеры блоков (стиль официальных MC-рендеров):
# точная 2:1 диметрия, стандартный шейдинг граней, суперсэмплинг 4x -> LANCZOS
from PIL import Image, ImageEnhance
import os

ICO = r'E:\AEGIS\site\assets\icons'
OUT = r'E:\AEGIS\site\assets\img'

SS = 4
SIZE = 256
W = SIZE * SS // 2  # размер грани в рабочем масштабе

def load(name):
    im = Image.open(os.path.join(ICO, name)).convert('RGBA')
    return im.resize((W, W), Image.NEAREST)

def shade(im, k):
    r, g, b, a = im.split()
    rgb = ImageEnhance.Brightness(Image.merge('RGB', (r, g, b))).enhance(k)
    return Image.merge('RGBA', (*rgb.split(), a))

def iso_cube(top, left, right, out):
    canvas = Image.new('RGBA', (2 * W, 2 * W), (0, 0, 0, 0))
    # верх-ромб: inverse map (X,Y)->(u,v): u = X/2 + Y - W/2 ; v = -X/2 + Y + W/2
    t = load(top).transform((2 * W, W + 1), Image.AFFINE,
                            (0.5, 1, -W / 2, -0.5, 1, W / 2), Image.BICUBIC)
    canvas.alpha_composite(t, (0, 0))
    # левая грань: u = X ; v = Y - W/2 - X/2
    l = shade(load(left), 0.75).transform((W, 2 * W), Image.AFFINE,
                            (1, 0, 0, -0.5, 1, -W / 2), Image.BICUBIC)
    canvas.alpha_composite(l, (0, 0))
    # правая грань: u = X' ; v = Y - W + X'/2
    r_ = shade(load(right), 0.55).transform((W, 2 * W), Image.AFFINE,
                            (1, 0, 0, 0.5, 1, -W), Image.BICUBIC)
    canvas.alpha_composite(r_, (W, 0))
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, out), optimize=True)
    print(out, 'ok')

iso_cube('aegis_siren_top.png', 'aegis_siren_front.png', 'aegis_siren_side.png', 'iso_siren.png')
iso_cube('aegis_vault_top_small.png', 'aegis_vault_front_small.png', 'aegis_vault_side_small.png', 'iso_vault.png')
iso_cube('create_gearbox_top.png', 'create_gearbox.png', 'create_gearbox.png', 'iso_gearbox.png')
iso_cube('create_brass_casing.png', 'create_brass_casing.png', 'create_brass_casing.png', 'iso_brass.png')
