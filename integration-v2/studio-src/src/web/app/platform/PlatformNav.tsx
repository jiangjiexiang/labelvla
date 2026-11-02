import { useEffect, useState } from 'react';
import { CircleHelp, Database, GitBranch, LayoutDashboard, ListOrdered, ListTodo, LogOut, ShieldCheck, Users, Video } from 'lucide-react';
import { api, ROLE_LABEL } from './api';
import { setAuth, useAuth } from './authStore';
import { usePage, type PlatformPage } from './usePage';

const MAIN_NAV: { key: Exclude<PlatformPage, null>; label: string; icon: typeof Database }[] = [
  { key: 'dashboard', label: '数据看板', icon: LayoutDashboard },
  { key: 'datasets', label: '数据管理', icon: Database },
  { key: 'tasks', label: '任务管理', icon: ListTodo },
];
const ANNOTATION_NAV = [
  { key: 'episodes' as const, label: 'Episode 列表', icon: ListOrdered },
  { key: 'videos' as const, label: '视频库', icon: Video },
];
const SYSTEM_NAV: { key: Exclude<PlatformPage, null>; label: string; icon: typeof Database; adminOnly?: boolean }[] = [
  { key: 'versions', label: '版本管理', icon: GitBranch },
  { key: 'qc', label: '质检管理', icon: ShieldCheck },
  { key: 'users', label: '用户管理', icon: Users, adminOnly: true },
];

export function PlatformNav() {
  const { user } = useAuth();
  const [page, setPage] = usePage();
  const [taskCount, setTaskCount] = useState(0);
  useEffect(() => {
    let alive = true;
    api.taskStats().then((s) => { if (alive) setTaskCount(s.running); }).catch(() => { /* 未登录时忽略 */ });
    return () => { alive = false; };
  }, [page]);
  const logout = async () => {
    try { await api.logout(); } catch { /* 忽略 */ }
    setAuth({ user: null });
  };
  const renderLink = (item: { key: PlatformPage; label: string; icon: typeof Database }) => {
    const Icon = item.icon;
    const active = page === item.key || (item.key === 'datasets' && page === 'episodes') || (item.key === 'tasks' && (page === 'task-create' || page === 'task-detail'));
    return <button key={item.label} className={`g-nav-item ${active ? 'active' : ''}`} onClick={() => setPage(item.key)}><Icon /><span>{item.label}</span>{item.key === 'tasks' && taskCount > 0 && <small>{taskCount}</small>}</button>;
  };
  return <><header className="g-topbar"><strong className="g-platform-title">数据平台</strong><div className="g-user"><button><CircleHelp /><span>帮助中心</span></button><span className="g-avatar">{(user?.display_name || user?.username || '用').slice(0, 1)}</span><span>{user?.display_name || user?.username || '用户'}</span><small>{user ? ROLE_LABEL[user.role] : '管理员'}</small><button title="退出登录" onClick={() => void logout()}><LogOut /></button></div></header><aside className="g-sidebar"><div className="g-workspace"><span>工作空间</span><strong><i />Default</strong></div><nav><div className="g-nav-group">{MAIN_NAV.map(renderLink)}</div><div className="g-nav-group"><label>标注中心</label>{ANNOTATION_NAV.map(renderLink)}</div><div className="g-nav-group"><label>系统管理</label>{SYSTEM_NAV.filter((item) => !item.adminOnly || user?.role === 'admin').map(renderLink)}</div></nav><div className="g-service"><i />所有服务运行正常<span>v2.1</span></div></aside></>;
}
