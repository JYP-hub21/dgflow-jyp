/**
 * 발주서 시트 구조 스캔
 *
 * 기존 `parseOrderExcel` 은 "행 목록"만 뽑는다. 그런데 실제 발주서는 평평한 표가 아니라
 * **블록 구조**다 — 품명 블록이 `계` 행으로 끊기고, 포장 단위가 소계 행으로 끊기고,
 * 맨 아래 총계가 있다. 이 구조를 읽어내면 세 가지를 공짜로 얻는다.
 *
 *  1. **검산** — 발주서가 스스로 적어 둔 `계`·`합계`·`총계` 와 우리 계산을 대조할 수 있다.
 *     파서가 완벽하지 않아도 "숫자가 맞는지" 는 사람이 즉시 확인할 수 있다.
 *  2. **품명 블록** — 품명 칸 2번째 줄(`단열간봉/알곤/구조마감`)을 품명으로 오인하지 않는다.
 *  3. **포장 단위** — 동·호가 없는 현장(근생 등)도 소계 행으로 포장을 나눌 수 있다.
 *
 * ── 확인된 실물 ────────────────────────────────────────────
 * 우미건설 남원주 역세권1차 / KCC건설 여의도 오피스텔 두 발주서가 **같은 양식**이다.
 * (헤더 `위 치 | 제 품 명 | 규 격 | 수 량 | 평 수 | 실리콘 | 비 고`, `계` 행으로 블록 구분)
 * 차이는 위치를 어디에 적었는가 뿐이다.
 *
 * | | 우미 | KCC |
 * |---|---|---|
 * | 위치 열 | `1동 1호` / `84A 31~35F` 로 채움 | **23개 시트 전부 비어 있음** |
 * | 비고 열 | `1동 1호` (중복) | **`근생/1층/38/AW 우스텝-1W:920` ← 진짜 위치** |
 * | 소계 행 | 없음 (포장은 상단 지시문) | 있음 (`회색 합계 단위로 포장`) |
 *
 * 그래서 위치 열에 동·호 패턴이 있으면 **조립 경로**(동·호·타입·층을 모아 문자열을 만든다),
 * 없으면 **원문 경로**(비고 열을 그대로 쓴다)를 탄다. 두 실물이 그대로 갈린다.
 *
 * ── 설계 원칙 ──────────────────────────────────────────────
 * 읽어낸 것만 채우고, 판단이 필요하면 비운 뒤 `notes` 로 사람에게 올린다.
 * 추측으로 채우지 않는다 — 틀린 값이 ERP를 거쳐 작업의뢰서까지 가면 유리를 잘못 자른다.
 */
import * as XLSX from 'xlsx';

/** 스캔이 찾아낸 열 위치 (0-based 컬럼 인덱스) */
export interface ScanColumns {
  location: number | null;
  product_name: number | null;
  thickness: number | null;
  width_mm: number | null;
  height_mm: number | null;
  quantity: number | null;
  area: number | null;
  remark: number | null;
}

export type ScanRowKind =
  /** 실제 품목 행 */
  | 'item'
  /** 품명 블록 끝 — 가로 칸에 `계` */
  | 'block-total'
  /** 포장 단위 끝 — 가로·세로 없이 수량만 있는 회색 합계 행 */
  | 'package-total'
  /** 시트 맨 아래 총계 */
  | 'grand-total'
  /** 빈 행·하위 헤더 등 */
  | 'skip';

export interface ScanRow {
  /** 엑셀 행 번호 (1-based) — 화면에서 "발주서 몇 행" 으로 보여 준다 */
  excel_row: number;
  kind: ScanRowKind;
  /** 블록에서 상속한 품명 (품명 칸 첫 줄) */
  product_name: string;
  /** 품명 칸 2번째 줄 이후 — 사양 설명 (`단열간봉/알곤/구조마감`) */
  spec_note: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** ERP 에 들어갈 위치 문자열. 원문 경로에서만 채워진다 (접두 포함) */
  location_text: string;
  /** 접두를 붙이기 전 발주서 원문 */
  location_raw: string;
  /** 조립 경로용 조각들 */
  location_dong: string;
  location_line: string;
  location_floor: string;
  location_type: string;
  location_room: string;
  block_index: number;
  package_index: number;
  /** 블록이 발주서 순서를 유지해야 하는지 (ScanBlock.keep_source_order 와 같은 값) */
  keep_source_order: boolean;
  /** 이 행에만 걸린 확인 사항 */
  notes: string[];
}

export interface ScanBlock {
  index: number;
  product_name: string;
  spec_note: string;
  /** 위치 앞에 붙는 말 — 사양 줄에서 얻는다 (`구조마감`) */
  location_prefix: string;
  /** 발주서가 `계` 행에 적어 둔 수량 (없으면 null) */
  declared_quantity: number | null;
  /** 우리가 실제로 읽은 행들의 수량 합 */
  actual_quantity: number;
  item_rows: number;
  package_index: number;
  /**
   * ERP 순서로 정렬하지 않고 **발주서 순서를 그대로** 둘 블록인지.
   *
   * 위치에 `우스텝-1` `우스텝-2` … 처럼 연번이 붙어 있으면 발주자가 순서를 지정한 것이다.
   * 실물 규격정리에서 이런 블록만 좌(발주서 순서)와 우(ERP 순서)가 똑같았다 —
   * 사람도 정렬하지 않았다는 뜻이다. 나머지 블록은 전부 재배열돼 있다.
   */
  keep_source_order: boolean;
}

