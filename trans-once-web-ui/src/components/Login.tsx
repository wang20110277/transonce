import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Rocket, ShieldCheck, Mail, Lock, User, Loader2, X, History } from "lucide-react";
import { motion } from "motion/react";
import type { AuthConfig } from "../types";
import { api } from "../services/api";
import { login, loginWithMicrosoft, register } from "../lib/session";
import { listLoginHistory, removeLoginHistory, type LoginHistoryEntry } from "../lib/loginHistory";

// 微软登录回到的前端路由（需在 Azure 应用中以"SPA 重定向 URI"注册同名地址）。
export const MICROSOFT_CALLBACK_PATH = "/login/microsoft";

// 未取到配置时按默认（密码登录开、微软关）渲染，配置错误在提交时由后端兜底。
const FALLBACK_CONFIG: AuthConfig = {
  passwordLoginEnabled: true,
  registrationEnabled: true,
  microsoftEnabled: false,
};

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden>
      <rect x="0" y="0" width="10" height="10" fill="#f25022" />
      <rect x="12" y="0" width="10" height="10" fill="#7fba00" />
      <rect x="0" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

export function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig>(FALLBACK_CONFIG);
  const [msPending, setMsPending] = useState(false);
  // 密码登录被关闭时的管理员逃生口：API 侧本就只放行超级管理员，这里给入口。
  const [adminLogin, setAdminLogin] = useState(false);
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(listLoginHistory());
    api.auth.config().then(setConfig).catch(() => setConfig(FALLBACK_CONFIG));
  }, []);

  // 微软登录回调：授权码换会话后由 App 自动切走；URL 先清理避免刷新重放。
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, "");
    if (!path.endsWith(MICROSOFT_CALLBACK_PATH)) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const msError = params.get("error_description") || params.get("error");
    window.history.replaceState(null, "", "/");
    if (code && state) {
      setMsPending(true);
      loginWithMicrosoft(code, state).catch((err) => {
        setMsPending(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    } else {
      setError(msError ? `微软登录失败：${msError}` : "微软登录未返回授权码，请重试");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showPassword = config.passwordLoginEnabled || adminLogin;
  const showRegister = config.passwordLoginEnabled && config.registrationEnabled;
  // OAuth 重定向需要 http(s) 源；桌面端 app:// 协议下隐藏微软入口（仍可密码登录）。
  const webContext = window.location.protocol === "http:" || window.location.protocol === "https:";
  const msUnsupported = config.microsoftEnabled && !webContext;
  const showMicrosoft = config.microsoftEnabled && webContext;

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

  const startMicrosoft = async () => {
    setError(null);
    try {
      const res = await api.auth.microsoftStart(`${window.location.origin}${MICROSOFT_CALLBACK_PATH}`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickHistory = (entry: LoginHistoryEntry) => {
    if (entry.provider === "microsoft" && showMicrosoft) {
      startMicrosoft();
      return;
    }
    if (showPassword) {
      setMode("login");
      setEmail(entry.email);
      setError(null);
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
          {msPending ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">正在完成微软登录…</p>
              <p className="text-xs text-muted-foreground">正在验证你的微软账号并进入平台</p>
            </div>
          ) : (
            <>
              {showPassword && showRegister && (
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
              )}

              {showMicrosoft && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-11 text-base font-semibold"
                    onClick={startMicrosoft}
                  >
                    <MicrosoftLogo className="w-4.5 h-4.5 mr-2" />
                    使用微软账号登录
                  </Button>
                  {showPassword && (
                    <div className="flex items-center gap-3 my-6">
                      <div className="flex-1 border-t" />
                      <span className="text-xs text-muted-foreground">或</span>
                      <div className="flex-1 border-t" />
                    </div>
                  )}
                </>
              )}
              {msUnsupported && (
                <p className="text-xs text-muted-foreground text-center">
                  微软登录需要通过浏览器访问（当前为桌面内置页面，仅支持密码登录）。
                </p>
              )}

              {showPassword ? (
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
                  {mode === "login" && (
                    <div className="pt-1 text-center text-xs text-muted-foreground">
                      <p>初始账号：admin@transonce.local / admin123（超级管理员）</p>
                    </div>
                  )}
                </form>
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
                  <p className="text-xs text-muted-foreground text-center">
                    平台已关闭密码登录，请使用微软账号登录。
                  </p>
                  <button
                    type="button"
                    className="w-full text-xs text-primary hover:underline"
                    onClick={() => { setAdminLogin(true); setError(null); }}
                  >
                    管理员密码登录 →
                  </button>
                </div>
              )}

              {history.length > 0 && (showPassword || showMicrosoft) && (
                <div className="mt-6 pt-4 border-t space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1 mb-1">
                    <History className="w-3.5 h-3.5" /> 近期登录账号（仅本机记录）
                  </p>
                  {history.map((entry) => {
                    const clickable = (entry.provider === "microsoft" && showMicrosoft) || showPassword;
                    return (
                      <div key={entry.email} className={`group flex items-center gap-2 rounded-md border bg-background/50 px-2.5 py-1.5 ${clickable ? "hover:bg-muted/60 cursor-pointer" : "opacity-50"}`} onClick={() => clickable && pickHistory(entry)}>
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                          {entry.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{entry.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{entry.email}</p>
                        </div>
                        {entry.provider === "microsoft" && <MicrosoftLogo className="w-3 h-3 shrink-0" />}
                        <button
                          type="button"
                          title="忘记此账号"
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5"
                          onClick={(e) => { e.stopPropagation(); removeLoginHistory(entry.email); setHistory(listLoginHistory()); }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        <div className="mt-8 flex items-center justify-center gap-6 text-muted-foreground opacity-60">
          <div className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /><span className="text-xs font-medium">租户隔离 · RBAC · 审计</span></div>
        </div>
      </motion.div>
    </div>
  );
}
