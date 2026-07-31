import type {
  Meeting,
  Requirement,
  DevTask,
  TestRun,
  Deployment,
  ActivityEvent,
} from "../types";

/** Backend client. Requests go to /api, proxied to the Python backend by Vite. */
const BASE = "/api";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg += `: ${(await res.text()).slice(0, 500)}`;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function getJson<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`${BASE}${path}`));
}
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface ServerState {
  meetings: Meeting[];
  requirements: Requirement[];
  tasks: DevTask[];
  testRuns: TestRun[];
  deployments: Deployment[];
  activity: ActivityEvent[];
}

export interface NewMeeting {
  title: string;
  rawNotes: string;
  participants?: { name: string; role?: string }[];
  source?: Meeting["source"];
}
export interface NewRequirementBody {
  title: string;
  description?: string;
  priority?: Requirement["priority"];
  acceptanceCriteria?: string[];
  sourceMeetingId?: string;
}
export interface NewTaskBody {
  requirementId: string;
  title: string;
  description?: string;
  assigneeKind: "human" | "agent";
  assigneeId?: string;
  estimate?: string;
  acceptanceCriteria?: string[];
}

export const api = {
  getState: () => getJson<ServerState>("/state"),

  createMeeting: (m: NewMeeting) => postJson<Meeting>("/meetings", m),
  createRequirements: (rs: NewRequirementBody[]) =>
    postJson<Requirement[]>("/requirements", rs),
  createTasks: (ts: NewTaskBody[]) => postJson<DevTask[]>("/tasks", ts),
  updateTaskStatus: (id: string, status: DevTask["status"]) =>
    patchJson<DevTask>(`/tasks/${id}/status`, { status }),
  createTestRun: (r: {
    requirementId: string;
    status: TestRun["status"];
    cases: TestRun["cases"];
    passed: number;
    total: number;
  }) => postJson<TestRun>("/test-runs", r),
  createDeployment: (d: {
    artifactId: string;
    environment: Deployment["environment"];
    status: Deployment["status"];
    url?: string;
  }) => postJson<Deployment>("/deployments", d),

  // agent runs — return raw envelope; callers unwrap
  agentExtract: (title: string, notes: string) =>
    postJson<{ requirements: unknown[] }>("/agents/extract", { title, notes }),
  agentBreakdown: (title: string, description: string, acceptanceCriteria: string[]) =>
    postJson<{ tasks: unknown[] }>("/agents/breakdown", { title, description, acceptanceCriteria }),
  agentTest: (title: string, description: string, acceptanceCriteria: string[]) =>
    postJson<{ cases: unknown[] }>("/agents/test", { title, description, acceptanceCriteria }),
  agentDeploy: (title: string, description: string) =>
    postJson<{ plan: unknown }>("/agents/deploy", { title, description }),
};
