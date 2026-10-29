import * as XLSX from 'xlsx';

export interface ParsedOrderMeta {
  customer_name: string;
  site_name: string;
  order_date: string;
  delivery_date: string;
  remark: string;
  /** 발주서 상단의 포장 지시 문구 — 작업의뢰서를 포장 단위로 나누는 근거 */
  packaging_note: string;
}

export interface ParsedOrderItem {
  product_name: string;
  width_mm: string;
  height_mm: string;
  quantity: string;
  location_dong: string;
  location_line: string;
  location_floor: string;
  location_room: string;
  location_type: string;
  location_window_type: string;
  remark: string;
}

// 컬럼명 매핑 (다양한 엑셀 양식 대응)
const COLUMN_ALIASES: Record<string, string[]> = {
  product_name: ['품명', '제품명', '품목', '기타(품명)', '기타', '재료종류', '유리종류', '종류', '제품명', '외판/내판', '주문내'],
  width_mm: ['가로', '가로규격', '가로(mm)', 'W', 'width', '폭'],
  height_mm: ['세로', '세로규격', '세로(mm)', 'H', 'height', '높이'],
  quantity: ['수량', '주문수량', '합계', 'EA', 'QTY', 'qty', '매수', '수량'],
  location_dong: ['동', '동호'],
  location_line: ['라인', 'LINE'],
  location_floor: ['층', '층수', 'F', 'FLOOR', '호수'],
  location_room: ['위치', '창위치', '실명', '실', '위치/비고'],
  location_type: ['타입', 'TYPE', '세대타입'],
  location_window_type: ['창구분', '내외창', '구분'],
  remark: ['비고', '비고1', '참고', 'REMARK', '메모'],
};

export interface SheetInfo {
  name: string;
  rows: number;
}

/**
 * 워크북의 시트 목록과 각 시트의 행 수를 반환.
 * 발주서는 차수별(1차/2차/...) 또는 발주일자별로 시트가 나뉘는 경우가 많아
 * 사용자가 어느 시트를 가져올지 직접 고를 수 있어야 한다.
 */
export function listOrderSheets(buffer: ArrayBuffer): SheetInfo[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' }).length,
  }));
}

/**
 * 엑셀 파일을 파싱하여 주문 품목 배열을 반환
 *
 * @param sheetName 가져올 시트명. 생략하면 행이 가장 많은 시트를 고른다
 *                  (여러 차수가 든 파일에서는 사용자가 명시해야 한다).
 */
export function parseOrderExcel(buffer: ArrayBuffer, sheetName?: string): {
  meta: ParsedOrderMeta;
  items: ParsedOrderItem[];
  sheetName: string;
  totalRows: number;
  warnings: string[];
} {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const warnings: string[] = [];

  // 지정된 시트가 있으면 그대로, 없으면 가장 데이터가 많은 시트 선택
  let bestSheet = wb.SheetNames[0];

  if (sheetName && wb.SheetNames.includes(sheetName)) {
    bestSheet = sheetName;
  } else {
    let bestRows = 0;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (data.length > bestRows) {
        bestRows = data.length;
        bestSheet = name;
      }
    }
  }

  const ws = wb.Sheets[bestSheet];

  // 엑셀 상단 영역에서 기본정보 추출
  const allRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
  const meta = extractMeta(allRows);

  if (allRows.length === 0) {
    return { meta, items: [], sheetName: bestSheet, totalRows: 0, warnings: ['데이터가 없습니다.'] };
  }

  // 헤더가 몇 번째 행인지는 양식마다 다르다. 상위 20행을 점수로 평가해
  // 그럴듯한 후보부터 실제로 파싱해 보고, 품목이 나오는 첫 후보를 채택한다.
  // (첫 매칭 행을 무조건 쓰면 "발주일 2026-06-11" 같은 메타 행에 걸려 전부 0건이 된다.)
  const candidates: { row: number; score: number }[] = [];
  for (let i = 0; i < Math.min(20, allRows.length); i++) {
    const row = allRows[i];
    if (!Array.isArray(row)) continue;
    const score = scoreHeaderRow(row.map(String));
    if (score > 0) candidates.push({ row: i, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.row - b.row);

  let fallback: ReturnType<typeof parseRows> | null = null;

  for (const candidate of candidates) {
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      range: candidate.row,
      defval: '',
    });
    const result = parseRows(parsed, bestSheet, []);
    if (result.items.length > 0) {
      return { ...result, meta, warnings: [...warnings, ...result.warnings] };
    }
    fallback ??= result;
  }

  if (fallback) {
    return { ...fallback, meta, warnings: [...warnings, ...fallback.warnings] };
  }

  warnings.push('품명/가로/세로 컬럼을 찾을 수 없습니다. 수동으로 확인해주세요.');
  return { meta, items: [], sheetName: bestSheet, totalRows: allRows.length, warnings };
}

