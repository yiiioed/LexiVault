"""Paths and enumeration shared by every workspace feature."""
import os
import re
from pathlib import Path

RESERVED={'.lexivault','.git','.hg','.svn','__pycache__','node_modules','.venv'}


def relative_path(value,root_allowed=False):
    from .storage import StoreError
    if not isinstance(value,str) or len(value)>1000:
        raise StoreError('文件路径无效。',422)
    value=value.replace('\\','/').strip('/') if not re.match(r'^[A-Za-z]:|^[\\/]',value) else None
    if value is None:raise StoreError('只能操作工作空间内的相对路径。',403)
    if value in ('','.'):
        if root_allowed:return ''
        raise StoreError('请选择文件或文件夹。',422)
    parts=value.split('/')
    for part in parts:
        if part in {'.','..'} or not part or part.startswith('.') or part.casefold() in RESERVED or re.search(r'[<>:"|?*\x00-\x1f]',part) or part.endswith((' ','.')):
            raise StoreError('路径包含保留名称或无效字符。',422)
        if part.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:
            raise StoreError('此名称由系统保留。',422)
    return '/'.join(parts)


def user_path(root,value,root_allowed=False):
    from .storage import StoreError
    rel=relative_path(value,root_allowed)
    candidate=root/rel
    cursor=root
    for part in Path(rel).parts:
        cursor=cursor/part
        if cursor.is_symlink() or (hasattr(cursor,'is_junction') and cursor.is_junction()):
            raise StoreError('不能通过链接操作工作空间外的文件。',403)
    if not candidate.resolve().is_relative_to(root.resolve()):raise StoreError('文件不在工作空间内。',403)
    return candidate


def visible_paths(root):
    for directory,folders,files in os.walk(root,followlinks=False):
        folders[:]=sorted([name for name in folders if not name.startswith('.') and name.casefold() not in RESERVED and not (Path(directory)/name).is_symlink() and not (hasattr(Path(directory)/name,'is_junction') and (Path(directory)/name).is_junction())],key=str.casefold)
        for name in folders:
            yield Path(directory)/name
        for name in sorted(files,key=str.casefold):
            path=Path(directory)/name
            if name.startswith('.') or path.is_symlink() or name=='library.sqlite' or name.endswith(('.sqlite-journal','.sqlite-wal','.sqlite-shm')):continue
            yield path


def unique_path(root,directory,name):
    folder=user_path(root,directory,True)
    if not folder.is_dir():
        from .storage import StoreError
        raise StoreError('目标文件夹不存在，请先创建。',404)
    name=relative_path(name)
    if '/' in name:
        from .storage import StoreError
        raise StoreError('请输入文件名，不包含目录。',422)
    path=folder/name
    if not path.exists():return path
    for i in range(2,10000):
        candidate=folder/f'{path.stem} ({i}){path.suffix}'
        if not candidate.exists():return candidate
    from .storage import StoreError
    raise StoreError('同名文件过多，请更换文件名。',409)
