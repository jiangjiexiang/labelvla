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
      // 认证接口失败一律按未登录处理并落到登录页;不再用 404 旁路放行,
      // 否则后端只要抖一次,整个数据面就是裸的。
      .catch(() => setAuth({ user: null, ready: true, bypass: false }));
  }
  return initPromise;
}
