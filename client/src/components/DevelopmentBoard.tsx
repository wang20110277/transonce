import { useState } from "react";
import {
  Code2,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  Bot,
  User,
  ChevronRight,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  breakdownRequirement,
  type DevTaskDraft,
} from "../agents";
import { useAppStore, addTasks, setTaskStatus } from "../lib/store";
import type { TaskStatus, DevTask } from "../types";

interface DraftTask extends DevTaskDraft {
  _id: string;
}

const STATUS_FLOW: TaskStatus[] = [
  "queued",
  "running",
  "reviewing",
  "done",
];

const STATUS_LABEL: Record<string, string> = {
  queued: "待处理",
  assigned: "已分配",
  running: "进行中",
  reviewing: "待评审",
  done: "已完成",
  failed: "失败",
};

function statusVariant(status: string) {
  switch (status) {
    case "done":
      return "default";
    case "running":
      return "secondary";
    case "reviewing":
      return "outline";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

export function DevelopmentBoard() {
  const requirements = useAppStore((s) => s.requirements);
  const tasks = useAppStore((s) => s.tasks);

  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftTask[]>([]);

  const activeReq = requirements.find((r) => r.id === activeReqId);

  async function handleBreakdown(reqId: string) {
    const req = requirements.find((r) => r.id === reqId);
    if (!req) return;
    setActiveReqId(reqId);
    setDrafts([]);
    setError(null);
    setLoading(true);
    try {
      const result = await breakdownRequirement(
        req.title,
        req.description ?? "",
        req.acceptanceCriteria ?? [],
      );
      setDrafts(result.map((d, i) => ({ ...d, _id: `${reqId}_${i}` })));
      if (result.length === 0) {
        setError("Agent 未能拆解出任务，请补充需求描述后重试。");
      }
    } catch (e) {
      console.error(e);
      setError("拆解失败，请检查网络与 GEMINI_API_KEY 配置后重试。");
    } finally {
      setLoading(false);
    }
  }

  function patchDraft(id: string, patch: Partial<DraftTask>) {
    setDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  async function handleAdopt() {
    if (!activeReqId || drafts.length === 0) return;
    await addTasks(
      drafts.map((d) => ({
        requirementId: activeReqId,
        title: d.title,
        description: d.description,
        estimate: d.estimate,
        acceptanceCriteria: d.acceptanceCriteria,
        assigneeKind: d.suggestedAssignee,
      })),
    );
    setDrafts([]);
    setActiveReqId(null);
  }

  const columns: { key: string; label: string; statuses: TaskStatus[] }[] = [
    { key: "queued", label: "待处理", statuses: ["queued", "assigned"] },
    { key: "running", label: "进行中", statuses: ["running"] },
    { key: "reviewing", label: "待评审", statuses: ["reviewing"] },
    { key: "done", label: "已完成", statuses: ["done"] },
  ];

  const tasksByColumn = (statuses: TaskStatus[]) =>
    tasks.filter((t) => statuses.includes(t.status));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Code2 className="w-6 h-6 text-primary" />
            研发管理
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            由 <span className="font-medium">任务拆解师</span> Agent 将需求拆解为研发任务，分配给人或 Agent 协作推进。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Requirements to break down */}
        <Card className="lg:col-span-2 p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            需求待拆解
            <Badge variant="secondary">{requirements.length}</Badge>
          </h3>
          <Separator className="mb-3" />
          <ScrollArea className="max-h-[480px] pr-3">
            {requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                暂无需求。请先在「会议纪要」中提取并采纳需求。
              </p>
            ) : (
              <div className="space-y-2">
                {requirements.map((r) => {
                  const taskCount = tasks.filter((t) => t.requirementId === r.id).length;
                  return (
                    <div
                      key={r.id}
                      className="rounded-lg border p-3 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{r.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {r.description}
                          </p>
                        </div>
                        {taskCount > 0 && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {taskCount} 任务
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={taskCount > 0 ? "outline" : "default"}
                        className="mt-2 h-7 text-xs"
                        disabled={loading && activeReqId === r.id}
                        onClick={() => handleBreakdown(r.id)}
                      >
                        {loading && activeReqId === r.id ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            拆解中…
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 mr-1" />
                            {taskCount > 0 ? "重新拆解" : "Agent 拆解"}
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Breakdown review */}
        <Card className="lg:col-span-3 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {activeReq ? `评审拆解结果：${activeReq.title}` : "拆解结果评审"}
              {drafts.length > 0 && <Badge variant="secondary">{drafts.length} 任务</Badge>}
            </h3>
            {drafts.length > 0 && (
              <Button size="sm" onClick={handleAdopt}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                全部采纳
              </Button>
            )}
          </div>
          <Separator className="mb-3" />
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}

          <ScrollArea className="flex-1 max-h-[480px] pr-3">
            {!activeReq ? (
              <div className="h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <Sparkles className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">选择左侧需求，由 Agent 自动拆解为研发任务。</p>
              </div>
            ) : drafts.length === 0 ? (
              <div className="h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-60" />
                <p className="text-sm">{loading ? "任务拆解师正在分析需求…" : "等待拆解"}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {drafts.map((d) => (
                  <div key={d._id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={d.title}
                        onChange={(e) => patchDraft(d._id, { title: e.target.value })}
                        className="flex-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm font-medium"
                      />
                      <select
                        value={d.suggestedAssignee}
                        onChange={(e) =>
                          patchDraft(d._id, {
                            suggestedAssignee: e.target.value as "human" | "agent",
                          })
                        }
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        <option value="agent">Agent</option>
                        <option value="human">人工</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDrafts((p) => p.filter((x) => x._id !== d._id))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <textarea
                      value={d.description}
                      onChange={(e) => patchDraft(d._id, { description: e.target.value })}
                      className="w-full min-h-[48px] resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
                    />
                    {(d.estimate || d.acceptanceCriteria?.length) && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {d.estimate && <Badge variant="outline">{d.estimate}</Badge>}
                        {d.acceptanceCriteria && d.acceptanceCriteria.length > 0 && (
                          <span>验收标准 {d.acceptanceCriteria.length} 条</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>

      {/* Task board */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          任务看板（{tasks.length}）
        </h3>
        {tasks.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            还没有任务。拆解需求后会显示在这里。
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {columns.map((col) => {
              const items = tasksByColumn(col.statuses);
              return (
                <div key={col.key} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {col.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                  </div>
                  {items.map((t) => renderTaskCard(t))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function renderTaskCard(task: DevTask) {
  const advance = () => {
    const idx = STATUS_FLOW.indexOf(task.status as TaskStatus);
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)];
    setTaskStatus(task.id, next);
  };
  return (
    <Card key={task.id} className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{task.title}</p>
        <Badge variant={statusVariant(task.status)} className="text-[10px] shrink-0">
          {STATUS_LABEL[task.status] ?? task.status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      <div className="flex items-center justify-between pt-1">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {task.assigneeKind === "agent" ? (
            <Bot className="w-3 h-3" />
          ) : (
            <User className="w-3 h-3" />
          )}
          {task.assigneeKind === "agent" ? "Agent" : "人工"}
          {task.estimate ? ` · ${task.estimate}` : ""}
        </span>
        {task.status !== "done" && (
          <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={advance}>
            推进
            <ChevronRight className="w-3 h-3" />
          </Button>
        )}
      </div>
    </Card>
  );
}
