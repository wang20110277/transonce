import { useState } from "react";
import {
  CalendarClock, Plus, Sparkles, Trash2, Loader2, FileText, Users,
  Wand2, CheckSquare2, Square, Bot, ClipboardList,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, Textarea, Pill, formatDate, statusLabel } from "../components/common";
import { Modal } from "../components/TeamSelect";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { askAgent, refreshWorkspace, useWorkspace } from "../lib/store";
import type { Requirement } from "../types";

type Draft = Partial<Requirement> & { title: string; description?: string; acceptanceCriteria?: string[] };

export function MeetingIngest() {
  const tenant = useSession((s) => s.currentTenant)!;
  const meetings = useWorkspace((s) => s.meetings);
  const projects = useWorkspace((s) => s.projects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const tid = tenant.tenant.id;

  const selected = meetings.find((m) => m.id === selectedId) ?? meetings[0] ?? null;

  const extract = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setDrafts(null);
    setCreatedCount(null);
    try {
      const res = await api.meetings.extract(tid, selected.id, false);
      setDrafts(res.requirements as Draft[]);
      setChecked(new Set(res.requirements.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (!selected || !drafts) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = drafts.filter((_, i) => checked.has(i));
      const created = await api.requirements.create(tid, chosen.map((d) => ({
        ...d,
        projectId: selected.projectId ?? null,
        sourceMeetingId: selected.id,
      })));
      setCreatedCount(created.length);
      setDrafts(null);
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="沟通管理"
        description="录入会议原始纪要，Agent 会自动提取带验收标准的需求；你挑选后再进入研发链路。"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 录入会议</Button>}
      />

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</div>}
      {createdCount != null && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
          已从会议采纳 {createdCount} 条需求，可在「需求管理」继续设计。
        </div>
      )}

      {!meetings.length ? (
        <EmptyState icon={CalendarClock} title="还没有会议纪要" description="录入一场评审会或需求会，让 Agent 从自然语言纪要中提取结构化需求。" action={
          <Button size="sm" className="mt-2" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> 录入会议</Button>
        } />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4 items-start">
          <div className="space-y-2 xl:sticky xl:top-4">
            {meetings.map((m) => (
              <button
                key={m.id}
                onClick={() => { setSelectedId(m.id); setDrafts(null); setCreatedCount(null); }}
                className={`w-full text-left rounded-lg border p-3 transition-all ${selected?.id === m.id ? "border-primary bg-primary/5" : "bg-card hover:border-primary/30"}`}
              >
                <p className="text-sm font-medium line-clamp-2">{m.title}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Pill tone={m.status === "extracted" ? "green" : "gray"}>{m.status === "extracted" ? "已提取" : "待提取"}</Pill>
                  <span className="text-[11px] text-muted-foreground">{formatDate(m.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-4 min-w-0">
              <Card className="p-5">
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold">{selected.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> {formatDate(selected.createdAt)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {selected.participants.map((p) => p.name).join("、") || "未记录参会人"}</span>
                      <Badge variant="secondary" className="text-[10px]">{selected.source === "manual" ? "手工录入" : selected.source}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => {
                      if (!confirm("删除这条会议纪要？已提取的需求不会被删除。")) return;
                      await api.meetings.remove(tid, selected.id);
                      setSelectedId(null);
                      await refreshWorkspace();
                    }}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                  <Button size="sm" onClick={extract} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />} 提取需求
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => askAgent("请总结这场会议的决议、待办和风险，并给出需求优先级建议", { meetingId: selected.id, title: selected.title })}>
                    <Bot className="w-4 h-4 mr-2" /> 让 Agent 总结
                  </Button>
                </div>
              </Card>

              {drafts && (
                <Card className="p-5 border-primary/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <h4 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Agent 提取结果（{drafts.length}）</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">勾选要采纳的需求，采纳后会关联来源会议并保留 Agent 运行记录。</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDrafts(null)}>取消</Button>
                      <Button size="sm" disabled={busy || !checked.size} onClick={adopt}>
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckSquare2 className="w-4 h-4 mr-2" />} 采纳 {checked.size} 条
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {drafts.map((d, i) => (
                      <div key={i} className={`rounded-lg border p-3 cursor-pointer ${checked.has(i) ? "border-primary bg-primary/5" : ""}`} onClick={() => {
                        const next = new Set(checked);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        setChecked(next);
                      }}>
                        <div className="flex gap-2">
                          {checked.has(i) ? <CheckSquare2 className="w-4 h-4 text-primary shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{d.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{d.description}</p>
                            {!!d.acceptanceCriteria?.length && (
                              <ul className="mt-2 space-y-1">
                                {d.acceptanceCriteria.map((c, j) => <li key={j} className="text-[11px] text-muted-foreground">· {c}</li>)}
                              </ul>
                            )}
                          </div>
                          {d.priority && <Pill tone={d.priority === "high" ? "rose" : "gray"}>{statusLabel[d.priority] ?? d.priority}</Pill>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="p-5">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-3"><ClipboardList className="w-4 h-4" /> 原始纪要</h4>
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground bg-muted/30 rounded-lg p-4 max-h-[420px] overflow-auto">{selected.rawNotes}</pre>
              </Card>

              <Card className="p-5">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-3"><FileText className="w-4 h-4" /> 参会人</h4>
                {selected.participants.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.participants.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">{p.name.slice(0, 1)}</span>
                        {p.name}{p.role && <span className="text-muted-foreground">· {p.role}</span>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">未记录参会人</p>}
              </Card>
            </div>
          )}
        </div>
      )}

      {createOpen && <MeetingModal projects={projects.map((p) => ({ id: p.id, name: p.name }))} onClose={() => setCreateOpen(false)} onCreated={async (id) => { setCreateOpen(false); setSelectedId(id); await refreshWorkspace(); }} />}
    </div>
  );
}

function MeetingModal({ projects, onClose, onCreated }: {
  projects: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const tenant = useSession((s) => s.currentTenant)!;
  const [form, setForm] = useState({ title: "", rawNotes: "", participants: "", projectId: projects[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const participants = form.participants.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
      const meeting = await api.meetings.create(tenant.tenant.id, {
        title: form.title,
        rawNotes: form.rawNotes,
        participants,
        projectId: form.projectId || null,
        source: "manual",
      });
      await onCreated(meeting.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="录入会议纪要" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">会议标题</label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1.5" placeholder="例如：Q4 需求评审会" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">参会人（顿号分隔）</label>
            <Input value={form.participants} onChange={(e) => setForm({ ...form, participants: e.target.value })} className="mt-1.5" placeholder="张三、李四" />
          </div>
          <div>
            <label className="text-sm font-medium">关联项目</label>
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="mt-1.5 w-full h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">不关联</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">原始纪要</label>
          <Textarea value={form.rawNotes} onChange={(v) => setForm({ ...form, rawNotes: v })} rows={10} placeholder="粘贴会议纪要原文。包含背景、讨论要点、决议与待办，Agent 提取效果更好。" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={busy || !form.title.trim() || !form.rawNotes.trim()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存会议"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
