from pathlib import Path
import pytest

from backend.files import FileService
from backend.recycle import active_deleted_paths
from backend.storage import Workspace,StoreError
from backend.tests.test_reading import pdf_bytes,session


@pytest.fixture
def system_bin(tmp_path,monkeypatch):
    location=tmp_path/'simulated-system-bin';location.mkdir();calls=[]
    def recycle(path):
        calls.append(path)
        path.rename(location/path.name)
    monkeypatch.setattr('backend.files.send_to_system_trash',recycle)
    return location,calls


def test_system_recycle_restores_original_identity_notes_and_plans(session,system_bin):
    client,base,app,info=session;root=Path(info['path']);location,calls=system_bin
    client.post(base+'/files',json={'kind':'folder','parent':'','name':'课题'})
    paper=client.post(base+'/imports',data={'directory':'课题'},files={'file':('原件.pdf',pdf_bytes(),'application/pdf')}).json()
    note=client.get(base+f'/documents/{paper["id"]}/note').json()
    assert client.put(base+f'/documents/{paper["id"]}/note',json={'markdown':'## 要保留的证据','expected_revision':note['revision'],'path':'课题/阅读.md'}).status_code==200
    original=client.get(base+'/plans').json()['plans'][0]
    response=client.post(base+'/files/delete',json={'path':'课题'})
    assert response.status_code==200 and response.json()['destination']=='system_trash'
    assert calls==[root/'课题'] and not (root/'课题').exists()
    assert not (root/'.lexivault/trash').exists()
    assert client.get(base+'/documents').json()==[]
    assert client.get(base+'/plans').json()['plans']==[]
    assert client.get(base+'/files/trash').json()==[]
    (location/'课题').rename(root/'课题')
    assert client.get(base+'/documents').json()[0]['id']==paper['id']
    assert client.get(base+f'/documents/{paper["id"]}/note').json()['markdown']=='## 要保留的证据'
    restored=client.get(base+'/plans').json()['plans'][0]
    assert restored['id']==original['id'] and not restored['deletedAt']
    assert active_deleted_paths(app.state.registry.get(info['id']))==set()


def test_recycle_error_keeps_file_and_rolls_back_markers(tmp_path,monkeypatch):
    workspace=Workspace(tmp_path/'space');service=FileService(workspace)
    service.create('','保留.md','markdown');original=(workspace.root/'保留.md').read_bytes()
    def fail(path):raise OSError('Unavailable system recycle bin')
    monkeypatch.setattr('backend.files.send_to_system_trash',fail)
    with pytest.raises(StoreError) as error:service.delete('保留.md')
    assert error.value.status==503
    assert (workspace.root/'保留.md').read_bytes()==original
    assert active_deleted_paths(workspace)==set()


@pytest.mark.parametrize('path',['','../outside','/absolute','C:/outside','.lexivault/library.sqlite','.git/config','folder/../x','CON.md'])
def test_recycle_cannot_escape_workspace(tmp_path,system_bin,path):
    service=FileService(Workspace(tmp_path/'space'))
    with pytest.raises(StoreError):service.delete(path)
    assert system_bin[1]==[]


def test_old_delete_route_uses_system_recycling(session,system_bin):
    client,base,_,info=session
    client.post(base+'/files',json={'kind':'folder','name':'旧入口'})
    response=client.post(base+'/files/trash',json={'path':'旧入口'})
    assert response.status_code==200 and response.json()['destination']=='system_trash'
    assert system_bin[1]==[Path(info['path'])/'旧入口']
