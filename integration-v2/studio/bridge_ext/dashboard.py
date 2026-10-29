"""概览聚合(docs/platform-plan.md 0.2 契约)。

口径说明:
- totals:台账行求和;annotations=片段总数,annotation_hours=片段帧跨度折小时
- status_dist:直接求和台账行 counts(与台账页口径一致;有标注无状态记录的 episode 计 labeling)
- quality:valid=无未修正问题的片段数;invalid=未修正问题片段数(segment 扩展字段 problem);
  error=qc_reports 中 severity=error 的行数;pass_rate=valid/annotations;
  fix_rate=已修正问题/问题总数
- qc:fail=有质检报告的 episode 数;scanned=qc_scans 覆盖的 episode 数;
  pass=scanned-fail;not_scanned=总集数-scanned
- trends(近 30 天按日):data_growth=episode 视频(v2 文件 mtime;v3 shard mtime×条数);
  annotation_growth=segments 文件 mtime 当日的片段数;qc_trend=按扫描日聚合 pass/fail;
  quality_trend:valid=当日新增片段-当日问题,invalid=当日标记问题,error=当日 qc error 行数
"""
from datetime import date, timedelta

from fastapi import APIRouter, Request

from . import ledger
from .common import db_session, require

router = APIRouter()

TREND_DAYS = 30


def _day_series() -> list:
    today = date.today()
    return [(today - timedelta(days=i)).isoformat() for i in range(TREND_DAYS - 1, -1, -1)]


def _bucket(days: list, hist: dict, key: str = 'count') -> list:
    return [{'day': d, key: hist.get(d, 0)} for d in days]


@router.get('/api/bridge/dashboard')
def dashboard(request: Request):
    require(request, 'admin', 'reviewer', 'annotator')
    rows = ledger.get_ledger()
    total_episodes = sum(r['episodes'] for r in rows)
    annotations = sum(r['annotations'] for r in rows)
    problems = sum(r['problems'] for r in rows)
    problems_fixed = sum(r['problems_fixed'] for r in rows)
    invalid = problems - problems_fixed

    status_dist = {s: 0 for s in ('untagged', 'labeling', 'review', 'approved', 'rejected')}
    for row in rows:
        for s, c in row['counts'].items():
            status_dist[s] = status_dist.get(s, 0) + c

    qc_fail_episodes = 0
    qc_scanned = 0
    qc_scan_days = {}
    qc_error_days = {}
    try:
        with db_session() as db:
            qc_fail_episodes = db.execute(
                'SELECT COUNT(*) c FROM (SELECT DISTINCT dataset, episode FROM qc_reports)').fetchone()['c']
            err_rows = db.execute(
                "SELECT substr(created_at, 1, 10) d, COUNT(*) c FROM qc_reports"
                " WHERE severity='error' GROUP BY d").fetchall()
            qc_error_days = {r['d']: r['c'] for r in err_rows}
            try:
                for r in db.execute('SELECT scanned_at, episodes, failed FROM qc_scans'):
                    qc_scanned += r['episodes']
                    d = str(r['scanned_at'] or '')[:10]
                    if d:
                        p, f = qc_scan_days.get(d, (0, 0))
                        qc_scan_days[d] = (p + max(0, r['episodes'] - r['failed']), f + r['failed'])
            except Exception:
                pass
    except Exception:
        pass

    valid = max(0, annotations - invalid)
    quality = {
        'valid': valid,
        'invalid': invalid,
        'error': sum(qc_error_days.values()),
        'pass_rate': round(valid / annotations, 4) if annotations else None,
        'fix_rate': round(problems_fixed / problems, 4) if problems else None,
    }
    qc = {
        'pass': max(0, qc_scanned - qc_fail_episodes),
        'fail': qc_fail_episodes,
        'not_scanned': max(0, total_episodes - qc_scanned),
    }

    days = _day_series()
    data_days, anno_days, invalid_days = {}, {}, {}
    for r in rows:
        for d, c in r['video_days'].items():
            data_days[d] = data_days.get(d, 0) + c
        for d, c in r['seg_days'].items():
            anno_days[d] = anno_days.get(d, 0) + c
        for d, c in r['problem_days'].items():
            invalid_days[d] = invalid_days.get(d, 0) + c
    trends = {
        'data_growth': _bucket(days, data_days),
        'annotation_growth': _bucket(days, anno_days),
        'qc_trend': [{'day': d,
                      'pass': qc_scan_days.get(d, (0, 0))[0],
                      'fail': qc_scan_days.get(d, (0, 0))[1]} for d in days],
        'quality_trend': [{'day': d,
                           'valid': max(0, anno_days.get(d, 0) - invalid_days.get(d, 0)),
                           'error': qc_error_days.get(d, 0),
                           'invalid': invalid_days.get(d, 0)} for d in days],
    }
    return {
        'totals': {
            'datasets': len(rows),
            'episodes': total_episodes,
            'hours': round(sum(r['hours'] for r in rows), 2),
            'annotations': annotations,
            'annotation_hours': round(sum(r['annotation_hours'] for r in rows), 2),
        },
        'status_dist': status_dist,
        'quality': quality,
        'qc': qc,
        'trends': trends,
    }


def register(app):
    app.include_router(router)
