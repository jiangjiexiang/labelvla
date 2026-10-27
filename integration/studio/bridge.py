import os
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from labelme.lerobot_server.app import create_app

root = Path('/data').resolve()
app = create_app()

def safe_dataset(dataset: str) -> Path:
    p = Path(dataset).resolve()
    if p == root or root not in p.parents or not (p / 'meta/info.json').is_file():
        raise HTTPException(400, '请选择 /data 下的数据集目录')
    return p

@app.get('/api/bridge/index')
def index(dataset: str):
    p = safe_dataset(dataset)
    files = []
    for f in p.rglob('*'):
        if f.is_file() and not f.is_symlink() and p in f.resolve().parents:
            files.append(f.relative_to(p).as_posix())
            if len(files) > 200000:
                raise HTTPException(400, '数据集文件数量超过上限')
    return {'files': files}

@app.get('/api/bridge/file')
def file(dataset: str, path: str):
    base = safe_dataset(dataset)
    p = (base / path).resolve()
    if base not in p.parents or not p.is_file():
        raise HTTPException(404, '文件不存在')
    return FileResponse(p)

app.mount('/studio', StaticFiles(directory='/integration/studio', html=True), name='studio')
