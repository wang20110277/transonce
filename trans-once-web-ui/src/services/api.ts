import type {
  Agent, Alert, Artifact, AuthUser, Conversation, Dashboard, Deployment, DevTask,
  Environment, JoinRequest, Meeting, Member, Monitor, Permission, Pipeline,
  PipelineRun, Project, Requirement, Role, System, Codebase, TenantDetail,
  TenantSummary, TestRun, AgentRun, ActivityEvent, GitlabConnection, GitRepo,
  RepoAccessRequest, RepoAccessRole,
} from "../types";

const BASE = "/api";
const TOKEN_KEY = "transonce.token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    unauthorizedHandler?.();
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        msg = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail ?? parsed);
      } catch {
        msg = text.slice(0, 400) || msg;
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

const T = (tenantId: string) => `/tenants/${tenantId}`;

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ token: string; user: AuthUser }>("/auth/login", { email, password }),
    register: (email: string, name: string, password: string) =>
      post<{ token: string; user: AuthUser }>("/auth/register", { email, name, password }),
    me: () => get<{ user: AuthUser; memberships: TenantSummary[] }>("/auth/me"),
    updateMe: (body: Partial<{ name: string; avatar: string; password: string; currentPassword: string }>) =>
      patch<AuthUser>("/auth/me", body),
    permissions: () => get<Permission[]>("/permissions"),
  },

  tenants: {
    list: () => get<{ items: TenantSummary[] }>("/tenants"),
    discover: (q?: string) =>
      get<{ items: { tenant: TenantDetail["tenant"]; memberCount: number; myRequestStatus: string | null }[] }>(
        `/tenants/discover${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    create: (body: { name: string; description?: string; joinPolicy?: string }) =>
      post<TenantSummary>("/tenants", body),
    detail: (tid: string) => get<TenantDetail>(T(tid)),
    dashboard: (tid: string) => get<Dashboard>(`${T(tid)}/dashboard`),
    activity: (tid: string, limit = 50) => get<ActivityEvent[]>(`${T(tid)}/activity?limit=${limit}`),

    roles: (tid: string) => get<Role[]>(`${T(tid)}/roles`),
    createRole: (tid: string, body: { name: string; description?: string; permissions: string[] }) =>
      post<Role>(`${T(tid)}/roles`, body),
    updateRole: (tid: string, rid: string, body: Partial<{ name: string; description: string; permissions: string[] }>) =>
      patch<Role>(`${T(tid)}/roles/${rid}`, body),
    deleteRole: (tid: string, rid: string) => del<{ ok: true }>(`${T(tid)}/roles/${rid}`),

    members: (tid: string) => get<Member[]>(`${T(tid)}/members`),
    addMember: (tid: string, body: { email: string; name?: string; roleId?: string; isTenantAdmin?: boolean }) =>
      post<Member>(`${T(tid)}/members`, body),
    updateMember: (tid: string, uid: string, body: Partial<{ roleId: string; isTenantAdmin: boolean; status: string }>) =>
      patch<Member>(`${T(tid)}/members/${uid}`, body),
    removeMember: (tid: string, uid: string) => del<{ ok: true }>(`${T(tid)}/members/${uid}`),

    joinRequests: (tid: string) => get<JoinRequest[]>(`${T(tid)}/join-requests`),
    requestJoin: (tid: string, body: { message?: string; roleId?: string }) =>
      post<JoinRequest>(`${T(tid)}/join-requests`, body),
    approveJoin: (tid: string, rid: string, roleId?: string) =>
      post<{ ok: true }>(`${T(tid)}/join-requests/${rid}/approve`, { roleId }),
    rejectJoin: (tid: string, rid: string) =>
      post<{ ok: true }>(`${T(tid)}/join-requests/${rid}/reject`),

    agents: (tid: string) => get<Agent[]>(`${T(tid)}/agents`),
    updateAgent: (tid: string, aid: string, body: Partial<Agent> & { systemPrompt?: string }) =>
      patch<Agent>(`${T(tid)}/agents/${aid}`, body),
    resetAgent: (tid: string) => post<Agent>(`${T(tid)}/agents/reset`),
  },

  projects: {
    list: (tid: string) => get<Project[]>(`${T(tid)}/projects`),
    create: (tid: string, body: { name: string; description?: string }) => post<Project>(`${T(tid)}/projects`, body),
    update: (tid: string, pid: string, body: Partial<Project>) => patch<Project>(`${T(tid)}/projects/${pid}`, body),
    remove: (tid: string, pid: string) => del<{ ok: true }>(`${T(tid)}/projects/${pid}`),
    systems: (tid: string, pid: string) => get<System[]>(`${T(tid)}/projects/${pid}/systems`),
    createSystem: (tid: string, pid: string, body: { name: string; description?: string }) =>
      post<System>(`${T(tid)}/projects/${pid}/systems`, body),
    removeSystem: (tid: string, sid: string) => del<{ ok: true }>(`${T(tid)}/systems/${sid}`),
    createCodebase: (tid: string, sid: string, body: { name?: string; repoId?: string; repoUrl?: string; language?: string; defaultBranch?: string }) =>
      post<Codebase>(`${T(tid)}/systems/${sid}/codebases`, body),
    removeCodebase: (tid: string, cid: string) => del<{ ok: true }>(`${T(tid)}/codebases/${cid}`),
  },

  meetings: {
    list: (tid: string) => get<Meeting[]>(`${T(tid)}/meetings`),
    create: (tid: string, body: Partial<Meeting> & { title: string; rawNotes: string }) =>
      post<Meeting>(`${T(tid)}/meetings`, body),
    remove: (tid: string, mid: string) => del<{ ok: true }>(`${T(tid)}/meetings/${mid}`),
    extract: (tid: string, mid: string, save = false) =>
      post<{ requirements: Requirement[]; count: number }>(`${T(tid)}/meetings/${mid}/extract?save=${save}`),
  },

  requirements: {
    list: (tid: string) => get<Requirement[]>(`${T(tid)}/requirements`),
    create: (tid: string, body: Partial<Requirement> | Partial<Requirement>[]) =>
      post<Requirement[]>(`${T(tid)}/requirements`, body),
    get: (tid: string, rid: string) => get<Requirement>(`${T(tid)}/requirements/${rid}`),
    update: (tid: string, rid: string, body: Partial<Requirement>) =>
      patch<Requirement>(`${T(tid)}/requirements/${rid}`, body),
    remove: (tid: string, rid: string) => del<{ ok: true }>(`${T(tid)}/requirements/${rid}`),
    design: (tid: string, rid: string, force = false) =>
      post<Requirement>(`${T(tid)}/requirements/${rid}/design?force=${force}`),
    breakdown: (tid: string, rid: string, force = false) =>
      post<DevTask[]>(`${T(tid)}/requirements/${rid}/breakdown?force=${force}`),
    code: (tid: string, rid: string, force = false) =>
      post<Artifact>(`${T(tid)}/requirements/${rid}/code?force=${force}`),
    test: (tid: string, rid: string, force = false) =>
      post<TestRun>(`${T(tid)}/requirements/${rid}/test?force=${force}`),
    autopilot: (tid: string, rid: string, body: { environmentId?: string; deploy?: boolean } = {}) =>
      post<{ requirementId: string; steps: { stage: string; ok: boolean; detail: string }[]; artifact: Artifact; testRun: TestRun; pipelineRun: PipelineRun; deployment: Deployment | null }>(
        `${T(tid)}/requirements/${rid}/autopilot`, body,
      ),
  },

  tasks: {
    list: (tid: string) => get<DevTask[]>(`${T(tid)}/tasks`),
    updateStatus: (tid: string, taskId: string, status: string) =>
      patch<DevTask>(`${T(tid)}/tasks/${taskId}/status`, { status }),
    run: (tid: string, taskId: string) => post<DevTask>(`${T(tid)}/tasks/${taskId}/run`),
  },

  testRuns: {
    list: (tid: string) => get<TestRun[]>(`${T(tid)}/test-runs`),
  },

  agentRuns: {
    list: (tid: string, limit = 50) => get<AgentRun[]>(`${T(tid)}/agent-runs?limit=${limit}`),
  },

  artifacts: {
    list: (tid: string) => get<Artifact[]>(`${T(tid)}/artifacts`),
    get: (tid: string, aid: string) => get<Artifact>(`${T(tid)}/artifacts/${aid}`),
    remove: (tid: string, aid: string) => del<{ ok: true }>(`${T(tid)}/artifacts/${aid}`),
    release: (tid: string, aid: string, environmentId: string, notes?: string) =>
      post<Deployment>(`${T(tid)}/artifacts/${aid}/release`, { environmentId, notes }),
  },

  pipelines: {
    list: (tid: string) => get<Pipeline[]>(`${T(tid)}/pipelines`),
    create: (tid: string, body: Partial<Pipeline>) => post<Pipeline>(`${T(tid)}/pipelines`, body),
    remove: (tid: string, pid: string) => del<{ ok: true }>(`${T(tid)}/pipelines/${pid}`),
    run: (tid: string, pid: string, artifactId?: string) =>
      post<PipelineRun>(`${T(tid)}/pipelines/${pid}/run`, { artifactId }),
    runs: (tid: string) => get<PipelineRun[]>(`${T(tid)}/pipeline-runs`),
  },

  environments: {
    list: (tid: string) => get<Environment[]>(`${T(tid)}/environments`),
    create: (tid: string, body: Partial<Environment> & { password?: string }) =>
      post<Environment>(`${T(tid)}/environments`, body),
    update: (tid: string, eid: string, body: Partial<Environment> & { password?: string }) =>
      patch<Environment>(`${T(tid)}/environments/${eid}`, body),
    remove: (tid: string, eid: string) => del<{ ok: true }>(`${T(tid)}/environments/${eid}`),
    reveal: (tid: string, eid: string) => post<{ password: string | null }>(`${T(tid)}/environments/${eid}/reveal`),
  },

  deployments: {
    list: (tid: string) => get<Deployment[]>(`${T(tid)}/deployments`),
    create: (tid: string, body: { artifactId: string; environmentId: string; notes?: string }) =>
      post<Deployment>(`${T(tid)}/deployments`, body),
  },

  monitors: {
    list: (tid: string) => get<Monitor[]>(`${T(tid)}/monitors`),
    create: (tid: string, body: Partial<Monitor> & { environmentId?: string }) =>
      post<Monitor>(`${T(tid)}/monitors`, body),
    update: (tid: string, mid: string, body: Partial<Monitor>) =>
      patch<Monitor>(`${T(tid)}/monitors/${mid}`, body),
    remove: (tid: string, mid: string) => del<{ ok: true }>(`${T(tid)}/monitors/${mid}`),
    check: (tid: string, mid: string) => post<Monitor>(`${T(tid)}/monitors/${mid}/check`),
    checkAll: (tid: string) => post<Monitor[]>(`${T(tid)}/monitors/check-all`),
  },

  alerts: {
    list: (tid: string) => get<Alert[]>(`${T(tid)}/alerts`),
    update: (tid: string, aid: string, status: Alert["status"]) =>
      patch<Alert>(`${T(tid)}/alerts/${aid}`, { status }),
  },

  coderepos: {
    connections: (tid: string) => get<GitlabConnection[]>(`${T(tid)}/gitlab/connections`),
    createConnection: (tid: string, body: { name: string; baseUrl: string; token?: string; mode: "live" | "demo" }) =>
      post<GitlabConnection>(`${T(tid)}/gitlab/connections`, body),
    updateConnection: (tid: string, cid: string, body: Partial<{ name: string; baseUrl: string; token: string; mode: "live" | "demo" }>) =>
      patch<GitlabConnection>(`${T(tid)}/gitlab/connections/${cid}`, body),
    removeConnection: (tid: string, cid: string) => del<{ ok: true }>(`${T(tid)}/gitlab/connections/${cid}`),
    syncConnection: (tid: string, cid: string) =>
      post<{ ok: boolean; count: number; source: string; connection: GitlabConnection }>(`${T(tid)}/gitlab/connections/${cid}/sync`),

    repos: (tid: string, q?: string, connectionId?: string) =>
      get<GitRepo[]>(`${T(tid)}/repos${q || connectionId ? `?${[
        q ? `q=${encodeURIComponent(q)}` : "", connectionId ? `connection_id=${connectionId}` : "",
      ].filter(Boolean).join("&")}` : ""}`),
    repo: (tid: string, rid: string) => get<GitRepo>(`${T(tid)}/repos/${rid}`),

    myRequests: (tid: string) => get<RepoAccessRequest[]>(`${T(tid)}/repo-access-requests/mine`),
    requests: (tid: string) => get<RepoAccessRequest[]>(`${T(tid)}/repo-access-requests`),
    requestAccess: (tid: string, rid: string, body: { role: RepoAccessRole; reason?: string }) =>
      post<RepoAccessRequest>(`${T(tid)}/repos/${rid}/access-requests`, body),
    approve: (tid: string, requestId: string, body?: { role?: RepoAccessRole; note?: string }) =>
      post<RepoAccessRequest>(`${T(tid)}/repo-access-requests/${requestId}/approve`, body),
    reject: (tid: string, requestId: string, note?: string) =>
      post<RepoAccessRequest>(`${T(tid)}/repo-access-requests/${requestId}/reject`, { note }),
    revoke: (tid: string, rid: string, userId: string) =>
      del<{ ok: true }>(`${T(tid)}/repos/${rid}/access/${userId}`),
  },

  chat: {
    conversations: (tid: string) => get<Conversation[]>(`${T(tid)}/conversations`),
    createConversation: (tid: string, context?: Record<string, unknown>) =>
      post<Conversation>(`${T(tid)}/conversations`, { context }),
    messages: (tid: string, cid: string) => get<import("../types").ChatMessage[]>(`${T(tid)}/conversations/${cid}/messages`),
    send: (tid: string, cid: string, content: string, context?: Record<string, unknown>, confirm = false) =>
      post<{ userMessage: import("../types").ChatMessage; assistantMessage: import("../types").ChatMessage }>(
        `${T(tid)}/conversations/${cid}/messages`, { content, context, confirm },
      ),
    quick: (tid: string, content: string, context?: Record<string, unknown>, conversationId?: string, confirm = false) =>
      post<{ conversation: Conversation; userMessage: import("../types").ChatMessage; assistantMessage: import("../types").ChatMessage }>(
        `${T(tid)}/chat`, { content, context, conversationId, confirm },
      ),
    remove: (tid: string, cid: string) => del<{ ok: true }>(`${T(tid)}/conversations/${cid}`),
  },
};
