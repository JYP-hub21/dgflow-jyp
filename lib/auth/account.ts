/**
 * 아이디 · 비밀번호 · 가입 정보 규칙.
 *
 * 회사 사람들이 쓰는 시스템이라 아이디는 이니셜 같은 짧은 영문, 비밀번호는 제약 없이(빈칸만 아니면).
 * 그런데 Supabase Auth 는 이메일 아이디와 6자(바이트) 이상 비밀번호만 받는다. 그래서
 *   - 아이디 → `{아이디}@dgflow.local` 이메일로 바꿔 저장하고
 *   - 6바이트보다 짧은 비밀번호 → 뒤에 고정 글자를 붙여 저장한다.
 * 가입·로그인·비밀번호 초기화가 모두 이 함수들을 거쳐야 서로 맞는다.
 */

export const LOGIN_EMAIL_DOMAIN = 'dgflow.local';

/**
 * 회사가 미리 만들어 나눠 주는 직원 계정의 처음 비밀번호 (2026-11-12 사용자 결정: 모두 0000 고정).
 * 로그인 화면 안내에 쓰고, 이 비밀번호로 들어오면 바꾸기를 권한다.
 */
export const INITIAL_PASSWORD = '0000';

/** 처음 비밀번호로 들어왔다는 표시 — 로그인 화면이 남기고, 사이드바가 읽어 변경 창을 한 번 띄운다 */
export const INITIAL_PASSWORD_FLAG = 'dgflow-initial-password';

/** 영문 소문자 · 숫자로 시작, 그 뒤로 . _ - 도 허용. 1~30자 */
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,29}$/;

/** 대소문자를 가리지 않는다 — `HJ` 와 `hj` 는 같은 아이디 */
export function normalizeLoginId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function loginIdError(loginId: string): string | null {
  if (!loginId) return '아이디를 입력하세요.';
  if (!LOGIN_ID_RE.test(loginId)) {
    return '아이디는 영문 소문자와 숫자로 입력하세요 (가운데에 . _ - 사용 가능, 30자 이내).';
  }
  return null;
}

export function loginIdToEmail(loginId: string): string {
  return `${loginId}@${LOGIN_EMAIL_DOMAIN}`;
}

const PASSWORD_PAD = '::dgflow-pw';
const AUTH_MIN_BYTES = 6;

/** 사용자가 친 비밀번호 → Supabase 에 넘길 비밀번호 */
export function toAuthPassword(password: string): string {
  return new TextEncoder().encode(password).length >= AUTH_MIN_BYTES ? password : password + PASSWORD_PAD;
}

export function passwordError(password: string): string | null {
  if (!password) return '비밀번호를 입력하세요.';
  return null;
}

export interface AccountChangeInput {
  loginId: string;
  newPassword: string;
  currentPassword: string;
}

/**
 * 본인 아이디/비밀번호 변경 검사 (2026-11-02).
 * 아이디는 그대로 두면, 새 비밀번호는 비워 두면 바꾸지 않는다 — 바뀌는 것만 null 이 아니다.
 * 무엇을 바꾸든 현재 비밀번호가 있어야 한다 (맞는지는 서버가 Auth 로 확인).
 */
export function validateAccountChange(currentLoginId: string, input: AccountChangeInput):
  { error: string } | { value: { loginId: string | null; password: string | null } } {
  const loginId = normalizeLoginId(input.loginId ?? '');
  const idChanged = loginId !== currentLoginId;
  if (idChanged) {
    const err = loginIdError(loginId);
    if (err) return { error: err };
  }
  const password = input.newPassword || null;
  if (!idChanged && !password) return { error: '변경된 내용이 없습니다.' };
  if (!input.currentPassword) return { error: '현재 비밀번호를 입력하세요.' };
  return { value: { loginId: idChanged ? loginId : null, password } };
}

/** 숫자만 남겨 010-1234-5678 꼴로. 자릿수가 이상하면 null */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) {
    return d.startsWith('02')
      ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`
      : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return null;
}

/** YYYY-MM-DD 이고 실제 있는 날짜이며 오늘 이전 */
export function birthDateError(value: string): string | null {
  if (!value) return '생년월일을 입력하세요.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return '생년월일은 YYYY-MM-DD 로 입력하세요.';
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return '없는 날짜입니다.';
  if (Number(m[1]) < 1900 || d > new Date()) return '생년월일을 확인하세요.';
  return null;
}

export interface SignupInput {
  loginId: string;
  password: string;
  name: string;
  phone: string;
  birthDate: string;
  department: string;
  position: string;
}

/** 가입 신청서 검사. 문제가 있으면 첫 문제의 안내문, 없으면 정리된 값 */
export function validateSignup(input: SignupInput):
  { error: string } | { value: SignupInput } {
  const loginId = normalizeLoginId(input.loginId ?? '');
  const name = (input.name ?? '').trim();
  const department = (input.department ?? '').trim();
  const position = (input.position ?? '').trim();

  const idErr = loginIdError(loginId);
  if (idErr) return { error: idErr };
  const pwErr = passwordError(input.password ?? '');
  if (pwErr) return { error: pwErr };
  if (!name) return { error: '이름을 입력하세요.' };
  const phone = normalizePhone(input.phone ?? '');
  if (!phone) return { error: '전화번호를 확인하세요. (예: 010-1234-5678)' };
  const bdErr = birthDateError(input.birthDate ?? '');
  if (bdErr) return { error: bdErr };
  if (!department) return { error: '부서를 입력하세요.' };
  if (!position) return { error: '직책을 입력하세요.' };

  return { value: { loginId, password: input.password, name, phone, birthDate: input.birthDate, department, position } };
}
