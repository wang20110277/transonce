import { useMemo, useState } from "react";
import {
  Rocket, Plus, Loader2, CheckCircle2, XCircle, ExternalLink, ShieldAlert,
  Server, RefreshCw, Bot, Clock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, StatCard, StatusPill, Pill, Select, Textarea, formatDate, timeAgo } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";

export function DeploymentCenter() {
  const tenant = useSession((s) => s.currentTenant)!;
  const deployments = useWorkspace((s) => s.deployments);
  const artifacts = useWorkspace((s) => s.artifacts);
  const environments = useWorkspace((s) => s.environments);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const tid = tenant.tenant.id;

  const filtered = useMemo(() => deployments.filter((d) => {
    if (filter === "all") return true;
    if (filter === "production") return d.environment.toLowerCase().includes("生产") || environments.find((e) => e.id === d.environmentId)?.kind === "production";
    return d.status === filter;
  }), [deployments, filter, environments]);

  const stats = useMemo(() => ({
    success: deployments.filter((d) => d.status === "success").length,
    failed: deployments.filter((d) => d.status === "failed").length,
    prod: deployments.filter((d) => environments.find((e) => e.id === d.environmentId)?.kind === "production").length,
  }), [deployments, environments]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="部署管理"
        description="测试环境可自助发布；生产环境发布需要单独授权，并且会记录操作人、制品版本与发布说明。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建部署</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Rocket} label="部署总数" value={deployments.length} tone="blue" />
        <StatCard icon={CheckCircle2} label="成功" value={stats.success} tone="emerald" />
        <StatCard icon={XCircle} label="失败" value={stats.failed} tone={stats.failed ? "rose" : "default"} />
        <StatCard icon={Server} label="生产发布" value={stats.prod} tone="violet" />
      </div>

      <div className="flex items-center gap-2">
        <Select value={filter} onChange={setFilter}>
          <option value="all">全部部署</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="pending">待执行</option>
          <option value="production">生产环境</option>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Rocket} title="暂无部署记录" description="选择制品与环境发起部署，或通过需求的「一键研发闭环」自动部署到测试环境。" action={
          <Button size="sm" className="mt-2" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建部署</Button>
        } />
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const env = environments.find((e) => e.id === d.environmentId);
            return (
              <Card key={d.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${d.status === "success" ? "bg-emerald-500/10 text-emerald-600" : d.status === "failed" ? "bg-rose-500/10 text-rose-600" : "bg-blue-500/10 text-blue-600"}`}>
                  {d.status === "success" ? <CheckCircle2 className="w-4 h-4" /> : d.status === "failed" ? <XCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium flex flex-wrap items-center gap-2">
                    {d.artifactName ?? "未知制品"}
                    <Badgeish text={d.environment} tone={env?.kind === "production" ? "rose" : "gray"} />
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {d.notes || "无发布说明"} · {formatDate(d.deployedAt)} · {timeAgo(d.deployedAt)}
                  </p>
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" /> 访问
                  </a>
                )}
                <StatusPill status={d.status} />
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("检查当前部署状态与环境一致性，给出回滚和风险建议")}>
          <Bot className="w-4 h-4 mr-2" /> 让 Agent 检查部署
        </Button>
      </div>

      {open && (
        <DeployModal
          artifacts={artifacts}
          environments={environments}
          busy={busy}
          onClose={() => setOpen(false)}
          onDeploy={async (artifactId, environmentId, notes) => {
            setBusy(true);
            setError(null);
            try {
              await api.deployments.create(tid, { artifactId, environmentId, notes });
              setOpen(false);
              await refreshWorkspace();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Badgeish({ text, tone }: { text: string; tone: "gray" | "rose" }) {
  return <Pill tone={tone}>{text}</Pill>;
}

function DeployModal({ artifacts, environments, busy, onClose, onDeploy }: {
  artifacts: { id: string; name: string; version: string }[];
  environments: { id: string; name: string; kind: string; baseUrl?: string | null }[];
  busy: boolean;
  onClose: () => void;
  onDeploy: (artifactId: string, environmentId: string, notes: string) => Promise<void>;
}) {
  const allowed = environments.filter((e) => e.kind !== "production" || can("deploy.production"));
  const [artifactId, setArtifactId] = useState(artifacts[0]?.id ?? "");
  const [envId, setEnvId] = useState(allowed.find((e) => e.kind === "test")?.id ?? allowed[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const prodBlocked = environments.some((e) => e.kind === "production") && !can("deploy.production");

  return (
    <Modal title="新建部署" onClose={onClose}>
      <div className="space-y-3">
        {prodBlocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            生产环境部署需要单独授权，当前角色只能发布到非生产环境。
          </div>
        )}
        <div>
          <label className="text-sm font-medium">制品</label>
          <Select value={artifactId} onChange={setArtifactId} className="mt-1.5 w-full">
            <option value="">选择制品…</option>
            {artifacts.map((a) => <option key={a.id} value={a.id}>{a.name} {a.version}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">目标环境</label>
          <Select value={envId} onChange={setEnvId} className="mt-1.5 w-full">
            {allowed.map((e) => <option key={e.id} value={e.id}>{e.name}（{e.kind}）</option>)}
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">发布说明</label>
          <Textarea value={notes} onChange={setNotes} rows={3} placeholder="本次变更内容、验证方式与回滚方案" />
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || !artifactId || !envId} onClick={() => onDeploy(artifactId, envId, notes)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Rocket className="w-4 h-4 mr-2" /> 部署</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
