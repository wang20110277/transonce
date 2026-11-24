import { useMemo, useState } from "react";
import {
  Bell, BellRing, CheckCircle2, ShieldAlert, Loader2, RefreshCw, Clock,
  MonitorCheck, Bot, Plus, Send, Server, User, UserPlus, XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PageHeader, EmptyState, StatCard, StatusPill, Pill, Select, Textarea, formatDate, timeAgo, statusLabel,
  alertProviderLabel,
} from "../components/common";
import { Modal } from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Alert, AlertChannelEvent, AlertDelivery } from "../types";

// 推送记录按时间倒序，卡片上每个通道显示一条。优先取这条告警自己那一类事件（监控告警对应 monitor、
// 手工录入对应 manual）的最近一次结果；这个通道没有这类记录时，才显示它其它事件（例如状态变化）的最近一次。
// 否则订阅了「状态变化」的通道会在确认 / 解决后盖住原来的推送结果和失败原因。
function latestPerChannel(deliveries: AlertDelivery[], ownEvent: AlertChannelEvent): AlertDelivery[] {
  const order: string[] = [];
  const own = new Map<string, AlertDelivery>();
  const latest = new Map<string, AlertDelivery>();
  for (const d of deliveries ?? []) {
    const key = d.channelId ?? d.channelName;
    if (!latest.has(key)) {
      latest.set(key, d);
      order.push(key);
    }
    if (d.event === ownEvent && !own.has(key)) own.set(key, d);
  }
  // 顺序不变：按每个通道最近一次推送的时间，新的在前。
  return order.flatMap((key) => {
    const chosen = own.get(key) ?? latest.get(key);
    return chosen ? [chosen] : [];
  });
}

// 结果提示的语气：有失败时用琥珀色，全部成功或没有推送时是绿色。
type Notice = { text: string; tone: "ok" | "warn" };

