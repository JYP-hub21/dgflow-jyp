/**
 * 한국 날짜 — 서버(Vercel)는 UTC 라 `new Date().toISOString().slice(0, 10)` 은 오전 9시 전에 **어제** 가 된다.
 * 공장은 아침 일찍 입력하므로 서버에서 날짜를 채울 때는 이걸 쓴다 (2026-11-10 전체 점검).
 */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
