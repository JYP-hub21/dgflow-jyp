'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck } from 'lucide-react';
import Logo from '@/components/layout/Logo';
import { quickAdminLoginEnabled } from '@/lib/auth/quick-login';

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 서버가 아이디로 계정을 찾아 로그인하고 세션 쿠키를 심는다 (승인 대기면 이유를 돌려준다)
  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password }),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      setError(result.error || '로그인하지 못했습니다.');
      setLoading(false);
      return;
    }

    window.location.href = '/';
  }

  // 관리자 계정으로 바로 — 개발 서버에서만, 운영은 켜 둔 경우에만 보인다 (lib/auth/quick-login.ts)
  async function handleQuickAdmin() {
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/quick-admin', { method: 'POST' });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      setError(result.error || '관리자 계정으로 로그인하지 못했습니다.');
      setLoading(false);
      return;
    }
    window.location.href = '/';
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* 배경 장식 — 유리의 결을 연상시키는 은은한 사선 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'radial-gradient(60rem 40rem at 15% -10%, var(--brand-100), transparent 60%), radial-gradient(50rem 34rem at 110% 110%, var(--brand-50), transparent 55%)',
        }}
      />

      <div className="relative w-full max-w-[26rem]">
        {/* 로고 */}
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size="lg" withTitle priority />
        </div>

        {/* 로그인 폼 */}
        <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-[0_1px_2px_rgba(16,32,48,0.04),0_12px_32px_-12px_rgba(16,32,48,0.18)]">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="loginId" className="text-[13px] font-semibold text-foreground">
                아이디
              </Label>
              <Input
                id="loginId"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                required
                className="h-11 rounded-xl bg-background/60"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
                비밀번호
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 rounded-xl bg-background/60"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] font-medium text-destructive">
                <span className="mt-px leading-none">•</span>
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="h-11 w-full rounded-xl bg-brand-800 text-sm font-semibold tracking-wide text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md disabled:opacity-60"
              disabled={loading}
            >
              {loading ? '로그인 중…' : '로그인'}
            </Button>
          </form>

          {quickAdminLoginEnabled() && (
            <>
              <div className="my-4 flex items-center gap-3 text-[12px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />또는<span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" onClick={handleQuickAdmin} disabled={loading}
                className="h-11 w-full rounded-xl text-sm font-semibold">
                <ShieldCheck />관리자 계정으로 로그인
              </Button>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          처음 오셨나요?{' '}
          <Link href="/signup" className="font-semibold text-brand-800 underline-offset-4 hover:underline">
            회원가입
          </Link>
        </p>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          © 동일유리(주) · DG Flow
        </p>
      </div>
    </div>
  );
}
