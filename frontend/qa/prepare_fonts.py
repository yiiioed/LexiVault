"""Download licensed Noto fonts, limited to this page's character set, then self-host WOFF."""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import re
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
sources = sorted([*DIST.glob('*.html'), *DIST.glob('*.js'), *(ROOT/'src').rglob('*.js')])
chars = ''.join(sorted(set(''.join(p.read_text() for p in sources) + ''.join(chr(i) for i in range(32,127)))))
params = [('family','Noto Sans SC:wght@400;500;600'),('family','Noto Serif SC:wght@400;600;700'),('display','swap'),('text',chars)]
url = 'https://fonts.googleapis.com/css2?' + urlencode(params)
def get(url):
    req = Request(url, headers={'User-Agent':'Mozilla/5.0'})
    with urlopen(req, timeout=35) as response:
        return response.read()
css = get(url).decode()
blocks = re.findall(r'@font-face\s*\{(.*?)\}', css, re.S)
def process(block):
    family = re.search(r"font-family:\s*'([^']+)'",block).group(1)
    weight = re.search(r'font-weight:\s*(\d+)',block).group(1)
    source = re.search(r'url\(([^)]+)\)',block).group(1)
    kind = 'serif' if 'Serif' in family else 'sans'
    name = f'lexi-{kind}-{weight}.woff'
    font = TTFont(BytesIO(get(source)))
    font.flavor='woff'
    font.save(DIST/'assets'/name)
    family_name = 'Lexi Serif' if kind=='serif' else 'Lexi Sans'
    return f"@font-face {{ font-family: '{family_name}'; font-style: normal; font-weight: {weight}; font-display: swap; src: url('assets/{name}') format('woff'); }}"
with ThreadPoolExecutor(max_workers=4) as pool:
    definitions = list(pool.map(process, blocks))
(DIST/'fonts.css').write_text('\n'.join(definitions)+'\n')
for folder,name in [('notosanssc','NotoSansSC-OFL.txt'),('notoserifsc','NotoSerifSC-OFL.txt')]:
    (DIST/'assets'/name).write_bytes(get(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{folder}/OFL.txt'))
print(f'Self-hosted {len(definitions)} WOFF fonts for {len(chars)} unique characters.')
for p in sorted((DIST/'assets').glob('*.woff')):
    print(p.name, p.stat().st_size)
