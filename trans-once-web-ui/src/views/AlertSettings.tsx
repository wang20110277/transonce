import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, KeyRound, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Modal, PageHeader, EmptyState, Pill, Select, SwitchRow, Toggle, formatDate,
  alertEventLabel, alertProviderLabel,
} from "../components/common";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { AlertChannel, AlertChannelEvent, AlertChannelInput, AlertDelivery } from "../types";

const EVENTS: AlertChannelEvent[] = ["monitor", "manual", "status"];

// 各平台机器人地址的样子，用作输入框的占位；signs 表示这个平台支持加签。
const PROVIDERS: { id: AlertChannel["provider"]; webhookHint: string; secretHint: string; signs: boolean }[] = [
  {
    id: "dingtalk",
    webhookHint: "https://oapi.dingtalk.com/robot/send?access_token=…",
    secretHint: "以 SEC 开头，机器人安全设置选「加签」时显示",
    signs: true,
  },
  {
    id: "wecom",
    webhookHint: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
    secretHint: "",
    signs: false,
  },
  {
    id: "feishu",
    webhookHint: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
    secretHint: "机器人安全设置选「签名校验」时显示",
    signs: true,
  },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AlertSettings() {
  const tenant = useSession((s) => s.currentTenant)!;
  const channels = useWorkspace((s) => s.alertChannels);
  const [editing, setEditing] = useState<AlertChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, AlertDelivery>>({});
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const tid = tenant.tenant.id;

  // 最近推送。切换团队后重新取；取不到就留空，不影响通道卡片。
  useEffect(() => {
    let alive = true;
    api.alertChannels.deliveries(tid)
      .then((rows) => { if (alive) setDeliveries(rows); })
      .catch(() => { if (alive) setDeliveries([]); });
    return () => { alive = false; };
  }, [tid]);

  const run = async (key: string | null, action: () => Promise<void>) => {
    if (key) setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (key) setBusy(null);
    }
  };

  const reloadDeliveries = () =>
    api.alertChannels.deliveries(tid).then(setDeliveries).catch(() => undefined);

  const toggle = (channel: AlertChannel, enabled: boolean) =>
    run(null, async () => {
      await api.alertChannels.update(tid, channel.id, { enabled });
      await refreshWorkspace();
    });

  const sendTest = (channel: AlertChannel) =>
    run(channel.id, async () => {
      const result = await api.alertChannels.test(tid, channel.id);
      setTested((t) => ({ ...t, [channel.id]: result }));
      await reloadDeliveries();
    });

  const remove = (channel: AlertChannel) =>
    run(channel.id, async () => {
      if (!confirm(`删除通道「${channel.name}」？这个群将不再收到推送，历史推送记录会保留。`)) return;
      await api.alertChannels.remove(tid, channel.id);
      await refreshWorkspace();
      await reloadDeliveries();
    });

  const closeModal = async () => {
    setCreating(false);
    setEditing(null);
    await refreshWorkspace();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="告警配置"
        description="配置钉钉 / 企业微信 / 飞书群机器人，监控告警和录入的问题会自动推送到对应的群。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { refreshWorkspace(); reloadDeliveries(); }}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建通道</Button>
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {!channels.length ? (
        <EmptyState icon={BellRing} title="还没有配置告警通道" description="添加一个群机器人地址，监控告警和录入的问题就会推送到群里。" action={
          <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建通道</Button>
        } />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              latest={deliveries.find((d) => d.channelId === channel.id)}
              tested={tested[channel.id]}
              busy={busy === channel.id}
              onToggle={(enabled) => toggle(channel, enabled)}
              onEdit={() => setEditing(channel)}
              onTest={() => sendTest(channel)}
              onRemove={() => remove(channel)}
            />
          ))}
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">最近推送</h3>
        <Card className="divide-y">
          {deliveries.length ? deliveries.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
              <span className="text-muted-foreground w-28 shrink-0">{formatDate(d.createdAt)}</span>
              <span className="font-medium">{d.channelName}{d.channelId ? "" : "（通道已删除）"}</span>
              <Pill tone="blue">{alertProviderLabel[d.provider] ?? d.provider}</Pill>
              <Pill tone="gray">{alertEventLabel[d.event] ?? d.event}</Pill>
              <Pill tone={d.status === "sent" ? "green" : "rose"}>{d.status === "sent" ? "成功" : "失败"}</Pill>
              {d.error && <span className="text-muted-foreground break-all basis-60 flex-1">{d.error}</span>}
            </div>
          )) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">还没有推送记录。保存通道后可以发一条测试消息。</p>
          )}
        </Card>
      </section>

      {(creating || editing) && (
        <ChannelModal channel={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={closeModal} />
      )}
    </div>
  );
}

