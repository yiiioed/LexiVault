"""Explicit upgrade/status entry point; no web server and no account seed data."""
import argparse
import json
import os
import sqlite3
from pathlib import Path

from .accounts import AccountStore
from .database import connect
from .storage import Registry
from .plans import PlanStore


def status(data_dir):
    paths = [data_dir / 'accounts.sqlite',data_dir / 'app.sqlite']
    registry = data_dir / 'app.sqlite'
    if registry.exists():
        with sqlite3.connect(registry.as_uri() + '?mode=ro',uri=True) as db:
            paths += [Path(row[0]) / '.lexivault' / 'library.sqlite' for row in db.execute('SELECT root_path FROM workspace_registry')]
    elif (data_dir / 'workspaces.json').exists():
        paths += [Path(item['path']) / '.lexivault' / 'library.sqlite' for item in json.loads((data_dir / 'workspaces.json').read_text(encoding='utf-8'))]
    for path in paths:
        print(path)
        if not path.exists():
            print('  尚未创建')
            continue
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro',uri=True) as db:
            names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            print('  tables: ' + ', '.join(names))


def main():
    parser = argparse.ArgumentParser(description='LexiVault 数据库管理')
    parser.add_argument('command',choices=['upgrade','status'])
    parser.add_argument('--data-dir',type=Path,default=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share'))) / 'LexiVault')
    parser.add_argument('--workspace',type=Path,help='升级时登记并打开指定的资料目录')
    args = parser.parse_args()
    if args.command != 'upgrade' and args.workspace:
        parser.error('--workspace 只用于 upgrade。')
    root = args.data_dir.resolve()
    if args.command == 'upgrade':
        registry = Registry(root)
        AccountStore(root / 'accounts.sqlite')
        if args.workspace:
            registry.add(args.workspace)
        for workspace in registry.items.values():
            PlanStore(workspace)
            if workspace.migration_backup:
                print(f'升级备份：{workspace.migration_backup}')
    status(root)


if __name__ == '__main__':
    main()