export interface ScanPackage {
  index: number;
  /** `A-구간` · `5층` · `HOIST-A` — 소계 행에 적힌 라벨. 없으면 빈 문자열 */
  label: string;
  declared_quantity: number | null;
  actual_quantity: number;
  block_indexes: number[];
}

export interface OrderScan {
  /** 헤더 행 (1-based). 못 찾으면 0 */
  header_row: number;
  columns: ScanColumns;
  /** 위치를 어디서 읽었는지 — 화면에 근거로 보여 준다 */
  location_source: 'location-column' | 'remark-column' | 'both' | 'none';
  rows: ScanRow[];
  blocks: ScanBlock[];
  packages: ScanPackage[];
  /** 시트 맨 아래 총계 (없으면 null) */
  declared_total: number | null;
  actual_total: number;
  notes: string[];
}

/**
 * 자동 판정을 덮어쓰는 지정값.
 *
 * 학습되지 않은 양식은 자동으로 못 읽을 수 있다. 그때 사원이 화면에서 열을 직접 찍으면
 * 그 값이 여기로 들어오고, 거래처별 양식 프로파일로 저장돼 다음부터 자동 적용된다.
 * "모든 양식을 자동으로 이해한다" 는 불가능하므로, **한 번 가르치면 기억하는** 쪽을 택한다.
 */
export interface ScanOverrides {
  /** 엑셀 기준 1-based 행 번호 */
  header_row?: number | null;
  columns?: Partial<ScanColumns>;
  location_source?: OrderScan['location_source'] | null;
}

const HEADER_SCAN_ROWS = 25;

/**
 * 동·호(라인) — 위치 열이 아파트식인지 판정한다.
 *   `3동 1호`                (우미)
 *   `102동 1,3호`            (흥화 — 라인 여럿을 한 칸에)
 *   `101동6~10층1,2,3,4호`   (계룡 — 층이 동과 호 사이에 끼어 있다)
 * 1: 동  2: 층(없을 수 있음)  3: 호(쉼표로 여럿)
 */
const DONG_HO_RE = /(\d+)\s*동\s*(?:(\d+\s*~\s*\d+|\d+)\s*층\s*)?(\d+(?:\s*,\s*\d+)*)\s*호/;
/** "84A 31~35F" */
const TYPE_FLOOR_RE = /^(\S+)\s+(\d+\s*~\s*\d+\s*F|\d+\s*F)$/;
/**
 * 층과 타입이 **따로 한 줄씩** 적힌 양식 (흥화: `102동 1,3호` / `1F~9F` / `84A`).
 * 오탐을 막으려고 위치 열 안에서만 찾는다 — 계룡은 오른쪽 보조표에 `55B` 같은 타입이 따로 있다.
 */
const FLOOR_ONLY_RE = /^\d+\s*F(?:\s*[~,]\s*\d+\s*F)*$/i;
const TYPE_ONLY_RE = /^\d{2,3}[A-Z]{1,2}\d?$/;

const text = (v: unknown) => String(v ?? '').trim();
const squash = (v: unknown) => text(v).replace(/\s+/g, '');

function num(v: unknown): number {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : Math.round(n);
}

/** 빈 칸(null)과 숫자 0을 구분한다 — 0 은 "이 세대엔 이 품목 없음" 표시다. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * 합계 칸에 적힌 수량을 검산 기준으로 받아들일지 판정한다.
 *
 * 발주서의 합계 칸은 사람이 만든 엑셀 수식이라 깨져 있을 수 있다.
 * 실물 두 건에서 총계가 `118.33333`, `5.33333` 으로 들어 있었다 (SUM 이 아닌 다른 수식).
 * 장수는 정수여야 하므로 정수가 아니면 기준으로 쓰지 않고 사람에게 알린다.
 */
function declaredQuantity(v: unknown): { value: number | null; broken: number | null } {
  const n = numOrNull(v);
  if (n === null) return { value: null, broken: null };
  if (!Number.isInteger(n)) return { value: null, broken: n };
  return { value: n, broken: null };
}

/** 시트를 행렬로 읽는다 (빈 칸은 null 로 남긴다) */
export function sheetMatrix(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
}

