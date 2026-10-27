"""LexiVault editable SVG UI designs and deterministic PNG renders. No browser required."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from html import escape
from math import sin, cos, pi
from io import BytesIO
import os
ROOT=Path(__file__).parent
W,H,S=1600,1000,2
FONT=ROOT/'assets/NotoSansSC.ttf'
LIGHT=dict(bg='#F9F7F2',side='#EAE4DB',surface='#FFFDFA',sub='#F2EEE7',ink='#302D2E',muted='#8A817D',line='#DED7CC',accent='#744660',selected='#DFD1D8',soft='#F0E5EB',gold='#B49A70',sage='#6E846C',pale='#F0E5B9',shadow='#0000000A',paper='#FFFEFC')
DARK=dict(bg='#242320',side='#1E1E1B',surface='#2B2926',sub='#302D29',ink='#EEE8DD',muted='#B0A69C',line='#454039',accent='#C5A4BA',selected='#44323E',soft='#382D34',gold='#C5AE83',sage='#A0B599',pale='#655B32',shadow='#00000020',paper='#302E2A')
NAV=[('agent','科研智能体','chat'),('discover','文献发现','search'),('reader','文献阅读','book'),('plans','研究计划','note'),('graph','主题图谱','graph'),('knowledge','知识库管理','stack')]
FONT_CACHE={}
def font(n,weight=400):
 k=(n,weight)
 if k not in FONT_CACHE:
  f=ImageFont.truetype(str(FONT),int(n*S))
  try:f.set_variation_by_axes([weight])
  except Exception:pass
  FONT_CACHE[k]=f
 return FONT_CACHE[k]
class Canvas:
 def __init__(self,dark=False):
  self.c=DARK if dark else LIGHT;self.dark=dark;self.svg=[];self.im=Image.new('RGB',(W*S,H*S),self.c['bg']);self.draw=ImageDraw.Draw(self.im,'RGBA')
 def color(self,k):return self.c.get(k,k)
 def rect(self,x,y,w,h,fill='surface',r=0,stroke=None,sw=1):
  f=self.color(fill) if fill else None;st=self.color(stroke) if stroke else None
  self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{f or "none"}"'+(f' stroke="{st}" stroke-width="{sw}"' if st else '')+'/>')
  box=tuple(int(v*S) for v in (x,y,x+w,y+h))
  if r:self.draw.rounded_rectangle(box,r*S,fill=f,outline=st,width=sw*S)
  else:self.draw.rectangle(box,fill=f,outline=st,width=sw*S)
 def line(self,x,y,x2,y2,color='line',width=1):
  co=self.color(color);self.svg.append(f'<path d="M{x} {y}L{x2} {y2}" fill="none" stroke="{co}" stroke-width="{width}" stroke-linecap="round"/>');self.draw.line(tuple(v*S for v in (x,y,x2,y2)),fill=co,width=max(1,int(width*S)))
 def circle(self,x,y,r,fill='surface',stroke=None,sw=1):
  f=self.color(fill) if fill else None;st=self.color(stroke) if stroke else None
  self.svg.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{f or "none"}"'+(f' stroke="{st}" stroke-width="{sw}"' if st else '')+'/>');self.draw.ellipse(((x-r)*S,(y-r)*S,(x+r)*S,(y+r)*S),fill=f,outline=st,width=int(sw*S))
 def poly(self,pts,fill='accent',stroke=None,sw=1):
  f=self.color(fill) if fill else None;st=self.color(stroke) if stroke else None
  self.svg.append(f'<polygon points="'+ ' '.join(f'{x},{y}' for x,y in pts)+f'" fill="{f or "none"}"'+(f' stroke="{st}" stroke-width="{sw}"' if st else '')+'/>')
  self.draw.polygon([(x*S,y*S) for x,y in pts],fill=f)
  if st:self.draw.line([(x*S,y*S) for x,y in pts+[pts[0]]],fill=st,width=int(sw*S))
 def text(self,x,y,t,size=16,color='ink',weight=400):
  co=self.color(color);self.svg.append(f'<text x="{x}" y="{y}" font-family="Noto Sans SC, sans-serif" font-size="{size}" font-weight="{weight}" fill="{co}" dominant-baseline="text-before-edge">{escape(t)}</text>');self.draw.text((x*S,y*S),t,font=font(size,weight),fill=co,anchor='lt')
 def lines(self,x,y,ss,size=16,color='ink',leading=29,weight=400):
  for i,t in enumerate(ss):self.text(x,y+i*leading,t,size,color,weight)
 def pill(self,x,y,t,color='accent',bg='soft',size=12,pad=10,h=28):
  width=int(self.draw.textlength(t,font=font(size))/S)+pad*2;self.rect(x,y,width,h,bg,5);self.text(x+pad,y+(h-size)/2-1,t,size,color);return width
 def button(self,x,y,w,t,primary=False,icon=None,h=38):
  self.rect(x,y,w,h,'accent' if primary else 'surface',6,None if primary else 'line');col=('#241D22' if self.dark else '#FFF9F4') if primary else 'ink'
  if icon:self.icon(x+13,y+10,icon,col,18);self.text(x+39,y+10,t,14,col,500)
  else:
   tw=self.draw.textlength(t,font=font(14,500))/S;self.text(x+(w-tw)/2,y+10,t,14,col,500)
 def icon(self,x,y,kind,color='muted',n=20):
  s=n/24
  def l(a,b,c,d):self.line(x+a*s,y+b*s,x+c*s,y+d*s,color,1.4)
  def box(a,b,c,d,r=1):self.rect(x+a*s,y+b*s,c*s,d*s,None,r*s,color,1)
  if kind=='search':self.circle(x+10*s,y+10*s,6.4*s,None,color,1.4);l(15,15,21,21)
  elif kind=='chat':box(3,4,18,14,4);l(7,18,4,22);l(4,22,11,18)
  elif kind in ['note','file']:box(5,2,14,20,1);l(8,8,16,8);l(8,12,16,12);l(8,16,13,16)
  elif kind=='book':box(3,3,18,18,2);l(12,4,12,20);l(6,7,9,7);l(15,7,18,7)
  elif kind=='graph':
   for a,b in [(12,4),(4,19),(20,19)]:self.circle(x+a*s,y+b*s,2.7*s,None,color,1.4)
   l(11,7,5,16);l(13,7,19,16);l(7,19,17,19)
  elif kind=='stack':
   for yy in [4,10,16]:box(4,yy,16,4,1)
  elif kind=='folder':box(2,7,20,14,2);l(2,7,2,4);l(2,4,9,4);l(9,4,12,7)
  elif kind=='plus':l(4,12,20,12);l(12,4,12,20)
  elif kind=='sun':
   self.circle(x+12*s,y+12*s,4*s,None,color,1.4)
   for i in range(8):a=i*pi/4;l(12+cos(a)*7,12+sin(a)*7,12+cos(a)*10,12+sin(a)*10)
  elif kind=='check':l(5,12,10,17);l(10,17,20,6)
  elif kind=='download':l(12,2,12,16);l(7,11,12,16);l(12,16,17,11);l(3,17,3,22);l(3,22,21,22);l(21,22,21,17)
  elif kind=='link':l(8,14,16,6);l(6,10,3,13);l(3,13,3,18);l(3,18,8,21);l(8,21,13,17);l(11,7,15,3);l(15,3,21,6);l(21,6,21,11);l(21,11,17,14)
  elif kind=='chevron':l(7,10,12,15);l(12,15,17,10)
  elif kind=='arrow':l(4,12,20,12);l(14,6,20,12);l(20,12,14,18)
  elif kind=='gear':self.circle(x+12*s,y+12*s,8*s,None,color,1.4);self.circle(x+12*s,y+12*s,3*s,None,color,1.4)
  elif kind=='more':
   for xx in [5,12,19]:self.circle(x+xx*s,y+12*s,1.2*s,color)
  elif kind=='calendar':box(3,5,18,17,2);l(3,10,21,10);l(7,2,7,7);l(17,2,17,7)
  elif kind=='upload':l(12,18,12,3);l(7,8,12,3);l(12,3,17,8);l(3,17,3,22);l(3,22,21,22);l(21,22,21,17)
  elif kind=='filter':l(3,5,21,5);l(6,12,18,12);l(10,19,14,19)
 def logo(self,x,y,size=32):
  ss=size/44
  def cubic(p0,p1,p2,p3):
   pts=[]
   for i in range(1,25):
    t=i/24;u=1-t;pts.append(tuple(u*u*u*p0[j]+3*u*u*t*p1[j]+3*u*t*t*p2[j]+t*t*t*p3[j] for j in [0,1]))
   return pts
  pts=[(2,1),(11,1),(11,24.5)]+cubic((11,24.5),(11,28.3),(12.2,30.3),(16.9,32.9))+[(13.7,39),(6.3,35)]+cubic((6.3,35),(3,33.2),(2,30),(2,25.2))
  paths=[('M2 1h9v23.5c0 3.8 1.2 5.8 5.9 8.4l-3.2 6.1-7.4-4C3 33.2 2 30 2 25.2Z',pts,'accent'),('M25.2 18h11.2L23.3 42H12.1Z',[(25.2,18),(36.4,18),(23.3,42),(12.1,42)],'accent'),('m31.9 4-5.5 10h11.1L43 4Z',[(31.9,4),(26.4,14),(37.5,14),(43,4)],'gold')]
  for d,poly,fill in paths:
   self.svg.append(f'<path d="{d}" transform="translate({x} {y}) scale({ss})" fill="{self.color(fill)}"/>')
   self.draw.polygon([((x+a*ss)*S,(y+b*ss)*S) for a,b in poly],fill=self.color(fill))
 def save(self,name):
  s=f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><title>LexiVault · {name}</title><desc>示例 · 界面设计。所有标签与图形为可编辑矢量。</desc><style>@font-face{{font-family:"Noto Sans SC";src:url("assets/NotoSansSC.ttf")}}</style><rect width="1600" height="1000" fill="{self.c["bg"]}"/>'+''.join(self.svg)+'</svg>'
  (ROOT/f'{name}.svg').write_text(s)
  tmp=ROOT/f'.{name}.tmp.png';buffer=BytesIO();self.im.resize((W,H),Image.Resampling.LANCZOS).save(buffer,format='PNG')
  with tmp.open('wb') as out:out.write(buffer.getvalue());out.flush();os.fsync(out.fileno())
  tmp.replace(ROOT/f'{name}.png')

def shell(c,page,subtitle=None,rail=False):
 if rail:
  c.rect(0,0,64,H,'side');c.line(64,0,64,H);c.logo(17,19,30)
  for i,(key,label,ic) in enumerate(NAV):
   y=120+i*58
   if page==key:c.rect(10,y-7,44,44,'selected',8)
   c.icon(22,y+5,ic,'accent' if page==key else 'muted',20)
  c.icon(21,868,'sun');c.icon(21,920,'gear');c.circle(32,973,15,'accent');c.text(22,966,'YL',11,'surface')
  return
 c.rect(0,0,224,H,'side');c.line(224,0,224,H);c.logo(22,22,34);c.text(65,27,'LexiVault',22,'ink',600)
 c.rect(16,89,192,42,None,6,'line');c.icon(29,100,'folder',n=19);c.text(58,102,'分子图学习',14);c.icon(180,102,'chevron',n=15)
 c.text(26,161,'工作空间',11,'muted',500)
 for i,(key,label,ic) in enumerate(NAV):
  y=191+i*49
  if page==key:c.rect(14,y-3,196,42,'selected',6)
  c.icon(29,y+7,ic,'accent' if page==key else 'muted',20);c.text(63,y+8,label,15,'accent' if page==key else 'ink',500 if page==key else 400)
 c.line(24,508,200,508);c.text(26,534,'最近使用',11,'muted',500)
 for i,t in enumerate(['秋季科研推进计划','分子图表示学习','预训练方法阅读笔记']):
  c.icon(29,573+i*41,'file',n=16);c.text(56,575+i*41,t,13,'muted')
 c.line(24,844,200,844);c.icon(29,870,'gear',n=20);c.text(63,872,'设置',14);c.icon(29,913,'sun',n=20);c.text(63,915,'外观',14)
 c.rect(143,909,57,27,'sub',14);c.circle(184 if c.dark else 158,922,10,'surface', 'line')
 c.circle(40,971,18,'accent');c.text(28,963,'YL',12,('#221C20' if c.dark else '#FFF9F3'),500);c.text(69,953,'我的工作空间',12);c.circle(73,981,3,'sage');c.text(82,973,'本地优先',10,'muted')
 name=next(x[1] for x in NAV if x[0]==page)
 c.rect(224,0,1376,64,'bg');c.line(224,64,1600,64);c.text(252,23,name,15,'ink',500)
 if subtitle:c.text(350,24,'/   '+subtitle,13,'muted')
 c.text(1321,24,'示例 · 界面设计',12,'muted');c.circle(1487,31,4,'sage');c.text(1500,23,'本地模式',12,'muted')

def title(c,x,y,eyebrow,heading,desc):
 c.text(x,y,eyebrow,11,'gold',600);c.text(x,y+29,heading,31,'ink',600);c.text(x,y+80,desc,14,'muted')

def agent(c):
 shell(c,'agent','分子图表示学习');x=334
 title(c,x,107,'RESEARCH WITH EVIDENCE','让每个想法，都有据可循。','从你的文献出发，厘清证据，再形成可以检验的研究问题。')
 c.rect(x,226,268,35,None,6,'line');c.icon(x+13,235,'folder',n=17);c.text(x+41,236,'范围：分子图学习',13);c.icon(x+242,237,'chevron',n=14);c.text(x+288,237,'仅依据所选资料回答',12,'muted')
 c.rect(715,293,754,55,'sub',10);c.text(737,312,'比较这两篇论文的研究假设，并指出还需要核验的证据。',16)
 c.logo(x,382,32);c.text(x+52,379,'LexiVault',16,'accent',600)
 c.lines(x+52,418,['我会先区分论文中的明确主张、支持证据与尚未验证的假设，','再按相同维度进行比较。'],16,leading=30)
 tx=x+52;tw=1050;c.rect(tx,503,tw,191,None,7,'line');c.rect(tx+1,504,tw-2,43,'sub',6)
 for xx in [tx+174,tx+602]:c.line(xx,503,xx,694)
 for yy in [547,596,645]:c.line(tx,yy,tx+tw,yy)
 for xx,t in [(tx+20,'核对维度'),(tx+194,'论文 A'),(tx+622,'论文 B')]:c.text(xx,516,t,14,'ink',500)
 rows=[('研究问题','分子性质预测','图表示的表达能力'),('重点阅读','方法与实验设置  [1]','理论假设与消融实验  [2]'),('仍需核验','数据划分是否一致','结论适用的图结构')]
 for i,row in enumerate(rows):
  for xx,t in zip([tx+20,tx+194,tx+622],row):c.text(xx,565+i*49,t,14)
 c.rect(tx,716,1050,42,'sub',4);c.rect(tx,716,3,42,'sage');c.text(tx+17,730,'证据边界：当前材料不足以判断哪种方法在你的任务中更优。',13,'muted')
 c.pill(tx,776,'[1] Neural Message Passing…',size=12,bg='bg');c.pill(tx+259,776,'[2] How Powerful are Graph Neural Networks?',size=12,bg='bg')
 c.rect(x,842,1135,111,'surface',12,'line');c.pill(x+16,855,'文献 2 篇',size=11,bg='sub');c.text(x+17,900,'继续追问，或提出新的研究问题…',15,'muted');c.button(x+1004,898,111,'发送问题',True,h=37);c.text(x+471,969,'基于原文证据回答 · 重要结论请核验出处',11,'muted')

def discover(c):
 shell(c,'discover')
 title(c,274,106,'DISCOVER & COLLECT','先找到值得读的文献。','检索开放元数据和可获取全文；确认版权后，将资料加入你的知识库。')
 c.rect(274,226,1000,56,'surface',9,'line');c.icon(292,243,'search',n=22);c.text(331,245,'graph neural networks molecular pretraining',18);c.button(1288,226,262,'检索文献',True,'search',56)
 c.pill(274,304,'Semantic Scholar',size=12);c.pill(429,304,'Crossref',bg='sub',color='muted',size=12);c.pill(535,304,'arXiv',bg='sub',color='muted',size=12);c.text(1318,312,'去重依据：DOI / 标题',12,'muted')
 c.line(274,358,1550,358);c.text(274,388,'筛选',14,'ink',600);c.icon(435,386,'filter',n=18)
 c.text(274,438,'发表年份',12,'muted');c.rect(274,466,175,34,None,5,'line');c.text(287,477,'2021 — 2026',13);c.icon(424,477,'chevron',n=13)
 c.text(274,535,'资料类型',12,'muted')
 for i,(t,checked) in enumerate([('期刊与会议论文',True),('预印本',True),('开放获取全文',False)]):
  y=570+i*40;c.rect(274,y,14,14,'accent' if checked else None,3,None if checked else 'line')
  if checked:c.icon(274,y,'check',('#241D22' if c.dark else '#FFF9F3'),14)
  c.text(299,y,t,12)
 c.text(274,729,'入库位置',12,'muted');c.icon(274,763,'folder',n=18);c.text(301,765,'分子图学习 / 待阅读',12);c.text(274,810,'全文不可用时保留元数据，',11,'muted');c.text(274,833,'并提供来源页继续获取。',11,'muted')
 c.line(481,382,481,958);c.text(514,389,'检索结果',17,'ink',600);c.text(623,393,'示例结果 · 来源可追溯',12,'muted');c.text(1017,393,'相关度排序  ↓',12,'muted')
 results=[('Graph Contrastive Learning for Molecular Property Prediction','示例作者 · 2025 · 期刊论文','通过对比目标学习分子表示，关注数据划分、负样本和下游任务的关系。',['图对比学习','分子表示'],'开放获取'),('A Review of Molecular Graph Pre-training','示例作者 · 2024 · 综述论文','系统梳理预训练任务和评估协议，为初学者搭建阅读路线。',['分子预训练','综述'],'元数据'),('Self-Supervised Graph Representation Learning','示例作者 · 2023 · 会议论文','比较图级与节点级自监督目标，并讨论表示迁移的适用条件。',['自监督学习','表示学习'],'开放获取')]
 for i,(tt,meta,abs,tags,status) in enumerate(results):
  yy=444+i*160;c.text(514,yy,tt,17,'ink',500);c.text(514,yy+33,meta,11,'muted');c.lines(514,yy+61,[abs[:35],abs[35:]],13,'muted',leading=23)
  xx=514
  for tag in tags:xx+=c.pill(xx,yy+111,tag,size=10,bg='sub',color='muted',h=22)+7
  c.text(1057,yy+34,status,10,'sage');c.icon(1131,yy+71,'plus','accent',20);c.line(514,yy+151,1160,yy+151)
 c.rect(1198,380,352,578,'sub',9);c.text(1221,405,'获取队列',16,'ink',600);c.pill(1440,402,'待确认',size=10,h=24);c.text(1221,442,'确认目标文件夹后开始获取。',12,'muted')
 for i,(t,s) in enumerate([('Molecular Graph Pre-training…','等待获取 · 元数据 + 全文'),('Contrastive Molecular Learning…','等待获取 · 开放获取全文')]):
  yy=497+i*108;c.icon(1221,yy,'file',n=19);c.text(1253,yy,t,12,'ink',500);c.text(1253,yy+31,s,11,'muted');c.line(1221,yy+77,1527,yy+77)
 c.text(1221,815,'遵循来源接口、许可和访问频率。',11,'muted');c.button(1221,870,306,'确认获取到知识库',True,'download',42)

def reader(c):
 shell(c,'reader',rail=True);c.rect(64,0,256,H,'side');c.line(320,0,320,H);c.text(85,25,'文献阅读',18,'ink',600);c.icon(276,25,'more',n=20)
 c.rect(81,79,222,35,'bg',6,'line');c.icon(93,89,'search',n=16);c.text(121,91,'查找文献或文件夹',11,'muted')
 c.icon(84,148,'folder',n=18);c.text(111,151,'分子图学习',13,'ink',600);c.icon(278,151,'chevron',n=14)
 folders=[(186,'01  入门综述',False),(235,'02  图神经网络',True),(481,'03  分子预训练',False),(530,'04  实验与复现',False)]
 for y,t,open_ in folders:
  c.icon(100,y,'folder','accent' if open_ else 'muted',17);c.text(127,y+2,t,12);c.icon(276,y+2,'chevron',n=13)
 docs=['Neural Message Passing…','How Powerful are GNNs?','Graph Representation…','阅读路线.md']
 for i,t in enumerate(docs):
  yy=282+i*43
  if i==0:c.rect(80,yy-7,222,35,'selected',5)
  c.icon(120,yy,'file','accent' if i==0 else 'muted',16);c.text(145,yy+1,t,10,'accent' if i==0 else 'muted')
 c.line(82,874,300,874);c.text(84,902,'当前位置',10,'muted');c.text(84,928,'本地文献库 / 02  图神经网络',10);c.text(84,967,'示例 · 界面设计',10,'muted')
 c.rect(320,0,900,64,'bg');c.line(320,64,1600,64);c.text(344,24,'Neural Message Passing for Quantum Chemistry',14,'ink',500);c.text(1012,25,'原文 PDF',11,'muted');c.icon(1166,23,'more',n=20)
 c.rect(320,64,900,54,'sub');c.text(344,84,'‹    1 / 12    ›',12);c.text(672,84,'100%',12);c.icon(721,84,'chevron',n=13);c.text(1056,84,'适合宽度',12,'muted')
 c.rect(320,118,900,882,'sub');c.rect(359,149,824,1050,'shadow',2);c.rect(355,145,824,1050,'paper',1)
 c.text(430,192,'Neural Message Passing',31,'ink',600);c.text(430,240,'for Quantum Chemistry',31,'ink',600);c.text(430,306,'示例文献排版 · 此处为 PDF 原文视图',11,'muted');c.line(430,347,1104,347)
 c.text(430,376,'Abstract',19,'ink',600)
 paras=['Message passing provides a common framework for learning','representations of molecular graphs. In this reading example,','we examine the relation between model assumptions and','experimental evidence, then identify what still needs validation.']
 c.lines(430,418,paras[:3],14,'ink',leading=27);c.rect(428,499,628,24,'pale',2);c.text(430,499,'experimental evidence, then identify what still needs validation.',14)
 c.text(430,584,'1. Introduction',22,'ink',600)
 for col in [430,786]:
  c.lines(col,634,['Molecular representations allow','researchers to connect structures','with measured properties. The','choice of evaluation protocol is','part of the scientific question.','', 'Read the original argument and','record its assumptions before','drawing a conclusion from it.'],13,'ink',leading=25)
 c.text(744,953,'1',11,'muted');c.line(1220,0,1220,H)
 c.rect(1221,0,379,H,'surface');c.text(1245,24,'阅读笔记',15,'ink',600);c.icon(1554,23,'more',n=20);c.text(1245,83,'关联当前文献',11,'muted');c.pill(1245,110,'Neural Message Passing…',size=10,bg='sub',color='muted',h=26)
 c.line(1245,161,1576,161);c.text(1245,184,'正文',12,'muted');c.icon(1282,184,'chevron',n=13);c.text(1344,181,'B    I    U    ≡    ↗',16,'muted');c.line(1245,217,1576,217)
 c.text(1245,251,'写下此刻的想法…',19,'muted');c.lines(1245,293,['选中原文可以摘录并保留页码。','输入 [[ 链接笔记或研究计划。'],12,'muted',leading=27)
 c.rect(1245,405,3,126,'accent');c.lines(1262,409,['“experimental evidence …','needs validation.”'],14,'ink',leading=28);c.text(1262,479,'原文摘录 · 第 1 页',11,'accent');c.text(1245,574,'我的思考',16,'ink',500);c.lines(1245,611,['这项研究依赖怎样的数据划分？','需要与 [[秋季科研推进计划]]','中的复现实验核对。'],13,'muted',leading=29)
 c.pill(1245,742,'+ 添加到研究计划',size=11,bg='soft');c.line(1245,927,1576,927);c.circle(1250,958,3,'sage');c.text(1262,949,'自动保存到当前知识库',10,'muted')

def plans(c):
 shell(c,'plans','秋季科研推进计划');c.rect(224,64,240,936,'sub');c.line(464,64,464,H)
 c.text(244,91,'我的计划',16,'ink',600);c.icon(422,89,'plus','accent',20)
 c.rect(240,139,208,35,'bg',6,'line');c.icon(252,149,'search',n=15);c.text(277,151,'查找文档',11,'muted')
 c.text(244,206,'进行中',10,'muted',500)
 for i,(t,sub) in enumerate([('秋季科研推进计划','10月15日 — 11月30日'),('分子图学习阅读路线','阅读与复现'),('组会准备 · 第三周','资料与提纲')]):
  yy=238+i*91
  if i==0:c.rect(236,yy-7,216,77,'selected',6)
  c.icon(249,yy+5,'note','accent' if i==0 else 'muted',17);c.text(277,yy+7,t,12,'accent' if i==0 else 'ink',500);c.text(277,yy+35,sub,10,'muted')
 c.text(244,564,'已归档',10,'muted');c.icon(248,599,'folder',n=16);c.text(275,602,'入学准备与方向探索',11,'muted')
 c.line(242,849,446,849);c.icon(248,875,'upload',n=17);c.text(277,878,'导入文档 / 任意附件',11);c.lines(246,920,['支持编辑的格式会转换为文档；','其它文件保留原件供下载。'],10,'muted',leading=20)
 c.rect(464,64,1136,53,'bg');c.text(490,85,'文档',13,'accent',500);c.text(561,85,'日程',13,'muted');c.text(631,85,'关联图',13,'muted');c.line(486,115,522,115,'accent',2)
 c.text(1090,85,'已保存到本机',11,'muted');c.icon(1233,82,'download',n=19);c.icon(1281,83,'more',n=20);c.line(464,117,1600,117)
 c.rect(464,117,876,62,'surface');c.text(490,139,'正文',12);c.icon(526,138,'chevron',n=13);c.line(567,133,567,163);c.text(584,139,'16',12);c.icon(611,138,'chevron',n=13);c.line(647,133,647,163);c.text(666,136,'B',19,'ink',600);c.text(705,138,'I',18);c.text(742,138,'U',17);c.rect(778,137,21,23,'pale',3);c.text(783,139,'A',14);c.text(822,138,'A',17,'accent',500);c.line(820,161,837,161,'accent',2)
 c.icon(867,139,'link','accent',18);c.rect(914,140,16,16,None,2,'muted');c.icon(914,140,'check',n=16);c.text(954,138,'≡',20);c.text(1010,141,'H1',15);c.icon(1060,139,'upload',n=18);c.text(1110,140,'撤销',12,'muted');c.line(464,179,1600,179)
 c.rect(464,179,876,821,'bg');x=528
 c.text(x,226,'秋季科研推进计划',31,'ink',600);c.text(x,279,'把方向探索、文献阅读和复现实验，连成一条清晰的研究路径。',13,'muted')
 c.pill(x,319,'进行中',size=10,h=25);c.icon(x+95,323,'calendar',n=17);c.text(x+119,327,'2026.10.15 — 11.30',11,'muted');c.pill(x+320,319,'分子图学习',size=10,bg='sub',color='muted',h=25)
 c.line(x,373,1276,373);c.text(x,405,'一、这个阶段要回答的问题',21,'ink',600)
 c.lines(x,450,['分子预训练在什么条件下能够改善小样本性质预测？先建立共同的评估','协议，再比较方法；优先记录假设、数据划分与证据边界。'],14,leading=28)
 c.rect(x,530,426,26,'pale',3);c.text(x+5,534,'本周重点：厘清数据划分，完成一篇论文复现。',14,'ink',500)
 c.text(x,595,'二、本周行动',21,'ink',600)
 tasks=[('整理分子图学习的入门综述',True),('精读两篇核心文献并记录证据',False),('核对复现实验的数据划分和评价指标',False)]
 for i,(t,ch) in enumerate(tasks):
  yy=641+i*42;c.rect(x+1,yy+1,16,16,'accent' if ch else None,3,None if ch else 'line')
  if ch:c.icon(x+1,yy+1,'check',('#241D22' if c.dark else '#FFF9F3'),16)
  c.text(x+31,yy+1,t,14,'muted' if ch else 'ink')
 c.text(x,796,'关联阅读',17,'ink',600);c.pill(x,832,'[[ 分子图学习阅读路线 ]]',size=12);c.pill(x+236,832,'[[ 预训练方法阅读笔记 ]]',size=12)
 c.rect(x,899,748,57,'sub',6,'line');c.icon(x+14,915,'file',n=20);c.text(x+46,911,'实验记录模板.docx',12,'ink',500);c.text(x+46,932,'原始附件 · 点击可下载',10,'muted');c.icon(x+711,918,'download',n=17)
 c.rect(1340,179,260,821,'surface');c.line(1340,179,1340,H);c.text(1362,207,'文档信息',13,'ink',600);c.icon(1555,207,'more',n=17);c.text(1362,255,'最近编辑',10,'muted');c.text(1362,278,'今天 · 保存在此浏览器',11);c.text(1362,326,'标签',10,'muted');c.pill(1362,350,'阅读',size=10,bg='sub',color='muted',h=23);c.pill(1422,350,'实验',size=10,bg='sub',color='muted',h=23)
 c.line(1362,407,1578,407);c.text(1362,435,'双向链接',14,'ink',600);c.text(1362,472,'引用了这篇计划',10,'muted')
 for i,(tt,ss) in enumerate([('预训练方法阅读笔记','“纳入秋季计划的复现部分”'),('组会准备 · 第三周','“汇报本阶段的研究进度”')]):
  yy=508+i*97;c.icon(1362,yy,'note','accent',17);c.text(1390,yy+2,tt,11);c.text(1362,yy+34,ss,10,'muted');c.text(1362,yy+57,'查看关联段落 →',10,'accent')
 c.line(1362,723,1578,723);c.text(1362,748,'使用 [[文档名称]] 建立链接。',10,'muted');c.lines(1362,779,['在关联图中查看计划、阅读笔记','和研究主题之间的联系。'],10,'muted',leading=23)

def graph(c):
 shell(c,'graph')
 c.rect(224,64,270,936,'surface');c.line(494,64,494,H);c.text(249,96,'主题与范围',17,'ink',600)
 c.text(249,148,'选择核心关键词',11,'muted');c.pill(249,182,'分子预训练  ×',size=11);c.pill(249,221,'对比学习  ×',size=11);c.rect(249,264,220,35,'bg',5,'line');c.text(262,276,'+ 添加关键词',12,'muted')
 c.text(249,339,'文献范围',11,'muted')
 for i,t in enumerate(['分子图学习','图表示研究','待阅读 / 2026']):
  yy=377+i*40;c.rect(249,yy,14,14,'accent',3);c.icon(249,yy,'check',('#241D22' if c.dark else '#FFF9F3'),14);c.icon(275,yy-1,'folder',n=17);c.text(301,yy+1,t,12)
 c.text(249,536,'图谱显示',11,'muted')
 for i,(tt,status) in enumerate([('关键词节点',True),('文献节点',True),('标注关系类型',False)]):
  yy=576+i*41;c.text(249,yy,tt,12);c.rect(429,yy-3,35,20,'selected' if status else 'sub',10);c.circle(454 if status else 439,yy+7,7,'accent' if status else 'muted')
 c.line(249,738,470,738);c.text(249,769,'图谱关系',12,'ink',500)
 for i,(col,tt) in enumerate([('accent','核心关键词'),('gold','其它关键词'),('sage','论文 · 摘要关键词匹配')]):
  yy=813+i*36;c.circle(254,yy+6,4,col);c.text(271,yy,tt,10,'muted')
 c.text(531,99,'沿着主题，找到下一篇文献。',25,'ink',600);c.text(531,145,'关键词连接摘要与文献；相同主题自然聚合，原文证据始终可回溯。',12,'muted');c.button(1322,94,227,'选中节点 · 加入阅读',False,'book',38)
 c.rect(518,197,1044,755,'bg',9,'line');c.text(542,219,'主题图谱',11,'muted');c.text(1371,219,'示例 · 布局设计',10,'muted')
 nodes=[(1005,552,48,'分子预训练','accent'),(713,410,25,'对比学习','gold'),(1254,398,24,'分子表示','gold'),(751,727,24,'评估协议','gold'),(1225,749,26,'迁移学习','gold')]
 papers=[(676,278,'P1'),(913,293,'P2'),(1109,292,'P3'),(1435,350,'P4'),(1423,589,'P5'),(1371,852,'P6'),(1016,865,'P7'),(585,600,'P8'),(615,842,'P9'),(939,721,'P10'),(1160,632,'P11'),(859,522,'P12')]
 edges=[(0,0),(0,1),(0,2),(0,4),(0,5),(0,6),(0,9),(0,10),(0,11),(1,0),(1,1),(1,7),(1,11),(1,9),(2,2),(2,3),(2,4),(2,10),(3,7),(3,8),(3,6),(3,9),(4,4),(4,5),(4,6),(4,10)]
 for ni,pi_ in edges:
  a,b=nodes[ni],papers[pi_];c.line(a[0],a[1],b[0],b[1],('selected' if ni==0 else 'line'),1.3)
 for i,(x,y,rr,tt,col) in enumerate(nodes):
  if i==0:c.circle(x,y,73,'soft');c.circle(x,y,59,None,'selected',1)
  c.circle(x,y,rr,'accent' if i==0 else 'surface',None if i==0 else col,1.5)
  if i==0:c.text(x-36,y-8,tt,12,('#241D22' if c.dark else '#FFF9F3'),600)
  else:c.text(x-len(tt)*6,y+38,tt,12,col,500)
 for i,(x,y,tt) in enumerate(papers):
  c.circle(x,y,12,'surface','sage',1.5);c.icon(x-6,y-7,'file','sage',12);c.text(x-30,y+25,tt+' · 论文',10,'muted')
 c.rect(1127,801,408,125,'surface',7,'line');c.icon(1148,819,'file','accent',17);c.text(1178,821,'P6 · Molecular Graph Pre-training…',12,'ink',500);c.text(1148,853,'关键词：分子预训练 · 迁移学习',11,'muted');c.text(1148,884,'打开摘要与来源  →',11,'accent');c.text(542,917,'拖拽平移 · 滚轮缩放 · 点击节点查看关联文献',10,'muted');c.rect(1495,454,42,97,'surface',6,'line');c.text(1510,467,'+',23);c.line(1503,501,1529,501);c.text(1511,511,'−',23)

def knowledge(c):
 shell(c,'knowledge')
 title(c,274,108,'YOUR RESEARCH FOUNDATION','让资料成为可追溯的知识。','在本地文件、解析结果和检索索引之间建立清晰对应；每一步都可以检查与重建。')
 c.button(1260,126,137,'添加文件夹',True,'folder',40);c.button(1410,126,140,'导入文件',False,'upload',40)
 c.text(274,238,'资料来源',14,'accent',500);c.text(381,238,'处理队列',14,'muted');c.text(490,238,'索引设置',14,'muted');c.line(274,272,1550,272);c.line(270,271,337,271,'accent',2)
 c.rect(274,305,1276,53,'sub',6,'line');c.icon(290,320,'folder','accent',21);c.text(324,324,'分子图学习',15,'ink',500);c.text(1044,325,'本地文件夹 · 手动同步',12,'muted');c.text(1390,325,'重新扫描',12,'accent')
 c.text(293,392,'来源 / 文档',11,'muted');c.text(820,392,'解析与摘要',11,'muted');c.text(1056,392,'检索索引',11,'muted');c.text(1288,392,'更新方式',11,'muted');c.line(274,423,1550,423)
 rows=[('01  入门综述','文件夹 · 可展开','摘要待生成','未建立','手动同步'),('02  图神经网络','文件夹 · 已选择','文本已解析','可检索','手动同步'),('Neural Message Passing…','PDF · 12 页 · 本地原文','文本已解析','可检索','随原文件更新'),('How Powerful are Graph Neural Networks?','PDF · 元数据已确认','摘要待核验','等待确认','随原文件更新'),('03  分子预训练','文件夹 · 可展开','等待处理','未建立','手动同步')]
 for i,(tt,meta,a,b,d) in enumerate(rows):
  yy=451+i*85;is_doc=i in [2,3];xx=316 if is_doc else 292
  if i==1:c.rect(274,yy-13,1276,80,'soft',3)
  c.icon(xx,yy,'file' if is_doc else 'folder','accent' if i==1 else 'muted',20);c.text(xx+34,yy+1,tt,14,'ink',500);c.text(xx+34,yy+31,meta,10,'muted');c.text(820,yy+11,a,12,'sage' if a=='文本已解析' else 'muted');c.text(1056,yy+11,b,12,'sage' if b=='可检索' else 'muted');c.text(1288,yy+11,d,11,'muted');c.icon(1506,yy+10,'more',n=18);c.line(274,yy+66,1550,yy+66)
 c.rect(274,897,1276,62,'surface',6,'line');c.circle(297,927,4,'gold');c.text(314,913,'索引服务尚未连接',12,'ink',500);c.text(314,936,'连接解析与检索服务后，文件才会进入可引用的知识库；原始文件始终保留。',11,'muted');c.text(1392,923,'查看配置  →',12,'accent')

def main():
 ROOT.mkdir(exist_ok=True,parents=True)
 pages=[('01-agent',agent),('02-discover',discover),('03-reader',reader),('04-plans',plans),('05-graph',graph),('06-knowledge',knowledge)]
 import sys
 modes=['light'] if '--light-only' in sys.argv else ['light','dark']
 for mode in modes:
  for name,fn in pages:
   c=Canvas(mode=='dark');fn(c);c.save(f'{name}-{mode}');print(f'{name}-{mode}',flush=True)
 sheet=Image.new('RGB',(1680,2376),'#DED7CC')
 for i,(name,_) in enumerate(pages):
  for j,mode in enumerate(['light','dark']):
   p=ROOT/f'{name}-{mode}.png'
   if not p.exists():continue
   im=Image.open(p);im=im.resize((624,390),Image.Resampling.LANCZOS);xx=28+j*824;yy=28+i*390;sheet.paste(im,(xx+85,yy))
 buffer=BytesIO();sheet.save(buffer,format='PNG');tmp=ROOT/'.contact-sheet.tmp.png'
 with tmp.open('wb') as out:out.write(buffer.getvalue());out.flush();os.fsync(out.fileno())
 tmp.replace(ROOT/'contact-sheet.png')
if __name__=='__main__':main()
