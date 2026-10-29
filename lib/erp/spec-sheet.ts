/**
 * 규격정리 엑셀 생성
 *
 * 규격정리는 발주서와 ERP 사이의 중간 산출물이다. 지금은 사원이 손으로 만든다.
 * 실물(규격정리-KCC건설.xlsx)을 뜯어 보니 구조가 완전히 기계적이었다.
 *
 *   품명 머리글 행  : `24T 5MVT172+14단열(Ar.)+5CL`  + 날짜
 *   헤더 행        : `위치 | 규 | 격 | 수량 | 평` ‖ `위치 | 규 | 격 | 수량 | 평 | M2`
 *   좌측 블록      : **발주서 순서 그대로**
 *   우측 블록      : ERP 순서 (세로↓ 가로↓)
 *   합계 행        : 좌·우 각각 수량·평 합
 *
 * 우측 블록이 곧 ERP 업로드 엑셀의 내용이다 — 실물에서 문자 단위로 같았다.
 *
 * **품명만 사람이 채운다.** 발주서 품명(`5MVT172 H/S+ 14Ar + 5CL(근생)`)을
 * 회사 ERP 품목명(`24T 5MVT172+14단열(Ar.)+5CL`)으로 바꾸는 일은 규칙이 없어 자동화할 수 없다.
 * 그래서 발주서 품명을 그대로 적어 두고, 고쳐 달라는 표시를 남긴다.
 */
import * as XLSX from 'xlsx';
import type { OrderScan } from '@/lib/parser/order-scan';
import type { ErpUploadBuild } from './upload-sheet';

/**
 * `평` 이라고 적힌 열은 실제로는 **재(才)** 다.
 *
 * 실물에서 역산해 확인했다 — 규격정리 828행 `195×540×1` 의 평 값이 `1.1469463778060975`.
 * 면적 0.1053 m² 를 그 값으로 나누면 0.091809 = 0.303² 가 나온다.
 * 유리 업계에서 1재 = 1尺² = 303mm × 303mm 이므로 이 열은 재수다.
 * (1평 = 3.3058 m² 로 계산하면 0.0319 가 나와 실물과 전혀 맞지 않는다)
 */
const SAI_M2 = 0.303 * 0.303;
const round = (n: number, digits = 6) => Number(n.toFixed(digits));

interface SpecRow {
  location: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
}

const HEADER = ['위치', '규', '격', '수량', '평', '', '위치', '규', '격', '수량', '평', 'M2'];

/**
 * 발주서 순서(좌) + ERP 순서(우) 2단 구조로 규격정리를 만든다.
 *
 * @param scan   발주서 구조 스캔 — 좌측 블록(발주서 순서)의 근거
 * @param build  ERP 빌드 결과 — 우측 블록(ERP 순서)의 근거
 */
export function buildSpecSheetWorkbook(scan: OrderScan, build: ErpUploadBuild): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: (string | number | null)[][] = [];

  for (const block of scan.blocks) {
    const left: SpecRow[] = scan.rows
      .filter(r => r.kind === 'item' && r.block_index === block.index)
      .map(r => ({
        location: r.location_text || assembled(r),
        width_mm: r.width_mm,
        height_mm: r.height_mm,
        quantity: r.quantity,
      }));
    if (left.length === 0) continue;

    // 우측 = 같은 품명 블록의 ERP 결과. 포장 시트를 가로질러 품명으로 찾는다.
    const right: SpecRow[] = build.sheets
      .flatMap(s => s.rows)
      .filter(r => r.product_name === block.product_name)
      .map(r => ({
        location: r.location,
        width_mm: r.width_mm,
        height_mm: r.height_mm,
        quantity: r.quantity,
      }));

    // 품명 머리글 — 사람이 ERP 품목명으로 바꿔야 하는 칸이다
    aoa.push([null, block.product_name, null, null, null, null, null, block.product_name]);
    aoa.push([...HEADER]);

    const depth = Math.max(left.length, right.length);
    for (let i = 0; i < depth; i++) {
      aoa.push([...cells(left[i]), null, ...cells(right[i]), m2(right[i])]);
    }

    aoa.push([
      null, null, null,
      sum(left, r => r.quantity), round(sum(left, pyeong)),
      null,
      null, null, null,
      sum(right, r => r.quantity), round(sum(right, pyeong)), round(sum(right, m2Value)),
    ]);
    aoa.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 38 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 11 },
    { wch: 3 },
    { wch: 38 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 11 }, { wch: 11 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '규격정리');
  return wb;
}

function cells(row: SpecRow | undefined): (string | number | null)[] {
  if (!row) return [null, null, null, null, null];
  return [row.location, row.width_mm, row.height_mm, row.quantity, round(pyeong(row))];
}

function m2(row: SpecRow | undefined): number | null {
  return row ? round(m2Value(row), 6) : null;
}

const m2Value = (row: SpecRow) => (row.width_mm * row.height_mm * row.quantity) / 1_000_000;
const pyeong = (row: SpecRow) => m2Value(row) / SAI_M2;

function sum<T>(rows: T[], f: (row: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

function assembled(r: { location_dong: string; location_line: string; location_type: string; location_floor: string; location_room: string }): string {
  return [r.location_dong, r.location_line, r.location_type, r.location_floor, r.location_room]
    .filter(Boolean)
    .join(' ');
}

export function specSheetBlob(scan: OrderScan, build: ErpUploadBuild): Blob {
  const buf = XLSX.write(buildSpecSheetWorkbook(scan, build), {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer;
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function specSheetFileName(siteName: string, sheetName: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return ['규격정리', safe(siteName), safe(sheetName)].filter(Boolean).join('_') + '.xlsx';
}
