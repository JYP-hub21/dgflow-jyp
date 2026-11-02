import { describe, expect, it } from 'vitest';
import { isManualPackage, MANUAL_SHEET, siteScore } from '@/lib/purchase-order/manual';
import { deriveStage } from '@/lib/purchase-order/stage';

describe('작업의뢰서 바로 잇기 — 우리 ERP 변환기를 안 써도', () => {
  it('바로 이은 포장도 단계 계산에 똑같이 센다 (변환기 없이 생산 · 완료까지)', () => {
    expect(deriveStage('checked', [])).toBe('checked');
    expect(deriveStage('checked', [{ work_order_id: 'w1', total: 10, produced: 3 }])).toBe('producing');
    expect(deriveStage('checked', [{ work_order_id: 'w1', total: 10, produced: 10 }])).toBe('done');
    expect(isManualPackage({ sheet_name: MANUAL_SHEET })).toBe(true);
    expect(isManualPackage({ sheet_name: '1차' })).toBe(false);
  });

  it('후보 순서용 닮은 정도 — 꼬리말 · 띄어쓰기 · (주) 를 떼고 비교', () => {
    expect(siteScore('성남금토 A-4BL 아파트', '성남금토A-4BL 아파트 신축공사')).toBe(1);
    expect(siteScore('(주)대진글라스', '대진글라스')).toBe(1);
    expect(siteScore('성남금토 A-4BL 아파트', '대우건설_산성역헤리스톤3BL현장')).toBeLessThan(0.5);
    expect(siteScore('', '아무 현장')).toBe(0);
    expect(siteScore(null, null)).toBe(0);
  });
});
