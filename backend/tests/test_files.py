from pathlib import Path
import pytest
from backend.storage import Workspace, StoreError
from backend.files import FileService
from backend.plans import PlanStore
from backend.tests.test_plans import plan,entry
from backend.tests.test_reading import pdf_bytes,session


def test_empty_space_only_has_internal_directory(tmp_path):
    w=Workspace(tmp_path/'space');PlanStore(w);files=FileService(w)
    assert files.tree()['entries']==[]
    assert {p.name for p in w.root.iterdir()}=={'.lexivault'}
    assert (w.root/'.lexivault/library.sqlite').is_file()


def test_create_edit_move_trash_restore_preserves_identity_and_text(tmp_path):
    w=Workspace(tmp_path/'space');fs=FileService(w);ps=PlanStore(w)
    fs.create('','课题','folder');fs.create('课题','计划.md','markdown')
    first=ps.all()[0];identity=first['id']
    p=plan('标题改变');p['id']=identity
    saved=ps.save_batch([entry(p,first['revision'],'新正文')],[])[0]
    assert saved['relative_path']=='课题/计划.md'
    fs.create('','归档','folder');fs.move('课题','归档/项目')
    moved=ps.all()[0];assert moved['id']==identity and moved['relative_path']=='归档/项目/计划.md'
    deleted=fs.trash('归档/项目');assert not (w.root/'归档/项目').exists()
    assert ps.all()[0]['deletedAt']
    assert not any(e['path'].startswith('.lexivault') for e in fs.tree()['entries'])
    fs.restore(deleted['id']);restored=ps.all()[0]
    assert restored['id']==identity and not restored['deletedAt']
    assert '新正文' in Path(restored['local_path']).read_text(encoding='utf-8')
    assert fs.trash_items()==[]


@pytest.mark.parametrize('path',['../outside','/absolute','C:/outside','.lexivault/x','.git/config','folder/../x','CON.md','folder/NUL'])
def test_file_actions_cannot_escape_or_modify_internal_files(tmp_path,path):
    fs=FileService(Workspace(tmp_path/'space'))
    with pytest.raises(StoreError):fs.create(path,'x.md','markdown')
    with pytest.raises(StoreError):fs.trash(path)
    with pytest.raises(StoreError):fs.content(path)
    assert {p.name for p in fs.root.iterdir()}=={'.lexivault'}


def test_collisions_and_illegal_moves_leave_files_untouched(tmp_path):
    fs=FileService(Workspace(tmp_path/'space'));fs.create('','课题','folder');fs.create('课题','A.md','markdown');fs.create('课题','B.md','markdown')
    data=(fs.root/'课题/A.md').read_bytes()
    for operation in [lambda:fs.create('课题','A.md','markdown'),lambda:fs.move('课题/A.md','课题/B.md'),lambda:fs.move('课题','课题/子目录')]:
        with pytest.raises(StoreError):operation()
    assert (fs.root/'课题/A.md').read_bytes()==data
    trashed=fs.trash('课题/A.md');fs.create('课题','A.md','markdown')
    with pytest.raises(StoreError):fs.restore(trashed['id'])
    assert fs.trash_items()[0]['id']==trashed['id']


def test_external_pdf_discovery_move_and_lazy_note_location(tmp_path):
    w=Workspace(tmp_path/'space');fs=FileService(w);fs.create('','课题','folder')
    pdf=w.root/'课题/论文.pdf';pdf.write_bytes(pdf_bytes())
    found=fs.tree()['entries'];paper=next(e for e in found if e['kind']=='pdf');docid=paper['document_id']
    assert docid and w.note(docid)['revision']=='uncreated'
    assert list(w.root.glob('**/*.md'))==[]
    fs.create('','笔记','folder')
    note=w.save_note(docid,'## 证据\n自己的理解','uncreated','笔记/阅读.md')
    assert Path(note['path'])==w.root/'笔记/阅读.md'
    fs.move('笔记','研究笔记');assert Path(w.note(docid)['path'])==w.root/'研究笔记/阅读.md'
    pdf.rename(w.root/'外部改名.pdf');assert w.documents()[0]['id']==docid
    assert w.documents()[0]['rel_path']=='外部改名.pdf'
    assert w.original(docid)[0]==w.root/'外部改名.pdf'
    deleted=fs.trash('研究笔记');assert w.note(docid)['missing']
    fs.restore(deleted['id']);assert w.note(docid)['markdown']=='## 证据\n自己的理解'


