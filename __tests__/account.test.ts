import { describe, it, expect } from 'vitest';
import {
  birthDateError, loginIdError, loginIdToEmail, normalizeLoginId, normalizePhone, toAuthPassword, validateAccountChange, validateSignup,
} from '@/lib/auth/account';
import { loginIdLocked, quickAdminLoginEnabled, QUICK_ADMIN_LOGIN_ID } from '@/lib/auth/quick-login';

describe('아이디', () => {
  it('이니셜 같은 짧은 영문도 된다', () => {
    expect(loginIdError('hj')).toBeNull();
    expect(loginIdError('k')).toBeNull();
    expect(loginIdError('kim.hj_2')).toBeNull();
  });

  it('대소문자를 가리지 않는다', () => {
    expect(normalizeLoginId('  HJ ')).toBe('hj');
  });

  it('한글 · 공백 · 기호로 시작하는 아이디는 받지 않는다', () => {
    expect(loginIdError('홍길동')).not.toBeNull();
    expect(loginIdError('h j')).not.toBeNull();
    expect(loginIdError('.hj')).not.toBeNull();
    expect(loginIdError('')).not.toBeNull();
  });

  it('Auth 이메일로 바꿔 저장한다', () => {
    expect(loginIdToEmail('hj')).toBe('hj@dgflow.local');
  });
});

describe('비밀번호 — Supabase 최소 6바이트를 사용자에게서 감춘다', () => {
  it('짧은 비밀번호는 늘리고, 6바이트 이상은 그대로 둔다 (기존 계정이 그대로 로그인된다)', () => {
    expect(toAuthPassword('1').length).toBeGreaterThanOrEqual(6);
    expect(toAuthPassword('1')).not.toBe(toAuthPassword('2'));
    expect(toAuthPassword('dgflow2026!')).toBe('dgflow2026!');
    expect(toAuthPassword('123456')).toBe('123456');
  });

  it('한글 두 글자는 6바이트라 그대로 둔다', () => {
    expect(toAuthPassword('유리')).toBe('유리');
  });
});

describe('가입 정보', () => {
  it('전화번호는 숫자만 보고 하이픈 꼴로 맞춘다', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678');
    expect(normalizePhone('010 1234 5678')).toBe('010-1234-5678');
    expect(normalizePhone('0212345678')).toBe('02-1234-5678');
    expect(normalizePhone('0331234567')).toBe('033-123-4567');
    expect(normalizePhone('123')).toBeNull();
  });

  it('생년월일은 실제 있는 과거 날짜만', () => {
    expect(birthDateError('1990-05-01')).toBeNull();
    expect(birthDateError('1990-02-30')).not.toBeNull();
    expect(birthDateError('2999-01-01')).not.toBeNull();
    expect(birthDateError('')).not.toBeNull();
  });

  it('신청서 전체를 검사하고 값을 정리해 돌려준다', () => {
    const ok = validateSignup({
      loginId: ' HJ ', password: '1', name: ' 홍길동 ', phone: '01012345678',
      birthDate: '1990-05-01', department: '생산부', position: '대리',
    });
    expect(ok).toEqual({ value: expect.objectContaining({ loginId: 'hj', name: '홍길동', phone: '010-1234-5678' }) });

    const missing = validateSignup({
      loginId: 'hj', password: '1', name: '홍길동', phone: '01012345678',
      birthDate: '1990-05-01', department: '생산부', position: '',
    });
    expect(missing).toEqual({ error: '직책을 입력하세요.' });
  });
});

describe('아이디/비밀번호 변경', () => {
  const change = (loginId: string, newPassword = '', currentPassword = 'old') =>
    validateAccountChange('hj', { loginId, newPassword, currentPassword });

  it('아이디를 그대로 두고 새 비밀번호만 넣으면 비밀번호만 바꾼다', () => {
    expect(change('hj', 'new')).toEqual({ value: { loginId: null, password: 'new' } });
  });

  it('대소문자 · 공백만 다른 아이디는 바뀐 것으로 보지 않는다', () => {
    expect(change(' HJ ', 'new')).toEqual({ value: { loginId: null, password: 'new' } });
  });

  it('아이디만 바꾸면 비밀번호는 그대로', () => {
    expect(change('Kim.HJ')).toEqual({ value: { loginId: 'kim.hj', password: null } });
  });

  it('둘 다 한 번에 바꿀 수 있다', () => {
    expect(change('kim', 'new')).toEqual({ value: { loginId: 'kim', password: 'new' } });
  });

  it('바뀐 것이 없거나, 아이디 규칙에 어긋나거나, 현재 비밀번호가 없으면 막는다', () => {
    expect(change('hj')).toEqual({ error: '변경된 내용이 없습니다.' });
    expect(change('홍길동')).toEqual({ error: loginIdError('홍길동') });
    expect(change('kim', '', '')).toEqual({ error: '현재 비밀번호를 입력하세요.' });
  });

  it('빠른 로그인이 켜져 있으면 그 관리자 계정의 아이디만 잠근다', () => {
    expect(loginIdLocked(QUICK_ADMIN_LOGIN_ID)).toBe(quickAdminLoginEnabled());
    expect(loginIdLocked('hj')).toBe(false);
  });
});
