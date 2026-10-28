import { useState } from "react";
import {
  FolderKanban, Plus, Server, GitBranch, Trash2, ChevronDown, ChevronRight,
  Boxes, Loader2, Globe,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, Select, Textarea, formatDate } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { GitRepo, System } from "../types";

export function Projects() {
  const tenant = useSession((s) => s.currentTenant)!;
  const projects = useWorkspace((s) => s.projects);
  const [open, setOpen] = useState<string | null>(null);
  const [systems, setSystems] = useState<Record<string, System[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tid = tenant.tenant.id;

  const loadSystems = async (pid: string) => {
    setLoading(pid);
    try {
      const list = await api.projects.systems(tid, pid);
      setSystems((s) => ({ ...s, [pid]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  const toggle = async (pid: string) => {
    if (open === pid) {
      setOpen(null);
      return;
    }
    setOpen(pid);
    if (!systems[pid]) await loadSystems(pid);
  };

  const createProject = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.projects.create(tid, form);
      setCreateOpen(false);
      setForm({ name: "", description: "" });
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeProject = async (pid: string) => {
    if (!confirm("删除项目会级联删除其系统与代码库关联，确认继续？")) return;
    try {
      await api.projects.remove(tid, pid);
      if (open === pid) setOpen(null);
      await refreshWorkspace();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="项目与系统"
        description="以项目 → 系统 → 代码库的层级组织研发资产，需求、制品与流水线都可以关联到具体项目。"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建项目</Button>}
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="还没有项目"
          description="创建第一个项目，把会议、需求与交付流水线组织起来。"
          action={<Button size="sm" className="mt-2" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 新建项目</Button>}
        />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="p-5 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggle(p.id)}>
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <FolderKanban className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    <Badge variant="secondary" className="text-[10px]">{p.systemCount ?? 0} 个系统</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.description || "暂无描述"} · 创建于 {formatDate(p.createdAt)}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); removeProject(p.id); }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
                {open === p.id ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </div>

              {open === p.id && (
                <div className="border-t bg-muted/20 p-5 space-y-3">
                  {loading === p.id ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> 加载系统…</div>
                  ) : (
                    <>
                      <SystemList
                        tid={tid}
                        projectId={p.id}
                        systems={systems[p.id] ?? []}
                        onChanged={async () => { await loadSystems(p.id); await refreshWorkspace(); }}
                      />
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal title="新建项目" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">项目名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：全渠道零售电商平台" className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Textarea value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={3} placeholder="项目目标、范围与关键干系人" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={createProject} disabled={busy || !form.name.trim()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SystemList({ tid, projectId, systems, onChanged }: {
  tid: string;
  projectId: string;
  systems: System[];
  onChanged: () => Promise<void>;
}) {
  const syncedRepos = useWorkspace((s) => s.repos);
  const [addSystem, setAddSystem] = useState(false);
  const [systemForm, setSystemForm] = useState({ name: "", description: "" });
  const [addCodebaseFor, setAddCodebaseFor] = useState<System | null>(null);
  const [pickedRepoId, setPickedRepoId] = useState("");
  const [codeForm, setCodeForm] = useState({ name: "", repoUrl: "", language: "TypeScript", defaultBranch: "main" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2"><Boxes className="w-4 h-4" /> 系统 ({systems.length})</h4>
        <Button size="sm" variant="outline" onClick={() => setAddSystem(true)}><Plus className="w-4 h-4 mr-2" /> 添加系统</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {systems.length === 0 && <p className="text-sm text-muted-foreground py-3">暂无系统，先添加一个系统并关联代码库。</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {systems.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-sm flex items-center gap-2"><Server className="w-4 h-4 text-muted-foreground" /> {s.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.description || "暂无描述"}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="添加代码库" onClick={() => setAddCodebaseFor(s)}><Plus className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="删除系统"
                  onClick={() => { if (confirm(`删除系统「${s.name}」？`)) guard(async () => { await api.projects.removeSystem(tid, s.id); }); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {(s.codebases ?? []).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs rounded-md border bg-background px-2.5 py-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium" title={c.repoPath ?? c.name}>{c.repoPath ?? c.name}</span>
                  {c.repoPath && <Badge variant="secondary" className="text-[10px]">GitLab</Badge>}
                  {c.language && <Badge variant="secondary" className="text-[10px]">{c.language}</Badge>}
                  {c.repoUrl && (
                    <a href={c.repoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Globe className="w-3 h-3" /> 仓库
                    </a>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive ml-auto" onClick={() => guard(async () => { await api.projects.removeCodebase(tid, c.id); })}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              {!s.codebases?.length && <p className="text-[11px] text-muted-foreground">尚未关联代码库</p>}
            </div>
          </Card>
        ))}
      </div>

      {addSystem && (
        <Modal title="添加系统" onClose={() => setAddSystem(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">系统名称</label>
              <Input value={systemForm.name} onChange={(e) => setSystemForm({ ...systemForm, name: e.target.value })} className="mt-1.5" placeholder="例如：订单中心" />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Textarea value={systemForm.description} onChange={(v) => setSystemForm({ ...systemForm, description: v })} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAddSystem(false)}>取消</Button>
              <Button disabled={busy || !systemForm.name.trim()} onClick={() => guard(async () => {
                await api.projects.createSystem(tid, projectId, systemForm);
                setAddSystem(false); setSystemForm({ name: "", description: "" });
              })}>添加</Button>
            </div>
          </div>
        </Modal>
      )}

      {addCodebaseFor && (
        <Modal title={`为「${addCodebaseFor.name}」添加代码库`} onClose={() => setAddCodebaseFor(null)}>
          <AddCodebaseForm
            tid={tid}
            system={addCodebaseFor}
            linkedPaths={new Set((addCodebaseFor.codebases ?? []).map((c) => c.repoPath).filter(Boolean) as string[])}
            syncedRepos={syncedRepos}
            pickedRepoId={pickedRepoId}
            setPickedRepoId={setPickedRepoId}
            codeForm={codeForm}
            setCodeForm={setCodeForm}
            busy={busy}
            guard={guard}
            onClose={() => setAddCodebaseFor(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function AddCodebaseForm({
  tid, system, linkedPaths, syncedRepos, pickedRepoId, setPickedRepoId,
  codeForm, setCodeForm, busy, guard, onClose,
}: {
  tid: string;
  system: System;
  linkedPaths: Set<string>;
  syncedRepos: GitRepo[];
  pickedRepoId: string;
  setPickedRepoId: (v: string) => void;
  codeForm: { name: string; repoUrl: string; language: string; defaultBranch: string };
  setCodeForm: (f: { name: string; repoUrl: string; language: string; defaultBranch: string }) => void;
  busy: boolean;
  guard: (fn: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const picked = syncedRepos.find((r) => r.id === pickedRepoId) ?? null;
  const pickable = syncedRepos.filter((r) => !linkedPaths.has(r.path));

  const pick = (id: string) => {
    setPickedRepoId(id);
    const repo = syncedRepos.find((r) => r.id === id);
    if (repo) {
      setCodeForm({
        name: repo.name,
        repoUrl: repo.webUrl ?? "",
        language: codeForm.language,
        defaultBranch: repo.defaultBranch ?? "main",
      });
    }
  };

  return (
    <div className="space-y-3">
      {pickable.length > 0 && (
        <div>
          <label className="text-sm font-medium">从代码管理选取</label>
          <Select value={pickedRepoId} onChange={(v) => pick(v)} className="mt-1.5 w-full h-10">
            <option value="">手动填写…</option>
            {pickable.map((r) => (
              <option key={r.id} value={r.id}>{r.path}（{r.connectionName}）</option>
            ))}
          </Select>
          {picked && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              名称 / 仓库地址 / 默认分支已按「{picked.path}」自动带出，仍可在下方微调。
            </p>
          )}
        </div>
      )}
      {pickable.length === 0 && syncedRepos.length > 0 && (
        <p className="text-xs text-muted-foreground">该系统已关联全部同步的代码库，可切换手动填写。</p>
      )}
      {syncedRepos.length === 0 && (
        <p className="text-xs text-muted-foreground">
          尚无可选取的代码库——管理员在「代码管理」同步 GitLab 后，这里可以直接选取。
        </p>
      )}
      <div>
        <label className="text-sm font-medium">代码库名称</label>
        <Input value={codeForm.name} onChange={(e) => setCodeForm({ ...codeForm, name: e.target.value })} className="mt-1.5" placeholder="例如：order-service" />
      </div>
      <div>
        <label className="text-sm font-medium">仓库地址</label>
        <Input value={codeForm.repoUrl} onChange={(e) => setCodeForm({ ...codeForm, repoUrl: e.target.value })} className="mt-1.5" placeholder="https://github.com/org/repo" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">语言</label>
          <Input value={codeForm.language} onChange={(e) => setCodeForm({ ...codeForm, language: e.target.value })} className="mt-1.5" />
        </div>
        <div>
          <label className="text-sm font-medium">默认分支</label>
          <Input value={codeForm.defaultBranch} onChange={(e) => setCodeForm({ ...codeForm, defaultBranch: e.target.value })} className="mt-1.5" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button disabled={busy || (!pickedRepoId && !codeForm.name.trim())} onClick={() => guard(async () => {
          await api.projects.createCodebase(tid, system.id, {
            name: codeForm.name,
            repoId: pickedRepoId || undefined,
            repoUrl: codeForm.repoUrl || undefined,
            language: codeForm.language || undefined,
            defaultBranch: codeForm.defaultBranch || undefined,
          });
          onClose();
          setPickedRepoId("");
          setCodeForm({ name: "", repoUrl: "", language: "TypeScript", defaultBranch: "main" });
        })}>添加</Button>
      </div>
    </div>
  );
}
