import { useSyncExternalStore } from "react";
import type {
  Alert, Artifact, Dashboard, Deployment, DevTask, Environment, Meeting, Monitor,
  Pipeline, PipelineRun, Project, Requirement, TestRun, AgentRun, ActivityEvent,
  TenantDetail, GitlabConnection, GitRepo, RepoAccessRequest,
} from "../types";
import { api } from "../services/api";

export type WorkspaceState = {
  tenantId: string | null;
  loading: boolean;
  error: string | null;
  detail: TenantDetail | null;
  dashboard: Dashboard | null;
  projects: Project[];
  meetings: Meeting[];
  requirements: Requirement[];
  tasks: DevTask[];
  testRuns: TestRun[];
  artifacts: Artifact[];
  connections: GitlabConnection[];
  repos: GitRepo[];
  myRepoRequests: RepoAccessRequest[];
  repoRequests: RepoAccessRequest[];
  pipelines: Pipeline[];
  pipelineRuns: PipelineRun[];
  deployments: Deployment[];
  environments: Environment[];
  monitors: Monitor[];
  alerts: Alert[];
  agentRuns: AgentRun[];
  activity: ActivityEvent[];
};

const initial: WorkspaceState = {
  tenantId: null,
  loading: false,
  error: null,
  detail: null,
  dashboard: null,
  projects: [],
  meetings: [],
  requirements: [],
  tasks: [],
  testRuns: [],
  artifacts: [],
  connections: [],
  repos: [],
  myRepoRequests: [],
  repoRequests: [],
  pipelines: [],
  pipelineRuns: [],
  deployments: [],
  environments: [],
  monitors: [],
  alerts: [],
  agentRuns: [],
  activity: [],
};

let state: WorkspaceState = initial;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}
function set(patch: Partial<WorkspaceState>) {
  state = { ...state, ...patch };
  emit();
}

export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => selector(state),
    () => selector(initial),
  );
}

export function getWorkspace(): WorkspaceState {
  return state;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function loadWorkspace(tenantId: string, force = false): Promise<void> {
  if (!force && state.tenantId === tenantId && !state.error && state.detail) return;
  if (inflight && state.tenantId === tenantId) return inflight;
  set({ tenantId, loading: true, error: null });
  inflight = (async () => {
    const [
      detail, dashboard, projects, meetings, requirements, tasks, testRuns,
      artifacts, connections, repos, myRepoRequests, repoRequests,
      pipelines, pipelineRuns, deployments, environments, monitors,
      alerts, agentRuns, activity,
    ] = await Promise.all([
      safe(api.tenants.detail(tenantId), null),
      safe(api.tenants.dashboard(tenantId), null),
      safe(api.projects.list(tenantId), []),
      safe(api.meetings.list(tenantId), []),
      safe(api.requirements.list(tenantId), []),
      safe(api.tasks.list(tenantId), []),
      safe(api.testRuns.list(tenantId), []),
      safe(api.artifacts.list(tenantId), []),
      safe(api.coderepos.connections(tenantId), []),
      safe(api.coderepos.repos(tenantId), []),
      safe(api.coderepos.myRequests(tenantId), []),
      safe(api.coderepos.requests(tenantId), []),
      safe(api.pipelines.list(tenantId), []),
      safe(api.pipelines.runs(tenantId), []),
      safe(api.deployments.list(tenantId), []),
      safe(api.environments.list(tenantId), []),
      safe(api.monitors.list(tenantId), []),
      safe(api.alerts.list(tenantId), []),
      safe(api.agentRuns.list(tenantId, 50), []),
      safe(api.tenants.activity(tenantId, 60), []),
    ]);
    set({
      tenantId, loading: false,
      detail, dashboard, projects, meetings, requirements, tasks, testRuns,
      artifacts, connections, repos, myRepoRequests, repoRequests,
      pipelines, pipelineRuns, deployments, environments, monitors,
      alerts, agentRuns, activity,
      error: detail ? null : "加载工作空间失败或没有访问权限",
    });
    inflight = null;
  })();
  return inflight;
}

export async function refreshWorkspace(): Promise<void> {
  if (state.tenantId) await loadWorkspace(state.tenantId, true);
}

export function invalidateWorkspace() {
  state = initial;
  emit();
}

/** Let any screen hand a task to the floating agent console. */
export function askAgent(content: string | undefined, context?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("transonce:chat", { detail: { content, context } }));
}
