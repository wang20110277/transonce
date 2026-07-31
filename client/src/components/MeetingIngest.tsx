import { useState, useRef, useEffect } from "react";
import {
  Mic,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  FileText,
  Wand2,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  extractRequirementsFromMeeting,
  type ExtractedRequirement,
} from "../agents";
import { addMeeting, addRequirements } from "../lib/store";

interface DraftRequirement extends ExtractedRequirement {
  _id: string;
}

const SAMPLE_NOTES = `时间：2026-06-12 上午 10:00
参会人：产品负责人张伟、前端工程师李娜、后端工程师王强、测试工程师赵敏

1. 张伟：本期核心目标是上线"会议纪要驱动研发"的 MVP，先做 Web 端。用户可以把会议纪要粘贴进来，系统自动提取需求。
2. 李娜：前端用现有的 React + shadcn 框架，需要一个会议录入页面和需求评审页面。要求支持手动编辑 AI 提取出来的需求再保存。
3. 王强：后端要持久化会议和需求，并记录每个需求是从哪次会议来的。后续要支持把需求分配给 Agent 自动拆解任务。
4. 赵敏：测试方面，至少要覆盖需求提取的边界情况，比如空纪要、纯闲聊纪要。每个需求必须有可验证的验收标准。
5. 决议：下周三前完成会议→需求的闭环，优先级最高；任务拆解和研发执行排第二期。`;

function priorityVariant(priority: DraftRequirement["priority"]) {
  switch (priority) {
    case "high":
      return "destructive";
    case "medium":
      return "default";
    default:
      return "secondary";
  }
}

