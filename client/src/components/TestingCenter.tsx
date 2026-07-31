import { useState } from "react";
import {
  TestTube2,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  FileText,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { generateTestCases, type GeneratedTestCase } from "../agents";
import { useAppStore, addTestRun } from "../lib/store";
import type { TestType } from "../types";

interface DraftCase extends GeneratedTestCase {
  _id: string;
}

const TYPE_LABEL: Record<TestType, string> = {
  unit: "单元",
  integration: "集成",
  e2e: "端到端",
};

/**
 * Deterministic pass/fail simulation for MVP (no real test runner yet).
 * Every 5th case fails — predictable, exercises both the pass and fail paths.
 */
function simulatePass(index: number) {
  return index % 5 !== 4;
}

export function TestingCenter() {
  const requirements = useAppStore((s) => s.requirements);
  const testRuns = useAppStore((s) => s.testRuns);

  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftCase[]>([]);

  const activeReq = requirements.find((r) => r.id === activeReqId);

  async function handleGenerate(reqId: string) {
    const req = requirements.find((r) => r.id === reqId);
    if (!req) return;
    setActiveReqId(reqId);
    setDrafts([]);
    setError(null);
    setLoading(true);
    try {
      const result = await generateTestCases(
        req.title,
        req.description ?? "",
        req.acceptanceCriteria ?? [],
      );
      setDrafts(result.map((c, i) => ({ ...c, _id: `${reqId}_${i}` })));
      if (result.length === 0) setError("Agent 未能生成测试用例，请补充需求后重试。");
    } catch (e) {
      console.error(e);
      setError("生成失败，请检查网络与 GEMINI_API_KEY 配置后重试。");
    } finally {
      setLoading(false);
    }
  }

  function patchDraft(id: string, patch: Partial<DraftCase>) {
    setDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  async function handleRun() {
    if (!activeReqId || drafts.length === 0) return;
    const cases = drafts.map((d, i) => ({
      id: d._id,
      title: d.title,
      type: d.type,
      passed: simulatePass(i),
    }));
    const passed = cases.filter((c) => c.passed).length;
    await addTestRun({
      requirementId: activeReqId,
      status: passed === cases.length ? "passed" : "failed",
      cases,
      passed,
      total: cases.length,
    });
  }

  const lastRunFor = (reqId: string) => testRuns.find((r) => r.requirementId === reqId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TestTube2 className="w-6 h-6 text-primary" />
            测试管理
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            由 <span className="font-medium">测试专家</span> Agent 为需求生成多层级测试用例，评审后模拟执行。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Requirements */}
        <Card className="lg:col-span-2 p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            需求列表
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
                  const run = lastRunFor(r.id);
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
                            {run.passed}/{run.total} 通过
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">未测试</span>
                        )}
                        <Button
                          size="sm"
                          variant={run ? "outline" : "default"}
                          className="h-7 text-xs"
                          disabled={loading && activeReqId === r.id}
                          onClick={() => handleGenerate(r.id)}
                        >
                          {loading && activeReqId === r.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              生成中…
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3 mr-1" />
                              生成用例
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

        {/* Review + run */}
        <Card className="lg:col-span-3 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {activeReq ? `测试用例：${activeReq.title}` : "测试用例评审"}
              {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}
            </h3>
            {drafts.length > 0 && (
              <Button size="sm" onClick={handleRun}>
                <Play className="w-4 h-4 mr-2" />
                运行测试
              </Button>
            )}
          </div>
          <Separator className="mb-3" />
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}

          <ScrollArea className="flex-1 max-h-[460px] pr-3">
            {!activeReq ? (
              <div className="h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <TestTube2 className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">选择左侧需求，由 Agent 自动生成测试用例。</p>
              </div>
            ) : drafts.length === 0 ? (
              <div className="h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-60" />
                <p className="text-sm">{loading ? "测试专家正在设计用例…" : "等待生成"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {drafts.map((d) => (
                  <div key={d._id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {TYPE_LABEL[d.type]}
                      </Badge>
                      <input
                        value={d.title}
                        onChange={(e) => patchDraft(d._id, { title: e.target.value })}
                        className="flex-1 h-7 rounded-md border border-input bg-transparent px-2 text-sm font-medium"
                      />
                    </div>
                    <textarea
                      value={d.expectedResult}
                      onChange={(e) => patchDraft(d._id, { expectedResult: e.target.value })}
                      className="w-full min-h-[40px] resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>

      {/* Run history */}
      {testRuns.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            测试记录（{testRuns.length}）
          </h3>
          <div className="space-y-2">
            {testRuns.map((run) => {
              const req = requirements.find((r) => r.id === run.requirementId);
              const passRate = run.total ? Math.round((run.passed / run.total) * 100) : 0;
              return (
                <Card key={run.id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {req?.title ?? "需求"} · {run.total} 条用例
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {run.cases.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1 text-[11px]"
                            title={c.title}
                          >
                            {c.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-destructive" />
                            )}
                            <span className="text-muted-foreground">{TYPE_LABEL[c.type]}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-bold">{passRate}%</p>
                        <p className="text-[11px] text-muted-foreground">{run.passed}/{run.total} 通过</p>
                      </div>
                      <Badge variant={run.status === "passed" ? "default" : "destructive"}>
                        {run.status === "passed" ? "通过" : "失败"}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => handleGenerate(run.requirementId)}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        重测
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
