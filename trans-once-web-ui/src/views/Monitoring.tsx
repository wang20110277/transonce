import { useState } from "react";
import {
  Activity, Plus, RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  ExternalLink, Trash2, ShieldAlert, ArrowRight, Play, Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, StatCard, Select, timeAgo, StatusPill } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Monitor } from "../types";

export function Monitoring({ onNavigate }: { onNavigate: (v: string) => void }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const monitors = useWorkspace((s) => s.monitors);
  const environments = useWorkspace((s) => s.environments);
  const alerts = useWorkspace((s) => s.alerts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [creating, setCreating] = useState(false);
  const tid = tenant.tenant.id;
  const manage = can("monitor.manage");
  const openAlerts = alerts.filter((a) => a.status === "open");

  const check = async (id?: string) => {
    setBusy(id ?? "all");
    setError(null);
    try {
      if (id) await api.monitors.check(tid, id);
      else await api.monitors.checkAll(tid);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const up = monitors.filter((m) => m.status === "up").length;
  const down = monitors.filter((m) => m.status === "down").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="运维监控"
        description="对部署后的服务执行健康检查；连续失败会生成告警并进入告警中心。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => check()} disabled={!!busy}>
              {busy === "all" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />} 全部检查
            </Button>
            {manage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建监控</Button>}
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="监控项" value={monitors.length} tone="blue" />
        <StatCard icon={CheckCircle2} label="正常" value={up} tone="emerald" />
        <StatCard icon={XCircle} label="异常" value={down} tone={down ? "rose" : "default"} />
        <StatCard icon={ShieldAlert} label="未处理告警" value={openAlerts.length} tone={openAlerts.length ? "amber" : "default"} onClick={() => onNavigate("alerts")} />
      </div>

      {openAlerts.length > 0 && (
        <Card className="p-4 border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 flex flex-wrap items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600" />
          <p className="text-sm flex-1">{openAlerts.length} 条未处理告警需要关注，最早一条来自 {timeAgo(openAlerts[openAlerts.length - 1]?.createdAt)}。</p>
          <Button size="sm" variant="outline" onClick={() => onNavigate("alerts")}>查看告警 <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
        </Card>
      )}

      {!monitors.length ? (
        <EmptyState icon={Activity} title="还没有监控项" description={manage ? "为环境或服务创建健康检查，部署后自动守护可用性。" : "请联系管理员创建监控项。"} action={
          manage ? <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建监控</Button> : undefined
        } />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {monitors.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.status === "up" ? "bg-emerald-500/10 text-emerald-600" : m.status === "down" ? "bg-rose-500/10 text-rose-600" : "bg-muted text-muted-foreground"}`}>
                    {m.status === "up" ? <CheckCircle2 className="w-5 h-5" /> : m.status === "down" ? <XCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold flex items-center gap-2">{m.name} <StatusPill status={m.status} /></p>
                    <p className="text-[11px] text-muted-foreground mt-1">{m.environmentName ?? "未关联环境"} · 每 {Math.round(m.intervalSeconds / 60)} 分钟</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy === m.id} onClick={() => check(m.id)}>
                    {busy === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </Button>
                  {manage && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(m)}><Pencil className="w-3.5 h-3.5" /></Button>}
                  {manage && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => {
                    if (!confirm(`删除监控「${m.name}」？`)) return;
                    await api.monitors.remove(tid, m.id);
                    await refreshWorkspace();
                  }}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[10px] text-muted-foreground">最近延迟</p>
                  <p className="text-sm font-semibold">{m.lastLatencyMs != null ? `${m.lastLatencyMs} ms` : "—"}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[10px] text-muted-foreground">期望状态</p>
                  <p className="text-sm font-semibold">{m.expectedStatus}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <p className="text-[10px] text-muted-foreground">最近检查</p>
                  <p className="text-sm font-semibold">{timeAgo(m.lastCheckedAt)}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground truncate">{m.method} {m.url}</span>
                <a href={m.url} target="_blank" rel="noreferrer" className="text-primary ml-auto shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
              </div>
              {m.lastError && <p className="mt-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/20 rounded px-2 py-1">{m.lastError}</p>}
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("根据当前监控与告警状态，给出运维巡检结论和处置建议")}>
          <Activity className="w-4 h-4 mr-2" /> 让 Agent 巡检
        </Button>
      </div>

      {(creating || editing) && (
        <MonitorModal monitor={editing} environments={environments} onClose={() => { setCreating(false); setEditing(null); }} onSaved={async () => { setCreating(false); setEditing(null); await refreshWorkspace(); }} />
      )}
    </div>
  );
}

function MonitorModal({ monitor, environments, onClose, onSaved }: {
  monitor: Monitor | null;
  environments: { id: string; name: string; baseUrl?: string | null }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: monitor?.name ?? "",
    environmentId: monitor?.environmentId ?? "",
    url: monitor?.url ?? "",
    method: monitor?.method ?? "GET",
    expectedStatus: String(monitor?.expectedStatus ?? 200),
    intervalSeconds: String(monitor?.intervalSeconds ?? 300),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        environmentId: form.environmentId || undefined,
        url: form.url,
        method: form.method,
        expectedStatus: Number(form.expectedStatus) || 200,
        intervalSeconds: Number(form.intervalSeconds) || 300,
      };
      if (monitor) await api.monitors.update(tenant.tenant.id, monitor.id, body);
      else await api.monitors.create(tenant.tenant.id, body);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={monitor ? "编辑监控" : "新建监控"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">名称</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="例如：生产首页健康检查" />
        </div>
        <div>
          <label className="text-sm font-medium">关联环境</label>
          <Select value={form.environmentId} onChange={(v) => {
            const env = environments.find((e) => e.id === v);
            setForm({ ...form, environmentId: v, url: form.url || env?.baseUrl || "" });
          }} className="mt-1.5 w-full">
            <option value="">不关联</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">健康检查 URL</label>
          <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="mt-1.5" placeholder="https://app.example.com/health" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">方法</label>
            <Select value={form.method} onChange={(v) => setForm({ ...form, method: v })} className="mt-1.5 w-full">
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">期望状态</label>
            <Input value={form.expectedStatus} onChange={(e) => setForm({ ...form, expectedStatus: e.target.value })} className="mt-1.5" />
          </div>
          <div>
            <label className="text-sm font-medium">间隔（秒）</label>
            <Input value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: e.target.value })} className="mt-1.5" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.name.trim() || !form.url.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}
