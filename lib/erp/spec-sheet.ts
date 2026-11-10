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
 *
 * 2026-11-10 사용자 "엑셀까지 다운로드 안 해도 이런 기준이면 어떻게 규격정리되는지 미리 볼 수 있으면" —
 * 계산을 `specSheetBlocks` 로 떼어 화면 미리보기(`components/erp/SpecSheetPreview`)와 엑셀이 같은 값을 쓴다.
 *
 * **덩어리 = 포장 × 품명** (2026-11-10 고침). 실물 규격정리-우미건설 은 품명 머리글이 포장마다 되풀이된다
 * ("1포장 / 22T 5newGN…", "22T 5CL…", "2포장 / 22T 5newGN…" …). 예전에는 발주서 덩어리마다 오른쪽을
 * '같은 품명의 ERP 줄 전부' 로 채워서, 품명이 여러 포장에 나오는 발주서(우미 7차)는 오른쪽이 덩어리 수만큼
 * 되풀이됐다(3,740장 → 82,660장). 이제 오른쪽 = 그 포장 시트의 그 품명 ERP 줄(ERP 순서), 왼쪽 = 그 줄이 나온
 * 발주서 행(`source_rows`, 발주서 순서). 포장 방식을 바꾸면 규격정리도 그 포장대로 다시 묶인다.
 */
import * as XLSX from 'xlsx';
import type { OrderScan, ScanRow } from '@/lib/parser/order-scan';
import type { ErpUploadBuild, ErpUploadRow } from './upload-sheet';

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

export interface SpecRow {
  location: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** 재(엑셀의 '평' 열) — 소수 6자리 */
  sai: number;
  m2: number;
}

/** 포장 하나 × 품명 하나의 덩어리 — 좌 = 발주서 순서, 우 = ERP 순서 */
export interface SpecBlock {
  /** 포장 이름(ERP 시트) — 어느 포장에도 안 들어간 발주서 품목은 '포장 미배정' */
  package_label: string;
  /** 그 포장의 첫 덩어리인지 — 엑셀 품명 머리글 맨 앞 칸에 포장 이름을 적는다(실물 "1포장") */
  first_in_package: boolean;
  product_name: string;
  /** 우측 품명 칸 — DG 프리즘이 사내 품명을 제안했으면 그것, 아니면 발주서 품명 그대로 */
  erp_name: string;
  left: SpecRow[];
  right: SpecRow[];
  left_qty: number;
  left_sai: number;
  right_qty: number;
  right_sai: number;
  right_m2: number;
}

const HEADER = ['위치', '규', '격', '수량', '평', '', '위치', '규', '격', '수량', '평', 'M2'];

const specRow = (r: { location: string; width_mm: number; height_mm: number; quantity: number }): SpecRow => {
  const area = (r.width_mm * r.height_mm * r.quantity) / 1_000_000;
  return { location: r.location, width_mm: r.width_mm, height_mm: r.height_mm, quantity: r.quantity, sai: round(area / SAI_M2), m2: round(area, 6) };
};

/**
 * 발주서 순서(좌) + ERP 순서(우) 덩어리를 포장 × 품명으로 만든다 — 엑셀과 화면 미리보기가 같이 쓴다.
 *
 * @param scan     발주서 구조 스캔 — 좌측(발주서 순서)의 근거
 * @param build    ERP 빌드 결과 — 덩어리(포장 시트 × 품명)와 우측(ERP 순서)의 근거
 * @param excluded 이번 ERP 에서 뺀 품목 행(행 열쇠) — 좌측에서도 뺀다(그래야 좌우 합계가 맞는다)
 */
