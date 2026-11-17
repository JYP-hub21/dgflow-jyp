import { describe, expect, it } from 'vitest';
import { resolveActions, wantedNumbers, type ActionFacts, type RawAction } from '@/lib/prism/actions';
import { answerAsText, type PrismAnswer } from '@/lib/prism/chat';
import { aggregate, statText, type StatInput } from '@/lib/prism/stats';

const act = (kind: RawAction['kind'], from = '', to = '', query = ''): RawAction => ({ kind, from, to, query });
const facts = (over: Partial<ActionFacts> = {}): ActionFacts => ({
  dataFrom: '2026-08-26', dataTo: '2026-11-11', workOrders: new Map([['26-2573', 'id-2573']]), canProduction: true, ...over,
});

describe('DG 프리즘이 해 주는 일 — 버튼 만들기 (lib/prism/actions.ts)', () => {
  it('"4월부터 10월까지 생산일지 다운로드" — 기간 엑셀 버튼', () => {
    const { actions, notes } = resolveActions([act('download_bokcheung', '2026-04-01', '2026-10-31')], facts());
    expect(notes).toEqual([]);
    expect(actions).toEqual([{
      type: 'download', kind: 'bokcheung', from: '2026-04-01', to: '2026-10-31',
      label: '복층생산일지 엑셀 다운로드', detail: '2026-04-01 – 2026-10-31 · 생산이 있는 날마다 시트 한 장',
    }]);
  });

  it('자료가 없는 기간이면 버튼을 만들지 않고 자료가 있는 기간을 알린다', () => {
    const { actions, notes } = resolveActions([act('download_bokcheung', '2026-04-01', '2026-06-30')], facts());
    expect(actions).toEqual([]);
    expect(notes[0]).toContain('2026-08-26 – 2026-11-11');
    expect(resolveActions([act('download_weekly', '2026-11-20')], facts()).actions).toEqual([]);
    expect(resolveActions([act('download_bokcheung', '2026-11-01', '2026-11-05')], facts({ dataFrom: null, dataTo: null })).notes[0]).toContain('아직 들어 있는 생산 기록이 없습니다');
  });

  it('날짜가 뒤집혀 오면 바로잡고, 하루만 오면 그날 하루', () => {
    expect(resolveActions([act('download_bokcheung', '2026-11-11', '2026-10-22')], facts()).actions[0]).toMatchObject({ from: '2026-10-22', to: '2026-11-11' });
    expect(resolveActions([act('download_bokcheung', '2026-11-11')], facts()).actions[0]).toMatchObject({ from: '2026-11-11', to: '2026-11-11', detail: '11/11(수)' });
  });

  it('없는 날짜 · 366일 넘는 기간은 까닭을 알린다', () => {
    expect(resolveActions([act('download_bokcheung', '2026-02-30', '2026-03-01')], facts()).notes[0]).toContain('기간을 알아듣지 못했습니다');
    expect(resolveActions([act('download_bokcheung', '2025-01-01', '2026-11-11')], facts()).notes[0]).toContain('366일까지');
  });

  it('주간생산일지는 그 주의 월요일 – 토요일로 맞춘다', () => {
    const { actions } = resolveActions([act('download_weekly', '2026-11-05'), act('open_weekly', '2026-11-05')], facts());
    expect(actions[0]).toMatchObject({ type: 'download', kind: 'weekly', from: '2026-11-02', to: '2026-11-07', detail: '11/2(월) – 11/7(토) 주' });
    expect(actions[1]).toMatchObject({ type: 'open', href: '/production/report?view=weekly&date=2026-11-02' });
  });

  it('화면 열기 — 날짜 · 기간 · 재고', () => {
    const { actions } = resolveActions([act('open_bokcheung', '2026-11-11'), act('open_period', '2026-10-01', '2026-10-31'), act('open_stock')], facts());
    expect(actions.map(a => a.type === 'open' && a.href)).toEqual([
      '/production/report?date=2026-11-11', '/production/report?view=period&from=2026-10-01&to=2026-10-31', '/deliveries?view=stock',
    ]);
  });

  it('의뢰번호로 열기 — 서버가 찾은 번호만, 없으면 알린다', () => {
    const raw = [act('open_work_order', '', '', '26-2573'), act('open_production_input', '', '', '26-9999')];
    expect(wantedNumbers(raw)).toEqual(['26-2573', '26-9999']);
    const { actions, notes } = resolveActions(raw, facts());
    expect(actions).toEqual([{ type: 'open', href: '/work-orders/id-2573', label: '작업의뢰서 26-2573 열기', detail: '품목 · 생산 · 납품 내역' }]);
    expect(notes).toEqual(['의뢰번호 26-9999 작업의뢰서를 찾지 못했습니다.']);
  });

  it('검색 — 찾을 말은 주소에 안전하게 넣는다', () => {
    const { actions } = resolveActions([act('search_work_orders', '', '', '현장 A&B')], facts());
    expect(actions[0]).toMatchObject({ type: 'open', href: '/work-orders?q=%ED%98%84%EC%9E%A5%20A%26B', label: '작업의뢰서에서 검색', detail: '"현장 A&B"' });
  });

  it('생산 현황 권한이 없으면 생산일지 · 납품 쪽 일은 안 준다(작업의뢰서는 준다)', () => {
    const { actions, notes } = resolveActions([act('download_bokcheung', '2026-11-01', '2026-11-11'), act('open_work_order', '', '', '26-2573')], facts({ canProduction: false }));
    expect(actions.map(a => a.label)).toEqual(['작업의뢰서 26-2573 열기']);
    expect(notes).toEqual(['생산 현황을 볼 권한이 없어 이 일은 해 드릴 수 없습니다.']);
  });

  it('같은 일은 한 번만, 한 번에 3개까지', () => {
    const raw = [act('open_stock'), act('open_stock'), act('open_bokcheung', '2026-11-11'), act('open_bokcheung', '2026-11-10'), act('open_bokcheung', '2026-11-09')];
    expect(resolveActions(raw, facts()).actions).toHaveLength(3);
  });

  it('다음 질문 때 AI 가 버튼을 준 것을 알게 글로 남긴다', () => {
    const a: PrismAnswer = { reply: '아래 버튼으로 받으실 수 있습니다.', stats: [], chart_title: '', chart_unit: '', chart: [], items: [], links: [],
      actions: resolveActions([act('download_bokcheung', '2026-11-11')], facts()).actions };
    expect(answerAsText(a)).toContain('[버튼을 드렸음: 복층생산일지 엑셀 다운로드 · 11/11(수)]');
    // 예전에 저장된 대화에는 actions 가 없다
    expect(answerAsText({ ...a, actions: undefined })).toBe('아래 버튼으로 받으실 수 있습니다.');
  });
});

