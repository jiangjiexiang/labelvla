"""Editable task workflows and registered program runners."""
import json
import math
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

from fastapi import HTTPException
from .common import data_root, db_session, now_iso
from . import runtime

PROGRAMS = [
    {'id':'inspect_dataset','name':'数据集预检查','description':'读取元数据，检查视频和 Parquet 文件。'},
    {'id':'annotation_audit','name':'Episode 标注完整性检查','description':'逐条检查有效标注；未标注的数据必须已跳过并填写原因。'},
    {'id':'geometry_qc','name':'目标框与轮廓检查','description':'检查目标框范围、轨迹、轮廓等问题，有错误时停止流程。'},
]
DEFAULTS = {
    'preprocess': {'key':'preprocess','name':'预处理','program':'inspect_dataset'},
    'annotate': {'key':'annotate','name':'人工标注','program':None},
    'qc': {'key':'qc','name':'人工验收','program':None},
    'program_qc': {'key':'program_qc','name':'程序质检','program':'annotation_audit'},
    'compile': {'key':'compile','name':'版本发布','program':'publish_dataset'},
}
TEMPLATES = {
    'video_annotation':['preprocess','annotate','qc','program_qc','compile'],
    'preprocess':['preprocess'],
    'qc':['qc','program_qc'],
}
LEGACY_PROGRAMS = {'preprocess':'inspect_dataset','program_qc':'annotation_audit','package':'export_dataset','compile':'publish_dataset'}


def registered_programs():
    """Custom programs are deployed on the server, never accepted as client shell commands."""
    result = {}
    path = data_root()/'.platform/programs.json'
    if not path.is_file():
        return result
    entries = json.loads(path.read_text())
    if not isinstance(entries,list):
        raise RuntimeError('programs.json 必须是程序列表')
    reserved = {p['id'] for p in PROGRAMS} | {'publish_dataset','export_dataset'}
    for item in entries:
        identifier = item.get('id','')
        command = item.get('command')
        if not re.fullmatch(r'custom_[a-z0-9_]{1,50}',identifier) or identifier in reserved or identifier in result:
            raise RuntimeError('自定义程序 ID 必须是唯一的 custom_ 开头标识')
        if not isinstance(command,list) or not command or any(not isinstance(arg,str) or not arg for arg in command) or not Path(command[0]).is_absolute():
            raise RuntimeError(f'{identifier}: command 必须是以绝对路径程序开头的参数列表')
        timeout = item.get('timeout_seconds',300)
        if type(timeout) is not int or not 1 <= timeout <= 3600:
            raise RuntimeError(f'{identifier}: 超时必须在 1–3600 秒之间')
        result[identifier] = {**item,'timeout_seconds':timeout}
    return result


def catalog():
    custom = registered_programs()
    return {'programs': PROGRAMS + [{k:item.get(k,'') for k in ('id','name','description')} for item in custom.values()],
            'templates':{kind:[dict(DEFAULTS[key]) for key in keys] for kind,keys in TEMPLATES.items()},
            'nodes':list(DEFAULTS.values())}


