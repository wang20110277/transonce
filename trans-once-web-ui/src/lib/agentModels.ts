// 各运行时的常用模型候选，供 Agent 配置输入框的下拉建议（datalist）。
// 留空 = 使用平台默认；mock 为内置模拟，不消耗模型。
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  opencode: ["anthropic/claude-sonnet-4-5", "anthropic/claude-opus-4-5"],
  auto: ["sonnet", "opus", "haiku", "anthropic/claude-sonnet-4-5", "anthropic/claude-opus-4-5"],
};

export function modelPlaceholder(provider: string): string {
  if (provider === "opencode") return "默认，如 anthropic/claude-sonnet-4-5";
  if (provider === "claude") return "默认，如 sonnet";
  return "默认（可输入或从候选选择）";
}
