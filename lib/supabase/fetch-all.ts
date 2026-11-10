/**
 * 끝까지 나눠 읽기 — Supabase(PostgREST)는 한 번에 최대 1,000줄만 돌려준다(`.limit(5000)` 을 줘도 1,000).
 * 넘으면 오류 없이 잘려 합계 · 마지막 생산일 · 진행률이 조용히 틀린다 (2026-11-10 전체 점검).
 * 같은 순서가 보장되도록 호출하는 쪽에서 `.order(...)` 를 꼭 건다.
 *
 *   const rows = await fetchAll((from, to) => supabase.from('t').select('a').order('id').range(from, to));
 */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** `.in('열', ids)` 가 너무 길면 주소 길이 한도에 걸린다 — 묶음으로 나눠 읽고 합친다 */
export async function fetchAllIn<T>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 150,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    out.push(...(await fetchAll<T>((from, to) => page(chunk, from, to))));
  }
  return out;
}
