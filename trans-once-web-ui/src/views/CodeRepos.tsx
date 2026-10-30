import { useEffect, useState } from "react";
import {
  GitBranch, Gitlab, Plus, Pencil, Trash2, Loader2, RefreshCw, ShieldAlert,
  ExternalLink, Search, Check, X, KeyRound,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, Pill, Select, Textarea, formatDate, timeAgo } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { GitlabConnection, GitRepo, RepoAccessRequest, RepoAccessRole } from "../types";
import { REPO_ROLE_LABELS } from "../types";

const ROLE_IDS: RepoAccessRole[] = ["guest", "reporter", "developer", "maintainer"];

function roleTone(role: string) {
  return role === "maintainer" ? "violet" : role === "developer" ? "green" : role === "reporter" ? "blue" : "gray";
}

export function CodeRepos() {
  const tenant = useSession((s) => s.currentTenant)!;
  const connections = useWorkspace((s) => s.connections);
  const repos = useWorkspace((s) => s.repos);
  const repoRequests = useWorkspace((s) => s.repoRequests);
  const myRepoRequests = useWorkspace((s) => s.myRepoRequests);
  const [search, setSearch] = useState("");
  const [connFilter, setConnFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GitlabConnection | null>(null);
  const [applying, setApplying] = useState<GitRepo | null>(null);
  const [detail, setDetail] = useState<GitRepo | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [approveRole, setApproveRole] = useState<Record<string, RepoAccessRole>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tid = tenant.tenant.id;
  const manage = can("repo.manage");
  const canApprove = can("repo.approve");
  const pending = repoRequests.filter((r) => r.status === "pending");

  const openDetail = async (repo: GitRepo) => {
    setError(null);
    try {
      setDetail(await api.coderepos.repo(tid, repo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sync = async (conn: GitlabConnection) => {
    setSyncing(conn.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.coderepos.syncConnection(tid, conn.id);
      setNotice(`已从 GitLab 同步 ${res.count} 个代码库`);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(null);
    }
  };

  const removeConnection = async (conn: GitlabConnection) => {
    if (!confirm(`删除连接「${conn.name}」？已同步的代码库与权限记录会一并删除。`)) return;
    try {
      await api.coderepos.removeConnection(tid, conn.id);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const decide = async (req: RepoAccessRequest, action: "approve" | "reject") => {
    setBusy(req.id);
    setError(null);
    try {
      if (action === "approve") {
        await api.coderepos.approve(tid, req.id, { role: approveRole[req.id] ?? req.role });
      } else {
        await api.coderepos.reject(tid, req.id);
      }
      await refreshWorkspace();
      if (detail) setDetail(await api.coderepos.repo(tid, detail.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (repo: GitRepo, userId: string, name?: string | null) => {
    if (!confirm(`撤销 ${name ?? "该成员"} 在 ${repo.path} 上的权限？`)) return;
    setBusy(userId);
    try {
      await api.coderepos.revoke(tid, repo.id, userId);
      setDetail(await api.coderepos.repo(tid, repo.id));
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const visible = repos
    .filter((r) => (connFilter === "all" ? true : r.connectionId === connFilter))
    .filter((r) => {
      const q = search.trim().toLowerCase();
      return !q || r.path.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q);
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="代码管理"
        description="关联团队 GitLab，浏览全部代码库，按角色（访客/报告者/开发者/管理员）申请权限，由管理员审批并记录审计日志。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>
            {manage && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 关联 GitLab</Button>}
          </>
        }
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-lg px-4 py-2">{notice}</div>}

      <div className="rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 p-3 flex gap-2 text-xs text-blue-800 dark:text-blue-300">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <p>
          访问令牌加密存储，接口只返回掩码。审批通过后平台会记录授权并提示仓库管理员在 GitLab 中开通对应角色。
        </p>
      </div>

      {/* GitLab 连接 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">GitLab 连接</h2>
        {!connections.length ? (
          <EmptyState
            icon={Gitlab}
            title="还没有关联 GitLab"
            description={manage ? "关联后可同步浏览该 GitLab 下的所有代码库。" : "请联系租户管理员或 DevOps 关联团队的 GitLab。"}
            action={manage ? <Button size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> 关联 GitLab</Button> : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {connections.map((conn) => (
              <Card key={conn.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center shrink-0">
                      <Gitlab className="w-4.5 h-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold flex items-center gap-2 truncate">
                        {conn.name}
                        {conn.status === "error" && <Pill tone="rose">异常</Pill>}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {conn.baseUrl}{conn.account ? ` · 令牌身份 ${conn.account}` : ""}
                      </p>
                    </div>
                  </div>
                  {manage && (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={syncing === conn.id} title="同步代码库" onClick={() => sync(conn)}>
                        {syncing === conn.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(conn)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeConnection(conn)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Pill tone="gray">{conn.repoCount ?? 0} 个代码库</Pill>
                  <Pill tone="gray"><KeyRound className="w-3 h-3 mr-1 inline" />{conn.hasToken ? `令牌 ${conn.tokenMasked}` : "未配置令牌"}</Pill>
                  <span className="text-muted-foreground">上次同步 {conn.lastSyncAt ? timeAgo(conn.lastSyncAt) : "从未"}</span>
                </div>
                {conn.status === "error" && conn.lastError && (
                  <p className="mt-2 text-[11px] text-destructive truncate" title={conn.lastError}>{conn.lastError}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 待审批申请 */}
      {canApprove && pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">待审批的权限申请（{pending.length}）</h2>
          <Card className="divide-y">
            {pending.map((req) => (
              <div key={req.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {req.userName ?? req.userEmail}
                    <span className="text-muted-foreground font-normal"> 申请 </span>
                    <span className="font-mono text-xs">{req.repoPath}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {req.createdAt && `提交于 ${formatDate(req.createdAt)}`}{req.reason ? ` · ${req.reason}` : ""}
                  </p>
                </div>
                <Select
                  value={approveRole[req.id] ?? req.role}
                  onChange={(v) => setApproveRole((s) => ({ ...s, [req.id]: v as RepoAccessRole }))}
                  className="h-9 w-28"
                >
                  {ROLE_IDS.map((r) => <option key={r} value={r}>{REPO_ROLE_LABELS[r]}</option>)}
                </Select>
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-9" disabled={busy === req.id} onClick={() => decide(req, "approve")}>
                    {busy === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} 通过
                  </Button>
                  <Button size="sm" variant="outline" className="h-9" disabled={busy === req.id} onClick={() => decide(req, "reject")}>
                    <X className="w-4 h-4 mr-1" /> 驳回
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* 代码库列表 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground mr-auto">代码库（{visible.length}）</h2>
          {connections.length > 1 && (
            <Select value={connFilter} onChange={(v) => setConnFilter(v)} className="h-9 w-44">
              <option value="all">全部连接</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索路径 / 描述" className="pl-8 h-9 w-56" />
          </div>
        </div>
        {!repos.length ? (
          <EmptyState
            icon={GitBranch}
            title="暂无代码库"
            description={manage ? "在连接卡片上点击同步，拉取 GitLab 下的代码库。" : "管理员尚未同步代码库。"}
          />
        ) : !visible.length ? (
          <EmptyState icon={Search} title="没有匹配的代码库" description="换个关键字试试。" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {visible.map((repo) => (
              <Card key={repo.id} className="p-4 hover:border-primary/40 transition-colors">
                <button className="w-full text-left" onClick={() => openDetail(repo)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${repo.archived ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                        <GitBranch className="w-4.5 h-4.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold font-mono text-sm truncate">{repo.path}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{repo.description || "暂无描述"}</p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {repo.myAccess ? (
                        <Pill tone={roleTone(repo.myAccess.role)}>{REPO_ROLE_LABELS[repo.myAccess.role]}</Pill>
                      ) : repo.myRequest ? (
                        <Pill tone="amber">审批中 · {REPO_ROLE_LABELS[repo.myRequest.role]}</Pill>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {repo.visibility && <Pill tone={repo.visibility === "public" ? "green" : repo.visibility === "internal" ? "blue" : "gray"}>
                      {repo.visibility === "public" ? "公开" : repo.visibility === "internal" ? "内部" : "私有"}
                    </Pill>}
                    <Pill tone="gray">{repo.defaultBranch || "main"}</Pill>
                    <span className="text-muted-foreground">
                      最近活动 {repo.lastActivityAt ? timeAgo(repo.lastActivityAt) : "未知"} · {repo.connectionName}
                    </span>
                  </div>
                </button>
                {!repo.myAccess && !repo.myRequest && (
                  <div className="mt-3 pt-3 border-t flex justify-end">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setApplying(repo)}>
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" /> 申请权限
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 我的申请记录 */}
      {myRepoRequests.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">我的申请记录</h2>
          <Card className="p-0">
            <div className="divide-y">
              {myRepoRequests.slice(0, 8).map((req) => (
                <div key={req.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span className="font-mono truncate flex-1">{req.repoPath}</span>
                  <Pill tone={roleTone(req.role)}>{REPO_ROLE_LABELS[req.role]}</Pill>
                  <Pill tone={req.status === "approved" ? "green" : req.status === "pending" ? "amber" : "rose"}>
                    {req.status === "approved" ? "已通过" : req.status === "pending" ? "审批中" : "已驳回"}
                  </Pill>
                  <span className="text-muted-foreground w-28 text-right shrink-0">{req.reviewedAt ? timeAgo(req.reviewedAt) : timeAgo(req.createdAt)}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {(creating || editing) && (
        <ConnectionModal
          conn={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await refreshWorkspace(); }}
        />
      )}
      {applying && (
        <ApplyModal repo={applying} onClose={() => setApplying(null)} onSaved={async () => { setApplying(null); await refreshWorkspace(); }} />
      )}
      {detail && (
        <Modal title={`代码库：${detail.path}`} onClose={() => setDetail(null)} wide>
          <RepoDetail repo={detail} canApprove={canApprove} busy={busy} onApply={() => { setDetail(null); setApplying(repos.find((r) => r.id === detail.id) ?? detail); }} onRevoke={(uid, name) => revoke(detail, uid, name)} />
        </Modal>
      )}
    </div>
  );
}

function RepoDetail({
  repo, canApprove, busy, onApply, onRevoke,
}: {
  repo: GitRepo;
  canApprove: boolean;
  busy: string | null;
  onApply: () => void;
  onRevoke: (userId: string, name?: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><p className="text-xs text-muted-foreground">所属连接</p><p>{repo.connectionName}</p></div>
        <div><p className="text-xs text-muted-foreground">默认分支</p><p className="font-mono">{repo.defaultBranch || "main"}</p></div>
        <div className="col-span-2"><p className="text-xs text-muted-foreground">描述</p><p>{repo.description || "暂无"}</p></div>
        {repo.webUrl && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">仓库地址</p>
            <a href={repo.webUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs font-mono inline-flex items-center gap-1">
              {repo.webUrl} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
        <div><p className="text-xs text-muted-foreground">最近活动</p><p>{repo.lastActivityAt ? formatDate(repo.lastActivityAt) : "未知"}</p></div>
        <div><p className="text-xs text-muted-foreground">我的权限</p>
          <p>{repo.myAccess ? <Pill tone={roleTone(repo.myAccess.role)}>{REPO_ROLE_LABELS[repo.myAccess.role]}</Pill> : repo.myRequest ? <Pill tone="amber">审批中 · {REPO_ROLE_LABELS[repo.myRequest.role]}</Pill> : <span className="text-muted-foreground text-xs">无</span>}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">已授权成员（{repo.members?.length ?? 0}）</p>
          {!repo.myAccess && !repo.myRequest && (
            <Button size="sm" variant="outline" className="h-8" onClick={onApply}><KeyRound className="w-3.5 h-3.5 mr-1.5" /> 申请权限</Button>
          )}
        </div>
        {!repo.members?.length ? (
          <p className="text-xs text-muted-foreground">还没有成员获得此代码库的权限。</p>
        ) : (
          <div className="rounded-lg border divide-y">
            {repo.members.map((m) => (
              <div key={m.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                <span className="font-medium flex-1 truncate">{m.userName ?? m.userEmail}</span>
                <Pill tone={roleTone(m.role)}>{REPO_ROLE_LABELS[m.role]}</Pill>
                <span className="text-muted-foreground w-24 text-right">{m.grantedAt ? timeAgo(m.grantedAt) : ""}</span>
                {canApprove && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={busy === m.userId} title="撤销权限" onClick={() => onRevoke(m.userId, m.userName)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionModal({ conn, onClose, onSaved }: { conn: GitlabConnection | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({
    name: conn?.name ?? "",
    baseUrl: conn?.baseUrl ?? "",
    token: "",
    insecureTls: conn?.insecureTls ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        baseUrl: form.baseUrl,
        insecureTls: form.insecureTls,
      };
      if (conn) await api.coderepos.updateConnection(tenant.tenant.id, conn.id, { ...body, token: form.token || undefined });
      else await api.coderepos.createConnection(tenant.tenant.id, { ...body, token: form.token });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={conn ? `编辑连接：${conn.name}` : "关联 GitLab"} onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">连接名称</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="例如：公司 GitLab" />
        </div>
        <div>
          <label className="text-sm font-medium">GitLab 地址</label>
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="mt-1.5" placeholder="https://gitlab.example.com" />
        </div>
        <div>
          <label className="text-sm font-medium">
            访问令牌 <span className="text-muted-foreground font-normal">（建议只读 read_api 权限）</span>
          </label>
          <Input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className="mt-1.5"
            placeholder={conn ? `当前 ${conn.tokenMasked ?? "未配置"}，留空保持不变` : "加密存储，接口只返回掩码"} />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.insecureTls} onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })} className="accent-primary" />
          自签名 / IP 证书（跳过 TLS 校验，仅影响对该地址的出站请求）
        </label>
        <p className="text-[11px] text-muted-foreground">
          保存时会调用 GitLab <code>/user</code> 接口验证地址与令牌，同步时拉取该账号可见的代码库列表。
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy || !form.name.trim() || !form.baseUrl.trim() || (!conn && !form.token.trim())}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存并测试"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ApplyModal({ repo, onClose, onSaved }: { repo: GitRepo; onClose: () => void; onSaved: () => Promise<void> }) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [role, setRole] = useState<RepoAccessRole>("developer");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.coderepos.requestAccess(tenant.tenant.id, repo.id, { role, reason: reason || undefined });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`申请权限：${repo.path}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">申请角色</label>
          <Select value={role} onChange={(v) => setRole(v as RepoAccessRole)} className="mt-1.5 w-full h-10">
            {ROLE_IDS.map((r) => <option key={r} value={r}>{REPO_ROLE_LABELS[r]}</option>)}
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            访客：只读议题 · 报告者：读代码 · 开发者：读写分支与合并请求 · 管理员：维护成员、保护分支与设置
          </p>
        </div>
        <div>
          <label className="text-sm font-medium">申请理由</label>
          <Textarea value={reason} onChange={(v) => setReason(v)} rows={3} className="mt-1.5" placeholder="例如：接入购物车需求的前端联调" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "提交申请"}</Button>
        </div>
      </div>
    </Modal>
  );
}
