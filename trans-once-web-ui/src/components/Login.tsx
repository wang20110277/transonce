import type { FormEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Rocket, ShieldCheck, Mail, Lock, User, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { login, register } from "../lib/session";

export function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, name, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-zinc-50 to-white dark:from-zinc-900 dark:via-zinc-950 dark:to-black p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-[420px]">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-xl shadow-primary/20 mb-4">
            <Rocket className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">TransOnce</h1>
          <p className="text-muted-foreground mt-2 text-sm">一站式多租户智能研发管理平台</p>
        </div>

        <Card className="p-8 border-none shadow-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl">
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-6">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {m === "login" ? "登录" : "注册账号"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-2">
                <label className="text-sm font-medium ml-1">姓名</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的姓名" className="pl-10 h-11 bg-background/50" required />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">邮箱地址</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="pl-10 h-11 bg-background/50" required />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" className="pl-10 h-11 bg-background/50" required minLength={6} />
              </div>
            </div>

            {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}

            <Button type="submit" className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "login" ? "登 录" : "创建账号"}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t text-center text-xs text-muted-foreground space-y-1">
            <p>初始账号：admin@transonce.local / admin123（超级管理员）</p>
          </div>
        </Card>

        <div className="mt-8 flex items-center justify-center gap-6 text-muted-foreground opacity-60">
          <div className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /><span className="text-xs font-medium">租户隔离 · RBAC · 审计</span></div>
        </div>
      </motion.div>
    </div>
  );
}
