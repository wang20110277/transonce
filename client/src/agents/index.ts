import { api } from "../services/api";

/**
 * Pipeline agents — drive the backend, which in turn runs real coding agents
 * (Claude Code / opencode) as subprocesses. This module keeps the same
 * contracts the UI already uses; only the transport changed (Gemini → backend).
 */

export type AgentId = "extractor" | "breakdown" | "coder" | "tester" | "deployer";

export interface PipelineAgent {
  id: AgentId;
  name: string; // 中文展示名
  role: string; // 阶段转换描述
  description: string;
}

export const AGENTS: Record<AgentId, PipelineAgent> = {
  extractor: { id: "extractor", name: "需求架构师", role: "会议纪要 → 结构化需求", description: "从会议纪要中提取、归纳并结构化产品需求" },
  breakdown: { id: "breakdown", name: "任务拆解师", role: "需求 → 研发任务", description: "将需求拆解为可分配给人或 Agent 的研发任务" },
  coder: { id: "coder", name: "编码助手", role: "任务 → 代码制品", description: "根据任务生成代码与单元测试" },
  tester: { id: "tester", name: "测试专家", role: "制品 → 测试报告", description: "生成并执行测试，输出测试结果" },
  deployer: { id: "deployer", name: "部署专家", role: "制品 → 部署", description: "配置流水线并执行部署" },
};

/** Structured requirement extracted by the 需求架构师 agent. */
export interface ExtractedRequirement {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  acceptanceCriteria: string[];
}

/** Dev-task draft produced by the 任务拆解师 agent. */
export interface DevTaskDraft {
  title: string;
  description: string;
  estimate?: string;
  acceptanceCriteria?: string[];
  suggestedAssignee: "human" | "agent";
}

/** Test case produced by the 测试专家 agent. */
export interface GeneratedTestCase {
  title: string;
  type: "unit" | "integration" | "e2e";
  steps: string[];
  expectedResult: string;
}

/** Deployment plan produced by the 部署专家 agent. */
export interface DeploymentPlanDraft {
  stages: { name: string; command?: string }[];
  environments: string[];
  notes: string;
}

/** Run the 需求架构师 agent (via backend): meeting notes → requirements. */
export async function extractRequirementsFromMeeting(
  title: string,
  notes: string,
): Promise<ExtractedRequirement[]> {
  const r = await api.agentExtract(title, notes);
  return Array.isArray(r.requirements) ? (r.requirements as ExtractedRequirement[]) : [];
}

/** Run the 任务拆解师 agent (via backend): requirement → dev tasks. */
export async function breakdownRequirement(
  title: string,
  description: string,
  acceptanceCriteria: string[],
): Promise<DevTaskDraft[]> {
  const r = await api.agentBreakdown(title, description, acceptanceCriteria);
  return Array.isArray(r.tasks) ? (r.tasks as DevTaskDraft[]) : [];
}

/** Run the 测试专家 agent (via backend): requirement → test cases. */
export async function generateTestCases(
  title: string,
  description: string,
  acceptanceCriteria: string[],
): Promise<GeneratedTestCase[]> {
  const r = await api.agentTest(title, description, acceptanceCriteria);
  return Array.isArray(r.cases) ? (r.cases as GeneratedTestCase[]) : [];
}

/** Run the 部署专家 agent (via backend): requirement → deployment plan. */
export async function generateDeploymentPlan(
  title: string,
  description: string,
): Promise<DeploymentPlanDraft | null> {
  const r = await api.agentDeploy(title, description);
  return (r.plan as DeploymentPlanDraft) ?? null;
}
