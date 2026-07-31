export type User = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  isSystemAdmin?: boolean;
};

export type Role = {
  id: string;
  name: string;
  permissions: string[]; // Menu IDs
  agentId?: string; // Associated AI agent
};

export type Member = {
  userId: string;
  roleId: string;
  status: 'pending' | 'active';
  isTeamAdmin?: boolean;
};

export type Agent = {
  id: string;
  name: string;
  model: 'claudecode' | 'codex';
  description: string;
};

export type Tenant = {
  id: string;
  name: string;
  logo?: string;
  roles: Role[];
  members: Member[];
  agents: Agent[];
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  tenantIds: string[];
};

export type System = {
  id: string;
  projectId: string;
  name: string;
  description: string;
};

export type Codebase = {
  id: string;
  systemId: string;
  name: string;
  repoUrl: string;
  language: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

export type Comment = {
  id: string;
  userId: string;
  content: string;
  timestamp: string;
  attachments: string[]; // List of asset IDs
};

export type Asset = {
  id: string;
  name: string;
  type: string;
  path: string;
  creatorId: string; // User ID or Agent ID
  timestamp: string;
};

export type Requirement = {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  status: 'draft' | 'designing' | 'completed';
  chatHistory: ChatMessage[];
  comments: Comment[];
  assets: Asset[];
  prototype?: string;
  artifact?: string;
  /** Meeting this requirement was extracted from (meetily-style entry point). */
  sourceMeetingId?: string;
  priority?: 'low' | 'medium' | 'high';
  acceptanceCriteria?: string[];
};

export type Artifact = {
  id: string;
  type: 'requirement' | 'code';
  name: string;
  content: string;
  version: string;
  createdAt: string;
};

export type Deployment = {
  id: string;
  artifactId: string;
  environment: 'test' | 'production';
  status: 'pending' | 'success' | 'failed';
  url?: string;
  deployedAt: string;
};

// ---------------------------------------------------------------------------
// Pipeline domain types (会议纪要 → 需求 → 研发 → 测试 → 运维)
// ---------------------------------------------------------------------------

export type MeetingParticipant = {
  name: string;
  role?: string;
};

/** Raw meeting input — the entry point of the pipeline (meetily-shaped). */
export type Meeting = {
  id: string;
  projectId?: string;
  title: string;
  rawNotes: string;
  transcript?: string;
  participants: MeetingParticipant[];
  source: 'manual' | 'upload' | 'transcription';
  createdAt: string;
};

/** Task lifecycle borrowed from multica (queued → ... → done|failed). */
export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'reviewing'
  | 'done'
  | 'failed';

export type DevTask = {
  id: string;
  requirementId: string;
  title: string;
  description: string;
  /** Any task is assignable to a human OR an agent (first-class agent assignee). */
  assigneeKind: 'human' | 'agent';
  assigneeId?: string;
  status: TaskStatus;
  agentRunId?: string;
  estimate?: string;
  acceptanceCriteria?: string[];
};

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Unit of agent work; streamed over WebSocket in later phases. */
export type AgentRun = {
  id: string;
  agentId: string;
  taskType: string;
  status: AgentRunStatus;
  input: string;
  output?: string;
  events: { at: string; message: string }[];
  startedAt: string;
  endedAt?: string;
};

/** Shared human + agent collaboration timeline (multica-style activity feed). */
export type ActivityEvent = {
  id: string;
  projectId?: string;
  actorKind: 'human' | 'agent' | 'system';
  actorId: string;
  type: string;
  payload?: Record<string, unknown>;
  at: string;
};

// ---------------------------------------------------------------------------
// Testing (xone-shaped)
// ---------------------------------------------------------------------------

export type TestType = 'unit' | 'integration' | 'e2e';

export type TestCase = {
  id: string;
  title: string;
  type: TestType;
  steps: string[];
  expectedResult: string;
};

export type TestRunStatus = 'pending' | 'running' | 'passed' | 'failed';

export type TestRunCase = {
  id: string;
  title: string;
  type: TestType;
  passed: boolean;
};

export type TestRun = {
  id: string;
  requirementId: string;
  status: TestRunStatus;
  cases: TestRunCase[];
  passed: number;
  total: number;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// DevOps / CI-CD (xone-shaped)
// ---------------------------------------------------------------------------

export type PipelineStage = {
  name: string;
  command?: string;
};

export type DeploymentPlan = {
  stages: PipelineStage[];
  environments: string[];
  notes: string;
};
