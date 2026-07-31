import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Building2, 
  Plus, 
  ChevronRight, 
  Users, 
  Globe, 
  Settings2,
  Shield,
  ArrowLeft,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';
import { Tenant } from '../types';

interface TeamSelectProps {
  tenants: Tenant[];
  onSelect: (tenant: Tenant) => void;
  onLogout: () => void;
}

export function TeamSelect({ tenants, onSelect, onLogout }: TeamSelectProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [selectedToJoin, setSelectedToJoin] = useState<string | null>(null);
  const [hasApplied, setHasApplied] = useState(false);

  const availableTeams = [
    { id: 't3', name: '未来科技实验室', description: '专注前沿技术探索与 AI 落地' },
    { id: 't4', name: '卓越运营部', description: '企业效率中台与数字化转型' },
  ];

  if (isApplying) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 flex items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[500px]"
        >
          <Card className="p-8 shadow-2xl border-none">
            <Button variant="ghost" size="sm" onClick={() => setIsApplying(false)} className="mb-6 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-2" /> 返回
            </Button>
            
            <h2 className="text-2xl font-bold mb-2">寻找您的团队</h2>
            <p className="text-sm text-muted-foreground mb-8">选择您想要加入的工作空间并发送申请</p>

            {hasApplied ? (
              <div className="text-center py-10 space-y-4">
                <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold">申请已发送</h3>
                <p className="text-sm text-muted-foreground">您的加入申请已提交至团队管理员，请耐心等待审核通知。</p>
                <Button className="mt-6" onClick={() => setIsApplying(false)}>回到团队列表</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {availableTeams.map(team => (
                  <div 
                    key={team.id}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                      selectedToJoin === team.id ? 'border-primary bg-primary/5' : 'border-zinc-100 hover:border-zinc-200'
                    }`}
                    onClick={() => setSelectedToJoin(team.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-500 font-bold uppercase">
                          {team.name.substring(0, 2)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{team.name}</p>
                          <p className="text-xs text-muted-foreground">{team.description}</p>
                        </div>
                      </div>
                      {selectedToJoin === team.id && <CheckCircle2 className="w-5 h-5 text-primary" />}
                    </div>
                  </div>
                ))}
                
                <Button 
                  className="w-full h-11 mt-6" 
                  disabled={!selectedToJoin}
                  onClick={() => setHasApplied(true)}
                >
                  发送加入申请
                </Button>
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 flex items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[640px]"
      >
        <div className="flex justify-between items-center mb-8 px-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">选择或加入团队</h2>
            <p className="text-sm text-muted-foreground mt-1">请选择要进入的工作空间，或申请加入新团队</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            退出登录
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {tenants.map((tenant) => (
            <Card 
              key={tenant.id} 
              className="group p-6 cursor-pointer hover:shadow-xl hover:shadow-primary/5 transition-all bg-card border-zinc-200 dark:border-zinc-800"
              onClick={() => onSelect(tenant)}
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  {tenant.logo ? (
                    <img src={tenant.logo} alt={tenant.name} className="w-8 h-8 object-contain" />
                  ) : (
                    <Building2 className="w-7 h-7" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold">{tenant.name}</h3>
                    <Badge variant="secondary" className="text-[10px] bg-primary/5 text-primary border-none">
                      已加入
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5" />
                      {tenant.roles.length} 个岗位
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {tenant.members.length} 名成员
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </div>
            </Card>
          ))}

          <Card 
            className="border-dashed border-2 p-6 flex flex-col items-center justify-center gap-3 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer group"
            onClick={() => setIsApplying(true)}
          >
            <div className="bg-background p-3 rounded-full shadow-sm group-hover:scale-110 transition-transform">
              <Plus className="w-6 h-6 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="font-bold">申请加入新工作空间</h3>
              <p className="text-xs text-muted-foreground mt-1">输入团队代码或联系管理员</p>
            </div>
          </Card>
        </div>

        <div className="mt-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-4">
          <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> 简体中文</span>
          <span className="flex items-center gap-1 hover:text-primary cursor-pointer underline underline-offset-4">查看帮助中心</span>
        </div>
      </motion.div>
    </div>
  );
}