export function scanOrderSheet(
  ws: XLSX.WorkSheet | undefined,
  overrides: ScanOverrides = {},
): OrderScan {
  const empty: OrderScan = {
    header_row: 0,
    columns: {
      location: null, product_name: null, thickness: null,
      width_mm: null, height_mm: null, quantity: null, area: null, remark: null,
    },
    location_source: 'none',
    rows: [], blocks: [], packages: [],
    declared_total: null, actual_total: 0,
    notes: ['시트를 읽지 못했습니다.'],
  };
  if (!ws) return empty;

  const matrix = sheetMatrix(ws);
  if (matrix.length === 0) return empty;

  const notes: string[] = [];
  const header = overrides.header_row
    ? overrides.header_row - 1
    : findHeaderRow(matrix);
  if (header < 0 || header >= matrix.length) {
    return { ...empty, notes: ['헤더 행(제품명·규격)을 찾지 못했습니다. 열을 직접 지정해 주세요.'] };
  }

  const mapped = mapColumns(matrix, header);
  // 비고 머리글이 두 칸에 걸쳐 병합돼 있으면 실제로 글자가 든 칸을 고른다.
  // 흥화: `비 고` 가 I:J 병합인데 I 는 0 만, 실제 위치(`거실(外)`)는 J 에 있다.
  mapped.remark = pickFilledColumnInMerge(ws, matrix, header, mapped.remark);
  const columns = { ...mapped, ...stripUndefined(overrides.columns) };
  if (columns.width_mm === null || columns.height_mm === null) {
    notes.push('가로·세로 열을 확정하지 못했습니다. 열을 직접 지정해 주세요.');
  }

  const firstDataRow = header + 1;
  const locationSource =
    overrides.location_source ?? pickLocationSource(matrix, columns, firstDataRow);
  if (locationSource === 'remark-column') {
    notes.push('위치를 비고 열에서 읽었습니다.');
  } else if (locationSource === 'both') {
    notes.push('위치를 위치 열과 비고 열을 합쳐 읽었습니다.');
  } else if (locationSource === 'none') {
    notes.push('위치를 읽을 열을 찾지 못했습니다. 위치가 빈 채로 나갑니다.');
  }

  // 동·호·타입·층 조립은 위치를 어디서 읽든 그대로 해 둔다.
  // ERP 위치 문자열은 비고 열 값(location_raw)만 쓰지만, 포장 단위를 동별로 추론하거나
  // 작업의뢰서를 만들 때는 이 분해값이 필요하다. 위치 열이 비어 있으면 빈 값이 나올 뿐이다.
  const assembled = locationSource === 'none'
    ? null
    : assembleLocations(matrix, columns, firstDataRow);

  const usesRemark = locationSource === 'remark-column' || locationSource === 'both';
  const auxColumns = usesRemark
    ? findRemarkAuxColumns(ws, matrix, columns, header, firstDataRow)
    : [];

  const rows: ScanRow[] = [];
  const blocks: ScanBlock[] = [];
  const packages: ScanPackage[] = [];

  let blockIndex = -1;
  let packageIndex = 0;
  let declaredTotal: number | null = null;

  // 블록/포장을 만들어 가며 한 번에 훑는다.
  const ensurePackage = (): ScanPackage => {
    let pkg = packages[packageIndex];
    if (!pkg) {
      pkg = { index: packageIndex, label: '', declared_quantity: null, actual_quantity: 0, block_indexes: [] };
      packages[packageIndex] = pkg;
    }
    return pkg;
  };

  for (let r = firstDataRow; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const excelRow = r + 1;

    const productCell = text(pick(row, columns.product_name));
    const widthCell = text(pick(row, columns.width_mm));
    const w = num(pick(row, columns.width_mm));
    const h = num(pick(row, columns.height_mm));
    const qRaw = numOrNull(pick(row, columns.quantity));
    const q = qRaw === null ? 0 : Math.round(qRaw);

    const kind = classifyRow(productCell, widthCell, w, h, q, row, columns);

    if (kind === 'grand-total') {
      const d = declaredQuantity(pick(row, columns.quantity));
      if (d.value !== null) declaredTotal = d.value;
      if (d.broken !== null) {
        notes.push(
          `${excelRow}행 총계가 ${d.broken} 로 적혀 있습니다 — 발주서의 합계 수식이 깨져 있습니다. ` +
            '검산 기준에서 제외했습니다.',
        );
      }
      pushRow(rows, excelRow, kind, q);
      continue;
    }

    if (kind === 'package-total') {
      const pkg = ensurePackage();
      const d = declaredQuantity(pick(row, columns.quantity));
      if (d.value !== null) pkg.declared_quantity = d.value;
      if (d.broken !== null) {
        notes.push(`${excelRow}행 합계가 ${d.broken} 로 적혀 있습니다 — 발주서의 합계 수식이 깨져 있습니다.`);
      }
      pkg.label = packageLabel(productCell) || pkg.label;
      pushRow(rows, excelRow, kind, q);
      // 다음 행부터 새 포장
      packageIndex += 1;
      blockIndex = -1;
      continue;
    }

    if (kind === 'block-total') {
      if (blockIndex >= 0 && blocks[blockIndex]) {
        const d = declaredQuantity(pick(row, columns.quantity));
        if (d.value !== null) blocks[blockIndex].declared_quantity = d.value;
        if (d.broken !== null) {
          notes.push(`${excelRow}행 계가 ${d.broken} 로 적혀 있습니다 — 발주서의 합계 수식이 깨져 있습니다.`);
        }
      }
      pushRow(rows, excelRow, kind, q);
      blockIndex = -1; // 다음 품목 행에서 새 블록 시작
      continue;
    }

    if (kind === 'skip') {
      pushRow(rows, excelRow, 'skip', 0);
      continue;
    }

    // 수량이 대놓고 0 으로 적힌 행은 "이 세대엔 이 품목 없음" 표시다 (빈 칸과 구분해야 한다).
    // 우미 7차 77행: 705×1820 발코니1 수량 0, 비고 "3호 호이스트" — 계(10)에 들어가지 않는다.
    if (qRaw !== null && qRaw <= 0) {
      pushRow(rows, excelRow, 'skip', 0);
      continue;
    }

    // ── 품목 행 ──────────────────────────────────────────
    if (blockIndex < 0) {
      blockIndex = blocks.length;
      blocks.push({
        index: blockIndex,
        product_name: '',
        spec_note: '',
        location_prefix: '',
        declared_quantity: null,
        actual_quantity: 0,
        item_rows: 0,
        package_index: packageIndex,
        keep_source_order: false,
      });
      ensurePackage().block_indexes.push(blockIndex);
    }

    const block = blocks[blockIndex];

    // 품명 칸에 값이 있으면 — **첫 값만** 품명이고, 그 뒤는 사양 설명이다.
    // 실물: `5MVT172 H/S+ 14Ar + 5CL(근생)` 다음 줄에 `단열간봉/알곤/구조마감`.
    if (productCell) {
      if (!block.product_name) {
        block.product_name = productCell;
      } else if (productCell !== block.product_name && !block.spec_note.includes(productCell)) {
        block.spec_note = [block.spec_note, productCell].filter(Boolean).join(' / ');
      }
    }

    const rowNotes: string[] = [];
    const loc = assembled?.[r];
    const remarkText = usesRemark ? appendAux(text(pick(row, columns.remark)), row, auxColumns) : '';
    const verbatim = locationSource === 'both'
      ? joinLocation(loc?.header ?? '', remarkText)
      : remarkText;

    if (q <= 0) rowNotes.push('수량을 읽지 못해 1장으로 뒀습니다.');
    if (locationSource === 'remark-column' && !verbatim) {
      rowNotes.push('비고 열이 비어 있어 위치를 읽지 못했습니다.');
    }
    if (locationSource === 'both' && !verbatim) {
      rowNotes.push('위치 열과 비고 열이 모두 비어 있어 위치를 읽지 못했습니다.');
    }

    rows.push({
      excel_row: excelRow,
      kind: 'item',
      product_name: block.product_name,
      spec_note: block.spec_note,
      width_mm: w,
      height_mm: h,
      quantity: q > 0 ? q : 1,
      location_text: '', // 블록 접두가 확정된 뒤 아래에서 조립한다
      location_raw: verbatim,
      location_dong: loc?.dong ?? '',
      location_line: loc?.line ?? '',
      location_floor: loc?.floor ?? '',
      location_type: loc?.type ?? '',
      location_room: loc?.room ?? '',
      block_index: blockIndex,
      package_index: packageIndex,
      keep_source_order: false, // 블록을 다 읽은 뒤 아래에서 확정한다
      notes: rowNotes,
    });

    block.actual_quantity += q > 0 ? q : 1;
    block.item_rows += 1;
    ensurePackage().actual_quantity += q > 0 ? q : 1;
  }

  // 품명·사양·접두는 블록을 끝까지 읽은 뒤에야 확정된다
  // (사양 줄이 블록의 3번째 행에 오기도 한다 — KCC 9/17 시트 17행).
  // 그래서 위치 문자열은 여기서 한 번에 조립한다.
  for (const block of blocks) {
    const blockRows = rows.filter(r => r.kind === 'item' && r.block_index === block.index);
    block.keep_source_order = hasExplicitSequence(blockRows);
  }

  for (const row of rows) {
    if (row.kind !== 'item') continue;
    const block = blocks[row.block_index];
    if (!block) continue;
    row.product_name = block.product_name;
    row.spec_note = block.spec_note;
    row.location_text = [block.location_prefix, row.location_raw].filter(Boolean).join(' ').trim();
    row.keep_source_order = block.keep_source_order;
  }

  // 빈 포장(품목이 하나도 없는 소계 행)은 버린다
  const usedPackages = packages.filter(p => p && p.actual_quantity > 0);
  usedPackages.forEach((p, i) => (p.index = i));

  const actualTotal = rows.reduce((s, r) => (r.kind === 'item' ? s + r.quantity : s), 0);

  return {
    header_row: header + 1,
    columns,
    location_source: locationSource,
    rows,
    blocks,
    packages: usedPackages,
    declared_total: declaredTotal,
    actual_total: actualTotal,
    notes,
  };
}

