import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Rocket, ShieldCheck, Mail, Lock, User, Loader2, X, History, KeyRound, Building2 } from "lucide-react";
import { motion } from "motion/react";
import type { AuthConfig, AuthUser } from "../types";
import { api, setToken } from "../services/api";
import { login, loginWithLdap, loginWithMicrosoft, loginWithOidc, register } from "../lib/session";
import { refreshSession } from "../lib/session";
import { addLoginHistory, listLoginHistory, removeLoginHistory, type LoginHistoryEntry } from "../lib/loginHistory";

// 微软登录回到的前端路由（需在 Azure 应用中以"SPA 重定向 URI"注册同名地址）。
export const MICROSOFT_CALLBACK_PATH = "/login/microsoft";
// 通用 OIDC 登录回调路由（在身份服务中注册同名重定向 URI）。
export const OIDC_CALLBACK_PATH = "/login/oidc";

// 未取到配置时按默认（密码登录开、三方登录关）渲染，配置错误在提交时由后端兜底。
const FALLBACK_CONFIG: AuthConfig = {
  passwordLoginEnabled: true,
  registrationEnabled: true,
  microsoftEnabled: false,
  oidcEnabled: false,
  oidcDisplayName: "",
  ldapEnabled: false,
  ldapDisplayName: "",
};