def normalize(nodes, task_type, legacy_keys=()):
    if nodes is None:
        nodes = catalog()['templates'][task_type]
    if not isinstance(nodes,list) or not 1 <= len(nodes) <= 16:
        raise HTTPException(400,'流程必须包含 1–16 个节点')
    programs = {p['id'] for p in catalog()['programs']}
    result=[]; seen=set()
    for item in nodes:
        if not isinstance(item,dict):
            raise HTTPException(400,'流程节点格式无效')
        key=item.get('key','')
        if not isinstance(key,str) or (key not in DEFAULTS and key not in legacy_keys and not re.fullmatch(r'auto_[a-zA-Z0-9_]{1,40}',key)) or key in seen:
            raise HTTPException(400,'节点编号无效或重复')
        seen.add(key)
        name=str(item.get('name') or '').strip()
        if not name or len(name)>60:
            raise HTTPException(400,'节点名称必须为 1–60 个字符')
        program=item.get('program')
        if key in ('annotate','qc'):
            if program not in (None,''):
                raise HTTPException(400,'人工节点不能配置自动程序')
            program=None
        elif key=='package' and key in legacy_keys:
            if program!='export_dataset':raise HTTPException(400,'历史打包节点的程序不能改变')
        elif key=='compile':
            if program!='publish_dataset':
                raise HTTPException(400,'版本发布节点必须使用版本发布程序')
        elif program not in programs:
            raise HTTPException(400,'请选择已注册的程序')
        result.append({'key':key,'name':name,'program':program})
    positions={node['key']:i for i,node in enumerate(result)}
    if 'annotate' in positions and 'qc' in positions and positions['annotate']>positions['qc']:
        raise HTTPException(400,'人工验收必须在人工标注之后')
    audits=[i for i,node in enumerate(result) if node['program']=='annotation_audit']
    if 'annotate' in positions and any(i<positions['annotate'] for i in audits):
        raise HTTPException(400,'标注完整性质检必须在人工标注之后')
    if 'compile' in positions:
        if positions['compile']!=len(result)-1:
            raise HTTPException(400,'版本发布必须是最后一个节点')
        if 'qc' not in positions or not audits:
            raise HTTPException(400,'发布前必须包含人工验收和 Episode 标注完整性检查')
    return result


def episode_lengths(path):
    info=json.loads((path/'meta/info.json').read_text())
    version=str(info.get('codebase_version',''))
    if version.startswith('v2'):
        rows=[json.loads(line) for line in (path/'meta/episodes.jsonl').read_text().splitlines() if line.strip()]
    elif version.startswith('v3'):
        import pyarrow.parquet as pq
        rows=[]
        for file in sorted((path/'meta/episodes').rglob('*.parquet')):
            rows.extend(pq.read_table(file,columns=['episode_index','length']).to_pylist())
    else:
        raise ValueError('不支持的数据集版本')
    lengths={}
    for row in rows:
        index,length=row.get('episode_index'),row.get('length')
        if type(index) is not int or type(length) is not int or index<0 or length<=0 or index in lengths:
            raise ValueError('Episode 元数据编号、长度无效或重复')
        lengths[index]=length
    if len(lengths)!=int(info['total_episodes']) or not lengths:
        raise ValueError('Episode 元数据条数与 info.json 不一致，或数据集为空')
    return lengths


def annotation_audit(ctx,progress):
    from .exclusions import excluded
    path=Path(ctx['path'])
    lengths=episode_lengths(path)
    skips=excluded(str(path))
    rows=[]; annotated=skipped=failed=0
    for i,(episode,length) in enumerate(sorted(lengths.items())):
        runtime.checkpoint()
        exclusion=skips.get(episode)
        issue=''; count=0
        reason=str((exclusion or {}).get('reason') or '').strip()
        if exclusion:
            status='skipped' if reason else 'missing_reason'
            if reason: skipped+=1
            else: issue='已跳过标注，但未选择原因'
        else:
            file=path/'segments'/f'episode_{episode:06d}.json'
            if file.is_file():
                try:
                    doc=json.loads(file.read_text())
                    segments=doc.get('segments')
                    if not isinstance(segments,list):raise ValueError('segments 不是列表')
                    for seg in segments:
                        if not isinstance(seg,dict):raise ValueError('片段格式错误')
                        a,b=seg.get('start_frame'),seg.get('end_frame')
                        if type(a) is not int or type(b) is not int or not 0<=a<=b<length:
                            raise ValueError('标注帧范围无效')
                        text=any(str(seg.get(k) or '').strip() not in ('','_') for k in ('text','skill','object','target','adverb'))
                        boxes=seg.get('bboxes') or []
                        if not isinstance(boxes,list):raise ValueError('目标框格式错误')
                        labeled_box=any(isinstance(box,dict) and str(box.get('label') or '').strip() not in ('','_') for box in boxes)
                        if text or labeled_box:count+=1
                    if not count:issue='没有有效标注，也未选择不标注原因'
                except (ValueError,TypeError,KeyError,AttributeError) as error:
                    issue=f'标注文件无效：{error}'
            else:
                issue='没有标注文件，也未选择不标注原因'
            status='invalid_annotation' if issue and file.is_file() else 'missing_annotation' if issue else 'annotated'
            if not issue:annotated+=1
        if issue:failed+=1
        rows.append({'episode':episode,'status':status,'annotations':count,'reason':reason,'issue':issue})
        progress(int(95*(i+1)/len(lengths)),f'已检查 {i+1}/{len(lengths)} 个 Episode')
    message=f'共 {len(rows)} 个 Episode：已标注 {annotated}，有原因跳过 {skipped}，不通过 {failed}'
    return {'passed':failed==0,'message':message,'total':len(rows),'annotated':annotated,'skipped':skipped,'failed':failed,'episodes':rows}