describe('DG 프리즘 조회 도구의 집계 (lib/prism/stats.ts)', () => {
  const rows: StatInput[] = [
    { date: '2026-10-30', qty: 10, area: 12.5, line: 1, shift: 'day', customer: '가', site: 'A현장', number: '26-1' },
    { date: '2026-10-31', qty: 5, area: 6, line: 2, shift: 'night', customer: '가', site: 'A현장', number: '26-1' },
    { date: '2026-11-02', qty: 7, area: 8.25, line: 1, shift: 'day', customer: '나', site: 'B현장', number: '26-2' },
    { date: '2026-11-02', qty: 0, area: 0, line: 1, shift: 'day', customer: '나', site: 'B현장', number: '26-2' },
  ];
  it('달별 · 주별은 시간순', () => {
    expect(aggregate(rows, 'month').rows).toEqual([{ key: '2026-10', qty: 15, area: 18.5 }, { key: '2026-11', qty: 7, area: 8.25 }]);
    // 10/30(금) · 10/31(토) 은 10/26 주, 11/2(월) 은 11/2 주
    expect(aggregate(rows, 'week').rows.map(r => r.key)).toEqual(['2026-10-26 주', '2026-11-02 주']);
  });
  it('호기 · 주야간 · 거래처는 많은 순, 합계와 기록이 있는 날 수', () => {
    const line = aggregate(rows, 'line');
    expect(line.rows).toEqual([{ key: '1호기', qty: 17, area: 20.75 }, { key: '2호기', qty: 5, area: 6 }]);
    expect(line.total).toEqual({ qty: 22, area: 26.75 });
    expect(line.days).toBe(3);
    expect(aggregate(rows, 'shift').rows.map(r => `${r.key} ${r.qty}`)).toEqual(['주간 17', '야간 5']);
    expect(aggregate(rows, 'site').rows[0].key).toBe('가 · A현장');
  });
  it('줄이 많으면 위에서 몇 개만 남기고 나머지는 한 줄로', () => {
    const many: StatInput[] = Array.from({ length: 50 }, (_, i) => ({ date: '2026-11-02', qty: 50 - i, area: 1, customer: `거래처${i}` }));
    const res = aggregate(many, 'customer', 10);
    expect(res.rows).toHaveLength(11);
    expect(res.folded).toBe(40);
    expect(res.rows[10].key).toBe('그 밖 40곳');
    expect(res.rows.reduce((s, r) => s + r.qty, 0)).toBe(res.total.qty);
  });
  it('AI 에게 주는 글 — 단위까지, 없으면 없다고', () => {
    expect(statText('복층 생산', aggregate(rows, 'month'))).toContain('  - 2026-10 | 15조 | 18.5M²');
    expect(statText('복층 생산', aggregate([], 'total'))).toBe('복층 생산\n- 기록이 없습니다.');
  });
});
