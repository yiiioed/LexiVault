"""Catalog persistence endpoints. These do not search providers or download files."""
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, StringConstraints, model_validator

Author = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class SourceInput(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    provider: str = Field(min_length=1,max_length=80)
    external_id: str = Field(default='',max_length=400)
    url: AnyHttpUrl | Literal[''] = ''
    license_hint: str = Field(default='',max_length=500)


class DocumentInput(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    title: str = Field(min_length=1,max_length=500)
    authors: list[Author] = Field(default_factory=list,max_length=100)
    year: int | None = Field(default=None,ge=1000,le=2200)
    abstract: str = Field(default='',max_length=50000)
    doi: str | None = Field(default=None,max_length=512)
    document_type: Literal['paper','preprint','report','other'] = 'paper'
    source: SourceInput | None = None


class MetadataPatch(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None,min_length=1,max_length=500)
    authors: list[Author] | None = Field(default=None,max_length=100)
    year: int | None = Field(default=None,ge=1000,le=2200)
    abstract: str | None = Field(default=None,max_length=50000)
    doi: str | None = Field(default=None,max_length=512)
    document_type: Literal['paper','preprint','report','other'] | None = None
    reading_status: Literal['unread','reading','read'] | None = None

    @model_validator(mode='after')
    def required_values(self):
        for key in {'title','authors','abstract','document_type','reading_status'} & self.model_fields_set:
            if getattr(self,key) is None:
                raise ValueError(f'{key} 不能为 null')
        return self


class TagsInput(BaseModel):
    names: list[Tag] = Field(max_length=50)


class CollectionInput(BaseModel):
    name: str = Field(min_length=1,max_length=80)
    parent_id: str | None = Field(default=None,max_length=100)


class AnnotationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision_id: str = Field(min_length=1,max_length=100)
    page: int = Field(ge=1)
    quote: str = Field(default='',max_length=30000)
    comment: str = Field(default='',max_length=10000)
    bbox: tuple[float,float,float,float] | None = None


def catalog_router(registry):
    router = APIRouter(prefix='/api/workspaces/{workspace_id}', tags=['catalog'])

    @router.post('/documents',status_code=201)
    def create(workspace_id: str, body: DocumentInput):
        data = body.model_dump(exclude={'source'})
        return registry.get(workspace_id).create_metadata(data,body.source.model_dump(mode='json') if body.source else None)

    @router.get('/documents/{doc_id}')
    def detail(workspace_id: str, doc_id: str):
        workspace = registry.get(workspace_id)
        return workspace.public(workspace.document(doc_id)) | {'attachments': workspace.attachments(doc_id),'sources': workspace.sources(doc_id),'tags': workspace.tags(doc_id)}

    @router.patch('/documents/{doc_id}')
    def update(workspace_id: str, doc_id: str, body: MetadataPatch):
        return registry.get(workspace_id).update_metadata(doc_id,body.model_dump(exclude_unset=True,exclude={'expected_version'}),body.expected_version)

    @router.get('/documents/{doc_id}/attachments')
    def attachments(workspace_id: str, doc_id: str):
        return registry.get(workspace_id).attachments(doc_id)

    @router.get('/documents/{doc_id}/sources')
    def sources(workspace_id: str, doc_id: str):
        return registry.get(workspace_id).sources(doc_id)

    @router.post('/documents/{doc_id}/sources',status_code=201)
    def add_source(workspace_id: str, doc_id: str, body: SourceInput):
        return registry.get(workspace_id).add_source(doc_id,body.model_dump(mode='json'))

    @router.get('/tags')
    def all_tags(workspace_id: str):
        return registry.get(workspace_id).tags()

    @router.get('/documents/{doc_id}/tags')
    def tags(workspace_id: str, doc_id: str):
        return registry.get(workspace_id).tags(doc_id)

    @router.put('/documents/{doc_id}/tags')
    def set_tags(workspace_id: str, doc_id: str, body: TagsInput):
        return registry.get(workspace_id).set_tags(doc_id,body.names)

    @router.get('/collections')
    def collections(workspace_id: str):
        return registry.get(workspace_id).collections()

    @router.post('/collections',status_code=201)
    def collection(workspace_id: str, body: CollectionInput):
        return registry.get(workspace_id).create_collection(body.name,body.parent_id)

    @router.put('/collections/{collection_id}/documents/{doc_id}')
    def collect(workspace_id: str, collection_id: str, doc_id: str):
        return registry.get(workspace_id).collect(collection_id,doc_id)

    @router.get('/documents/{doc_id}/annotations')
    def annotations(workspace_id: str, doc_id: str):
        return registry.get(workspace_id).annotations(doc_id)

    @router.post('/documents/{doc_id}/annotations',status_code=201)
    def annotate(workspace_id: str, doc_id: str, body: AnnotationInput):
        return registry.get(workspace_id).add_annotation(doc_id,body.model_dump())

    @router.get('/documents/{doc_id}/citations')
    def citations(workspace_id: str, doc_id: str):
        return registry.get(workspace_id).citations(doc_id)

    @router.get('/jobs')
    def jobs(workspace_id: str):
        return registry.get(workspace_id).jobs()

    return router
