'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Search, ShieldCheck, UserRound } from 'lucide-react';
import Logo from '@/components/layout/Logo';
import { quickAdminLoginEnabled } from '@/lib/auth/quick-login';
import { INITIAL_PASSWORD, INITIAL_PASSWORD_FLAG } from '@/lib/auth/account';

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

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

    // 처음 비밀번호(0000) 그대로면 들어간 뒤 변경 창을 한 번 띄운다
    const result = await res.json().catch(() => ({}));
    try {
      if (result.initialPassword) sessionStorage.setItem(INITIAL_PASSWORD_FLAG, '1');
      else sessionStorage.removeItem(INITIAL_PASSWORD_FLAG);
    } catch { /* 저장소를 못 쓰면 안내 창만 안 뜬다 */ }
    window.location.href = '/';
  }

  // 아이디 찾기에서 고른 아이디를 칸에 넣고 비밀번호 칸으로
  function fillFoundId(id: string) {
    setLoginId(id);
    setError('');
    passwordRef.current?.focus();
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
                ref={passwordRef}
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

        <FirstTimeGuide onPick={fillFoundId} />

        <p className="mt-5 text-center text-sm text-muted-foreground">
          아이디 찾기에 이름이 없으면{' '}
          <Link href="/signup" className="font-semibold text-brand-800 underline-offset-4 hover:underline">
            회원가입
          </Link>
          으로 신청하세요.
        </p>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          © 동일유리(주) · DG Flow
        </p>
      </div>
    </div>
  );
}

interface Person { name: string; department: string | null; position: string | null; login_id: string }

/**
 * 처음 쓰는 사람 안내 (2026-11-12 사용자 요청).
 * 직원 계정은 회사가 미리 만들어 둔다 — 아이디는 휴가관리 시스템과 같고 처음 비밀번호는 모두 0000.
 * 이름 몇 글자로 찾아 자기 이름을 고르면 아이디가 보이고 로그인 칸에 들어간다.
 * 들어간 뒤에는 아이디 · 비밀번호를 본인 것으로 바꾸기를 권한다.
 */
function FirstTimeGuide({ onPick }: { onPick: (loginId: string) => void }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);
  const [failed, setFailed] = useState(false);

  // 칠 때마다 부르지 않고 잠깐 멈추면 찾는다
  useEffect(() => {
    const word = q.trim();
    if (!word) { setPeople(null); setFailed(false); return; }
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/auth/find-id?q=${encodeURIComponent(word)}`).catch(() => null);
      if (stale) return;
      const json = res?.ok ? await res.json().catch(() => null) : null;
      if (stale) return;
      setFailed(!json);
      setPeople(json?.people ?? []);
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [q]);

  function pick(p: Person) {
    setPicked(p);
    onPick(p.login_id);
  }

  const step = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-800 text-[11px] font-bold text-white';

  return (
    <section aria-labelledby="first-time" className="mt-4 rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(16,32,48,0.04)]">
      <h2 id="first-time" className="text-[15px] font-bold text-foreground">처음 사용하시나요?</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">직원 계정은 미리 만들어 두었습니다. 아래 순서대로 로그인하세요.</p>

      <ol className="mt-4 space-y-4 text-[13px] leading-relaxed text-foreground">
        <li className="flex gap-2.5">
          <span className={step}>1</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">이름으로 아이디를 찾습니다.</p>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => { setQ(e.target.value); setPicked(null); }}
                placeholder="이름 일부를 입력하세요 (예: 김정)" aria-label="이름으로 아이디 찾기" autoComplete="off"
                className="h-10 rounded-xl bg-background/60 pl-9" />
            </div>

            {picked ? (
              <div className="mt-2 rounded-xl border border-brand-600/30 bg-brand-50 px-3.5 py-3">
                <p className="text-[13px] text-muted-foreground">
                  {picked.name}{[picked.department, picked.position].filter(Boolean).length > 0 && ` · ${[picked.department, picked.position].filter(Boolean).join(' ')}`}
                </p>
                <p className="mt-0.5 text-[15px] font-bold text-brand-800">
                  아이디 <span className="tabular-nums text-lg">{picked.login_id}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">아이디 칸에 입력해 두었습니다.</p>
              </div>
            ) : people && (
              people.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {failed ? '찾지 못했습니다. 잠시 후 다시 시도하세요.' : '일치하는 이름이 없습니다. 이름을 다시 확인하세요.'}
                </p>
              ) : (
                <ul className="mt-2 divide-y overflow-hidden rounded-xl border bg-background/60">
                  {people.map(p => (
                    <li key={p.login_id}>
                      <button type="button" onClick={() => pick(p)}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-brand-50">
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{[p.department, p.position].filter(Boolean).join(' ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </li>
        <li className="flex gap-2.5">
          <span className={step}>2</span>
          <p>처음 비밀번호는 <b className="tabular-nums text-brand-800">{INITIAL_PASSWORD}</b> 입니다.</p>
        </li>
        <li className="flex gap-2.5">
          <span className={step}>3</span>
          <p>
            로그인한 뒤 왼쪽 메뉴 아래 <b className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" />아이디/비밀번호 변경</b>에서
            본인만 아는 아이디와 비밀번호로 변경하시기 바랍니다.
          </p>
        </li>
      </ol>
    </section>
  );
}
