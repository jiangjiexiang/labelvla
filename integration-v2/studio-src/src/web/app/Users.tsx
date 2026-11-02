import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/ui';
import { api, ROLE_LABEL, type LoginRecord, type Role, type User } from './platform/api';
import { useAuth } from './platform/authStore';

const ROLE_LEVEL: Record<string, number> = { admin: 100, reviewer: 50, annotator: 10 };

export function Users() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [dingUser, setDingUser] = useState<User | null>(null);
  const [dingId, setDingId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [logins, setLogins] = useState<{ user: User; items: LoginRecord[] } | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'annotator' as User['role'] });

  const load = useCallback(async () => {
    setError('');
    try { setRows(await api.users()); }
    catch (e) { setRows([]); setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 角色层级:改他人需严格更高;不能操作自己
  const canManage = (u: User) =>
    !!me && me.id !== u.id && ROLE_LEVEL[me.role] > ROLE_LEVEL[u.role];

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createUser(form);
      setCreateOpen(false);
      setForm({ username: '', display_name: '', password: '', role: 'annotator' });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const changeRole = async (u: User, role: Role) => {
    if (role === u.role || !window.confirm(`将 ${u.username} 的角色修改为${ROLE_LABEL[role]}？`)) return;
    setError('');
    try { await api.updateUser(u.id, { role }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const disable = async (u: User) => {
    try { if (u.disabled) await api.updateUser(u.id, { disabled: false }); else await api.disableUser(u.id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const remove = async (u: User) => {
    if (!window.confirm(`确认删除账号 ${u.username}?`)) return;
    try { await api.deleteUser(u.id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const showLogins = async (u: User) => {
    try { setLogins({ user: u, items: await api.userLogins(u.id) }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const statusOf = (u: User) => {
    if (u.disabled) return <Badge variant="secondary" className="text-zinc-500">已禁用</Badge>;
    if (u.expires_at && new Date(u.expires_at).getTime() < Date.now())
      return <Badge variant="secondary" className="text-red-600">已过期</Badge>;
    return <Badge variant="secondary" className="text-emerald-600">正常</Badge>;
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">用户管理</h2>
        <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>新建账号</Button>
      </div>
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs" style={{ minWidth: 800 }}>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">登录帐号</th>
              <th className="px-3 py-2 text-left font-medium">姓名</th>
              <th className="px-3 py-2 text-left font-medium">角色</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              <th className="px-3 py-2 text-left font-medium">最后登录</th>
              <th className="px-3 py-2 text-left font-medium">过期时间</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{u.username}</td>
                <td className="px-3 py-2">{u.display_name}
                  {me?.role === 'admin' && <button className="ml-2 text-[11px] text-primary" onClick={() => { setDingUser(u); setDingId(u.dingtalk_userid || ''); }}>{u.dingtalk_userid ? '钉钉已绑定' : '绑定钉钉'}</button>}
                </td>
                <td className="px-3 py-2">{me?.role === 'admin' && me.id !== u.id ? (
                  <select aria-label={`修改 ${u.username} 的角色`} className="rounded border border-border bg-background px-2 py-1" style={{ width: 110, height: 30, display: 'inline-block', margin: 0, fontSize: 12, verticalAlign: 'middle' }} value={u.role} onChange={(e) => void changeRole(u, e.target.value as Role)}>
                    {(['annotator', 'reviewer', 'admin'] as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                  </select>
                ) : (ROLE_LABEL[u.role] ?? u.role)}</td>
                <td className="px-3 py-2">{statusOf(u)}</td>
                <td className="px-3 py-2">
                  {u.last_login ? (
                    <button className="text-primary underline-offset-2 hover:underline" onClick={() => void showLogins(u)}>
                      {new Date(u.last_login).toLocaleString('zh-CN')}
                    </button>
                  ) : <span className="text-muted-foreground">从未登录</span>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{u.expires_at ?? '永久有效'}</td>
                <td className="px-3 py-2 text-right">
                  {(canManage(u) || (!!me && me.role === 'admin' && me.id !== u.id && u.disabled)) ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void disable(u)}>{u.disabled ? '启用' : '禁用'}</Button>
                      {canManage(u) && <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => void remove(u)}>删除</Button>}
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{error ? '接口未就绪或出错' : '暂无账号'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!dingUser} onOpenChange={(open) => { if (!open) setDingUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>绑定钉钉 · {dingUser?.display_name}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">填写该人员的钉钉 UserID，用于任务发布后在群内 @负责人；留空解除绑定。</p>
          <Input aria-label="钉钉 UserID" value={dingId} onChange={(e) => setDingId(e.target.value)} maxLength={128} />
          <Button onClick={() => { if (dingUser) void api.bindDingtalk(dingUser.id, dingId.trim()).then(() => { setDingUser(null); return load(); }).catch((e) => setError(String(e))); }}>保存</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>新建账号</DialogTitle></DialogHeader>
          <form onSubmit={(e) => void create(e)} className="flex flex-col gap-3">
            <Input placeholder="登录帐号(3-30 位,无空格)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input placeholder="姓名(显示名)" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            <Input type="password" placeholder="初始密码(至少 6 位)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="flex gap-1">
              {(['annotator', 'reviewer', 'admin'] as Role[]).filter((r) => me?.role === 'admin' || ROLE_LEVEL[me?.role ?? 'annotator'] > ROLE_LEVEL[r]).map((r) => (
                <Button key={r} type="button" size="sm" variant={form.role === r ? 'secondary' : 'outline'} className="h-7 flex-1 px-2 text-[11px]" onClick={() => setForm({ ...form, role: r })}>
                  {ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={!form.username.trim() || !form.display_name.trim() || form.password.length < 6}>创建</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logins} onOpenChange={(o) => { if (!o) setLogins(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>登录记录 · {logins?.user.username}</DialogTitle></DialogHeader>
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="py-1 text-left font-medium">时间</th><th className="py-1 text-left font-medium">IP</th><th className="py-1 text-left font-medium">设备</th></tr>
              </thead>
              <tbody>
                {(logins?.items ?? []).map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1.5">{new Date(l.login_at).toLocaleString('zh-CN')}</td>
                    <td className="py-1.5">{l.ip ?? '-'}</td>
                    <td className="max-w-[160px] truncate py-1.5" title={l.device}>{l.device ?? '-'}</td>
                  </tr>
                ))}
                {logins?.items.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">暂无记录</td></tr>}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
