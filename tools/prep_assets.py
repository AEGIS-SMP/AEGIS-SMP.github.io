import os, shutil, zipfile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SITE = r'E:\AEGIS\site'
IMG = os.path.join(SITE, 'assets', 'img')
ICO = os.path.join(SITE, 'assets', 'icons')
FILES = os.path.join(SITE, 'files')
for d in (IMG, ICO, FILES, os.path.join(SITE, 'css'), os.path.join(SITE, 'js')):
    os.makedirs(d, exist_ok=True)

# 1. hero — утверждённый key art (clean, без UI-затемнения)
src = r'E:\AEGIS\_shared\art\out\launcher_bg_frontier_y5_1920x1200_clean.png'
im = Image.open(src).convert('RGB')
im.save(os.path.join(IMG, 'hero.jpg'), 'JPEG', quality=86, optimize=True)
print('hero:', im.size)

# 2. логотип
im = Image.open(r'C:\Users\vine0\Downloads\AEGIS_logo_assets\logo_trimmed.png')
w = 800
im2 = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
im2.save(os.path.join(IMG, 'logo.png'), optimize=True)
print('logo:', im2.size)

# 3. карта Земли (огромная — только если потянет)
try:
    src = r'C:\Users\vine0\Downloads\AEGIS_logo_assets\earth_map_overview.png'
    im = Image.open(src)
    print('map raw size:', im.size)
    if im.width * im.height <= 900_000_000:
        im = im.convert('RGB')
        im.thumbnail((2400, 2400), Image.LANCZOS)
        im.save(os.path.join(IMG, 'map.jpg'), 'JPEG', quality=84, optimize=True)
        print('map saved:', im.size)
    else:
        print('map skipped: too big')
except Exception as e:
    print('map failed:', e)

# 4. favicon
shutil.copy(r'C:\Users\vine0\Downloads\AEGIS_logo_assets\server_icon_rounded.png',
            os.path.join(IMG, 'favicon.png'))

# 5. рендеры предметов Create (готовые)
srcdir = r'C:\Users\vine0\Downloads\AEGIS_logo_assets\items'
for f in os.listdir(srcdir):
    if f.endswith('.png'):
        shutil.copy(os.path.join(srcdir, f), os.path.join(ICO, f))
print('create renders copied:', len(os.listdir(srcdir)))

# отдельные рендеры из корня
for f in ('11_cannon_barrel_bronze.png', '14_autocannon.png', '01_cogwheel.png', '17_shield.png'):
    shutil.copy(os.path.join(r'C:\Users\vine0\Downloads\AEGIS_logo_assets', f),
                os.path.join(ICO, f.split('_', 1)[-1] if f[0].isdigit() else f))

# 6. текстуры AegisLive (из исходников мода)
adir = r'E:\AEGIS\dev\aegislive\resources\assets\aegislive\textures\item'
if os.path.isdir(adir):
    for f in os.listdir(adir):
        if f.endswith('.png'):
            shutil.copy(os.path.join(adir, f), os.path.join(ICO, 'aegis_' + f))
    print('aegislive item textures:', os.listdir(adir))
else:
    print('no aegislive item dir')

# 7. текстуры из jar-ов CBC и TFMG
WANT = {
    'createbigcannons': ['he_shell', 'ap_shell', 'shrapnel_shell', 'smoke_shell', 'fluid_shell',
                         'powder_charge', 'impact_fuze', 'timed_fuze', 'bag_of_grapeshot',
                         'big_cartridge', 'autocannon_cartridge', 'cast_iron_ingot', 'bronze_ingot'],
    'tfmg': ['steel_ingot', 'coal_coke', 'rebar', 'steel_mechanism', 'cast_iron_ingot',
             'aluminum_ingot', 'crude_oil_bucket', 'crude_oil_fluid_bucket'],
}
import glob as g
jars = {'createbigcannons': g.glob(r'E:\AEGIS\test\mods\createbigcannons*.jar')[0],
        'tfmg': g.glob(r'E:\AEGIS\test\mods\tfmg*.jar')[0]}
for modid, jar in jars.items():
    with zipfile.ZipFile(jar) as z:
        names = set(z.namelist())
        got = []
        for item in WANT[modid]:
            p = f'assets/{modid}/textures/item/{item}.png'
            if p in names:
                with open(os.path.join(ICO, f'{modid}_{item}.png'), 'wb') as out:
                    out.write(z.read(p))
                got.append(item)
        missing = [i for i in WANT[modid] if i not in got]
        print(modid, 'got:', got)
        if missing:
            print(modid, 'MISSING:', missing)

# 8. лаунчер
for f in ('AEGIS-Launcher.jar', 'AEGIS-Launcher.bat'):
    p = os.path.join(r'E:\AEGIS\launcher', f)
    if os.path.exists(p):
        shutil.copy(p, os.path.join(FILES, f))
        print('launcher copied:', f)
print('DONE')
