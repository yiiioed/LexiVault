"""Local assets are authoritative; SQLite tracks identities and reading state."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from markdown_it import MarkdownIt

from .database import connect, tables
from .migrations import migrate_workspace, WORKSPACE_VERSION

MAX_NOTE = 2 * 1024 * 1024
MAX_PDF = 50 * 1024 * 1024
NOTE_HEADER = "---\nlexivault_document: {id}\n---\n"


class StoreError(Exception):
    def __init__(self, message, status=400, **details):
        self.message, self.status, self.details = message, status, details
        super().__init__(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes):
    """Use a same-directory temporary file; never truncate the current note."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt" and not str(path).startswith("\\\\?\\"):
        path = Path("\\\\?\\" + str(path.resolve()))
    temp = path.with_name(f".lv-{uuid.uuid4().hex[:12]}.tmp")
    try:
        with temp.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def within(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise StoreError("文件路径不在当前工作空间内。", 403)
    return path


class Workspace:
    def __init__(self, root: Path, name=None):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        database = self.root / ".lexivault" / "library.sqlite"
        if database.is_symlink():
            raise StoreError("工作空间数据库不能是符号链接。")
        try:
            self.migration_backup = migrate_workspace(self.root, name)
        except ValueError as error:
            raise StoreError(str(error)) from error
        with self.db() as db:
            self.id = db.execute("SELECT value FROM meta WHERE key='identity'").fetchone()[0]
            self.name = db.execute("SELECT value FROM meta WHERE key='name'").fetchone()[0]
        if self.migration_backup:
            for document in self.documents():
                try:
                    self.note(document['id'])
                except (StoreError,OSError):
                    # An unreadable external note remains untouched and can be repaired later.
                    pass

    def db(self):
        return connect(self.root / ".lexivault" / "library.sqlite")

    def info(self):
        return {"id": self.id, "name": self.name, "path": str(self.root), "schema_version": WORKSPACE_VERSION, "layout": "files"}

    @staticmethod
    def document_query():
        return """SELECT d.*,a.id AS attachment_id,a.filename,a.rel_path,a.sha256,a.size_bytes,
            r.id AS revision_id,COALESCE(r.page_count,0) AS page_count,COALESCE(r.parse_status,'not_started') AS parse_status,
            COALESCE(p.last_page,1) AS last_page,n.id AS note_id,n.rel_path AS note_path,
            COALESCE((SELECT provider FROM source_records s WHERE s.document_id=d.id ORDER BY fetched_at DESC LIMIT 1),'local') AS source,
            COALESCE((SELECT url FROM source_records s WHERE s.document_id=d.id ORDER BY fetched_at DESC LIMIT 1),'') AS source_url
            FROM documents d LEFT JOIN attachments a ON a.id=d.primary_attachment_id
            LEFT JOIN revisions r ON r.id=a.active_revision_id
            LEFT JOIN reading_progress p ON p.document_id=d.id
            LEFT JOIN notes n ON n.document_id=d.id AND n.kind='reading'"""

    def sync_papers(self):
        from .vault import visible_paths
        import subprocess,sys
        seen=getattr(self,'_pdf_seen',{});errors=getattr(self,'_pdf_errors',{});indexed={k:v for k,v in getattr(self,'_paper_paths',{}).items() if within(self.root,k).is_file()}
        with self.lock:
            with self.db() as db:rows=[dict(r) for r in db.execute('SELECT * FROM attachments')]
            bypath={r['rel_path']:r for r in rows};byhash={r['sha256']:r for r in rows}
            for path in visible_paths(self.root):
                if not path.is_file() or path.suffix.lower()!='.pdf':continue
                rel=path.relative_to(self.root).as_posix()
                try:
                    stat=path.stat();signature=(stat.st_mtime_ns,stat.st_size)
                    if rel in bypath:indexed[rel]=bypath[rel]['document_id']
                    if seen.get(rel)==signature:continue
                    seen[rel]=signature;errors.pop(rel,None)
                    if stat.st_size>MAX_PDF:raise StoreError('PDF 超过 50 MiB。')
                    data=path.read_bytes();sha=digest(data)
                    if rel in bypath:continue
                    previous=byhash.get(sha)
                    if previous:
                        indexed[rel]=previous['document_id']
                        if previous['rel_path'].startswith('.lexivault/trash/') or not within(self.root,previous['rel_path']).exists():
                            with self.db() as db:db.execute('UPDATE attachments SET rel_path=?,filename=? WHERE id=?',(rel,path.name,previous['id']))
                        continue
                    report=subprocess.run([sys.executable,'-m','backend.inspect_pdf',str(path)],capture_output=True,text=True,encoding='utf-8',timeout=30,cwd=str(Path(__file__).resolve().parents[1]))
                    result=json.loads(report.stdout)
                    if result.get('error'):raise StoreError(result['error'])
                    item=self.ingest(data,path.name,result['pages'],existing_path=rel);indexed[rel]=item['id']
                    with self.db() as db:row=db.execute('SELECT * FROM attachments WHERE sha256=?',(sha,)).fetchone()
                    if row:byhash[sha]=dict(row)
                except (OSError,ValueError,StoreError,subprocess.TimeoutExpired) as error:errors[rel]=str(error)
            self._pdf_seen=seen;self._paper_paths=indexed;self._pdf_errors=errors;self._paper_warnings=[{'path':p,'message':m} for p,m in errors.items() if within(self.root,p).is_file()]

    def documents(self):
        from .recycle import active_deleted_paths,is_recycled
        self.sync_papers()
        deleted=active_deleted_paths(self)
        with self.db() as db:
            return [self.public(dict(row)) for row in db.execute(self.document_query() + " ORDER BY d.created_at DESC") if not (row["rel_path"] or "").startswith(".lexivault/trash/") and not is_recycled(row['rel_path'] or '',deleted)]

    def document(self, doc_id):
        with self.db() as db:
            row = db.execute(self.document_query() + " WHERE d.id=?", (doc_id,)).fetchone()
        if row is None:
            raise StoreError("当前工作空间中没有这篇文献。", 404)
        return dict(row)

    def public(self, row):
        exists = bool(row["rel_path"] and within(self.root, row["rel_path"]).is_file())
        result = {key: row[key] for key in ("id", "title", "filename", "sha256", "page_count", "last_page", "source", "source_url",
                                                   "year", "abstract", "doi", "document_type", "reading_status", "revision_id", "parse_status", "metadata_version", "rel_path")}
        return result | {"file_available": exists, "authors": json.loads(row["authors_json"]), "fulltext_status": "available" if exists else ("missing" if row["rel_path"] else "metadata_only")}

    def _create_document(self, db, title, metadata=None):
        metadata = metadata or {}
        doc_id, now = uuid.uuid4().hex, time.time()
        db.execute("INSERT INTO documents(id,title,authors_json,year,abstract,doi,document_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                   (doc_id,title,json.dumps(metadata.get("authors", []),ensure_ascii=False),metadata.get("year"),metadata.get("abstract", ""),
                    metadata.get("doi"),metadata.get("document_type", "paper"),now,now))
        return doc_id

    def ingest(self, data: bytes, filename: str, page_count: int, source="local", source_url="", document_id=None,directory="",existing_path=None):
        """Shared entry for local uploads and future authorized source downloaders."""
        if not data.startswith(b"%PDF-") or len(data) > MAX_PDF:
            raise StoreError("仅支持不超过 50 MiB 的 PDF 文件。")
        sha = digest(data)
        with self.lock, self.db() as db:
            if document_id:
                self.document(document_id)
            existing = db.execute("SELECT * FROM attachments WHERE sha256=?", (sha,)).fetchone()
            if existing:
                if document_id and existing["document_id"] != document_id:
                    raise StoreError("这份原件已属于另一篇文献，请确认是否为重复条目。", 409)
                original = within(self.root, existing["rel_path"])
                restored = not original.exists() or existing['rel_path'].startswith('.lexivault/trash/')
                if restored:
                    from .vault import unique_path
                    original=unique_path(self.root,directory,Path(filename.replace('\\','/')).name)
                    atomic_write(original,data)
                    db.execute('UPDATE attachments SET rel_path=?,filename=? WHERE id=?',(original.relative_to(self.root).as_posix(),original.name,existing['id']))
                    db.commit()
                return self.public(self.document(existing["document_id"])) | {"duplicate": True, "restored": restored}
            filename = Path(filename.replace("\\", "/")).name[:240] or "paper.pdf"
            doc_id = document_id or self._create_document(db, Path(filename).stem)
            attachment, revision, now = uuid.uuid4().hex, uuid.uuid4().hex, time.time()
            from .vault import unique_path,user_path
            target=user_path(self.root,existing_path) if existing_path else unique_path(self.root,directory,filename)
            rel=target.relative_to(self.root).as_posix()
            if not existing_path:atomic_write(target,data)
            db.execute("INSERT INTO attachments(id,document_id,filename,rel_path,mime,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
                       (attachment,doc_id,filename,rel,'application/pdf',len(data),sha,now))
            db.execute("INSERT INTO revisions(id,attachment_id,source_hash,page_count,created_at) VALUES(?,?,?,?,?)", (revision,attachment,sha,page_count,now))
            db.execute("UPDATE attachments SET active_revision_id=? WHERE id=?", (revision,attachment))
            db.execute("UPDATE documents SET primary_attachment_id=?,updated_at=? WHERE id=? AND primary_attachment_id IS NULL", (attachment,now,doc_id))
            db.execute("INSERT OR IGNORE INTO reading_progress VALUES(?,?,1,?)", (doc_id,revision,now))
            db.execute("INSERT OR IGNORE INTO source_records(id,document_id,provider,url,fetched_at) VALUES(?,?,?,?,?)", (uuid.uuid4().hex,doc_id,source,source_url,now))
        return self.public(self.document(doc_id)) | {"duplicate": False}

    def original(self, doc_id, revision=None):
        self.sync_papers()
        row = self.document(doc_id)
        if (row["rel_path"] or "").startswith(".lexivault/trash/"):raise StoreError("论文已移入回收站，请先恢复。",404)
        if not row["rel_path"]:
            raise StoreError("这篇文献仅收藏了元数据，尚未补充 PDF 全文。", 404)
        path = within(self.root, row["rel_path"])
        if not path.is_file():
            raise StoreError("PDF 原件已被移动或删除，请恢复原文件。", 404)
        if path.stat().st_size > MAX_PDF:
            raise StoreError("PDF 原件超过文件大小限制。", 409)
        actual = digest(path.read_bytes())
        if actual != row["sha256"] or (revision and revision not in {row["sha256"],row["revision_id"]}):
            raise StoreError("PDF 版本已改变。请单独导入新版本，避免已有页码引用指向错误内容。", 409)
        return path, row

    def note(self, doc_id):
        from .plans import PlanStore,HEADER
        row=self.document(doc_id)
        if not row['note_id']:
            filename=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',row['title'])[:100]+'阅读笔记.md'
            parent=Path(row['rel_path']).parent.as_posix() if row['rel_path'] else ''
            if parent=='.':parent=''
            return {'markdown':'','revision':'uncreated','missing':False,'path':'','id':None,'suggested_path':'/'.join(filter(None,[parent,filename]))}
        plans=PlanStore(self);plans.scan()
        if row['note_id'] in plans.errors:raise StoreError(plans.errors[row['note_id']],409)
        row=self.document(doc_id);path=within(self.root,row['note_path'])
        if not path.is_file() or row['note_path'].startswith('.lexivault/trash/'):
            self._sync_note(row['note_id'],'missing','',missing=True)
            return {'markdown':'','revision':'missing','missing':True,'path':str(path),'id':row['note_id']}
        if path.stat().st_size>MAX_NOTE:raise StoreError('笔记超过 2 MiB。',413)
        raw=path.read_bytes()
        try:text=raw.decode('utf-8-sig').replace('\r\n','\n')
        except UnicodeError:raise StoreError('笔记必须是 UTF-8 编码。',409)
        header=HEADER.match(text);markdown=text[header.end():] if header else text
        self._sync_note(row['note_id'],digest(raw),markdown)
        return {'markdown':markdown,'revision':digest(raw),'missing':False,'path':str(path),'id':row['note_id']}

    def _sync_note(self, note_id, content_hash, markdown, missing=False):
        with self.lock, self.db() as db:
            current = db.execute("SELECT content_hash,missing FROM notes WHERE id=?", (note_id,)).fetchone()
            if current and current["content_hash"] == content_hash and bool(current["missing"]) == missing:
                return
            db.execute("UPDATE notes SET content_hash=?,missing=?,revision_no=revision_no+1,updated_at=? WHERE id=?", (content_hash,int(missing),time.time(),note_id))
            if missing:
                return
            db.execute("DELETE FROM note_citations WHERE note_id=?", (note_id,))
            for block in MarkdownIt('commonmark').parse(markdown):
                for token in block.children or []:
                    if token.type != 'link_open':
                        continue
                    raw = token.attrGet('href') or ''
                    if not raw.startswith('paper://'):
                        continue
                    url = urlparse(raw)
                    query = parse_qs(url.query)
                    version = query.get('revision', [''])[0]
                    page_text = query.get('page', [''])[0]
                    page = int(page_text) if page_text.isdigit() and len(page_text) <= 8 else None
                    target = db.execute("SELECT r.id,r.page_count FROM revisions r JOIN attachments a ON a.id=r.attachment_id WHERE a.document_id=? AND (r.id=? OR r.source_hash=?)", (url.netloc,version,version)).fetchone()
                    valid = bool(target and page and page <= target['page_count'])
                    db.execute("INSERT OR IGNORE INTO note_citations VALUES(?,?,?,?,?,?,?)", (uuid.uuid4().hex,note_id,url.netloc,target['id'] if target else None,page,raw,'valid' if valid else 'unresolved'))

    def save_note(self,doc_id,markdown,expected,path=None):
        from .plans import PlanStore,HEADER
        from .vault import user_path,unique_path
        if len(markdown.encode())>MAX_NOTE-512:raise StoreError('笔记超过 2 MiB，未保存。',413)
        with self.lock:
            current=self.note(doc_id)
            if current['revision']!=expected:raise StoreError('笔记已被其他编辑器修改，当前草稿仍保留。',409,current=current)
            if current['missing']:raise StoreError('本地笔记已删除，请恢复文件或保存副本。',409)
            if expected=='uncreated':
                chosen=path or current['suggested_path'];target=user_path(self.root,chosen)
                if target.suffix.lower()!='.md':raise StoreError('阅读笔记必须是 Markdown 文件。',422)
                if not target.parent.is_dir():raise StoreError('请先创建目标文件夹。',404)
                if target.exists():raise StoreError('此位置已有文件，请关联已有笔记或换一个名称。',409)
                identity=uuid.uuid4().hex;prefix=f'---\nlexivault_plan: {identity}\nlexivault_document: {doc_id}\n---\n'
                data=(prefix+markdown).encode();atomic_write(target,data)
                try:
                    with self.db() as db:db.execute('INSERT INTO notes(id,document_id,rel_path,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)',(identity,doc_id,target.relative_to(self.root).as_posix(),'',time.time(),time.time()))
                except Exception:
                    if target.exists() and digest(target.read_bytes())==digest(data):target.unlink()
                    raise
            else:
                target=Path(current['path']);old=target.read_bytes();text=old.decode('utf-8-sig');match=HEADER.match(text)
                prefix=match.group(0) if match else NOTE_HEADER.format(id=doc_id)
                new=(prefix+markdown).encode();atomic_write(within(self.root,f'.lexivault/history/notes/{doc_id}/{digest(old)}.md'),old)
                if digest(target.read_bytes())!=expected:raise StoreError('保存前检测到外部修改，草稿保留。',409)
                atomic_write(target,new)
            PlanStore(self).scan()
            return self.note(doc_id)

    def attach_note(self,doc_id,path):
        from .plans import PlanStore
        from .vault import user_path
        self.document(doc_id);candidate=user_path(self.root,path)
        if not candidate.is_file() or candidate.suffix.lower()!='.md':raise StoreError('请选择工作空间内的 Markdown。',422)
        PlanStore(self).scan()
        path=candidate.relative_to(self.root).as_posix()
        with self.lock,self.db() as db:
            plan=db.execute('SELECT id FROM plans WHERE rel_path=?',(candidate.relative_to(self.root).as_posix(),)).fetchone()
            if not plan:raise StoreError('此文件无法识别，请检查编码。',422)
            existing=db.execute('SELECT document_id FROM notes WHERE rel_path=?',(path,)).fetchone()
            if existing and existing['document_id']!=doc_id:raise StoreError('此笔记已关联另一篇论文，请选择其他文件。',409)
            db.execute('DELETE FROM notes WHERE document_id=?',(doc_id,))
            db.execute('INSERT INTO notes(id,document_id,rel_path,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)',(plan['id'],doc_id,path,'',time.time(),time.time()))
        return self.note(doc_id)

    def save_conflict(self, doc_id, markdown):
        self.document(doc_id)
        if len(markdown.encode("utf-8")) > MAX_NOTE:
            raise StoreError("草稿超过大小限制。", 413)
        from .vault import unique_path
        row=self.document(doc_id)
        parent=Path(row['rel_path']).parent.as_posix() if row.get('rel_path') else ''
        if parent=='.' or not (self.root/parent).is_dir():parent=''
        target=unique_path(self.root,parent,f"阅读笔记草稿-{time.time_ns()}.md")
        atomic_write(target, markdown.encode("utf-8"))
        return {"path": str(target)}

    def history(self, doc_id):
        self.document(doc_id)
        folder = within(self.root, f".lexivault/history/notes/{doc_id}")
        if os.name=="nt":folder=Path("\\\\?\\"+str(folder))
        return [{"id": path.stem, "modified_at": path.stat().st_mtime} for path in sorted(folder.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)[:50]]

    def history_note(self, doc_id, revision):
        self.document(doc_id)
        if not re.fullmatch(r"[a-f0-9]{64}", revision):
            raise StoreError("无效的历史版本。", 404)
        path = within(self.root, f".lexivault/history/notes/{doc_id}/{revision}.md")
        if os.name=="nt":path=Path("\\\\?\\"+str(path))
        if not path.is_file():
            raise StoreError("历史版本不存在。", 404)
        from .plans import HEADER
        return {"markdown": HEADER.sub("",path.read_text(encoding="utf-8"),count=1)}

    def set_position(self, doc_id, page):
        row = self.document(doc_id)
        if page < 1 or page > row["page_count"]:
            raise StoreError("页码超出论文范围。")
        with self.db() as db:
            db.execute("INSERT INTO reading_progress VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET revision_id=excluded.revision_id,last_page=excluded.last_page,updated_at=excluded.updated_at", (doc_id,row["revision_id"],page,time.time()))
            db.execute("UPDATE documents SET reading_status=CASE WHEN reading_status='unread' THEN 'reading' ELSE reading_status END WHERE id=?", (doc_id,))

    def create_metadata(self, metadata, source=None):
        metadata = dict(metadata)
        metadata['doi'] = self.normalize_doi(metadata.get('doi'))
        try:
            with self.lock, self.db() as db:
                doc_id = self._create_document(db, metadata.pop('title'), metadata)
                if source:
                    self._source(db, doc_id, source)
        except sqlite3.IntegrityError:
            raise StoreError('该 DOI 已有文献记录，请编辑已有条目或为其补充附件。',409)
        return self.public(self.document(doc_id))

    @staticmethod
    def normalize_doi(value):
        if not value or not value.strip():
            return None
        value = re.sub(r'^(https?://(?:dx\.)?doi\.org/|doi:\s*)', '', value.strip(), flags=re.I).lower()
        if not re.fullmatch(r'10\.\d{4,9}/\S+', value):
            raise StoreError('DOI 格式不正确。',422)
        return value

    def update_metadata(self, doc_id, fields, expected_version):
        self.document(doc_id)
        fields = dict(fields)
        allowed = {'title','authors','year','abstract','doi','document_type','reading_status'}
        if not fields.keys() <= allowed:
            raise StoreError('包含不可编辑字段。',422)
        if 'doi' in fields:
            fields['doi'] = self.normalize_doi(fields['doi'])
        if 'authors' in fields:
            fields['authors_json'] = json.dumps(fields.pop('authors'),ensure_ascii=False)
        if fields:
            try:
                with self.db() as db:
                    assignments = ','.join(f'{key}=?' for key in fields)
                    changed = db.execute(f'UPDATE documents SET {assignments},updated_at=?,metadata_version=metadata_version+1 WHERE id=? AND metadata_version=?', (*fields.values(),time.time(),doc_id,expected_version)).rowcount
                    if not changed:
                        raise StoreError('文献信息已被其他页面修改，请重新读取后再保存。',409)
            except sqlite3.IntegrityError:
                raise StoreError('该 DOI 已属于另一条文献。',409)
        return self.public(self.document(doc_id))

    def attachments(self, doc_id):
        self.document(doc_id)
        with self.db() as db:
            return [dict(row) for row in db.execute("""SELECT a.id,a.filename,a.mime,a.size_bytes,a.sha256,a.active_revision_id,
                r.page_count,r.parse_status FROM attachments a LEFT JOIN revisions r ON r.id=a.active_revision_id WHERE a.document_id=? ORDER BY a.created_at""", (doc_id,))]

    def _source(self, db, doc_id, source):
        db.execute("INSERT OR IGNORE INTO source_records(id,document_id,provider,external_id,url,license_hint,fetched_at) VALUES(?,?,?,?,?,?,?)",
                   (uuid.uuid4().hex,doc_id,source['provider'],source.get('external_id',''),source.get('url',''),source.get('license_hint',''),time.time()))

    def add_source(self, doc_id, source):
        self.document(doc_id)
        with self.db() as db:
            self._source(db,doc_id,source)
        return self.sources(doc_id)

    def sources(self, doc_id):
        self.document(doc_id)
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM source_records WHERE document_id=? ORDER BY fetched_at DESC',(doc_id,))]

    def set_tags(self, doc_id, names):
        self.document(doc_id)
        with self.db() as db:
            db.execute('DELETE FROM document_tags WHERE document_id=?',(doc_id,))
            for name in names:
                name = name.strip()
                if not name:
                    continue
                db.execute('INSERT OR IGNORE INTO tags VALUES(?,?,?)',(uuid.uuid4().hex,name,name.casefold()))
                tag = db.execute('SELECT id FROM tags WHERE name_key=?',(name.casefold(),)).fetchone()[0]
                db.execute('INSERT OR IGNORE INTO document_tags VALUES(?,?)',(doc_id,tag))
        return self.tags(doc_id)

    def tags(self, doc_id=None):
        if doc_id:
            self.document(doc_id)
        with self.db() as db:
            if doc_id:
                rows = db.execute('SELECT t.id,t.name FROM tags t JOIN document_tags d ON t.id=d.tag_id WHERE d.document_id=? ORDER BY t.name_key',(doc_id,))
            else:
                rows = db.execute('SELECT id,name FROM tags ORDER BY name_key')
            return [dict(row) for row in rows]

    def create_collection(self, name, parent_id=None):
        name = name.strip()
        if not name:
            raise StoreError('收藏夹名称不能为空。',422)
        try:
            with self.db() as db:
                if parent_id and not db.execute('SELECT id FROM collections WHERE id=?',(parent_id,)).fetchone():
                    raise StoreError('上级收藏夹不存在。',404)
                identity = uuid.uuid4().hex
                db.execute('INSERT INTO collections VALUES(?,?,?,?,?)',(identity,name,name.casefold(),parent_id,time.time()))
        except sqlite3.IntegrityError:
            raise StoreError('同一目录下已有该名称的收藏夹。',409)
        return {'id':identity,'name':name,'parent_id':parent_id}

    def collections(self):
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM collections ORDER BY created_at')]

    def collect(self, collection_id, doc_id):
        self.document(doc_id)
        with self.db() as db:
            if not db.execute('SELECT id FROM collections WHERE id=?',(collection_id,)).fetchone():
                raise StoreError('收藏夹不存在。',404)
            db.execute('INSERT OR IGNORE INTO collection_items VALUES(?,?)',(collection_id,doc_id))
        return {'saved':True}

    def annotations(self, doc_id):
        self.document(doc_id)
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM annotations WHERE document_id=? ORDER BY created_at',(doc_id,))]

    def add_annotation(self, doc_id, annotation):
        document = self.document(doc_id)
        with self.db() as db:
            revision = db.execute("SELECT r.id,r.page_count FROM revisions r JOIN attachments a ON r.attachment_id=a.id WHERE a.document_id=? AND (r.id=? OR r.source_hash=?)",
                                  (doc_id,annotation['revision_id'],annotation['revision_id'])).fetchone()
            if not revision or not 1 <= annotation['page'] <= revision['page_count']:
                raise StoreError('引用的文件版本或页码不可用。',422)
            db.execute('INSERT INTO annotations(id,document_id,revision_id,note_id,page,quote,comment,bbox_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                       (uuid.uuid4().hex,doc_id,revision['id'],document['note_id'],annotation['page'],annotation.get('quote',''),annotation.get('comment',''),json.dumps(annotation['bbox']) if annotation.get('bbox') else None,time.time()))
        return self.annotations(doc_id)

    def citations(self, doc_id):
        row = self.document(doc_id)
        self.note(doc_id)
        with self.db() as db:
            return [dict(citation) for citation in db.execute('SELECT * FROM note_citations WHERE note_id=?',(row['note_id'],))]

    def enqueue_job(self, kind, document_id=None):
        if kind not in {'download','parse','index'}:
            raise StoreError('不支持的任务类型。',422)
        if document_id:
            self.document(document_id)
        identity, now = uuid.uuid4().hex, time.time()
        with self.db() as db:
            db.execute('INSERT INTO jobs(id,kind,document_id,created_at,updated_at) VALUES(?,?,?,?,?)',(identity,kind,document_id,now,now))
        return identity

    def transition_job(self, job_id, status, stage='', error_code=None, error_message=None):
        allowed = {'queued':{'running','cancelled'},'running':{'succeeded','failed','cancelled'},'failed':{'queued'},'cancelled':set(),'succeeded':set()}
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
            if not row:
                raise StoreError('任务不存在。',404)
            if status not in allowed[row['status']]:
                raise StoreError('任务状态已变化，无法执行该转换。',409)
            db.execute('UPDATE jobs SET status=?,stage=?,error_code=?,error_message=?,retry_count=retry_count+?,heartbeat=?,updated_at=? WHERE id=?',
                       (status,stage,error_code,error_message,int(status=='queued'),time.time() if status=='running' else None,time.time(),job_id))

    def jobs(self):
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200')]


class Registry:
    def __init__(self, data_dir: Path):
        self.root = data_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "workspaces.json"
        self.database = self.root / 'app.sqlite'
        if self.database.is_symlink():
            raise StoreError('应用数据库不能是符号链接。')
        self.lock = threading.RLock()
        self.items = {}
        with connect(self.database) as db:
            if tables(db):
                if 'app_meta' not in tables(db):
                    raise StoreError('应用目录中存在其他数据库。')
                version = db.execute("SELECT value FROM app_meta WHERE key='schema_version'").fetchone()
                if version and int(version[0]) > 1:
                    raise StoreError('应用数据库来自更新版本，请升级程序。')
            db.executescript("""
                CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS workspace_registry(
                    id TEXT PRIMARY KEY,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,
                    last_opened_at REAL NOT NULL,last_user_id TEXT);
            """)
            db.execute("INSERT OR IGNORE INTO app_meta VALUES('schema_version','1')")
            imported = db.execute("SELECT value FROM app_meta WHERE key='legacy_json_imported'").fetchone()
            if not imported:
                for item in json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else []:
                    db.execute('INSERT OR IGNORE INTO workspace_registry VALUES(?,?,?,?,NULL)', (item['id'],item['name'],item['path'],time.time()))
                db.execute("INSERT INTO app_meta VALUES('legacy_json_imported','1')")
            entries = [dict(row) for row in db.execute('SELECT * FROM workspace_registry ORDER BY last_opened_at DESC')]
        for item in entries:
            root = Path(item["root_path"])
            if (root / ".lexivault" / "library.sqlite").exists() or (root / "library.sqlite").exists():
                workspace = Workspace(root)
                self.items[workspace.id] = workspace

    def add(self, root, name=None):
        with self.lock:
            workspace = Workspace(Path(root), name)
            self.items={key:item for key,item in self.items.items() if item.root!=workspace.root or key==workspace.id}
            self.items[workspace.id] = workspace
            with connect(self.database) as db:
                db.execute('DELETE FROM workspace_registry WHERE root_path=? AND id<>?',(str(workspace.root),workspace.id))
                db.execute('INSERT INTO workspace_registry(id,name,root_path,last_opened_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path,last_opened_at=excluded.last_opened_at',
                           (workspace.id,workspace.name,str(workspace.root),time.time()))
            return workspace

    def mark_open(self, identity, user_id=None):
        workspace = self.get(identity)
        with connect(self.database) as db:
            db.execute('UPDATE workspace_registry SET last_opened_at=?,last_user_id=? WHERE id=?',(time.time(),user_id,identity))
        return workspace.info()

    def create(self, name):
        name = name.strip()
        if not name or len(name) > 80:
            raise StoreError("请输入 1 至 80 个字符的工作空间名称。")
        return self.add(self.root / "workspaces" / uuid.uuid4().hex, name)

    def get(self, identity):
        try:
            return self.items[identity]
        except KeyError:
            raise StoreError("工作空间不存在，请重新选择。", 404)
