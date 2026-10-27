"""Workspace schema v5. Internal database and freely organized local files."""
import hashlib
import sqlite3
import time
import uuid
from pathlib import Path

from .database import backup, connect, tables

WORKSPACE_VERSION = 5

FILE_SCHEMA = [
    "CREATE TABLE workspace_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL)",
    "CREATE TABLE file_trash(id TEXT PRIMARY KEY,original_path TEXT NOT NULL,stored_path TEXT NOT NULL,metadata_json TEXT NOT NULL,created_at REAL NOT NULL)",
]

PLAN_SCHEMA = [
    "CREATE TABLE plans(id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL,rel_path TEXT NOT NULL UNIQUE,content_hash TEXT NOT NULL,revision INTEGER NOT NULL,missing INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE plan_files(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,metadata_json TEXT NOT NULL,rel_path TEXT NOT NULL UNIQUE,content_hash TEXT NOT NULL)",
    "CREATE TABLE plan_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL)",
]

CHAT_SCHEMA = [
    "CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,liked INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,created_at REAL NOT NULL,updated_at REAL NOT NULL)",
    "CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),text TEXT NOT NULL,service INTEGER NOT NULL DEFAULT 0,citations_json TEXT NOT NULL DEFAULT '[]',position INTEGER NOT NULL)",
    "CREATE TABLE assistant_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 0,state_json TEXT NOT NULL DEFAULT '{}')",
]

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at REAL NOT NULL)",
    """CREATE TABLE documents(
        id TEXT PRIMARY KEY,title TEXT NOT NULL,authors_json TEXT NOT NULL DEFAULT '[]',
        year INTEGER,abstract TEXT NOT NULL DEFAULT '',doi TEXT,
        document_type TEXT NOT NULL DEFAULT 'paper',
        reading_status TEXT NOT NULL DEFAULT 'unread' CHECK(reading_status IN ('unread','reading','read')),metadata_version INTEGER NOT NULL DEFAULT 1,
        primary_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
        created_at REAL NOT NULL,updated_at REAL NOT NULL)""",
    "CREATE UNIQUE INDEX documents_doi ON documents(doi) WHERE doi IS NOT NULL",
    "CREATE INDEX documents_year ON documents(year)",
    """CREATE TABLE attachments(
        id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,rel_path TEXT NOT NULL UNIQUE,mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),sha256 TEXT NOT NULL UNIQUE,
        active_revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,created_at REAL NOT NULL)""",
    "CREATE INDEX attachments_document ON attachments(document_id)",
    """CREATE TABLE revisions(
        id TEXT PRIMARY KEY,attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL,page_count INTEGER NOT NULL DEFAULT 0,
        parse_status TEXT NOT NULL DEFAULT 'not_started' CHECK(parse_status IN ('not_started','running','succeeded','failed','partial')),
        parser_version TEXT,created_at REAL NOT NULL)""",
    "CREATE INDEX revisions_attachment ON revisions(attachment_id)",
    """CREATE TABLE notes(
        id TEXT PRIMARY KEY,document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'reading',rel_path TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL DEFAULT '',revision_no INTEGER NOT NULL DEFAULT 0,
        missing INTEGER NOT NULL DEFAULT 0 CHECK(missing IN (0,1)),created_at REAL NOT NULL,updated_at REAL NOT NULL)""",
    "CREATE UNIQUE INDEX notes_reading_document ON notes(document_id) WHERE kind='reading'",
    """CREATE TABLE reading_progress(
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
        last_page INTEGER NOT NULL DEFAULT 1 CHECK(last_page>=1),updated_at REAL NOT NULL)""",
    """CREATE TABLE source_records(
        id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,external_id TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',
        license_hint TEXT NOT NULL DEFAULT '',fetched_at REAL NOT NULL,
        UNIQUE(document_id,provider,external_id,url))""",
    "CREATE INDEX sources_external ON source_records(provider,external_id)",
    """CREATE TABLE annotations(
        id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
        note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,page INTEGER NOT NULL CHECK(page>=1),
        quote TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',bbox_json TEXT,created_at REAL NOT NULL)""",
    "CREATE INDEX annotations_document ON annotations(document_id)",
    """CREATE TABLE note_citations(
        id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_document_id TEXT,target_revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
        page INTEGER,raw_target TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('valid','unresolved')),
        UNIQUE(note_id,raw_target))""",
    "CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE)",
    """CREATE TABLE document_tags(
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(document_id,tag_id))""",
    """CREATE TABLE collections(
        id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL,
        parent_id TEXT REFERENCES collections(id) ON DELETE RESTRICT,created_at REAL NOT NULL)""",
    "CREATE UNIQUE INDEX collection_names ON collections(COALESCE(parent_id,''),name_key)",
    """CREATE TABLE collection_items(
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,PRIMARY KEY(collection_id,document_id))""",
    """CREATE TABLE jobs(
        id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('download','parse','index')),
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
        stage TEXT NOT NULL DEFAULT '',input_json TEXT NOT NULL DEFAULT '{}',error_code TEXT,error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,heartbeat REAL,created_at REAL NOT NULL,updated_at REAL NOT NULL)""",
    "CREATE INDEX jobs_status ON jobs(status,created_at)",
]


