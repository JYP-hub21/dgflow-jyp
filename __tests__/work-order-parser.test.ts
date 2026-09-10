import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseWorkOrderExcel } from '../lib/parser/work-order-excel';

describe('바이투 작업의뢰서 엑셀 파서', () => {
  const filePath = path.resolve(__dirname, '../data/바이투 업로드양식.xlsx');

  it('샘플 파일 파싱: 15개 의뢰번호 추출', () => {
    const buffer = fs.readFileSync(filePath);
    const result = parseWorkOrderExcel(buffer);

    expect(result.workOrders.length).toBe(15);
    expect(result.totalRows).toBeGreaterThan(0);
    // 총 품목 수 검증
    const totalItems = result.workOrders.reduce((s, wo) => s + wo.items.length, 0);
    expect(totalItems).toBe(result.totalRows - result.errors.length);
  });

  it('의뢰번호 26-2405 파싱 검증', () => {
    const buffer = fs.readFileSync(filePath);
    const result = parseWorkOrderExcel(buffer);

    const wo = result.workOrders.find(w => w.work_order_number === '26-2405');
    expect(wo).toBeDefined();
    expect(wo!.customer_name).toContain('계룡건설');
    expect(wo!.site_name).toContain('충남국제');
    expect(wo!.items.length).toBe(6);

    // 첫 품목 검증
    const first = wo!.items[0];
    expect(first.product_name).toContain('로이');
    expect(first.width_mm).toBe(300);
    expect(first.height_mm).toBe(300);
    expect(first.quantity).toBe(1);
    expect(first.thickness).toBe(28);
  });

  it('각 의뢰번호에 거래처/현장 존재', () => {
    const buffer = fs.readFileSync(filePath);
    const result = parseWorkOrderExcel(buffer);

    for (const wo of result.workOrders) {
      expect(wo.customer_name.length).toBeGreaterThan(0);
      expect(wo.site_name.length).toBeGreaterThan(0);
      expect(wo.items.length).toBeGreaterThan(0);
    }
  });

  it('품목 수량과 규격이 양수', () => {
    const buffer = fs.readFileSync(filePath);
    const result = parseWorkOrderExcel(buffer);

    for (const wo of result.workOrders) {
      for (const item of wo.items) {
        expect(item.quantity).toBeGreaterThan(0);
        expect(item.width_mm).toBeGreaterThan(0);
        expect(item.height_mm).toBeGreaterThan(0);
      }
    }
  });
});
