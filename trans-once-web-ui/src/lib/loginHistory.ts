// 历史登录用户：本地记录最近成功登录的账号，登录页点击即可回填邮箱。
// 仅存于浏览器 localStorage，不含任何凭据；每台设备各自维护，上限 5 条。

const KEY = "transonce.loginHistory";
const MAX = 5;

export type LoginHistoryEntry = {
  email: string;
  name: string;
  provider: "password" | "microsoft" | "oidc" | "ldap";
  at: number;
  // LDAP 登录的历史记录回填用的域账号用户名（其它登录方式为空）。
  username?: string;
};

export function listLoginHistory(): LoginHistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is LoginHistoryEntry =>
        !!e && typeof e.email === "string" && typeof e.name === "string")
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function addLoginHistory(entry: Omit<LoginHistoryEntry, "at">): void {
  const rest = listLoginHistory().filter((e) => e.email.toLowerCase() !== entry.email.toLowerCase());
  localStorage.setItem(KEY, JSON.stringify([{ ...entry, at: Date.now() }, ...rest].slice(0, MAX)));
}

export function removeLoginHistory(email: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(listLoginHistory().filter((e) => e.email.toLowerCase() !== email.toLowerCase())),
  );
}