export function Alerts() {
  const tenant = useSession((s) => s.currentTenant)!;
  const user = useSession((s) => s.user);
  const alerts = useWorkspace((s) => s.alerts);
  const detail = useWorkspace((s) => s.detail);
  const channels = useWorkspace((s) => s.alertChannels);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [source, setSource] = useState("all");
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const tid = tenant.tenant.id;
  const myId = user?.id;

  const filtered = useMemo(() => alerts.filter((a) => {
    if (status !== "all" && a.status !== status) return false;
    if (severity !== "all" && a.severity !== severity) return false;
    if (source !== "all" && (a.source ?? "monitor") !== source) return false;
    if (mine && !(a.notifiedUsers ?? []).some((u) => u.id === myId)) return false;
    return true;
  }), [alerts, status, severity, source, mine, myId]);

  const update = async (id: string, next: "acknowledged" | "resolved" | "open") => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await api.alerts.update(tid, id, next);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resend = async (a: Alert) => {
    const key = `resend-${a.id}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await api.alerts.resend(tid, a.id);
      await refreshWorkspace();
      const total = res.deliveries.length;
      const sent = res.deliveries.filter((d) => d.status === "sent").length;
      setNotice(
        total === 0
          // 只有告警中心权限的成员没有「告警配置」这个入口，不能让他们自己去检查通道。
          ? { text: "没有符合条件（启用且已订阅）的通道，这次没有推送。可以请有『告警配置』权限的同事检查通道。", tone: "ok" }
          : sent === total
            ? { text: `已重新推送到 ${sent} 个群。`, tone: "ok" }
            : { text: `重新推送：${sent} 个群成功，${total - sent} 个失败，原因见卡片。`, tone: "warn" },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // 录入成功后的提示：按实际的推送结果说话。
  const saved = async (created: Alert, push: boolean) => {
    const deliveries = created.deliveries ?? [];
    const sent = deliveries.filter((d) => d.status === "sent").length;
    const failed = deliveries.length - sent;
    setCreating(false);
    await refreshWorkspace();
    setNotice(
      !push || deliveries.length === 0
        ? { text: "问题已录入，未推送到群。", tone: "ok" }
        : sent === 0
          ? { text: "问题已录入，但推送到群失败，原因见卡片，可以在卡片上重发。", tone: "warn" }
          : {
            text: `问题已录入，已推送到 ${sent} 个群${failed ? `，${failed} 个失败，可以在卡片上重发` : ""}。`,
            tone: failed ? "warn" : "ok",
          },
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="告警中心"
        description="监控失败会生成告警，也可以手工录入问题并通知相关成员；确认与解决都会记录处理人和时间。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => { setNotice(null); setError(null); setCreating(true); }}><Plus className="w-4 h-4 mr-2" /> 录入问题</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}
      {notice && (
        <div className={`text-sm rounded-lg px-4 py-2 ${notice.tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
          {notice.text}
        </div>
      )}

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
        <Select id="alert-source" value={source} onChange={setSource}>
          <option value="all">全部来源</option>
          <option value="monitor">监控告警</option>
          <option value="manual">手工录入</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input id="alerts-mine" type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 只看通知了我的
        </label>
      </div>

      {!filtered.length ? (
        <EmptyState
          icon={Bell}
          title={alerts.length ? "没有匹配的告警" : "暂无告警"}
          description={alerts.length ? "调整筛选条件试试。" : "所有监控运行正常。监控失败时告警会自动出现在这里，也可以点「录入问题」手工记录。"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const latest = latestPerChannel(a.deliveries, a.source === "manual" ? "manual" : "monitor");
            const notified = a.notifiedUsers ?? [];
            // 同一张卡片上的操作互斥：任一操作进行中，四个按钮都置灰，转圈只出现在被点的那个上。
            const working = busy === a.id || busy === `resend-${a.id}`;
            return (
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
                      <Pill tone={a.source === "manual" ? "violet" : "gray"}>{a.source === "manual" ? "手工录入" : "监控告警"}</Pill>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.detail || "无详细说明"}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                      {a.source === "manual" ? (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{a.createdByName ?? "成员"} 录入</span>
                      ) : (
                        <span className="flex items-center gap-1"><MonitorCheck className="w-3 h-3" />{a.monitorName ?? "未知监控"}</span>
                      )}
                      {a.environmentName && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1"><Server className="w-3 h-3" />{a.environmentName}</span>
                        </>
                      )}
                      {notified.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex flex-wrap items-center gap-1">
                            <UserPlus className="w-3 h-3" />通知：{notified.map((u) => u.name).join("、")}
                            {notified.some((u) => u.id === myId) && <Pill tone="amber">含我</Pill>}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatDate(a.createdAt)}（{timeAgo(a.createdAt)}）</span>
                      {a.resolvedAt && <><span>·</span><span>解决于 {formatDate(a.resolvedAt)}</span></>}
                    </div>
                    {latest.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {latest.map((d) => (
                          <span
                            key={d.id}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] wrap-anywhere ${d.status === "sent" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 text-rose-700 dark:text-rose-300"}`}
                          >
                            {d.status === "sent" ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                            {alertProviderLabel[d.provider] ?? d.provider} · {d.channelName}{d.channelId ? "" : "（通道已删除）"}
                            {d.status === "sent" ? "" : `：${d.error ?? "失败"}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.status === "open" && (
                      <Button size="sm" variant="outline" disabled={working} onClick={() => update(a.id, "acknowledged")}>
                        {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "确认"}
                      </Button>
                    )}
                    {a.status !== "resolved" && (
                      <Button size="sm" disabled={working} onClick={() => update(a.id, "resolved")}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 解决
                      </Button>
                    )}
                    {a.status !== "open" && (
                      <Button size="sm" variant="ghost" disabled={working} onClick={() => update(a.id, "open")}>重新打开</Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={working}
                      onClick={() => resend(a)}
                      aria-label={`重发告警 ${a.title}`}
                    >
                      {busy === `resend-${a.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 重发
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => askAgent("汇总当前告警，按影响面排序并给出处置步骤")}>
          <Bot className="w-4 h-4 mr-2" /> 让 Agent 汇总告警
        </Button>
      </div>

      {creating && (
        <IssueModal
          onClose={() => setCreating(false)}
          onSaved={saved}
          members={(detail?.members ?? []).filter((m) => m.status === "active" && m.userId)}
          canPush={channels.some((c) => c.enabled && c.events?.manual)}
        />
      )}
    </div>
  );
}

function IssueModal({
  members, canPush, onClose, onSaved,
}: {
  members: { userId: string; name: string }[];
  // 没有任何启用中的通道订阅「手工问题」时，推送选项置灰。
  canPush: boolean;
  onClose: () => void;
  onSaved: (created: Alert, push: boolean) => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const environments = useWorkspace((s) => s.environments);
  const monitors = useWorkspace((s) => s.monitors);
  const [form, setForm] = useState({
    title: "",
    severity: "warning",
    environmentId: "",
    monitorId: "",
    detail: "",
    notified: [] as string[],
    push: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleMember = (id: string) =>
    setForm((f) => ({ ...f, notified: f.notified.includes(id) ? f.notified.filter((x) => x !== id) : [...f.notified, id] }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const push = canPush && form.push;
      const created = await api.alerts.create(tenant.tenant.id, {
        title: form.title.trim(),
        severity: form.severity as Alert["severity"],
        detail: form.detail.trim() || undefined,
        environmentId: form.environmentId || undefined,
        monitorId: form.monitorId || undefined,
        notifiedUserIds: form.notified,
        push,
      });
      await onSaved(created, push);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="录入问题" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label htmlFor="issue-title" className="text-sm font-medium">标题</label>
          <Input id="issue-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1.5 h-10" placeholder="一句话说明出了什么问题" maxLength={200} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="issue-severity" className="text-sm font-medium">级别</label>
            <Select id="issue-severity" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} className="mt-1.5 w-full h-10">
              <option value="info">提示</option>
              <option value="warning">警告</option>
              <option value="critical">严重</option>
            </Select>
          </div>
          <div>
            <label htmlFor="issue-environment" className="text-sm font-medium">关联环境</label>
            <Select id="issue-environment" value={form.environmentId} onChange={(v) => setForm({ ...form, environmentId: v })} className="mt-1.5 w-full h-10">
              <option value="">不关联</option>
              {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="issue-monitor" className="text-sm font-medium">关联监控</label>
            <Select
              id="issue-monitor"
              value={form.monitorId}
              onChange={(v) => {
                const monitor = monitors.find((m) => m.id === v);
                // 监控关联了环境就一并带上，之后仍然可以改。
                setForm((f) => ({ ...f, monitorId: v, environmentId: f.environmentId || monitor?.environmentId || "" }));
              }}
              className="mt-1.5 w-full h-10"
            >
              <option value="">不关联</option>
              {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
        </div>
        <label className="block text-sm font-medium">
          详细说明
          <Textarea value={form.detail} onChange={(v) => setForm({ ...form, detail: v })} rows={3} placeholder="现象、影响范围、已经做过的排查" className="mt-1.5" />
        </label>
        <div>
          <p className="text-sm font-medium">
            通知人员 <span className="text-muted-foreground font-normal">（可多选。被通知的人可以用「只看通知了我的」找到这条问题）</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = form.notified.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  aria-pressed={on}
                  aria-label={`通知 ${m.name}`}
                  onClick={() => toggleMember(m.userId)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="issue-push"
            type="checkbox"
            className="mt-0.5"
            checked={canPush && form.push}
            disabled={!canPush}
            onChange={(e) => setForm({ ...form, push: e.target.checked })}
          />
          <span>
            同时推送到群
            {!canPush && <span className="block text-xs text-muted-foreground">没有启用中的通道订阅「手工问题」，保存后只会出现在告警中心。</span>}
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.title.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "录入"}</Button>
        </div>
      </div>
    </Modal>
  );
}
