// Agent 运行时目录：运行时可用性与模型候选都来自后端对本机 CLI 的实际探测
// （/api/agent-runtime），不再用静态猜测——列表反映真实安装与真实可用模型。
import { useEffect, useState } from "react";
import { getToken } from "../services/api";

export interface RuntimeModel {
  id: string;
  provider: string;
}

export interface RuntimeInfo {
  installed: boolean;
  supported: boolean;
  models: RuntimeModel[];
  error?: string | null;
  note?: string | null;
}

export type AgentRuntimeCatalog = { providers: Record<string, RuntimeInfo> };

export const RUNTIME_OPTIONS = [
  { id: "auto", label: "自动（跟随平台）" },
  { id: "transcode", label: "Transcode（ACP）" },
  { id: "claude", label: "Claude Code" },
  { id: "opencode", label: "opencode" },
];

let cached: AgentRuntimeCatalog | null = null;

export function useAgentRuntime(): AgentRuntimeCatalog | null {
  const [catalog, setCatalog] = useState<AgentRuntimeCatalog | null>(cached);
  useEffect(() => {
    if (cached) return;
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch("/api/agent-runtime", { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: AgentRuntimeCatalog) => {
        cached = data;
        setCatalog(data);
      })
      .catch(() => setCatalog(null));
  }, []);
  return catalog;
}

export function modelPlaceholder(provider: string): string {
  if (provider === "opencode") return "默认，从候选选择或输入 provider/model";
  if (provider === "claude") return "默认，别名或完整模型名";
  return "默认（跟随运行时）";
}

// 模型输入框下方的说明：发现失败 > 不支持 > 正常备注，与 Multica 的选择器
// 一致——该说的状态说清楚，手动输入始终可用。
export function runtimeHint(info: RuntimeInfo | undefined | null): string | null {
  if (!info) return null;
  if (info.error) return `模型列表获取失败（${info.error}），可手动输入。`;
  return info.note ?? null;
}
