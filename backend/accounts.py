"""Account identities are separate from portable local research workspaces."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .database import connect, tables
from .storage import StoreError


class AccountStore:
    def __init__(self, path: Path, clock=time.time):
        self.path, self.clock = path, clock
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            raise StoreError('账号数据库不能是符号链接。')
        self.passwords = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
        self.dummy_hash = self.passwords.hash(secrets.token_urlsafe(24))
        with connect(path) as db:
            if tables(db):
                if 'account_meta' not in tables(db):
                    raise StoreError('账号目录中存在其他数据库。')
                version = db.execute("SELECT value FROM account_meta WHERE key='schema_version'").fetchone()
                if version and int(version[0]) > 1:
                    raise StoreError('账号数据库来自更新版本，请升级程序。')
            db.executescript("""
                CREATE TABLE IF NOT EXISTS account_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS users(
                    id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,
                    password_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
                    created_at REAL NOT NULL,updated_at REAL NOT NULL,last_login_at REAL);
                CREATE TABLE IF NOT EXISTS sessions(
                    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,created_at REAL NOT NULL,expires_at REAL NOT NULL,
                    remembered INTEGER NOT NULL DEFAULT 0,revoked_at REAL);
                CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE TABLE IF NOT EXISTS user_settings(
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    settings_json TEXT NOT NULL DEFAULT '{}',updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS account_tokens(
                    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
                    token_hash TEXT NOT NULL UNIQUE,expires_at REAL NOT NULL,used_at REAL);
                CREATE TABLE IF NOT EXISTS auth_attempts(key_hash TEXT NOT NULL,created_at REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS auth_attempts_key ON auth_attempts(key_hash,created_at);
            """)
            version = db.execute("SELECT value FROM account_meta WHERE key='schema_version'").fetchone()
            if version and int(version[0]) > 1:
                raise StoreError("账号数据库来自更新版本，请升级程序。")
            db.execute("INSERT OR IGNORE INTO account_meta VALUES('schema_version','1')")

    @staticmethod
    def normalize_email(email):
        email = email.strip()
        try:
            local, domain = email.rsplit('@', 1)
            domain = domain.encode('idna').decode('ascii').lower()
        except (ValueError, UnicodeError):
            raise StoreError("请输入有效邮箱。", 422, code="invalidEmail")
        if (len(email) > 254 or not 1 <= len(local) <= 64 or local.startswith('.') or local.endswith('.') or '..' in local
            or re.search(r'[\s@<>(),:;"\\\[\]]', local) or '.' not in domain
            or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in domain.split('.'))):
            raise StoreError("请输入有效邮箱。", 422, code="invalidEmail")
        return local.casefold() + '@' + domain

    @staticmethod
    def validate_password(password):
        if not 8 <= len(password) <= 128 or not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
            raise StoreError("密码需为 8–128 个字符，并包含字母与数字。", 422, code="invalidPassword")

    def rate_limit(self, kind, identity, limit=10, window=300):
        key = hashlib.sha256(f'{kind}\0{identity}'.encode()).hexdigest()
        now = self.clock()
        with connect(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("DELETE FROM auth_attempts WHERE created_at<?", (now - 3600,))
            count = db.execute("SELECT COUNT(*) FROM auth_attempts WHERE key_hash=? AND created_at>?", (key,now-window)).fetchone()[0]
            if count >= limit:
                raise StoreError("操作过于频繁，请稍后重试。", 429, code="rateLimited", retry_after=window)
            db.execute("INSERT INTO auth_attempts VALUES(?,?)", (key,now))

    @staticmethod
    def public(user):
        return {key: user[key] for key in ('id','email','nickname','created_at')}

    def register(self, email, password, nickname='', ip='local'):
        email = self.normalize_email(email)
        self.validate_password(password)
        self.rate_limit('register', ip, limit=20, window=3600)
        hashed, now, identity = self.passwords.hash(password), self.clock(), uuid.uuid4().hex
        try:
            with connect(self.path) as db:
                db.execute("INSERT INTO users(id,email,nickname,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                           (identity,email,(nickname.strip() or email.split('@')[0])[:80],hashed,now,now))
                db.execute("INSERT INTO user_settings VALUES(?,'{}',?)", (identity,now))
        except sqlite3.IntegrityError:
            raise StoreError("该邮箱已注册，请直接登录。", 409, code="emailExists")
        return self.public(self.user(identity))

    def user(self, user_id):
        with connect(self.path) as db:
            return db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()

    def login(self, email, password, remember=False, ip='local', old_token=None):
        self.rate_limit('login-ip', ip, limit=60)
        try:
            email = self.normalize_email(email)
        except StoreError:
            email = '<invalid>'
        self.rate_limit('login-email', email)
        with connect(self.path) as db:
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        try:
            self.passwords.verify(user['password_hash'] if user else self.dummy_hash, password)
            okay = user and user['status'] == 'active'
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            okay = False
        if not okay:
            raise StoreError("邮箱或密码不正确。", 401, code="invalidCredentials")
        with connect(self.path) as db:
            new_hash = self.passwords.hash(password) if self.passwords.check_needs_rehash(user['password_hash']) else user['password_hash']
            # Recheck the hash so a concurrent password change cannot issue an old-password session.
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute("UPDATE users SET password_hash=?,last_login_at=? WHERE id=? AND password_hash=? AND status='active'",
                                 (new_hash,self.clock(),user['id'],user['password_hash'])).rowcount
            if not changed:
                raise StoreError("账号状态已变化，请重新登录。", 401, code="invalidCredentials")
            self._revoke(db, old_token)
            return self._new_session(db, user['id'], remember)

    def _new_session(self, db, user_id, remember):
        raw, now = secrets.token_urlsafe(32), self.clock()
        lifetime = 30 * 86400 if remember else 12 * 3600
        db.execute("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,remembered) VALUES(?,?,?,?,?,?)",
                   (uuid.uuid4().hex,user_id,hashlib.sha256(raw.encode()).hexdigest(),now,now+lifetime,int(remember)))
        return raw, lifetime

    @staticmethod
    def csrf(raw):
        return hmac.new(raw.encode(), b'lexivault-account-csrf-v1', hashlib.sha256).hexdigest()

    def current(self, raw):
        if not raw or len(raw) > 256:
            return None
        with connect(self.path) as db:
            row = db.execute("""SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
                WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'""",
                (hashlib.sha256(raw.encode()).hexdigest(),self.clock())).fetchone()
        return self.public(row) if row else None

    def _revoke(self, db, raw):
        if raw:
            db.execute("UPDATE sessions SET revoked_at=? WHERE token_hash=?", (self.clock(),hashlib.sha256(raw.encode()).hexdigest()))

    def logout(self, raw):
        with connect(self.path) as db:
            self._revoke(db, raw)

    def settings(self, user_id):
        with connect(self.path) as db:
            row = db.execute("SELECT settings_json FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
        return {'theme': 'light', 'font_size': 14} | (json.loads(row[0]) if row else {})

    def update_settings(self, user_id, settings):
        with connect(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT settings_json FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
            merged = (json.loads(row[0]) if row else {}) | settings
            db.execute("INSERT INTO user_settings VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at",
                       (user_id,json.dumps(merged),self.clock()))
        return self.settings(user_id)
