import { useState } from "react";
import { 
  LayoutDashboard, 
  Settings, 
  Code2, 
  FileText, 
  TestTube2, 
  Rocket, 
  Layers,
  ChevronRight,
  Plus,
  Search,
  MessageSquare,
  Eye,
  Terminal,
  Package,
  Loader2,
  CheckCircle2,
  Globe,
  Users,
  Building2,
  LogOut,
  ArrowLeftRight,
  Mic,
  Activity,
  Bot
} from "lucide-react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";

// Mock Data & Components
import { Project, System, Codebase, Requirement, Artifact, Deployment, Tenant, User, Meeting } from "./types";
import { RequirementEditor } from "./components/RequirementEditor";
import { Login } from "./components/Login";
import { TeamSelect } from "./components/TeamSelect";
import { TeamManagement } from "./components/TeamManagement";
import { GlobalAIChat } from "./components/GlobalAIChat";
import { MeetingIngest } from "./components/MeetingIngest";
import { DevelopmentBoard } from "./components/DevelopmentBoard";
import { TestingCenter } from "./components/TestingCenter";
import { DeploymentCenter } from "./components/DeploymentCenter";
import { useAppStore, loadFromServer } from "./lib/store";

const MOCK_TENANTS: Tenant[] = [
  { 
    id: 't1', 
    name: '创新数智研发组', 
    roles: [
      { id: 'r1', name: '产品负责人', permissions: ['dashboard', 'projects', 'meetings', 'requirements', 'artifacts', 'development', 'testing'], agentId: 'a1' },
      { id: 'r2', name: '全栈工程师', permissions: ['dashboard', 'projects', 'meetings', 'development', 'testing', 'deployment'], agentId: 'a2' }
    ],
    members: [
      { userId: 'u1', roleId: 'r1', status: 'active', isTeamAdmin: true },
      { userId: 'u2', roleId: 'r2', status: 'active' },
      { userId: 'u3', roleId: 'r2', status: 'pending' }
    ],
    agents: [
      { id: 'a1', name: '需求架构师', model: 'claudecode', description: '负责需求分析、原型设计与技术架构规范' },
      { id: 'a2', name: '编码助手', model: 'codex', description: '负责代码生成、单元测试与性能调优' }
    ]
  },
  { 
    id: 't2', 
    name: '全球交付中心', 
    roles: [
      { id: 'r3', name: 'DevOps 工程师', permissions: ['dashboard', 'projects', 'meetings', 'deployment', 'environments'], agentId: 'a3' }
    ],
    members: [
      { userId: 'u1', roleId: 'r3', status: 'active', isTeamAdmin: true }
    ],
    agents: [
      { id: 'a3', name: '部署专家', model: 'claudecode', description: '负责自动化部署流配置与环境稳定性监控' }
    ]
  },
];

const MOCK_USER: User = {
  id: 'u1',
  name: 'John Doe',
  email: 'john@example.com',
  avatar: 'https://github.com/shadcn.png'
};

