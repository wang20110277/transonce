import { useEffect, useRef, useState } from "react";
import {
  Bot, X, Send, Sparkles, Loader2, Plus, MessageSquare, Trash2, Minimize2,
  Maximize2, Paperclip, ChevronDown, CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "../services/api";
import { useSession } from "../lib/session";
import { refreshWorkspace, useWorkspace } from "../lib/store";
import type { ChatMessage, Conversation } from "../types";

type ChatEventDetail = { content?: string; context?: Record<string, unknown> };

const SUGGESTIONS = [
  "为当前需求生成原型和架构",
  "把这条需求拆解为任务",
  "为需求生成代码并跑测试",
  "为这条需求跑一遍全流程",
  "检查当前环境与告警状态",
];

export function GlobalAIChat() {
  const tenant = useSession((s) => s.currentTenant);
  const detail = useWorkspace((s) => s.detail);
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const tid = tenant?.tenant.id ?? null;

  const agent = detail?.myAgent ?? detail?.agents.find((a) => a.ownerUserId === user?.id);

  useEffect(() => {
    if (!tid) return;
    setConversations([]);
    setActiveId(null);
    setMessages([]);
    setContext(null);
    api.chat.conversations(tid).then((c) => {
      setConversations(c);
      if (c[0]) { setActiveId(c[0].id); loadMessages(c[0].id, c[0].context ?? null); }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const d = (ev as CustomEvent<ChatEventDetail>).detail ?? {};
      setOpen(true);
      setMinimized(false);
      if (d.context) setContext(d.context);
      if (d.content) {
        void send(d.content, d.context ?? context ?? undefined);
      }
    };
    window.addEventListener("transonce:chat", handler as EventListener);
    return () => window.removeEventListener("transonce:chat", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, activeId, context]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open, minimized]);

  const loadMessages = async (cid: string, ctx?: Record<string, unknown> | null) => {
    if (!tid) return;
    setActiveId(cid);
    if (ctx !== undefined) setContext(ctx);
    try {
      setMessages(await api.chat.messages(tid, cid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const refreshConversations = async () => {
    if (!tid) return;
    try { setConversations(await api.chat.conversations(tid)); } catch { /* ignore */ }
  };

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setContext(null);
    setShowList(false);
  };

  const send = async (text?: string, ctx?: Record<string, unknown>, confirm = false) => {
    const content = (text ?? input).trim();
    if (!content || !tid || loading) return;
    setInput("");
    setError(null);
    setLoading(true);
    const optimistic: ChatMessage = { role: "user", content, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      if (activeId) {
        const res = await api.chat.send(tid, activeId, content, ctx, confirm);
        setMessages((m) => [...m.filter((x) => x !== optimistic), res.userMessage, res.assistantMessage]);
      } else {
        const res = await api.chat.quick(tid, content, ctx, undefined, confirm);
        setActiveId(res.conversation.id);
        setMessages([res.userMessage, res.assistantMessage]);
        await refreshConversations();
      }
      // Actions mutate platform state; refresh the workspace so screens stay in sync.
      await refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((m) => m.filter((x) => x !== optimistic));
    } finally {
      setLoading(false);
    }
  };

  const removeConversation = async (cid: string) => {
    if (!tid || !confirm("删除这条对话？")) return;
    try {
      await api.chat.remove(tid, cid);
      if (activeId === cid) newConversation();
      await refreshConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const contextLabel = context && Object.keys(context).length
    ? String((context as { title?: string }).title ?? (context as { requirementId?: string }).requirementId ?? "已附加页面上下文")
    : null;

  if (!tenant) return null;

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="launcher"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
            title="打开 Agent 对话"
          >
            <Bot className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            className={`fixed z-50 bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden ${minimized ? "bottom-6 right-6 w-[320px] h-14" : "bottom-4 right-4 w-[calc(100vw-2rem)] sm:w-[440px] h-[min(720px,calc(100vh-2rem))]"}`}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-gradient-to-r from-primary/5 to-violet-500/5 shrink-0">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Bot className="w-4 h-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{agent?.name ?? "智能体"}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />{loading ? "正在执行…" : "在线 · 以你的权限工作"}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMinimized((m) => !m)}>
                {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
            </div>

            {!minimized && (
              <>
                <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/20 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowList((s) => !s)}>
                    <MessageSquare className="w-3.5 h-3.5 mr-1" /> 历史 <ChevronDown className={`w-3 h-3 transition-transform ${showList ? "rotate-180" : ""}`} />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={newConversation}><Plus className="w-3.5 h-3.5 mr-1" /> 新对话</Button>
                  <div className="flex-1" />
                  {activeId && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeConversation(activeId)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>

                {showList && (
                  <div className="border-b max-h-[180px] overflow-auto shrink-0 bg-muted/10">
                    {conversations.map((c) => (
                      <button key={c.id} onClick={() => { loadMessages(c.id, c.context ?? null); setShowList(false); }} className={`w-full text-left px-4 py-2 text-xs hover:bg-muted/40 flex items-center gap-2 ${activeId === c.id ? "bg-primary/5" : ""}`}>
                        <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{c.title}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString("zh-CN")}</span>
                      </button>
                    ))}
                    {!conversations.length && <p className="text-xs text-muted-foreground text-center py-3">暂无历史对话</p>}
                  </div>
                )}

                {contextLabel && (
                  <div className="px-3 py-1.5 border-b bg-violet-500/5 shrink-0 flex items-center gap-1.5 text-[11px] text-violet-700 dark:text-violet-300">
                    <Paperclip className="w-3 h-3" /> 上下文：{contextLabel}
                    <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setContext(null)}>移除</button>
                  </div>
                )}

                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-4 space-y-3">
                    {messages.length === 0 && (
                      <div className="py-6 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3"><Sparkles className="w-6 h-6" /></div>
                        <p className="text-sm font-medium">我能帮你推进整个研发链路</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">描述你的目标，我会调用平台工具完成需求、设计、任务、代码、测试、部署与巡检。</p>
                        <div className="flex flex-wrap gap-1.5 justify-center mt-4">
                          {SUGGESTIONS.map((s) => (
                            <button key={s} onClick={() => send(s)} className="text-[11px] rounded-full border px-2.5 py-1 hover:border-primary/40 hover:bg-muted/40 transition-colors">{s}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {messages.map((m, i) => (
                      <div key={m.id ?? i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                        {m.role === "assistant" && (
                          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5"><Bot className="w-3.5 h-3.5" /></div>
                        )}
                        <div className={`max-w-[85%] space-y-1 ${m.role === "user" ? "items-end" : ""}`}>
                          <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted/60 rounded-bl-sm"}`}>
                            {m.content}
                          </div>
                          {m.actionResult?.kind && !["confirm", "cancelled"].includes(m.actionResult.kind) && (
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                              <CheckCircle2 className="w-3 h-3" /> 已执行：{actionLabel(m.actionResult.kind)}
                              {typeof m.actionResult.error === "string" && <span className="text-rose-600">· {m.actionResult.error}</span>}
                            </div>
                          )}
                          {m.actionResult?.kind === "confirm" && !m.actionResult.error && !loading && i === messages.length - 1 && (
                            <div className="rounded-xl border border-amber-300/70 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 p-2.5 space-y-2">
                              <p className="text-[11px] text-amber-900 dark:text-amber-200">
                                {String(m.actionResult.summary ?? "该操作会修改平台状态，请确认。")}
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => send("确认执行", {
                                    ...(context ?? {}),
                                    intent: m.actionResult?.intent,
                                    requirementId: m.actionResult?.requirementId,
                                    environmentId: m.actionResult?.environmentId,
                                  }, true)}
                                >
                                  确认执行
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => send("取消", context ?? undefined)}
                                >
                                  取消
                                </Button>
                              </div>
                            </div>
                          )}
                          {m.createdAt && <p className="text-[9px] text-muted-foreground px-1">{new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</p>}
                        </div>
                      </div>
                    ))}

                    {loading && (
                      <div className="flex gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5" /></div>
                        <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Agent 正在执行…
                        </div>
                      </div>
                    )}

                    {error && <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</div>}
                    <div ref={endRef} />
                  </div>
                </ScrollArea>

                <div className="p-3 border-t shrink-0">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
                      }}
                      rows={1}
                      placeholder="描述目标，或输入“帮我跑一遍全流程”…"
                      className="flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring max-h-28"
                    />
                    <Button size="icon" className="h-9 w-9 rounded-xl shrink-0" disabled={loading || !input.trim()} onClick={() => send()}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1.5 text-center">Agent 不能读取环境明文密码；生产发布仍由人工授权。</p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function actionLabel(kind: string): string {
  const labels: Record<string, string> = {
    requirement: "需求",
    tasks: "任务",
    artifact: "制品",
    testRun: "测试",
    pipelineRun: "流水线",
    deployment: "部署",
    autopilot: "一键研发",
    none: "对话",
  };
  return labels[kind] ?? kind;
}
