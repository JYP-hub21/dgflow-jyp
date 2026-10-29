'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Logo from '@/components/layout/Logo';
import { validateSignup, type SignupInput } from '@/lib/auth/account';

const EMPTY: SignupInput = {
  name: '', phone: '', birthDate: '', department: '', position: '', loginId: '', password: '',
};

/**
 * 회원가입 신청. 가입하면 승인 대기 상태가 되고, 관리자가 사용자 관리에서 승인하면 로그인된다.
 * 아이디는 영문 아무거나(이니셜도 됨), 비밀번호는 빈칸만 아니면 된다.
 */
export default function SignupPage() {
  const [form, setForm] = useState<SignupInput>(EMPTY);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: keyof SignupInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    const checked = validateSignup(form);
    if ('error' in checked) { setError(checked.error); return; }
    // 비밀번호에 제약이 없어 오타를 잡을 길이 이것뿐이다
    if (form.password !== confirm) { setError('비밀번호 확인이 다릅니다.'); return; }

    setLoading(true);
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      setError(result.error || '가입 신청을 보내지 못했습니다.');
      return;
    }
    setDone(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'radial-gradient(60rem 40rem at 15% -10%, var(--brand-100), transparent 60%), radial-gradient(50rem 34rem at 110% 110%, var(--brand-50), transparent 55%)',
        }}
      />

      <div className="relative w-full max-w-[30rem]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" priority />
          <p className="mt-4 text-[13px] font-medium tracking-wide text-muted-foreground">회원가입</p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-[0_1px_2px_rgba(16,32,48,0.04),0_12px_32px_-12px_rgba(16,32,48,0.18)]">
          {done ? (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
              <p className="mt-4 text-lg font-bold">가입 신청을 보냈습니다</p>
              <p className="mt-2 text-sm text-muted-foreground">
                관리자가 승인하면 <b className="text-foreground">{form.loginId.trim().toLowerCase()}</b> 아이디로 로그인할 수 있습니다.
              </p>
              <Link href="/login"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-800 text-sm font-semibold text-white hover:bg-brand-700">
                로그인 화면으로
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-bold tracking-wider text-muted-foreground">개인 정보</legend>
                <Field id="name" label="이름">
                  <Input id="name" autoComplete="name" value={form.name} onChange={set('name')} placeholder="홍길동" className="h-11" />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="phone" label="전화번호">
                    <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')}
                      placeholder="010-1234-5678" className="h-11" />
                  </Field>
                  <Field id="birthDate" label="생년월일">
                    <Input id="birthDate" type="date" value={form.birthDate} onChange={set('birthDate')}
                      max={new Date().toISOString().slice(0, 10)} className="h-11" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="department" label="부서">
                    <Input id="department" value={form.department} onChange={set('department')} placeholder="공사관리부" className="h-11" />
                  </Field>
                  <Field id="position" label="직책">
                    <Input id="position" value={form.position} onChange={set('position')} placeholder="대리" className="h-11" />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-bold tracking-wider text-muted-foreground">로그인 정보</legend>
                <Field id="loginId" label="아이디" hint="영문 · 숫자. 이니셜처럼 짧아도 됩니다">
                  <Input id="loginId" autoComplete="username" autoCapitalize="none" value={form.loginId} onChange={set('loginId')}
                    placeholder="hgd" className="h-11" />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="password" label="비밀번호" hint="빈칸만 아니면 됩니다">
                    <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className="h-11" />
                  </Field>
                  <Field id="confirm" label="비밀번호 확인">
                    <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className="h-11" />
                  </Field>
                </div>
              </fieldset>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] font-medium text-destructive">
                  <span className="mt-px leading-none">•</span>
                  {error}
                </div>
              )}

              <Button type="submit" disabled={loading}
                className="h-11 w-full rounded-xl bg-brand-800 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {loading ? '보내는 중…' : '가입 신청'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">관리자가 승인해야 로그인할 수 있습니다.</p>
            </form>
          )}
        </div>

        {!done && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            이미 계정이 있나요?{' '}
            <Link href="/login" className="font-semibold text-brand-800 underline-offset-4 hover:underline">로그인</Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-semibold text-foreground">
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