/**
 * 어떤 행이 헤더 행인지 점수로 평가.
 * 품명/가로/세로/수량이 각각 1점, "규격"·"제품명/위치" 병합 헤더는 2점.
 */
function scoreHeaderRow(rowHeaders: string[]): number {
  const map = findColumnMapping(rowHeaders);
  let score = 0;
  for (const field of ['product_name', 'width_mm', 'height_mm', 'quantity']) {
    if (map[field]) score++;
  }
  if (rowHeaders.some(h => /규\s*격/.test(h))) score += 2;
  if (rowHeaders.some(h => /제\s*품\s*명|위\s*치/.test(h))) score += 2;
  return score;
}

/**
 * 엑셀 상단 영역에서 기본정보(거래처, 현장, 날짜 등) 추출
 * 발주서는 보통 상단 1~10행에 메타 정보가 있음
 */
function extractMeta(rows: string[][]): ParsedOrderMeta {
  const meta: ParsedOrderMeta = {
    customer_name: '',
    site_name: '',
    order_date: '',
    delivery_date: '',
    remark: '',
    packaging_note: extractPackagingNote(rows),
  };

  const META_PATTERNS: Record<string, { keywords: string[]; field: keyof ParsedOrderMeta }> = {
    customer: { keywords: ['업체', '거래처', '발주자', '수신', '고객', '시공사', '업체명'], field: 'customer_name' },
    site: { keywords: ['현장', '공사명', '현장명', 'Project명', '프로젝트'], field: 'site_name' },
    order_date: { keywords: ['주문일', '발주일', '의뢰일', '작성일', '날짜', '발주일자', '의뢰일자', '주문서발송일'], field: 'order_date' },
    delivery_date: { keywords: ['납품일', '출고일', '납기일', '납품일자', '납기', '납기일자', '현장납기일'], field: 'delivery_date' },
  };

  // 모든 키워드를 하나의 Set으로 수집 (다른 라벨인지 판별용)
  const allKeywords = new Set<string>();
  for (const { keywords } of Object.values(META_PATTERNS)) {
    keywords.forEach(kw => allKeywords.add(kw));
  }

  function isOtherLabel(val: string): boolean {
    const normalized = val.replace(/\s+/g, '');
    return [...allKeywords].some(kw => normalized.includes(kw));
  }

  // 상단 15행 스캔 — 각 필드별 독립 탐색
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? '').trim();
      if (!cell) continue;
      const cellNoSpace = cell.replace(/\s+/g, '');

      for (const { keywords, field } of Object.values(META_PATTERNS)) {
        if (meta[field]) continue;

        const isLabel = keywords.some(kw => cellNoSpace === kw || (cellNoSpace.length < kw.length + 5 && cellNoSpace.includes(kw)));
        if (!isLabel) continue;

        // 다음 셀에 값이 있는지 확인
        const nextCell = String(row[j + 1] ?? '').trim();
        // 같은 셀에 "라벨: 값" 형식
        const colonSplit = cell.split(/[:：]/);

        if (nextCell && nextCell.length > 1 && !isOtherLabel(nextCell)) {
          meta[field] = formatMetaValue(nextCell, field);
        } else if (colonSplit.length > 1 && colonSplit[1].trim()) {
          meta[field] = formatMetaValue(colonSplit[1].trim(), field);
        } else {
          // j+2, j+3 셀 확인 (병합 셀 때문에 빈 셀 건너뛸 수 있음)
          for (let k = j + 1; k < Math.min(j + 4, row.length); k++) {
            const val = String(row[k] ?? '').trim();
            if (val && val.length > 1 && !isOtherLabel(val)) {
              meta[field] = formatMetaValue(val, field);
              break;
            }
          }
          // 아래 행 확인
          if (!meta[field]) {
            const belowRow = rows[i + 1];
            if (belowRow) {
              const belowVal = String(belowRow[j] ?? '').trim();
              if (belowVal && belowVal.length > 1 && !isOtherLabel(belowVal)) {
                meta[field] = formatMetaValue(belowVal, field);
              }
            }
          }
        }
      }
    }
  }

  return meta;
}

