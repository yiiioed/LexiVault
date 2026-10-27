import mimetypes
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import create_app


def test_browser_modules_ignore_windows_text_file_associations(tmp_path,monkeypatch):
    mimetypes.init()
    monkeypatch.setitem(mimetypes.types_map,'.mjs','text/plain')
    monkeypatch.setitem(mimetypes.types_map,'.js','text/plain')
    frontend=tmp_path/'frontend';(frontend/'vendor').mkdir(parents=True)
    (frontend/'vendor/pdf.worker.min.mjs').write_text('export const worker = true;',encoding='utf-8')
    (frontend/'reader.js').write_text('export const reader = true;',encoding='utf-8')
    with TestClient(create_app(tmp_path/'config',frontend)) as client:
        for path in ['/vendor/pdf.worker.min.mjs','/reader.js']:
            response=client.get(path)
            assert response.status_code==200
            assert response.headers['content-type']=='text/javascript; charset=utf-8'
            assert response.headers['x-content-type-options']=='nosniff'
            assert response.headers['cache-control']=='no-cache'
            assert 'export const' in response.text
            cached=client.get(path,headers={'if-none-match':response.headers['etag']})
            assert cached.status_code==304
            assert cached.headers['content-type']=='text/javascript; charset=utf-8'
        assert client.get('/vendor/missing.mjs').status_code==404


def test_real_bundled_pdf_worker_is_available_as_a_browser_module(tmp_path):
    frontend=Path(__file__).resolve().parents[2]/'frontend/dist'
    with TestClient(create_app(tmp_path/'config',frontend)) as client:
        response=client.get('/vendor/pdf.worker.min.mjs')
        assert response.status_code==200
        assert response.headers['content-type'].startswith('text/javascript')
        assert len(response.content)>100_000
        assert 'WorkerMessageHandler' in response.text
