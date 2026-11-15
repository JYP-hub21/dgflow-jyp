import { describe, expect, it } from 'vitest';
import { intakeByWeek, mondayOf, snapshotText, type Snapshot } from '@/lib/prism/snapshot';
import { answerAsText, checkTurns, toApiMessages, type PrismAnswer } from '@/lib/prism/chat';

describe('DG 프리즘 대화 — 현황 글', () => {
  it('월요일 시작 주로 접수를 센다', () => {
    expect(mondayOf('2026-11-15')).toBe('2026-11-09'); // 일요일 → 그 주 월요일
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    const weeks = intakeByWeek(['2026-11-09', '2026-11-14', '2026-11-03', '2026-08-01'], '2026-11-15', 3);
    expect(weeks).toEqual([
      { week: '2026-10-26', count: 0 },
      { week: '2026-11-02', count: 1 },
      { week: '2026-11-09', count: 2 },
    ]);
  });

  const snap: Snapshot = {
    today: '2026-11-15',
    po: {
      counts: { submitted: 1, erp_ready: 2, producing: 3 },
      doneThisMonth: 4,
      intakeWeeks: [{ week: '2026-11-02', count: 1 }, { week: '2026-11-09', count: 2 }],
      open: [{ number: 'P261110-01', customer: '거래처A', site: '현장B', stage: 'erp_ready', created: '2026-11-10', assignee: '담당자', stalledDays: 3 }],
    },
    workOrders: {
      active: 2, remaining: 1240, deliveryOnly: 1,
      byDue: [{ number: '26-0001', customer: null, site: '현장C', due: '2026-11-20', percent: 87, remaining: 25 }],
    },
    production: { days: [{ date: '2026-11-13', qty: 120, area: 45.25 }], monthQty: 1500, monthArea: 610.4 },
    delivery: null,
  };

  it('서버가 센 숫자를 단위까지 글로 옮긴다', () => {
    const t = snapshotText(snap);
    expect(t).toContain('기준 시각: 2026-11-15 (일)');
    expect(t).toContain('진행 중 6건: 확인 전 1 · 확인함 0 · ERP 등록 대기 2 · 작업의뢰서 수신 중 0 · 생산 중 3');
    expect(t).toContain('이번 달 완료 4건');
    expect(t).toContain('11/2주 1건, 11/9주 2건');
    expect(t).toContain('P261110-01 | 거래처A · 현장B | ERP 등록 대기 | 접수 11/10 | 담당 담당자 | 이 단계 3일째');
    expect(t).toContain('남은 수량 1,240조');
    expect(t).toContain('26-0001 | 현장C | 납기 11/20 | 진행 87% | 남은 25조');
    expect(t).toContain('11/13(금) 120조 45.3M²');
    expect(t).toContain('이번 달 합계 1,500조 · 610.4M²');
    expect(t).toContain('이 사람의 권한으로는 볼 수 없습니다');
  });

  it('발주서 권한이 없으면 건수만 준다', () => {
    const t = snapshotText({ ...snap, po: { ...snap.po!, open: null } });
    expect(t).toContain('건수만');
    expect(t).not.toContain('P261110-01');
  });

  it('못 읽은 칸은 읽지 못했다고 쓴다', () => {
    const t = snapshotText({ today: '2026-11-15', po: null, workOrders: null, production: null, delivery: null });
    expect(t.match(/읽지 못했습니다/g)).toHaveLength(3);
  });
});

describe('DG 프리즘 대화 — 주고받기', () => {
  it('지금 질문이 없거나 길면 거절한다', () => {
    expect(checkTurns([])).toBeTruthy();
    expect(checkTurns([{ role: 'assistant', text: '안녕하세요' }])).toBeTruthy();
    expect(checkTurns([{ role: 'user', text: '   ' }])).toBeTruthy();
    expect(checkTurns([{ role: 'user', text: 'x'.repeat(2001) }])).toBeTruthy();
    expect(checkTurns([{ role: 'robot', text: '?' }])).toBeTruthy();
    expect(checkTurns([{ role: 'user', text: '요즘 발주 상황 어때?' }])).toBeNull();
  });

  it('API 로 보낼 때 user 로 시작하고 같은 쪽은 합친다', () => {
    expect(toApiMessages([
      { role: 'assistant', text: '앞 답' },
      { role: 'user', text: '하나' },
      { role: 'user', text: '둘' },
      { role: 'assistant', text: '답' },
      { role: 'user', text: '셋' },
    ])).toEqual([
      { role: 'user', content: '하나\n\n둘' },
      { role: 'assistant', content: '답' },
      { role: 'user', content: '셋' },
    ]);
  });

  it('앞선 답은 목록 · 숫자까지 글로 다시 준다', () => {
    const a: PrismAnswer = {
      reply: '이번 주 접수가 늘었습니다.',
      stats: [{ label: '진행 중', value: '6', unit: '건', tone: 'normal' }],
      chart_title: '주별 접수', chart_unit: '건', chart: [{ label: '11/9', value: 2 }],
      items: [{ title: 'P261110-01', detail: 'ERP 등록 대기 3일째', tone: 'warn' }],
      links: ['/purchase-orders'],
    };
    expect(answerAsText(a)).toBe('이번 주 접수가 늘었습니다.\n진행 중 6건\n주별 접수: 11/9 2건\n- P261110-01 — ERP 등록 대기 3일째');
  });
});
