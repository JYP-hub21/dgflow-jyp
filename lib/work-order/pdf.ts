import type { WorkOrderItemInput } from './verify';

/**
 * ERP 가 뽑은 작업의뢰서 PDF 에서 글자를 읽는다.
 *
 * ERP 출력은 글자가 데이터로 박힌 PDF 라서 그림 인식 없이 그냥 읽힌다(26-2090.pdf 로 확인).
 * 엑셀에는 **머리글이 실리지 않으므로** 이 PDF 가 그 자리를 채운다 —
 * 의뢰번호 · 업체명 · 현장명 · 의뢰일자 · 납품일자.
 *
 * 품목도 들어 있지만 **비고가 잘린다**(26-2090 의 17행이 `…84A 발` 에서 끊겼다).
 * 그래서 품목은 엑셀을 쓰고, PDF 품목은 엑셀이 없을 때만 쓴다.
 */

export interface PdfHead {
  work_order_number: string | null;
  customer_label: string | null;
  site_label: string | null;
  request_date: string | null;
  delivery_date: string | null;
}

export interface ParsedPdf {
  head: PdfHead;
  items: WorkOrderItemInput[];
  printed_subtotals: { after_no: number; quantity: number; area_m2: number }[];
  printed_total: { quantity: number; area_m2: number } | null;
}

/** `1,423` → 1423 */
function num(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 머리글 라벨은 글자 사이가 벌어져 있다 (`업 체 명`, `현 장 명`).
 * 라벨의 각 글자 사이에 공백을 허용하는 정규식을 만든다.
 */
function labelPattern(label: string): string {
  return label.split('').join('\\s*');
}

function findField(text: string, label: string): string | null {
  // 값은 다음 라벨이나 줄 끝에서 멈춘다
  const re = new RegExp(`${labelPattern(label)}\\s*:\\s*(.+?)(?=\\s{2,}|\\s*[가-힣]\\s*[가-힣]\\s*[가-힣]\\s*[가-힣]?\\s*:|$)`, 'm');
  const m = text.match(re);
  const value = m?.[1]?.trim();
  return value || null;
}

/**
 * 업체명 끝에 ERP 가 한 글자짜리 코드를 붙여 내보낸다
 * (`우미건설(주)f`, `(주)서해종합건설j`). 한글 이름 뒤의 영문 한 글자만 떼어낸다.
 */
function cleanCustomer(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/([가-힣)])\s*[A-Za-z]$/, '$1').trim();
  return trimmed || null;
}

/** `2026-08-03` 꼴만 받는다. 다른 모양이면 비운다 — 날짜는 틀리면 납기가 틀어진다 */
function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 품목 줄.
 *
 * 글자 추출 순서 때문에 규격이 `X1,423 1,776` 처럼 **X 가 앞으로 온다** —
 * ERP 가 `1,423 X 1,776` 으로 그리지만 X 를 따로 찍기 때문이다.
 *
 *   17 22T 5newGN+12A+5로이 X702 1,759 4 4.92 2공구 14동 …
 *   └No └품명(생략 가능)    └가로 └세로 └수량 └면적 └비고
 */
const ITEM_RE =
  /^(\d+)\s+(.*?)\s*X\s*([\d,]+)\s+([\d,]+)\s+(\d+)\s+([\d.]+)\s*(.*)$/;
const SUBTOTAL_RE = /^소\s*계\s+(\d+)\s+([\d.]+)\s*$/;
const TOTAL_RE = /^(?:합\s*계|총\s*계)\s+(\d+)\s+([\d.]+)\s*$/;

export function parseWorkOrderPdfText(text: string): ParsedPdf {
  const head: PdfHead = {
    work_order_number: findField(text, '의뢰번호'),
    customer_label: cleanCustomer(findField(text, '업체명')),
    site_label: findField(text, '현장명'),
    request_date: isoDate(findField(text, '의뢰일자')),
    delivery_date: isoDate(findField(text, '납품일자')),
  };

  const items: WorkOrderItemInput[] = [];
  const printed_subtotals: ParsedPdf['printed_subtotals'] = [];
  let printed_total: ParsedPdf['printed_total'] = null;
  let inheritedName = '';

  for (const line of text.split('\n').map((l) => l.trim())) {
    if (!line) continue;

    const sub = line.match(SUBTOTAL_RE);
    if (sub) {
      const quantity = num(sub[1]);
      const area = num(sub[2]);
      if (quantity !== null && area !== null) {
        printed_subtotals.push({
          after_no: items.length ? items[items.length - 1].no : 0,
          quantity,
          area_m2: area,
        });
      }
      continue;
    }

    const tot = line.match(TOTAL_RE);
    if (tot) {
      const quantity = num(tot[1]);
      const area = num(tot[2]);
      if (quantity !== null && area !== null) printed_total = { quantity, area_m2: area };
      continue;
    }

    const m = line.match(ITEM_RE);
    if (!m) continue;

    const [, no, name, w, h, q, area, remark] = m;
    const width = num(w);
    const height = num(h);
    const quantity = num(q);
    const areaM2 = num(area);
    if (width === null || height === null || quantity === null) continue;

    if (name.trim()) inheritedName = name.trim();

    const cleanRemark = remark.trim();

    items.push({
      no: Number(no),
      product_name: inheritedName,
      width_mm: width,
      height_mm: height,
      quantity,
      area_m2: areaM2 ?? 0,
      remark: cleanRemark || null,
    });
  }

  return {
    head,
    items,
    printed_subtotals,
    printed_total,
  };
}
