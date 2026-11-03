import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/ui';
import { api } from './platform/api';
import { setAuth } from './platform/authStore';
import { resetPageTo, takeLandingPage } from './platform/usePage';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 首登强制改密
  const [needChange, setNeedChange] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.login(username.trim(), password);
      if (r.must_change_password) {
        setNeedChange(true);
        setOldPw(password);
        setBusy(false);
        return;
      }
      setAuth({ user: r, ready: true });
      resetPageTo(takeLandingPage());
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) { setError('新密码至少 6 位'); return; }
    if (newPw !== newPw2) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    setError('');
    try {
      await api.changePassword(oldPw, newPw);
      const me = await api.me();
      setAuth({ user: me, ready: true });
      resetPageTo(takeLandingPage());
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background">
      <Card className="w-[340px]">
        <CardHeader>
          <CardTitle className="text-lg">LabelVLA 数据平台</CardTitle>
          <CardDescription>{needChange ? '首次登录请修改密码' : '请登录'}</CardDescription>
        </CardHeader>
        <CardContent>
          {!needChange ? (
            <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
              <Input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              <Input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="m-0 text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={busy || !username.trim() || !password}>
                {busy ? '登录中…' : '登录'}
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => void changePw(e)} className="flex flex-col gap-3">
              <Input type="password" placeholder="新密码(至少 6 位)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus />
              <Input type="password" placeholder="确认新密码" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
              {error && <p className="m-0 text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={busy || !newPw}>
                {busy ? '提交中…' : '修改并进入'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
