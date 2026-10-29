import type { FormEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { api } from "../services/api";
import { reloadMemberships, useSession } from "../lib/session";
import { Modal } from "./common";

// 个人设置：登录后自助维护姓名 / 登录邮箱 / 密码。邮箱与密码属于登录凭据，
// 服务端要求携带当前密码才允许修改；姓名可单独改。
export function ProfileSettings({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailChanged = !!user && email.trim().toLowerCase() !== user.email.toLowerCase();
  const needCurrent = emailChanged || newPassword !== "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("请输入姓名");
    if (newPassword && newPassword.length < 6) return setError("新密码至少 6 位");
    if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致");
    if (needCurrent && !currentPassword) return setError("修改邮箱或密码需要验证当前密码");
    setSaving(true);
    try {
      const body: { name: string; email?: string; password?: string; currentPassword?: string } = { name: name.trim() };
      if (emailChanged) {
        body.email = email.trim().toLowerCase();
        body.currentPassword = currentPassword;
      }
      if (newPassword) {
        body.password = newPassword;
        body.currentPassword = currentPassword;
      }
      await api.auth.updateMe(body);
      // 刷新会话中的用户信息（侧边栏、成员列表等处同步显示新名字/邮箱）。
      await reloadMemberships();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="个人设置" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">姓名</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示在界面上的名字" required />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">登录邮箱</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
          <p className="text-xs text-muted-foreground">修改登录邮箱后，下次登录请使用新邮箱。</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">当前密码</label>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={needCurrent ? "修改邮箱 / 密码必填" : "不修改邮箱或密码可留空"}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">新密码</label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 位，留空不改" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">确认新密码</label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={saving || !name.trim() || !email.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存修改"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
