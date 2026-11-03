import { useEffect, useState } from 'react';
import { api, type TaskDetail, type WorkflowCatalog, type WorkflowNode } from './api';

export function WorkflowBuilder({ value, onChange, catalog, lockedCount = 0 }: {
  value: WorkflowNode[]; onChange: (nodes: WorkflowNode[]) => void; catalog: WorkflowCatalog; lockedCount?: number;
}) {
  const [adding, setAdding] = useState('auto');
  const update = (index: number, patch: Partial<WorkflowNode>) => onChange(value.map((node,i) => i===index ? {...node,...patch} : node));
  const move = (index: number, direction: number) => {
    const next=[...value]; const target=index+direction;
    if (index<lockedCount || target<lockedCount || target>=next.length) return;
    [next[index],next[target]]=[next[target],next[index]]; onChange(next);
  };
  const available = catalog.nodes.filter((node) => !value.some((item) => item.key===node.key));
  const add = () => {
    const chosen=available.find((node) => node.key===adding);
    if (chosen) onChange([...value,{...chosen}]);
    else if (adding==='auto') onChange([...value,{key:`auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,name:'运行程序',program:catalog.programs[0]?.id ?? 'inspect_dataset'}]);
  };
  return <div className="g-workflow-editor">
    <ol>
      {value.map((node,index) => {
        const locked=index<lockedCount;
        const manual=node.key==='annotate' || node.key==='qc';
        return <li key={node.key}>
          <span className="g-workflow-order">{index+1}</span>
          <div className="g-workflow-fields">
            <label>节点名称<input aria-label={`节点 ${index+1} 名称`} value={node.name} maxLength={60} disabled={locked} onChange={(e) => update(index,{name:e.target.value})} /></label>
            {manual ? <div className="g-workflow-manual">{node.key==='annotate' ? '标注负责人手动确认' : '审核负责人查看视频后验收'}</div> : node.key==='compile' ? <div className="g-workflow-manual">生成并发布完整数据集版本</div> :
              <label>执行程序<select aria-label={`节点 ${index+1} 执行程序`} value={node.program ?? ''} disabled={locked} onChange={(e) => update(index,{program:e.target.value})}>
                {!catalog.programs.some((program) => program.id===node.program) && <option value={node.program ?? ''}>{node.program || '请选择程序'}</option>}
                {catalog.programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
              </select></label>}
            {!manual && node.key!=='compile' && <small>{catalog.programs.find((program) => program.id===node.program)?.description}</small>}
            {locked && <small>已完成或正在等待人工确认，此节点已锁定</small>}
          </div>
          <div className="g-workflow-controls">
            <button type="button" aria-label={`上移 ${node.name}`} disabled={locked || index===lockedCount} onClick={() => move(index,-1)}>↑</button>
            <button type="button" aria-label={`下移 ${node.name}`} disabled={locked || index===value.length-1} onClick={() => move(index,1)}>↓</button>
            <button type="button" aria-label={`删除 ${node.name}`} disabled={locked} onClick={() => onChange(value.filter((_,i) => i!==index))}>删除</button>
          </div>
        </li>;
      })}
    </ol>
    <div className="g-workflow-add">
      <select aria-label="添加节点类型" value={adding} onChange={(e) => setAdding(e.target.value)}>
        <option value="auto">运行程序</option>
        {available.map((node) => <option key={node.key} value={node.key}>{node.name}</option>)}
      </select>
      <button type="button" className="g-button" disabled={value.length>=16} onClick={add}>添加节点</button>
    </div>
    <p className="g-workflow-help">按顺序执行。发布前需完成人工验收和标注完整性检查；版本发布放在最后。自定义程序由服务器注册后，可在执行程序中选择。</p>
  </div>;
}

export function TaskWorkflowDialog({ task, onClose, onSaved }: { task: TaskDetail; onClose: () => void; onSaved: (task: TaskDetail) => void }) {
  const [catalog,setCatalog]=useState<WorkflowCatalog | null>(null);
  const [workflow,setWorkflow]=useState<WorkflowNode[]>(task.nodes.map(({key,name,program}) => ({key,name,program:program ?? null})));
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(() => { api.workflowCatalog().then(setCatalog).catch((e) => setError(String(e))); },[]);
  let lockedCount=0;
  for (const node of task.nodes) { if (node.status==='done') lockedCount++; else break; }
  if (task.nodes[lockedCount]?.status==='blocked') lockedCount++;
  const save=async () => {
    setBusy(true); setError('');
    try {
      onSaved(await api.updateWorkflow(task.id,workflow,task.nodes.map(({key,name,program,status}) => ({key,name,program:program ?? null,status}))));
      onClose();
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="g-modal g-workflow-modal" role="dialog" aria-modal="true" aria-label="编辑任务流程">
    <div className="g-modal-body">
      <div className="g-modal-head"><strong>编辑任务流程</strong><button type="button" className="g-button" disabled={busy} onClick={onClose}>关闭</button></div>
      <div className="g-workflow-dialog-content">
        {error && <p className="g-notice error" role="alert">{error}</p>}
        {catalog ? <WorkflowBuilder value={workflow} onChange={setWorkflow} catalog={catalog} lockedCount={lockedCount} /> : <p>正在加载可用程序…</p>}
      </div>
      <div className="g-workflow-dialog-footer"><button type="button" className="g-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="g-button g-primary" disabled={busy || !catalog} onClick={() => void save()}>{busy ? '保存中…' : '保存流程'}</button></div>
    </div>
  </div>;
}
