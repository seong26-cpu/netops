#!/usr/bin/env python3
"""NetOps 로컬(사내망)판 빌드: NetOps.html 한 파일 — 외부 접속 0, 더블클릭 실행.
사용: python3 tools/build-local.py <출력폴더>"""
import base64, json, os, sys, re, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-local', 'NetOps-Local')
os.makedirs(out_dir, exist_ok=True)
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()
idx = rd('index.html')
js_name = re.search(r'src="\./assets/(index-[^"]+\.js)"', idx).group(1)
css_name = re.search(r'href="\./assets/(index-[^"]+\.css)"', idx).group(1)
bundle = rd('assets/' + js_name)
css = rd('assets/' + css_name)
# 도움말 그림: 파일 대신 내장 그림 사용
a = 'l.jsx("img",{src:`./help/${e}.png`'
assert bundle.count(a) == 1
bundle = bundle.replace(a, 'l.jsx("img",{src:(window.__nxHelpImg&&window.__nxHelpImg[e])||`./help/${e}.png`')
# 쓰지 않는 Firebase 코드의 외부 주소 제거 (로컬판은 외부 접속 0)
b0 = 'https://www.gstatic.com/firebasejs/${tw}/firebase-${i}-compat.js'
assert bundle.count(b0) == 1
bundle = bundle.replace(b0, 'about:blank#${tw}${i}')
help_img = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'help', '*.png'))):
    help_img[os.path.basename(f)[:-4]] = 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
pack = json.loads(rd('packs/standard-pack.json'))
icon = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(ROOT, 'icon.svg'), 'rb').read()).decode()
safe = lambda s: s.replace('</script', '<\\/script')
boot = 'window.__nxLocal=true;window.__nxPack=' + json.dumps(pack, ensure_ascii=False) + ';window.__nxHelpImg=' + json.dumps(help_img) + ';'
html = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>NetOps 운용 콘솔 (로컬판)</title>
<meta name="theme-color" content="#ffffff">
<meta name="description" content="NetOps 로컬판 — 인터넷·서버·계정 없이 이 파일 하나로 동작">
<link rel="icon" href="{icon}">
<style>{css}</style>
<script>{safe(boot)}</script>
<script>{safe(rd('ui-fix.js'))}</script>
<script>{safe(rd('storage.js'))}</script>
<script>{safe(rd('hw.js'))}</script>
<script>{safe(rd('upload.js'))}</script>
<script>{safe(rd('enrich.js'))}</script>
<script>{safe(rd('addons.js'))}</script>
</head>
<body>
<div id="root"></div>
<script>(function(){{"use strict";
{safe(bundle)}
}})();</script>
</body>
</html>
'''
for bad in ('fonts.googleapis', 'gstatic', 'github.io', 'seong26', 'firebase-config', 'AIza'):
    assert bad not in html, bad
open(os.path.join(out_dir, 'NetOps.html'), 'w', encoding='utf-8').write(html)
print('NetOps.html', round(len(html.encode()) / 1e6, 2), 'MB', '| models', len(pack['ports']), '| templates', len(pack['items']))
