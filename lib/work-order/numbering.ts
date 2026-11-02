/**
 * 작업의뢰서 품목 번호(NO) — 종이에 찍힌 번호 그대로 (2026-11-02 사용자 확인 "정렬을 어떻게 해도 넘버는 변하면 안 됨").
 *
 * 엑셀 · PDF 에서 읽은 줄은 문서의 NO 를 갖고 있다. 손으로 더한 줄은 번호가 없어서 바로 앞 줄 번호 + 1 로 잇는다.
 * 예전에는 "채워진 줄의 순서" 로 번호를 매겨, 등록 화면에서 줄을 지우거나 끼우거나 빈칸이 있으면 종이와 어긋났다.
 */
export function numberRows(rows: { no?: number | '' | null }[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const r of rows) {
    const no = typeof r.no === 'number' && r.no > 0 ? r.no : prev + 1;
    out.push(no);
    prev = no;
  }
  return out;
}
