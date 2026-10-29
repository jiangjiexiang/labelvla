import { Button } from '@/ui';
import { api, ROLE_LABEL } from './api';
import { setAuth, useAuth } from './authStore';
import { usePage, type PlatformPage } from './usePage';

const NAV: { key: Exclude<PlatformPage, null>; label: string; adminOnly?: boolean }[] = [
  { key: 'dashboard', label: '概览' },
  { key: 'datasets', label: '数据集' },
  { key: 'qc', label: '质检' },
  { key: 'users', label: '用户', adminOnly: true },
];

export function PlatformNav() {
  const { user } = useAuth();
  const [page, setPage] = usePage();
  const logout = async () => {
    try { await api.logout(); } catch { /* 忽略 */ }
    setAuth({ user: null });
  };
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-4">
      <span className="mr-3 text-sm font-semibold">LabelVLA 数据平台</span>
      {NAV.filter((n) => !n.adminOnly || user?.role === 'admin').map((n) => (
        <Button
          key={n.key}
          variant={page === n.key ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => setPage(n.key)}
        >
          {n.label}
        </Button>
      ))}
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setPage(null)}>
        返回标注
      </Button>
      {user && (
        <span className="ml-2 text-xs text-muted-foreground">
          {user.display_name || user.username} · {ROLE_LABEL[user.role]}
        </span>
      )}
      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => void logout()}>
        退出
      </Button>
    </div>
  );
}