def safe_asset(root, relative):
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or candidate == root.resolve():
        raise ValueError("旧库存在越界路径，升级已停止，原库保持不变。")
    return candidate


def migrate_workspace(root: Path, name=None):
    internal=root/'.lexivault'
    internal.mkdir(exist_ok=True)
    if internal.is_symlink() or (hasattr(internal,'is_junction') and internal.is_junction()):
        raise ValueError('内部数据目录不能是链接。')
    path = internal / "library.sqlite"
    legacy=root/'library.sqlite'
    if legacy.exists() and not path.exists():
        if legacy.is_symlink():raise ValueError('旧数据库不能是链接。')
        with connect(legacy) as source,connect(path) as target:source.backup(target)
    exists = path.exists()
    with connect(path) as db:
        existing = tables(db)
        if exists and "meta" not in existing:
            raise ValueError("目录中已有其他数据库，请选择新的工作空间。")
        version_row = db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone() if "meta" in existing else None
        version = int(version_row[0]) if version_row else (1 if "documents" in existing else 0)
        if version > WORKSPACE_VERSION:
            raise ValueError("该工作空间来自更新版本的程序，请升级应用后再打开。")
        if version == WORKSPACE_VERSION:
            return None
        db.execute("BEGIN IMMEDIATE")
        # The reserved write lock prevents other writers during backup and migration.
        backup_path = backup(path, f"v{version}") if exists else None
        if version in {2,3,4}:
            for sql in (CHAT_SCHEMA if version == 2 else []) + (PLAN_SCHEMA if version<4 else []) + FILE_SCHEMA:
                db.execute(sql)
            db.execute("UPDATE meta SET value=? WHERE key='schema_version'", (str(WORKSPACE_VERSION),))
            db.execute("INSERT INTO schema_migrations VALUES(?,?)", (WORKSPACE_VERSION,time.time()))
            db.execute(f"PRAGMA user_version={WORKSPACE_VERSION}")
            return backup_path
        old_rows = []
        if "documents" in existing:
            old_rows = [dict(row) for row in db.execute("SELECT * FROM documents")]
            db.execute("ALTER TABLE documents RENAME TO legacy_documents_v1")
        for sql in SCHEMA:
            db.execute(sql)
        for sql in CHAT_SCHEMA:
            db.execute(sql)
        for sql in PLAN_SCHEMA + FILE_SCHEMA:
            db.execute(sql)
        now = time.time()
        db.execute("INSERT OR IGNORE INTO meta VALUES('identity',?)", (uuid.uuid4().hex,))
        db.execute("INSERT OR IGNORE INTO meta VALUES('name',?)", (name or root.name,))
        for row in old_rows:
            created = row["created_at"]
            attachment = uuid.uuid5(uuid.NAMESPACE_URL, "attachment:" + row["id"]).hex
            note = uuid.uuid5(uuid.NAMESPACE_URL, "note:" + row["id"]).hex
            original = safe_asset(root, row["rel_path"])
            note_path = safe_asset(root, row["note_path"])
            # The first note read reconciles the file hash and extracts citation links.
            note_hash = ''
            db.execute("INSERT INTO documents(id,title,created_at,updated_at) VALUES(?,?,?,?)", (row["id"], row["title"], created, now))
            db.execute("INSERT INTO attachments(id,document_id,filename,rel_path,mime,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
                       (attachment,row["id"],row["filename"],row["rel_path"],'application/pdf',original.stat().st_size if original.is_file() else 0,row["sha256"],created))
            # Keeping the previous hash as its revision ID preserves existing paper:// links.
            db.execute("INSERT INTO revisions(id,attachment_id,source_hash,page_count,created_at) VALUES(?,?,?,?,?)",
                       (row["sha256"],attachment,row["sha256"],row["page_count"],created))
            db.execute("UPDATE attachments SET active_revision_id=? WHERE id=?", (row["sha256"],attachment))
            db.execute("UPDATE documents SET primary_attachment_id=? WHERE id=?", (attachment,row["id"]))
            db.execute("INSERT INTO notes(id,document_id,rel_path,content_hash,missing,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                       (note,row["id"],row["note_path"],note_hash,int(not note_path.is_file()),created,now))
            db.execute("INSERT INTO reading_progress VALUES(?,?,?,?)", (row["id"],row["sha256"],max(1,row["last_page"]),now))
            db.execute("INSERT INTO source_records(id,document_id,provider,url,fetched_at) VALUES(?,?,?,?,?)",
                       (uuid.uuid4().hex,row["id"],row["source"],row["source_url"],created))
        if old_rows and db.execute("SELECT COUNT(*) FROM documents").fetchone()[0] != len(old_rows):
            raise ValueError("迁移数量校验失败，原库保持不变。")
        if "documents" in existing:
            db.execute("DROP TABLE legacy_documents_v1")
        db.execute("INSERT OR REPLACE INTO meta VALUES('schema_version',?)", (str(WORKSPACE_VERSION),))
        db.execute("INSERT INTO schema_migrations VALUES(?,?)", (WORKSPACE_VERSION,now))
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("迁移关联校验失败，原库保持不变。")
        db.execute(f"PRAGMA user_version={WORKSPACE_VERSION}")
        return backup_path
