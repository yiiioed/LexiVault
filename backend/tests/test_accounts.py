from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.accounts import AccountStore
from backend.app import create_app
from backend.auth_api import COOKIE, create_account_app
from backend.database import connect
from backend.storage import StoreError

PASSWORD = 'ReadingNotes2026'


def test_passwords_are_salted_argon2_and_duplicate_email_is_rejected(tmp_path):
    store = AccountStore(tmp_path/'accounts.sqlite')
    user = store.register(' Student@Example.COM ',PASSWORD)
    assert user['email'] == 'student@example.com' and 'password_hash' not in user
    with connect(store.path) as db:
        hashed = db.execute('SELECT password_hash FROM users').fetchone()[0]
        assert hashed.startswith('$argon2id$') and hashed != PASSWORD
    assert store.passwords.verify(hashed,PASSWORD)
    assert PASSWORD.encode() not in store.path.read_bytes()
    with pytest.raises(StoreError) as error:
        store.register('STUDENT@example.com',PASSWORD)
    assert error.value.status == 409


def test_session_hashes_rotation_expiry_revocation_and_persistence(tmp_path):
    clock = [1000.0]
    store = AccountStore(tmp_path/'accounts.sqlite',clock=lambda:clock[0])
    user = store.register('user@example.com',PASSWORD)
    raw,lifetime = store.login(user['email'],PASSWORD,remember=True)
    assert lifetime == 30*86400 and store.current(raw)['id'] == user['id']
    with connect(store.path) as db:
        assert db.execute('SELECT token_hash FROM sessions').fetchone()[0] != raw
    restarted = AccountStore(store.path,clock=lambda:clock[0])
    assert restarted.current(raw)['id'] == user['id']
    second,_ = store.login(user['email'],PASSWORD,old_token=raw)
    assert second != raw and store.current(raw) is None
    store.logout(second); assert store.current(second) is None
    third,_ = store.login(user['email'],PASSWORD)
    clock[0] += 12*3600+1
    assert store.current(third) is None


def test_invalid_passwords_disabled_users_and_rate_limit(tmp_path):
    store = AccountStore(tmp_path/'accounts.sqlite')
    with pytest.raises(StoreError):
        store.register('bad@example.com','short')
    user = store.register('user@example.com',PASSWORD)
    for _ in range(10):
        with pytest.raises(StoreError) as error:
            store.login('user@example.com','wrong')
        assert error.value.status == 401
    with pytest.raises(StoreError) as error:
        store.login('user@example.com','wrong')
    assert error.value.status == 429
    other = store.register('disabled@example.com',PASSWORD)
    with connect(store.path) as db:
        db.execute("UPDATE users SET status='disabled' WHERE id=?",(other['id'],))
    with pytest.raises(StoreError) as disabled:
        store.login('disabled@example.com',PASSWORD,ip='another-device')
    assert disabled.value.status == 401


def test_local_auth_api_cookie_csrf_settings_logout_and_guest_reading(tmp_path):
    application = create_app(tmp_path/'本机配置')
    with TestClient(application) as client:
        token = client.get('/api/session').json()['token']; client.headers['x-lexivault-token'] = token
        assert client.get('/api/auth/me').json() == {'user':None}
        assert client.post('/api/auth/register',json={'email':'user@example.com','password':PASSWORD}).status_code == 201
        login = client.post('/api/auth/login',json={'email':'user@example.com','password':PASSWORD,'remember':True})
        assert login.status_code == 200,login.text
        assert 'HttpOnly' in login.headers['set-cookie'] and 'SameSite=strict' in login.headers['set-cookie']
        assert 'Max-Age=2592000' in login.headers['set-cookie']
        assert client.patch('/api/auth/settings',json={'theme':'dark'}).status_code == 403
        client.headers['x-account-csrf'] = login.json()['csrf_token']
        assert client.patch('/api/auth/settings',json={'theme':'dark','font_size':18}).json()['font_size'] == 18
        assert client.patch('/api/auth/settings',json={'api_key':'secret'}).status_code == 422
        assert client.get('/api/auth/me').json()['settings']['theme'] == 'dark'
        space = client.post('/api/workspaces',json={'name':'本地资料'}).json()
        assert client.post(f"/api/workspaces/{space['id']}/open").status_code == 200
        with connect(application.state.registry.database) as db:
            assert db.execute('SELECT last_user_id FROM workspace_registry').fetchone()[0] == login.json()['user']['id']
        assert client.post('/api/auth/logout',json={}).status_code == 200
        assert client.get('/api/auth/me').json()['user'] is None
        # Accounts identify users; they do not gate access to their own local files.
        assert client.get('/api/workspaces').status_code == 200
        reset = client.post('/api/auth/password-reset',json={'email':'user@example.com'})
        assert reset.status_code == 503 and reset.json()['code'] == 'resetUnavailable'


def test_account_only_service_has_secure_cookie_and_never_reads_workspaces(tmp_path):
    (tmp_path/'workspaces.json').write_text('[{"path":"unrelated-directory"}]',encoding='utf-8')
    app = create_account_app(tmp_path)
    with TestClient(app,base_url='https://accounts.example.test') as client:
        assert client.post('/api/auth/register',json={'email':'user@example.com','password':PASSWORD}).status_code == 201
        response = client.post('/api/auth/login',json={'email':'user@example.com','password':PASSWORD})
        assert 'Secure' in response.headers['set-cookie'] and 'HttpOnly' in response.headers['set-cookie']
        assert client.get('/api/auth/me').json()['user']['email'] == 'user@example.com'
        assert client.get('/api/workspaces').status_code == 404
        assert client.post('/api/auth/login',json={'email':'user@example.com','password':PASSWORD},headers={'origin':'https://evil.example'}).status_code == 403
        assert client.post('/api/auth/login',content='email=user@example.com',headers={'content-type':'application/x-www-form-urlencoded'}).status_code == 415
    assert not (tmp_path/'app.sqlite').exists()
    assert not (tmp_path/'library.sqlite').exists()


def test_newer_account_schema_is_not_modified(tmp_path):
    path = tmp_path/'accounts.sqlite'
    with connect(path) as db:
        db.execute('CREATE TABLE account_meta(key TEXT PRIMARY KEY,value TEXT)')
        db.execute("INSERT INTO account_meta VALUES('schema_version','99')")
    before = path.read_bytes()
    with pytest.raises(StoreError,match='更新版本'):
        AccountStore(path)
    assert path.read_bytes() == before
