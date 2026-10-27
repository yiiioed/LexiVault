"""A real, workspace-bounded filesystem shared by notes, plans and PDFs."""
import json
import time
import uuid
from datetime import datetime,timezone

from .storage import StoreError,atomic_write,within
from .vault import user_path,relative_path,visible_paths
from .recycle import send_to_system_trash, read_deleted_paths, write_deleted_paths


class FileService:
    def __init__(self,workspace):self.w=workspace;self.root=workspace.root

    def tree(self):
        from .plans import PlanStore
        self.w.sync_papers()
        plans=PlanStore(self.w);plans.scan()
        with self.w.db() as db:
            notes={r['rel_path']:r['id'] for r in db.execute('SELECT id,rel_path FROM plans WHERE missing=0')}
            papers={r['rel_path']:r['document_id'] for r in db.execute('SELECT rel_path,document_id FROM attachments')}
        papers.update(getattr(self.w,'_paper_paths',{}))
        entries=[]
        for path in visible_paths(self.root):
            rel=path.relative_to(self.root).as_posix()
            try:
                stat=path.stat();kind='folder' if path.is_dir() else 'markdown' if path.suffix.lower()=='.md' else 'pdf' if path.suffix.lower()=='.pdf' else 'file'
                entries.append({'path':rel,'name':path.name,'kind':kind,'size':stat.st_size if kind!='folder' else 0,'modified':stat.st_mtime_ns,'plan_id':notes.get(rel),'document_id':papers.get(rel)})
            except OSError:continue
        return {'entries':entries,'warnings':getattr(self.w,'_paper_warnings',[])+plans.discovered_errors,'root':str(self.root)}

    def create(self,parent,name,kind):
        relative=relative_path('/'.join(filter(None,[relative_path(parent,True),name])))
        if '/' in name.replace('\\','/'):raise StoreError('名称中不能包含路径。',422)
        path=user_path(self.root,relative)
        if not path.parent.is_dir():raise StoreError('上级文件夹不存在。',404)
        with self.w.lock:
            if path.exists():raise StoreError('同名文件或文件夹已存在。',409)
            if kind=='folder':path.mkdir()
            elif kind=='markdown':
                if path.suffix.lower()!='.md':raise StoreError('笔记文件请使用 .md 扩展名。',422)
                identity=uuid.uuid4().hex
                atomic_write(path,f'---\nlexivault_plan: {identity}\n---\n# {path.stem}\n\n'.encode())
            else:raise StoreError('只能新建文件夹或 Markdown 文档。',422)
        return {'path':relative}

    def upload(self,parent,name,data):
        from .vault import unique_path
        if len(data)>50*1024*1024:raise StoreError('单个文件不能超过 50 MiB。',413)
        with self.w.lock:
            path=unique_path(self.root,parent,name)
            atomic_write(path,data)
        return {'path':path.relative_to(self.root).as_posix()}

    @staticmethod
    def remap(path,old,new):return new+path[len(old):] if path==old or path.startswith(old+'/') else None

    def update_paths(self,db,old,new):
        for table,column,key in [('plans','rel_path','id'),('notes','rel_path','id'),('attachments','rel_path','id'),('plan_files','rel_path','id')]:
            for row in db.execute(f'SELECT {key},{column} FROM {table}').fetchall():
                mapped=self.remap(row[column],old,new)
                if mapped is not None:
                    extra=',revision=revision+1' if table=='plans' else ''
                    db.execute(f'UPDATE {table} SET {column}=?{extra} WHERE {key}=?',(mapped,row[key]))

    def move(self,source,destination):
        source=relative_path(source);destination=relative_path(destination)
        src=user_path(self.root,source);dst=user_path(self.root,destination)
        if source==destination:return {'path':source}
        if destination.startswith(source+'/'):raise StoreError('不能把文件夹移到自身内部。',422)
        with self.w.lock:
            if not src.exists():raise StoreError('文件已不存在，请刷新。',404)
            if not dst.parent.is_dir():raise StoreError('目标文件夹不存在。',404)
            same=src.resolve()==dst.resolve()
            if dst.exists() and not same:raise StoreError('目标已有同名内容，未覆盖。',409)
            try:
                with self.w.db() as db:
                    db.execute('BEGIN IMMEDIATE')
                    src.rename(dst)
                    try:self.update_paths(db,source,destination)
                    except Exception:dst.rename(src);raise
            except Exception:
                if dst.exists() and not src.exists():dst.rename(src)
                raise
        return {'path':destination}

    def delete(self,source):
        source=relative_path(source);src=user_path(self.root,source)
        with self.w.lock,self.w.db() as db:
            if not src.exists():raise StoreError('文件已不存在，请刷新。',404)
            db.execute('BEGIN IMMEDIATE')
            paths=read_deleted_paths(db);paths.add(source);write_deleted_paths(db,paths)
            try:
                send_to_system_trash(src)
                if src.exists():raise OSError('文件仍在原位置')
            except Exception as error:
                raise StoreError('无法移入系统回收站，未改用永久删除。请关闭占用文件的程序后重试。',503) from error
        return {'path':source,'destination':'system_trash'}

    def trash(self,source):
        # Legacy vault-trash compatibility. Live UI deletion calls delete().
        source=relative_path(source);src=user_path(self.root,source)
        identity=uuid.uuid4().hex;stored=f'.lexivault/trash/{identity}/{src.name}';dst=within(self.root,stored)
        with self.w.lock:
            if not src.exists():raise StoreError('文件已不存在，请刷新。',404)
            dst.parent.mkdir(parents=True,exist_ok=True)
            moved=False
            try:
                with self.w.db() as db:
                    db.execute('BEGIN IMMEDIATE');states={}
                    for row in db.execute('SELECT id,rel_path,metadata_json FROM plans').fetchall():
                        if self.remap(row['rel_path'],source,stored) is not None:
                            meta=json.loads(row['metadata_json']);states[row['id']]=meta.get('deletedAt');meta['deletedAt']=datetime.now(timezone.utc).isoformat()
                            db.execute('UPDATE plans SET metadata_json=? WHERE id=?',(json.dumps(meta,ensure_ascii=False),row['id']))
                    src.rename(dst);moved=True;self.update_paths(db,source,stored)
                    db.execute('INSERT INTO file_trash VALUES(?,?,?,?,?)',(identity,source,stored,json.dumps(states),time.time()))
            except Exception:
                if moved and dst.exists() and not src.exists():dst.rename(src)
                raise
        return {'id':identity,'path':source}

    def trash_items(self):
        with self.w.db() as db:return [dict(r) for r in db.execute('SELECT id,original_path,created_at FROM file_trash ORDER BY created_at DESC')]

    def restore(self,identity):
        with self.w.lock,self.w.db() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM file_trash WHERE id=?',(identity,)).fetchone()
            if not row:raise StoreError('回收站记录不存在。',404)
            src=within(self.root,row['stored_path']);dst=user_path(self.root,row['original_path'])
            if dst.exists():raise StoreError('原位置已有同名文件，请先重命名或移走它。',409)
            if not dst.parent.exists():raise StoreError('原文件夹不存在，请先重新创建。',409)
            if not src.exists():raise StoreError('回收站文件已被外部删除。',404)
            src.rename(dst)
            try:
                self.update_paths(db,row['stored_path'],row['original_path'])
                for plan_id,state in json.loads(row['metadata_json']).items():
                    plan=db.execute('SELECT metadata_json FROM plans WHERE id=?',(plan_id,)).fetchone()
                    if plan:
                        meta=json.loads(plan[0]);meta['deletedAt']=state;db.execute('UPDATE plans SET metadata_json=? WHERE id=?',(json.dumps(meta,ensure_ascii=False),plan_id))
                db.execute('DELETE FROM file_trash WHERE id=?',(identity,))
            except Exception:dst.rename(src);raise
        return {'path':row['original_path']}

    def content(self,path):
        candidate=user_path(self.root,path)
        if not candidate.is_file():raise StoreError('文件不存在。',404)
        return candidate
