'use client';

import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface StockExcelRow {
  customer: string;
  site: string;
  number: string;
  qty: number;
  overdue: number;
  oldest: string | null;
  newest: string | null;
  oldestDays: number | null;
  months: string;
}

/**
 * 생산 후 미납품 재고를 엑셀로 — 생산관리부가 매주 현장별로 보고하는 자료 (2026-11-13 회의).
 * 화면에 보이는 것과 같은 줄 · 같은 순서(현장별)로 받는다.
 */
export default function StockExcelButton({ rows, today, graceDays }: { rows: StockExcelRow[]; today: string; graceDays: number }) {
  function download() {
    const head = ['거래처', '현장', '의뢰번호', '재고(조)', `${graceDays}일 경과(조)`, '가장 오래된 생산일', '가장 최근 생산일', '경과일', '생산 월별'];
    const body = rows.map(r => [r.customer, r.site, r.number, r.qty, r.overdue, r.oldest ?? '모름', r.newest ?? '모름', r.oldestDays ?? '', r.months]);
    const total = ['합계', '', `${rows.length}건`, rows.reduce((s, r) => s + r.qty, 0), rows.reduce((s, r) => s + r.overdue, 0), '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([[`생산 후 미납품 재고 (${today} 기준)`], [], head, ...body, total]);
    ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 11 }, { wch: 9 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 7 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '미납품 재고');
    XLSX.writeFile(wb, `미납품재고_${today.replaceAll('-', '')}.xlsx`);
  }
  return (
    <Button variant="outline" onClick={download} disabled={rows.length === 0}>
      <Download />엑셀 다운로드
    </Button>
  );
}
