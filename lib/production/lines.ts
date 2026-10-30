/**
 * 생산 라인(호기) — 이름을 바꾸고 새로 더할 수 있다 (2026-10-30 회의: "미니라인 등 라인이 늘 수 있으니 호기를 고정하지 말고 편집").
 *
 * 생산 기록은 호기 번호(line_number)만 갖고, 이름은 표 dgflow_production_lines 에 둔다
 * (supabase/migrations/20261030_020_production_lines.sql). 표가 아직 없으면 1호기 · 2호기로 동작한다.
 * 주간 · 야간은 그대로 둔다 (사용자 결정).
 */
export interface ProductionLine {
  line_number: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export const DEFAULT_LINES: ProductionLine[] = [
  { line_number: 1, name: '1호기', sort_order: 1, is_active: true },
  { line_number: 2, name: '2호기', sort_order: 2, is_active: true },
];

/** 호기 번호 → 이름 (모르는 번호는 "n호기") */
export function lineName(lines: ProductionLine[], lineNumber: number | null | undefined): string {
  const n = lineNumber ?? 1;
  return lines.find(l => l.line_number === n)?.name ?? `${n}호기`;
}

/** 화면에서 고를 호기 — 쓰는 것만, 순서대로 */
export function activeLines(lines: ProductionLine[]): ProductionLine[] {
  return lines.filter(l => l.is_active).sort((a, b) => a.sort_order - b.sort_order || a.line_number - b.line_number);
}