function pushRow(rows: ScanRow[], excelRow: number, kind: ScanRowKind, quantity: number) {
  rows.push({
    excel_row: excelRow,
    kind,
    product_name: '', spec_note: '',
    width_mm: 0, height_mm: 0, quantity,
    location_text: '', location_raw: '',
    location_dong: '', location_line: '', location_floor: '', location_type: '', location_room: '',
    block_index: -1, package_index: -1, keep_source_order: false,
    notes: [],
  });
}

const pick = (row: unknown[], col: number | null) => (col === null ? null : row[col]);

/** `undefined` 인 항목은 자동 판정을 덮어쓰지 않는다 (null 은 "이 열은 없음" 이라는 지정이다) */
function stripUndefined(partial: Partial<ScanColumns> | undefined): Partial<ScanColumns> {
  if (!partial) return {};
  return Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined),
  ) as Partial<ScanColumns>;
}

/**
 * 행 종류를 구조로 판정한다.
 *
 * 세 가지 합계 행이 모양으로 갈린다 (KCC 9/17 시트 실물).
 *   25행 `[…,"계",null,12,…]`        → 가로 칸에 `계`      = 블록 끝
 *   48행 `[…,null,null,56,…]`        → 가로·세로 없고 수량만 = 포장 끝(회색 합계)
 *   97행 `[…,"총  계",…,103,…]`      → 품명 칸에 `총계`     = 시트 총계
 */
