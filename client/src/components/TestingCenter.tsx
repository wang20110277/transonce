import { useMemo, useState } from "react";
import {
  TestTube2, Play, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Bot, RefreshCw, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, StatCard, StatusPill, Pill, Select, formatDate } from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";

export function TestingCenter() {
  const tenant = useSession((s) => s.currentTenant)!;
  const testRuns = useWorkspace((s) => s.testRuns);
  const requirements = useWorkspace((s) => s.requirements);
  const [reqId, setReqId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(testRuns[0]?.id ?? null);
  const tid = tenant.tenant.id;

  const stats = useMemo(() => {
    const total = testRuns.reduce((n, t) => n + t.total, 0);
    const passed = testRuns.reduce((n, t) => n + t.passed, 0);
    const failedRuns = testRuns.filter((t) => t.status === "failed").length;
    return { total, passed, rate: total ? Math.round((passed / total) * 100) : 0, failedRuns };
  }, [testRuns]);

  const runTests = async () => {
    if (!reqId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.requirements.test(tid, reqId);
      setExpanded(r.id);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="测试管理"
        description="Agent 根据验收标准生成功能、边界与异常测试用例，并执行验证；失败项会进入告警与修复闭环。"
        actions={<Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>}
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={TestTube2} label="测试运行" value={testRuns.length} tone="blue" />
        <StatCard icon={ShieldCheck} label="用例通过率" value={`${stats.rate}%`} tone={stats.rate === 100 ? "emerald" : "amber"} />
        <StatCard icon={CheckCircle2} label="通过用例" value={`${stats.passed}/${stats.total}`} tone="emerald" />
        <StatCard icon={AlertTriangle} label="失败运行" value={stats.failedRuns} tone={stats.failedRuns ? "rose" : "default"} />
      </div>

      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs font-medium text-muted-foreground">选择需求生成并执行测试</label>
          <Select value={reqId} onChange={setReqId} className="mt-1 w-full">
            <option value="">选择一条需求…</option>
            {requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select>
        </div>
        <Button onClick={runTests} disabled={busy || !reqId}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />} 生成并执行
        </Button>
      </Card>

      {testRuns.length === 0 ? (
        <EmptyState icon={TestTube2} title="还没有测试运行" description="选择一条需求，让 Agent 生成测试用例并执行。" />
      ) : (
        <div className="space-y-3">
          {testRuns.map((t) => {
            const req = requirements.find((r) => r.id === t.requirementId);
            const open = expanded === t.id;
            return (
              <Card key={t.id} className="overflow-hidden">
                <button className="w-full text-left p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30" onClick={() => setExpanded(open ? null : t.id)}>
                  {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.status === "passed" ? "bg-emerald-500/10 text-emerald-600" : t.status === "failed" ? "bg-rose-500/10 text-rose-600" : "bg-blue-500/10 text-blue-600"}`}>
                    {t.status === "passed" ? <CheckCircle2 className="w-4 h-4" /> : t.status === "failed" ? <XCircle className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-medium">{req?.title ?? "关联需求已删除"}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(t.createdAt)} · {t.total} 个用例</p>
                  </div>
                  <Pill tone={t.passed === t.total ? "green" : "rose"}>{t.passed}/{t.total} 通过</Pill>
                  {t.simulated && <Pill tone="amber">模拟</Pill>}
                  <StatusPill status={t.status} />
                </button>
                {open && (
                  <div className="border-t bg-muted/20 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {t.cases.map((c) => (
                        <div key={c.id} className="rounded-lg border bg-card p-3 flex items-start gap-2">
                          {c.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <p className="text-sm">{c.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Pill tone={c.type === "functional" ? "blue" : c.type === "edge" ? "amber" : "violet"}>{c.type}</Pill>
                              <span className="text-[10px] text-muted-foreground">{c.id}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end mt-3">
                      <Button variant="outline" size="sm" onClick={() => askAgent("分析这次测试结果，指出风险并给出修复建议", { requirementId: t.requirementId, testRunId: t.id })}>
                        <Bot className="w-4 h-4 mr-2" /> 让 Agent 分析
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
