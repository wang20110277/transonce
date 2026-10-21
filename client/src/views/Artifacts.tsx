import { useMemo, useState } from "react";
import {
  Package, Rocket, Trash2, FileCode2, ChevronDown, ChevronRight, Copy,
  ShieldAlert, Loader2, RefreshCw, GitBranch, Boxes,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, StatusPill, Select, formatDate, Textarea } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { can, useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { Artifact } from "../types";

type FileEntry = { path: string; content: string };

export function Artifacts() {
  const tenant = useSession((s) => s.currentTenant)!;
  const artifacts = useWorkspace((s) => s.artifacts);
  const requirements = useWorkspace((s) => s.requirements);
  const environments = useWorkspace((s) => s.environments);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<Artifact | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const tid = tenant.tenant.id;

  const files = useMemo<FileEntry[]>(() => {
    if (!selected?.content) return [];
    try {
      const parsed = JSON.parse(selected.content);
      return Array.isArray(parsed) ? parsed : [{ path: "artifact.json", content: JSON.stringify(parsed, null, 2) }];
    } catch {
      return [{ path: "artifact.txt", content: selected.content }];
    }
  }, [selected]);

  const remove = async (a: Artifact) => {
    if (!confirm(`删除制品 ${a.name} ${a.version}？`)) return;
    try {
      await api.artifacts.remove(tid, a.id);
      if (selected?.id === a.id) setSelected(null);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="制品管理"
        description="每次代码生成与流水线运行都会产出可追溯的制品（版本 + 校验和），可发布到测试或生产环境。"
        actions={<Button variant="outline" size="sm" onClick={() => refreshWorkspace()}><RefreshCw className="w-4 h-4 mr-2" /> 刷新</Button>}
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}

      {!artifacts.length ? (
        <EmptyState icon={Package} title="还没有制品" description="在需求详情点击「生成代码」，或执行流水线后会自动产生制品。" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {artifacts.map((a) => {
            const req = requirements.find((r) => r.id === a.requirementId);
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0"><Package className="w-5 h-5" /></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm flex flex-wrap items-center gap-2">{a.name} <Badge variant="secondary" className="text-[10px]">{a.version}</Badge></p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{req?.title ?? "无关联需求"}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" />{a.type}</span>
                        <span>·</span>
                        <span>{formatDate(a.createdAt)}</span>
                        {a.checksum && <span className="font-mono">· {a.checksum.slice(0, 12)}</span>}
                      </div>
                    </div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSelected(a); setOpenFile(null); }}>
                    <FileCode2 className="w-3.5 h-3.5 mr-1" /> 查看内容
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => setReleaseTarget(a)}>
                    <Rocket className="w-3.5 h-3.5 mr-1" /> 发布
                  </Button>
                  <div className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(a)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {selected && (
        <Modal title={`制品：${selected.name} ${selected.version}`} onClose={() => setSelected(null)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border p-2"><p className="text-muted-foreground">类型</p><p className="font-medium">{selected.type}</p></div>
              <div className="rounded-lg border p-2"><p className="text-muted-foreground">校验和</p><p className="font-mono truncate">{selected.checksum ?? "—"}</p></div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-2"><Boxes className="w-4 h-4" /> 文件（{files.length}）</p>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(files.map((f) => `# ${f.path}\n${f.content}`).join("\n\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                <Copy className="w-3.5 h-3.5 mr-1" /> {copied ? "已复制" : "复制全部"}
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[50vh] overflow-auto">
              {files.map((f) => (
                <div key={f.path} className="rounded-lg border overflow-hidden">
                  <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40" onClick={() => setOpenFile(openFile === f.path ? null : f.path)}>
                    {openFile === f.path ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-mono">{f.path}</span>
                  </button>
                  {openFile === f.path && <pre className="text-xs bg-muted/40 p-3 overflow-auto whitespace-pre-wrap font-mono">{f.content}</pre>}
                </div>
              ))}
              {!files.length && <p className="text-sm text-muted-foreground text-center py-6">该制品没有可预览的代码内容。</p>}
            </div>
          </div>
        </Modal>
      )}

      {releaseTarget && (
        <ReleaseModal
          artifact={releaseTarget}
          environments={environments}
          busy={busy}
          onClose={() => setReleaseTarget(null)}
          onRelease={async (environmentId, notes) => {
            setBusy(true);
            setError(null);
            try {
              const dep = await api.artifacts.release(tid, releaseTarget.id, environmentId, notes);
              setReleaseTarget(null);
              await refreshWorkspace();
              alert(`发布成功：${dep.environment}${dep.url ? `\n${dep.url}` : ""}`);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ReleaseModal({ artifact, environments, busy, onClose, onRelease }: {
  artifact: Artifact;
  environments: { id: string; name: string; kind: string }[];
  busy: boolean;
  onClose: () => void;
  onRelease: (environmentId: string, notes: string) => Promise<void>;
}) {
  const allowed = environments.filter((e) => e.kind !== "production" || can("deploy.production"));
  const [envId, setEnvId] = useState(allowed.find((e) => e.kind === "test")?.id ?? allowed[0]?.id ?? "");
  const [notes, setNotes] = useState(`发布 ${artifact.name} ${artifact.version}`);
  const prodBlocked = environments.some((e) => e.kind === "production") && !can("deploy.production");

  return (
    <Modal title={`发布 ${artifact.name} ${artifact.version}`} onClose={onClose}>
      <div className="space-y-3">
        {prodBlocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            生产环境发布需要「生产环境部署」权限，当前角色不可选择生产环境。请联系租户管理员。
          </div>
        )}
        <div>
          <label className="text-sm font-medium">目标环境</label>
          <Select value={envId} onChange={setEnvId} className="mt-1.5 w-full">
            {allowed.map((e) => <option key={e.id} value={e.id}>{e.name}（{e.kind}）</option>)}
          </Select>
          {!allowed.length && <p className="text-xs text-destructive mt-1">没有可发布的环境，请先在环境配置中创建。</p>}
        </div>
        <div>
          <label className="text-sm font-medium">发布说明</label>
          <Textarea value={notes} onChange={setNotes} rows={3} />
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || !envId} onClick={() => onRelease(envId, notes)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Rocket className="w-4 h-4 mr-2" /> 确认发布</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