function classifyRow(
  productCell: string,
  widthCell: string,
  w: number,
  h: number,
  q: number,
  row: unknown[],
  columns: ScanColumns,
): ScanRowKind {
  const prod = squash(productCell);

  if (/^총계$/.test(prod) || /^전체합계$/.test(prod)) return 'grand-total';
  if (/^계$/.test(squash(widthCell)) || /^소?계$/.test(squash(widthCell))) return 'block-total';
  if (/합계$/.test(prod)) return 'package-total';

  if (w > 0 && h > 0) return 'item';

  // 가로·세로가 없는데 수량만 있으면 회색 합계 행이다.
  // 단, 시트 어디에도 수량 열이 없으면 판정하지 않는다.
  if (columns.quantity !== null && w <= 0 && h <= 0 && q > 0 && !hasAnyText(row, columns)) {
    return 'package-total';
  }

  return 'skip';
}

/** 합계 행인지 구분하기 위해 "글자가 든 칸이 있는가" 를 본다 (하위 헤더 행 걸러내기) */
function hasAnyText(row: unknown[], columns: ScanColumns): boolean {
  const skip = new Set([columns.quantity, columns.area].filter(c => c !== null) as number[]);
  return row.some((cell, i) => {
    if (skip.has(i)) return false;
    const t = text(cell);
    return t.length > 0 && isNaN(Number(t));
  });
}

/**
 * 비고 열 오른쪽의 **보조 열** 을 찾는다.
 *
 * KCC 발주서는 비고(`근생/1층/38/AW 우스텝-1W:920`)를 오른쪽 칸들에 쪼개 두었다.
 *   `계약=근생` `층=1층` `도면부호=38/AW` `스텝=우스텝-1` `내판폭=W:920`
 * 앞의 넷은 비고에 이미 들어 있지만 **내판 폭은 대부분의 행에서 비고에 빠져 있다** —
 * 그런데 실물 ERP 위치에는 여섯 줄 전부 `W:1385` 처럼 붙어 있다. 사람이 이어 붙인 것이다.
 *
 * 문제는 더 오른쪽에 **전혀 다른 표**가 하나 더 있다는 것이다(품명·도면부호·가로·세로·수량).
 * 그걸 붙이면 위치가 엉망이 된다. 그래서 "비고를 쪼개 놓은 열" 만 골라야 한다.
 *
 * 판정: 그 열에 값이 있는 행 중 **한 번이라도 비고 문자열에 그 값이 들어 있으면** 보조 열이다.
 * 한 번도 없으면 남남이므로 거기서 멈춘다. (내판 폭 열은 81행에서 비고에 직접 적혀 있어 통과한다)
 */
function findRemarkAuxColumns(
  ws: XLSX.WorkSheet,
  matrix: unknown[][],
  columns: ScanColumns,
  header: number,
  firstDataRow: number,
): number[] {
  if (columns.remark === null) return [];

  // 비고 머리글과 같이 병합된 칸은 비고 자체다 (계룡: I:J 에 같은 값이 두 번 적혀 있다)
  const remarkSpan = mergeSpan(ws, header, columns.remark);
  const aux: number[] = [];
  const maxCol = matrix.reduce((m, r) => Math.max(m, (r ?? []).length), 0);
  const limit = Math.min(maxCol, columns.remark + 1 + 8);

  for (let col = columns.remark + 1; col < limit; col++) {
    if (col <= remarkSpan.end) continue;
    let filled = 0;
    let contained = 0;
    let numeric = 0;

    for (let r = firstDataRow; r < matrix.length; r++) {
      const value = text((matrix[r] ?? [])[col]);
      if (!value) continue;
      filled++;
      if (!isNaN(Number(value))) numeric++;
      const remark = text((matrix[r] ?? [])[columns.remark]);
      if (remark && remark.includes(value)) contained++;
    }

    if (filled === 0) continue; // 빈 열은 건너뛰고 계속 본다
    if (contained === 0) break; // 비고와 무관한 열 — 여기서 멈춘다 (오른쪽의 다른 표)
    // 숫자만 든 열은 비고 조각이 아니다. 계룡 발주서의 `기본`(1·2) 열이 `침실1` 같은 비고에
    // 우연히 포함돼 통과했고, `거실 大1` `침실12` 처럼 위치 끝에 숫자가 붙어 나갔다.
    // (하위 머리글 `기본` 한 칸이 섞여 있어 "전부" 가 아니라 "대부분" 으로 본다)
    if (numeric >= filled * 0.8) break;
    aux.push(col);
  }

  return aux;
}

