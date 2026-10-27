"""Serve browser modules consistently, independent of Windows file associations."""
from fastapi.staticfiles import StaticFiles


class FrontendStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.lower().endswith(('.js', '.mjs')) and response.status_code in (200, 206, 304):
            response.headers['Content-Type'] = 'text/javascript; charset=utf-8'
        return response