/**
 * 상단 20행에서 포장 지시 문구를 모은다.
 *
 * 예) "※ 5차(21~25F) 주문서별 포장요망 (동순서 3-4-2-1-5) ..."
 *     " 1,3,4동( 1,2,3호 포장,4,5호 포장),2동(1,2호 포장, 3,4,5호포장), 5동 ( 1,2,3호 포장 )"
 * 두 줄에 나뉘어 있어 "포장"이 들어간 줄을 전부 이어 붙인다.
 */
function extractPackagingNote(rows: string[][]): string {
  const lines: string[] = [];

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const text = String(cell ?? '').trim();
      if (text.length > 4 && /포\s*장|라벨|스티커/.test(text)) {
        lines.push(text);
        break;
      }
    }
  }

  return lines.join('\n');
}

function formatMetaValue(value: string, field: keyof ParsedOrderMeta): string {
  if (field === 'order_date' || field === 'delivery_date') {
    // Date 객체 또는 Date 문자열 ("Sun Aug 24 2025 23:59:08 GMT+0900...")
    const date = new Date(value);
    if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
      return date.toISOString().split('T')[0];
    }
    // Excel 시리얼 번호 (예: 45894)
    const num = Number(value);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      const d = new Date((num - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
    // YYYY.MM.DD / YYYY-MM-DD / "2026년 06월 09일" 패턴
    const match = value.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  return value;
}

function parseRows(
  rawData: Record<string, unknown>[],
  sheetName: string,
  warnings: string[]
): { items: ParsedOrderItem[]; sheetName: string; totalRows: number; warnings: string[] } {
  const headers = Object.keys(rawData[0] || {});
  // 첫 행이 하위 헤더(두께/가로/세로 등)일 수 있으므로 전달
  const columnMap = findColumnMapping(headers, rawData[0] as Record<string, unknown>);

  const items: ParsedOrderItem[] = [];
  let lastProductName = ''; // 품명 병합 셀 대응: 빈 품명이면 이전 품명 상속

  const locations = buildRowLocations(rawData, columnMap);

  for (const [rowIndex, row] of rawData.entries()) {
    let productName = getString(row, columnMap.product_name);
    const width = getNumber(row, columnMap.width_mm);
    const height = getNumber(row, columnMap.height_mm);
    const quantityRaw = getNumberOrNull(row, columnMap.quantity);

    const isSummary = !!productName && /합계|소계|TOTAL|SUM/i.test(productName);

    // 품명 병합 셀: 품명이 비어있으면 이전 품명 상속.
    // 버려질 행(수량 0짜리 "발주 없음" 행 등)에도 품명이 적혀 있고 다음 줄이
    // 그걸 물려받아야 하므로, 건너뛰기 판정보다 먼저 기억해 둔다.
    if (productName && !isSummary) {
      lastProductName = productName;
    } else if (!productName) {
      productName = lastProductName;
    }

    // 빈 행이나 소계/합계 행 건너뛰기
    if (!productName && !width && !height) continue;
    if (isSummary) continue;
    if (width <= 0 || height <= 0) continue;
    // 수량이 대놓고 0으로 적힌 행은 "이 세대엔 이 품목 없음" 표시다 (빈 칸과 구분해야 한다).
    if (quantityRaw !== null && quantityRaw <= 0) continue;

    const quantity = quantityRaw ?? 0;

    // 아파트 발주서에서 뽑아낸 동·호·타입·층은 컬럼 매핑으로는 잡히지 않는다
    // (한 칸에 "3동 1호", 다음 줄에 "84A 21~25F" 식으로 들어 있다).
    // 매핑된 값이 있으면 그쪽을 존중하고, 없을 때만 채운다.
    const loc = locations[rowIndex];
    const mappedRoom = getString(row, columnMap.location_room);
    const isDongHoRoom = !mappedRoom || DONG_HO_RE.test(mappedRoom) || TYPE_FLOOR_RE.test(mappedRoom);

    items.push({
      product_name: productName,
      width_mm: width > 0 ? String(width) : '',
      height_mm: height > 0 ? String(height) : '',
      quantity: quantity > 0 ? String(quantity) : '1',
      location_dong: getString(row, columnMap.location_dong) || loc.dong,
      location_line: getString(row, columnMap.location_line) || loc.line,
      location_floor: getString(row, columnMap.location_floor) || loc.floor,
      location_room: isDongHoRoom ? loc.room : mappedRoom,
      location_type: getString(row, columnMap.location_type) || loc.type,
      location_window_type: getString(row, columnMap.location_window_type),
      remark: getString(row, columnMap.remark),
    });
  }

  if (items.length === 0) {
    warnings.push('유효한 품목 데이터가 없습니다. 가로/세로 값이 있는 행만 인식됩니다.');
  }

  return { items, sheetName, totalRows: rawData.length, warnings };
}

const DONG_HO_RE = /(\d+)\s*동\s*(\d+)\s*호/;
const TYPE_FLOOR_RE = /^(\S+)\s+(\d+\s*~\s*\d+\s*F|\d+\s*F)$/;

interface RowLocation {
  dong: string;
  line: string;
  type: string;
  floor: string;
  room: string;
}

/**
 * 동·호 / 타입·층을 행 단위로 확정한다.
 *
 * 아파트 발주서는 "3동 1호" 아래 줄에 "84A 21~25F" 가 오는 2줄 블록 구조라,
 * 단순히 "마지막에 본 값"을 물려받으면 블록 첫 줄이 직전 블록의 타입을 달고 나온다.
 * 그래서 블록이 시작되면 다음 블록 전까지를 미리 훑어 타입·층을 블록 전체에 적용한다.
 */
function buildRowLocations(
  rawData: Record<string, unknown>[],
  columnMap: Record<string, string>
): RowLocation[] {
  // 품명·치수·수량 칸은 위치 후보에서 제외한다 (품명이 실명으로 잡히는 걸 막는다)
  const excluded = new Set(
    ['product_name', 'width_mm', 'height_mm', 'quantity'].map(f => columnMap[f]).filter(Boolean)
  );

  const found = rawData.map(row => {
    const cells = Object.entries(row)
      .filter(([key]) => !excluded.has(key))
      .map(([, v]) => String(v ?? '').trim())
      .filter(Boolean);
    const firstMatch = (re: RegExp): RegExpMatchArray | undefined => {
      for (const c of cells) {
        const m = c.match(re);
        if (m) return m;
      }
      return undefined;
    };
    return { cells, dongHo: firstMatch(DONG_HO_RE), typeFloor: firstMatch(TYPE_FLOOR_RE) };
  });

  // 블록 = 동·호가 같은 연속 구간. 이 양식은 동·호가 매 줄 반복되기도 하므로
  // "값이 바뀌는 지점"을 블록 시작으로 본다.
  const keyOf = (m?: RegExpMatchArray) => (m ? `${m[1]}-${m[2]}` : '');
  const blockTypeFloor: (RegExpMatchArray | undefined)[] = new Array(rawData.length);

  let lastKey = '';
  for (let i = 0; i < found.length; i++) {
    const key = keyOf(found[i].dongHo);
    if (!key || key === lastKey) continue;
    lastKey = key;

    // 블록이 끝날 때까지(다음 동·호가 나올 때까지) 훑어 타입·층을 찾는다
    let typeFloor = found[i].typeFloor;
    let end = i;
    for (let j = i + 1; j < found.length; j++) {
      const k = keyOf(found[j].dongHo);
      if (k && k !== key) break;
      end = j;
      typeFloor ??= found[j].typeFloor;
    }
    for (let j = i; j <= end; j++) blockTypeFloor[j] = typeFloor;
  }

  const locations: RowLocation[] = [];
  let lastDongHo: RegExpMatchArray | undefined;

  for (let i = 0; i < found.length; i++) {
    if (found[i].dongHo) lastDongHo = found[i].dongHo;
    const tf = blockTypeFloor[i];

    const room = found[i].cells.find(
      c => !DONG_HO_RE.test(c) && !TYPE_FLOOR_RE.test(c) && isNaN(Number(c))
    );

    locations.push({
      dong: lastDongHo ? `${lastDongHo[1]}동` : '',
      line: lastDongHo ? `${lastDongHo[2]}호` : '',
      type: tf ? tf[1] : '',
      floor: tf ? tf[2].replace(/\s+/g, '') : '',
      room: room ?? '',
    });
  }

  return locations;
}

/**
 * 헤더 문자열이 별칭과 일치하는지 판정.
 *
 * 'W' · 'H' · 'F' · '동' · '층' 처럼 짧은 별칭은 부분 일치를 허용하면 오탐이 심하다.
 * 특히 날짜 셀은 Date 로 읽혀 "Wed Jun 11 2026 ..." 로 문자열화되는데,
 * 여기에 'W' 가 걸리면 발주일 행이 헤더로 오인돼 시트 전체가 0건이 된다.
 * 그래서 한 글자 별칭과 짧은 영문 별칭은 완전 일치만 인정한다.
 */
function aliasMatches(normalizedHeader: string, alias: string): boolean {
  const a = alias.toLowerCase();
  const strict = a.length === 1 || /^[a-z]{1,2}$/.test(a);
  return strict ? normalizedHeader === a : normalizedHeader === a || normalizedHeader.includes(a);
}

function findColumnMapping(headers: string[], firstDataRow?: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const header of headers) {
      const normalized = header.replace(/\s+/g, '').toLowerCase();
      for (const alias of aliases) {
        if (aliasMatches(normalized, alias)) {
          map[field] = header;
          break;
        }
      }
      if (map[field]) break;
    }
  }

  // __EMPTY 컬럼 처리: 첫 데이터 행의 값으로 컬럼 의미 파악
  if (firstDataRow) {
    for (const header of headers) {
      if (!header.startsWith('__EMPTY')) continue;
      const val = String(firstDataRow[header] ?? '').replace(/\s+/g, '').toLowerCase();
      if (!map.width_mm && (val === '가로' || val.includes('가로'))) map.width_mm = header;
      else if (!map.height_mm && (val === '세로' || val.includes('세로'))) map.height_mm = header;
      else if (!map.quantity && (val === '수량' || val.includes('수량') || val === '합계' || val.includes('합계'))) map.quantity = header;
    }
  }

  return map;
}

function getString(row: Record<string, unknown>, column: string | undefined): string {
  if (!column) return '';
  const val = row[column];
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/** 빈 칸(null)과 숫자 0을 구분해서 돌려준다. */
function getNumberOrNull(row: Record<string, unknown>, column: string | undefined): number | null {
  if (!column) return null;
  const val = row[column];
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : Math.round(num);
}

function getNumber(row: Record<string, unknown>, column: string | undefined): number {
  if (!column) return 0;
  const val = row[column];
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : Math.round(num);
}
