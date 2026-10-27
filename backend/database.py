"""SQLite connection, consistent backup and transactional schema upgrades."""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def connect(path: Path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=15000")
    try:
        with db:
            yield db
    finally:
        db.close()


def backup(path: Path, label: str) -> Path:
    """Use SQLite's backup API, including committed changes in journal/WAL files."""
    directory = path.parent / "backups"
    directory.mkdir(exist_ok=True)
    if directory.resolve().parent != path.parent.resolve():
        raise ValueError("数据库备份目录不能指向工作空间外。")
    destination = directory / f"{path.stem}-{label}-{time.time_ns()}.sqlite"
    with connect(path) as source, connect(destination) as target:
        source.backup(target)
    return destination


def tables(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
