import type { ReactNode } from "react";
import { Component } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="p-10 flex flex-col items-center justify-center text-center gap-3 border-dashed">
      {Icon && <Icon className="w-9 h-9 text-muted-foreground/40" />}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {action}
    </Card>
  );
}

// 局部渲染出错（如 Agent 产出结构异常）时降级为错误卡片，而不是整页空白。
// react 类型由 JS 推断，无法直接以 Component 为基类声明 props/setState，这里只声明用到的结构。
const ReactComponent = Component as unknown as new (props: { children?: ReactNode }) => {
  props: { children?: ReactNode };
  setState(s: { error: Error | null }): void;
};

export class ErrorBoundary extends ReactComponent {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="p-10 flex flex-col items-center justify-center text-center gap-3 border-dashed">
        <AlertTriangle className="w-9 h-9 text-amber-500/70" />
        <div>
          <p className="font-medium">页面渲染出错</p>
          <p className="text-sm text-muted-foreground mt-1 break-all max-w-xl">{this.state.error.message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>重试</Button>
      </Card>
    );
  }
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "blue" | "violet" | "emerald" | "amber" | "rose";
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    default: "bg-muted text-foreground",
    blue: "bg-blue-500/10 text-blue-600",
    violet: "bg-violet-500/10 text-violet-600",
    emerald: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-600",
    rose: "bg-rose-500/10 text-rose-600",
  };
  return (
    <Card
      className={`p-4 ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${tones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground mt-3">{hint}</p>}
    </Card>
  );
}

export type PillTone = "gray" | "blue" | "green" | "amber" | "rose" | "violet";

const pillTones: Record<PillTone, string> = {
  gray: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-300",
  blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  green: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  violet: "bg-violet-500/10 text-violet-600 border-violet-500/20",
};

export function Pill({ children, tone = "gray", className = "", key }: { children: ReactNode; tone?: PillTone; className?: string; key?: string | number }) {
  return (
    <span key={key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${pillTones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): PillTone {
  switch (status) {
    case "done":
    case "passed":
    case "succeeded":
    case "success":
    case "up":
    case "completed":
    case "active":
    case "resolved":
    case "sent":
      return "green";
    case "running":
    case "reviewing":
    case "designing":
    case "pending":
      return "blue";
    case "queued":
    case "assigned":
    case "open":
    case "warning":
      return "amber";
    case "failed":
    case "down":
    case "critical":
      return "rose";
    default:
      return "gray";
  }
}

export const statusLabel: Record<string, string> = {
  draft: "草稿",
  designed: "已设计",
  designing: "设计中",
  completed: "已完成",
  queued: "排队中",
  assigned: "已分配",
  running: "执行中",
  reviewing: "评审中",
  done: "已完成",
  failed: "失败",
  pending: "待处理",
  passed: "通过",
  succeeded: "成功",
  success: "成功",
  up: "正常",
  down: "异常",
  unknown: "未知",
  open: "未处理",
  acknowledged: "已确认",
  resolved: "已解决",
  sent: "成功",
  info: "提示",
  warning: "警告",
  critical: "严重",
  low: "低",
  medium: "中",
  high: "高",
  human: "人工",
  agent: "Agent",
  transcode: "Transcode",
  claude: "Claude Code",
  opencode: "opencode",
  auto: "自动",
  dev: "开发",
  test: "测试",
  staging: "预发",
  production: "生产",
  linux: "Linux",
  windows: "Windows",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <Pill tone={statusTone(status)}>{label ?? statusLabel[status] ?? status}</Pill>;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return value;
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

export function Select({
  value,
  onChange,
  children,
  className = "",
  id,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring ${className}`}
    >
      {children}
    </select>
  );
}

export function Textarea({
  value,
  onChange,
  rows = 4,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring ${className}`}
    />
  );
}

// 轻量居中弹窗：点击遮罩关闭，wide 控制宽度。原先定义在 TeamSelect，因
// 个人设置等组件也需要（且 TeamSelect 反向引用它们），移到公共模块。
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className={`bg-card border rounded-xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[88vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="w-4 h-4" /></Button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
}

// 开关。原先只定义在 PlatformSettings 里，告警配置页也要用，移到公共模块。
export function Toggle({
  checked, onChange, disabled, ariaLabel,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
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

export function SwitchRow({
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

export const alertProviderLabel: Record<string, string> = { dingtalk: "钉钉", wecom: "企微", feishu: "飞书" };
export const alertEventLabel: Record<string, string> = {
  monitor: "监控告警", manual: "手工问题", status: "状态变化", test: "测试消息",
};
