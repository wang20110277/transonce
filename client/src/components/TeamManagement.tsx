import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Users, 
  Shield, 
  Bot, 
  Plus, 
  Settings2, 
  Trash2, 
  CheckCircle2, 
  UserPlus,
  Cpu,
  Menu
} from 'lucide-react';
import { Tenant, Role, Member, Agent, User } from '../types';

interface TeamManagementProps {
  tenant: Tenant;
}

const ALL_PERMISSIONS = [
  { id: 'dashboard', label: '仪表盘' },
  { id: 'projects', label: '项目管理' },
  { id: 'requirements', label: '需求管理' },
  { id: 'development', label: '研发管理' },
  { id: 'testing', label: '测试管理' },
  { id: 'artifacts', label: '制品管理' },
  { id: 'deployment', label: '部署管理' },
  { id: 'environments', label: '环境管理' },
];

export function TeamManagement({ tenant }: TeamManagementProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'agents'>('members');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">团队管理</h2>
          <p className="text-sm text-muted-foreground">管理成员角色、权限以及 AI 智能体配置</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setActiveTab('members')} className={activeTab === 'members' ? 'bg-muted' : ''}>
            <Users className="w-4 h-4 mr-2" /> 成员
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveTab('roles')} className={activeTab === 'roles' ? 'bg-muted' : ''}>
            <Shield className="w-4 h-4 mr-2" /> 角色与权限
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveTab('agents')} className={activeTab === 'agents' ? 'bg-muted' : ''}>
            <Bot className="w-4 h-4 mr-2" /> 智能体
          </Button>
        </div>
      </div>

      {activeTab === 'members' && <MembersList tenant={tenant} />}
      {activeTab === 'roles' && <RolesList tenant={tenant} />}
      {activeTab === 'agents' && <AgentsList tenant={tenant} />}
    </div>
  );
}

function MembersList({ tenant }: { tenant: Tenant }) {
  const activeMembers = tenant.members.filter(m => m.status === 'active');
  const pendingApplications = tenant.members.filter(m => m.status === 'pending');

  return (
    <div className="space-y-6">
      {pendingApplications.length > 0 && (
        <Card className="p-0 border-primary/20 bg-primary/5 overflow-hidden">
          <div className="p-3 px-4 bg-primary/10 border-b border-primary/10 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-primary uppercase tracking-wider">待处理申请 ({pendingApplications.length})</span>
          </div>
          <div className="divide-y divide-primary/10">
            {pendingApplications.map(app => (
              <div key={app.userId} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs uppercase">
                    {app.userId.substring(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-bold">User #{app.userId}</p>
                    <p className="text-[10px] text-muted-foreground">申请加入项目团队</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs">拒绝</Button>
                  <Button size="sm" className="h-8 text-xs bg-primary">同意加入</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="p-4 bg-muted/50 border-b flex justify-between items-center">
          <h3 className="font-semibold text-sm">正式成员 ({activeMembers.length})</h3>
          <Button size="sm"><UserPlus className="w-4 h-4 mr-2" /> 邀请成员</Button>
        </div>
        <div className="divide-y">
          {activeMembers.map(member => (
            <div key={member.userId} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                  {member.userId.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">User #{member.userId}</p>
                  <p className="text-xs text-muted-foreground">{member.isTeamAdmin ? '团队管理员' : '普通成员'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="outline">
                  {tenant.roles.find(r => r.id === member.roleId)?.name || '未分配岗位'}
                </Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Settings2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RolesList({ tenant }: { tenant: Tenant }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {tenant.roles.map(role => (
        <Card key={role.id} className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-lg font-bold">{role.name}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">权限方案: {role.permissions.length} 个模块</span>
              </div>
            </div>
            <Button variant="ghost" size="icon"><Settings2 className="w-4 h-4" /></Button>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">菜单访问</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {role.permissions.map(p => (
                  <Badge key={p} variant="secondary" className="text-[10px] font-normal px-2">
                    {ALL_PERMISSIONS.find(ap => ap.id === p)?.label || p}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">关联智能体</Label>
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-muted/50 border">
                <Bot className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">
                  {tenant.agents.find(a => a.id === role.agentId)?.name || '未关联'}
                </span>
              </div>
            </div>
          </div>
        </Card>
      ))}
      <Card className="border-dashed flex flex-col items-center justify-center p-8 bg-muted/10 h-full">
        <Plus className="w-8 h-8 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">创建新角色</p>
        <p className="text-xs text-muted-foreground mt-1 text-center max-w-[150px]">定义新的岗位能力与系统权限</p>
        <Button variant="outline" size="sm" className="mt-4">立即创建</Button>
      </Card>
    </div>
  );
}

function AgentsList({ tenant }: { tenant: Tenant }) {
  return (
    <div className="space-y-4">
      {tenant.agents.map(agent => (
        <Card key={agent.id} className="p-6">
          <div className="flex justify-between items-start">
            <div className="flex gap-4">
              <div className="bg-primary/10 p-3 rounded-2xl text-primary">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">{agent.name}</h3>
                  <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/10 border-blue-500/20">
                    {agent.model === 'claudecode' ? 'ClaudeCode' : 'Codex'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm"><Settings2 className="w-4 h-4 mr-2" /> 配置模型</Button>
              <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Simple Label component since shadcn label might not be available
function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <label className={className}>{children}</label>;
}
