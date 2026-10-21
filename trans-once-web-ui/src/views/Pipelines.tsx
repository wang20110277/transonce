import { useState } from "react";
import {
  Workflow, Play, Plus, Trash2, Loader2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, RefreshCw, Terminal, Package,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, StatusPill, Pill, Select, Textarea, formatDate, statusLabel } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Artifact, Pipeline } from "../types";

export function Pipelines() {
  const tenant = useSession((s) => s.currentTenant)!;
  const pipelines = useWorkspace((s) => s.pipelines);
  const runs = useWorkspace((s) => s.pipelineRuns);
  const artifacts = useWorkspace((s) => s.artifacts);
  const [createOpen, setCreateOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<Pipeline | null>(null);
  const [expanded, setExpanded] = useState<string | null>(runs[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tid = tenant.tenant.id;

  const run = async (pid: string, artifactId?: string) => {
    setBusy(pid);
    setError(null);
    try {
      const r = await api.pipelines.run(tid, pid, artifactId);
      setExpanded(r.id);
      setRunTarget(null);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="CI/CD 流水线"
        description="流水线由 Agent 按需求生成，也可以手工维护；每次运行都会记录阶段耗时与日志。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建流水线</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {!pipelines.length ? (
        <EmptyState icon={Workflow} title="还没有流水线" description="在需求的「一键研发闭环」中 Agent 会自动生成流水线，或点击右上角手工创建。" action={
          <Button size="sm" className="mt-2" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建流水线</Button>
        } />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pipelines.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-2"><Workflow className="w-4 h-4 text-primary" /> {p.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{p.description || "暂无描述"} · {p.trigger === "manual" ? "手动触发" : p.trigger}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" className="h-7 text-xs" onClick={() => setRunTarget(p)} disabled={busy === p.id}>
                    {busy === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Play className="w-3 h-3 mr-1" /> 运行</>}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => {
                    if (!confirm(`删除流水线「${p.name}」？`)) return;
                    await api.pipelines.remove(tid, p.id);
                    await refreshWorkspace();
                  }}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {p.stages.map((s, i) => (
                  <Pill key={i} tone="gray"><span className="text-muted-foreground">{i + 1}.</span> {s.name}</Pill>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Terminal className="w-4 h-4" /> 运行历史</h3>
          <span className="text-xs text-muted-foreground">{runs.length} 次</span>
        </div>
        <div className="divide-y">
          {runs.map((r) => {
            const pipeline = pipelines.find((p) => p.id === r.pipelineId);
            const artifact = artifacts.find((a) => a.id === r.artifactId);
            const open = expanded === r.id;
            return (
              <div key={r.id}>
                <button className="w-full text-left p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30" onClick={() => setExpanded(open ? null : r.id)}>
                  {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${r.status === "succeeded" ? "bg-emerald-500/10 text-emerald-600" : r.status === "failed" ? "bg-rose-500/10 text-rose-600" : "bg-blue-500/10 text-blue-600"}`}>
                    {r.status === "succeeded" ? <CheckCircle2 className="w-4 h-4" /> : r.status === "failed" ? <XCircle className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium">{pipeline?.name ?? "流水线已删除"}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(r.startedAt)}{artifact ? ` · 制品 ${artifact.name} ${artifact.version}` : ""}</p>
                  </div>
                  {r.simulated && <Pill tone="amber">模拟</Pill>}
                  <StatusPill status={r.status} />
                </button>
                {open && (
                  <div className="px-4 pb-4 md:px-12 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                      {r.stages.map((s, i) => (
                        <div key={i} className={`rounded-lg border p-2.5 ${s.status === "success" ? "border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20" : s.status === "failed" ? "border-rose-300/60" : ""}`}>
                          <div className="flex items-center gap-1.5">
                            {s.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : s.status === "failed" ? <XCircle className="w-3.5 h-3.5 text-rose-500" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className="text-xs font-medium truncate">{s.name}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1">{s.durationMs ? `${s.durationMs} ms` : statusLabel[s.status ?? ""] ?? s.status ?? "—"}</p>
                        </div>
                      ))}
                    </div>
                    {r.log && <pre className="text-[11px] font-mono bg-zinc-950 text-zinc-200 rounded-lg p-3 overflow-auto max-h-[260px] whitespace-pre-wrap">{r.log}</pre>}
                  </div>
                )}
              </div>
            );
          })}
          {!runs.length && <p className="text-sm text-muted-foreground text-center py-10">暂无运行记录</p>}
        </div>
      </Card>

      {createOpen && <PipelineModal projects={[]} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await refreshWorkspace(); }} />}
      {runTarget && (
        <RunModal pipeline={runTarget} artifacts={artifacts} busy={busy === runTarget.id} onClose={() => setRunTarget(null)} onRun={(aid) => run(runTarget.id, aid)} />
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("审视当前流水线，指出缺失的质量门禁并给出改进建议")}>
          <Package className="w-4 h-4 mr-2" /> 让 Agent 评审流水线
        </Button>
      </div>
    </div>
  );
}

function RunModal({ pipeline, artifacts, busy, onClose, onRun }: {
  pipeline: Pipeline;
  artifacts: Artifact[];
  busy: boolean;
  onClose: () => void;
  onRun: (artifactId?: string) => void;
}) {
  const [artifactId, setArtifactId] = useState(artifacts[0]?.id ?? "");
  return (
    <Modal title={`运行流水线：${pipeline.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">关联制品（可选）</label>
          <Select value={artifactId} onChange={setArtifactId} className="mt-1.5 w-full">
            <option value="">不关联</option>
            {artifacts.map((a) => <option key={a.id} value={a.id}>{a.name} {a.version}</option>)}
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">不关联制品时，流水线会校验并记录各阶段执行结果。</p>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => onRun(artifactId || undefined)} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4 mr-2" /> 开始运行</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PipelineModal({ onClose, onCreated }: { projects: { id: string; name: string }[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: "",
    description: "",
    stages: "安装依赖 | npm ci\n静态检查 | npm run lint\n构建 | npm run build\n测试 | npm test",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const stages = form.stages.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, command] = line.split("|").map((s) => s.trim());
        return { name: name || "步骤", command: command || "" };
      });
      await api.pipelines.create(tenant.tenant.id, { name: form.name, description: form.description, stages, trigger: "manual" });
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="新建流水线" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">名称</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="例如：主站构建部署流水线" />
        </div>
        <div>
          <label className="text-sm font-medium">描述</label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" />
        </div>
        <div>
          <label className="text-sm font-medium">阶段（每行：阶段名 | 命令）</label>
          <Textarea value={form.stages} onChange={(v) => setForm({ ...form, stages: v })} rows={6} className="font-mono text-xs" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={create} disabled={busy || !form.name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}</Button>
        </div>
      </div>
    </Modal>
  );
}