/**
 * 비고에 빠져 있는 보조 열 값을 뒤에 이어 붙인다.
 * 실물이 `우스텝-2` + `W;920` → `우스텝-2W;920` 으로 **붙여 쓰므로** 구분자를 넣지 않는다.
 */
function appendAux(remark: string, row: unknown[], auxColumns: number[]): string {
  let out = remark.trim();
  for (const col of auxColumns) {
    const value = text(row[col]);
    if (!value || out.includes(value)) continue;
    out += value;
  }
  return out;
}

/** 위치 열 + 비고 — 위치 열에 이미 비고가 들어 있으면 두 번 붙이지 않는다 (계룡 `…4호거실 大`) */
function joinLocation(locationText: string, remark: string): string {
  const loc = locationText.trim();
  const rem = remark.trim();
  if (!loc) return rem;
  if (!rem || squash(loc).includes(squash(rem))) return loc;
  return `${loc} ${rem}`;
}

/** (row, col) 이 속한 병합 범위의 열 구간. 병합이 아니면 그 열 하나 */
function mergeSpan(ws: XLSX.WorkSheet, row: number, col: number): { start: number; end: number } {
  for (const m of ws['!merges'] ?? []) {
    if (row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c) return { start: m.s.c, end: m.e.c };
  }
  return { start: col, end: col };
}

/**
 * 머리글이 병합돼 여러 열을 덮을 때, 데이터가 실제로 든 열을 고른다.
 * 숫자가 아닌 글자가 가장 많이 든 열이 이긴다 (동점이면 왼쪽 — 원래 고른 열).
 */
function pickFilledColumnInMerge(
  ws: XLSX.WorkSheet,
  matrix: unknown[][],
  header: number,
  col: number | null,
): number | null {
  if (col === null) return null;
  const span = mergeSpan(ws, header, col);
  if (span.start === span.end) return col;

  let best = col;
  let bestCount = -1;
  for (let c = span.start; c <= span.end; c++) {
    let n = 0;
    for (let r = header + 1; r < matrix.length; r++) {
      const v = text((matrix[r] ?? [])[c]);
      if (v && isNaN(Number(v))) n++;
    }
    if (n > bestCount) {
      bestCount = n;
      best = c;
    }
  }
  return best;
}

/** `A-구간 합계` → `A-구간` */
function packageLabel(productCell: string): string {
  const t = text(productCell).replace(/\s+/g, ' ');
  if (!/합\s*계/.test(t)) return '';
  return t.replace(/합\s*계\s*$/, '').trim();
}

/**
 * 블록의 모든 위치에 `이름-숫자` 연번이 붙어 있는지 본다.
 *
 * `근생/1층/38/AW 우스텝-1` `…우스텝-2` `…좌스텝-1` 처럼 발주자가 번호를 매겨 준 블록이다.
 * 이런 블록은 실물 규격정리에서 좌(발주서 순서)와 우(ERP 순서)가 완전히 같았다 —
 * 사람도 재배열하지 않았다. 번호 자체가 순서 지시이기 때문으로 보인다.
 *
 * 한 줄이라도 연번이 없으면 일반 블록으로 보고 ERP 순서(세로↓ 가로↓)로 정렬한다.
 */
function hasExplicitSequence(blockRows: ScanRow[]): boolean {
  if (blockRows.length < 2) return false;

  const SEQ = /([가-힣A-Za-z]+)-(\d+)(?:\D|$)/;
  const matched = blockRows.map(r => SEQ.exec(r.location_raw));
  if (matched.some(m => !m)) return false;

  // `AW-4` 같은 **도면부호**는 순번이 아니다. 우신산업 발주서가 그랬다 —
  // 위치가 `발코니/5~15층/AW-4`,`…/AW-2`,`…/AW-9` 로 번호가 뒤죽박죽인데
  // 패턴만 보고 "발주자가 순서를 지정했다" 고 판정해 정렬을 통째로 꺼 버렸다.
  //
  // 발주자가 매긴 순번이라면 접두별로 번호가 순차로 늘어난다.
  // KCC 여의도는 한 블록에 `우스텝-1…4` 와 `좌스텝-1,2` 가 같이 있어 접두가 둘이고
  // 번호도 그룹마다 1 로 리셋되므로, 접두를 묶어 그룹 안에서만 따진다.
  const byPrefix = new Map<string, number[]>();
  for (const m of matched) {
    const key = m![1];
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key)!.push(Number(m![2]));
  }

  return [...byPrefix.values()].every(nums => nums.every((n, i) => i === 0 || n > nums[i - 1]));
}

