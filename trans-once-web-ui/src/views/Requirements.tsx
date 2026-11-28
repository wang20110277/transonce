import { useMemo, useState } from "react";
import {
  FileText, Plus, Sparkles, Layers, Code2, TestTube2, Bot,
  CheckCircle2, Circle, Trash2, Pencil, Loader2, ListChecks, GitBranch,
  AlertTriangle, Database, PanelTop, Workflow, RefreshCw, Search, Square,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  PageHeader, EmptyState, StatusPill, Pill, Textarea, Select, statusLabel, formatDate,
} from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Architecture, Prototype, Requirement } from "../types";

type Tab = "overview" | "prototype" | "architecture";

// Agent 产出不可控：渲染前统一收敛为文本 / 数组，避免对象被当作 React 子节点导致整页崩溃。
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

export function Requirements() {
  const tenant = useSession((s) => s.currentTenant)!;
  const requirements = useWorkspace((s) => s.requirements);
  const tasks = useWorkspace((s) => s.tasks);
  const testRuns = useWorkspace((s) => s.testRuns);
  const artifacts = useWorkspace((s) => s.artifacts);
  const projects = useWorkspace((s) => s.projects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; steps?: { stage: string; ok: boolean; detail: string }[] } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const tid = tenant.tenant.id;

  const filtered = useMemo(() => requirements.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (q && !`${r.title} ${r.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [requirements, q, filter]);

  const selected = requirements.find((r) => r.id === selectedId) ?? filtered[0] ?? null;
  const reqTasks = selected ? tasks.filter((t) => t.requirementId === selected.id) : [];
  const reqTests = selected ? testRuns.filter((t) => t.requirementId === selected.id) : [];
  const reqArtifacts = selected ? artifacts.filter((a) => a.requirementId === selected.id) : [];

  const act = async (kind: string, fn: () => Promise<string>, steps?: { stage: string; ok: boolean; detail: string }[]) => {
    setBusy(kind);
    setNotice(null);
    try {
      const text = await fn();
      setNotice({ ok: true, text, steps });
      await refreshWorkspace();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!selected) {
    return (
      <div className="space-y-6">
        <PageHeader title="需求管理" description="从会议纪要提取需求，交给 Agent 生成原型、架构、任务、代码与测试。" actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建需求</Button>
        } />
        <EmptyState icon={FileText} title="还没有需求" description="从会议纪要提取，或者手动创建一条需求开始。" />
        {createOpen && <RequirementModal projects={projects.map((p) => ({ id: p.id, name: p.name }))} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); refreshWorkspace(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="需求管理"
        description="每条需求都可追溯来源会议、验收标准与 Agent 运行记录；完成后可继续进入开发、测试与交付。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()} disabled={!!busy}><RefreshCw className={`w-4 h-4 mr-2 ${busy ? "animate-spin" : ""}`} /> 刷新</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建需求</Button>
          </>
        }
      />

      {notice && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${notice.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300" : "bg-destructive/10 border-destructive/20 text-destructive"}`}>
          <div className="flex gap-2"><span className="flex-1">{notice.text}</span></div>
          {notice.steps && (
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {notice.steps.map((s) => (
                <div key={s.stage} className={`text-[11px] rounded px-2 py-1 border ${s.ok ? "border-emerald-300/60" : "border-rose-300/60"}`}>
                  {s.ok ? "✓" : "✕"} {statusLabel[s.stage] ?? s.stage} · {s.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4 items-start">
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索需求…" className="pl-9" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {[["all", "全部"], ["draft", "草稿"], ["designing", "进行中"], ["completed", "已完成"]].map(([v, l]) => (
              <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFilter(v)}>{l}</Button>
            ))}
          </div>
          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-auto pr-1">
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelectedId(r.id); setTab("overview"); setNotice(null); }}
                className={`w-full text-left rounded-lg border p-3 transition-all ${selected.id === r.id ? "border-primary bg-primary/5 shadow-sm" : "bg-card hover:border-primary/30"}`}
              >
                <p className="text-sm font-medium line-clamp-2">{r.title}</p>
                <div className="flex items-center gap-2 mt-2">
                  <StatusPill status={r.status} />
                  {r.priority && <Pill tone={r.priority === "high" ? "rose" : r.priority === "low" ? "gray" : "amber"}>{statusLabel[r.priority]}</Pill>}
                  {r.designStatus === "designed" && <Pill tone="violet">已设计</Pill>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{formatDate(r.createdAt)}</p>
              </button>
            ))}
            {!filtered.length && <p className="text-sm text-muted-foreground text-center py-6">没有匹配的需求</p>}
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <StatusPill status={selected.status} />
                  {selected.priority && <Pill tone={selected.priority === "high" ? "rose" : selected.priority === "low" ? "gray" : "amber"}>{statusLabel[selected.priority]}优先级</Pill>}
                  <span className="text-[11px] text-muted-foreground">创建于 {formatDate(selected.createdAt)}</span>
                </div>
                <h3 className="text-xl font-bold leading-snug">{selected.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{selected.description || "暂无描述"}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => {
                  if (!confirm("确认删除这条需求？关联任务与测试不会被自动删除。")) return;
                  await api.requirements.remove(tid, selected.id);
                  setSelectedId(null);
                  await refreshWorkspace();
                }}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
              {busy && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { api.requirements.cancel(tid, selected.id).catch(() => {}); }}
                >
                  <Square className="w-4 h-4 mr-2" /> 停止
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("design", async () => {
                const r = await api.requirements.design(tid, selected.id);
                return `已生成原型与架构${r.architecture?.components?.length ? `：${r.architecture.components.length} 个组件` : ""}`;
              })}>
                {busy === "design" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Layers className="w-4 h-4 mr-2" />} 原型与架构
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("breakdown", async () => {
                const t = await api.requirements.breakdown(tid, selected.id);
                return `已拆解为 ${t.length} 个研发任务并分派`;
              })}>
                {busy === "breakdown" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ListChecks className="w-4 h-4 mr-2" />} 拆解任务
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("code", async () => {
                const a = await api.requirements.code(tid, selected.id);
                return `已生成代码制品 ${a.name} ${a.version}`;
              })}>
                {busy === "code" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Code2 className="w-4 h-4 mr-2" />} 生成代码
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("test", async () => {
                const t = await api.requirements.test(tid, selected.id);
                return `测试完成：${t.passed}/${t.total} 通过`;
              })}>
                {busy === "test" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TestTube2 className="w-4 h-4 mr-2" />} 生成并执行测试
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => act("autopilot", async () => {
                const res = await api.requirements.autopilot(tid, selected.id, { deploy: true });
                return `一键研发完成：${res.steps.filter((s) => s.ok).length}/${res.steps.length} 步成功${res.deployment ? `，已部署到 ${res.deployment.environment}` : ""}`;
              })}>
                {busy === "autopilot" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />} 一键研发闭环
              </Button>
              <Button size="sm" variant="ghost" onClick={() => askAgent("结合当前需求，给出下一步实施建议和风险提示", { requirementId: selected.id, title: selected.title })}>
                <Bot className="w-4 h-4 mr-2" /> 问 Agent
              </Button>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="flex border-b px-2 pt-2 gap-1 bg-muted/20">
              {([["overview", "概览", FileText], ["prototype", "原型", PanelTop], ["architecture", "架构", Workflow]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md ${tab === id ? "bg-card border border-b-card font-medium -mb-px" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {tab === "overview" && (
                <div className="space-y-5">
                  <section>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> 验收标准</h4>
                    {selected.acceptanceCriteria.length ? (
                      <ul className="space-y-2">
                        {selected.acceptanceCriteria.map((c, i) => (
                          <li key={i} className="flex gap-2 text-sm"><Circle className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />{c}</li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted-foreground">尚未填写验收标准</p>}
                  </section>

                  <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ListChecks className="w-4 h-4" /> 关联任务 ({reqTasks.length})</h4>
                      <div className="space-y-1.5">
                        {reqTasks.slice(0, 6).map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs rounded border px-2 py-1.5">
                            <span className="flex-1 truncate">{t.title}</span>
                            <StatusPill status={t.status} />
                          </div>
                        ))}
                        {!reqTasks.length && <p className="text-xs text-muted-foreground">尚未拆解任务</p>}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><TestTube2 className="w-4 h-4" /> 测试与制品</h4>
                      <div className="space-y-1.5">
                        {reqTests.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs rounded border px-2 py-1.5">
                            <span className="flex-1">{t.passed}/{t.total} 通过</span>
                            <StatusPill status={t.status} />
                          </div>
                        ))}
                        {reqArtifacts.map((a) => (
                          <div key={a.id} className="flex items-center gap-2 text-xs rounded border px-2 py-1.5">
                            <GitBranch className="w-3 h-3" /><span className="flex-1 truncate">{a.name} {a.version}</span>
                            <StatusPill status={a.status} />
                          </div>
                        ))}
                        {!reqTests.length && !reqArtifacts.length && <p className="text-xs text-muted-foreground">尚未产生测试或制品</p>}
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {tab === "prototype" && <PrototypePanel raw={selected.prototype} />}
              {tab === "architecture" && <ArchitecturePanel arch={selected.architecture} />}
            </div>
          </Card>
        </div>
      </div>

      {(editOpen || createOpen) && (
        <RequirementModal
          req={editOpen ? selected : undefined}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => { setEditOpen(false); setCreateOpen(false); }}
          onSaved={async () => { setEditOpen(false); setCreateOpen(false); setNotice({ ok: true, text: "需求已保存" }); await refreshWorkspace(); }}
        />
      )}
    </div>
  );
}

function PrototypePanel({ raw }: { raw?: string | null }) {
  // useMemo 在当前 react 类型推断下会丢失泛型，直接解析保证 data 类型确定。
  let data: Prototype | null = null;
  if (raw) {
    try { data = JSON.parse(raw) as Prototype; } catch { data = null; }
  }

  if (!data) {
    return (
      <EmptyState icon={PanelTop} title="尚未生成原型" description="点击「原型与架构」，让 Agent 基于需求与验收标准产出页面骨架和交互流程。" />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 text-sm">{asText(data.summary)}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {asArray(data.pages).map((p, i) => (
          <Card key={i} className="p-4 bg-muted/20">
            <h5 className="text-sm font-semibold flex items-center gap-2"><PanelTop className="w-4 h-4 text-primary" /> {asText(p?.name)}</h5>
            <p className="text-xs text-muted-foreground mt-1">{asText(p?.purpose)}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {asArray(p?.components).map((c, j) => <Badge key={j} variant="secondary" className="text-[10px] font-normal">{asText(c)}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
      {!!data.flows?.length && (
        <section>
          <h4 className="text-sm font-semibold mb-2">关键流程</h4>
          <ol className="space-y-1.5">
            {asArray(data.flows).map((f, i) => {
              const spec = typeof f === "object" && f !== null ? f as { name?: string; trigger?: string; steps?: unknown[]; guarantee?: string } : null;
              if (!spec) {
                return <li key={i} className="text-sm flex gap-2"><span className="text-muted-foreground">{i + 1}.</span>{asText(f)}</li>;
              }
              const steps = asArray(spec.steps);
              return (
                <li key={i} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{asText(spec.name) || `流程 ${i + 1}`}</p>
                  {spec.trigger != null && <p className="text-xs text-muted-foreground mt-1">触发：{asText(spec.trigger)}</p>}
                  {!!steps.length && (
                    <ol className="mt-1.5 space-y-1">
                      {steps.map((s, j) => <li key={j} className="text-xs flex gap-1.5"><span className="text-muted-foreground">{j + 1}.</span>{asText(s)}</li>)}
                    </ol>
                  )}
                  {spec.guarantee != null && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5">保障：{asText(spec.guarantee)}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {!!data.acceptance?.length && (
        <section>
          <h4 className="text-sm font-semibold mb-2">交互验收点</h4>
          <ul className="space-y-1.5">
            {asArray(data.acceptance).map((a, i) => <li key={i} className="text-sm flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />{asText(a)}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function ArchitecturePanel({ arch }: { arch?: Architecture | null }) {
  if (!arch || (!arch.components?.length && !arch.style)) {
    return <EmptyState icon={Workflow} title="尚未生成架构" description="点击「原型与架构」，Agent 会给出架构风格、组件职责、数据模型、API 与部署建议。" />;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border p-3 flex-1 min-w-[180px]">
          <p className="text-[11px] text-muted-foreground">架构风格</p>
          <p className="text-sm font-semibold mt-0.5">{arch.style ? asText(arch.style) : "—"}</p>
        </div>
        <div className="rounded-lg border p-3 flex-1 min-w-[180px]">
          <p className="text-[11px] text-muted-foreground">部署建议</p>
          <p className="text-sm font-semibold mt-0.5">{arch.deployment ? asText(arch.deployment) : "—"}</p>
        </div>
      </div>

      <section>
        <h4 className="text-sm font-semibold mb-2">组件与职责</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {asArray(arch.components).map((c, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{asText(c?.name)}</p>
                <Badge variant="secondary" className="text-[10px]">{asText(c?.tech)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{asText(c?.responsibility)}</p>
            </div>
          ))}
        </div>
      </section>

      {!!arch.dataModel?.length && (
        <section>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Database className="w-4 h-4" /> 数据模型</h4>
          <div className="space-y-2">
            {asArray(arch.dataModel).map((t, i) => (
              <div key={i} className="rounded-lg border p-3">
                <p className="text-sm font-medium font-mono">{asText(t?.table)}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {asArray(t?.fields).map((f, j) => <span key={j} className="text-[11px] font-mono bg-muted rounded px-1.5 py-0.5">{asText(f)}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!arch.apis?.length && (
        <section>
          <h4 className="text-sm font-semibold mb-2">API 设计</h4>
          <div className="rounded-lg border overflow-hidden">
            {asArray(arch.apis).map((a, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 text-xs ${i ? "border-t" : ""}`}>
                <Badge variant="outline" className="font-mono text-[10px] w-14 justify-center">{asText(a?.method)}</Badge>
                <span className="font-mono flex-1 truncate">{asText(a?.path)}</span>
                <span className="text-muted-foreground hidden md:block">{asText(a?.purpose)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!arch.risks?.length && (
        <section>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 text-amber-600"><AlertTriangle className="w-4 h-4" /> 风险与待确认</h4>
          <ul className="space-y-1.5">
            {asArray(arch.risks).map((r, i) => {
              const spec = typeof r === "object" && r !== null ? r as { risk?: string; mitigation?: string; description?: string } : null;
              if (!spec) {
                return <li key={i} className="text-sm flex gap-2"><span>•</span>{asText(r)}</li>;
              }
              const text = asText(spec.risk) || asText(spec.description);
              const mitigation = asText(spec.mitigation);
              return (
                <li key={i} className="text-sm flex gap-2">
                  <span>•</span>
                  <span>{text}{mitigation && <span className="block text-xs text-muted-foreground mt-0.5">缓解：{mitigation}</span>}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {arch.diagram && (
        <section>
          <h4 className="text-sm font-semibold mb-2">架构图</h4>
          <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-auto whitespace-pre-wrap">{asText(arch.diagram)}</pre>
        </section>
      )}
    </div>
  );
}

function RequirementModal({
  req, projects, onClose, onSaved,
}: {
  req?: Requirement;
  projects: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    title: req?.title ?? "",
    description: req?.description ?? "",
    priority: req?.priority ?? "medium",
    projectId: req?.projectId ?? (projects[0]?.id ?? ""),
    criteria: (req?.acceptanceCriteria ?? []).join("\n"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        projectId: form.projectId || null,
        acceptanceCriteria: form.criteria.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      if (req) await api.requirements.update(tenant.tenant.id, req.id, body);
      else await api.requirements.create(tenant.tenant.id, body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={req ? "编辑需求" : "新建需求"} onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">标题</label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1.5" placeholder="一句话说明要解决的问题" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">优先级</label>
            <Select value={form.priority ?? "medium"} onChange={(v) => setForm({ ...form, priority: v })} className="mt-1.5 w-full">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">关联项目</label>
            <Select value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} className="mt-1.5 w-full">
              <option value="">不关联</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">描述</label>
          <Textarea value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={4} placeholder="背景、目标用户与期望结果" />
        </div>
        <div>
          <label className="text-sm font-medium">验收标准（每行一条）</label>
          <Textarea value={form.criteria} onChange={(v) => setForm({ ...form, criteria: v })} rows={4} placeholder={"用户可以在 3 步内完成创建\n失败场景有明确提示"} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.title.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}