def _custom(ctx,program,progress):
    definition=registered_programs().get(program)
    if not definition:raise RuntimeError('程序已取消注册，请重新选择')
    folder=data_root()/'.platform/program_runs'/f'task_{ctx["task_id"]}'/uuid.uuid4().hex
    folder.mkdir(parents=True)
    context=folder/'context.json'
    context.write_text(json.dumps({'task_id':ctx['task_id'],'dataset':str(ctx['path']),'original_dataset':ctx['dataset'],'user':ctx.get('user')},ensure_ascii=False))
    progress(5,f'运行 {definition.get("name") or program}')
    try:
        with (folder/'stdout.log').open('wb') as stdout,(folder/'stderr.log').open('wb') as stderr:
            process=runtime.run_process([*definition['command'],str(context)],cwd=folder,stdout=stdout,stderr=stderr,timeout=definition['timeout_seconds'])
    except subprocess.TimeoutExpired:
        raise RuntimeError('程序运行超时')
    with (folder/'stdout.log').open('rb') as stream: output=stream.read(2*1024*1024)
    try:
        result=json.loads(output)
    except (ValueError,UnicodeDecodeError):
        raise RuntimeError(f'程序未返回有效 JSON，查看运行日志：{folder}')
    if not isinstance(result,dict) or type(result.get('passed')) is not bool:
        raise RuntimeError('程序结果必须包含 passed 布尔字段')
    if process.returncode:
        result.update(passed=False,message=f'程序退出码 {process.returncode}：'+str(result.get('message') or '执行失败'))
    result['run_directory']=str(folder)
    return result


def run(ctx,progress):
    from . import tasks
    program=ctx.get('program') or LEGACY_PROGRAMS.get(ctx['key'])
    if program=='annotation_audit':result=annotation_audit(ctx,progress)
    elif program=='inspect_dataset':result=tasks._node_preprocess(ctx,progress)
    elif program=='geometry_qc':
        result=tasks._node_qc(ctx,progress)
        result.update(passed=result['issues']==0,message=f'目标框与轮廓检查：{result["issues"]} 项问题')
    elif program=='export_dataset':result=tasks._node_package(ctx,progress)
    elif program=='publish_dataset':
        with db_session() as db:
            row=db.execute('SELECT export_dir FROM tasks WHERE id=?',(ctx['task_id'],)).fetchone()
        out=Path(row['export_dir']) if row and row['export_dir'] else None
        if not out or not (out/'manifest.json').is_file() or not Path(str(out)+'.tar.gz').is_file():
            tasks._node_package(ctx,lambda pct,msg=None:progress(int(pct*.75),msg))
        result=tasks._node_compile(ctx,lambda pct,msg=None:progress(75+int(pct*.25),msg))
    elif program and program.startswith('custom_'):result=_custom(ctx,program,progress)
    else:raise RuntimeError(f'未注册的程序：{program}')
    return result
