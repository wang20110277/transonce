import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Rocket, ShieldCheck, Mail, Lock } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginProps {
  onLogin: (email: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && password) {
      onLogin(email);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-zinc-50 to-white dark:from-zinc-900 dark:via-zinc-950 dark:to-black p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-[420px]"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-xl shadow-primary/20 mb-4">
            <Rocket className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Transones</h1>
          <p className="text-muted-foreground mt-2 text-sm">一站式多租户智能研发管理平台</p>
        </div>

        <Card className="p-8 border-none shadow-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground ml-1">邮箱地址</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="email" 
                  placeholder="name@example.com" 
                  className="pl-10 h-11 bg-background/50 border-zinc-200 dark:border-zinc-800"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-sm font-medium text-foreground">密码</label>
                <button type="button" className="text-xs text-primary hover:underline font-medium">忘记密码?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="pl-10 h-11 bg-background/50 border-zinc-200 dark:border-zinc-800"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20">
              登 录
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-zinc-800 text-center">
            <p className="text-sm text-muted-foreground">
              还没有账号? <button className="text-primary font-semibold hover:underline">申请加入团队</button>
            </p>
          </div>
        </Card>

        <div className="mt-10 flex items-center justify-center gap-6 text-muted-foreground opacity-60">
          <div className="flex items-center gap-1.5 grayscale">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-medium">企业级数据安全</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