// 桌面客户端（Electron preload 注入）提供的 OAuth 桥：app:// 页面无法注册
// 重定向，由主进程走 RFC 8252 本机回环（系统浏览器授权后携授权码回跳）。
type DesktopBridge = {
  isDesktop: boolean;
  oauthLogin?: (provider: "microsoft" | "oidc") => Promise<{ token: string; user: AuthUser }>;
};
const desktop = (window as { transonceDesktop?: DesktopBridge }).transonceDesktop;

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
  const [mode, setMode] = useState<"login" | "register" | "ldap">("login");
  const [email, setEmail] = useState("");
  const [ldapUser, setLdapUser] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig>(FALLBACK_CONFIG);
  const [msPending, setMsPending] = useState(false);
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(listLoginHistory());
    api.auth.config().then(setConfig).catch(() => setConfig(FALLBACK_CONFIG));
  }, []);

  // 三方登录回调（浏览器）：授权码换会话后由 App 自动切走；URL 先清理避免刷新重放。
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, "");
    const params = new URLSearchParams(window.location.search);
    const isMicrosoft = path.endsWith(MICROSOFT_CALLBACK_PATH);
    const isOidc = path.endsWith(OIDC_CALLBACK_PATH);
    if (!isMicrosoft && !isOidc) return;
    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error_description") || params.get("error");
    window.history.replaceState(null, "", "/");
    if (code && state) {
      setMsPending(true);
      const done = isMicrosoft ? loginWithMicrosoft(code, state) : loginWithOidc(code, state);
      done.catch((err) => {
        setMsPending(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    } else {
      setError(providerError ? `登录失败：${providerError}` : "登录未返回授权码，请重试");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showPassword = config.passwordLoginEnabled;
  const showRegister = config.passwordLoginEnabled && config.registrationEnabled;
  const showMicrosoft = config.microsoftEnabled;
  const oidcLabel = config.oidcDisplayName?.trim() || "使用单点登录（OIDC）";
  const showOidc = config.oidcEnabled;
  const showLdap = config.ldapEnabled;
  const ldapLabel = config.ldapDisplayName?.trim() || "企业账号登录";
  const anySso = showMicrosoft || showOidc || showLdap;
  // 企业账号是唯一登录方式时直接呈现域账号表单，不再绕「企业账号登录」按钮，
  // 也不显示没有意义的「返回其它登录方式」。
  const ldapOnly = showLdap && !showPassword && !showOidc && !showMicrosoft;
  const formMode = ldapOnly && mode === "login" ? "ldap" : mode;
  const hasOtherWays = showPassword || showOidc || showMicrosoft;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (formMode === "ldap") await loginWithLdap(ldapUser, password);
      else if (mode === "login") await login(email, password);
      else await register(email, name, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 桌面端：主进程起本机回环监听并拉起系统浏览器；浏览器端：整页跳转授权。
  const startProvider = async (provider: "microsoft" | "oidc") => {
    setError(null);
    if (desktop?.oauthLogin) {
      setMsPending(true);
      try {
        const res = await desktop.oauthLogin(provider);
        setToken(res.token);
        addLoginHistory({ email: res.user.email, name: res.user.name, provider });
        await refreshSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMsPending(false);
      }
      return;
    }
    try {
      const path = provider === "microsoft" ? MICROSOFT_CALLBACK_PATH : OIDC_CALLBACK_PATH;
      const start = provider === "microsoft" ? api.auth.microsoftStart : api.auth.oidcStart;
      const res = await start(`${window.location.origin}${path}`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickHistory = (entry: LoginHistoryEntry) => {
    if (entry.provider === "ldap") {
      if (!showLdap) return;
      setMode("ldap");
      setLdapUser(entry.username || "");
      setPassword("");
      setError(null);
      return;
    }
    if (entry.provider !== "password" && anySso) {
      startProvider(entry.provider === "microsoft" ? "microsoft" : "oidc");
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
              <p className="text-sm font-medium">正在完成登录…</p>
              <p className="text-xs text-muted-foreground">
                {desktop ? "请在弹出的浏览器窗口中完成授权，随后自动返回本应用" : "正在验证你的账号并进入平台"}
              </p>
            </div>
          ) : (
            <>
              {formMode !== "ldap" && showPassword && showRegister && (
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

              {showLdap && !ldapOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 text-base font-semibold"
                  onClick={() => { setMode("ldap"); setError(null); }}
                >
                  <Building2 className="w-4.5 h-4.5 mr-2" />
                  {ldapLabel}
                </Button>
              )}
              {showOidc && (
                <Button
                  type="button"
                  variant="outline"
                  className={`w-full h-11 text-base font-semibold ${showLdap ? "mt-3" : ""}`}
                  onClick={() => startProvider("oidc")}
                >
                  <KeyRound className="w-4.5 h-4.5 mr-2" />
                  {oidcLabel}
                </Button>
              )}
              {showMicrosoft && (
                <Button
                  type="button"
                  variant="outline"
                  className={`w-full h-11 text-base font-semibold ${showOidc || showLdap ? "mt-3" : ""}`}
                  onClick={() => startProvider("microsoft")}
                >
                  <MicrosoftLogo className="w-4.5 h-4.5 mr-2" />
                  使用微软账号登录
                </Button>
              )}
              {anySso && showPassword && (
                <div className="flex items-center gap-3 my-6">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">或</span>
                  <div className="flex-1 border-t" />
                </div>
              )}

              {formMode === "ldap" ? (
                <form onSubmit={submit} className="space-y-4">
                  <p className="text-center text-sm font-medium text-foreground">{ldapLabel}</p>
                  <div className="space-y-2">
                    <label className="text-sm font-medium ml-1">域账号用户名</label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input value={ldapUser} onChange={(e) => setLdapUser(e.target.value)} placeholder="企业域账号" className="pl-10 h-11 bg-background/50" required autoFocus />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium ml-1">域账号密码</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="域账号密码" className="pl-10 h-11 bg-background/50" required />
                    </div>
                  </div>

                  {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}

                  <Button type="submit" className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "登 录"}
                  </Button>
                  <div className="pt-1 text-center">
                    {hasOtherWays && (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => { setMode("login"); setPassword(""); setError(null); }}
                      >
                        ← 返回其它登录方式
                      </button>
                    )}
                  </div>
                </form>
              ) : showPassword ? (
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
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
                  {!anySso && (
                    <p className="text-xs text-muted-foreground text-center">平台已关闭密码登录，请联系管理员开启一种登录方式。</p>
                  )}
                </div>
              )}

              {history.length > 0 && (showPassword || anySso) && (
                <div className="mt-6 pt-4 border-t space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1 mb-1">
                    <History className="w-3.5 h-3.5" /> 近期登录账号（仅本机记录）
                  </p>
                  {history.map((entry) => {
                    const clickable = entry.provider === "ldap"
                      ? showLdap
                      : (entry.provider !== "password" && anySso) || showPassword;
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
                        {entry.provider === "oidc" && <KeyRound className="w-3 h-3 shrink-0 text-muted-foreground" />}
                        {entry.provider === "ldap" && <Building2 className="w-3 h-3 shrink-0 text-muted-foreground" />}
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
