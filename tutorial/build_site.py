"""生成文档站 site/：每页独立 HTML，共用 site/assets/style.css；视频只在「流程演示」页内联。

用法：python3 tutorial/build_site.py
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SITE = ROOT / 'site'
sys.path.insert(0, str(SITE))
from pages import PAGES  # noqa: E402

NAV = json.loads((SITE / 'nav.json').read_text(encoding='utf-8'))
UPDATED = '2026-11-04'
ORDER = [it for g in NAV['groups'] for it in g['items']]


def b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def localize(html: str) -> str:
    """把站内相对链接改成可在 /help/ 前缀下工作：平台内打开时走 /help/…，本地打开时用相对路径。"""
    return html


def fill_media(html: str) -> str:
    html = html.replace('{{POSTER}}', 'data:image/jpeg;base64,' + b64(ROOT / 'images/poster.jpg'))
    html = html.replace('{{VIDEO_MAIN}}', 'data:video/mp4;base64,' + b64(ROOT / 'videos/tutorial.mp4'))
    return html


def backlink() -> str:
    """顶部导航里的「返回数据平台」。部署在 /help/ 下时链接到 /；本地直接打开文档时回退到默认平台地址。"""
    home = NAV.get('home') or '/'
    return (f'<a class="backlink" href="{home}" data-local="{DEFAULT_PLATFORM}">'
            '← 返回数据平台</a>')


DEFAULT_PLATFORM = os.environ.get('LABELVLA_URL', 'http://127.0.0.1:8002/')


def sidebar(current: str) -> str:
    groups = []
    for g in NAV['groups']:
        items = ''.join(
            f'<li><a href="{it["file"]}"{" class=\'on\'" if it["file"] == current else ""}>{it["label"]}</a></li>'
            for it in g['items'])
        groups.append(f'<div class="group"><p class="t">{g["title"]}</p><ol>{items}</ol></div>')
    return '<nav class="sidebar">' + ''.join(groups) + '</nav>'


def crumbs(page: dict) -> str:
    if page['title'] == '概览':
        return ''
    parts = '<a href="index.html">文档</a>'
    for label, href in page.get('crumbs', []):
        parts += f' / <a href="{href}">{label}</a>'
    return f'<p class="crumbs">{parts} / <span>{page["title"]}</span></p>'


def right_toc(page: dict) -> str:
    items = page.get('toc') or []
    if len(items) < 2:
        return '<aside class="toc-right"></aside>'
    lis = ''.join(f'<a href="#{anchor}">{label}</a>' for label, anchor in items)
    return f'<aside class="toc-right"><p class="t">本页</p>{lis}</aside>'


def pager(current: str) -> str:
    idx = next((i for i, it in enumerate(ORDER) if it['file'] == current), None)
    if idx is None:
        return ''
    prev = ORDER[idx - 1] if idx > 0 else None
    nxt = ORDER[idx + 1] if idx + 1 < len(ORDER) else None
    left = f'<a href="{prev["file"]}"><span class="k">上一页</span>{prev["label"]}</a>' if prev else ''
    right = f'<a class="next" href="{nxt["file"]}"><span class="k">下一页</span>{nxt["label"]}</a>' if nxt else ''
    return f'<nav class="pager">{left}{right}</nav>'


TEMPLATE = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · LabelVLA 文档</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="topbar">
  <div class="in">
    <a class="brand" href="index.html">LabelVLA 文档 <span>· 使用指南</span></a>
    {backlink}
    <span class="right">最后更新 {updated}</span>
  </div>
</div>
<div class="shell">
  {sidebar}
  <main>
    {crumbs}
    {body}
    {pager}
  </main>
  {toc}
</div>
<footer>LabelVLA 文档</footer>
<script>
  // 图片：平台内以 /help/ 提供时用 /help/images/…，本地双击打开时用 ../images/…
  (function () {{
    var prefix = location.pathname.startsWith('/help/') ? '/help/' : '../';
    document.querySelectorAll('img[data-rel]').forEach(function (i) {{ i.src = prefix + i.getAttribute('data-rel'); }});
  }})();
  // 本地双击打开时，「返回数据平台」指向默认平台地址
  (function () {{
    if (location.protocol === 'file:') {{
      document.querySelectorAll('a[data-local]').forEach(function (a) {{ a.href = a.getAttribute('data-local'); }});
    }}
  }})();
  // 平台内以 /help/ 提供时，站内相对链接与样式路径统一补前缀；本地双击打开则保持相对路径
  (function () {{
    if (!location.pathname.startsWith('/help/')) return;
    var map = {{ '': '/help/index.html', 'index.html': '/help/index.html' }};
    document.querySelectorAll('a[href]').forEach(function (a) {{
      var h = a.getAttribute('href');
      if (!h || h.startsWith('/') || h.startsWith('#') || h.startsWith('data:') || h.startsWith('http')) return;
      a.setAttribute('href', '/help/' + h);
    }});
    document.querySelectorAll('link[rel=stylesheet]').forEach(function (l) {{
      var h = l.getAttribute('href');
      if (h && !h.startsWith('/')) l.setAttribute('href', '/help/' + h);
    }});
    document.querySelectorAll('img[data-rel]').forEach(function (i) {{
      var h = i.getAttribute('data-rel');
      i.src = location.pathname.startsWith('/help/') ? '/help/' + h : h;
    }});
  }})();
  (function () {{
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc-right a'));
    if (!links.length) return;
    var targets = links.map(function (a) {{ return document.querySelector(a.getAttribute('href')); }}).filter(Boolean);
    function update() {{
      var y = window.scrollY + 120, current = null;
      targets.forEach(function (t) {{ if (t.offsetTop <= y) current = t.id; }});
      links.forEach(function (a) {{ a.classList.toggle('on', a.getAttribute('href') === '#' + current); }});
    }}
    window.addEventListener('scroll', update, {{ passive: true }});
    update();
  }})();
</script>
</body>
</html>
'''

import shutil
(SITE / 'images').mkdir(exist_ok=True)
for f in (ROOT / 'images').glob('*.jpg'):
    shutil.copy2(f, SITE / 'images' / f.name)

for name, page in PAGES.items():
    html = TEMPLATE.format(title=page['title'], updated=UPDATED, sidebar=sidebar(name),
                           backlink=backlink(), crumbs=crumbs(page), body=fill_media(page['body']),
                           pager=pager(name), toc=right_toc(page))
    (SITE / name).write_text(html, encoding='utf-8')
    print(f'site/{name}  {(SITE / name).stat().st_size / 1024:.0f} KB')
