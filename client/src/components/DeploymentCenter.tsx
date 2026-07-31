import { useState } from "react";
import {
  Rocket,
  Sparkles,
  Loader2,
  CheckCircle2,
  FileText,
  GitBranch,
  Server,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { generateDeploymentPlan, type DeploymentPlanDraft } from "../agents";
import { useAppStore, addDeployment } from "../lib/store";

export function DeploymentCenter() {
  const requirements = useAppStore((s) => s.requirements);
  const testRuns = useAppStore((s) => s.testRuns);
  const deployments = useAppStore((s) => s.deployments);

  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeploymentPlanDraft | null>(null);

  const activeReq = requirements.find((r) => r.id === activeReqId);
  const lastTest = activeReqId
    ? testRuns.find((r) => r.requirementId === activeReqId)
    : undefined;

  async function handlePlan(reqId: string) {
    const req = requirements.find((r) => r.id === reqId);
    if (!req) return;
    setActiveReqId(reqId);
    setPlan(null);
    setError(null);
    setLoading(true);
    try {
      const result = await generateDeploymentPlan(req.title, req.description ?? "");
      setPlan(result);
      if (!result) setError("Agent 未能生成部署方案，请稍后重试。");
    } catch (e) {
      console.error(e);
      setError("生成失败，请检查网络与 GEMINI_API_KEY 配置后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function deploy(environment: "test" | "production") {
    if (!activeReqId) return;
    await addDeployment({
      artifactId: activeReqId,
      environment,
      status: "success",
      url: `https://${environment === "test" ? "test" : "prod"}-${activeReqId}.transones.ai`,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Rocket className="w-6 h-6 text-primary" />
            部署管理
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            由 <span className="font-medium">部署专家</span> Agent 生成 CI/CD 流水线方案，人工确认后部署到目标环境。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Requirements */}
        <Card className="lg:col-span-2 p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            可部署需求
            <Badge variant="secondary">{requirements.length}</Badge>
          </h3>
          <Separator className="mb-3" />
          <ScrollArea className="max-h-[460px] pr-3">
            {requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                暂无需求。请先在「会议纪要」中提取并采纳需求。
              </p>
            ) : (
              <div className="space-y-2">
                {requirements.map((r) => {
                  const run = testRuns.find((t) => t.requirementId === r.id);
                  return (
                    <div
                      key={r.id}
                      className="rounded-lg border p-3 hover:border-primary/40 transition-colors"
                    >
                      <p className="font-medium text-sm truncate">{r.title}</p>
                      <div className="flex items-center justify-between mt-2">
                        {run ? (
                          <Badge
                            variant={run.status === "passed" ? "default" : "destructive"}
                            className="text-[10px]"
                          >
                            测试 {run.passed}/{run.total}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">未测试</span>
                        )}
                        <Button
                          size="sm"
                          variant={plan && activeReqId === r.id ? "outline" : "default"}
                          className="h-7 text-xs"
                          disabled={loading && activeReqId === r.id}
                          onClick={() => handlePlan(r.id)}
                        >
                          {loading && activeReqId === r.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              生成中…
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3 mr-1" />
                              生成方案
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Plan review */}
        <Card className="lg:col-span-3 p-5 flex flex-col">
          <h3 className="font-semibold flex items-center gap-2 mb-2">
            <GitBranch className="w-4 h-4 text-primary" />
            {activeReq ? `部署方案：${activeReq.title}` : "部署方案"}
          </h3>
          <Separator className="mb-3" />
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}

          {!activeReq ? (
            <div className="h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <Rocket className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">选择左侧需求，由 Agent 生成 CI/CD 流水线与部署方案。</p>
            </div>
          ) : !plan ? (
            <div className="h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-60" />
              <p className="text-sm">{loading ? "部署专家正在设计方案…" : "等待生成"}</p>
            </div>
          ) : (
            <ScrollArea className="flex-1 max-h-[420px] pr-3">
              <div className="space-y-4">
                {lastTest && lastTest.status !== "passed" && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                    ⚠ 该需求测试未全部通过（{lastTest.passed}/{lastTest.total}），建议先修复再部署到生产环境。
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    流水线阶段
                  </p>
                  <div className="space-y-2">
                    {plan.stages.map((stage, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border p-2.5">
                        <div className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{stage.name}</p>
                          {stage.command && (
                            <p className="text-[11px] font-mono text-muted-foreground truncate flex items-center gap-1">
                              <Terminal className="w-3 h-3" />
                              {stage.command}
                            </p>
                          )}
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    目标环境
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plan.environments.map((env, i) => (
                      <Badge key={i} variant="outline" className="gap-1">
                        <Server className="w-3 h-3" />
                        {env}
                      </Badge>
                    ))}
                  </div>
                </div>

                {plan.notes && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      注意事项
                    </p>
                    <p className="text-sm text-muted-foreground rounded-lg bg-muted/40 p-3">
                      {plan.notes}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" variant="secondary" onClick={() => deploy("test")}>
                    <Rocket className="w-4 h-4 mr-2" />
                    部署到测试环境
                  </Button>
                  <Button className="flex-1" onClick={() => deploy("production")}>
                    <Rocket className="w-4 h-4 mr-2" />
                    部署到生产环境
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}
        </Card>
      </div>

      {/* Deployment history */}
      {deployments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            部署记录（{deployments.length}）
          </h3>
          <div className="space-y-2">
            {deployments.map((d) => {
              const req = requirements.find((r) => r.id === d.artifactId);
              return (
                <Card key={d.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-primary/10 p-2 rounded-full shrink-0">
                      <Rocket className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {req?.title ?? "需求"} · {d.environment === "test" ? "测试环境" : "生产环境"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate font-mono">{d.url}</p>
                    </div>
                  </div>
                  <Badge className="bg-green-500 hover:bg-green-600 shrink-0">成功</Badge>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
