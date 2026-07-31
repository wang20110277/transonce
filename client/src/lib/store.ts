import { useSyncExternalStore } from "react";
import type { Meeting, Requirement, ActivityEvent, DevTask, TestRun, Deployment } from "../types";
import { api, type ServerState, type NewRequirementBody, type NewTaskBody } from "../services/api";

/**
 * Observable client store. Server state arrives via the API (hydrate on load);
 * mutators persist to the backend and update local state with the returned
 * entities (so local IDs == server UUIDs). Activity is mirrored locally for a
 * live dashboard and reconciled on hydrate.
 */

export interface AppState {
  meetings: Meeting[];
  requirements: Requirement[];
  tasks: DevTask[];
  testRuns: TestRun[];
  deployments: Deployment[];
  activity: ActivityEvent[];
}

const initialState: AppState = {
  meetings: [],
  requirements: [],
  tasks: [],
  testRuns: [],
  deployments: [],
  activity: [],
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): AppState {
  return state;
}

export function setState(updater: (prev: AppState) => AppState) {
  state = updater(state);
  emit();
}

/** Select a stable slice of the store (top-level fields only). */
export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initialState),
  );
}

// --- hydration ---

export function hydrate(s: ServerState) {
  setState(() => ({
    meetings: s.meetings,
    requirements: s.requirements,
    tasks: s.tasks,
    testRuns: s.testRuns,
    deployments: s.deployments,
    activity: s.activity,
  }));
}

export async function loadFromServer() {
  hydrate(await api.getState());
}

// --- mutators (persist via API, update local with server entities) ---

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function logActivity(event: Omit<ActivityEvent, "id" | "at">) {
  const full: ActivityEvent = { id: uid("act"), at: new Date().toISOString(), ...event };
  setState((s) => ({ ...s, activity: [full, ...s.activity] }));
}

export async function addMeeting(meeting: {
  title: string;
  rawNotes: string;
  participants?: { name: string; role?: string }[];
  source?: Meeting["source"];
}): Promise<Meeting> {
  const created = await api.createMeeting(meeting);
  setState((s) => ({ ...s, meetings: [created, ...s.meetings] }));
  logActivity({ actorKind: "human", actorId: "current-user", type: "meeting.created", payload: { title: created.title } });
  return created;
}

export async function addRequirements(reqs: NewRequirementBody[]): Promise<Requirement[]> {
  const created = await api.createRequirements(reqs);
  setState((s) => ({ ...s, requirements: [...created, ...s.requirements] }));
  logActivity({ actorKind: "agent", actorId: "extractor", type: "requirement.created", payload: { count: created.length } });
  return created;
}

export async function addTasks(tasks: NewTaskBody[]): Promise<DevTask[]> {
  const created = await api.createTasks(tasks);
  setState((s) => ({ ...s, tasks: [...created, ...s.tasks] }));
  logActivity({ actorKind: "agent", actorId: "breakdown", type: "task.created", payload: { count: created.length } });
  return created;
}

export async function setTaskStatus(taskId: string, status: DevTask["status"]): Promise<void> {
  await api.updateTaskStatus(taskId, status);
  setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) }));
  logActivity({ actorKind: "human", actorId: "current-user", type: "task.status_changed", payload: { taskId, status } });
}

export async function addTestRun(run: {
  requirementId: string;
  status: TestRun["status"];
  cases: TestRun["cases"];
  passed: number;
  total: number;
}): Promise<TestRun> {
  const created = await api.createTestRun(run);
  setState((s) => ({ ...s, testRuns: [created, ...s.testRuns] }));
  logActivity({ actorKind: "agent", actorId: "tester", type: "test.run", payload: { passed: created.passed, total: created.total } });
  return created;
}

export async function addDeployment(dep: {
  artifactId: string;
  environment: Deployment["environment"];
  status: Deployment["status"];
  url?: string;
}): Promise<Deployment> {
  const created = await api.createDeployment(dep);
  setState((s) => ({ ...s, deployments: [created, ...s.deployments] }));
  logActivity({ actorKind: "agent", actorId: "deployer", type: "deployment.created", payload: { environment: created.environment, status: created.status } });
  return created;
}
