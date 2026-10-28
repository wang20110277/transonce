// Domain model shared by the UI and the FastAPI backend (camelCase API).

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  isSuperAdmin: boolean;
  status?: string;
  createdAt?: string;
};

export type Permission = { id: string; label: string; group: string };

export type Role = {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  permissions: string[];
  isSystem?: boolean;
  createdAt?: string;
};

export type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  status: "active" | "invited" | "pending" | "disabled";
  isTenantAdmin: boolean;
  isSuperAdmin?: boolean;
  joinedAt?: string | null;
  agentId?: string | null;
  tempPassword?: string | null;
};

export type JoinRequest = {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  message?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type Agent = {
  id: string;
  tenantId: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  name: string;
  provider: "auto" | "claude" | "opencode" | "mock";
  model?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  tools?: string[];
  isDefault?: boolean;
  status?: string;
  createdAt?: string;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logo?: string | null;
  joinPolicy?: string;
  status?: string;
  createdAt?: string;
};

export type TenantSummary = {
  tenant: Tenant;
  role?: Role | null;
  permissions?: string[];
  isTenantAdmin: boolean;
  isSuperAdmin?: boolean;
  membershipStatus?: string | null;
  memberCount?: number;
  agent?: Agent | null;
};

export type TenantDetail = TenantSummary & {
  permissions: string[];
  memberCount: number;
  members: Member[];
  roles: Role[];
  agents: Agent[];
  joinRequests: JoinRequest[];
  myAgent: Agent;
};

export type Project = {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status?: string;
  systemCount?: number;
  createdAt: string;
};

export type System = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  codebases?: Codebase[];
  createdAt: string;
};

export type Codebase = {
  id: string;
  systemId: string;
  name: string;
  repoUrl?: string | null;
  language?: string | null;
  defaultBranch?: string | null;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  createdAt?: string;
  intent?: string | null;
  actionResult?: ActionResult | null;
};

export type ActionResult = {
  kind: string;
  items?: unknown[];
  item?: unknown;
  error?: string;
  [key: string]: unknown;
};

