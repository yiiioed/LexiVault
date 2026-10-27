import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .auth_api import create_account_app


def main():
    parser = argparse.ArgumentParser(description="LexiVault 本地文献阅读服务")
    parser.add_argument("--port", type=int, default=8000)
    default_data = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "LexiVault"
    parser.add_argument("--data-dir", type=Path, default=default_data)
    parser.add_argument("--workspace", type=Path, help="打开或初始化指定目录作为工作空间")
    parser.add_argument("--account-service", action='store_true', help='只启动可独立部署的账号服务，不打开论文工作空间')
    parser.add_argument("--host", default='127.0.0.1', help='账号独立服务的监听地址；本地阅读服务仅允许 127.0.0.1')
    args = parser.parse_args()
    if not args.account_service and args.host != '127.0.0.1':
        parser.error('本地阅读服务仅允许监听 127.0.0.1。')
    if args.account_service and args.workspace:
        parser.error('账号独立服务不读取本地工作空间，请移除 --workspace。')
    app = create_account_app(args.data_dir) if args.account_service else create_app(args.data_dir, Path(__file__).resolve().parents[1] / "frontend" / "dist")
    if args.workspace and not args.account_service:
        app.state.registry.add(args.workspace)
    if args.account_service:
        print(f"独立账号接口：http://{args.host}:{args.port}/api/auth/me（部署需 HTTPS）")
    else:
        print(f"文献阅读：http://127.0.0.1:{args.port}/reader.html")
    print(f"工作空间登记目录：{args.data_dir.resolve()}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
