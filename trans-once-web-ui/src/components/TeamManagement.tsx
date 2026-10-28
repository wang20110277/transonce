import type { ElementType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Shield, Bot, Plus, Settings2, Trash2, UserPlus, Cpu, CheckCircle2,
  XCircle, Loader2, RefreshCw, KeyRound,
} from "lucide-react";
import type { Agent, Permission, Role } from "../types";
import { api } from "../services/api";
import { MODEL_SUGGESTIONS, modelPlaceholder } from "../lib/agentModels";
import { can, isAdmin, useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import { Modal } from "./TeamSelect";

type Tab = "members" | "requests" | "roles" | "agents";

export function TeamManagement() {
  const detail = useWorkspace((s) => s.detail);
  const [tab, setTab] = useState<Tab>("members");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.auth.permissions().then(setPerms).catch(() => {});
  }, []);

  const pending = detail?.joinRequests.length ?? 0;
  const tabs: { id: Tab; label: string; icon: ElementType; show: boolean; count?: number }[] = [
    { id: "members", label: "成员", icon: Users, show: true },
    { id: "requests", label: "加入申请", icon: UserPlus, show: can("member.manage"), count: pending },
    { id: "roles", label: "角色与权限", icon: Shield, show: true },
    { id: "agents", label: "智能体", icon: Bot, show: true },
  ];

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">团队管理</h2>
          <p className="text-sm text-muted-foreground">管理成员角色、权限、加入申请与每个用户专属的 Agent</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refreshWorkspace()} disabled={busy}>
          <RefreshCw className={`w-4 h-4 mr-2 ${busy ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.filter((t) => t.show).map((t) => (
          <Button key={t.id} variant={tab === t.id ? "default" : "outline"} size="sm" onClick={() => setTab(t.id)}>
            <t.icon className="w-4 h-4 mr-2" /> {t.label}
            {!!t.count && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{t.count}</Badge>}
          </Button>
        ))}
      </div>

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {tab === "members" && <MembersTab detail={detail} busy={busy} guard={guard} />}
      {tab === "requests" && <RequestsTab busy={busy} guard={guard} />}
      {tab === "roles" && <RolesTab perms={perms} busy={busy} guard={guard} />}
      {tab === "agents" && <AgentsTab detail={detail} busy={busy} guard={guard} />}
    </div>
  );
}

function MembersTab({ detail, busy, guard }: {
  detail: ReturnType<typeof useWorkspace<never>> | any;
  busy: boolean;
  guard: (fn: () => Promise<void>) => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", roleId: "", isTenantAdmin: false });
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const manage = can("member.manage");

  if (!detail) return <Empty text="正在加载成员…" />;
  const roles: Role[] = detail.roles;
  const active = detail.members.filter((m: any) => m.status === "active");
  const inactive = detail.members.filter((m: any) => m.status !== "active");

  const add = () => guard(async () => {
    const created = await api.tenants.addMember(tenant.tenant.id, {
      email: form.email, name: form.name || undefined, roleId: form.roleId || undefined,
      isTenantAdmin: form.isTenantAdmin,
    });
    setOpen(false);
    setForm({ email: "", name: "", roleId: "", isTenantAdmin: false });
    if (created.tempPassword) setTemp({ email: created.email, password: created.tempPassword });
  });

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <div className="p-4 bg-muted/50 border-b flex flex-wrap gap-2 justify-between items-center">
          <h3 className="font-semibold text-sm">正式成员 ({active.length})</h3>
          {manage && <Button size="sm" onClick={() => setOpen(true)}><UserPlus className="w-4 h-4 mr-2" /> 添加成员</Button>}
        </div>
        <div className="divide-y">
          {active.map((m: any) => (
            <div key={m.id} className="p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30 transition-colors">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                {m.name?.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-[180px] flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  {m.name}
                  {m.isSuperAdmin && <Badge className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-300">超级管理员</Badge>}
                  {m.isTenantAdmin && <Badge variant="outline" className="text-[10px]">租户管理员</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {manage ? (
                  <select
                    value={m.roleId ?? ""}
                    onChange={(e) => guard(async () => { await api.tenants.updateMember(tenant.tenant.id, m.userId, { roleId: e.target.value }); })}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="" disabled>未分配角色</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                ) : (
                  <Badge variant="outline">{m.roleName ?? "未分配"}</Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  <Bot className="w-3 h-3 mr-1" /> 专属 Agent
                </Badge>
                {manage && !m.isSuperAdmin && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="移除成员"
                    onClick={() => { if (confirm(`移除成员 ${m.name}？其专属 Agent 也会被删除。`)) guard(async () => { await api.tenants.removeMember(tenant.tenant.id, m.userId); }); }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {inactive.length > 0 && (
            <div className="p-4 space-y-2">
              <p className="text-xs text-muted-foreground">未激活成员</p>
              {inactive.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span>{m.name} <span className="text-muted-foreground">({m.email})</span></span>
                  <Badge variant="secondary">{m.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">提示：每个成员加入租户时会自动创建专属 Agent；Agent 只能访问该成员有权限的数据。</p>

      {open && (
        <Modal title="添加成员" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">邮箱</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="member@example.com" className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium">姓名（新用户时使用）</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="可选" className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium">角色</label>
              <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className="mt-1.5 w-full h-10 rounded-md border bg-background px-2 text-sm">
                <option value="">默认（研发工程师）</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isTenantAdmin} onChange={(e) => setForm({ ...form, isTenantAdmin: e.target.checked })} />
              设为租户管理员
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={add} disabled={busy || !form.email.trim()}>添加并创建 Agent</Button>
            </div>
          </div>
        </Modal>
      )}

      {temp && (
        <Modal title="成员已创建" onClose={() => setTemp(null)}>
          <p className="text-sm text-muted-foreground">请将以下临时密码安全地交给成员，首次登录后建议立即修改。</p>
          <div className="mt-4 p-3 rounded-lg bg-muted font-mono text-sm space-y-1">
            <p>邮箱：{temp.email}</p>
            <p>临时密码：<span className="font-bold">{temp.password}</span></p>
          </div>
          <div className="flex justify-end mt-4"><Button onClick={() => setTemp(null)}>我已记录</Button></div>
        </Modal>
      )}
    </div>
  );
}

function RequestsTab({ busy, guard }: { busy: boolean; guard: (fn: () => Promise<void>) => Promise<void> }) {
  const current = useSession((s) => s.currentTenant)!;
  const detail = useWorkspace((s) => s.detail);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  if (!detail) return <Empty text="正在加载申请…" />;
  const requests = detail.joinRequests;

  if (!requests.length) return <Empty text="暂无待处理的加入申请" icon={<CheckCircle2 className="w-8 h-8 text-emerald-500" />} />;

  return (
    <Card className="p-0 overflow-hidden border-primary/20">
      <div className="p-3 px-4 bg-primary/10 border-b border-primary/10 flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-primary uppercase tracking-wider">待处理申请 ({requests.length})</span>
      </div>
      <div className="divide-y">
        {requests.map((r) => (
          <div key={r.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">{r.name?.slice(0, 2).toUpperCase()}</div>
            <div className="flex-1 min-w-[160px]">
              <p className="text-sm font-bold">{r.name}</p>
              <p className="text-[11px] text-muted-foreground">{r.email} · {new Date(r.createdAt).toLocaleString("zh-CN")}</p>
              {r.message && <p className="text-xs mt-1 text-muted-foreground bg-muted/50 rounded px-2 py-1">{r.message}</p>}
            </div>
            <select value={roleMap[r.id] ?? ""} onChange={(e) => setRoleMap({ ...roleMap, [r.id]: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-xs">
              <option value="">默认角色</option>
              {detail.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => guard(async () => { await api.tenants.rejectJoin(current.tenant.id, r.id); })}>
              <XCircle className="w-4 h-4 mr-1" /> 拒绝
            </Button>
            <Button size="sm" disabled={busy} onClick={() => guard(async () => { await api.tenants.approveJoin(current.tenant.id, r.id, roleMap[r.id]); })}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> 同意加入
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RolesTab({ perms, busy, guard }: { perms: Permission[]; busy: boolean; guard: (fn: () => Promise<void>) => Promise<void> }) {
  const current = useSession((s) => s.currentTenant)!;
  const detail = useWorkspace((s) => s.detail);
  const manage = can("role.manage");
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);

  if (!detail) return <Empty text="正在加载角色…" />;
  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of perms) (g[p.group] ||= []).push(p);
    return g;
  }, [perms]);

  const save = (role: Role | null, form: { name: string; description: string; permissions: string[] }) => guard(async () => {
    if (role) await api.tenants.updateRole(current.tenant.id, role.id, form);
    else await api.tenants.createRole(current.tenant.id, form);
    setEditing(null);
    setCreating(false);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">每个租户独立管理角色与权限。菜单权限控制可见页面，敏感操作权限控制成员、环境密钥与生产发布。</p>
        {manage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建角色</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {detail.roles.map((role) => (
          <Card key={role.id} className="p-5">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">{role.name}{role.isSystem && <Badge variant="secondary" className="text-[10px]">内置</Badge>}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
              </div>
              {manage && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(role)}><Settings2 className="w-4 h-4" /></Button>
                  {role.name !== "租户管理员" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { if (confirm(`删除角色「${role.name}」？`)) guard(async () => { await api.tenants.deleteRole(current.tenant.id, role.id); }); }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.slice(0, 12).map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px] font-normal">{perms.find((x) => x.id === p)?.label ?? p}</Badge>
              ))}
              {role.permissions.length > 12 && <Badge variant="outline" className="text-[10px]">+{role.permissions.length - 12}</Badge>}
              {!role.permissions.length && <span className="text-xs text-muted-foreground">无权限</span>}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1"><Users className="w-3 h-3" /> {detail.members.filter((m) => m.roleId === role.id).length} 名成员使用</p>
          </Card>
        ))}
      </div>

      {(editing || creating) && (
        <RoleModal
          role={editing}
          grouped={grouped}
          busy={busy}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={(form) => save(editing, form)}
        />
      )}
    </div>
  );
}

function RoleModal({ role, grouped, busy, onClose, onSave }: {
  role: Role | null;
  grouped: Record<string, Permission[]>;
  busy: boolean;
  onClose: () => void;
  onSave: (form: { name: string; description: string; permissions: string[] }) => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);

  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleGroup = (group: Permission[]) => {
    const ids = group.map((p) => p.id);
    const all = ids.every((id) => selected.includes(id));
    setSelected((s) => all ? s.filter((x) => !ids.includes(x)) : Array.from(new Set([...s, ...ids])));
  };

  return (
    <Modal title={role ? `编辑角色：${role.name}` : "新建角色"} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">角色名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <label className="text-sm font-medium">描述</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <div className="space-y-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{group}</p>
                <button className="text-xs text-primary hover:underline" onClick={() => toggleGroup(items)}>全选/取消</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {items.map((p) => (
                  <label key={p.id} className={`flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer ${selected.includes(p.id) ? "border-primary bg-primary/5" : ""}`}>
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || !name.trim()} onClick={() => onSave({ name, description, permissions: selected })}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AgentsTab({ detail, busy, guard }: { detail: any; busy: boolean; guard: (fn: () => Promise<void>) => Promise<void> }) {
  const current = useSession((s) => s.currentTenant)!;
  const user = useSession((s) => s.user);
  const [editing, setEditing] = useState<Agent | null>(null);
  const manage = isAdmin() || can("agent.manage");

  if (!detail) return <Empty text="正在加载 Agent…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <p className="text-sm text-muted-foreground">每个成员都有一个专属 Agent。Agent 负责执行研发链路工作，但只拥有该成员的权限。</p>
        {manage && (
          <Button variant="outline" size="sm" onClick={() => guard(async () => { await api.tenants.resetAgent(current.tenant.id); })}>
            <RefreshCw className="w-4 h-4 mr-2" /> 重置我的 Agent
          </Button>
        )}
      </div>
      {detail.agents.map((agent: Agent) => (
        <Card key={agent.id} className="p-5">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div className="flex gap-3">
              <div className="bg-primary/10 p-2.5 rounded-xl text-primary h-fit"><Cpu className="w-5 h-5" /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold">{agent.name}</h3>
                  <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/10 border-blue-500/20">{agent.provider}</Badge>
                  {agent.ownerUserId === user?.id && <Badge variant="secondary" className="text-[10px]">你的 Agent</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Owner: {agent.ownerName ?? "租户共享"} · Tools: {(agent.tools ?? []).join(", ")}</p>
              </div>
            </div>
            {(manage || agent.ownerUserId === user?.id) && (
              <Button variant="outline" size="sm" onClick={() => setEditing(agent)}><Settings2 className="w-4 h-4 mr-2" /> 配置</Button>
            )}
          </div>
        </Card>
      ))}

      {editing && (
        <AgentModal agent={editing} busy={busy} onClose={() => setEditing(null)} onSave={(body) => guard(async () => {
          await api.tenants.updateAgent(current.tenant.id, editing.id, body);
          setEditing(null);
        })} />
      )}
    </div>
  );
}

function AgentModal({ agent, busy, onClose, onSave }: {
  agent: Agent; busy: boolean; onClose: () => void;
  onSave: (body: Partial<Agent> & { systemPrompt?: string }) => void;
}) {
  const [form, setForm] = useState({
    name: agent.name,
    provider: agent.provider,
    model: agent.model ?? "",
    description: agent.description ?? "",
    systemPrompt: agent.systemPrompt ?? "",
  });
  return (
    <Modal title={`配置 Agent：${agent.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">名称</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" />
          </div>
          <div>
            <label className="text-sm font-medium">运行时</label>
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as Agent["provider"] })} className="mt-1.5 w-full h-10 rounded-md border bg-background px-2 text-sm">
              <option value="auto">自动（跟随平台配置）</option>
              <option value="mock">Mock（离线演示）</option>
              <option value="claude">Claude Code</option>
              <option value="opencode">opencode</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">模型（可选）</label>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="mt-1.5" list="agent-model-options" placeholder={modelPlaceholder(form.provider)} />
          <datalist id="agent-model-options">
            {(MODEL_SUGGESTIONS[form.provider] ?? []).map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
        <div>
          <label className="text-sm font-medium">描述</label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" />
        </div>
        <div>
          <label className="text-sm font-medium">系统提示词</label>
          <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={8} className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring" />
          <p className="text-[11px] text-muted-foreground mt-1">提示词中应强调租户隔离、人工审批闸门，以及不得自行读取环境密码。</p>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={() => onSave(form)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <Card className="p-10 flex flex-col items-center justify-center text-center gap-3">
      {icon ?? <KeyRound className="w-8 h-8 text-muted-foreground/50" />}
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}