export type Conversation = {
  id: string;
  tenantId: string;
  userId: string;
  agentId: string;
  title: string;
  context?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Meeting = {
  id: string;
  tenantId?: string;
  projectId?: string | null;
  title: string;
  rawNotes: string;
  transcript?: string | null;
  participants: { name: string; role?: string }[];
  source: "manual" | "upload" | "transcription";
  status?: "draft" | "extracted";
  createdAt: string;
};

export type Requirement = {
  id: string;
  tenantId?: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  status: "draft" | "designing" | "completed";
  priority?: "low" | "medium" | "high" | null;
  acceptanceCriteria: string[];
  sourceMeetingId?: string | null;
  prototype?: string | null;
  architecture?: Architecture;
  designStatus?: "draft" | "designed";
  artifact?: string | null;
  createdAt: string;
};

// Agent 产出的列表项既可能是字符串，也可能是结构化对象——渲染端需兼容两种形态。
export type FlowSpec = string | { name?: string; trigger?: string; steps?: unknown[]; guarantee?: string };
export type RiskSpec = string | { risk?: string; mitigation?: string; description?: string };

export type Architecture = {
  style?: string;
  components?: { name: string; responsibility: string; tech: string }[];
  dataModel?: { table: string; fields: string[] }[];
  apis?: { method: string; path: string; purpose: string }[];
  deployment?: string;
  risks?: RiskSpec[];
  diagram?: string;
};

export type Prototype = {
  summary?: string;
  pages?: { name: string; purpose: string; components: string[] }[];
  flows?: FlowSpec[];
  acceptance?: string[];
};

export type TaskStatus = "queued" | "assigned" | "running" | "reviewing" | "done" | "failed";

export type DevTask = {
  id: string;
  tenantId?: string;
  requirementId: string;
  title: string;
  description?: string | null;
  assigneeKind: "human" | "agent";
  assigneeId?: string | null;
  status: TaskStatus;
  estimate?: string | null;
  acceptanceCriteria: string[];
  agentRunId?: string | null;
  createdAt?: string;
};

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed";

export type AgentRun = {
  id: string;
  tenantId?: string;
  agentId?: string | null;
  agentName?: string | null;
  taskType: string;
  status: AgentRunStatus;
  input?: string | null;
  output?: string | null;
  events?: { at: string; message: string }[];
  error?: string | null;
  startedAt: string;
  endedAt?: string | null;
};

export type ActivityEvent = {
  id: string;
  tenantId?: string;
  projectId?: string | null;
  actorKind: "human" | "agent" | "system";
  actorId: string;
  type: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type TestRun = {
  id: string;
  requirementId: string;
  status: "pending" | "running" | "passed" | "failed";
  cases: { id: string; title: string; type: string; passed: boolean; simulated?: boolean }[];
  passed: number;
  total: number;
  simulated?: boolean;
  agentRunId?: string | null;
  createdAt: string;
};

export type Artifact = {
  id: string;
  tenantId?: string;
  requirementId?: string | null;
  codebaseId?: string | null;
  pipelineRunId?: string | null;
  name: string;
  type: string;
  version: string;
  content?: string | null;
  checksum?: string | null;
  status: string;
  repoUrl?: string | null;
  createdAt: string;
};

export type PipelineStage = {
  name: string;
  command?: string;
  status?: string;
  durationMs?: number;
};

export type Pipeline = {
  id: string;
  tenantId?: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  stages: PipelineStage[];
  trigger: string;
  createdAt: string;
};

export type PipelineRun = {
  id: string;
  pipelineId: string;
  tenantId?: string;
  artifactId?: string | null;
  status: "running" | "succeeded" | "failed";
  stages: PipelineStage[];
  log?: string | null;
  simulated?: boolean;
  startedAt: string;
  endedAt?: string | null;
};

export type Environment = {
  id: string;
  tenantId?: string;
  name: string;
  kind: "dev" | "test" | "staging" | "production";
  baseUrl?: string | null;
  ip?: string | null;
  username?: string | null;
  passwordMasked?: string | null;
  hasPassword?: boolean;
  config?: Record<string, unknown>;
  createdAt: string;
};

// --- 代码管理：GitLab 连接、代码库与权限申请 ---

export type RepoAccessRole = "guest" | "reporter" | "developer" | "maintainer";

export const REPO_ROLE_LABELS: Record<RepoAccessRole, string> = {
  guest: "访客",
  reporter: "报告者",
  developer: "开发者",
  maintainer: "管理员",
};

export type GitlabConnection = {
  id: string;
  tenantId?: string;
  name: string;
  baseUrl?: string | null;
  mode: "live" | "demo";
  status: "active" | "error";
  account?: string | null;
  hasToken?: boolean;
  tokenMasked?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  repoCount?: number | null;
  createdAt?: string;
};

export type GitRepo = {
  id: string;
  tenantId?: string;
  connectionId: string;
  connectionName?: string | null;
  externalId?: string | null;
  path: string;
  name: string;
  namespace?: string | null;
  webUrl?: string | null;
  description?: string | null;
  defaultBranch?: string | null;
  visibility?: string | null;
  archived?: boolean;
  lastActivityAt?: string | null;
  fetchedAt?: string | null;
  myAccess?: { role: RepoAccessRole; grantedAt?: string | null } | null;
  myRequest?: { id: string; role: RepoAccessRole; status: string } | null;
  members?: RepoAccessGrant[];
};

export type RepoAccessGrant = {
  id: string;
  repoId?: string;
  repoPath?: string | null;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  role: RepoAccessRole;
  grantedAt?: string | null;
};

export type RepoAccessRequest = {
  id: string;
  tenantId?: string;
  repoId: string;
  repoPath?: string | null;
  repoName?: string | null;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  role: RepoAccessRole;
  reason?: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
};

export type Deployment = {
  id: string;
  tenantId?: string;
  artifactId: string;
  artifactName?: string | null;
  environmentId?: string | null;
  environment: string;
  status: "pending" | "success" | "failed";
  url?: string | null;
  notes?: string | null;
  simulated?: boolean;
  deployedAt: string;
};

export type Monitor = {
  id: string;
  tenantId?: string;
  environmentId?: string | null;
  environmentName?: string | null;
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
  intervalSeconds: number;
  status: "up" | "down" | "unknown";
  lastCheckedAt?: string | null;
  lastLatencyMs?: number | null;
  lastError?: string | null;
  createdAt: string;
};

export type Alert = {
  id: string;
  tenantId?: string;
  monitorId?: string | null;
  monitorName?: string | null;
  deploymentId?: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string | null;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
};

export type Dashboard = {
  counts: {
    meetings: number;
    requirements: number;
    tasks: number;
    testRuns: number;
    artifacts: number;
    repos?: number;
    pipelines: number;
    deployments: number;
    environments: number;
    monitors: number;
    openAlerts: number;
    agents: number;
    members: number;
  };
  requirementsByStatus: Record<string, number>;
  activity: ActivityEvent[];
};
