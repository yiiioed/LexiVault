"""Check both page entry points without starting a browser or preview server."""
from pathlib import Path
from html.parser import HTMLParser
import re
import json
from urllib.parse import urlsplit, unquote

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
class Check(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids=set(); self.references=[]; self.resources=[]; self.labels=[]; self.inputs=[]; self.links=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id' in a:
            assert a['id'] not in self.ids, f"duplicate id {a['id']}"
            self.ids.add(a['id'])
        for key in ('aria-controls','aria-describedby','aria-labelledby'):
            self.references.extend(a.get(key,'').split())
        if tag=='label' and 'for' in a: self.labels.append(a['for'])
        if (tag=='input' and a.get('type') not in ('file','checkbox')) or tag=='textarea': self.inputs.append(a)
        if tag in ('script','img') and a.get('src'): self.resources.append(a['src'])
        if tag=='link' and a.get('href'): self.resources.append(a['href'])
        if tag=='a' and a.get('href') and not a['href'].startswith('#'): self.links.append(a['href'])
        if tag=='use' and a.get('href','').startswith('#'): self.references.append(a['href'][1:])
for html in sorted(DIST.glob('*.html')):
    parser=Check(); parser.feed(html.read_text(encoding='utf-8'))
    for ref in parser.references+parser.labels: assert ref in parser.ids, f'{html.name}: missing ID {ref}'
    for src in parser.resources:
        assert not src.startswith(('http:','https:')),f'external runtime resource {src}'
        assert (DIST/unquote(urlsplit(src).path)).is_file(),f'missing resource {src}'
    for src in parser.links:
        if not src.startswith(('http:','https:','mailto:')): assert (DIST/unquote(urlsplit(src).path)).exists(),f'broken page link {src}'
    for field in parser.inputs: assert field.get('id') in parser.labels, f"unlabelled input {field.get('id')}"
    print(f'PASS {html.name}: {len(parser.ids)} IDs; labels, ARIA targets and {len(parser.resources)} resources resolve.')
for css_file in sorted(DIST.glob('*.css')):
    css=css_file.read_text(encoding='utf-8')
    assert css.count('{')==css.count('}'),f'unbalanced CSS {css_file.name}'
    for src in re.findall(r'url\([\"\']?([^\)\"\']+)',css):
        if not src.startswith(('data:','#','%23')): assert (DIST/src).is_file(),f'missing CSS asset {src}'
for js in [DIST/'app.js',DIST/'workspace.js']:
    script=js.read_text(encoding='utf-8')
    assert not re.search(r'(?:setItem|storage\.set)\(\s*[\"\'](?:password|token)',script)
    assert 'fetch(' not in script,'unconfigured external request'
hosting=ROOT/'.openai/hosting.json'
if hosting.exists():
    manifest=json.loads(hosting.read_text(encoding='utf-8'))
    assert manifest['static']['directory']=='dist'
print('PASS: self-hosted fonts and art; no external runtime network or credential persistence.')
