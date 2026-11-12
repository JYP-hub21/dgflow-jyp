/**
 * '관리자 계정으로 로그인' 버튼 (2026-10-30 사용자 요청 — 시연 · 확인용).
 *
 * 운영 사이트는 인터넷에 열려 있어서, 버튼이 보이면 주소를 아는 누구나 마스터로 들어온다
 * (예전 팀원이 마스터 자동 입력 버튼을 지운 이유). 그래서
 *  · 개발 서버(npm run dev)에서는 늘 켜고
 *  · 운영(next build)에서는 환경변수 NEXT_PUBLIC_ADMIN_QUICK_LOGIN=on 이거나, 공식 시작 전(PRE_LAUNCH)일 때만 켠다.
 * 비밀번호는 화면 코드에 없다 — 서버가 일회용 로그인 토큰으로 세션을 연다 (/api/auth/quick-admin).
 */
export const QUICK_ADMIN_LOGIN_ID = 'admin';

/**
 * 공식으로 쓰기 시작하기 전(시연 · 확인 기간)에는 운영 사이트에도 버튼을 두었다 — 2026-11-02 사용자 결정.
 * 2026-11-12 끔: 교수님 · 팀원 · 대표이사 · 이사가 각자 관리자 계정을 갖게 되어 운영 화면에서 버튼을 없앴다
 * (사용자 "관리자 계정으로 로그인 그걸 없애는 거지"). 개발 서버에서는 그대로 보인다.
 */
export const PRE_LAUNCH = false;

export function quickAdminLoginEnabled(): boolean {
  return PRE_LAUNCH || process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN === 'on';
}

/**
 * 빠른 로그인은 아이디(QUICK_ADMIN_LOGIN_ID)로 관리자 계정을 찾는다.
 * 켜져 있는 동안 그 계정의 아이디를 바꾸면 버튼이 끊기므로 아이디/비밀번호 변경에서 아이디만 잠근다.
 */
export function loginIdLocked(loginId: string): boolean {
  return loginId === QUICK_ADMIN_LOGIN_ID && quickAdminLoginEnabled();
}
