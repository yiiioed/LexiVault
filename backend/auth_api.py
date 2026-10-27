from __future__ import annotations

import secrets
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .accounts import AccountStore
from .storage import StoreError

COOKIE = 'lv_account_session'


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class Registration(Credentials):
    nickname: str = Field(default='', max_length=80)


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    theme: Literal['light','dark'] | None = None
    font_size: int | None = Field(default=None, ge=12, le=26)


def account_router(store: AccountStore, secure_cookies=False):
    router = APIRouter(prefix='/api/auth', tags=['accounts'])

    def user(request, csrf=False):
        raw = request.cookies.get(COOKIE)
        identity = store.current(raw)
        if not identity:
            raise StoreError('请先登录账号。', 401, code='loginRequired')
        if csrf and not secrets.compare_digest(request.headers.get('x-account-csrf',''), store.csrf(raw)):
            raise StoreError('账号请求校验失败，请刷新页面。', 403)
        return identity

    @router.post('/register', status_code=201)
    def register(body: Registration, request: Request):
        return {'user': store.register(body.email,body.password,body.nickname,request.client.host if request.client else 'unknown')}

    @router.post('/login')
    def login(body: Credentials, request: Request, response: Response):
        raw, lifetime = store.login(body.email,body.password,body.remember,request.client.host if request.client else 'unknown',request.cookies.get(COOKIE))
        response.set_cookie(COOKIE, raw, httponly=True, secure=secure_cookies, samesite='strict',
                            max_age=lifetime if body.remember else None, path='/')
        return {'user': store.current(raw), 'csrf_token': store.csrf(raw), 'settings': store.settings(store.current(raw)['id'])}

    @router.get('/me')
    def current(request: Request):
        identity = store.current(request.cookies.get(COOKIE))
        if not identity:
            return {'user': None}
        return {'user': identity, 'csrf_token': store.csrf(request.cookies[COOKIE]), 'settings': store.settings(identity['id'])}

    @router.post('/logout')
    def logout(request: Request, response: Response):
        raw = request.cookies.get(COOKIE)
        if store.current(raw):
            user(request, csrf=True)
        store.logout(raw)
        response.delete_cookie(COOKIE, path='/', secure=secure_cookies, httponly=True, samesite='strict')
        return {'signed_out': True}

    @router.get('/settings')
    def settings(request: Request):
        return store.settings(user(request)['id'])

    @router.patch('/settings')
    def save_settings(body: SettingsPatch, request: Request):
        return store.update_settings(user(request, csrf=True)['id'],body.model_dump(exclude_none=True))

    @router.post('/password-reset')
    def password_reset():
        raise StoreError('邮件服务尚未配置，暂不支持通过邮件重置密码。', 503, code='resetUnavailable')

    return router


def create_account_app(data_dir: Path, secure_cookies=True):
    """Deployable account-only service. It never opens any local paper workspace."""
    store = AccountStore(data_dir / 'accounts.sqlite')
    app = FastAPI(title='LexiVault account service')
    app.state.accounts = store

    @app.exception_handler(StoreError)
    async def failure(request, error):
        return JSONResponse({'message': error.message, **error.details},status_code=error.status)

    @app.middleware('http')
    async def origin_check(request, call_next):
        origin = request.headers.get('origin')
        if (origin and origin != str(request.base_url).rstrip('/')) or request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'message': '拒绝跨站点账号请求。'},status_code=403)
        if request.method not in {'GET','HEAD','OPTIONS'} and 'application/json' not in request.headers.get('content-type',''):
            return JSONResponse({'message': '账号接口仅接受 JSON 请求。'},status_code=415)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    app.include_router(account_router(store,secure_cookies))
    return app