/** 헤더 행 = `제품명` 과 `규격`(또는 가로·세로)이 같이 있는 행 */
function findHeaderRow(matrix: unknown[][]): number {
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, matrix.length); i++) {
    const cells = (matrix[i] ?? []).map(squash);
    let score = 0;
    if (cells.some(c => /^제품명$|^품명$/.test(c))) score += 3;
    if (cells.some(c => /^규격$/.test(c))) score += 3;
    if (cells.some(c => /^수량$/.test(c))) score += 2;
    if (cells.some(c => /^위치$/.test(c))) score += 1;
    if (cells.some(c => /^비고$/.test(c))) score += 1;
    if (cells.some(c => /^가로$/.test(c))) score += 2;
    if (cells.some(c => /^세로$/.test(c))) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return bestScore >= 5 ? best : -1;
}

/**
 * 열을 찾는다.
 *
 * `규 격` 은 병합 헤더라 그 아래 줄에 `두께(mm) | 가 로 | 세 로` 가 있다.
 * 그래서 헤더 행에서 못 찾으면 바로 아래 줄을 본다.
 */
function mapColumns(matrix: unknown[][], header: number): ScanColumns {
  const head = (matrix[header] ?? []).map(squash);
  const sub = (matrix[header + 1] ?? []).map(squash);

  const findIn = (cells: string[], re: RegExp): number | null => {
    const i = cells.findIndex(c => re.test(c));
    return i >= 0 ? i : null;
  };

  const columns: ScanColumns = {
    location: findIn(head, /^위치$/),
    product_name: findIn(head, /^제품명$|^품명$/),
    thickness: findIn(sub, /^두께/) ?? findIn(head, /^두께/),
    width_mm: findIn(head, /^가로$/) ?? findIn(sub, /^가로$/),
    height_mm: findIn(head, /^세로$/) ?? findIn(sub, /^세로$/),
    quantity: findIn(head, /^수량$/) ?? findIn(sub, /^수량$/),
    area: findIn(head, /^평수$|^평$|^면적$/),
    remark: findIn(head, /^비고$/),
  };

  return columns;
}

/**
 * 위치를 어느 열에서 읽을지 정한다.
 *
 * **ERP 업로드의 위치는 발주서 `비 고` 열의 값이다.** 거래처가 창 위치를 적는 칸이
 * 거기이기 때문이다 — 우신산업 `발코니/5~15층/AW-4`, KCC 23개 시트 전부가 그랬다.
 * 그래서 비고 열에 값이 있으면 그 열을 쓴다.
 *
 * `위 치` 열은 비고가 통째로 빈 발주서에서만 쓰는 차선책이다. 이름이 `위 치` 라는
 * 이유로 먼저 고르면, 그 열이 비어 있을 때 위치가 날아가고 그 빈자리를 폴백이
 * 품명·유리코드(`GL01`,`불루`)로 메워 ERP 까지 흘러간다.
 */
function pickLocationSource(
  matrix: unknown[][],
  columns: ScanColumns,
  firstDataRow: number,
): OrderScan['location_source'] {
  const filled = (col: number | null) => {
    if (col === null) return 0;
    let n = 0;
    for (let r = firstDataRow; r < matrix.length; r++) {
      if (text((matrix[r] ?? [])[col])) n++;
    }
    return n;
  };

  const locFilled = filled(columns.location);
  const remarkFilled = filled(columns.remark);

  if (remarkFilled > 0) return 'remark-column';
  if (locFilled > 0) return 'location-column';
  return 'none';
}

interface AssembledLocation {
  dong: string;
  line: string;
  type: string;
  floor: string;
  room: string;
  /** 위치 열에 적힌 이 행의 위치 원문 — '위치 + 비고' 로 읽을 때 쓴다 */
  header: string;
}

interface DongHo {
  dong: string;
  line: string;
  floor: string;
  key: string;
}

function parseDongHo(cell: string): DongHo | undefined {
  const m = cell.match(DONG_HO_RE);
  if (!m) return undefined;
  const line = m[3].replace(/\s+/g, '');
  return {
    dong: `${m[1]}동`,
    line: `${line}호`,
    floor: m[2] ? `${m[2].replace(/\s+/g, '')}층` : '',
    key: `${m[1]}-${m[2] ?? ''}-${line}`,
  };
}

