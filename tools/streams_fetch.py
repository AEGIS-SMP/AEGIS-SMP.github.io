# -*- coding: utf-8 -*-
"""Кто из отслеживаемых каналов сейчас в эфире.

Читает  data/streamers.json  (кого смотрим) и пишет  data/streams.json
(что увидели). Запускается раз в десять минут из GitHub Actions — сайт
просто читает готовый файл и никуда сам не ходит. Так эфиры работают
на бесплатном хостинге: у страницы нет своего сервера, а ключи площадок
не могут утечь в браузер, потому что в браузер они не попадают.

Площадки:
  twitch   — нужен ключ приложения (секреты TWITCH_ID и TWITCH_SECRET);
             без него каналы Twitch просто помечаются «не проверяли».
  youtube  — без ключа: у канала открывается страница /live и смотрится,
             идёт ли трансляция. Квоты YouTube Data API тут не тратятся.
  vkvideo  — без ключа: открытый ответ живого блога VK Видео.

Ничего не падает: канал, который не ответил, помечается как «не проверяли»
и остаётся в списке. Пустой файл хуже вчерашних данных.
"""

import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'streamers.json'
DST = ROOT / 'data' / 'streams.json'

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
TIMEOUT = 20


def get(url, headers=None, data=None):
    """Запрос без исключений наружу: не ответили — вернём None."""
    h = {'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8'}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read().decode('utf-8', 'replace')
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print('  не ответил:', url.split('?')[0], '—', e)
        return None


def get_json(url, headers=None, data=None):
    raw = get(url, headers, data)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


# --------------------------------------------------------------------- twitch

def twitch_token():
    cid = os.environ.get('TWITCH_ID', '').strip()
    sec = os.environ.get('TWITCH_SECRET', '').strip()
    if not cid or not sec:
        return None, None
    d = get_json('https://id.twitch.tv/oauth2/token', data={
        'client_id': cid, 'client_secret': sec, 'grant_type': 'client_credentials'})
    if not d or not d.get('access_token'):
        print('  Twitch: ключ не принят')
        return None, None
    return cid, d['access_token']


def twitch_batch(logins):
    """Один запрос на всех: Twitch отдаёт до ста каналов за раз."""
    out = {}
    cid, tok = twitch_token()
    if not tok:
        return out
    head = {'Client-Id': cid, 'Authorization': 'Bearer ' + tok}

    q = '&'.join('user_login=' + urllib.parse.quote(x) for x in logins[:100])
    live = get_json('https://api.twitch.tv/helix/streams?' + q, head) or {}
    for s in live.get('data', []):
        thumb = (s.get('thumbnail_url') or '').replace('{width}', '640').replace('{height}', '360')
        out[s.get('user_login', '').lower()] = {
            'live': True,
            'title': s.get('title') or '',
            'viewers': s.get('viewer_count') or 0,
            'thumb': thumb,
            'game': s.get('game_name') or '',
            'started': s.get('started_at') or ''
        }

    # аватарки нужны и тем, кто сейчас не в эфире
    q2 = '&'.join('login=' + urllib.parse.quote(x) for x in logins[:100])
    users = get_json('https://api.twitch.tv/helix/users?' + q2, head) or {}
    for u in users.get('data', []):
        k = (u.get('login') or '').lower()
        row = out.setdefault(k, {'live': False})
        row['avatar'] = u.get('profile_image_url') or ''
        row.setdefault('title', u.get('description') or '')
    return out


# -------------------------------------------------------------------- youtube

RX_LIVE = re.compile(r'"isLiveNow"\s*:\s*true|hlsManifestUrl')
RX_VID = re.compile(r'"videoId"\s*:\s*"([\w-]{11})"')
RX_TITLE = re.compile(r'<meta name="title" content="([^"]*)"')
RX_WATCH = re.compile(r'"viewCount"\s*:\s*"(\d+)"')


