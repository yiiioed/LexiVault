"""Manual Windows integration check: recycle only our freshly-created QA folder."""
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.files import FileService
from backend.storage import Workspace


def main():
    from win32com.client import Dispatch
    import pythoncom
    root=Path(__file__).resolve().parents[1]/'local-data'/'system-recycle-qa'/'workspace'
    workspace=Workspace(root)
    name='LexiVault系统回收站验证-'+uuid.uuid4().hex[:10]
    target=workspace.root/name
    target.mkdir()
    (target/'验证.txt').write_text('Only a generated LexiVault integration test.',encoding='utf-8')
    result=FileService(workspace).delete(name)
    assert not target.exists()
    pythoncom.CoInitialize()
    try:
        items=Dispatch('Shell.Application').NameSpace(10).Items()
        found=next((item for item in items if item.Name==name),None)
        assert found is not None,'The generated folder was not found in Windows Recycle Bin'
        assert (Path(found.Path)/'验证.txt').read_text(encoding='utf-8')=='Only a generated LexiVault integration test.'
        print(json.dumps({'native_delete':result['destination'],'visible_in_windows_recycle_bin':True,'contents_preserved':True,'test_folder':name},ensure_ascii=False))
    finally:
        pythoncom.CoUninitialize()


if __name__=='__main__':main()