def test_attach_existing_md_uses_same_plan_file_and_survives_moves(tmp_path):
    w=Workspace(tmp_path/'space');fs=FileService(w);paper=w.ingest(pdf_bytes(),'论文.pdf',2)
    fs.create('','已有笔记.md','markdown');ps=PlanStore(w);p=ps.all()[0]
    linked=w.attach_note(paper['id'],'已有笔记.md');assert linked['id']==p['id']
    w.save_note(paper['id'],'# 已有笔记\n\n来自阅读页的修改',linked['revision'])
    external=ps.all()[0];assert '来自阅读页' in external['external_markdown']
    edit=plan('相同文件');edit['id']=p['id'];ps.save_batch([entry(edit,external['revision'],'来自计划页的修改')],[])
    assert '来自计划页' in w.note(paper['id'])['markdown']
    fs.move('已有笔记.md','改名.md');assert Path(w.note(paper['id'])['path']).name=='改名.md'
    other=w.ingest(pdf_bytes(3),'其他.pdf',3)
    with pytest.raises(StoreError):w.attach_note(other['id'],'改名.md')
    assert len(list(w.root.glob('*.md')))==1


def test_pdf_duplicate_copy_keeps_tree_mapping_across_scans(tmp_path):
    w=Workspace(tmp_path/'space');fs=FileService(w)
    first=w.ingest(pdf_bytes(),'一.pdf',2);(w.root/'二.pdf').write_bytes(pdf_bytes())
    for _ in range(3):
        pdfs=[e for e in fs.tree()['entries'] if e['kind']=='pdf']
        assert len(pdfs)==2 and all(e['document_id']==first['id'] for e in pdfs)


def test_file_api_creates_imports_and_moves_in_selected_directory(session):
    client,base,_,info=session
    assert client.post(base+'/files',json={'kind':'folder','parent':'','name':'课题'}).status_code==200
    upload=client.post(base+'/files/upload',data={'directory':'课题'},files={'files':('外部.md','# 外部\n\n正文'.encode(),'text/markdown')})
    assert upload.status_code==200 and upload.json()['files'][0]['path']=='课题/外部.md'
    tree=client.get(base+'/files').json();assert next(e for e in tree['entries'] if e['kind']=='markdown')['plan_id']
    assert client.post(base+'/files/move',json={'source':'课题/外部.md','destination':'课题/新名.md'}).status_code==200
    assert '正文' in client.get(base+'/files/content',params={'path':'课题/新名.md'}).text
    assert client.post(base+'/imports',data={'directory':'课题'},files={'file':('原件.pdf',pdf_bytes(),'application/pdf')}).status_code==201
    assert (Path(info['path'])/'课题/原件.pdf').is_file()
    assert not (Path(info['path'])/'originals').exists()

def test_legacy_trash_remains_recoverable_without_new_ui_entries(session):
    client,base,app,info=session
    root=Path(info['path'])
    assert client.post(base+'/files',json={'kind':'folder','parent':'','name':'课题'}).status_code==200
    paper=client.post(base+'/imports',data={'directory':'课题'},files={'file':('原件.pdf',pdf_bytes(),'application/pdf')}).json()
    note=client.get(base+f'/documents/{paper["id"]}/note').json()
    saved=client.put(base+f'/documents/{paper["id"]}/note',json={'markdown':'## 删除前保存的证据','expected_revision':note['revision'],'path':'课题/阅读.md'})
    assert saved.status_code==200
    original=(root/'课题/原件.pdf').read_bytes()
    deleted=FileService(app.state.registry.get(info['id'])).trash('课题')
    assert not (root/'课题').exists()
    assert client.get(base+'/documents').json()==[]
    trash=client.get(base+'/files/trash').json()
    assert trash[0]['original_path']=='课题'
    restored=client.post(base+f'/files/trash/{deleted["id"]}/restore')
    assert restored.status_code==200
    assert (root/'课题/原件.pdf').read_bytes()==original
    assert client.get(base+'/documents').json()[0]['id']==paper['id']
    assert client.get(base+f'/documents/{paper["id"]}/note').json()['markdown']=='## 删除前保存的证据'


def test_reimport_missing_pdf_uses_selected_folder_without_recreating_old_tree(tmp_path):
    w=Workspace(tmp_path/'space');fs=FileService(w);fs.create('','旧目录','folder')
    doc=w.ingest(pdf_bytes(),'原件.pdf',2,directory='旧目录')
    (w.root/'旧目录/原件.pdf').unlink();(w.root/'旧目录').rmdir()
    fs.create('','新目录','folder')
    result=w.ingest(pdf_bytes(),'原件.pdf',2,directory='新目录')
    assert result['id']==doc['id'] and result['restored']
    assert result['rel_path']=='新目录/原件.pdf'
    assert not (w.root/'旧目录').exists()
