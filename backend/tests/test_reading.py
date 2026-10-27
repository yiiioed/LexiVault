import io
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.app import create_app
from backend.storage import NOTE_HEADER, Registry, StoreError, Workspace, within


def pdf_bytes(pages=2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=400, height=600)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture
def session(tmp_path):
    app = create_app(tmp_path / "配置")
    with TestClient(app) as client:
        token = client.get("/api/session").json()["token"]
        client.headers["x-lexivault-token"] = token
        workspace = client.post("/api/workspaces", json={"name": "中文课题"}).json()
        base = f"/api/workspaces/{workspace['id']}"
        yield client, base, app, workspace


def upload(client, base, data=None, name="论文.pdf"):
    response = client.post(base + "/imports", files={"file": (name, pdf_bytes() if data is None else data, "application/pdf")})
    assert response.status_code == 201, response.text
    return response.json()


def test_import_dedup_and_workspace_isolation(session):
    client, base, _, _ = session
    document = upload(client, base)
    assert upload(client, base)["duplicate"]
    other = client.post("/api/workspaces", json={"name": "另一课题"}).json()
    other_base = f"/api/workspaces/{other['id']}"
    assert client.get(other_base + "/documents").json() == []
    assert client.get(other_base + f"/documents/{document['id']}/note").status_code == 404
    same_name = upload(client, base, pdf_bytes(3))
    assert same_name["id"] != document["id"]
    assert len(client.get(base + "/documents").json()) == 2


def test_note_real_file_restart_and_reading_position(session):
    client, base, app, info = session
    document = upload(client, base)
    path = f"{base}/documents/{document['id']}"
    note = client.get(path + "/note").json()
    markdown = "## 方法\n自己的理解\n\n[文件第 2 页](paper://" + document["id"] + "?revision=" + document["sha256"] + "&page=2)"
    saved = client.put(path + "/note", json={"markdown": markdown, "expected_revision": note["revision"]})
    assert saved.status_code == 200
    assert Path(saved.json()["path"]).read_text(encoding="utf-8").endswith(markdown)
    assert client.put(path + "/position", json={"page": 2}).status_code == 200
    assert client.put(path + "/position", json={"page": 0}).status_code == 422
    assert client.put(path + "/position", json={"page": 3}).status_code == 400
    restarted = Registry(app.state.registry.root).get(info["id"])
    assert restarted.note(document["id"])["markdown"] == markdown
    assert restarted.documents()[0]["last_page"] == 2


def test_external_edit_conflict_copy_and_history(session):
    client, base, _, _ = session
    document = upload(client, base)
    path = f"{base}/documents/{document['id']}"
    note = client.get(path + "/note").json()
    note = client.put(path + "/note",json={"markdown":"初始笔记","expected_revision":note["revision"]}).json()
    note_file = Path(note["path"])
    note_file.write_text(NOTE_HEADER.format(id=document["id"]) + "外部编辑的新内容", encoding="utf-8")
    rejected = client.put(path + "/note", json={"markdown": "未保存的页面草稿", "expected_revision": note["revision"]})
    assert rejected.status_code == 409
    assert note_file.read_text(encoding="utf-8").endswith("外部编辑的新内容")
    assert rejected.json()["current"]["markdown"] == "外部编辑的新内容"
    copy = client.post(path + "/conflicts", json={"markdown": "未保存的页面草稿", "expected_revision": note["revision"]})
    assert Path(copy.json()["path"]).read_text(encoding="utf-8") == "未保存的页面草稿"
    new_note = client.get(path + "/note").json()
    assert client.put(path + "/note", json={"markdown": "后续修改", "expected_revision": new_note["revision"]}).status_code == 200
    history = client.get(path + "/history").json()
    assert any(client.get(path + "/history/" + version["id"]).json()["markdown"] == "外部编辑的新内容" for version in history)


