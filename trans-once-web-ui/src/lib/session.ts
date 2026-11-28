import { useSyncExternalStore } from "react";
import type { AuthUser, TenantSummary } from "../types";
import { api, getToken, setToken, onUnauthorized } from "../services/api";
import { invalidateWorkspace } from "./store";
import { addLoginHistory } from "./loginHistory";

const TENANT_KEY = "transonce.tenant";

export type SessionState = {
  status: "idle" | "loading" | "ready" | "anonymous" | "error";
  user: AuthUser | null;
  memberships: TenantSummary[];
  currentTenant: TenantSummary | null;
  error: string | null;
};

const initial: SessionState = {
  status: "idle",
  user: null,
  memberships: [],
  currentTenant: null,
  error: null,
};

let state: SessionState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function set(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  emit();
}

export function useSession<T>(selector: (s: SessionState) => T): T {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => selector(state),
    () => selector(initial),
  );
}

export function getSession(): SessionState {
  return state;
}

export function can(permission: string): boolean {
  const t = state.currentTenant;
  if (!t) return false;
  return t.isTenantAdmin || t.isSuperAdmin === true || (t.permissions ?? []).includes(permission);
}

function normalize(memberships: TenantSummary[]): TenantSummary[] {
  return memberships.map((m) => ({
    ...m,
    permissions: m.permissions ?? m.role?.permissions ?? [],
    memberCount: m.memberCount ?? 0,
  }));
}

export function isAdmin(): boolean {
  return !!state.currentTenant?.isTenantAdmin || !!state.currentTenant?.isSuperAdmin;
}

function pickTenant(memberships: TenantSummary[], preferred: string | null): TenantSummary | null {
  if (!memberships.length) return null;
  const found = preferred ? memberships.find((m) => m.tenant.id === preferred) : null;
  return found ?? memberships[0];
}

export async function refreshSession(): Promise<void> {
  if (!getToken()) {
    set({ status: "anonymous", user: null, memberships: [], currentTenant: null });
    return;
  }
  set({ status: state.status === "ready" ? "ready" : "loading", error: null });
  try {
    const me = await api.auth.me();
    const memberships = normalize(me.memberships);
    const saved = localStorage.getItem(TENANT_KEY);
    const current = pickTenant(memberships, saved);
    if (current) localStorage.setItem(TENANT_KEY, current.tenant.id);
    set({ status: "ready", user: me.user, memberships, currentTenant: current });
  } catch (e) {
    set({ status: "anonymous", user: null, memberships: [], currentTenant: null, error: String(e) });
  }
}

export async function login(email: string, password: string): Promise<void> {
  const res = await api.auth.login(email, password);
  setToken(res.token);
  addLoginHistory({ email: res.user.email, name: res.user.name, provider: "password" });
  set({ user: res.user, status: "loading" });
  await refreshSession();
}

export async function register(email: string, name: string, password: string): Promise<void> {
  const res = await api.auth.register(email, name, password);
  setToken(res.token);
  addLoginHistory({ email: res.user.email, name: res.user.name, provider: "password" });
  set({ user: res.user, status: "loading" });
  await refreshSession();
}

// 微软认证登录回调：用授权码换取平台会话。邮箱已存在则复用账号，
// 不存在由后端自动注册（无密码，authProvider=microsoft）。
export async function loginWithMicrosoft(code: string, state: string): Promise<void> {
  const res = await api.auth.microsoftCallback(code, state);
  setToken(res.token);
  addLoginHistory({ email: res.user.email, name: res.user.name, provider: "microsoft" });
  set({ user: res.user, status: "loading" });
  await refreshSession();
}

// 通用 OIDC 登录回调：与微软同套路，authProvider=oidc。
export async function loginWithOidc(code: string, state: string): Promise<void> {
  const res = await api.auth.oidcCallback(code, state);
  setToken(res.token);
  addLoginHistory({ email: res.user.email, name: res.user.name, provider: "oidc" });
  set({ user: res.user, status: "loading" });
  await refreshSession();
}

// 企业账号（LDAP/AD）登录：域账号密码直连校验，authProvider=ldap。
// 历史记录多存一份域账号用户名，便于下次回填。
export async function loginWithLdap(username: string, password: string): Promise<void> {
  const res = await api.auth.ldapLogin(username, password);
  setToken(res.token);
  addLoginHistory({ email: res.user.email, name: res.user.name, provider: "ldap", username });
  set({ user: res.user, status: "loading" });
  await refreshSession();
}

export function selectTenant(tenant: TenantSummary) {
  localStorage.setItem(TENANT_KEY, tenant.tenant.id);
  set({ currentTenant: tenant });
}

export function clearTenant() {
  localStorage.removeItem(TENANT_KEY);
  set({ currentTenant: null });
}

export function logout() {
  setToken(null);
  localStorage.removeItem(TENANT_KEY);
  // Drop cached workspace data too: switching accounts within the same tenant
  // must not show the previous user's requirements/deployments.
  invalidateWorkspace();
  set({ ...initial, status: "anonymous" });
}

export async function reloadMemberships() {
  const me = await api.auth.me();
  const memberships = normalize(me.memberships);
  const saved = state.currentTenant?.tenant.id ?? localStorage.getItem(TENANT_KEY);
  const current = pickTenant(memberships, saved);
  set({ user: me.user, memberships, currentTenant: current, status: "ready" });
}

onUnauthorized(() => {
  if (state.status !== "anonymous") logout();
});
