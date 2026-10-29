import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Plus, ChevronRight, Users, Shield, Search, CheckCircle2,
  Clock, LogOut, Loader2, ArrowLeft, Globe,
} from "lucide-react";
import { motion } from "motion/react";
import { api } from "../services/api";
import { logout, reloadMemberships, selectTenant, useSession } from "../lib/session";

type DiscoverItem = {
  tenant: { id: string; name: string; slug: string; description?: string | null; logo?: string | null };
  memberCount: number;
  myRequestStatus: string | null;
};

export function TeamSelect() {
  const user = useSession((s) => s.user);
  const memberships = useSession((s) => s.memberships);
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DiscoverItem | null>(null);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDiscover = async (query = "") => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tenants.discover(query);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "discover") loadDiscover(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const apply = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await api.tenants.requestJoin(selected.tenant.id, { message });
      setSelected(null);
      setMessage("");
      setToast("加入申请已发送，等待租户管理员审批");
      await loadDiscover(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.tenants.create({ name: form.name, description: form.description });
      await reloadMemberships();
      selectTenant(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 flex items-start justify-center pt-16">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[860px]">
        <div className="flex flex-wrap justify-between items-start gap-4 mb-6 px-1">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">选择或加入团队</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {user?.name}，你好。你已加入 {memberships.length} 个租户{user?.isSuperAdmin ? "（超级管理员可见全部租户）" : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground">
            <LogOut className="w-4 h-4 mr-2" /> 退出登录
          </Button>
        </div>

        <div className="flex gap-1 p-1 bg-muted rounded-lg mb-6 w-fit">
          <button onClick={() => setTab("mine")} className={`px-4 py-1.5 text-sm rounded-md ${tab === "mine" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>我的团队</button>
          <button onClick={() => setTab("discover")} className={`px-4 py-1.5 text-sm rounded-md ${tab === "discover" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>发现团队</button>
        </div>

        {toast && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> {toast}
          </div>
        )}
        {error && <div className="mb-4 text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

        {tab === "mine" ? (
          <div className="grid grid-cols-1 gap-4">
            {memberships.map((m) => (
              <Card key={m.tenant.id} className="group p-5 cursor-pointer hover:shadow-xl hover:shadow-primary/5 transition-all" onClick={() => selectTenant(m)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold truncate">{m.tenant.name}</h3>
                      <Badge variant="secondary" className="text-[10px] bg-primary/5 text-primary border-none">已加入</Badge>
                      {m.isTenantAdmin && <Badge variant="outline" className="text-[10px]">管理员</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" />{m.role?.name ?? "未分配角色"}</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{m.memberCount ?? 0} 名成员</span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </div>
              </Card>
            ))}
            {user?.isSuperAdmin && (
              <Card className="border-dashed border-2 p-5 flex flex-col items-center justify-center gap-2 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => setCreateOpen(true)}>
                <div className="bg-background p-2.5 rounded-full shadow-sm"><Plus className="w-5 h-5 text-primary" /></div>
                <div className="text-center">
                  <h3 className="font-semibold">创建新租户</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">仅超级管理员可创建</p>
                </div>
              </Card>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadDiscover(q)} placeholder="搜索租户名称或描述…" className="pl-9" />
              </div>
              <Button variant="outline" onClick={() => loadDiscover(q)} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "搜索"}
              </Button>
            </div>

            {items.map((item) => (
              <Card key={item.tenant.id} className="p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="w-11 h-11 bg-muted rounded-xl flex items-center justify-center"><Building2 className="w-5 h-5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-[200px]">
                    <h3 className="font-bold">{item.tenant.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.tenant.description || "暂无描述"} · {item.memberCount} 名成员</p>
                  </div>
                  {item.myRequestStatus === "pending" ? (
                    <Badge variant="outline" className="text-amber-600 border-amber-300"><Clock className="w-3 h-3 mr-1" />待审批</Badge>
                  ) : item.myRequestStatus === "rejected" ? (
                    <Badge variant="outline" className="text-muted-foreground">上次申请被拒绝</Badge>
                  ) : (
                    <Button size="sm" onClick={() => { setSelected(item); setMessage(""); }}>申请加入</Button>
                  )}
                </div>
              </Card>
            ))}
            {!loading && items.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-10">没有找到可加入的租户</p>
            )}
          </div>
        )}

        <div className="mt-10 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Globe className="w-3 h-3" /> 租户之间数据完全隔离，权限由各租户独立管理
        </div>
      </motion.div>

      {selected && (
        <Modal title={`申请加入「${selected.tenant.name}」`} onClose={() => setSelected(null)}>
          <p className="text-sm text-muted-foreground mb-4">申请将提交给该租户管理员。管理员会为你分配角色，并自动创建你的专属 Agent。</p>
          <label className="text-sm font-medium">申请说明（可选）</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" placeholder="例如：我是前端工程师，希望加入产品研发组" />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setSelected(null)}>取消</Button>
            <Button onClick={apply} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "发送申请"}</Button>
          </div>
        </Modal>
      )}

      {createOpen && (
        <Modal title="创建租户" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">租户名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：智能交付中心" className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <p className="text-xs text-muted-foreground">创建后将内置 6 个角色模板（管理员/产品/研发/测试/DevOps/只读），你将成为租户管理员。</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={create} disabled={creating || !form.name.trim()}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建并进入"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className={`bg-card border rounded-xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[88vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="w-4 h-4" /></Button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
}
