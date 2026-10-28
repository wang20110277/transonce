import { useMemo, useState } from "react";
import {
  Bot, Cpu, Sparkles, ShieldCheck, Terminal, Loader2, Save, RotateCcw,
  ListChecks, FileText, Layers, TestTube2, Rocket, Activity, Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, StatusPill, Pill, Select, Textarea, timeAgo, statusLabel } from "../components/common";
import { api } from "../services/api";
import { RUNTIME_OPTIONS, useAgentRuntime, runtimeHint, modelPlaceholder } from "../lib/agentModels";
import { can, isAdmin, useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";

const QUICK_ACTIONS = [
  { icon: FileText, label: "梳理需求", prompt: "帮我把当前未完成的需求梳理一遍，指出缺失的验收标准" },
  { icon: Layers, label: "生成架构", prompt: "为当前优先级最高的需求生成原型和架构设计" },
  { icon: ListChecks, label: "拆解任务", prompt: "为当前需求拆解研发任务并给出排期建议" },
  { icon: TestTube2, label: "检查测试", prompt: "检查最近一次测试结果，分析失败用例和风险" },
  { icon: Rocket, label: "部署检查", prompt: "检查当前部署与环境状态，给出发布前检查清单" },
  { icon: Activity, label: "运维巡检", prompt: "对当前监控和告警做一次巡检，输出处置建议" },
];

export function MyAgent() {
  const tenant = useSession((s) => s.currentTenant)!;
  const user = useSession((s) => s.user);
  const detail = useWorkspace((s) => s.detail);
  const agentRuns = useWorkspace((s) => s.agentRuns);
  const tid = tenant.tenant.id;
  const agent = useMemo(
    () => detail?.myAgent ?? detail?.agents.find((a) => a.ownerUserId === user?.id) ?? detail?.agents[0],
    [detail, user],
  );
  const [form, setForm] = useState<{ name: string; provider: string; model: string; description: string; systemPrompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const runtime = useAgentRuntime();
  const editable = isAdmin() || can("agent.manage") || agent?.ownerUserId === user?.id;
  const runs = agentRuns.filter((r) => !agent || r.agentId === agent.id);

  if (!agent) {
    return (
      <div className="space-y-5">
        <PageHeader title="我的 Agent" description="每位成员都有专属 Agent，以你的权限执行研发任务。" />
        <EmptyState icon={Bot} title="尚未创建专属 Agent" description="加入租户后系统会自动创建；如果缺失，请联系管理员重置。" />
      </div>
    );
  }

  const current = form ?? {
    name: agent.name,
    provider: agent.provider,
    model: agent.model ?? "",
    description: agent.description ?? "",
    systemPrompt: agent.systemPrompt ?? "",
  };
  const runtimeInfo = runtime?.providers[current.provider];

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.tenants.updateAgent(tid, agent.id, {
        name: current.name,
        provider: current.provider as typeof agent.provider,
        model: current.model,
        description: current.description,
        systemPrompt: current.systemPrompt,
      });
      setForm(null);
      setSaved(true);
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
        title="我的 Agent"
        description="Agent 以你的身份和权限工作：它能看到你能看到的数据，但永远无法读取环境明文密码或绕过生产发布审批。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => askAgent("介绍你的能力边界，以及你可以帮我完成哪些研发任务")}><Sparkles className="w-4 h-4 mr-2" /> 试用</Button>
            {isAdmin() && (
              <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
                if (!confirm("重置会恢复默认提示词与配置，确认继续？")) return;
                setBusy(true);
                try { await api.tenants.resetAgent(tid); await refreshWorkspace(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
              }}><RotateCcw className="w-4 h-4 mr-2" /> 重置</Button>
            )}
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}
      {saved && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">Agent 配置已保存。</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-5 xl:col-span-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 text-violet-600 flex items-center justify-center"><Bot className="w-6 h-6" /></div>
            <div className="min-w-0">
              <p className="font-bold truncate">{agent.name}</p>
              <p className="text-xs text-muted-foreground">{agent.ownerName ?? "租户共享"} 的专属 Agent</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-4">
            <Pill tone="violet"><Cpu className="w-3 h-3" />{statusLabel[agent.provider] ?? agent.provider}</Pill>
            <Pill tone="green"><ShieldCheck className="w-3 h-3" />在线</Pill>
            {agent.model && <Pill tone="gray">{agent.model}</Pill>}
          </div>
          <p className="text-sm text-muted-foreground mt-4">{agent.description}</p>

          <div className="mt-5 pt-4 border-t">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> 可用工具</p>
            <div className="flex flex-wrap gap-1.5">
              {(agent.tools ?? []).map((t) => <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>)}
              {!agent.tools?.length && <span className="text-xs text-muted-foreground">默认工具集</span>}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> 生效权限</p>
            <div className="flex flex-wrap gap-1.5">
              {tenant.isTenantAdmin ? <Pill tone="violet">租户管理员（全部权限）</Pill> : (tenant.permissions ?? []).slice(0, 12).map((p) => <Pill key={p} tone="gray">{p}</Pill>)}
            </div>
          </div>
        </Card>

        <Card className="p-5 xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Agent 配置</h3>
            {editable && (
              <div className="flex gap-2">
                {form && <Button variant="ghost" size="sm" onClick={() => setForm(null)}>取消</Button>}
                <Button size="sm" onClick={save} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} 保存
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">名称</label>
              <Input value={current.name} disabled={!editable} onChange={(e) => setForm({ ...current, name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">运行时</label>
              <Select value={current.provider} onChange={(v) => setForm({ ...current, provider: v })} className="mt-1 w-full">
                {RUNTIME_OPTIONS.map((p) => {
                  const unavailable = runtime?.providers[p.id]?.installed === false;
                  return (
                    <option key={p.id} value={p.id} disabled={unavailable}>
                      {p.label}{unavailable ? "（本机未安装）" : ""}
                    </option>
                  );
                })}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">模型（可选）</label>
              <Input
                value={current.model}
                disabled={!editable || runtimeInfo?.supported === false}
                onChange={(e) => setForm({ ...current, model: e.target.value })}
                className="mt-1"
                list="agent-model-options"
                placeholder={modelPlaceholder(current.provider)}
              />
              <datalist id="agent-model-options">
                {(runtimeInfo?.models ?? []).map((m) => <option key={m.id} value={m.id} />)}
              </datalist>
              {runtimeHint(runtimeInfo) && <p className="text-[11px] text-muted-foreground mt-1">{runtimeHint(runtimeInfo)}</p>}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">描述</label>
            <Input value={current.description} disabled={!editable} onChange={(e) => setForm({ ...current, description: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">系统提示词</label>
            <Textarea value={current.systemPrompt} onChange={(v) => setForm({ ...current, systemPrompt: v })} rows={9} className="font-mono text-xs mt-1" />
            {!editable && <p className="text-[11px] text-muted-foreground mt-1">只有本人或具备 Agent 配置权限的管理员可以修改。</p>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> 快捷指令</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((a) => (
              <button key={a.label} onClick={() => askAgent(a.prompt)} className="flex items-center gap-2 rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-muted/30 transition-colors">
                <a.icon className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm">{a.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Terminal className="w-4 h-4" /> 最近运行</h3>
          <div className="space-y-2">
            {runs.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{statusLabel[r.taskType] ?? r.taskType}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{r.input}</p>
                </div>
                <StatusPill status={r.status} />
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(r.startedAt)}</span>
              </div>
            ))}
            {!runs.length && <p className="text-sm text-muted-foreground text-center py-6">还没有运行记录，试试快捷指令。</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
