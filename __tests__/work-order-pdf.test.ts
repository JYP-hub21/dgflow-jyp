import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkOrderPdfText } from '@/lib/work-order/pdf';
import { verifyScan } from '@/lib/work-order/verify';

/**
 * ERP 가 뽑은 실물 작업의뢰서 PDF(26-2090.pdf)로 확인한다.
 * 엑셀에 없는 머리글이 여기서 나온다.
 */

const FILE = path.join(process.cwd(), '26-2090.pdf');
const HAS_FILE = fs.existsSync(FILE);

async function pdfText(file: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

describe.skipIf(!HAS_FILE)('ERP 작업의뢰서 PDF 읽기 — 26-2090.pdf', () => {
  let parsed: Awaited<ReturnType<typeof load>>;
  async function load() {
    return parseWorkOrderPdfText(await pdfText(FILE));
  }

  it('머리글 다섯 칸을 모두 읽는다', async () => {
    parsed = await load();
    expect(parsed.head).toEqual({
      work_order_number: '26-2090',
      customer_label: '우미건설(주)',
      site_label: '세종6-3생활권 M3BL 공공지원민간임대주택현장',
      request_date: '2026-08-03',
      delivery_date: '2026-09-28',
    });
  });

  it('업체명 끝의 ERP 코드 한 글자를 떼어낸다', async () => {
    parsed = await load();
    // 문서에는 `우미건설(주)f` 로 찍힌다
    expect(parsed.head.customer_label).not.toMatch(/[A-Za-z]$/);
  });

  it('품목 17행과 소계 4개 · 합계를 읽는다', async () => {
    parsed = await load();
    expect(parsed.items).toHaveLength(17);
    expect(parsed.printed_subtotals.map((s) => [s.quantity, s.area_m2])).toEqual([
      [2, 5.06], [28, 16.6], [30, 21.66], [4, 4.92],
    ]);
    expect(parsed.printed_total).toEqual({ quantity: 64, area_m2: 48.24 });
  });

  it('규격은 `X1,423 1,776` 처럼 X 가 앞에 와도 읽는다', async () => {
    parsed = await load();
    expect(parsed.items[0]).toMatchObject({
      no: 1,
      product_name: '22T 5newGNh/s+12Ar.+5로이',
      width_mm: 1423,
      height_mm: 1776,
      quantity: 2,
      area_m2: 5.06,
    });
  });

  it('품명 병합 셀을 물려받는다', async () => {
    parsed = await load();
    expect(parsed.items[2].product_name).toBe('22T 5newGN+12AR.+5로이'); // 3행
    expect(parsed.items[9].product_name).toBe('22T 5CL+12Ar.+5로이');    // 10행
  });

  it('읽은 값이 문서의 소계 · 합계와 맞는다', async () => {
    parsed = await load();
    const check = verifyScan(parsed);
    expect(check.ok).toBe(true);
    expect(check.total!.counted).toEqual({ quantity: 64, area_m2: 48.24 });
  });

  it('비고가 PDF 폭에 잘려 들어온다 — 그래서 품목은 엑셀을 쓴다', async () => {
    parsed = await load();
    // 17행은 `…84A 발` 에서 끊긴다. 어느 줄이 잘렸는지는 가려낼 수 없으므로
    // 화면이 'PDF 로 받은 품목은 비고가 잘릴 수 있다' 고 알린다.
    expect(parsed.items[16].remark).toMatch(/발$/);
  });
});

describe('머리글 읽기 규칙', () => {
  const SAMPLE = [
    '의뢰번호:26-2286',
    '업 체 명:(주)서해종합건설j',
    '의뢰일자:2026-08-25 납품일자:2026-09-29',
    '현 장 명:울산태화강변A-2BL 아파트 건설공사 2공구현장',
  ].join('\n');

  it('라벨 글자가 벌어져 있어도 찾는다', () => {
    const { head } = parseWorkOrderPdfText(SAMPLE);
    expect(head.work_order_number).toBe('26-2286');
    expect(head.customer_label).toBe('(주)서해종합건설');
    expect(head.site_label).toBe('울산태화강변A-2BL 아파트 건설공사 2공구현장');
  });

  it('한 줄에 있는 의뢰일자와 납품일자를 갈라 읽는다', () => {
    const { head } = parseWorkOrderPdfText(SAMPLE);
    expect(head.request_date).toBe('2026-08-25');
    expect(head.delivery_date).toBe('2026-09-29');
  });

  it('날짜 모양이 아니면 비운다 — 추측하지 않는다', () => {
    const { head } = parseWorkOrderPdfText('의뢰일자:미정');
    expect(head.request_date).toBeNull();
  });

  it('머리글이 없으면 전부 null', () => {
    const { head, items } = parseWorkOrderPdfText('아무 말');
    expect(Object.values(head).every((v) => v === null)).toBe(true);
    expect(items).toEqual([]);
  });
});
