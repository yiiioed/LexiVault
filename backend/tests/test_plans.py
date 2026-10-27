import json
import sqlite3
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.plans import PlanStore,base_plan,now
from backend.storage import Workspace,StoreError


def plan(title='我的计划',text='正文证据'):
    p=base_plan(uuid.uuid4().hex,title)
    p.update(doc={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':text}]}]},revision=0)
    return p


def entry(p,revision=0,text='正文证据'):
    return {'plan':p,'expected_revision':revision,'markdown':f"# {p['title']}\n\n{text}\n"}


@pytest.fixture
def source(tmp_path):
    return PlanStore(Workspace(tmp_path/'space'))


def test_plan_body_is_local_md_rich_doc_survives_restart_and_sqlite_has_no_body(source):
    p=plan(); p['doc']['content'][0]['content'][0]['marks']=[{'type':'underline'}]
    saved=source.save_batch([entry(p)],[])[0]
    path=Path(saved['local_path'])
    assert path.is_file() and path.suffix=='.md'
    assert '正文证据' in path.read_text(encoding='utf-8')
    assert 'lexivault_plan: '+p['id'] in path.read_text(encoding='utf-8')
    assert PlanStore(Workspace(source.root)).all()[0]['doc']==p['doc']
    with source.workspace.db() as db:
        assert '正文证据' not in db.execute('SELECT metadata_json FROM plans').fetchone()[0]
    assert saved['revision']==1


def test_external_edits_rename_and_removal_preserve_identity_and_conflict_guard(source):
    p=plan(); first=source.save_batch([entry(p)],[])[0]
    path=Path(first['local_path']);text=path.read_text(encoding='utf-8').replace('正文证据','外部编辑内容')
    path.write_text(text,encoding='utf-8')
    moved=path.with_name('外部重命名.md');path.rename(moved)
    external=source.all()[0]
    assert external['id']==p['id'] and external['local_path']==str(moved)
    assert '外部编辑内容' in external['external_markdown']
    with pytest.raises(StoreError) as error:source.save_batch([entry(p,first['revision'])],[])
    assert error.value.status==409 and '外部编辑内容' in moved.read_text(encoding='utf-8')
    moved.unlink(); missing=source.all()[0]
    assert missing['missing'] and missing['doc']==p['doc']
    with pytest.raises(StoreError):source.save_batch([entry(p,missing['revision'])],[])
    assert not moved.exists()


def test_external_new_markdown_is_discovered_without_modifying_original_and_can_be_edited(source):
    path=source.root/'我写的.md';original='# 外部标题\n\n- [ ] 一个待办\n'
    path.write_text(original,encoding='utf-8')
    found=source.all()[0]
    assert found['title']=='外部标题' and '一个待办' in found['external_markdown']
    assert path.read_text(encoding='utf-8')==original
    p=plan('外部标题');p['id']=found['id']
    source.save_batch([entry(p,found['revision'],'页面修改后的内容')],[])
    assert '页面修改后的内容' in path.read_text(encoding='utf-8')


def test_duplicate_identity_and_invalid_utf8_cannot_overwrite_files(source):
    p=plan(); saved=source.save_batch([entry(p)],[])[0];path=Path(saved['local_path'])
    duplicate=path.with_name('复制文件.md');duplicate.write_bytes(path.read_bytes())
    assert '相同身份' in source.all()[0]['external_error']
    with pytest.raises(StoreError):source.save_batch([entry(p,1)],[])
    duplicate.unlink();path.write_bytes(b'\xff\xfe\x00')
    assert 'UTF-8' in source.all()[0]['external_error']
    with pytest.raises(StoreError):source.save_batch([entry(p,1)],[])
    assert path.read_bytes()==b'\xff\xfe\x00'


def test_attachments_stay_on_disk_and_batch_validation_is_atomic(source):
    p=plan();data=b'opaque-original\x00\xff';identity=uuid.uuid4().hex
    f={'id':identity,'planId':p['id'],'name':'原始实验.custom','type':'application/octet-stream','size':len(data),'createdAt':now()}
    p['attachmentIds']=[identity]
    saved=source.save_batch([entry(p)],[(f,data)])[0]
    assert source.file(identity)[0].read_bytes()==data
    assert PlanStore(Workspace(source.root)).file(identity)[0].read_bytes()==data
    bad=plan();bad['attachmentIds']=[identity]
    with pytest.raises(StoreError):source.save_batch([entry(bad)],[])
    assert len(source.all())==1
    first=plan('新甲');second=plan('新乙');second['attachmentIds']=['missing']
    with pytest.raises(StoreError):source.save_batch([entry(first),entry(second)],[])
    assert len(source.all())==1 and len(list(source.root.glob('*.md')))==1


def test_trash_restore_and_saved_history_keep_user_content(source):
    p=plan();first=source.save_batch([entry(p)],[])[0]
    p['deletedAt']=now();trashed=source.save_batch([entry(p,first['revision'])],[])[0]
    assert '/.lexivault/trash/' in trashed['local_path'].replace('\\','/')
    assert not Path(first['local_path']).exists()
    p['deletedAt']=None;restored=source.save_batch([entry(p,trashed['revision'],'修改过的正文')],[])[0]
    assert '/.lexivault/trash/' not in restored['local_path'].replace('\\','/')
    versions=list((source.root/'.lexivault'/'history'/'plans'/p['id']).glob('*.md'))
    assert any('正文证据' in v.read_text(encoding='utf-8') for v in versions)
    assert any('修改过的正文' in v.read_text(encoding='utf-8') for v in versions)


def test_upload_api_session_limits_isolation_and_preference_restart(tmp_path):
    app=create_app(tmp_path/'config')
    with TestClient(app) as client:
        client.headers['X-LexiVault-Token']=client.get('/api/session').json()['token']
        space=client.post('/api/workspaces',json={'name':'计划空间'}).json();base=f"/api/workspaces/{space['id']}/plans"
        p=plan();body=json.dumps({'plans':[entry(p)],'files':[]})
        assert client.post(base,data={'manifest':body}).status_code==200
        assert client.post(base,data={'manifest':body}).status_code==409
        assert client.get(base).json()['plans'][0]['title']=='我的计划'
        other=client.post('/api/workspaces',json={'name':'其他空间'}).json()
        assert client.get(f"/api/workspaces/{other['id']}/plans").json()['plans']==[]
        assert client.put(base+'/preferences/lastPlan',json={'value':p['id']}).status_code==200
        invalid=p.copy();invalid['id']='../escape'
        assert client.post(base,data={'manifest':json.dumps({'plans':[entry(invalid)],'files':[]})}).status_code==422
        assert client.post(base,data={'manifest':'{"plans":[{}]}'}).status_code==422
    with TestClient(create_app(tmp_path/'config')) as again:
        again.get('/api/session')
        assert again.get(base+'/preferences/lastPlan').json()['value']==p['id']


def test_v3_migration_backs_up_and_preserves_earlier_documents(tmp_path):
    root=tmp_path/'space';workspace=Workspace(root)
    doc=workspace.create_metadata({'title':'原文献'})
    with workspace.db() as db:
        for table in ('plan_files','plans','plan_preferences','file_trash','workspace_settings'):db.execute('DROP TABLE '+table)
        db.execute("UPDATE meta SET value='3' WHERE key='schema_version'")
        db.execute('DELETE FROM schema_migrations WHERE version>=4')
    updated=Workspace(root)
    assert updated.migration_backup.is_file() and updated.documents()[0]['id']==doc['id']
    with sqlite3.connect(updated.migration_backup) as old:
        assert old.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]=='3'
    assert PlanStore(updated).all()==[]

def test_disk_failure_rolls_back_rich_cache_and_metadata_without_truncating_md(source,monkeypatch):
    import backend.plans as module
    p=plan();saved=source.save_batch([entry(p)],[])[0];path=Path(saved['local_path']);original=path.read_bytes()
    real=module.atomic_write
    def failed(target,data):
        if target==path and b'new-content' in data:raise OSError('disk full')
        return real(target,data)
    monkeypatch.setattr(module,'atomic_write',failed)
    changed=plan();changed['id']=p['id']
    with pytest.raises(OSError):source.save_batch([entry(changed,saved['revision'],'new-content')],[])
    assert path.read_bytes()==original
    restored=source.all()[0]
    assert restored['revision']==saved['revision'] and restored['doc']==p['doc']


def test_symlink_cannot_make_plan_reader_escape_workspace(source,tmp_path):
    outside=tmp_path/'outside.md';outside.write_text('private outside text',encoding='utf-8')
    link=source.root/'plans'/'escape.md'
    try:link.symlink_to(outside)
    except OSError:pytest.skip('Symlink creation unavailable on this Windows account')
    assert source.all()==[]
    assert source.discovered_errors and outside.read_text(encoding='utf-8')=='private outside text'

def test_multipart_attachment_download_removal_and_missing_file_metadata(tmp_path):
    app=create_app(tmp_path/'config')
    with TestClient(app) as client:
        client.headers['X-LexiVault-Token']=client.get('/api/session').json()['token']
        space=client.post('/api/workspaces',json={'name':'附件测试'}).json();base=f"/api/workspaces/{space['id']}/plans"
        p=plan();identity=uuid.uuid4().hex;data=b'local original attachment'
        p['attachmentIds']=[identity]
        file={'id':identity,'planId':p['id'],'name':'original.custom','type':'application/octet-stream','size':len(data),'createdAt':now()}
        saved=client.post(base,data={'manifest':json.dumps({'plans':[entry(p)],'files':[file]})},files={'uploads':('original.custom',data,'application/octet-stream')})
        assert saved.status_code==200,saved.text
        assert client.get(base+'/files/'+identity).content==data
        assert client.get(base+'/files').json()[0]['missing'] is False
        assert client.post(base+'/files/'+identity+'/remove',json={'expected_revision':99}).status_code==409
        assert client.post(base+'/files/'+identity+'/remove',json={'expected_revision':saved.json()[0]['revision']}).status_code==200
        assert client.get(base).json()['plans'][0]['attachmentIds']==[]
        assert client.get(base+'/files/'+identity).status_code==404
        assert any(path.read_bytes()==data for path in Path(space['path']).glob('*.custom'))

def test_user_frontmatter_properties_are_preserved_and_identity_changes_are_rejected(source):
    p=plan();saved=source.save_batch([entry(p)],[])[0];path=Path(saved['local_path'])
    original=path.read_text(encoding='utf-8').replace('\n---\n#','\ntags: [research, reading]\ncustom: "保留我的属性"\n---\n#')
    path.write_text(original,encoding='utf-8')
    external=source.all()[0]
    assert 'tags:' not in external['external_markdown']
    source.save_batch([entry(p,external['revision'],'新的正文')],[])
    content=path.read_text(encoding='utf-8')
    assert 'custom: "保留我的属性"' in content and 'tags: [research, reading]' in content
    path.write_text(content.replace(p['id'],'changed-identity'),encoding='utf-8')
    assert '身份' in source.all()[0]['external_error']
    with pytest.raises(StoreError):source.save_batch([entry(p,external['revision']+1)],[])
    assert 'changed-identity' in path.read_text(encoding='utf-8')
