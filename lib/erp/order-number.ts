import { format } from 'date-fns';

/**
 * 주문번호 자동 채번: YYMMDD-일련번호
 * 예: 260830-01, 260830-02
 */
export function generateOrderNumber(date: Date, sequence: number): string {
  const dateStr = format(date, 'yyMMdd');
  const seqStr = String(sequence).padStart(2, '0');
  return `${dateStr}-${seqStr}`;
}
