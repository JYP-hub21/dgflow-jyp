/**
 * 면적 계산: 가로(mm) x 세로(mm) x 수량 / 1,000,000 = m2
 */
export function calculateArea(widthMm: number, heightMm: number, quantity: number): number {
  return Math.round(widthMm * heightMm * quantity / 1_000_000 * 100) / 100;
}