const priorityLabel: Record<DraftRequirement["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function MeetingIngest({ onAdopted }: { onAdopted?: () => void }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [participants, setParticipants] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRequirement[]>([]);
  const [adoptedCount, setAdoptedCount] = useState<number | null>(null);
  const [sourceMeetingId, setSourceMeetingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<any>(null);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
    },
    [],
  );

  // Live ASR via the browser Web Speech API (Chrome). Transcript fills the
  // notes box and flows into the same meeting → requirement pipeline.
  function startRecording() {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("当前浏览器不支持语音识别，请使用 Chrome。");
      return;
    }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) setNotes((n) => (n ? n + "\n" : "") + finalText);
      setInterim(interimText);
    };
    rec.onerror = (e: any) => {
      setError("语音识别出错：" + (e.error || "未知"));
      setIsRecording(false);
    };
    rec.onend = () => {
      setIsRecording(false);
      setInterim("");
    };
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
    setError(null);
  }

  function stopRecording() {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setIsRecording(false);
  }

  const canExtract = title.trim().length > 0 && notes.trim().length > 0 && !extracting;

  async function handleExtract() {
    setError(null);
    setAdoptedCount(null);
    setExtracting(true);
    try {
      const meeting = await addMeeting({
        title: title.trim(),
        rawNotes: notes.trim(),
        participants: participants
          .split(/[，,、\s]+/)
          .map((n) => n.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
        source: "manual",
      });
      setSourceMeetingId(meeting.id);
      const extracted = await extractRequirementsFromMeeting(title.trim(), notes.trim());
      setDrafts(
        extracted.map((r, i) => ({
          ...r,
          // keep a stable local key; reference the source meeting on adopt
          _id: `${meeting.id}_${i}`,
        })),
      );
      if (extracted.length === 0) {
        setError("Agent 未能从纪要中提取到需求，请补充更具体的内容后重试。");
      }
    } catch (e) {
      console.error(e);
      setError("提取失败，请确认后端已启动且 Agent（claude/opencode）可用后重试。");
    } finally {
      setExtracting(false);
    }
  }

  function patchDraft(id: string, patch: Partial<DraftRequirement>) {
    setDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d._id !== id));
  }

  async function handleAdoptAll() {
    if (drafts.length === 0) return;
    await addRequirements(
      drafts.map((d) => ({
        title: d.title,
        description: d.description,
        priority: d.priority,
        acceptanceCriteria: d.acceptanceCriteria,
        sourceMeetingId: sourceMeetingId || undefined,
      })),
    );
    setAdoptedCount(drafts.length);
    setDrafts([]);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mic className="w-6 h-6 text-primary" />
            会议纪要
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            粘贴会议纪要，由 <span className="font-medium">需求架构师</span> Agent 自动提取结构化需求；人工评审后再采纳。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Input */}
        <Card className="lg:col-span-2 p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">会议标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：V1.0 需求评审会"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">参会人（逗号分隔，可选）</label>
            <Input
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder="张伟, 李娜, 王强"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">会议纪要</label>
              <div className="flex items-center gap-1">
                <Button
                  variant={isRecording ? "destructive" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  {isRecording ? (
                    <>
                      <Square className="w-3 h-3 mr-1" />
                      停止录音
                    </>
                  ) : (
                    <>
                      <Mic className="w-3 h-3 mr-1" />
                      语音录入
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setTitle("V1.0 需求评审会");
                    setNotes(SAMPLE_NOTES);
                    setParticipants("张伟, 李娜, 王强, 赵敏");
                  }}
                >
                  <Wand2 className="w-3 h-3 mr-1" />
                  填入示例
                </Button>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="粘贴会议纪要、结论、待办，或点击「语音录入」实时转写…"
              className="w-full min-h-[260px] resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {isRecording && (
              <p className="text-xs text-primary italic">
                {interim ? `实时识别：${interim}` : "正在聆听…（请对麦克风说话）"}
              </p>
            )}
          </div>
          <Button className="w-full" disabled={!canExtract} onClick={handleExtract}>
            {extracting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Agent 提取中…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Agent 提取需求
              </>
            )}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </Card>

        {/* Review / collaboration */}
        <Card className="lg:col-span-3 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              评审提取结果
              {drafts.length > 0 && (
                <Badge variant="secondary">{drafts.length} 条</Badge>
              )}
            </h3>
            {drafts.length > 0 && (
              <Button size="sm" onClick={handleAdoptAll}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                全部采纳到需求
              </Button>
            )}
          </div>
          <Separator className="mb-3" />

          {adoptedCount !== null && (
            <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              已采纳 {adoptedCount} 条需求，可在「需求管理」中查看。
              {onAdopted && (
                <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={onAdopted}>
                  前往需求管理 →
                </Button>
              )}
            </div>
          )}

          <ScrollArea className="flex-1 max-h-[520px] pr-3">
            {drafts.length === 0 ? (
              <div className="h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <Sparkles className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">
                  {extracting
                    ? "需求架构师正在分析会议纪要…"
                    : "提取的需求将显示在这里，供你逐条评审与编辑后再采纳。"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {drafts.map((d) => (
                  <div key={d._id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={d.title}
                        onChange={(e) => patchDraft(d._id, { title: e.target.value })}
                        className="h-8 font-medium"
                      />
                      <select
                        value={d.priority}
                        onChange={(e) =>
                          patchDraft(d._id, {
                            priority: e.target.value as DraftRequirement["priority"],
                          })
                        }
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        <option value="high">高</option>
                        <option value="medium">中</option>
                        <option value="low">低</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDraft(d._id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <textarea
                      value={d.description}
                      onChange={(e) => patchDraft(d._id, { description: e.target.value })}
                      className="w-full min-h-[60px] resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
                    />
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        验收标准
                      </p>
                      {d.acceptanceCriteria.map((c, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Badge variant={priorityVariant(d.priority)} className="text-[10px] h-5">
                            {priorityLabel[d.priority]}
                          </Badge>
                          <input
                            value={c}
                            onChange={(e) => {
                              const next = [...d.acceptanceCriteria];
                              next[idx] = e.target.value;
                              patchDraft(d._id, { acceptanceCriteria: next });
                            }}
                            className="flex-1 h-7 rounded-md border border-input bg-transparent px-2 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
