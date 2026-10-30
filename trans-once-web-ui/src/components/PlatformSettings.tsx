import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ShieldAlert } from "lucide-react";
import type { AuthSettings } from "../types";
import { api } from "../services/api";
import { Modal } from "./common";

// 平台登录设置（仅超级管理员）：密码登录 / 注册开关，微软与通用 OIDC 客户端配置。
// 三个区块以 tab 呈现；Client Secret 只写不读：留空提交表示保留已存的值。
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full transition-colors shrink-0 relative ${checked ? "bg-primary" : "bg-muted-foreground/30"} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {/* 手柄用 bg-background：暗色主题下 --primary 接近纯白，白手柄会隐没在轨道里。
          left-0 必须显式声明：absolute 元素缺 left 时取静态位置，按钮内容居中会把
          手柄横向顶出去 ~20px，两种状态都大半漂在胶囊外，看起来像没有手柄。 */}
      <span className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

function SwitchRow({
  title, description, checked, onChange, disabled,
}: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-background/50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function LockedHint({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
      <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      {children}
    </p>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />;
}

export function PlatformSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AuthSettings | null>(null);
  const [secret, setSecret] = useState("");
  const [oidcSecret, setOidcSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.auth.authSettings().then(setSettings).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const patch = (p: Partial<AuthSettings>) =>
    setSettings((s) => (s ? { ...s, ...p } : s));
  const patchMs = (p: Partial<AuthSettings["microsoft"]>) =>
    setSettings((s) => (s ? { ...s, microsoft: { ...s.microsoft, ...p } } : s));
  const patchOidc = (p: Partial<AuthSettings["oidc"]>) =>
    setSettings((s) => (s ? { ...s, oidc: { ...s.oidc, ...p } } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      const body: {
        passwordLoginEnabled: boolean;
        registrationEnabled: boolean;
        microsoft: Record<string, unknown>;
        oidc: Record<string, unknown>;
      } = {
        passwordLoginEnabled: settings.passwordLoginEnabled,
        registrationEnabled: settings.registrationEnabled,
        microsoft: {
          enabled: settings.microsoft.enabled,
          tenantId: settings.microsoft.tenantId.trim() || "common",
          clientId: settings.microsoft.clientId.trim(),
        },
        oidc: {
          enabled: settings.oidc.enabled,
          issuerUrl: settings.oidc.issuerUrl.trim().replace(/\/+$/, ""),
          clientId: settings.oidc.clientId.trim(),
          displayName: settings.oidc.displayName.trim(),
          scope: settings.oidc.scope.trim() || "openid profile email",
        },
      };
      if (secret.trim() !== "") body.microsoft.clientSecret = secret.trim();
      if (oidcSecret.trim() !== "") body.oidc.clientSecret = oidcSecret.trim();
      const next = await api.auth.updateAuthSettings(body);
      setSettings(next);
      setSecret("");
      setOidcSecret("");
      setToast("登录设置已保存，立即生效");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const msConfigured = !!settings?.microsoft.clientId && settings?.microsoft.hasClientSecret;
  // 开关在配齐配置前保持锁定（后端同样拒绝未配置即开启）。
  const msToggleLocked = !msConfigured && !secret.trim();
  const oidcConfigured =
    !!settings?.oidc.issuerUrl && !!settings?.oidc.clientId && settings?.oidc.hasClientSecret;
  const oidcToggleLocked = !oidcConfigured && !oidcSecret.trim();
  // 桌面端 app:// 不是可注册的回调地址，提示改用浏览器地址。
  const webOrigin =
    window.location.protocol === "http:" || window.location.protocol === "https:"
      ? window.location.origin
      : "";

  const callbackHint = (path: string) =>
    webOrigin ? (
      <code className="text-xs text-primary break-all">{webOrigin}{path}</code>
    ) : (
      <p className="text-xs text-muted-foreground">
        当前在桌面客户端。浏览器端回调为 平台地址 + <code className="text-xs">{path}</code>（例如
        <code className="text-xs">http://localhost:3002{path}</code>）；桌面端登录走本机回环，无需注册。
      </p>
    );

  return (
    <Modal title="平台登录设置" onClose={onClose}>
      {!settings ? (
        <div className="flex items-center justify-center py-10">
          {error ? <p className="text-sm text-destructive">{error}</p> : <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
          {toast && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{toast}</p>}

          <Tabs defaultValue="basic">
            <TabsList className="w-full">
              <TabsTrigger value="basic">登录方式</TabsTrigger>
              <TabsTrigger value="microsoft"><StatusDot on={settings.microsoft.enabled && msConfigured} />微软登录</TabsTrigger>
              <TabsTrigger value="oidc"><StatusDot on={settings.oidc.enabled && oidcConfigured} />OIDC 登录</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="pt-3 space-y-2.5">
              <SwitchRow
                title="密码登录"
                description="关闭后仅超级管理员仍可用邮箱密码登录（防止误锁），其他用户只能走三方登录。"
                checked={settings.passwordLoginEnabled}
                onChange={(v) => patch({ passwordLoginEnabled: v })}
              />
              <SwitchRow
                title="开放注册"
                description="关闭后登录页不再显示注册入口，注册接口同时拒绝新用户。"
                checked={settings.registrationEnabled}
                onChange={(v) => patch({ registrationEnabled: v })}
              />
            </TabsContent>

            <TabsContent value="microsoft" className="pt-3 space-y-2.5">
              <SwitchRow
                title="启用微软登录"
                description={msToggleLocked
                  ? "先在下方填好 Client ID 与 Client Secret，此开关才会解锁（后端也会拒绝无配置开启）。"
                  : "用户使用微软账号授权登录；按邮箱匹配账号，不存在时自动注册。"}
                checked={settings.microsoft.enabled}
                onChange={(v) => patchMs({ enabled: v })}
                disabled={msToggleLocked}
              />
              {msToggleLocked && (
                <LockedHint>还缺少 Azure 应用信息：按下方步骤注册应用并把 Client ID / Client Secret 填入，开关即自动解锁。</LockedHint>
              )}
              <div className="rounded-lg border bg-background/50 px-3.5 py-3 space-y-3">
                <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">还没有 Azure 应用？四步获取：</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>portal.azure.com → Microsoft Entra ID → 应用注册 → 新注册</li>
                    <li>重定向 URI 平台选「单页应用程序(SPA)」，地址填下方回调地址</li>
                    <li>概述页复制「应用程序(客户端)ID」「目录(租户)ID」</li>
                    <li>证书和密码 → 新客户端密码 → 复制「值」（只显示一次）填入下方 Client Secret</li>
                  </ol>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tenant ID</label>
                  <Input
                    value={settings.microsoft.tenantId}
                    onChange={(e) => patchMs({ tenantId: e.target.value })}
                    placeholder="common（个人 + 组织账号）或租户 GUID"
                  />
                  <p className="text-xs text-muted-foreground">单一租户填租户 GUID；全员（含个人账号）用 common。</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Client ID（应用程序 ID）</label>
                  <Input
                    value={settings.microsoft.clientId}
                    onChange={(e) => patchMs({ clientId: e.target.value })}
                    placeholder="Azure 应用注册的应用程序（客户端）ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Client Secret（客户端密钥）</label>
                  <Input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={settings.microsoft.hasClientSecret ? `已保存（${settings.microsoft.clientSecretMasked ?? "••••"}），留空不修改` : "输入新的密钥值"}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">加密存储；提交时留空表示保留已保存的密钥。</p>
                </div>
                <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2">
                  <p className="text-xs font-medium">回调地址（重定向 URI）</p>
                  {callbackHint("/login/microsoft")}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    请在 Azure「应用注册 → 身份验证」中添加为重定向 URI（平台类型选“单页应用程序”）。
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="oidc" className="pt-3 space-y-2.5">
              <SwitchRow
                title="启用 OIDC 登录"
                description={oidcToggleLocked
                  ? "先在下方填好 Issuer 地址、Client ID 与 Client Secret，此开关才会解锁。"
                  : "对接任意 OpenID Connect 身份服务（Keycloak / Casdoor / Authing / Okta / Google…），按邮箱匹配账号，不存在时自动注册。"}
                checked={settings.oidc.enabled}
                onChange={(v) => patchOidc({ enabled: v })}
                disabled={oidcToggleLocked}
              />
              {oidcToggleLocked && (
                <LockedHint>还缺少身份服务信息：填好 Issuer / Client ID / Client Secret 后开关自动解锁。</LockedHint>
              )}
              <div className="rounded-lg border bg-background/50 px-3.5 py-3 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Issuer 地址</label>
                  <Input
                    value={settings.oidc.issuerUrl}
                    onChange={(e) => patchOidc({ issuerUrl: e.target.value })}
                    placeholder="例如 https://sso.example.com/realms/main"
                  />
                  <p className="text-xs text-muted-foreground">
                    身份服务的 Issuer；平台自动读取其 /.well-known/openid-configuration，无需手填端点。内网 http 地址亦可。
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Client ID（客户端 ID）</label>
                  <Input
                    value={settings.oidc.clientId}
                    onChange={(e) => patchOidc({ clientId: e.target.value })}
                    placeholder="身份服务中注册的应用 Client ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Client Secret（客户端密钥）</label>
                  <Input
                    type="password"
                    value={oidcSecret}
                    onChange={(e) => setOidcSecret(e.target.value)}
                    placeholder={settings.oidc.hasClientSecret ? `已保存（${settings.oidc.clientSecretMasked ?? "••••"}），留空不修改` : "输入新的密钥值"}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">加密存储；提交时留空表示保留已保存的密钥。</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">按钮显示名称</label>
                    <Input
                      value={settings.oidc.displayName}
                      onChange={(e) => patchOidc({ displayName: e.target.value })}
                      placeholder="使用 SSO 登录"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Scope</label>
                    <Input
                      value={settings.oidc.scope}
                      onChange={(e) => patchOidc({ scope: e.target.value })}
                      placeholder="openid profile email"
                    />
                  </div>
                </div>
                <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2">
                  <p className="text-xs font-medium">回调地址（重定向 URI）</p>
                  {callbackHint("/login/oidc")}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    在身份服务中把该地址加入应用的 Redirect URI。
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between gap-2 pt-1">
            {settings.microsoft.enabled || settings.oidc.enabled ? (
              <Badge variant="secondary" className={msConfigured || oidcConfigured ? "bg-emerald-50 text-emerald-700 border-emerald-200" : ""}>
                {settings.microsoft.enabled && !settings.oidc.enabled
                  ? `微软登录${msConfigured ? "已就绪" : "待配置"}`
                  : !settings.microsoft.enabled && settings.oidc.enabled
                    ? `OIDC 登录${oidcConfigured ? "已就绪" : "待配置"}`
                    : `微软/OIDC ${msConfigured && oidcConfigured ? "已就绪" : "待配置"}`}
              </Badge>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>关闭</Button>
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存设置"}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
