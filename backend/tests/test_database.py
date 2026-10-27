import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import connect
from backend.storage import NOTE_HEADER, Registry, StoreError, Workspace
from backend.tests.test_reading import pdf_bytes


def legacy_workspace(root):
    root.mkdir()
    doc_id, data = uuid.uuid4().hex, pdf_bytes()
    sha = hashlib.sha256(data).hexdigest()
    original = root / 'originals' / doc_id / 'paper.pdf'
    original.parent.mkdir(parents=True); original.write_bytes(data)
    note = root / 'notes' / '旧笔记.md'; note.parent.mkdir()
    markdown = f"## 原有理解\n[证据](paper://{doc_id}?revision={sha}&page=2)\n"
    note.write_text(NOTE_HEADER.format(id=doc_id) + markdown,encoding='utf-8')
    with sqlite3.connect(root/'library.sqlite') as db:
        db.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('identity','legacy-workspace'),('name','旧工作空间'),('schema_version','1');
            CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,filename TEXT NOT NULL,
                sha256 TEXT NOT NULL UNIQUE,rel_path TEXT NOT NULL,note_path TEXT NOT NULL,
                page_count INTEGER NOT NULL DEFAULT 0,last_page INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,source TEXT NOT NULL DEFAULT 'local',source_url TEXT NOT NULL DEFAULT '');
        """)
        db.execute('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (doc_id,'旧论文','中文原件.pdf',sha,str(original.relative_to(root)),str(note.relative_to(root)),2,2,time.time(),'arxiv','https://arxiv.org/abs/example'))
    return doc_id,sha,original,note,markdown


def test_old_database_upgrade_preserves_assets_ids_positions_and_citations(tmp_path):
    root = tmp_path/'旧工作空间'
    doc_id,sha,original,note,markdown = legacy_workspace(root)
    original_bytes, note_bytes = original.read_bytes(), note.read_bytes()
    workspace = Workspace(root)
    assert workspace.migration_backup.exists()
    with connect(workspace.migration_backup) as previous:
        assert 'filename' in {row['name'] for row in previous.execute('PRAGMA table_info(documents)')}
        assert previous.execute('SELECT last_page FROM documents').fetchone()[0] == 2
    assert workspace.id == 'legacy-workspace'
    assert workspace.documents()[0]['last_page'] == 2
    assert workspace.documents()[0]['id'] == doc_id
    assert workspace.note(doc_id)['markdown'] == markdown
    assert workspace.original(doc_id,sha)[0] == original
    assert original.read_bytes() == original_bytes and note.read_bytes() == note_bytes
    assert workspace.citations(doc_id)[0]['status'] == 'valid'
    with workspace.db() as db:
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == '5'
        assert 'markdown' not in {row['name'] for row in db.execute('PRAGMA table_info(notes)')}
        assert db.execute('SELECT content_hash FROM notes').fetchone()[0] == hashlib.sha256(note_bytes).hexdigest()
    backups = list((root/'.lexivault'/'backups').glob('*.sqlite'))
    assert Workspace(root).migration_backup is None
    assert list((root/'.lexivault'/'backups').glob('*.sqlite')) == backups


def test_failed_upgrade_rolls_back_and_keeps_readable_backup(tmp_path):
    root = tmp_path/'有问题的旧库'
    legacy_workspace(root)
    with sqlite3.connect(root/'library.sqlite') as db:
        db.execute("UPDATE documents SET rel_path='../outside.pdf'")
    with pytest.raises(StoreError,match='越界路径'):
        Workspace(root)
    with connect(root/'library.sqlite') as db:
        assert 'filename' in {row['name'] for row in db.execute('PRAGMA table_info(documents)')}
        assert db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == '1'
    assert list((root/'.lexivault'/'backups').glob('*.sqlite'))


def test_newer_workspace_schema_is_never_downgraded(tmp_path):
    root = tmp_path/'未来版本'
    legacy_workspace(root)
    with sqlite3.connect(root/'library.sqlite') as db:
        db.execute("UPDATE meta SET value='99' WHERE key='schema_version'")
    before = (root/'library.sqlite').read_bytes()
    with pytest.raises(StoreError,match='更新版本'):
        Workspace(root)
    assert (root/'library.sqlite').read_bytes() == before


def test_registry_imports_json_once_without_rewriting_legacy_file(tmp_path):
    root = tmp_path/'配置'; root.mkdir()
    space = tmp_path/'资料'; legacy_workspace(space)
    legacy = root/'workspaces.json'
    legacy.write_text(json.dumps([{'id':'legacy-workspace','name':'旧工作空间','path':str(space)}]),encoding='utf-8')
    original = legacy.read_bytes()
    registry = Registry(root)
    assert registry.get('legacy-workspace').root == space
    registry.mark_open('legacy-workspace','user-id')
    assert legacy.read_bytes() == original
    with connect(root/'app.sqlite') as db:
        assert db.execute('SELECT last_user_id FROM workspace_registry').fetchone()[0] == 'user-id'
    legacy.write_text('[]',encoding='utf-8')
    assert Registry(root).get('legacy-workspace').id == 'legacy-workspace'


@pytest.fixture
def api(tmp_path):
    application = create_app(tmp_path/'配置')
    with TestClient(application) as client:
        token = client.get('/api/session').json()['token']
        client.headers['x-lexivault-token'] = token
        space = client.post('/api/workspaces',json={'name':'研究资料'}).json()
        yield client, f"/api/workspaces/{space['id']}", application.state.registry.get(space['id'])


def create_paper(client,base,**extra):
    response = client.post(base+'/documents',json={'title':'真实文献信息','authors':['作者甲','Author B'],'year':2025,'abstract':'摘要内容',**extra})
    assert response.status_code == 201,response.text
    return response.json()


def test_metadata_first_then_pdf_supplement_retains_note_and_document_identity(api):
    client,base,workspace = api
    paper = create_paper(client,base,doi='https://doi.org/10.1234/ABC',source={'provider':'arxiv','external_id':'1234.56789','url':'https://arxiv.org/abs/1234.56789'})
    assert paper['fulltext_status'] == 'metadata_only' and paper['doi'] == '10.1234/abc'
    doc = f"{base}/documents/{paper['id']}"
    assert client.get(doc+'/file').status_code == 404
    note = client.get(doc+'/note').json()
    assert client.put(doc+'/note',json={'markdown':'获取全文前的想法','expected_revision':note['revision']}).status_code == 200
    supplemented = client.post(base+'/imports',data={'document_id':paper['id']},files={'file':('paper.pdf',pdf_bytes(),'application/pdf')})
    assert supplemented.status_code == 201,supplemented.text
    assert supplemented.json()['id'] == paper['id']
    assert supplemented.json()['authors'] == ['作者甲','Author B']
    assert supplemented.json()['fulltext_status'] == 'available'
    assert client.get(doc+'/note').json()['markdown'] == '获取全文前的想法'
    assert len(workspace.documents()) == 1
    assert client.get(doc+'/attachments').json()[0]['parse_status'] == 'not_started'


def test_metadata_conflict_validation_and_doi_uniqueness(api):
    client,base,workspace = api
    paper = create_paper(client,base,doi='10.1234/one')
    note_files = list((workspace.root/'notes').glob('*.md'))
    assert client.post(base+'/documents',json={'title':'重复记录','doi':'DOI:10.1234/ONE'}).status_code == 409
    assert list((workspace.root/'notes').glob('*.md')) == note_files
    doc = f"{base}/documents/{paper['id']}"
    assert client.patch(doc,json={'title':'更新的题名','expected_version':1}).status_code == 200
    assert client.patch(doc,json={'title':'过期覆盖','expected_version':1}).status_code == 409
    assert client.patch(doc,json={'title':None,'expected_version':2}).status_code == 422
    assert client.patch(doc,json={'rel_path':'../escape.pdf','expected_version':2}).status_code == 422
    assert client.get(doc).json()['title'] == '更新的题名'
    assert client.post(base+'/documents',json={'title':' ','year':1}).status_code == 422


def test_tags_collections_and_source_records_are_idempotent(api):
    client,base,_ = api
    paper = create_paper(client,base)
    doc = f"{base}/documents/{paper['id']}"
    tags = client.put(doc+'/tags',json={'names':['GNN','gnn','精读']}).json()
    assert len(tags) == 2
    collection = client.post(base+'/collections',json={'name':'我的课题'}).json()
    assert client.post(base+'/collections',json={'name':'我的课题'}).status_code == 409
    assert client.put(base+f"/collections/{collection['id']}/documents/{paper['id']}").status_code == 200
    assert client.put(base+f"/collections/{collection['id']}/documents/{paper['id']}").status_code == 200
    assert client.post(base+'/collections',json={'name':'精读','parent_id':collection['id']}).status_code == 201
    source = {'provider':'crossref','external_id':'10.1234/example','url':'https://doi.org/10.1234/example'}
    assert len(client.post(doc+'/sources',json=source).json()) == 1
    assert len(client.post(doc+'/sources',json=source).json()) == 1
    assert client.post(doc+'/sources',json={**source,'url':'file:///secret'}).status_code == 422


def test_citations_skip_code_samples_and_validate_revision_and_page(api):
    client,base,workspace = api
    paper = client.post(base+'/imports',files={'file':('paper.pdf',pdf_bytes())}).json()
    doc = f"{base}/documents/{paper['id']}"
    valid = f"paper://{paper['id']}?revision={paper['sha256']}&page=2"
    invalid = f"paper://{paper['id']}?revision={paper['sha256']}&page=99"
    note = client.get(doc+'/note').json()
    text = f"[证据]({valid})\n\n[越界引用]({invalid})\n\n```md\n[代码中的引用](paper://missing?revision=none&page=1)\n```"
    saved = client.put(doc+'/note',json={'markdown':text,'expected_revision':note['revision']})
    assert saved.status_code == 200,saved.text
    citations = client.get(doc+'/citations').json()
    assert len(citations) == 2 and {item['status'] for item in citations} == {'valid','unresolved'}
    assert client.post(doc+'/annotations',json={'revision_id':paper['sha256'],'page':2,'quote':'原文摘录'}).status_code == 201
    assert client.post(doc+'/annotations',json={'revision_id':paper['sha256'],'page':3}).status_code == 422
    assert len(workspace.annotations(paper['id'])) == 1


def test_jobs_persist_transitions_and_cannot_fake_completion(tmp_path):
    workspace = Workspace(tmp_path/'资料')
    document = workspace.create_metadata({'title':'仅元数据'})
    task = workspace.enqueue_job('download',document['id'])
    with pytest.raises(StoreError):
        workspace.transition_job(task,'succeeded')
    workspace.transition_job(task,'running',stage='connecting')
    workspace.transition_job(task,'failed',error_code='NETWORK_ERROR',error_message='连接失败')
    workspace.transition_job(task,'queued')
    reloaded = Workspace(workspace.root).jobs()[0]
    assert reloaded['retry_count'] == 1 and reloaded['status'] == 'queued'
    assert workspace.documents()[0]['fulltext_status'] == 'metadata_only'