def youtube_one(chan):
    """Страница /live у канала: если идёт трансляция, YouTube отдаёт её плеер."""
    ident = chan.lstrip('/')
    if ident.startswith('@'):
        url = 'https://www.youtube.com/' + ident + '/live'
    elif ident.startswith('UC'):
        url = 'https://www.youtube.com/channel/' + ident + '/live'
    else:
        url = 'https://www.youtube.com/@' + ident + '/live'

    html = get(url, {'Accept': 'text/html'})
    if not html:
        return None
    if not RX_LIVE.search(html):
        return {'live': False}

    vid = RX_VID.search(html)
    title = RX_TITLE.search(html)
    watch = RX_WATCH.search(html)
    row = {
        'live': True,
        'title': (title.group(1) if title else '').strip(),
        'viewers': int(watch.group(1)) if watch else 0
    }
    if vid:
        row['thumb'] = 'https://i.ytimg.com/vi/%s/maxresdefault.jpg' % vid.group(1)
        row['watch'] = 'https://www.youtube.com/watch?v=' + vid.group(1)
    return row


# -------------------------------------------------------------------- vkvideo

def vk_one(name):
    for host in ('api.live.vkvideo.ru', 'api.live.vkplay.ru'):
        d = get_json('https://%s/v1/blog/%s/public_video_stream'
                     % (host, urllib.parse.quote(name)))
        if not d:
            continue
        on = bool(d.get('isOnline'))
        row = {'live': on, 'title': (d.get('title') or '').strip()}
        if on:
            row['viewers'] = ((d.get('count') or {}).get('viewers')) or 0
            row['thumb'] = d.get('previewUrl') or ''
        return row
    return None


# ----------------------------------------------------------------------- сбор

def main():
    if not SRC.exists():
        print('нет файла', SRC)
        return 1
    src = json.loads(SRC.read_text(encoding='utf-8'))
    chans = src.get('channels') or []
    print('каналов в списке:', len(chans))

    tw_logins = [c['channel'].lower() for c in chans
                 if c.get('platform') == 'twitch' and c.get('channel')]
    tw = twitch_batch(tw_logins) if tw_logins else {}

    out = []
    for c in chans:
        plat = c.get('platform', '')
        row = {
            'id': c.get('id') or c.get('channel', ''),
            'name': c.get('name') or c.get('channel', ''),
            'platform': plat,
            'url': c.get('url') or '',
            'note': c.get('note') or '',
            'official': bool(c.get('official')),
            'live': False,
            'known': False          # удалось ли вообще проверить
        }
        got = None
        if plat == 'twitch':
            got = tw.get((c.get('channel') or '').lower())
        elif plat == 'youtube':
            got = youtube_one(c.get('channel') or '')
        elif plat == 'vkvideo':
            got = vk_one(c.get('channel') or '')
        else:
            print('  незнакомая площадка:', plat)

        if got is not None:
            row['known'] = True
            row.update(got)
            if row.get('watch') and not row.get('url'):
                row['url'] = row['watch']
        print('  %-9s %-22s %s' % (plat, c.get('channel', ''),
                                   'В ЭФИРЕ' if row['live'] else
                                   ('офлайн' if row['known'] else 'не проверили')))
        out.append(row)

    out.sort(key=lambda r: (not r['live'], -int(r.get('viewers') or 0), r['name'].lower()))
    data = {'at': int(time.time() * 1000), 'channels': out}

    # Пишем только при изменениях: коммит на каждый запуск засорил бы историю.
    new = json.dumps(data, ensure_ascii=False, indent=1)
    if DST.exists():
        try:
            old = json.loads(DST.read_text(encoding='utf-8'))
            old.pop('at', None)
            cur = dict(data)
            cur.pop('at', None)
            if old == cur:
                print('без изменений — файл не трогаем')
                return 0
        except ValueError:
            pass
    DST.write_text(new + '\n', encoding='utf-8')
    print('записано:', DST)
    return 0


if __name__ == '__main__':
    sys.exit(main())