function ChannelCard({
  key, channel, latest, tested, busy, onToggle, onEdit, onTest, onRemove,
}: {
  key?: string;
  channel: AlertChannel;
  latest?: AlertDelivery;
  tested?: AlertDelivery;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const signs = channel.provider !== "wecom";
  const result = tested ?? latest;
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600">
            <BellRing className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold flex flex-wrap items-center gap-2">
              {channel.name}
              <Pill tone="blue">{alertProviderLabel[channel.provider] ?? channel.provider}</Pill>
              {!channel.enabled && <Pill tone="gray">已停用</Pill>}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono break-all">{channel.webhookMasked}</p>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
              <KeyRound className="w-3 h-3 shrink-0" />
              <span className="break-all">
                {signs
                  ? (channel.hasSecret ? `已加签 ${channel.secretMasked ?? ""}` : "未加签，请在机器人的安全设置里配置关键词")
                  : "企业微信群机器人不需要密钥"}
              </span>
            </p>
          </div>
        </div>
        <Toggle checked={channel.enabled} onChange={onToggle} ariaLabel={`启用通道 ${channel.name}`} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EVENTS.map((event) => (
          <Pill key={event} tone={channel.events?.[event] ? "green" : "gray"}>{alertEventLabel[event]}</Pill>
        ))}
      </div>

      {result && (tested ? (
        <p className={`text-xs rounded-md px-2.5 py-1.5 break-all ${result.status === "sent" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
          {result.status === "sent"
            ? "测试消息已送达，请到群里确认。"
            : `测试消息发送失败：${result.error ?? `HTTP ${result.httpStatus ?? "-"}`}`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          {result.status === "sent"
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            : <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
          <span className="min-w-0 break-all">
            最近推送：{alertEventLabel[result.event] ?? result.event} · {result.status === "sent" ? "已送达" : "失败"} · {formatDate(result.createdAt)}
            {result.error && `（${result.error}）`}
          </span>
        </p>
      ))}

      <div className="flex flex-wrap gap-1.5 border-t pt-3 mt-auto">
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy} aria-label={`发送测试消息到 ${channel.name}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 测试消息
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`编辑通道 ${channel.name}`}><Pencil className="w-3.5 h-3.5" /> 编辑</Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove} aria-label={`删除通道 ${channel.name}`}><Trash2 className="w-3.5 h-3.5" /> 删除</Button>
      </div>
    </Card>
  );
}

function ChannelModal({ channel, onClose, onSaved }: {
  channel: AlertChannel | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: channel?.name ?? "",
    provider: (channel?.provider ?? "dingtalk") as AlertChannel["provider"],
    webhook: "",
    secret: "",
    enabled: channel?.enabled ?? true,
    monitor: channel?.events?.monitor ?? true,
    manual: channel?.events?.manual ?? true,
    status: channel?.events?.status ?? false,
  });
  // 编辑时点「清除已保存的密钥」就提交空串；之后在密钥框里输入新值会取消清除。
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = PROVIDERS.find((p) => p.id === form.provider) ?? PROVIDERS[0];
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const secret = provider.signs ? form.secret.trim() : "";
      const body: AlertChannelInput = {
        name: form.name.trim(),
        provider: form.provider,
        events: { monitor: form.monitor, manual: form.manual, status: form.status },
        ...(channel ? { enabled: form.enabled } : {}),
        // 密钥三态：点了「清除」提交空串；填了新值提交新值；都不占就不提交，后端保留原值。
        ...(clearSecret ? { secret: "" } : secret ? { secret } : {}),
        ...(form.webhook.trim() ? { webhook: form.webhook.trim() } : {}),
      };
      if (channel) await api.alertChannels.update(tenant.tenant.id, channel.id, body);
      else await api.alertChannels.create(tenant.tenant.id, body);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={channel ? `编辑通道：${channel.name}` : "新建通道"} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="channel-name" className="text-sm font-medium">通道名称</label>
            <Input id="channel-name" value={form.name} onChange={(e) => set("name", e.target.value)} className="mt-1.5 h-10" placeholder="例如：运维告警群" maxLength={50} />
          </div>
          <div>
            <label htmlFor="channel-provider" className="text-sm font-medium">平台</label>
            <Select id="channel-provider" value={form.provider} onChange={(v) => set("provider", v as AlertChannel["provider"])} className="mt-1.5 w-full h-10">
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{alertProviderLabel[p.id]}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="channel-webhook" className="text-sm font-medium">
            Webhook 地址 {channel && <span className="text-muted-foreground font-normal">（留空表示不修改）</span>}
          </label>
          <Input
            id="channel-webhook"
            type="password"
            value={form.webhook}
            onChange={(e) => set("webhook", e.target.value)}
            className="mt-1.5 h-10 font-mono"
            placeholder={channel?.webhookMasked ?? provider.webhookHint}
            autoComplete="off"
          />
        </div>
        {provider.signs && (
          <div>
            <label htmlFor="channel-secret" className="text-sm font-medium">
              加签密钥 <span className="text-muted-foreground font-normal">（可选）</span>
            </label>
            <Input
              id="channel-secret"
              type="password"
              value={form.secret}
              onChange={(e) => { set("secret", e.target.value); setClearSecret(false); }}
              className="mt-1.5 h-10 font-mono"
              placeholder={channel?.hasSecret && !clearSecret ? `${channel.secretMasked ?? "••••••"}（留空保持不变）` : provider.secretHint}
              autoComplete="off"
            />
            {channel?.hasSecret && !clearSecret && (
              <Button variant="ghost" size="xs" className="mt-1 text-destructive" onClick={() => { set("secret", ""); setClearSecret(true); }}>
                清除已保存的密钥
              </Button>
            )}
          </div>
        )}
        {channel && (
          <SwitchRow
            title="启用"
            description="停用后不再向这个群推送。地址和密钥都会保留，测试消息仍然可以发送。"
            checked={form.enabled}
            onChange={(v) => set("enabled", v)}
          />
        )}
        <fieldset className="rounded-lg border bg-background/50 px-3.5 py-3 space-y-2">
          <legend className="px-1 text-sm font-medium">推送事件</legend>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-monitor" type="checkbox" checked={form.monitor} onChange={(e) => set("monitor", e.target.checked)} />
            监控告警<span className="text-muted-foreground text-xs">监控检查失败，产生新告警</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-manual" type="checkbox" checked={form.manual} onChange={(e) => set("manual", e.target.checked)} />
            手工问题<span className="text-muted-foreground text-xs">在告警中心里录入的问题</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input id="event-status" type="checkbox" checked={form.status} onChange={(e) => set("status", e.target.checked)} />
            状态变化<span className="text-muted-foreground text-xs">确认、解决、重新打开，或监控恢复</span>
          </label>
        </fieldset>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
          <p><span className="text-foreground font-medium">获取地址：</span>在群里打开「群设置 → 群机器人 → 自定义机器人」，添加后复制 Webhook 地址。</p>
          <p><span className="text-foreground font-medium">关键词校验：</span>消息标题都以「TransOnce」开头，在钉钉、飞书的安全设置里把关键词设为 TransOnce 即可。</p>
          <p><span className="text-foreground font-medium">频率限制：</span>钉钉、企业微信每个机器人每分钟 20 条（钉钉超限后会被限流 10 分钟），飞书每分钟 100 条、每秒 5 条。</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}
