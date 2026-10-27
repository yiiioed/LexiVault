"""Workspace-owned conversations, independent of browser and account identity."""
import json
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .storage import StoreError
from .database import connect


class AssistantInput(BaseModel):
    expected_version: int = Field(ge=0)
    state: dict


def read_state(workspace):
    with workspace.db() as db:
        saved = db.execute('SELECT version,state_json FROM assistant_state WHERE id=1').fetchone()
        state = json.loads(saved['state_json']) if saved else {}
        conversations = []
        for row in db.execute('SELECT * FROM conversations ORDER BY position'):
            messages = []
            for message in db.execute('SELECT * FROM messages WHERE conversation_id=? ORDER BY position',(row['id'],)):
                messages.append(dict(id=message['id'],role=message['role'],text=message['text'],service=bool(message['service']),citations=json.loads(message['citations_json'])))
            conversations.append(dict(id=row['id'],title=row['title'],liked=bool(row['liked']),demo=False,messages=messages))
        state.update(version=1,workspaceName=workspace.name,conversations=conversations)
        return {'version':saved['version'] if saved else 0,'state':state}


def workspace_router(registry):
    router = APIRouter(tags=['workspace'])

    @router.get('/api/workspace/current')
    def current():
        with registry.lock:
            with connect(registry.database) as db:
                rows = db.execute('SELECT id FROM workspace_registry ORDER BY last_opened_at DESC').fetchall()
            return next((registry.get(row['id']).info() for row in rows if row['id'] in registry.items),None)

    @router.get('/api/workspaces/{workspace_id}/assistant')
    def assistant(workspace_id: str):
        return read_state(registry.get(workspace_id))

    @router.put('/api/workspaces/{workspace_id}/assistant')
    def save_assistant(workspace_id: str, body: AssistantInput):
        workspace = registry.get(workspace_id)
        state = body.state.copy()
        if len(json.dumps(state,ensure_ascii=False).encode()) > 8*1024*1024:
            raise StoreError('对话数据过大，请导出备份后整理。',413)
        conversations = state.pop('conversations',[])
        if not isinstance(conversations,list) or len(conversations)>100:
            raise StoreError('对话格式无效。',422)
        ids=set(); message_ids=set()
        for conversation in conversations:
            if not isinstance(conversation,dict) or not isinstance(conversation.get('id'),str) or not 1<=len(conversation['id'])<=100 or conversation['id'] in ids:
                raise StoreError('对话标识无效或重复。',422)
            ids.add(conversation['id'])
            if not isinstance(conversation.get('title'),str) or len(conversation['title'])>120 or not isinstance(conversation.get('messages'),list) or len(conversation['messages'])>150:
                raise StoreError('对话格式无效。',422)
            for message in conversation['messages']:
                if not isinstance(message,dict) or not isinstance(message.get('id'),str) or not 1<=len(message['id'])<=100 or message['id'] in message_ids or message.get('role') not in {'user','assistant'} or not isinstance(message.get('text'),str) or len(message['text'])>50000:
                    raise StoreError('消息格式无效。',422)
                message_ids.add(message['id'])
                if not isinstance(message.get('citations',[]),list) or any(not isinstance(v,str) or len(v)>100 for v in message.get('citations',[])):
                    raise StoreError('引用格式无效。',422)
        with workspace.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT version FROM assistant_state WHERE id=1').fetchone()
            version = old[0] if old else 0
            if version != body.expected_version:
                raise StoreError('其他页面已更新对话，当前草稿已保留。请刷新后重试。',409)
            db.execute('DELETE FROM conversations')
            now=time.time()
            for index,c in enumerate(conversations):
                db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?)',(c['id'],c['title'],int(bool(c.get('liked'))),index,now,now))
                for position,m in enumerate(c['messages']):
                    db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(m['id'],c['id'],m['role'],m['text'],int(bool(m.get('service'))),json.dumps(m.get('citations',[])),position))
            db.execute('INSERT INTO assistant_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json',(version+1,json.dumps(state,ensure_ascii=False)))
        return {'version':version+1}

    return router
