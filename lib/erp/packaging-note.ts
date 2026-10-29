/**
 * 발주서에서 포장 단위를 찾아낸다.
 *
 * 포장 단위는 "주는 사람이나 건물 형태에 따라" 달라지는 값이라 한 가지 방법으로는 못 잡는다.
 * 근거를 여러 곳에서 찾아 보고, 무엇을 근거로 삼았는지 호출 측에 그대로 넘긴다.
 * 전부 실패하면 임의로 정하지 않고 사람이 고르게 한다.
 *
 * 근거 우선순위
 *  1. 품목 영역의 "N동 x,y호 같이 포장" 표시행 — 동·호가 명시돼 가장 정확하다 (3차부터 존재)
 *  2. 상단 자유 서식의 포장 지시문 — "1,3,4동( 1,2,3호 포장,4,5호 포장),2동(…)"
 *  3. 품목의 동·호 조합에서 동별로 추론
 *
 * 2번은 상단 20행 중 "포장" 이 들어간 첫 줄을 쓰면 안 된다.
 * 실제 발주서는 11행이 "※ 7차 주문서별 포장요망 (동순서 3-4-2-1-5)" 이고
 * 정작 포장 단위는 12행에 있다. 그래서 줄마다 해석을 시도해 가장 많이 나온 줄을 쓴다.
 */
import { parsePackagingInstruction, formatUnitRange, type PackagingGroup, type WorkOrderSourceItem } from '@/lib/work-order/build';
import { parseDongOrder, type PackagingSource } from './upload-sheet';

export interface PackagingDetection {
  groups: PackagingGroup[];
  source: PackagingSource;
  /** 근거가 된 원문 — 화면에 그대로 보여 준다 */
  evidence: string;
  /** 동순서 지시 ("3동","4동",…) */
  dongOrder: string[];
  notes: string[];
}

/** "1동 1,2,3호 같이 포장" / "2동 3,4,5호 같이포장" */
const MARKER_RE = /(\d+)\s*동\s*([\d,\s~]+?)\s*호\s*같이\s*포장/;

/**
 * @param topLines    상단 자유 서식 영역을 행 단위로 합친 문자열들 (보통 20행)
 * @param markerCells 시트 전체에서 "같이 포장" 이 들어간 셀 텍스트들
 * @param items       파싱된 품목 — 동·호 추론 폴백용
 */
export function detectPackaging(
  topLines: string[],
  markerCells: string[],
  items: WorkOrderSourceItem[],
): PackagingDetection {
  const notes: string[] = [];
  const dongOrder = parseDongOrderFrom(topLines);

  // ── 1. "같이 포장" 표시행 ────────────────────────────────
  const fromMarkers = groupsFromMarkers(markerCells);

  // ── 2. 상단 포장 지시문 ─────────────────────────────────
  const fromInstruction = groupsFromTopLines(topLines);

  if (fromMarkers.groups.length > 0) {
    // 지시문과 개수가 다르면 사람이 보고 판단해야 한다.
    if (fromInstruction.groups.length > 0 && fromInstruction.groups.length !== fromMarkers.groups.length) {
      notes.push(
        `포장 단위 근거가 엇갈립니다 — 표시행 ${fromMarkers.groups.length}개, 지시문 ${fromInstruction.groups.length}개. ` +
          '동·호가 명시된 표시행을 따랐습니다.',
      );
    }
    return { ...fromMarkers, source: 'instruction', dongOrder, notes };
  }

  if (fromInstruction.groups.length > 0) {
    return { ...fromInstruction, source: 'instruction', dongOrder, notes };
  }

  // ── 3. 동·호 조합에서 추론 ───────────────────────────────
  const derived = groupsByDong(items);
  if (derived.length > 0) {
    const hint = topLines.find(l => /포장/.test(l))?.trim() ?? '';
    notes.push(
      '포장 단위를 발주서에서 읽지 못해 동별로 나눴습니다. 실제 포장 단위를 확인해 주세요.' +
        (hint ? ` (발주서 문구: "${collapse(hint)}")` : ''),
    );
    return { groups: derived, source: 'derived', evidence: hint, dongOrder, notes };
  }

  notes.push('포장 단위와 동·호를 모두 읽지 못했습니다. 전체를 한 장으로 묶었습니다.');
  return { groups: [], source: 'fallback-single', evidence: '', dongOrder, notes };
}

