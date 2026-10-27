"""Native OS recycling, with original-path markers for automatic re-indexing."""
import json
import sys
from pathlib import Path

DELETED_PATHS_KEY = 'system_recycled_paths'


def send_to_system_trash(path: Path):
    if sys.platform != 'win32':
        from send2trash import send2trash
        send2trash(str(path))
        return
    # Use IFileOperation explicitly; never fall back to permanent deletion.
    import pythoncom
    from win32com.shell import shell, shellcon
    from win32com.server.exception import COMException
    from send2trash.win.IFileOperationProgressSink import FileOperationProgressSink

    class RecycleOnlySink(FileOperationProgressSink):
        failure = 0

        def PreDeleteItem(self, flags, item):
            if not flags & shellcon.TSF_DELETE_RECYCLE_IF_POSSIBLE:
                raise COMException('System recycling is unavailable', scode=-2147467260)
            return 0

        def PostDeleteItem(self, flags, item, hr_delete, newly_created):
            if hr_delete < 0:
                self.failure = hr_delete

    pythoncom.CoInitialize()
    try:
        operation = pythoncom.CoCreateInstance(shell.CLSID_FileOperation, None, pythoncom.CLSCTX_ALL, shell.IID_IFileOperation)
        operation.SetOperationFlags(shellcon.FOF_NOCONFIRMATION | shellcon.FOF_NOERRORUI | shellcon.FOF_SILENT
                                   | shellcon.FOFX_EARLYFAILURE | 0x00080000 | 0x20000000)
        callback = RecycleOnlySink()
        sink = pythoncom.WrapObject(callback, shell.IID_IFileOperationProgressSink)
        item = shell.SHCreateItemFromParsingName(str(path), None, shell.IID_IShellItem)
        operation.DeleteItem(item, sink)
        result = operation.PerformOperations()
        if result or callback.failure or operation.GetAnyOperationsAborted():
            raise OSError('System recycling failed or was cancelled')
    finally:
        pythoncom.CoUninitialize()


def read_deleted_paths(db):
    row = db.execute('SELECT value_json FROM workspace_settings WHERE key=?', (DELETED_PATHS_KEY,)).fetchone()
    return set(json.loads(row[0])) if row else set()


def write_deleted_paths(db, paths):
    db.execute('INSERT OR REPLACE INTO workspace_settings VALUES(?,?)', (DELETED_PATHS_KEY, json.dumps(sorted(paths), ensure_ascii=False)))


def active_deleted_paths(workspace):
    from .storage import within
    with workspace.lock, workspace.db() as db:
        previous = read_deleted_paths(db)
        remaining = {path for path in previous if not within(workspace.root, path).exists()}
        if remaining != previous:
            write_deleted_paths(db, remaining)
        return remaining


def is_recycled(path, deleted):
    return any(path == parent or path.startswith(parent + '/') for parent in deleted)