def test_external_rename_delete_and_ambiguous_identity(session):
    client, base, app, info = session
    document = upload(client, base)
    path = f"{base}/documents/{document['id']}/note"
    first = client.get(path).json()
    first=client.put(path,json={"markdown":"初始笔记","expected_revision":first["revision"]}).json()
    old = Path(first["path"])
    renamed = old.with_name("读后笔记.md")
    old.rename(renamed)
    assert client.get(path).json()["path"] == str(renamed)
    renamed.unlink()
    assert client.get(path).json()["missing"]
    assert client.put(path, json={"markdown": "旧草稿", "expected_revision": first["revision"]}).status_code == 409
    for name in ["副本甲.md", "副本乙.md"]:
        (renamed.parent / name).write_text(NOTE_HEADER.format(id=document["id"]), encoding="utf-8")
    assert client.get(path).status_code == 409


def test_only_one_concurrent_save_can_win(tmp_path):
    workspace = Workspace(tmp_path / "workspace")
    doc = workspace.ingest(pdf_bytes(), "paper.pdf", 2)
    original = workspace.note(doc["id"])
    def save(text):
        try:
            return workspace.save_note(doc["id"], text, original["revision"])["markdown"]
        except StoreError as error:
            return error.status
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(save, ["窗口甲", "窗口乙"]))
    assert results.count(409) == 1
    assert workspace.note(doc["id"])["markdown"] in {"窗口甲", "窗口乙"}


def test_original_missing_replaced_and_revision_check(session):
    client, base, app, info = session
    doc = upload(client, base)
    workspace = app.state.registry.get(info["id"])
    original, _ = workspace.original(doc["id"])
    url = f"{base}/documents/{doc['id']}/file"
    assert client.get(url + "?revision=wrong").status_code == 409
    original.write_bytes(pdf_bytes(3))
    assert client.get(url).status_code == 409
    original.unlink()
    assert client.get(url).status_code == 404
    assert not client.get(base + "/documents").json()[0]["file_available"]
    assert client.get(f"{base}/documents/{doc['id']}/note").status_code == 200


@pytest.mark.parametrize("data", [b"<html>login page</html>", b"%PDF-broken"])
def test_bad_pdf_never_appears_as_imported(session, data):
    client, base, _, _ = session
    result = client.post(base + "/imports", files={"file": ("fake.pdf", data, "application/pdf")})
    assert result.status_code == 400
    assert client.get(base + "/documents").json() == []


def test_encrypted_pdf_rejected(session):
    client, base, _, _ = session
    writer = PdfWriter(); writer.add_blank_page(400, 600); writer.encrypt("password")
    stream = io.BytesIO(); writer.write(stream)
    assert client.post(base + "/imports", files={"file": ("secret.pdf", stream.getvalue())}).status_code == 400


def test_auth_cross_site_and_history_traversal(session):
    client, base, _, _ = session
    assert client.post("/api/workspaces", json={"name": "test"}, headers={"origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/session", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert client.get("/api/session", headers={"host": "evil.example"}).status_code == 403
    doc = upload(client, base)
    assert client.get(f"{base}/documents/{doc['id']}/history/not-a-hash").status_code == 404
    with TestClient(create_app(Path(client.get('/api/session').json()['data_dir']))) as unauthenticated:
        assert unauthenticated.get("/api/workspaces").status_code == 401


def test_paths_and_symlink_boundary(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    with pytest.raises(StoreError):
        within(root, "../outside.md")
    with pytest.raises(StoreError):
        within(root, str(tmp_path / "outside.md"))


def test_file_watch_notifies_external_changes(session):
    client, base, _, _ = session
    doc = upload(client, base)
    note_url = f"{base}/documents/{doc['id']}/note"
    note = client.get(note_url).json()
    note=client.put(note_url,json={"markdown":"初始笔记","expected_revision":note["revision"]}).json()
    with client.websocket_connect(base + "/events", headers={"origin": "http://testserver"}) as socket:
        Path(note["path"]).write_text(NOTE_HEADER.format(id=doc["id"]) + "从其他编辑器写入", encoding="utf-8")
        message = socket.receive_json()
        assert message["type"] == "workspace_changed"
        assert client.get(note_url).json()["markdown"] == "从其他编辑器写入"
