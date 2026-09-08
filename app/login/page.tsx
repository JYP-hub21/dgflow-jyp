'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TEST_ACCOUNTS = [
  { name: '안광식', role: '공사관리부', email: 'ahn@dgflow.kr' },
  { name: '이충언', role: '공사관리부', email: 'lee@dgflow.kr' },
  { name: '김길홍', role: '공사관리부', email: 'kim@dgflow.kr' },
  { name: '오동석', role: '공사관리부', email: 'oh@dgflow.kr' },
  { name: '이지원', role: '경영지원팀', email: 'support@dgflow.kr' },
  { name: '김경영', role: '관리자', email: 'admin@dgflow.kr' },
  { name: '최생산', role: '생산관리팀', email: 'production@dgflow.kr' },
  { name: '정시스', role: '시스템관리자', email: 'sysadmin@dgflow.kr' },
];
const TEST_PASSWORD = 'dgflow2026!';

const ROLE_COLORS: Record<string, string> = {
  '공사관리부': 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  '경영지원팀': 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  '관리자': 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  '생산관리팀': 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
  '시스템관리자': 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function fillAccount(acctEmail: string) {
    setEmail(acctEmail);
    setPassword(TEST_PASSWORD);
    setError('');
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.session) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
      return;
    }

    await fetch('/api/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }),
    });

    window.location.href = '/dashboard';
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 px-4">
      <div className="w-full max-w-md space-y-5">
        {/* 로고 영역 */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-200">
            <span className="text-2xl font-black text-white tracking-tight">DG</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">DG-Flow</h1>
          <p className="mt-1 text-sm text-gray-500">동일유리 주문관리 시스템</p>
        </div>

        {/* 로그인 폼 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">이메일</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="email@dgflow.kr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">비밀번호</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </div>
            )}
            <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </div>

        {/* 테스트 계정 */}
        <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-4 backdrop-blur-sm">
          <p className="mb-3 text-center text-xs font-medium text-gray-400">
            테스트 계정 — 클릭하면 자동 입력
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {TEST_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => fillAccount(acc.email)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${ROLE_COLORS[acc.role] || ''}`}
              >
                {acc.name}
                <span className="ml-1 opacity-60">{acc.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
