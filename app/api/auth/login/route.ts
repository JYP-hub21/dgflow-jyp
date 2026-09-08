import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  // service_role이 아닌 anon key로 로그인 (일반 사용자 인증)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  // 세션 토큰을 쿠키에 직접 설정
  const response = NextResponse.json({ user: data.user });

  const cookieOptions = {
    path: '/',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7일
  };

  // Supabase SSR이 기대하는 쿠키 형식
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/\/\/(.*?)\.supabase/)?.[1] || '';
  const cookieBase = `sb-${projectRef}-auth-token`;

  // base64 인코딩된 세션을 chunked cookie로 저장
  const sessionStr = JSON.stringify(data.session);
  const encoded = Buffer.from(sessionStr).toString('base64');

  // 쿠키 크기 제한 (4KB) 때문에 청크로 분할
  const chunkSize = 3500;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += chunkSize) {
    chunks.push(encoded.slice(i, i + chunkSize));
  }

  if (chunks.length === 1) {
    response.cookies.set(cookieBase, encoded, cookieOptions);
  } else {
    chunks.forEach((chunk, i) => {
      response.cookies.set(`${cookieBase}.${i}`, chunk, cookieOptions);
    });
  }

  return response;
}
