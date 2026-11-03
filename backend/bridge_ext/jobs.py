"""SQLite-backed single-worker dispatcher; completed nodes are never replayed."""
import threading
import logging
import uuid
from .common import db_session, now_iso
from . import runtime

_owner = uuid.uuid4().hex
_wakeup = threading.Event()
_stop = threading.Event()
_lock = threading.Lock()
_thread = None

def enqueue(task_id):
    runtime.reset(task_id)
    with db_session() as db:
        db.execute("INSERT INTO task_jobs(task_id,status,generation,enqueued_at) VALUES (?,'ready',1,?) ON CONFLICT(task_id) DO UPDATE SET status='ready',generation=generation+1,owner=NULL,enqueued_at=excluded.enqueued_at", (task_id, now_iso()))
    start()
    _wakeup.set()

def recover():
    from .tasks import _event
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        rows=db.execute("SELECT id FROM tasks WHERE status IN ('pending','running')").fetchall()
        for row in rows:
            task_id=row['id']
            db.execute("UPDATE task_nodes SET status='waiting',progress=0,message='服务重启后继续执行',result_json=NULL,finished_at=NULL WHERE task_id=? AND status='running'", (task_id,))
            db.execute("UPDATE tasks SET status='pending',error=NULL,finished_at=NULL,updated_at=? WHERE id=?", (now_iso(),task_id))
            db.execute("INSERT INTO task_jobs(task_id,status,generation,enqueued_at) VALUES (?,'ready',1,?) ON CONFLICT(task_id) DO UPDATE SET status='ready',generation=generation+1,owner=NULL,enqueued_at=excluded.enqueued_at",(task_id,now_iso()))
            _event(db,task_id,None,'服务重启，已排队继续未完成节点；已完成节点保留','warn')
        db.execute("UPDATE task_jobs SET status='done',owner=NULL WHERE status='running' AND task_id IN (SELECT id FROM tasks WHERE status IN ('waiting_human','done','failed'))")
        db.execute("UPDATE task_jobs SET status='canceled',owner=NULL WHERE task_id IN (SELECT id FROM tasks WHERE status='canceled')")

def _claim():
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        # The dispatcher is idle here. Reclaim only its own unfinished bookkeeping,
        # e.g. after a temporary write lock prevented the previous final update.
        stale=[r['task_id'] for r in db.execute("SELECT j.task_id FROM task_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.status='running' AND j.owner=? AND t.status IN ('pending','running')",(_owner,))]
        for task_id in stale:
            db.execute("UPDATE task_nodes SET status='waiting',progress=0 WHERE task_id=? AND status='running'",(task_id,))
            db.execute("UPDATE tasks SET status='pending',updated_at=? WHERE id=?",(now_iso(),task_id))
            db.execute("UPDATE task_jobs SET status='ready',owner=NULL,generation=generation+1 WHERE task_id=?",(task_id,))
        db.execute("UPDATE task_jobs SET status='done',owner=NULL WHERE status='running' AND owner=? AND task_id IN (SELECT id FROM tasks WHERE status IN ('done','failed','waiting_human'))",(_owner,))
        row=db.execute("SELECT j.task_id,j.generation FROM task_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.status='ready' AND t.status='pending' ORDER BY j.enqueued_at,j.task_id LIMIT 1").fetchone()
        if not row:return None
        db.execute("UPDATE task_jobs SET status='running',owner=?,attempts=attempts+1,heartbeat_at=? WHERE task_id=? AND generation=?",(_owner,now_iso(),row['task_id'],row['generation']))
        return dict(row)

def _heartbeat(task_id,generation,done):
    while not done.wait(2):
        try:
            with db_session() as db:db.execute("UPDATE task_jobs SET heartbeat_at=? WHERE task_id=? AND generation=? AND owner=? AND status='running'",(now_iso(),task_id,generation,_owner))
        except Exception:pass

def _owns(db, task_id, generation):
    return db.execute("SELECT 1 FROM task_jobs WHERE task_id=? AND generation=? AND owner=? AND status='running'", (task_id,generation,_owner)).fetchone() is not None


def _loop():
    from . import tasks
    while not _stop.is_set():
        try:
            job=_claim()
        except Exception:
            logging.getLogger('labelvla').exception('任务队列暂时不可用，等待后重试')
            _wakeup.wait(1);_wakeup.clear();continue
        if not job:
            _wakeup.wait(1);_wakeup.clear();continue
        try:
            _execute_job(job)
        except Exception:
            logging.getLogger('labelvla').exception('任务执行记录暂时不可用，调度线程将继续恢复')
            _wakeup.wait(1);_wakeup.clear()


def _execute_job(job):
    from . import tasks
    task_id=job['task_id'];generation=job['generation']
    done=threading.Event()
    beat=threading.Thread(target=_heartbeat,args=(task_id,generation,done),daemon=True);beat.start()
    runtime.bind(task_id)
    try:
        runtime.checkpoint(force=True)
        tasks._run_task(task_id)
    except runtime.TaskCancelled:
        with db_session() as db:
            if _owns(db,task_id,generation):
                db.execute("UPDATE tasks SET status='canceled',updated_at=? WHERE id=? AND status!='done'",(now_iso(),task_id))
                db.execute("UPDATE task_nodes SET status='skipped',message='任务已取消' WHERE task_id=? AND status='running'",(task_id,))
    except runtime.TaskInterrupted:
        with db_session() as db:
            if _owns(db,task_id,generation):
                db.execute("UPDATE tasks SET status='pending',error=NULL,updated_at=? WHERE id=? AND status NOT IN ('done','canceled','failed','waiting_human')",(now_iso(),task_id))
                db.execute("UPDATE task_nodes SET status='waiting',progress=0,message='服务重启后继续执行' WHERE task_id=? AND status='running'",(task_id,))
    except Exception as error:
        with db_session() as db:
            if _owns(db,task_id,generation):
                db.execute("UPDATE tasks SET status='failed',error=?,updated_at=? WHERE id=? AND status!='canceled'",(str(error),now_iso(),task_id))
                tasks._event(db,task_id,None,f'后台执行异常：{error}','error')
    finally:
        done.set();beat.join(timeout=1);runtime.release()
        try:
            with db_session() as db:
                task=db.execute('SELECT status FROM tasks WHERE id=?',(task_id,)).fetchone()
                status='ready' if task and task['status']=='pending' else 'canceled' if task and task['status']=='canceled' else 'done'
                db.execute("UPDATE task_jobs SET status=?,owner=NULL,heartbeat_at=? WHERE task_id=? AND generation=? AND owner=?",(status,now_iso(),task_id,generation,_owner))
        except Exception:
            logging.getLogger('labelvla').exception('任务队列状态写入暂时失败，将在下次调度恢复')

def start():
    global _thread
    with _lock:
        if _thread and _thread.is_alive():return
        _stop.clear();runtime.begin_startup()
        _thread=threading.Thread(target=_loop,name='persistent-task-worker',daemon=True);_thread.start()

def shutdown():
    _stop.set();_wakeup.set();runtime.begin_shutdown()
    if _thread:_thread.join(timeout=3)
