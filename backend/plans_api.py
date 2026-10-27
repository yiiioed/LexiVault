"""Local plan file API. Uploads share the reader's same-origin session protection."""
import asyncio
import json

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError

from .plans import PlanStore
from .storage import StoreError


class Entry(BaseModel):
    plan: dict
    expected_revision: int = Field(ge=0)
    markdown: str = Field(max_length=8*1024*1024)


class Manifest(BaseModel):
    plans: list[Entry] = Field(min_length=1,max_length=2000)
    files: list[dict] = Field(default_factory=list,max_length=2048)


class Preference(BaseModel):
    value: object = None


class AttachmentRemoval(BaseModel):
    expected_revision: int = Field(ge=1)


def plan_router(registry):
    router=APIRouter(prefix='/api/workspaces/{workspace_id}/plans',tags=['plans'])

    def store(identity):
        return PlanStore(registry.get(identity))

    @router.get('')
    def plans(workspace_id: str):
        source=store(workspace_id)
        plans=source.all()
        warnings=source.discovered_errors+[{'id':identity,'message':error} for identity,error in source.errors.items()]
        return {'plans':plans,'warnings':warnings}

    async def save(workspace_id,manifest,uploads,only_new=False):
        try:
            if len(manifest.encode())>24*1024*1024:
                raise StoreError('保存数据过大。',413)
            try:
                payload=Manifest.model_validate_json(manifest)
            except (ValueError,ValidationError):
                raise StoreError('计划批次格式无效。',422)
            if len(uploads)!=len(payload.files):
                raise StoreError('附件数量不匹配。',422)
            files=[];total=0
            for meta,upload in zip(payload.files,uploads):
                data=await upload.read(50*1024*1024+1)
                total+=len(data)
                if len(data)>50*1024*1024 or total>100*1024*1024:
                    raise StoreError('单附件最多 50 MiB，单批次最多 100 MiB。',413)
                files.append((meta,data))
            return await asyncio.to_thread(store(workspace_id).save_batch,[entry.model_dump() for entry in payload.plans],files,only_new)
        finally:
            for upload in uploads:
                await upload.close()

    @router.post('')
    async def put(workspace_id: str,manifest: str=Form(),uploads: list[UploadFile]=File(default=[])):
        return await save(workspace_id,manifest,uploads)

    @router.post('/import')
    async def import_batch(workspace_id: str,manifest: str=Form(),uploads: list[UploadFile]=File(default=[])):
        return await save(workspace_id,manifest,uploads,True)

    @router.get('/files')
    def files(workspace_id: str):
        return store(workspace_id).files()

    @router.get('/files/{file_id}')
    def file(workspace_id: str,file_id: str):
        path,meta=store(workspace_id).file(file_id)
        return FileResponse(path,filename=meta['name'],media_type='application/octet-stream',content_disposition_type='attachment')

    @router.post('/files/{file_id}/remove')
    def remove_file(workspace_id: str,file_id: str,body: AttachmentRemoval):
        source=store(workspace_id)
        with source.lock:
            source.scan()
            with source.workspace.db() as db:
                db.execute('BEGIN IMMEDIATE')
                file=db.execute('SELECT * FROM plan_files WHERE id=?',(file_id,)).fetchone()
                if not file:
                    raise StoreError('附件不存在。',404)
                plan=db.execute('SELECT * FROM plans WHERE id=?',(file['plan_id'],)).fetchone()
                if plan['revision']!=body.expected_revision or plan['missing'] or plan['id'] in source.errors:
                    raise StoreError('计划已被修改，未解除附件关联。请先重载。',409)
                meta=json.loads(plan['metadata_json'])
                meta['attachmentIds']=[identity for identity in meta['attachmentIds'] if identity!=file_id]
                db.execute('UPDATE plans SET metadata_json=?,revision=revision+1 WHERE id=?',(json.dumps(meta,ensure_ascii=False),plan['id']))
                # Unlink in the application only. Never erase the user's local original.
                db.execute('DELETE FROM plan_files WHERE id=?',(file_id,))
        return {'removed':True}

    @router.get('/preferences/{key}')
    def preference(workspace_id: str,key: str):
        return {'value':store(workspace_id).preference(key)}

    @router.put('/preferences/{key}')
    def set_preference(workspace_id: str,key: str,body: Preference):
        return {'value':store(workspace_id).preference(key,body.value,True)}

    return router
