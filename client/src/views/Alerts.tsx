import { useMemo, useState } from "react";
import {
  Bell, BellRing, CheckCircle2, ShieldAlert, Loader2, RefreshCw, Clock,
  MonitorCheck, Bot,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, StatCard, StatusPill, Pill, Select, formatDate, timeAgo, statusLabel } from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";

export function Alerts() {
  const tenant = useSession((s) => s.currentTenant)!;
  const alerts = useWorkspace((s) => s.alerts);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tid = tenant.tenant.id;

  const filtered = useMemo(() => alerts.filter((a) => {
    if (status !== "all" && a.status !== status) return false;
    if (severity !== "all" && a.severity !== severity) return false;
    return true;
  }), [alerts, status, severity]);

  const update = async (id: string, next: "acknowledged" | "resolved" | "open") => {
    setBusy(id);
    setError(null);
    try {
      await api.alerts.update(tid, id, next);
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
        title="告警中心"
        description="监控失败会生成告警；确认与解决动作会记录处理人和时间，形成运维闭环。"
        actions={<Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>}
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Bell} label="全部告警" value={alerts.length} tone="blue" />
        <StatCard icon={BellRing} label="未处理" value={alerts.filter((a) => a.status === "open").length} tone={alerts.some((a) => a.status === "open") ? "amber" : "default"} />
        <StatCard icon={Clock} label="已确认" value={alerts.filter((a) => a.status === "acknowledged").length} tone="violet" />
        <StatCard icon={CheckCircle2} label="已解决" value={alerts.filter((a) => a.status === "resolved").length} tone="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={setStatus}>
          <option value="all">全部状态</option>
          <option value="open">未处理</option>
          <option value="acknowledged">已确认</option>
          <option value="resolved">已解决</option>
        </Select>
        <Select value={severity} onChange={setSeverity}>
          <option value="all">全部级别</option>
          <option value="critical">严重</option>
          <option value="warning">警告</option>
          <option value="info">提示</option>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Bell} title={alerts.length ? "没有匹配的告警" : "暂无告警"} description={alerts.length ? "调整筛选条件试试。" : "所有监控运行正常。当监控失败时，告警会自动出现在这里。"} />
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <Card key={a.id} className={`p-4 ${a.status === "open" ? "border-l-4 border-l-amber-400" : a.status === "resolved" ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.severity === "critical" ? "bg-rose-500/10 text-rose-600" : a.severity === "warning" ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-600"}`}>
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-semibold flex flex-wrap items-center gap-2">
                    {a.title}
                    <Pill tone={a.severity === "critical" ? "rose" : a.severity === "warning" ? "amber" : "blue"}>{statusLabel[a.severity] ?? a.severity}</Pill>
                    <StatusPill status={a.status} />
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{a.detail || "无详细说明"}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><MonitorCheck className="w-3 h-3" />{a.monitorName ?? "未知监控"}</span>
                    <span>·</span>
                    <span>{formatDate(a.createdAt)}（{timeAgo(a.createdAt)}）</span>
                    {a.resolvedAt && <><span>·</span><span>解决于 {formatDate(a.resolvedAt)}</span></>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {a.status === "open" && (
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => update(a.id, "acknowledged")}>
                      {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "确认"}
                    </Button>
                  )}
                  {a.status !== "resolved" && (
                    <Button size="sm" disabled={busy === a.id} onClick={() => update(a.id, "resolved")}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 解决
                    </Button>
                  )}
                  {a.status !== "open" && (
                    <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => update(a.id, "open")}>重新打开</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("汇总当前告警，按影响面排序并给出处置步骤")}>
          <Bot className="w-4 h-4 mr-2" /> 让 Agent 汇总告警
        </Button>
      </div>
    </div>
  );
}
