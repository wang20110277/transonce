import { useState } from "react";
import {
  Server, Plus, Pencil, Trash2, Eye, EyeOff, Loader2, ShieldAlert, KeyRound,
  Copy, Globe, RefreshCw, Lock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, Pill, Select, Textarea, formatDate, statusLabel } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { Environment } from "../types";

export function Environments() {
  const tenant = useSession((s) => s.currentTenant)!;
  const environments = useWorkspace((s) => s.environments);
  const [editing, setEditing] = useState<Environment | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [osFilter, setOsFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tid = tenant.tenant.id;
  const manage = can("env.manage");
  const canRead = can("secret.read");
  const osOf = (env: Environment) => env.osType ?? "linux";
  const shown = osFilter === "all" ? environments : environments.filter((e) => osOf(e) === osFilter);

  const reveal = async (env: Environment) => {
    setBusy(env.id);
    setError(null);
    try {
      const res = await api.environments.reveal(tid, env.id);
      setRevealed((r) => ({ ...r, [env.id]: res.password ?? "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (env: Environment) => {
    if (!confirm(`删除环境「${env.name}」？关联的监控与部署记录不会自动删除。`)) return;
    try {
      await api.environments.remove(tid, env.id);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="环境配置"
        description="环境 IP、账号和密码由人工维护并加密存储。Agent 永远读取不到明文密钥；查看密钥需要单独权限并会记录审计日志。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            {manage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建环境</Button>}
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-3 flex gap-2 text-xs text-amber-800 dark:text-amber-300">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <p>安全约定：环境凭证以 AES/HMAC 密钥加密落库；接口默认只返回掩码（••••••XX）。生产部署、查看密钥、修改环境均需要独立的敏感操作权限。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>操作系统</span>
        <Select id="env-os-filter" value={osFilter} onChange={setOsFilter}>
          <option value="all">全部</option>
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
        </Select>
      </div>

      {!environments.length ? (
        <EmptyState icon={Server} title="还没有配置环境" description={manage ? "创建开发/测试/生产环境，供流水线部署与健康监控使用。" : "请联系租户管理员配置环境。"} action={
          manage ? <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 新建环境</Button> : undefined
        } />
      ) : !shown.length ? (
        <EmptyState icon={Server} title={`没有 ${statusLabel[osFilter]} 环境`} description="把筛选改回「全部」可以查看所有环境。" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map((env) => (
            <Card key={env.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${env.kind === "production" ? "bg-rose-500/10 text-rose-600" : env.kind === "test" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    {/* 空间不够时让标识整体换到下一行，而不是把环境名从中间拆开。 */}
                    <p className="font-semibold flex flex-wrap items-center gap-2">{env.name}
                      <Pill tone={env.kind === "production" ? "rose" : env.kind === "test" ? "green" : "blue"}>{env.kind}</Pill>
                      <Pill tone="gray">{statusLabel[osOf(env)]}</Pill>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">创建于 {formatDate(env.createdAt)}</p>
                  </div>
                </div>
                {manage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`编辑环境 ${env.name}`} onClick={() => setEditing(env)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(env)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">访问地址</span>
                  {env.baseUrl ? <a href={env.baseUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs truncate">{env.baseUrl}</a> : <span className="text-xs text-muted-foreground">未配置</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">主机 IP</span>
                  <span className="text-xs font-mono">{env.ip || "未配置"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">账号</span>
                  <span className="text-xs font-mono">{env.username || "未配置"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs w-16">密码</span>
                  {revealed[env.id] !== undefined ? (
                    <span className="text-xs font-mono flex items-center gap-1">
                      {revealed[env.id] || "未设置"}
                      {revealed[env.id] && (
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard?.writeText(revealed[env.id])}><Copy className="w-3 h-3" /></button>
                      )}
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => setRevealed((r) => { const n = { ...r }; delete n[env.id]; return n; })}><EyeOff className="w-3 h-3" /></button>
                    </span>
                  ) : (
                    <span className="text-xs font-mono flex items-center gap-1.5">
                      {env.passwordMasked || "未设置"}
                      {canRead && env.hasPassword && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={busy === env.id} onClick={() => reveal(env)} title="查看密钥（会记录审计日志）">
                          {busy === env.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {env.config && Object.keys(env.config).length > 0 && (
                <div className="mt-3 pt-3 border-t flex flex-wrap gap-1.5">
                  {Object.entries(env.config).map(([k, v]) => (
                    <Pill key={k} tone="gray">{k}: {String(v)}</Pill>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <EnvironmentModal env={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={async () => { setCreating(false); setEditing(null); await refreshWorkspace(); }} />
      )}
    </div>
  );
}

function EnvironmentModal({ env, onClose, onSaved }: { env: Environment | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: env?.name ?? "",
    kind: env?.kind ?? "test",
    osType: env?.osType ?? "linux",
    baseUrl: env?.baseUrl ?? "",
    ip: env?.ip ?? "",
    username: env?.username ?? "",
    password: "",
    note: (env?.config?.note as string) ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        kind: form.kind,
        osType: form.osType,
        baseUrl: form.baseUrl || null,
        ip: form.ip || null,
        username: form.username || null,
        password: form.password || undefined,
        config: form.note ? { note: form.note } : {},
      };
      if (env) await api.environments.update(tenant.tenant.id, env.id, body);
      else await api.environments.create(tenant.tenant.id, body);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={env ? `编辑环境：${env.name}` : "新建环境"} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">环境名称</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="例如：预发环境" />
          </div>
          <div>
            <label className="text-sm font-medium">环境类型</label>
            <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v as Environment["kind"] })} className="mt-1.5 w-full h-10">
              <option value="dev">开发</option>
              <option value="test">测试</option>
              <option value="staging">预发</option>
              <option value="production">生产</option>
            </Select>
          </div>
          <div>
            <label htmlFor="env-os" className="text-sm font-medium">操作系统</label>
            <Select id="env-os" value={form.osType} onChange={(v) => setForm({ ...form, osType: v as "linux" | "windows" })} className="mt-1.5 w-full h-10">
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">访问地址</label>
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="mt-1.5" placeholder="https://app.example.com 或健康检查 URL" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">主机 IP</label>
            <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} className="mt-1.5" placeholder="10.0.0.12" />
          </div>
          <div>
            <label className="text-sm font-medium">账号</label>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="mt-1.5" placeholder="deploy" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">密码 {env && <span className="text-muted-foreground font-normal">（留空表示不修改）</span>}</label>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1.5" placeholder={env ? "••••••（保持不变）" : "加密存储，接口只返回掩码"} />
        </div>
        <div>
          <label className="text-sm font-medium">备注</label>
          <Textarea value={form.note} onChange={(v) => setForm({ ...form, note: v })} rows={2} placeholder="用途、负责人、维护窗口等" />
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
