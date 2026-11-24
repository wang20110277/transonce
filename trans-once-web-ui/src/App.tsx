import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, FolderKanban, CalendarClock, FileText, ListChecks, TestTube2,
  Package, Workflow, Rocket, Server, Activity, Bell, BellRing, Bot, Users, LogOut, GitBranch,
  Building2, ChevronDown, Menu, X, Moon, Sun, Sparkles, ArrowLeftRight, ShieldAlert, UserCog, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Login } from "./components/Login";
import { TeamSelect } from "./components/TeamSelect";
import { TeamManagement } from "./components/TeamManagement";
import { ProfileSettings } from "./components/ProfileSettings";
import { PlatformSettings } from "./components/PlatformSettings";
import { MeetingIngest } from "./components/MeetingIngest";
import { DevelopmentBoard } from "./components/DevelopmentBoard";
import { TestingCenter } from "./components/TestingCenter";
import { DeploymentCenter } from "./components/DeploymentCenter";
import { CodeRepos } from "./views/CodeRepos";
import { GlobalAIChat } from "./components/GlobalAIChat";
import { Dashboard } from "./views/Dashboard";
import { Projects } from "./views/Projects";
import { Requirements } from "./views/Requirements";
import { Artifacts } from "./views/Artifacts";
import { Pipelines } from "./views/Pipelines";
import { Environments } from "./views/Environments";
import { Monitoring } from "./views/Monitoring";
import { Alerts } from "./views/Alerts";
import { AlertSettings } from "./views/AlertSettings";
import { MyAgent } from "./views/MyAgent";
import { can, clearTenant, logout, refreshSession, selectTenant, useSession } from "./lib/session";
import { invalidateWorkspace, loadWorkspace, useWorkspace } from "./lib/store";
import { ErrorBoundary, formatDate } from "./components/common";

type ViewId =
  | "dashboard" | "projects" | "meetings" | "requirements" | "development"
  | "testing" | "repos" | "artifacts" | "pipelines" | "deployment" | "environments"
  | "monitoring" | "alerts" | "alert-settings" | "agents" | "team";

const NAV: { group: string; items: { id: ViewId; label: string; icon: ElementType; perm: string }[] }[] = [
  { group: "总览", items: [{ id: "dashboard", label: "工作台", icon: LayoutDashboard, perm: "dashboard" }] },
  {
    group: "研发",
    items: [
      { id: "projects", label: "项目管理", icon: FolderKanban, perm: "projects" },
      { id: "meetings", label: "会议纪要", icon: CalendarClock, perm: "meetings" },
      { id: "requirements", label: "需求管理", icon: FileText, perm: "requirements" },
      { id: "development", label: "研发管理", icon: ListChecks, perm: "development" },
      { id: "testing", label: "测试管理", icon: TestTube2, perm: "testing" },
    ],
  },
  {
    group: "交付",
    items: [
      { id: "repos", label: "代码管理", icon: GitBranch, perm: "repos" },
      { id: "pipelines", label: "持续集成", icon: Workflow, perm: "pipelines" },
      { id: "artifacts", label: "制品管理", icon: Package, perm: "artifacts" },
      { id: "deployment", label: "部署管理", icon: Rocket, perm: "deployment" },
    ],
  },
  {
    group: "运维",
    items: [
      { id: "monitoring", label: "运维监控", icon: Activity, perm: "monitoring" },
      { id: "alerts", label: "告警中心", icon: Bell, perm: "alerts" },
    ],
  },
  {
    group: "配置",
    items: [
      { id: "environments", label: "环境配置", icon: Server, perm: "environments" },
      { id: "alert-settings", label: "告警配置", icon: BellRing, perm: "alert.channel.manage" },
    ],
  },
  {
    group: "协作",
    items: [
      { id: "agents", label: "智能体", icon: Bot, perm: "agents" },
      { id: "team", label: "团队管理", icon: Users, perm: "team" },
    ],
  },
];

