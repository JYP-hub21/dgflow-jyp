'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * 아이디/비밀번호 변경 — 한 창에서 함께 바꾼다 (2026-11-02 사용자 요청: "하나하나 나누지 말고 한 번에").
 * 회사가 미리 만들어 나눠 준 계정을 받은 사람이 자기 것으로 바꾸는 곳.
 * 현재 아이디는 바꿀 수 없는 칸으로 보여 주고, 바꿀 사람만 옆 '새 아이디' 칸에 쓴다 (2026-11-13 사용자 지적:
 * 현재 아이디가 입력칸에 미리 들어가 있으면 바꿀 수 있는 칸인지 알기 어렵다). 새 아이디 · 새 비밀번호를 비워 두면 바뀌지 않는다.
 * 저장할 때 현재 비밀번호로 본인 확인.
 * 열 때마다 새로 그려 입력이 남지 않게, 부모가 열려 있을 때만 그린다.
 */
export default function AccountDialog({ loginId, loginIdLocked, notice, onClose }: {
  loginId: string;
  /** 위에 띄울 안내 — 처음 비밀번호로 들어온 직원에게 변경을 권할 때 */
  notice?: string;
  /** 관리자 빠른 로그인 계정 — 공식 시작 전까지 아이디는 잠근다 */
  loginIdLocked: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ newLoginId: '', newPassword: '', confirm: '', currentPassword: '' });
  const nextLoginId = form.newLoginId.trim().toLowerCase();
  const idChanging = !!nextLoginId && nextLoginId !== loginId;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirm) { setError('새 비밀번호와 확인 값이 일치하지 않습니다.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: nextLoginId || loginId, newPassword: form.newPassword, currentPassword: form.currentPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? '변경하지 못했습니다.'); return; }
      toast.success(
        json.idChanged && json.passwordChanged ? `아이디와 비밀번호를 변경했습니다. 다음 로그인부터 ${json.loginId} 로 로그인하세요.`
          : json.idChanged ? `아이디를 변경했습니다. 다음 로그인부터 ${json.loginId} 로 로그인하세요.`
            : '비밀번호를 변경했습니다.'
      );
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field = 'h-11 rounded-xl bg-background/60';
  const label = 'text-[13px] font-semibold text-foreground';

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">아이디/비밀번호 변경</DialogTitle>
          <DialogDescription>
            바꿀 항목만 입력한 뒤 현재 비밀번호를 넣고 저장하세요. 비워 둔 항목은 지금 그대로 유지됩니다.
          </DialogDescription>
        </DialogHeader>

        {notice && (
          <p className="rounded-xl border border-brand-600/30 bg-brand-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-brand-800">
            {notice}
          </p>
        )}

        <form id="account-form" onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="account-id" className={label}>현재 아이디</Label>
                {/* 비밀번호 관리자가 새 비밀번호를 이 아이디에 묶도록 username 은 여기 둔다 — 읽기 전용이라 자동 입력되지 않는다 */}
                <Input id="account-id" name="username" autoComplete="username" readOnly tabIndex={-1}
                  value={loginId} className={`${field} cursor-default border-transparent bg-muted font-semibold text-foreground hover:border-transparent focus-visible:border-transparent focus-visible:ring-0`} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-new-id" className={label}>새 아이디</Label>
                <Input id="account-new-id" name="new-username" autoComplete="off" autoCapitalize="none" spellCheck={false}
                  placeholder={loginIdLocked ? '변경 불가' : '변경 시에만 입력'}
                  value={form.newLoginId} onChange={set('newLoginId')} disabled={loginIdLocked} maxLength={30} className={field} />
              </div>
            </div>
            <p className={`text-xs ${idChanging ? 'font-semibold text-brand-700' : 'text-muted-foreground'}`}>
              {loginIdLocked
                ? '관리자 빠른 로그인에 연결된 계정으로, 공식 시작 전까지 아이디를 변경할 수 없습니다.'
                : idChanging
                  ? `저장하면 다음 로그인부터 ${nextLoginId} 로 로그인합니다.`
                  : '비워 두면 지금 아이디를 그대로 씁니다. 영문 소문자 · 숫자, 30자 이내'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-new-pw" className={label}>새 비밀번호</Label>
              <Input id="account-new-pw" type="password" autoComplete="new-password" placeholder="변경 시에만 입력"
                value={form.newPassword} onChange={set('newPassword')} className={field} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-confirm" className={label}>새 비밀번호 확인</Label>
              <Input id="account-confirm" type="password" autoComplete="new-password"
                value={form.confirm} onChange={set('confirm')} disabled={!form.newPassword} className={field} />
            </div>
          </div>

          <div className="space-y-1.5 border-t pt-4">
            <Label htmlFor="account-current" className={label}>
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />현재 비밀번호
            </Label>
            <Input id="account-current" type="password" autoComplete="current-password" required
              value={form.currentPassword} onChange={set('currentPassword')} className={field} />
            <p className="text-xs text-muted-foreground">본인 확인을 위해 입력합니다.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] font-medium text-destructive">
              <span className="mt-px leading-none">•</span>
              {error}
            </div>
          )}
        </form>

        <DialogFooter className="-mx-6 -mb-6 px-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{notice ? '나중에' : '취소'}</Button>
          <Button type="submit" form="account-form" disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