/** "같이 포장" 표시행에서 포장 단위를 만든다. */
function groupsFromMarkers(cells: string[]): { groups: PackagingGroup[]; evidence: string } {
  const groups: PackagingGroup[] = [];
  const seen = new Set<string>();
  const used: string[] = [];

  for (const cell of cells) {
    const m = cell.match(MARKER_RE);
    if (!m) continue;
    const dong = `${m[1]}동`;
    const units = expandUnits(m[2]);
    if (units.length === 0) continue;

    const label = `${dong} ${formatUnitRange(units)}`;
    if (seen.has(label)) continue;
    seen.add(label);
    groups.push({ dong, units, label });
    used.push(collapse(cell));
  }

  return { groups, evidence: used.join(' / ') };
}

/**
 * 상단 줄마다 포장 지시문 해석을 시도해 가장 많이 나온 줄을 채택한다.
 * 여러 줄에 걸쳐 적힌 경우를 대비해 인접 두 줄을 이어 붙인 것도 후보로 넣는다.
 */
function groupsFromTopLines(topLines: string[]): { groups: PackagingGroup[]; evidence: string } {
  const candidates: string[] = [...topLines];
  for (let i = 0; i < topLines.length - 1; i++) {
    candidates.push(`${topLines[i]} ${topLines[i + 1]}`);
  }

  let best: { groups: PackagingGroup[]; evidence: string } = { groups: [], evidence: '' };
  for (const line of candidates) {
    if (!/포장/.test(line)) continue;
    const groups = dedupe(parsePackagingInstruction(line));
    if (groups.length > best.groups.length) best = { groups, evidence: collapse(line) };
  }
  return best;
}

/** 품목의 동·호에서 동별 포장을 만든다 (마지막 폴백). */
function groupsByDong(items: WorkOrderSourceItem[]): PackagingGroup[] {
  const byDong = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.location_dong || !it.location_line) continue;
    if (!byDong.has(it.location_dong)) byDong.set(it.location_dong, new Set());
    byDong.get(it.location_dong)!.add(it.location_line);
  }

  return [...byDong.entries()]
    .sort((a, b) => numOf(a[0]) - numOf(b[0]))
    .map(([dong, unitSet]) => {
      const units = [...unitSet].sort((a, b) => numOf(a) - numOf(b));
      return { dong, units, label: `${dong} ${formatUnitRange(units)}` };
    });
}

/** 품목의 동·호를 호 단위로 쪼갠다 (사용자가 "동·호별로 나누기" 를 고를 때). */
export function groupsByUnit(items: WorkOrderSourceItem[]): PackagingGroup[] {
  const seen = new Map<string, PackagingGroup>();
  for (const it of items) {
    if (!it.location_dong || !it.location_line) continue;
    const label = `${it.location_dong} ${it.location_line}`;
    if (!seen.has(label)) seen.set(label, { dong: it.location_dong, units: [it.location_line], label });
  }
  return [...seen.values()].sort(
    (a, b) => numOf(a.dong) - numOf(b.dong) || numOf(a.units[0]) - numOf(b.units[0]),
  );
}

/** 동별 포장 — 화면에서 고를 수 있게 공개한다. */
export function groupsByDongPublic(items: WorkOrderSourceItem[]): PackagingGroup[] {
  return groupsByDong(items);
}

/** "1,2,3" · "3~5" · "1,3" → ["1호","2호",…] */
function expandUnits(text: string): string[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const range = part.match(/(\d+)\s*~\s*(\d+)/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
      continue;
    }
    const one = part.match(/\d+/);
    if (one) out.add(Number(one[0]));
  }
  return [...out].sort((a, b) => a - b).map(n => `${n}호`);
}

function dedupe(groups: PackagingGroup[]): PackagingGroup[] {
  const seen = new Set<string>();
  return groups.filter(g => (seen.has(g.label) ? false : (seen.add(g.label), true)));
}

/** 상단 줄들에서 "동순서 3-4-2-1-5" 를 찾는다. */
function parseDongOrderFrom(topLines: string[]): string[] {
  for (const line of topLines) {
    const order = parseDongOrder(line);
    if (order.length > 0) return order;
  }
  return [];
}

const numOf = (s: string) => parseInt(s, 10) || 0;
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
