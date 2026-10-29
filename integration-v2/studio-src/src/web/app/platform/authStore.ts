/** 登录态:模块级 store,避免在 AppShell 上再打一层 Provider。 */
import { useSyncExternalStore } from 'react';
import { api, type User } from './api';

type AuthState = { user: User | null; ready: boolean; bypass: boolean };

let state: AuthState = { user: null, ready: false, bypass: false };
const listeners = new Set<() => void>();

export function getAuth(): AuthState {
  return state;
}

export function setAuth(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getAuth,
  );
}

let initPromise: Promise<void> | null = null;

export function initAuth(): Promise<void> {
  if (!initPromise) {
    initPromise = api
      .me()
      .then((user) => setAuth({ user, ready: true }))
      .catch((e) => {
        // 后端认证接口还没部署(404):放行,登录守卫等 Agent A 落地后自动生效
        const status = (e as { status?: number })?.status;
        if (status === 404 || status === 501) setAuth({ user: null, ready: true, bypass: true });
        else setAuth({ user: null, ready: true });
      });
  }
  return initPromise;
}
