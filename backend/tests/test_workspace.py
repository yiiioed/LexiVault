import sqlite3

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.storage import Workspace


def test_current_workspace_and_conversations_are_isolated_and_survive_restart(tmp_path):
    app=create_app(tmp_path/'config')
    with TestClient(app) as client:
        client.headers['X-LexiVault-Token']=client.get('/api/session').json()['token']
        assert client.get('/api/workspace/current').json() is None
        first=client.post('/api/workspaces',json={'name':'空间甲'}).json()
        second=client.post('/api/workspaces',json={'name':'空间乙'}).json()
        assert client.get('/api/workspace/current').json()['id']==second['id']
        path=f"/api/workspaces/{first['id']}/assistant"
        assert client.get(path).json()['state']['conversations']==[]
        state={'conversations':[{'id':'chat-1','title':'我的问题','messages':[{'id':'m1','role':'user','text':'测试内容'}]}], 'notes':[], 'documents':[], 'activeId':'chat-1'}
        assert client.put(path,json={'expected_version':0,'state':state}).json()['version']==1
        assert client.put(path,json={'expected_version':0,'state':state}).status_code==409
        assert client.get(f"/api/workspaces/{second['id']}/assistant").json()['state']['conversations']==[]
        client.post(f"/api/workspaces/{first['id']}/open")
        assert client.get('/api/workspace/current').json()['id']==first['id']
    with TestClient(create_app(tmp_path/'config')) as restarted:
        restarted.get('/api/session')
        assert restarted.get('/api/workspace/current').json()['id']==first['id']
        saved=restarted.get(path).json()
        assert saved['state']['workspaceName']=='空间甲'
        assert saved['state']['conversations'][0]['messages'][0]['text']=='测试内容'


def test_invalid_duplicate_messages_cannot_erase_saved_conversations(tmp_path):
    with TestClient(create_app(tmp_path/'config')) as client:
        client.headers['X-LexiVault-Token']=client.get('/api/session').json()['token']
        workspace=client.post('/api/workspaces',json={'name':'测试'}).json()
        path=f"/api/workspaces/{workspace['id']}/assistant"
        chat={'id':'c','title':'真实对话','messages':[{'id':'m','role':'user','text':'保留'}]}
        assert client.put(path,json={'expected_version':0,'state':{'conversations':[chat]}}).status_code==200
        chat['messages'].append(chat['messages'][0])
        assert client.put(path,json={'expected_version':1,'state':{'conversations':[chat]}}).status_code==422
        assert len(client.get(path).json()['state']['conversations'][0]['messages'])==1


def test_v2_upgrade_backs_up_without_changing_document_files(tmp_path):
    root=tmp_path/'space'
    workspace=Workspace(root)
    doc=workspace.create_metadata({'title':'已有文献'})
    note=workspace.note(doc['id'])
    with sqlite3.connect(root/'.lexivault'/'library.sqlite') as db:
        for table in ('plan_files','plans','plan_preferences','messages','conversations','assistant_state','file_trash','workspace_settings'):
            db.execute(f'DROP TABLE {table}')
        db.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
        db.execute('DELETE FROM schema_migrations WHERE version>=3')
    upgraded=Workspace(root)
    assert upgraded.migration_backup.exists()
    assert upgraded.documents()[0]['title']=='已有文献'
    assert upgraded.note(doc['id'])['markdown']==note['markdown']
    with sqlite3.connect(upgraded.migration_backup) as old:
        assert old.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]=='2'
