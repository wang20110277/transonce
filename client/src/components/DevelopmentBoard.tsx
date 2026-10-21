import { useMemo, useState } from "react";
import {
  ListChecks, Play, Loader2, Bot, ChevronDown, ChevronRight, Clock,
  CheckCircle2, XCircle, Terminal, RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, StatusPill, Pill, Select, timeAgo, statusLabel } from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { DevTask } from "../types";

const COLUMNS: { id: string; label: string }[] = [
  { id: "queued", label: "待开始" },
  { id: "assigned", label: "已分配" },
  { id: "running", label: "执行中" },
  { id: "reviewing", label: "待评审" },
  { id: "done", label: "已完成" },
  { id: "failed", label: "失败" },
];

export function DevelopmentBoard() {
  const tenant = useSession((s) => s.currentTenant)!;
  const tasks = useWorkspace((s) => s.tasks);
  const requirements = useWorkspace((s) => s.requirements);
  const agentRuns = useWorkspace((s) => s.agentRuns);
  const detail = useWorkspace((s) => s.detail);
  const [filterReq, setFilterReq] = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "runs">("board");
  const tid = tenant.tenant.id;

  const filtered = useMemo(() => tasks.filter((t) => {
    if (filterReq !== "all" && t.requirementId !== filterReq) return false;
    if (filterAssignee === "agent" && t.assigneeKind !== "agent") return false;
    if (filterAssignee === "human" && t.assigneeKind !== "human") return false;
    return true;
  }), [tasks, filterReq, filterAssignee]);

  const run = async (task: DevTask) => {
    setBusyId(task.id);
    setError(null);
    try {
      await api.tasks.run(tid, task.id);
      await refreshWorkspace();
      setTab("runs");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (task: DevTask, status: string) => {
    setBusyId(task.id);
    try {
      await api.tasks.updateStatus(tid, task.id, status);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="研发管理"
        description="需求拆解出的任务可以由 Agent 执行，也可以人工认领；每次 Agent 执行都会留下运行记录与产出。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => askAgent("根据当前任务看板，找出阻塞项并给出今日推进计划")}><Bot className="w-4 h-4 mr-2" /> 问 Agent</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button onClick={() => setTab("board")} className={`px-3 py-1.5 text-sm rounded-md ${tab === "board" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>任务看板</button>
          <button onClick={() => setTab("runs")} className={`px-3 py-1.5 text-sm rounded-md ${tab === "runs" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Agent 运行记录</button>
        </div>
        <div className="flex-1" />
        <Select value={filterReq} onChange={setFilterReq}>
          <option value="all">全部需求</option>
          {requirements.map((r) => <option key={r.id} value={r.id}>{r.title.slice(0, 28)}</option>)}
        </Select>
        <Select value={filterAssignee} onChange={setFilterAssignee}>
          <option value="all">全部执行者</option>
          <option value="agent">仅 Agent</option>
          <option value="human">仅人工</option>
        </Select>
      </div>

      {tab === "board" ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-start">
            {COLUMNS.map((col) => {
              const items = filtered.filter((t) => t.status === col.id);
              return (
                <div key={col.id} className="rounded-xl bg-muted/30 border">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold">{col.label}</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{items.length}</Badge>
                  </div>
                  <div className="p-2 space-y-2 min-h-[120px]">
                    {items.map((t) => {
                      const req = requirements.find((r) => r.id === t.requirementId);
                      const agent = detail?.agents.find((a) => a.id === t.assigneeId);
                      return (
                        <Card key={t.id} className="p-3 shadow-none">
                          <p className="text-sm font-medium leading-snug">{t.title}</p>
                          {t.description && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                          <p className="text-[10px] text-muted-foreground mt-2 truncate">{req?.title ?? "无关联需求"}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <Pill tone={t.assigneeKind === "agent" ? "violet" : "blue"}>
                              {t.assigneeKind === "agent" ? <><Bot className="w-3 h-3" />{agent?.name ?? "Agent"}</> : "人工"}
                            </Pill>
                            {t.estimate && <Pill tone="gray"><Clock className="w-3 h-3" />{t.estimate}</Pill>}
                          </div>
                          <div className="flex items-center gap-1 mt-3 pt-2 border-t">
                            {t.assigneeKind === "agent" && t.status !== "done" && (
                              <Button size="sm" className="h-7 text-xs flex-1" disabled={busyId === t.id} onClick={() => run(t)}>
                                {busyId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Play className="w-3 h-3 mr-1" /> 执行</>}
                              </Button>
                            )}
                            <select value={t.status} onChange={(e) => changeStatus(t, e.target.value)} disabled={busyId === t.id} className="h-7 rounded-md border bg-background px-1 text-[11px]">
                              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </div>
                        </Card>
                      );
                    })}
                    {!items.length && <p className="text-[11px] text-muted-foreground text-center py-4">空</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {!tasks.length && <EmptyState icon={ListChecks} title="还没有研发任务" description="在需求详情里点击「拆解任务」，Agent 会把需求拆成可验收的研发任务。" />}
        </>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Terminal className="w-4 h-4" /> 最近 Agent 运行</h3>
            <span className="text-xs text-muted-foreground">{agentRuns.length} 条</span>
          </div>
          <div className="divide-y">
            {agentRuns.map((run) => (
              <div key={run.id}>
                <button className="w-full text-left p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30 transition-colors" onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                  {expandedRun === run.id ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${run.status === "succeeded" ? "bg-emerald-500/10 text-emerald-600" : run.status === "failed" ? "bg-rose-500/10 text-rose-600" : "bg-blue-500/10 text-blue-600"}`}>
                    {run.status === "succeeded" ? <CheckCircle2 className="w-3.5 h-3.5" /> : run.status === "failed" ? <XCircle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-medium">{statusLabel[run.taskType] ?? run.taskType} · {run.agentName ?? "Agent"}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{run.input}</p>
                  </div>
                  <StatusPill status={run.status} />
                  <span className="text-[11px] text-muted-foreground">{timeAgo(run.startedAt)}</span>
                </button>
                {expandedRun === run.id && (
                  <div className="px-12 pb-4 space-y-3">
                    {run.output && (
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[11px] font-semibold text-muted-foreground mb-1">产出</p>
                        <pre className="text-xs whitespace-pre-wrap font-sans">{run.output}</pre>
                      </div>
                    )}
                    {run.error && <p className="text-xs text-destructive">{run.error}</p>}
                    <div className="space-y-1">
                      {(run.events ?? []).map((e, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                          <span>{new Date(e.at).toLocaleTimeString("zh-CN")}</span>
                          <span>{e.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!agentRuns.length && <p className="text-sm text-muted-foreground text-center py-10">暂无 Agent 运行记录</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
