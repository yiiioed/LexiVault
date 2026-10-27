"""Markdown is authoritative. SQLite indexes plans; rich editor JSON is a hash-bound cache."""
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .storage import StoreError, atomic_write, digest, within

MAX_TEXT = 8 * 1024 * 1024
ID = re.compile(r'^[\w-]{1,160}$', re.ASCII)
HEADER = re.compile(r'\A\ufeff?---\r?\n([\s\S]{0,16384}?)\r?\n---(?:\r?\n|$)')


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')


def validate_id(value):
    if not isinstance(value,str) or not ID.fullmatch(value):
        raise StoreError('计划或附件标识无效。',422)
    return value


def read_bytes(path, limit=MAX_TEXT):
    if path.stat().st_size > limit:
        raise StoreError('计划文件过大，请在外部编辑器整理后重试。',413)
    with path.open('rb') as handle:
        data=handle.read(limit+1)
    if len(data)>limit:
        raise StoreError('计划文件过大，请在外部编辑器整理后重试。',413)
    return data


def split_markdown(data):
    try:
        text=data.decode('utf-8-sig')
    except UnicodeError:
        raise StoreError('计划文件不是 UTF-8 编码，原文件已保留。',422)
    match=HEADER.match(text)
    marker=None
    if match:
        markers=re.findall(r'^lexivault_plan:\s*(.*?)\s*$',match.group(1),re.M)
        if len(markers)>1:
            raise StoreError('身份字段重复，请先整理本地文件。',422)
        if markers:
            marker=validate_id(markers[0].strip("\"'"))
    body=text[match.end():] if match else text
    title=re.match(r'\A\s*# ([^\r\n]+)\r?\n',body)
    return marker, title.group(1).strip()[:160] if title else None, body[title.end():].lstrip('\r\n') if title else body


def base_plan(identity, title):
    stamp=now()
    return dict(id=identity,title=title[:160],summary='',status='draft',startDate='',dueDate='',folder='我的研究',tags=[],attachmentIds=[],createdAt=stamp,updatedAt=stamp,deletedAt=None,sample=False)


def validate_plan(plan):
    if not isinstance(plan,dict):
        raise StoreError('计划格式无效。',422)
    validate_id(plan.get('id'))
    for key,limit in [('title',160),('summary',1000),('folder',160)]:
        if not isinstance(plan.get(key),str) or len(plan[key])>limit:
            raise StoreError('计划信息无效。',422)
    if not plan['title'].strip() or '\n' in plan['title'] or '\r' in plan['title'] or plan.get('status') not in {'draft','active','done','archived'}:
        raise StoreError('计划标题或状态无效。',422)
    if not isinstance(plan.get('tags'),list) or len(plan['tags'])>20 or any(not isinstance(t,str) or len(t)>30 for t in plan['tags']):
        raise StoreError('标签无效。',422)
    for key in ('createdAt','updatedAt','startDate','dueDate','deletedAt'):
        value=plan.get(key)
        if key in {'startDate','dueDate'} and value=='':
            continue
        if key=='deletedAt' and value is None:
            continue
        try:
            datetime.fromisoformat(value.replace('Z','+00:00'))
        except (ValueError,TypeError,AttributeError):
            raise StoreError('计划日期无效。',422)
    attachments=plan.get('attachmentIds')
    if not isinstance(attachments,list) or len(attachments)>1000 or any(not isinstance(v,str) for v in attachments) or len(set(attachments))!=len(attachments):
        raise StoreError('计划附件列表无效。',422)
    for item in attachments:
        validate_id(item)
    count=0
    def walk(node,depth=0):
        nonlocal count
        count+=1
        if not isinstance(node,dict) or depth>32 or count>50000 or not isinstance(node.get('type'),str):
            raise StoreError('正文结构过大或无效。',422)
        if 'text' in node and not isinstance(node['text'],str):
            raise StoreError('正文文本无效。',422)
        children=node.get('content',[])
        if not isinstance(children,list):
            raise StoreError('正文结构无效。',422)
        for child in children:
            walk(child,depth+1)
    walk(plan.get('doc'))
    if plan['doc'].get('type')!='doc':
        raise StoreError('正文格式无效。',422)


