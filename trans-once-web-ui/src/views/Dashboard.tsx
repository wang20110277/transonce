import {
  CalendarClock, FileText, ListChecks, TestTube2, Package, Workflow,
  Rocket, Activity, Bell, Bot, ArrowRight, Server, Users, GitBranch, FolderGit2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard, StatusPill, Pill, timeAgo, EmptyState } from "../components/common";
import { useWorkspace, askAgent } from "../lib/store";
import { can, useSession } from "../lib/session";

export function Dashboard({ onNavigate }: { onNavigate: (v: string) => void }) {
  const w = useWorkspace((s) => s);
  const tenant = useSession((s) => s.currentTenant);
  const c = w.dashboard?.counts;
  const openAlerts = w.alerts.filter((a) => a.status === "open");
  const activeRequirements = w.requirements.filter((r) => r.status !== "completed").slice(0, 5);
  const agents = w.detail?.agents ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${tenant?.tenant.name ?? ""} 工作台`}
        description="从会议纪要到生产运维，所有研发动作由你和你的专属 Agent 协作完成。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => onNavigate("meetings")}>
              <CalendarClock className="w-4 h-4 mr-2" /> 录入会议
            </Button>
            <Button size="sm" onClick={() => askAgent("根据当前项目状态，给我下一步研发建议和风险提示")}>
              <Bot className="w-4 h-4 mr-2" /> 问我的 Agent
            </Button>
          </>
        }
      />

      {!w.dashboard ? (
        <EmptyState icon={Activity} title={w.loading ? "正在加载工作台…" : "暂无工作台数据"} description={w.error ?? undefined} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard icon={FileText} label="需求" value={c?.requirements ?? 0} tone="blue" onClick={() => onNavigate("requirements")} />
            <StatCard icon={ListChecks} label="研发任务" value={c?.tasks ?? 0} tone="violet" onClick={() => onNavigate("development")} />
            <StatCard icon={TestTube2} label="测试运行" value={c?.testRuns ?? 0} tone="emerald" onClick={() => onNavigate("testing")} />
            <StatCard icon={Package} label="制品" value={c?.artifacts ?? 0} tone="amber" onClick={() => onNavigate("artifacts")} />
            {can("deployment") && <StatCard icon={Rocket} label="部署" value={c?.deployments ?? 0} tone="emerald" onClick={() => onNavigate("deployment")} />}
            {can("alerts") && <StatCard icon={Bell} label="未处理告警" value={c?.openAlerts ?? 0} tone={openAlerts.length ? "rose" : "default"} onClick={() => onNavigate("alerts")} />}
          </div>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><Workflow className="w-4 h-4 text-primary" /> 研发交付闭环</h3>
                <p className="text-xs text-muted-foreground mt-0.5">每个阶段的产出都会成为下一阶段的输入，并记录 Agent 运行痕迹</p>
              </div>
              {can("pipelines") && <Button variant="ghost" size="sm" onClick={() => onNavigate("pipelines")}>流水线 <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-9 gap-2">
              {[
                { label: "会议", value: c?.meetings ?? 0, icon: CalendarClock, view: "meetings", perm: "meetings" },
                { label: "需求", value: c?.requirements ?? 0, icon: FileText, view: "requirements", perm: "requirements" },
                { label: "任务", value: c?.tasks ?? 0, icon: ListChecks, view: "development", perm: "development" },
                { label: "测试", value: c?.testRuns ?? 0, icon: TestTube2, view: "testing", perm: "testing" },
                { label: "代码库", value: c?.repos ?? 0, icon: FolderGit2, view: "repos", perm: "repos" },
                { label: "制品", value: c?.artifacts ?? 0, icon: Package, view: "artifacts", perm: "artifacts" },
                { label: "流水线", value: c?.pipelines ?? 0, icon: GitBranch, view: "pipelines", perm: "pipelines" },
                { label: "部署", value: c?.deployments ?? 0, icon: Rocket, view: "deployment", perm: "deployment" },
                { label: "监控", value: c?.monitors ?? 0, icon: Activity, view: "monitoring", perm: "monitoring" },
              ].filter((s) => can(s.perm)).map((s, i, arr) => (
                <button
                  key={s.label}
                  onClick={() => onNavigate(s.view)}
                  className="relative rounded-lg border bg-background p-3 text-left hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <s.icon className="w-4 h-4 text-primary mb-2" />
                  <p className="text-xl font-bold leading-none">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
                  {i < arr.length - 1 && <ArrowRight className="hidden xl:block absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/30" />}
                </button>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">进行中的需求</h3>
                <Button variant="ghost" size="sm" onClick={() => onNavigate("requirements")}>查看全部 <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
              </div>
              {activeRequirements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">所有需求都已完成，试试录入一场新会议。</p>
              ) : (
                <div className="divide-y">
                  {activeRequirements.map((r) => (
                    <button key={r.id} onClick={() => onNavigate("requirements")} className="w-full text-left py-3 flex items-center gap-3 hover:bg-muted/40 rounded-md px-2 -mx-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {r.designStatus === "designed" ? "原型与架构已生成" : "等待原型与架构设计"} · {timeAgo(r.createdAt)}
                        </p>
                      </div>
                      <StatusPill status={r.status} />
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2"><Bell className="w-4 h-4" /> 需要关注</h3>
                {can("alerts") && <Button variant="ghost" size="sm" onClick={() => onNavigate("alerts")}>告警</Button>}
              </div>
              <div className="space-y-2">
                {openAlerts.slice(0, 4).map((a) => (
                  <div key={a.id} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Pill tone={a.severity === "critical" ? "rose" : a.severity === "warning" ? "amber" : "blue"}>
                        {a.severity === "critical" ? "严重" : a.severity === "warning" ? "警告" : "提示"}
                      </Pill>
                      <span className="text-sm font-medium truncate">{a.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(a.createdAt)}</p>
                  </div>
                ))}
                {openAlerts.length === 0 && (
                  <div className="text-center py-6">
                    <Activity className="w-7 h-7 text-emerald-500/60 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">所有监控正常，暂无告警</p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2 p-5">
              <h3 className="font-semibold mb-4">最近活动</h3>
              <div className="space-y-3">
                {w.activity.slice(0, 10).map((e) => (
                  <div key={e.id} className="flex items-start gap-3">
                    <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${e.actorKind === "agent" ? "bg-violet-500/10 text-violet-600" : e.actorKind === "system" ? "bg-zinc-500/10 text-zinc-500" : "bg-blue-500/10 text-blue-600"}`}>
                      {e.actorKind === "agent" ? "AI" : e.actorKind === "system" ? "SYS" : "人"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{e.actorKind === "agent" ? "Agent" : e.actorKind === "system" ? "系统" : "成员"}</span>
                        <span className="text-muted-foreground"> · {activityLabel(e.type)}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(e.at)}</p>
                    </div>
                  </div>
                ))}
                {!w.activity.length && <p className="text-sm text-muted-foreground py-4 text-center">暂无活动记录</p>}
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2"><Bot className="w-4 h-4" /> Agent 团队</h3>
                  <Button variant="ghost" size="sm" onClick={() => onNavigate(can("team") ? "team" : "agents")}>{can("team") ? "管理" : "我的 Agent"}</Button>
                </div>
                <div className="space-y-2">
                  {agents.slice(0, 4).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 rounded-md border p-2">
                      <div className="w-7 h-7 rounded-full bg-violet-500/10 text-violet-600 flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{a.ownerName ?? "租户共享"} · {a.provider}</p>
                      </div>
                      <Pill tone="violet">在线</Pill>
                    </div>
                  ))}
                  {!agents.length && <p className="text-xs text-muted-foreground">尚无 Agent</p>}
                </div>
              </Card>

              <Card className="p-5">
                {can("environments") && (
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2"><Server className="w-4 h-4" /> 环境</h3>
                  <Button variant="ghost" size="sm" onClick={() => onNavigate("environments")}>配置</Button>
                </div>
                )}
                <div className="space-y-2">
                  {!can("environments") && <p className="text-xs text-muted-foreground">当前角色无环境访问权限</p>}
                  {can("environments") && w.environments.map((env) => (
                    <div key={env.id} className="flex items-center justify-between text-sm">
                      <span className="truncate">{env.name}</span>
                      <div className="flex items-center gap-2">
                        <Pill tone={env.kind === "production" ? "rose" : "gray"}>{env.kind}</Pill>
                        <span className="text-[11px] text-muted-foreground">{env.ip || "未配置"}</span>
                      </div>
                    </div>
                  ))}
                  {!w.environments.length && <p className="text-xs text-muted-foreground">尚未配置环境</p>}
                </div>
              </Card>

              {can("team") && (
                <Card className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">团队成员</p>
                      <p className="text-xl font-bold">{c?.members ?? 0}</p>
                    </div>
                    <Users className="w-5 h-5 text-muted-foreground/60" />
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const activityLabels: Record<string, string> = {
  "tenant.created": "创建了租户",
  "member.joined": "加入了租户",
  "member.added": "添加了成员",
  "member.removed": "移除了成员",
  "member.updated": "更新了成员权限",
  "role.created": "创建了角色",
  "role.updated": "更新了角色",
  "role.deleted": "删除了角色",
  "join.approved": "通过了加入申请",
  "join.rejected": "拒绝了加入申请",
  "agent.updated": "更新了 Agent 配置",
  "agent.reset": "重置了 Agent",
  "project.created": "创建了项目",
  "meeting.created": "录入了会议",
  "meeting.extracted": "从会议提取了需求",
  "requirement.created": "创建了需求",
  "requirement.updated": "更新了需求",
  "requirement.designed": "生成了原型与架构",
  "requirement.broken_down": "拆解了研发任务",
  "requirement.coded": "生成了代码制品",
  "requirement.tested": "执行了测试",
  "task.status": "更新了任务状态",
  "task.run": "让 Agent 执行了任务",
  "artifact.created": "生成了制品",
  "artifact.deleted": "删除了制品",
  "pipeline.created": "创建了流水线",
  "pipeline.run": "执行了流水线",
  "deployment.created": "部署了制品",
  "environment.created": "创建了环境",
  "environment.updated": "更新了环境",
  "environment.revealed": "查看了环境密钥",
  "monitor.created": "创建了监控",
  "monitor.checked": "执行了健康检查",
  "alert.updated": "处理了告警",
  "chat.message": "与 Agent 对话",
};

function activityLabel(type: string): string {
  return activityLabels[type] ?? type;
}
