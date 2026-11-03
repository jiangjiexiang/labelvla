"""Cancellation for platform-owned work and subprocesses only."""
import os
from contextlib import contextmanager
import signal
import shutil
import subprocess
import threading
import time
from fastapi import HTTPException

class TaskCancelled(HTTPException):
    def __init__(self): super().__init__(409, '任务已取消，处理已停止')

class TaskInterrupted(HTTPException):
    def __init__(self): super().__init__(503, '服务正在重启，任务将自动恢复')

_local = threading.local()
_lock = threading.RLock()
_events = {}
_processes = {}
_shutdown = threading.Event()

def bind(task_id):
    _local.task_id = task_id
    _local.checked = 0

def release():
    _local.task_id = None

def reset(task_id):
    with _lock: _events[task_id] = threading.Event()

def _terminate(process):
    if process.poll() is not None: return
    try: os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError: return
    try: process.wait(timeout=.5)
    except subprocess.TimeoutExpired:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()

def cancel(task_id):
    with _lock:
        _events.setdefault(task_id, threading.Event()).set()
        processes = list(_processes.get(task_id, ()))
    for process in processes: _terminate(process)

def begin_shutdown():
    _shutdown.set()
    with _lock: processes = [p for group in _processes.values() for p in group]
    for process in processes: _terminate(process)

def checkpoint(task_id=None, force=False):
    task_id = task_id if task_id is not None else getattr(_local, 'task_id', None)
    if _shutdown.is_set(): raise TaskInterrupted()
    if task_id is None: return
    with _lock:
        if _events.get(task_id, threading.Event()).is_set(): raise TaskCancelled()
    current = time.monotonic()
    if not force and current - getattr(_local, 'checked', 0) < .2: return
    _local.checked = current
    from .common import db_session
    with db_session() as db:
        row = db.execute('SELECT status FROM tasks WHERE id=?', (task_id,)).fetchone()
    if row is None or row['status'] == 'canceled': raise TaskCancelled()

def run_process(args, task_id=None, timeout=None, capture_output=False, **kwargs):
    task_id = task_id if task_id is not None else getattr(_local, 'task_id', None)
    checkpoint(task_id, force=True)
    if capture_output: kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    process = subprocess.Popen(args, start_new_session=True, **kwargs)
    with _lock: _processes.setdefault(task_id, set()).add(process)
    started = time.monotonic()
    try:
        while True:
            checkpoint(task_id)
            if timeout is not None and time.monotonic()-started >= timeout:
                raise subprocess.TimeoutExpired(args, timeout)
            try:
                stdout, stderr = process.communicate(timeout=.15)
                checkpoint(task_id, force=True)
                return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
            except subprocess.TimeoutExpired:
                continue
    except BaseException:
        _terminate(process)
        raise
    finally:
        with _lock: _processes.get(task_id, set()).discard(process)

def copy_file(source, target):
    checkpoint()
    with open(source, 'rb') as src, open(target, 'wb') as dst:
        while True:
            checkpoint()
            block = src.read(1024*1024)
            if not block: break
            dst.write(block)
    shutil.copystat(source, target)
    return target

def copy_tree(source, target):
    checkpoint()
    return shutil.copytree(source, target, copy_function=copy_file)

class _Reader:
    def __init__(self, stream): self.stream = stream
    def read(self, count=-1):
        checkpoint()
        return self.stream.read(count)

def tar_add(archive, path, arcname):
    from pathlib import Path
    path = Path(path)
    items = [path, *sorted(path.rglob('*'))] if path.is_dir() else [path]
    for item in items:
        checkpoint()
        if item.is_symlink(): raise ValueError('数据集包含符号链接')
        name = arcname if item == path else arcname+'/'+item.relative_to(path).as_posix()
        info = archive.gettarinfo(str(item), arcname=name)
        if item.is_file():
            with item.open('rb') as stream: archive.addfile(info, _Reader(stream))
        else: archive.addfile(info)


@contextmanager
def task_scope(task_id):
    previous = getattr(_local, 'task_id', None)
    bind(task_id)
    try: yield
    finally:
        _local.task_id = previous
        _local.checked = 0


def begin_startup():
    _shutdown.clear()