const TITLES: Record<ViewId, string> = {
  dashboard: "工作台", projects: "项目管理", meetings: "会议纪要", requirements: "需求管理",
  development: "研发管理", testing: "测试管理", repos: "代码管理", artifacts: "制品管理", pipelines: "持续集成",
  deployment: "部署管理", environments: "环境配置", monitoring: "运维监控", alerts: "告警中心",
  "alert-settings": "告警配置",
  agents: "智能体", team: "团队管理",
};

export default function App() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const tenant = useSession((s) => s.currentTenant);
  const memberships = useSession((s) => s.memberships);
  const loading = useWorkspace((s) => s.loading);
  const detail = useWorkspace((s) => s.detail);
  const alerts = useWorkspace((s) => s.alerts);
  const [view, setView] = useState<ViewId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantMenu, setTenantMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("transonce.theme") === "dark");

  useEffect(() => {
    if (status === "idle") void refreshSession();
  }, [status]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("transonce.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (tenant) void loadWorkspace(tenant.tenant.id);
  }, [tenant?.tenant.id]);

  const allowed = useMemo(() => {
    const map = new Set<ViewId>();
    for (const g of NAV) for (const item of g.items) if (can(item.perm)) map.add(item.id);
    return map;
  }, [tenant]);

  useEffect(() => {
    if (tenant && !loading && !allowed.has(view)) {
      const first = NAV.flatMap((g) => g.items).find((i) => allowed.has(i.id));
      if (first) setView(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.tenant.id, loading]);

  const switchTenant = (id: string) => {
    const m = memberships.find((x) => x.tenant.id === id);
    if (!m) return;
    invalidateWorkspace();
    selectTenant(m);
    setTenantMenu(false);
    setView("dashboard");
  };

  if (status === "idle" || status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center animate-pulse"><Sparkles className="w-6 h-6" /></div>
        <p className="text-sm text-muted-foreground">正在加载 TransOnce…</p>
      </div>
    );
  }

  if (!user) return <Login />;
  if (!tenant) return <TeamSelect />;

  const render = () => {
    if (!allowed.has(view)) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldAlert className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="font-medium">当前角色没有访问该页面的权限</p>
          <p className="text-sm text-muted-foreground mt-1">请联系租户管理员调整角色权限。</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setView("dashboard")}>返回工作台</Button>
        </div>
      );
    }
    switch (view) {
      case "dashboard": return <Dashboard onNavigate={(v) => setView(v as ViewId)} />;
      case "projects": return <Projects />;
      case "meetings": return <MeetingIngest />;
      case "requirements": return <Requirements />;
      case "development": return <DevelopmentBoard />;
      case "testing": return <TestingCenter />;
      case "repos": return <CodeRepos />;
      case "artifacts": return <Artifacts />;
      case "pipelines": return <Pipelines />;
      case "deployment": return <DeploymentCenter />;
      case "environments": return <Environments />;
      case "monitoring": return <Monitoring onNavigate={(v) => setView(v as ViewId)} />;
      case "alerts": return <Alerts />;
      case "alert-settings": return <AlertSettings />;
      case "agents": return <MyAgent />;
      case "team": return <TeamManagement />;
      default: return null;
    }
  };

  const openAlerts = alerts.filter((a) => a.status === "open").length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-foreground">
      {/* mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-50 w-[264px] bg-card border-r flex flex-col transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="h-16 px-5 flex items-center gap-2.5 border-b shrink-0">
          <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20">
            <Rocket className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold tracking-tight leading-tight">TransOnce</p>
            <p className="text-[10px] text-muted-foreground truncate">Agent 研发交付平台</p>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setMobileOpen(false)}><X className="w-4 h-4" /></Button>
        </div>

        <div className="px-3 py-3 border-b shrink-0">
          <button onClick={() => setTenantMenu((v) => !v)} className="w-full flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 hover:bg-muted/40 transition-colors">
            <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"><Building2 className="w-3.5 h-3.5" /></div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs font-semibold truncate">{tenant.tenant.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{tenant.role?.name ?? "成员"}{tenant.isTenantAdmin ? " · 管理员" : ""}</p>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${tenantMenu ? "rotate-180" : ""}`} />
          </button>
          {tenantMenu && (
            <div className="mt-1.5 rounded-lg border bg-popover shadow-lg p-1 max-h-[240px] overflow-auto">
              {memberships.map((m) => (
                <button key={m.tenant.id} onClick={() => switchTenant(m.tenant.id)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${m.tenant.id === tenant.tenant.id ? "bg-primary/5" : ""}`}>
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{m.tenant.name}</span>
                  <span className="text-[10px] text-muted-foreground">{m.role?.name ?? ""}</span>
                </button>
              ))}
              <button onClick={() => { clearTenant(); setTenantMenu(false); }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                <ArrowLeftRight className="w-3.5 h-3.5" /> 切换 / 加入其他团队
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-auto px-3 py-3 space-y-4">
          {NAV.map((g) => {
            const items = g.items.filter((i) => allowed.has(i.id));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.group}</p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { setView(item.id); setMobileOpen(false); }}
                      className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${view === item.id ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.id === "alerts" && openAlerts > 0 && (
                        <span className="text-[10px] bg-rose-500 text-white rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">{openAlerts}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t shrink-0">
          <div className="flex items-center gap-2 px-1">
            <button onClick={() => setProfileOpen(true)} title="个人设置" className="flex items-center gap-2 min-w-0 flex-1 rounded-md px-1 py-0.5 hover:bg-muted/60 transition-colors text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{user.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="个人设置" onClick={() => setProfileOpen(true)}><UserCog className="w-3.5 h-3.5" /></Button>
            {user.isSuperAdmin && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="平台登录设置" onClick={() => setPlatformOpen(true)}><KeyRound className="w-3.5 h-3.5" /></Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" title="退出登录" onClick={logout}><LogOut className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[264px] flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 h-16 bg-background/80 backdrop-blur border-b px-4 sm:px-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9" onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5" /></Button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{TITLES[view]}</h1>
            <p className="text-[10px] text-muted-foreground truncate">{tenant.tenant.name} · {tenant.role?.name ?? "成员"} · 最近加载 {formatDate(new Date().toISOString())}</p>
          </div>
          <div className="flex-1" />
          {openAlerts > 0 && (
            <Button variant="ghost" size="sm" className="hidden sm:flex text-rose-600" onClick={() => setView("alerts")}>
              <Bell className="w-4 h-4 mr-1" /> {openAlerts} 条告警
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDark((d) => !d)} title="切换主题">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" className="hidden md:flex" onClick={() => switchTenant(memberships[(memberships.findIndex((m) => m.tenant.id === tenant.tenant.id) + 1) % memberships.length]?.tenant.id ?? tenant.tenant.id)} disabled={memberships.length < 2}>
            <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5" /> 切换团队
          </Button>
          <div className="hidden lg:flex items-center gap-1.5">
            {detail?.myAgent && <Badge variant="secondary" className="text-[10px] font-normal"><Bot className="w-3 h-3 mr-1" />{detail.myAgent.name}</Badge>}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1500px] w-full mx-auto">
          {loading && !detail ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 bg-muted rounded w-64" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
              </div>
              <div className="h-64 bg-muted rounded-xl" />
            </div>
          ) : (
            <ErrorBoundary>{render()}</ErrorBoundary>
          )}
        </main>

        <footer className="px-6 py-4 text-[10px] text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t">
          <span>TransOnce · 多租户 Agent 研发交付平台</span>
          <span>数据隔离 · RBAC · 审计日志 · 人工审批闸门</span>
        </footer>
      </div>

      <GlobalAIChat />
      {profileOpen && <ProfileSettings onClose={() => setProfileOpen(false)} />}
      {platformOpen && <PlatformSettings onClose={() => setPlatformOpen(false)} />}
    </div>
  );
}
