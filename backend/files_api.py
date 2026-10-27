import asyncio
from fastapi import APIRouter,File,Form,UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from .files import FileService
from .storage import StoreError

class NewFile(BaseModel):
    parent:str=Field(default='',max_length=1000)
    name:str=Field(min_length=1,max_length=200)
    kind:str='markdown'
class MoveFile(BaseModel):
    source:str=Field(min_length=1,max_length=1000)
    destination:str=Field(min_length=1,max_length=1000)
class PathFile(BaseModel):
    path:str=Field(min_length=1,max_length=1000)

def files_router(registry):
    router=APIRouter(prefix='/api/workspaces/{workspace_id}/files',tags=['files'])
    def service(identity):return FileService(registry.get(identity))
    @router.get('')
    def tree(workspace_id:str):return service(workspace_id).tree()
    @router.post('')
    def create(workspace_id:str,body:NewFile):return service(workspace_id).create(body.parent,body.name,body.kind)
    @router.post('/move')
    def move(workspace_id:str,body:MoveFile):return service(workspace_id).move(body.source,body.destination)
    @router.post('/delete')
    def delete(workspace_id:str,body:PathFile):return service(workspace_id).delete(body.path)
    @router.post('/trash')
    def trash(workspace_id:str,body:PathFile):return service(workspace_id).delete(body.path)
    @router.get('/trash')
    def trash_list(workspace_id:str):return service(workspace_id).trash_items()
    @router.post('/trash/{identity}/restore')
    def restore(workspace_id:str,identity:str):return service(workspace_id).restore(identity)
    @router.post('/upload')
    async def upload(workspace_id:str,directory:str=Form(default=''),files:list[UploadFile]=File()):
        result=[]
        try:
            if len(files)>50:raise StoreError('请分批导入，每批最多 50 个文件。',413)
            for file in files:
                data=await file.read(50*1024*1024+1)
                item=await asyncio.to_thread(service(workspace_id).upload,directory,file.filename or 'file',data);result.append(item)
            return {'files':result}
        finally:
            for file in files:await file.close()
    @router.get('/content')
    def content(workspace_id:str,path:str):
        target=service(workspace_id).content(path)
        return FileResponse(target,filename=target.name,media_type='application/octet-stream',content_disposition_type='attachment')
    @router.post('/documents/{doc_id}/note')
    def attach(workspace_id:str,doc_id:str,body:PathFile):return registry.get(workspace_id).attach_note(doc_id,body.path)
    return router
