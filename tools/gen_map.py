# Политическая карта 1936 для сайта — отрисовка из world_1938.geojson (данные проекта, не скриншот)
import json, hashlib
from PIL import Image, ImageDraw

SRC = r'E:\AEGIS\dev\aegislive\tools\world_1938.geojson'
OUT = r'E:\AEGIS\site\assets\img\map_1936.png'

W, H = 2400, 1200
SS = 2  # суперсэмплинг
w, h = W * SS, H * SS

# тёплая тёмная палитра держав (бренд AEGIS)
FILLS = ['#2b2118', '#33271a', '#241f18', '#302415', '#3a2b16', '#282218', '#352818', '#2d2013']
STROKE = (14, 14, 16, 255)
SEA = (17, 17, 20, 255)

img = Image.new('RGBA', (w, h), SEA)
dr = ImageDraw.Draw(img)

def hexrgb(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i+2], 16) for i in (0, 2, 4)) + (255,)

def proj(lon, lat):
    return ((lon + 180.0) / 360.0 * w, (90.0 - lat) / 180.0 * h)

data = json.load(open(SRC, encoding='utf-8'))
feats = data['features']
print('features:', len(feats))

def rings(geom):
    if geom['type'] == 'Polygon':
        yield from geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            yield from poly

for f in feats:
    props = f.get('properties') or {}
    name = str(props.get('SUBJECTO') or props.get('NAME') or props.get('name') or '?')
    fill = hexrgb(FILLS[int(hashlib.md5(name.encode()).hexdigest(), 16) % len(FILLS)])
    for ring in rings(f['geometry']):
        pts = [proj(x, y) for x, y in ring]
        if len(pts) > 2:
            dr.polygon(pts, fill=fill, outline=None)

# контуры вторым проходом, чтобы не съедались заливкой соседей
for f in feats:
    for ring in rings(f['geometry']):
        pts = [proj(x, y) for x, y in ring]
        if len(pts) > 2:
            dr.line(pts + [pts[0]], fill=(150, 108, 52, 255), width=SS)

img = img.resize((W, H), Image.LANCZOS).convert('RGB')
img.save(OUT, optimize=True)
print('saved', OUT)
