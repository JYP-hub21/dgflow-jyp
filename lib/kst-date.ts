/**
 * 한국 날짜 — 서버(Vercel)는 UTC 라 `new Date().toISOString().slice(0, 10)` 은 오전 9시 전에 **어제** 가 된다.
 * 공장은 아침 일찍 입력하므로 서버에서 날짜를 채울 때는 이걸 쓴다 (2026-11-10 전체 점검).
 */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const KST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/**
 * 한국 시각 "11/10 14:20" — 서버 컴포넌트에서 date-fns `format(new Date(iso), 'MM/dd HH:mm')` 을 쓰면
 * 서버 시간대(UTC)로 찍혀 발주서 접수 · 확인 시각과 이력이 **9시간 이르게** 보였다 (2026-11-10 점검).
 * 서버에서 시각을 글자로 만들 때는 이걸 쓴다. 날짜가 틀린 값이면 빈 글자.
 */
export function kstDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(KST_PARTS.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 시각(timestamptz) → 그 시각의 한국 날짜 'YYYY-MM-DD'. 없거나 틀린 값이면 null */
export function kstDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : kstToday(d);
}