const ALL_MENU_ITEMS = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "projects", label: "项目管理", icon: Layers },
  { id: "meetings", label: "会议纪要", icon: Mic },
  { id: "requirements", label: "需求管理", icon: FileText },
  { id: "development", label: "研发管理", icon: Code2 },
  { id: "testing", label: "测试管理", icon: TestTube2 },
  { id: "artifacts", label: "制品管理", icon: Package },
  { id: "deployment", label: "部署管理", icon: Rocket },
  { id: "environments", label: "环境管理", icon: Globe },
  { id: "team", label: "团队管理", icon: Users },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const handleLogin = (email: string) => {
    setUser({ ...MOCK_USER, email });
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentTenant(null);
    setActiveTab("dashboard");
  };

  const handleSelectTenant = (tenant: Tenant) => {
    setCurrentTenant(tenant);
    const member = tenant.members.find(m => m.userId === user?.id);
    const roleId = member?.roleId;
    const role = tenant.roles.find(r => r.id === roleId);

    // Hydrate the workspace from the backend (persisted pipeline data).
    loadFromServer();

    // Default to first permitted tab or dashboard
    if (role && !role.permissions.includes(activeTab)) {
      setActiveTab(role.permissions[0] || "dashboard");
    }
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (!currentTenant) {
    return (
      <TeamSelect 
        tenants={MOCK_TENANTS} 
        onSelect={handleSelectTenant} 
        onLogout={handleLogout} 
      />
    );
  }

  const currentUserMember = currentTenant.members.find(m => m.userId === user.id);
  const currentUserRole = currentTenant.roles.find(r => r.id === currentUserMember?.roleId);
  const isTeamAdmin = currentUserMember?.isTeamAdmin;

  let filteredMenuItems = ALL_MENU_ITEMS.filter(item => 
    currentUserRole?.permissions.includes(item.id)
  );

  // Add team management for admins if not already there
  if (isTeamAdmin && !filteredMenuItems.some(item => item.id === 'team')) {
    const teamMenu = ALL_MENU_ITEMS.find(i => i.id === 'team');
    if (teamMenu) filteredMenuItems.push(teamMenu);
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
          <Sidebar collapsible="icon">
            <SidebarHeader className="p-4 flex flex-row items-center gap-2">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
                <Rocket className="w-5 h-5" />
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden overflow-hidden">
                <span className="font-bold text-lg tracking-tight truncate">Transones</span>
                <span className="text-[10px] text-muted-foreground truncate">{currentTenant.name}</span>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>主菜单</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {filteredMenuItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton 
                          isActive={activeTab === item.id}
                          onClick={() => setActiveTab(item.id)}
                          tooltip={item.label}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="p-4 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full justify-start gap-2 h-9 px-2 group-data-[collapsible=icon]:justify-center"
                  onClick={() => setCurrentTenant(null)}
                >
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                  <span className="group-data-[collapsible=icon]:hidden">切换工作空间</span>
                </Button>
                
                <Separator />

                <div className="flex items-center gap-3 py-2 px-1 group-data-[collapsible=icon]:justify-center relative group/user">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={user.avatar} />
                    <AvatarFallback>{user.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col group-data-[collapsible=icon]:hidden min-w-0">
                    <span className="text-sm font-medium truncate">{user.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate">管理员</span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="ml-auto w-7 h-7 group-data-[collapsible=icon]:hidden opacity-0 group-hover/user:opacity-100 transition-opacity"
                    onClick={handleLogout}
                  >
                    <LogOut className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>

          <main className="flex-1 flex flex-col overflow-hidden">
            <header className="h-14 border-b flex items-center justify-between px-6 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-4" />
                <div className="flex items-center text-sm text-muted-foreground">
                  <Building2 className="w-3.5 h-3.5 mr-1.5" />
                  <span className="max-w-[120px] truncate">{currentTenant.name}</span>
                  <ChevronRight className="w-4 h-4 mx-1 flex-shrink-0" />
                  <span className="text-foreground font-medium capitalize truncate">{activeTab}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-64 hidden sm:block">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="搜索项目..." 
                    className="pl-9 h-9 bg-muted/50 border-none focus-visible:ring-1"
                  />
                </div>
                <Button size="sm" className="h-9">
                  <Plus className="w-4 h-4 mr-2" />
                  新建项目
                </Button>
              </div>
            </header>

            <ScrollArea className="flex-1">
              <div className="p-6 max-w-7xl mx-auto w-full">
                {activeTab === "dashboard" && <DashboardView />}
                {activeTab === "projects" && <ProjectsView tenantId={currentTenant.id} onSelectProject={(id) => { setSelectedProject(id); setActiveTab("projects-detail"); }} />}
                {activeTab === "projects-detail" && <ProjectDetailView projectId={selectedProject!} />}
                {activeTab === "meetings" && <MeetingIngest onAdopted={() => setActiveTab("requirements")} />}
                {activeTab === "requirements" && <RequirementsView />}
                {activeTab === "development" && <DevelopmentBoard />}
                {activeTab === "testing" && <TestingCenter />}
                {activeTab === "artifacts" && <ArtifactsView />}
                {activeTab === "environments" && <EnvironmentsView />}
                {activeTab === "deployment" && <DeploymentCenter />}
                {activeTab === "team" && <TeamManagement tenant={currentTenant} />}
              </div>
            </ScrollArea>
          </main>
        </div>
      </SidebarProvider>
      <GlobalAIChat />
    </TooltipProvider>
  );
}

// Update Sub-components to filter by tenant
function DashboardView() {
  const meetings = useAppStore((s) => s.meetings);
  const requirements = useAppStore((s) => s.requirements);
  const tasks = useAppStore((s) => s.tasks);
  const testRuns = useAppStore((s) => s.testRuns);
  const deployments = useAppStore((s) => s.deployments);
  const activity = useAppStore((s) => s.activity);

  const stats = [
    { label: "会议纪要", value: meetings.length, icon: Mic },
    { label: "需求", value: requirements.length, icon: FileText },
    { label: "研发任务", value: tasks.length, icon: Code2 },
    { label: "测试运行", value: testRuns.length, icon: TestTube2 },
    { label: "部署", value: deployments.length, icon: Rocket },
  ];

  const agentName: Record<string, string> = {
    extractor: "需求架构师",
    breakdown: "任务拆解师",
    tester: "测试专家",
    deployer: "部署专家",
    "current-user": "你",
  };

  function describe(ev: typeof activity[number]): string {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "meeting.created":
        return `创建了会议「${p.title ?? ""}」`;
      case "requirement.created":
        return `提取了 ${p.count ?? 0} 条需求`;
      case "task.created":
        return `拆解出 ${p.count ?? 0} 个研发任务`;
      case "task.status_changed":
        return `将任务状态推进至 ${p.status ?? ""}`;
      case "test.run":
        return `执行测试：${p.passed ?? 0}/${p.total ?? 0} 通过`;
      case "deployment.created":
        return `部署到 ${p.environment === "production" ? "生产环境" : "测试环境"}（${p.status ?? ""}）`;
      default:
        return ev.type;
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="p-5 rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">{s.label}</h3>
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold mt-2">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4" />
              协作动态
            </h2>
            <Badge variant="secondary" className="text-[10px]">人与 Agent</Badge>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              暂无动态。从「会议纪要」开始，人与 Agent 的协作记录会显示在这里。
            </p>
          ) : (
            <div className="space-y-1">
              {activity.slice(0, 12).map((ev) => {
                const isAgent = ev.actorKind === "agent";
                return (
                  <div key={ev.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                    <div className={`p-1.5 rounded-full shrink-0 ${isAgent ? "bg-primary/10" : "bg-emerald-500/10"}`}>
                      {isAgent ? (
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <Users className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{agentName[ev.actorId] ?? ev.actorId}</span>{" "}
                        <span className="text-muted-foreground">{describe(ev)}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(ev.at).toLocaleString("zh-CN")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">交付流水线</h2>
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">运行中</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            会议纪要 → 需求 → 研发 → 测试 → 部署，全链路由 Agent 驱动、人工协作。
          </p>
          <div className="space-y-3">
            {[
              { label: "会议 → 需求", icon: Mic, count: meetings.length, done: requirements.length },
              { label: "需求 → 任务", icon: FileText, count: requirements.length, done: tasks.length },
              { label: "研发 → 测试", icon: Code2, count: tasks.length, done: testRuns.length },
              { label: "测试 → 部署", icon: TestTube2, count: testRuns.length, done: deployments.length },
            ].map((stage) => (
              <div key={stage.label} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
                <div className="flex items-center gap-2">
                  <stage.icon className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{stage.label}</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">{stage.done} / {stage.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectsView({ tenantId, onSelectProject }: { tenantId: string, onSelectProject: (id: string) => void }) {
  // Shared projects belong to multiple tenants
  const allProjects = [
    { id: '1', name: '全渠道零售电商平台', description: '支持 B2B/B2C 的全渠道零售解决方案，包含主站与管理中台', systems: 3, createdAt: '2024-03-10', tenantIds: ['t1', 't2'] },
    { id: '2', name: '内部人力资源系统', description: '员工全生命周期管理及薪资自动化结算系统', systems: 2, createdAt: '2024-03-15', tenantIds: ['t1'] },
    { id: '3', name: '智能客服门户', description: '集成 AI 大模型的客户自助服务与工单系统', systems: 1, createdAt: '2024-03-20', tenantIds: ['t2'] },
  ];

  const projects = allProjects.filter(p => p.tenantIds.includes(tenantId));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">项目列表</h2>
        <Button>创建项目</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => (
          <Card key={p.id} className="p-6 hover:shadow-md transition-shadow cursor-pointer group flex flex-col h-full" onClick={() => onSelectProject(p.id)}>
            <div className="flex justify-between items-start mb-4">
              <div className="bg-primary/10 p-2 rounded-lg group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Layers className="w-5 h-5" />
              </div>
              <Badge variant="secondary" className="font-normal">{p.systems} 个系统</Badge>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">{p.name}</h3>
              <p className="text-sm text-muted-foreground mb-4 line-clamp-2 leading-relaxed">{p.description}</p>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-4 border-t uppercase tracking-wider">
              <span>创建日期: {p.createdAt}</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProjectDetailView({ projectId }: { projectId: string }) {
  const systems = [
    { 
      id: 's1', 
      name: 'Web 前端', 
      description: '基于 React 的 Web 应用程序', 
      codebases: [
        { id: 'c1', name: 'web-client', language: 'TypeScript' },
        { id: 'c2', name: 'admin-dashboard', language: 'TypeScript' }
      ] 
    },
    { 
      id: 's2', 
      name: 'API 网关', 
      description: 'Node.js/Express 后端服务', 
      codebases: [
        { id: 'c3', name: 'api-gateway', language: 'Node.js' }
      ] 
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => window.location.reload()}>项目管理</Button>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground font-medium">项目 #{projectId}</span>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">系统与代码库</h2>
        <Button variant="outline">添加系统</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {systems.map(s => (
          <Card key={s.id} className="p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="bg-blue-500/10 text-blue-500 p-2 rounded-lg">
                <Settings className="w-5 h-5" />
              </div>
              <Badge variant="outline">{s.codebases.length} 个代码库</Badge>
            </div>
            <h3 className="text-lg font-semibold mb-2">{s.name}</h3>
            <p className="text-sm text-muted-foreground mb-6">{s.description}</p>
            
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">代码库</h4>
              {s.codebases.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border text-sm">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-primary" />
                    <span className="font-medium">{c.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{c.language}</Badge>
                </div>
              ))}
            </div>
            
            <div className="flex gap-2 mt-6">
              <Button variant="secondary" size="sm" className="flex-1">管理系统</Button>
              <Button variant="outline" size="sm" className="flex-1">设置</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RequirementsView() {
  const requirements = useAppStore((s) => s.requirements);
  const meetings = useAppStore((s) => s.meetings);

  const meetingTitle = (id?: string) =>
    meetings.find((m) => m.id === id)?.title;

  const priorityBadge = (p?: Requirement["priority"]) => {
    if (p === "high") return <Badge variant="destructive" className="text-[10px]">高</Badge>;
    if (p === "medium") return <Badge className="text-[10px]">中</Badge>;
    if (p === "low") return <Badge variant="secondary" className="text-[10px]">低</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">需求管理</h2>
          <p className="text-sm text-muted-foreground">会议提取的需求在此汇总；也可用 AI 直接设计新需求</p>
        </div>
        <Button>新建需求</Button>
      </div>

      {requirements.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            已采纳需求（{requirements.length}）
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {requirements.map((r) => (
              <Card key={r.id} className="p-5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold leading-tight">{r.title}</h4>
                  {priorityBadge(r.priority)}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>
                {r.acceptanceCriteria && r.acceptanceCriteria.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    验收标准：{r.acceptanceCriteria.length} 条
                  </p>
                )}
                <div className="flex items-center gap-2 pt-2 border-t text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  {r.sourceMeetingId && (
                    <span className="flex items-center gap-1 truncate">
                      <Mic className="w-3 h-3" />
                      源自：{meetingTitle(r.sourceMeetingId) ?? "会议"}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Separator />
      <RequirementEditor />
    </div>
  );
}

function TestingView() {

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">测试管理</h2>
        <Button>运行所有测试</Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="font-semibold mb-4">测试环境</h3>
          <div className="space-y-4">
            <div className="p-4 rounded-xl border bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Staging-01</span>
                <Badge className="bg-green-500">活跃</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-4">URL: https://test-env-01.transones.ai</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 h-8">打开站点</Button>
                <Button size="sm" variant="outline" className="flex-1 h-8">日志</Button>
              </div>
            </div>
          </div>
        </Card>
        
        <Card className="p-6">
          <h3 className="font-semibold mb-4">测试结果</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium">单元测试</span>
              </div>
              <span className="text-xs font-mono">142/142 通过</span>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium">集成测试</span>
              </div>
              <span className="text-xs font-mono">28/28 通过</span>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span className="text-sm font-medium">E2E 测试</span>
              </div>
              <span className="text-xs font-mono">运行中...</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ArtifactsView() { 
  const artifacts = [
    { id: 'a1', name: '用户鉴权流程', type: '需求', version: 'v1.0.2', date: '2024-03-22' },
    { id: 'a2', name: '支付集成', type: '需求', version: 'v0.9.5', date: '2024-03-21' },
    { id: 'a3', name: '仪表盘组件', type: '代码', version: 'v1.2.4', date: '2024-03-20' },
    { id: 'a4', name: 'API 网关服务', type: '代码', version: 'v1.1.0', date: '2024-03-18' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">制品管理</h2>
        <Button variant="outline">全部导出</Button>
      </div>
      
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left p-4 font-medium">名称</th>
              <th className="text-left p-4 font-medium">类型</th>
              <th className="text-left p-4 font-medium">版本</th>
              <th className="text-left p-4 font-medium">创建时间</th>
              <th className="text-right p-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {artifacts.map(a => (
              <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                <td className="p-4 font-medium">{a.name}</td>
                <td className="p-4">
                  <Badge variant={a.type === '代码' ? 'default' : 'secondary'}>{a.type}</Badge>
                </td>
                <td className="p-4 font-mono text-xs">{a.version}</td>
                <td className="p-4 text-muted-foreground">{a.date}</td>
                <td className="p-4 text-right">
                  <Button variant="ghost" size="sm">下载</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnvironmentsView() {
  const environments = [
    { id: 'env-1', name: '开发环境 (Dev)', status: 'Online', region: '亚洲 (北京)', nodes: 3 },
    { id: 'env-2', name: '测试环境 (QA)', status: 'Online', region: '亚洲 (上海)', nodes: 2 },
    { id: 'env-3', name: '预发布环境 (Staging)', status: 'Online', region: '亚洲 (东京)', nodes: 5 },
    { id: 'env-4', name: '生产环境 (Prod)', status: 'Maintenance', region: '全球 (多可用区)', nodes: 12 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">环境管理</h2>
        <Button>新建环境</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {environments.map(env => (
          <Card key={env.id} className="p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <Badge variant={env.status === 'Online' ? 'default' : 'secondary'} className={env.status === 'Online' ? 'bg-green-500 hover:bg-green-600' : ''}>
                {env.status === 'Online' ? '在线' : '维护中'}
              </Badge>
            </div>
            <h3 className="text-lg font-semibold mb-2">{env.name}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground mb-4">
              <div>
                <p className="text-xs uppercase font-medium mb-1">区域</p>
                <p className="text-foreground">{env.region}</p>
              </div>
              <div>
                <p className="text-xs uppercase font-medium mb-1">节点数</p>
                <p className="text-foreground">{env.nodes} 节点</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1">资源详情</Button>
              <Button variant="outline" size="sm" className="flex-1 text-red-500 hover:text-red-600">停止服务</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DeploymentView() { 
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">生产部署</h2>
        <Button className="bg-primary hover:bg-primary/90">
          <Rocket className="w-4 h-4 mr-2" /> 部署到生产环境
        </Button>
      </div>
      
      <Card className="p-6">
        <h3 className="font-semibold mb-4">部署历史</h3>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between p-4 border rounded-xl hover:bg-muted/10 transition-colors">
              <div className="flex items-center gap-4">
                <div className="bg-primary/10 p-2 rounded-full">
                  <Rocket className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">生产版本 v1.2.0</p>
                  <p className="text-xs text-muted-foreground">由 John Doe 部署 • 2天前</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Badge className="bg-green-500">成功</Badge>
                <Button variant="ghost" size="sm">详情</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