export function specSheetBlocks(
  scan: OrderScan, build: ErpUploadBuild,
  productNames: Record<string, string> = {},
  excluded: Iterable<number> = [],
): SpecBlock[] {
  const ex = new Set(excluded);
  const order = new Map<number, number>();
  const byKey = new Map<number, ScanRow>();
  scan.rows.forEach((r, i) => {
    if (r.kind !== 'item' || ex.has(r.excel_row)) return;
    order.set(r.excel_row, i);
    byKey.set(r.excel_row, r);
  });
  const byOrder = (a: number, b: number) => order.get(a)! - order.get(b)!;
  const left = (keys: number[]) => keys.sort(byOrder).map(k => {
    const r = byKey.get(k)!;
    return specRow({ location: r.location_text || assembled(r), width_mm: r.width_mm, height_mm: r.height_mm, quantity: r.quantity });
  });
  const block = (package_label: string, first_in_package: boolean, product: string, l: SpecRow[], r: SpecRow[]): SpecBlock => ({
    package_label, first_in_package,
    product_name: product,
    erp_name: productNames[product] || product,
    left: l, right: r,
    left_qty: sum(l, x => x.quantity),
    left_sai: round(sum(l, x => x.width_mm * x.height_mm * x.quantity / 1_000_000 / SAI_M2)),
    right_qty: sum(r, x => x.quantity),
    right_sai: round(sum(r, x => x.width_mm * x.height_mm * x.quantity / 1_000_000 / SAI_M2)),
    right_m2: round(sum(r, x => x.width_mm * x.height_mm * x.quantity / 1_000_000)),
  });

  const used = new Set<number>();
  const out: SpecBlock[] = [];
  for (const sheet of build.sheets) {
    // 포장 안에서 품명이 처음 나온 순서대로 덩어리를 만든다
    const sections = new Map<string, { right: ErpUploadRow[]; keys: number[] }>();
    for (const r of sheet.rows) {
      let sec = sections.get(r.product_name);
      if (!sec) { sec = { right: [], keys: [] }; sections.set(r.product_name, sec); }
      sec.right.push(r);
      for (const k of r.source_rows ?? []) {
        if (byKey.has(k) && !used.has(k)) { used.add(k); sec.keys.push(k); }
      }
    }
    let first = true;
    for (const [product, sec] of sections) {
      out.push(block(sheet.packaging_label, first, product, left(sec.keys), sec.right.map(specRow)));
      first = false;
    }
  }

  // 어느 포장에도 안 들어간 발주서 품목(ERP 의 _미배정) — 왼쪽에만 둔다
  const rest = [...byKey.keys()].filter(k => !used.has(k)).sort(byOrder);
  const restBy = new Map<string, number[]>();
  for (const k of rest) {
    const name = byKey.get(k)!.product_name;
    restBy.set(name, [...(restBy.get(name) ?? []), k]);
  }
  let first = true;
  for (const [product, keys] of restBy) {
    out.push(block('포장 미배정', first, product, left(keys), []));
    first = false;
  }
  return out;
}

/** 발주서 순서(좌) + ERP 순서(우) 2단 구조로 규격정리를 만든다. */
export function buildSpecSheetWorkbook(
  scan: OrderScan, build: ErpUploadBuild,
  /** 발주서 품명 → 사내(ERP) 품명. 있으면 우측 품명 칸에 넣는다 (DG 프리즘 제안, 사람이 확인) */
  productNames: Record<string, string> = {},
  excluded: Iterable<number> = [],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: (string | number | null)[][] = [];

  for (const b of specSheetBlocks(scan, build, productNames, excluded)) {
    // 품명 머리글 — 사람이 ERP 품목명으로 바꿔야 하는 칸이다
    aoa.push([b.first_in_package ? b.package_label : null, b.product_name, null, null, null, null, null, b.erp_name]);
    aoa.push([...HEADER]);
    const depth = Math.max(b.left.length, b.right.length);
    for (let i = 0; i < depth; i++) {
      aoa.push([...cells(b.left[i]), null, ...cells(b.right[i]), b.right[i] ? b.right[i].m2 : null]);
    }
    aoa.push([null, null, null, b.left_qty, b.left_sai, null, null, null, null, b.right_qty, b.right_sai, b.right_m2]);
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
  return [row.location, row.width_mm, row.height_mm, row.quantity, row.sai];
}

function sum<T>(rows: T[], f: (row: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

function assembled(r: { location_dong: string; location_line: string; location_type: string; location_floor: string; location_room: string }): string {
  return [r.location_dong, r.location_line, r.location_type, r.location_floor, r.location_room]
    .filter(Boolean)
    .join(' ');
}

export function specSheetBlob(
  scan: OrderScan, build: ErpUploadBuild, productNames: Record<string, string> = {}, excluded: Iterable<number> = [],
): Blob {
  const buf = XLSX.write(buildSpecSheetWorkbook(scan, build, productNames, excluded), {
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
