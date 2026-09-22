/**
 * 위치 문장 파서 — 발주서마다 제각각인 위치 문장에서 동·호·라인·층·타입을 뽑아낸다.
 *
 * 실제 발주서 15종에서 본 표기:
 *   "1동 1호 84A 31~35F 거실F(外)"        우미
 *   "84A(2동 4.5라인) 21~22층 거실 外,大"  우미 장안 (ERP 표기)
 *   "9동" / "3호~6호" / "6동 1,7 라인"     극동
 *   "301동 1~2라인 59A 글레이징"           대진글라스
 *   "2동 84AL 타입 3~17층 침실 1 (외창)"   정석개발
 *   "5~10층" / "1~라인" / "(최상층10층)"    이랜드
 *   "1BL-2 2층 복도" / "1층 피트니스"       동신 · 제일 (구역 이름)
 *
 * 없는 항목은 undefined 로 둔다. 해석이 안 되는 나머지는 rest 에 남긴다.
 */

export interface ParsedLocation {
  dong?: number;
  ho?: number[];
  line?: number[];
  floor?: string;      // "21~24층" 처럼 정규화
  type?: string;       // 84A, 59B, 84AL
  zone?: string;       // 1BL-2 같은 블록/구역 표기
  rest: string;        // 실명 등 나머지
}

/** "1,2,3" · "1~3" · "3호~6호" · "4.5" · "1.2" → [1,2,3] */
export function expandNums(text: string): number[] {
  const t = text.replace(/호|라인|층|F/g, '').trim();
  const out = new Set<number>();
  for (const part of t.split(/[,、]/)) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)\s*[~\-]\s*(\d+)$/);
    if (range) {
      const a = +range[1], b = +range[2];
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
      continue;
    }
    // "4.5" 는 4와 5 (라인 표기 관행), "1.2.3" 도 마찬가지
    for (const d of p.split('.')) if (/^\d+$/.test(d)) out.add(+d);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseLocation(text: string): ParsedLocation {
  let s = (text || '').replace(/\s+/g, ' ').trim();
  const out: ParsedLocation = { rest: '' };
  if (!s) return out;

  // ※ JS 정규식의 \b 는 한글 앞뒤에서 동작하지 않으므로, 영숫자 경계는 lookaround 로 잡는다.
  // 구역/블록 표기 1BL-2, 3BL
  const zone = s.match(/(?<![A-Za-z0-9])(\d+BL(?:-\d+)?)(?![A-Za-z0-9])/);
  if (zone) { out.zone = zone[1]; s = s.replace(zone[0], ' '); }

  // 동 — "9동", "301동", "(2동 4.5라인)"
  const dong = s.match(/(\d+)\s*동(?!\s*측)/);
  if (dong) { out.dong = +dong[1]; s = s.replace(dong[0], ' '); }

  // 호 — "3호~6호" / "1~3호" (범위) 를 먼저, 그다음 "1호" / "1,2호" (목록)
  const hoRange = s.match(/(\d+)\s*호?\s*[~\-]\s*(\d+)\s*호(?!이스트)/);
  if (hoRange) { out.ho = expandNums(`${hoRange[1]}~${hoRange[2]}`); s = s.replace(hoRange[0], ' '); }
  else {
    const ho = s.match(/(\d+(?:\s*[,、]\s*\d+)*)\s*호(?!이스트)/);
    if (ho) { out.ho = expandNums(ho[1]); s = s.replace(ho[0], ' '); }
  }

  // 라인 — "1라인", "1~2라인", "4.5라인", "1,7 라인", "1~라인"(끝 없음 → 무시)
  const line = s.match(/(\d+(?:\s*[~\-.,、]\s*\d+)*)\.?\s*라인/);   // "3.라인" 처럼 점만 남은 표기도
  if (line) { out.line = expandNums(line[1]); s = s.replace(line[0], ' '); }
  else s = s.replace(/\d+\s*~\s*라인/, ' ');

  // 층 — "21~24층", "31~35F", "5층", "지하1층", "(최상층10층)"
  const floor = s.match(/((?:지하)?\d+)\s*(?:[~\-]\s*((?:지하)?\d+))?\s*(층|F)(?![A-Za-z0-9])/);
  if (floor) {
    out.floor = floor[2] ? `${floor[1]}~${floor[2]}층` : `${floor[1]}층`;
    s = s.replace(floor[0], ' ');
  }

  // 타입 — "84A", "59B타입", "84AL 타입"
  const type = s.match(/(?<![A-Za-z0-9])(\d{2,3}[A-Z]{1,2})(?:\s*타입)?(?![A-Za-z0-9])/);
  if (type) { out.type = type[1]; s = s.replace(type[0], ' '); }

  out.rest = s.replace(/[()\s]+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
  return out;
}
