/**
 * 규격정리 엑셀 만들기 — 담당자가 손으로 만들던 규격정리 파일의 배치를 따른다.
 *
 *   A       B    C    D     E    F  G       H    I    J     K    L
 *   [묶음 띠]
 *           품명           날짜           품명
 *   위치    규   격   수량  평      위치    규   격   수량  평   M2
 *   (원본 순서 그대로)               (합산·정렬한 정리본)
 *                 계 수량  평                    계 수량  평   M2
 */
import * as XLSX from 'xlsx';
import type { OrganizedBundle, OrderLine } from './organize';
import { foldNums } from './organize';
import type { WoomiHeader } from '@/lib/parser/woomi-order';

type Cell = string | number | { f: string } | null;

export function buildSpecWorkbook(
  header: WoomiHeader,
  results: OrganizedBundle[],
  unassigned: OrderLine[],
): XLSX.WorkBook {
  const today = new Date();
  const dateText = `${String(today.getFullYear()).slice(2)}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  const aoa: Cell[][] = [];
  const sums: { row: number; top: number; bottom: number }[] = [];

  for (const r of results) {
    const rightCount = r.blocks.reduce((s, b) => s + b.right.length, 0);
    aoa.push([`${r.bundle.id}  ${r.bundle.dong}동 ${foldNums(r.bundle.ho)}호   (${r.lines.length}줄 → ${rightCount}줄)`]);
    for (const blk of r.blocks) {
      aoa.push([null, blk.product, null, null, dateText, null, null, blk.product]);
      aoa.push(['위치', '규', '격', '수량', '평', null, '위치', '규', '격', '수량', '평', 'M2']);
      const top = aoa.length + 1;
      const n = Math.max(blk.left.length, blk.right.length);
      for (let i = 0; i < n; i++) {
        const row: Cell[] = new Array(12).fill(null);
        const l = blk.left[i];
        if (l) {
          row[0] = l.rawLoc || `${l.dong}동 ${l.ho}호 ${l.type} ${l.floor} ${l.room}`;
          row[1] = l.w; row[2] = l.h; row[3] = l.qty;
          row[4] = Math.round((l.w * l.h * l.qty) / 1_000_000 / 0.091809 * 100) / 100;
        }
        const x = blk.right[i];
        if (x) {
          row[5] = i + 1;
          row[6] = x.loc; row[7] = x.w; row[8] = x.h; row[9] = x.qty; row[10] = x.jae; row[11] = x.m2;
        }
        aoa.push(row);
      }
      const bottom = aoa.length;
      const sumRow: Cell[] = new Array(12).fill(null);
      sumRow[3] = { f: `SUM(D${top}:D${bottom})` }; sumRow[4] = { f: `SUM(E${top}:E${bottom})` };
      sumRow[9] = { f: `SUM(J${top}:J${bottom})` }; sumRow[10] = { f: `SUM(K${top}:K${bottom})` }; sumRow[11] = { f: `SUM(L${top}:L${bottom})` };
      aoa.push(sumRow);
      sums.push({ row: aoa.length, top, bottom });
      aoa.push([]);
    }
    aoa.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][]);
  // 수식 셀은 aoa_to_sheet 가 문자열로 넣으므로 다시 f 로 바꿔 준다
  for (const s of sums) {
    for (const col of ['D', 'E', 'J', 'K', 'L']) {
      const addr = `${col}${s.row}`;
      const range = `${col}${s.top}:${col}${s.bottom}`;
      ws[addr] = { t: 'n', f: `SUM(${range})` };
    }
  }
  // 숫자 서식
  const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (ref) {
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      for (const c of [1, 2, 7, 8]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && ws[a].t === 'n') ws[a].z = '#,##0'; }
      for (const c of [4, 10, 11]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && (ws[a].t === 'n' || ws[a].f)) ws[a].z = '0.00'; }
    }
  }
  ws['!cols'] = [44, 8, 8, 7, 9, 4, 44, 8, 8, 7, 9, 9].map(wch => ({ wch }));

  // 검산 시트
  const check: Cell[][] = [
    ['현장', header.site], ['발주번호', header.orderNo], ['발주일', header.orderDate],
    ['출고일', header.dueDate], ['도착장소', header.place], ['고객 지시 원문', header.note], [],
    ['묶음', '동·호', '원본 줄', '정리 줄', '총 수량'],
  ];
  for (const r of results) {
    check.push([r.bundle.id, `${r.bundle.dong}동 ${foldNums(r.bundle.ho)}호`, r.lines.length,
      r.blocks.reduce((s, b) => s + b.right.length, 0), r.totalQty]);
  }
  check.push([]);
  const warnings = results.flatMap(r => r.warnings.map(w => `${r.bundle.id}  ${w}`));
  check.push(['검산 결과', warnings.length ? `${warnings.length}건 — 아래 확인` : '없음']);
  for (const w of warnings) check.push(['', w]);
  if (unassigned.length) {
    check.push([]);
    check.push(['어느 묶음에도 안 들어간 줄', `${unassigned.length}줄`]);
    for (const u of unassigned) check.push(['', `${u.dong}동 ${u.ho}호 ${u.room} ${u.w}x${u.h} ${u.qty}매 (엑셀 ${u.row}행)`]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(check as (string | number | null)[][]);
  ws2['!cols'] = [{ wch: 16 }, { wch: 80 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '규격정리');
  XLSX.utils.book_append_sheet(wb, ws2, '검산');
  return wb;
}