class PlanStore:
    def __init__(self,workspace):
        self.workspace=workspace
        self.root=workspace.root
        self.lock=workspace.lock
        for folder in ('.lexivault/plan-docs','.lexivault/history/plans'):
            within(self.root,folder).mkdir(parents=True,exist_ok=True)

    def cache_path(self,identity):
        return within(self.root,f'.lexivault/plan-docs/{validate_id(identity)}.json')

    def snapshot(self,identity,data):
        path=within(self.root,f'.lexivault/history/plans/{validate_id(identity)}/{digest(data)}.md')
        if not path.exists():
            atomic_write(path,data)

    def scan(self):
        """Recognize moved files by frontmatter, preserve deleted/error records, never rewrite user MD."""
        with self.lock,self.workspace.db() as db:
            db.execute('BEGIN IMMEDIATE')
            rows={r['id']:dict(r) for r in db.execute('SELECT * FROM plans')}
            paths={r['rel_path']:r['id'] for r in rows.values()}
            note_rows=[dict(r) for r in db.execute('SELECT id,document_id,rel_path FROM notes')]
            note_paths={r['rel_path']:r['id'] for r in note_rows};note_docs={r['document_id']:r['id'] for r in note_rows}
            found={}; errors={}; discovered=[]
            from .vault import visible_paths
            candidates=[p for p in visible_paths(self.root) if p.is_file() and p.suffix.lower()=='.md']
            candidates += [within(self.root,r['rel_path']) for r in rows.values() if r['rel_path'].startswith('.lexivault/trash/') and within(self.root,r['rel_path']).is_file()]
            for path in candidates:
                relative=str(path.relative_to(self.root)).replace('\\','/')
                try:
                    safe=within(self.root,relative)
                    data=read_bytes(safe)
                    identity,title,body=split_markdown(data)
                    if identity and relative in paths and identity!=paths[relative]:
                        errors[paths[relative]]='本地文件的身份字段已改变，请恢复原标识或移走冲突文件。'
                        if identity in rows:errors[identity]='有其他文件使用了此计划的身份，请先整理。'
                        continue
                    match=HEADER.match(data.decode('utf-8-sig'));linked=re.search(r'^lexivault_document: ([\w-]+)$',match.group(1),re.M) if match else None
                    identity=identity or paths.get(relative) or note_paths.get(relative) or (note_docs.get(linked.group(1)) if linked else None)
                    if not identity:
                        matches=[r['id'] for r in rows.values() if r['content_hash']==digest(data) and not within(self.root,r['rel_path']).is_file()]
                        identity=matches[0] if len(matches)==1 else uuid.uuid5(uuid.NAMESPACE_URL,self.workspace.id+':plan:'+relative).hex
                    if identity in found:
                        errors[identity]='发现多份相同身份的计划文件，请先整理副本。'
                        continue
                    found[identity]=(relative,data,title or path.stem,body)
                except (OSError,StoreError) as error:
                    if relative in paths:
                        errors[paths[relative]]=str(error)
                    else:
                        discovered.append({'path':relative,'message':str(error)})
            for identity,(relative,data,title,body) in found.items():
                if identity in errors:
                    continue
                old=rows.get(identity)
                meta=json.loads(old['metadata_json']) if old else base_plan(identity,title)
                sha=digest(data)
                changed=not old or old['content_hash']!=sha or old['missing'] or old['rel_path']!=relative
                if not changed:
                    continue
                meta['title']=title
                meta['updatedAt']=now()
                revision=old['revision']+1 if old else 1
                self.snapshot(identity,data)
                db.execute('UPDATE notes SET rel_path=? WHERE id=?',(relative,identity))
                db.execute('INSERT INTO plans VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,rel_path=excluded.rel_path,content_hash=excluded.content_hash,revision=excluded.revision,missing=0',
                           (identity,json.dumps(meta,ensure_ascii=False),relative,sha,revision))
            for identity,old in rows.items():
                if identity not in found and identity not in errors and not old['missing']:
                    db.execute('UPDATE plans SET missing=1,revision=revision+1 WHERE id=?',(identity,))
            self.errors=errors
            self.discovered_errors=discovered

    def all(self):
        from .recycle import active_deleted_paths,is_recycled
        self.scan()
        deleted=active_deleted_paths(self.workspace)
        result=[]
        with self.workspace.db() as db:
            rows=[dict(r) for r in db.execute('SELECT * FROM plans')]
        for row in rows:
            if row['missing'] and is_recycled(row['rel_path'],deleted):continue
            p=json.loads(row['metadata_json'])
            p.update(revision=row['revision'],relative_path=row['rel_path'],local_path=str(within(self.root,row['rel_path'])),missing=bool(row['missing']),external_error=self.errors.get(row['id'],''))
            cache={}
            try:
                cache=json.loads(self.cache_path(row['id']).read_text(encoding='utf-8'))
            except (OSError,ValueError):
                pass
            p['doc']=cache.get('doc',{'type':'doc','content':[{'type':'paragraph'}]})
            if not p['missing'] and not p['external_error'] and cache.get('content_hash')!=row['content_hash']:
                try:
                    data=read_bytes(within(self.root,row['rel_path']))
                    _,_,p['external_markdown']=split_markdown(data)
                    # Recheck on a later scan if another editor changed the file mid-read.
                    if digest(data)!=row['content_hash']:
                        p['external_error']='文件仍在被外部程序修改，请稍后重载。'
                        p.pop('external_markdown',None)
                except (OSError,StoreError) as error:
                    p['external_error']=str(error)
            result.append(p)
        return sorted(result,key=lambda p:p['updatedAt'],reverse=True)

    def filename(self,plan,old=None):
        from .vault import unique_path,user_path
        if old:
            previous=json.loads(old['metadata_json'])
            if bool(previous.get('deletedAt'))==bool(plan.get('deletedAt')):return old['rel_path']
            if plan.get('deletedAt'):return '.lexivault/trash/plans/'+plan['id']+'/'+Path(old['rel_path']).name
            return previous.get('_trash_original') or Path(old['rel_path']).name
        title=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',plan['title']).strip(' .')[:100] or '未命名文档'
        if plan.get('target_path'):
            path=user_path(self.root,plan['target_path'])
            if path.suffix.lower()!='.md' or not path.parent.is_dir():raise StoreError('请选择已有文件夹内的 Markdown 路径。',422)
            return path.relative_to(self.root).as_posix()
        path=unique_path(self.root,plan.get('directory',''),title+'.md')
        return path.relative_to(self.root).as_posix()

    def save_batch(self,entries,files,only_new=False):
        if not 1<=len(entries)<=2000:
            raise StoreError('计划批次无效。',422)
        total=0
        for entry in entries:
            validate_plan(entry['plan'])
            if not isinstance(entry.get('expected_revision'),int) or entry['expected_revision']<0 or not isinstance(entry.get('markdown'),str):
                raise StoreError('保存版本或正文无效。',422)
            total+=len(entry['markdown'].encode())
            if len(entry['markdown'].encode())>MAX_TEXT:
                raise StoreError('计划正文过大。',413)
        if len({entry['plan']['id'] for entry in entries})!=len(entries):
            raise StoreError('计划身份重复。',422)
        if total>100*1024*1024:
            raise StoreError('批次正文超过 100 MiB。',413)
        file_ids=set()
        for meta,data in files:
            validate_id(meta.get('id')); validate_id(meta.get('planId'))
            if meta['id'] in file_ids or meta['planId'] not in {e['plan']['id'] for e in entries} or not isinstance(meta.get('name'),str) or len(meta['name'])>255 or len(data)>50*1024*1024 or meta.get('size')!=len(data):
                raise StoreError('附件格式、大小或归属无效。',422)
            if meta['id'] not in next(e['plan']['attachmentIds'] for e in entries if e['plan']['id']==meta['planId']):
                raise StoreError('上传附件未被所属计划引用。',422)
            file_ids.add(meta['id'])
        with self.lock:
            self.scan()
            journal=[]
            def write(path,data):
                old=path.read_bytes() if path.exists() else None
                journal.append((path,old,digest(data)))
                atomic_write(path,data)
            try:
                with self.workspace.db() as db:
                    db.execute('BEGIN IMMEDIATE')
                    prepared=[]
                    for entry in entries:
                        p=entry['plan']; old=db.execute('SELECT * FROM plans WHERE id=?',(p['id'],)).fetchone()
                        if (old and only_new) or (old['revision'] if old else 0)!=entry['expected_revision']:
                            raise StoreError('计划已被其他编辑器修改，草稿已保留。请另存副本或载入本地版本。',409)
                        if old and (old['missing'] or p['id'] in self.errors):
                            raise StoreError('本地文件已删除、不可读或身份重复。请恢复文件，或将草稿另存副本。',409)
                        oldpath=within(self.root,old['rel_path']) if old else None
                        olddata=read_bytes(oldpath) if old else None
                        if old and digest(olddata)!=old['content_hash']:
                            raise StoreError('保存前检测到外部修改，请先处理冲突。',409)
                        relative=self.filename(p,old)
                        destination=within(self.root,relative)
                        if (not old or relative!=old['rel_path']) and destination.exists():
                            raise StoreError('目标文件已存在，未覆盖原文件。',409)
                        for identity in p['attachmentIds']:
                            existing=db.execute('SELECT plan_id FROM plan_files WHERE id=?',(identity,)).fetchone()
                            supplied=next((m for m,_ in files if m['id']==identity),None)
                            if existing and existing['plan_id']!=p['id'] or not existing and (not supplied or supplied['planId']!=p['id']):
                                raise StoreError('计划引用了不属于它的附件。',422)
                        metadata={k:p.get(k) for k in base_plan(p['id'],p['title'])}
                        metadata['sample']=False
                        if old:
                            previous=json.loads(old['metadata_json'])
                            if p.get('deletedAt') and not previous.get('deletedAt'):metadata['_trash_original']=old['rel_path']
                            elif previous.get('_trash_original'):metadata['_trash_original']=previous['_trash_original']
                        prefix=f"---\nlexivault_plan: {p['id']}\n---\n"
                        if olddata:
                            oldtext=olddata.decode('utf-8-sig'); header=HEADER.match(oldtext)
                            if header:
                                prefix=header.group(0)
                                if not re.search(r'^lexivault_plan:',header.group(1),re.M):prefix=prefix.replace('---',f"---\nlexivault_plan: {p['id']}",1)
                        data=(prefix.rstrip('\r\n')+'\n'+entry['markdown']).encode('utf-8')
                        prepared.append((p,old,oldpath,olddata,relative,destination,metadata,data))
                    for p,old,oldpath,olddata,relative,destination,metadata,data in prepared:
                        if olddata is not None:
                            if read_bytes(oldpath)!=olddata:
                                raise StoreError('写入前检测到外部修改，未覆盖原文件。',409)
                            self.snapshot(p['id'],olddata)
                        write(self.cache_path(p['id']),json.dumps({'content_hash':digest(data),'doc':p['doc']},ensure_ascii=False).encode())
                        write(destination,data)
                        revision=(old['revision'] if old else 0)+1
                        db.execute('INSERT INTO plans VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,rel_path=excluded.rel_path,content_hash=excluded.content_hash,revision=excluded.revision,missing=0',
                                   (p['id'],json.dumps(metadata,ensure_ascii=False),relative,digest(data),revision))
                        db.execute('UPDATE notes SET rel_path=? WHERE id=?',(relative,p['id']))
                        if oldpath and oldpath!=destination:
                            # Move to/from trash only after the replacement exists.
                            if read_bytes(oldpath)!=olddata:
                                raise StoreError('移动前检测到外部修改。',409)
                            journal.append((oldpath,olddata,None)); oldpath.unlink()
                        if old and bool(json.loads(old['metadata_json']).get('deletedAt'))!=bool(p.get('deletedAt')):
                            if p.get('deletedAt'):db.execute('INSERT OR REPLACE INTO file_trash VALUES(?,?,?,?,?)',('plan:'+p['id'],old['rel_path'],relative,json.dumps({p['id']:None}),time.time()))
                            else:db.execute('DELETE FROM file_trash WHERE stored_path=?',(old['rel_path'],))
                        self.snapshot(p['id'],data)
                    for meta,data in files:
                        old=db.execute('SELECT * FROM plan_files WHERE id=?',(meta['id'],)).fetchone()
                        if old:
                            if old['plan_id']!=meta['planId'] or old['content_hash']!=digest(data):
                                raise StoreError('附件身份冲突，原件未覆盖。',409)
                            continue
                        filename=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',meta['name']).strip(' .')[:100] or 'attachment'
                        from .vault import unique_path
                        owner=next(item for item in prepared if item[0]['id']==meta['planId'])
                        directory=meta.get('directory',Path(owner[4]).parent.as_posix())
                        if directory=='.':directory=''
                        target=unique_path(self.root,directory,filename)
                        relative=target.relative_to(self.root).as_posix()
                        if target.exists():
                            raise StoreError('附件路径已有文件，未覆盖。',409)
                        write(target,data)
                        clean={k:meta.get(k) for k in ('id','planId','name','type','size','createdAt')}
                        db.execute('INSERT INTO plan_files VALUES(?,?,?,?,?)',(meta['id'],meta['planId'],json.dumps(clean,ensure_ascii=False),relative,digest(data)))
            except Exception:
                for path,old,ours in reversed(journal):
                    try:
                        if ours is None:
                            if not path.exists(): atomic_write(path,old)
                        elif path.exists() and digest(path.read_bytes())==ours:
                            if old is None: path.unlink()
                            else: atomic_write(path,old)
                    except OSError:
                        pass
                raise
        identities={entry['plan']['id'] for entry in entries}
        return [p for p in self.all() if p['id'] in identities]

    def files(self):
        with self.workspace.db() as db:
            rows=[dict(r) for r in db.execute('SELECT * FROM plan_files')]
        result=[]
        for row in rows:
            path=within(self.root,row['rel_path'])
            try:
                stat=path.stat(); version=f'{stat.st_mtime_ns}:{stat.st_size}'; missing=not path.is_file()
            except OSError:
                version='missing'; missing=True
            result.append(json.loads(row['metadata_json']) | {'missing':missing,'disk_version':version})
        return result

    def file(self,identity):
        with self.workspace.db() as db:
            row=db.execute('SELECT * FROM plan_files WHERE id=?',(validate_id(identity),)).fetchone()
        if not row:
            raise StoreError('附件不存在。',404)
        path=within(self.root,row['rel_path'])
        if not path.is_file():
            raise StoreError('附件文件已被删除，其他计划内容仍保留。',404)
        if digest(read_bytes(path,50*1024*1024))!=row['content_hash']:
            raise StoreError('原始附件已被外部替换，请重新导入作为新附件。',409)
        return path,json.loads(row['metadata_json'])

    def preference(self,key,value=None,write=False):
        if not isinstance(key,str) or len(key)>300:
            raise StoreError('设置名称无效。',422)
        with self.workspace.db() as db:
            if write:
                data=json.dumps(value,ensure_ascii=False)
                if len(data)>10000: raise StoreError('设置过大。',413)
                db.execute('INSERT INTO plan_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',(key,data))
                return value
            row=db.execute('SELECT value_json FROM plan_preferences WHERE key=?',(key,)).fetchone()
            return json.loads(row[0]) if row else None