/**
 * 동·호 / 타입·층을 행 단위로 확정한다 (아파트 발주서 경로).
 *
 * 위치 블록은 동·호 칸에서 시작해 다음 동·호 칸 전까지다. 블록 안의 다른 줄에 타입·층이 온다.
 *   우미: `3동 1호` / `84A 21~25F`
 *   흥화: `102동 1,3호` / `1F~9F` / `84A`   (층과 타입이 한 줄씩)
 *   계룡: `101동6~10층1,2,3,4호거실 大`      (한 칸에 다 — 행마다 반복)
 * 단순히 "마지막에 본 값" 을 물려받으면 블록 첫 줄이 직전 블록의 타입을 달고 나오므로
 * 블록을 미리 훑어 타입·층을 블록 전체에 적용한다.
 *
 * 블록 경계: 동·호가 바뀌거나, **위치 열에 동·호가 새로 적히면** 새 블록이다.
 * 흥화는 `102동 2호` 가 1F / 2F,4F,6F,8F / 3F,5F,7F,9F 로 세 번 연달아 나온다 —
 * 동·호만 보면 한 블록으로 뭉쳐 2층 이상이 1F·84B 로 잘못 나간다.
 */
function assembleLocations(
  matrix: unknown[][],
  columns: ScanColumns,
  firstDataRow: number,
): AssembledLocation[] {
  const excluded = new Set(
    [columns.product_name, columns.width_mm, columns.height_mm, columns.quantity]
      .filter(c => c !== null) as number[],
  );

  const found = matrix.map((row, r) => {
    const empty = {
      cells: [] as string[], locCell: '', dongHo: undefined as DongHo | undefined,
      locDongHo: false, typeFloor: undefined as RegExpMatchArray | undefined, floorOnly: '', typeOnly: '',
    };
    if (r < firstDataRow) return empty;
    const cells = (row ?? [])
      .map((v, i) => (excluded.has(i) ? '' : text(v)))
      .filter(Boolean);
    const locCell = columns.location === null ? '' : text((row ?? [])[columns.location]);
    const locDongHo = locCell ? parseDongHo(locCell) : undefined;
    let dongHo = locDongHo;
    for (const c of cells) {
      if (dongHo) break;
      dongHo = parseDongHo(c);
    }
    let typeFloor: RegExpMatchArray | undefined;
    for (const c of cells) {
      const m = c.match(TYPE_FLOOR_RE);
      if (m) { typeFloor = m; break; }
    }
    return {
      cells, locCell, dongHo, locDongHo: !!locDongHo, typeFloor,
      floorOnly: FLOOR_ONLY_RE.test(locCell) ? locCell.replace(/\s+/g, '') : '',
      typeOnly: TYPE_ONLY_RE.test(locCell) ? locCell : '',
    };
  });

  interface BlockInfo { type: string; floor: string; header: string }
  const blockOf: (BlockInfo | undefined)[] = new Array(matrix.length);

  let lastKey = '';
  for (let i = 0; i < found.length; i++) {
    const key = found[i].dongHo?.key ?? '';
    if (!key) continue;
    if (key === lastKey && !found[i].locDongHo) continue;
    lastKey = key;

    let end = i;
    for (let j = i + 1; j < found.length; j++) {
      const k = found[j].dongHo?.key ?? '';
      if ((k && k !== key) || found[j].locDongHo) break;
      end = j;
    }

    let type = '';
    let floor = found[i].dongHo?.floor ?? '';
    const headerParts: string[] = [];
    let headerOpen = true;
    for (let j = i; j <= end; j++) {
      const f = found[j];
      if (!type && f.typeFloor) type = f.typeFloor[1];
      if (!floor && f.typeFloor) floor = f.typeFloor[2].replace(/\s+/g, '');
      if (!floor && f.floorOnly) floor = f.floorOnly;
      if (!type && f.typeOnly) type = f.typeOnly;
      // 위치 머리는 동·호 칸부터 **이어지는** 위치 칸까지만 — 빈 칸이 나오면 닫는다.
      // 안 그러면 다음 쪽 머리글(`발 주 서` `공사명`)까지 위치에 딸려 온다.
      if (!f.locCell) headerOpen = false;
      else if (headerOpen) headerParts.push(f.locCell);
    }
    const info = { type, floor, header: headerParts.join(' ') };
    for (let j = i; j <= end; j++) blockOf[j] = info;
  }

  const out: AssembledLocation[] = [];
  let lastDongHo: DongHo | undefined;

  for (let i = 0; i < found.length; i++) {
    if (found[i].dongHo) lastDongHo = found[i].dongHo;
    const block = blockOf[i];
    const room = found[i].cells.find(
      c => !DONG_HO_RE.test(c) && !TYPE_FLOOR_RE.test(c) && !FLOOR_ONLY_RE.test(c)
        && !TYPE_ONLY_RE.test(c) && isNaN(Number(c)),
    );

    out.push({
      dong: lastDongHo?.dong ?? '',
      line: lastDongHo?.line ?? '',
      type: block?.type ?? '',
      floor: block?.floor ?? '',
      room: room ?? '',
      // 계룡처럼 행마다 위치 칸이 있으면 행마다 블록이 갈려 그 칸이, 흥화처럼 블록 머리에만 있으면 머리 전체가 된다
      header: block?.header ?? '',
    });
  }

  return out;
}
