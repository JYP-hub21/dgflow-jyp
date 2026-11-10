'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface SheetItem {
  /** 종이에 찍힌 번호 — 줄을 지워도 번호는 그대로 (2026-11-02 "넘버는 변하면 안 됨") */
  item_no?: number | null;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number;
  remark: string;
  sort_order: number;
}

export interface SheetData {
  work_order_number: string;
  customer_label: string;
  site_label: string;
  request_date: string;
  delivery_date: string | null;
  packaging_group: string | null;
  notes: string | null;
  items: SheetItem[];
}

/**
 * 동일유리 작업의뢰서 A4 양식 — ERP 가 찍는 종이처럼 **쪽을 나눠** 그린다.
 *
 * 2026-11-10 점검: 예전에는 한 장짜리 긴 양식을 그대로 인쇄 · PDF 로 떠서
 *  ① 인쇄는 1장에서 잘리고 ② PDF 는 297mm 마다 기계적으로 잘라 줄이 반으로 갈리고 2쪽부터 여백 · 머리줄이 없고
 *  ③ 'Page : 1/1' 이 고정이었다. 이제 ERP 원본(26-2573, 4쪽)과 같이
 *  1쪽 = 제목 · 머리말 · 결재란, 모든 쪽 = 표 머리줄 + 'Page : n/N', 마지막 쪽 = 합계 · 빈 줄 · 비고.
 *  줄 높이를 실제로 재서 줄이 쪽 경계에 걸리지 않게 나눈다.
 *  품명 · 비고가 칸보다 길면 ERP 처럼 줄을 바꾸지 않고 글자를 줄여 한 줄에 넣는다 — 줄을 바꾸면 줄이 두 배로 높아져
 *  ERP 에서 1장인 26-2090 이 2장(2쪽엔 소계 · 합계만)이 됐다.
 *
 * 색은 Tailwind 유틸리티 대신 명시적인 hex 로만 쓴다 —
 * html2canvas 로 PDF 를 뜰 때 Tailwind v4 의 oklch() 를 해석하지 못하기 때문이다.
 */

const BORDER = '1px solid #111827';
const th: React.CSSProperties = {
  border: BORDER,
  padding: '5px 6px',
  fontWeight: 600,
  fontSize: '12px',
  textAlign: 'center',
  backgroundColor: '#e5e7eb',
};
const td: React.CSSProperties = {
  border: BORDER,
  padding: '4px 6px',
  fontSize: '12px',
};
const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

const MM = 96 / 25.4;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const PAD_Y_MM = 12;
const PAD_X_MM = 10;
const BLANK_ROW_PX = 21;
/** 표 폭 190mm 를 열 비율대로 나눈 글자 자리(px) — 칸 안 여백 6px×2 와 테두리를 뺀 값 */
const TABLE_W_PX = (PAGE_W_MM - 2 * PAD_X_MM) * MM;
const NAME_TEXT_PX = TABLE_W_PX * 0.32 - 15;
const REMARK_TEXT_PX = TABLE_W_PX * (1 - 0.32 - 0.18 - 0.09 - 0.11) - 36 - 15;
const NAME_FONT = 12;
const REMARK_FONT = 11;
const MIN_FONT = 6;

/** 칸 폭에 한 줄로 들어가는 글자 크기 — 넘치면 비율대로 줄인다(엑셀의 '셀에 맞춤' 처럼) */
function fitFont(ctx: CanvasRenderingContext2D, text: string, widthPx: number, base: number): number {
  if (!text) return base;
  ctx.font = `${base}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w <= widthPx) return base;
  return Math.max(MIN_FONT, Math.floor((base * widthPx / w) * 10) / 10);
}

type Fit = { name: number; remark: number };
/** 재는 값과 인쇄 사이의 소수점 차이를 흡수할 여유 */
const SLACK_PX = 6;

type Row =
  | { kind: 'item'; item: SheetItem; no: number; showName: boolean }
  | { kind: 'subtotal'; quantity: number; area: number }
  | { kind: 'total'; quantity: number; area: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 품명이 같은 연속 구간을 묶어 소계를 넣고, 맨 끝에 합계를 붙인다 (양식이 묶음마다 소계를 넣는다). */
function buildRows(items: SheetItem[]): Row[] {
  const rows: Row[] = [];
  let groupName = '';
  let groupQty = 0;
  let groupArea = 0;

  items.forEach((item, index) => {
    const isNewGroup = item.product_name !== groupName;
    if (isNewGroup && index > 0) {
      rows.push({ kind: 'subtotal', quantity: groupQty, area: round2(groupArea) });
      groupQty = 0;
      groupArea = 0;
    }
    if (isNewGroup) groupName = item.product_name;
    rows.push({ kind: 'item', item, no: item.item_no ?? (item.sort_order ?? index) + 1, showName: isNewGroup });
    groupQty += item.quantity;
    groupArea += Number(item.area_m2);
  });
  if (items.length > 0) rows.push({ kind: 'subtotal', quantity: groupQty, area: round2(groupArea) });

  rows.push({
    kind: 'total',
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    area: round2(items.reduce((s, i) => s + Number(i.area_m2), 0)),
  });
  return rows;
}

interface Plan {
  /** 쪽마다 들어갈 줄 번호(rows 의 위치) */
  pages: number[][];
  /** 마지막 쪽에 채울 빈 줄 수 */
  blanks: number;
}

/**
 * 잰 높이로 쪽을 나눈다. 줄은 쪽 경계에 걸리지 않고, 마지막 쪽에는 하단 비고 칸까지 들어가야 한다.
 * 비고 칸이 안 들어가면 마지막 몇 줄(소계 · 합계)을 다음 쪽으로 넘긴다 — 빈 표만 있는 쪽이 생기지 않게.
 */
export function planPages(m: { header: number; thead: number; rows: number[]; bottom: number; footer: number; blank: number }): Plan {
  const body = PAGE_H_MM * MM - 2 * PAD_Y_MM * MM - m.footer - SLACK_PX;
  const capFirst = body - m.header - m.thead;
  const capNext = body - m.thead;

  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  let cap = capFirst;
  m.rows.forEach((h, i) => {
    if (cur.length > 0 && used + h > cap) {
      pages.push(cur);
      cur = [];
      used = 0;
      cap = capNext;
    }
    cur.push(i);
    used += h;
  });

  if (used + m.bottom > cap) {
    const tail: number[] = [];
    const keep = Math.max(1, cur.length - 3);
    while (cur.length > keep) tail.unshift(cur.pop()!);
    pages.push(cur);
    cur = tail;
    used = tail.reduce((s, i) => s + m.rows[i], 0);
    cap = capNext;
  }
  pages.push(cur);

  const blanks = Math.max(0, Math.floor((cap - used - m.bottom) / Math.max(1, m.blank)));
  return { pages, blanks };
}

function SheetHeader({ data }: { data: SheetData }) {
  return (
    <div data-measure="header" style={{ display: 'flow-root' }}>
      {/* 좌측 상단 지시문 + 중앙 제목 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ width: '30%', fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {data.notes || ''}
        </div>
        <div style={{ width: '40%', textAlign: 'center' }}>
          <div style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '10px', borderBottom: '2px solid #111827', paddingBottom: '4px', display: 'inline-block' }}>
            작업의뢰서
          </div>
        </div>
        <div style={{ width: '30%' }} />
      </div>

      {/* 머리말 + 결재란 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', lineHeight: 2 }}>
          <div>의뢰번호 : {data.work_order_number}</div>
          <div>업 체 명 : {data.customer_label || '-'}</div>
          <div>
            의뢰일자 : {data.request_date}
            <span style={{ marginLeft: '24px' }}>납품일자 : {data.delivery_date || '-'}</span>
          </div>
          <div>현 장 명 : {data.site_label || '-'}</div>
          {data.packaging_group && <div>포장단위 : {data.packaging_group}</div>}
        </div>

        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td rowSpan={2} style={{ ...th, width: '26px', writingMode: 'vertical-rl', letterSpacing: '4px' }}>
                결재
              </td>
              {['작 성', '검 토', '검 토', '승 인'].map((label, i) => (
                <td key={i} style={{ ...th, width: '62px' }}>{label}</td>
              ))}
            </tr>
            <tr>
              {[0, 1, 2, 3].map(i => (
                <td key={i} style={{ ...td, height: '46px' }} />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableHead() {
  return (
    <thead data-measure="thead">
      <tr>
        <th style={{ ...th, width: '36px' }}>No</th>
        <th style={{ ...th, width: '32%' }}>품명</th>
        <th style={{ ...th, width: '18%' }}>규격</th>
        <th style={{ ...th, width: '9%' }}>수량</th>
        <th style={{ ...th, width: '11%' }}>면적(M²)</th>
        <th style={{ ...th }}>비고</th>
      </tr>
    </thead>
  );
}

const oneLine: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden' };

function SheetRow({ row, fit, measure }: { row: Row; fit?: Fit; measure?: boolean }) {
  const attr = measure ? { 'data-measure': 'row' } : {};
  if (row.kind === 'item') {
    return (
      <tr {...attr}>
        <td style={{ ...td, textAlign: 'center' }}>{row.no}</td>
        <td style={{ ...td, ...oneLine, fontSize: `${fit?.name ?? NAME_FONT}px` }}>{row.showName ? row.item.product_name : ''}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          {row.item.width_mm.toLocaleString()} X {row.item.height_mm.toLocaleString()}
        </td>
        <td style={{ ...td, textAlign: 'right' }}>{row.item.quantity}</td>
        <td style={{ ...td, textAlign: 'right' }}>{Number(row.item.area_m2).toFixed(2)}</td>
        <td style={{ ...td, ...oneLine, fontSize: `${fit?.remark ?? REMARK_FONT}px` }}>{row.item.remark}</td>
      </tr>
    );
  }
  const total = row.kind === 'total';
  return (
    <tr {...attr} style={{ backgroundColor: total ? '#d1d5db' : '#e5e7eb' }}>
      <td style={{ ...td, textAlign: 'center', fontWeight: total ? 700 : 600 }} colSpan={3}>
        {total ? '합계' : '소계'}
      </td>
      <td style={{ ...td, textAlign: 'right', fontWeight: total ? 700 : 600 }}>{row.quantity}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: total ? 700 : 600 }}>{row.area.toFixed(2)}</td>
      <td style={td} />
    </tr>
  );
}

function BlankRow({ measure }: { measure?: boolean }) {
  return (
    <tr {...(measure ? { 'data-measure': 'blank' } : {})}>
      {Array.from({ length: 6 }).map((_, j) => (
        <td key={j} style={{ ...td, height: `${BLANK_ROW_PX}px` }} />
      ))}
    </tr>
  );
}

function BottomBox() {
  return (
    <table data-measure="bottom" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '-1px' }}>
      <tbody>
        <tr>
          <td style={{ ...th, width: '36px', height: '80px' }}>비고</td>
          <td style={td} />
        </tr>
      </tbody>
    </table>
  );
}

function Footer({ page, pages }: { page: number; pages: number }) {
  return (
    <div data-measure="footer" style={{ display: 'flow-root', marginTop: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px' }}>
        <span>Page : {page}/{pages}</span>
        <span style={{ fontWeight: 600 }}>동일유리(주)</span>
        <span>A4 (210*297mm)</span>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: `${PAGE_W_MM}mm`,
  height: `${PAGE_H_MM}mm`,
  padding: `${PAD_Y_MM}mm ${PAD_X_MM}mm`,
  backgroundColor: '#ffffff',
  color: '#111827',
  fontFamily: FONT,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

/**
 * `id="work-order-sheet"` 안에 `.wo-page` 가 쪽마다 하나씩 있다 — 인쇄는 쪽마다 넘기고(globals.css),
 * PDF 다운로드는 쪽마다 한 장씩 뜬다(WorkOrderPdfButton).
 */
export default function WorkOrderSheet({ data }: { data: SheetData }) {
  const rows = buildRows(data.items);
  const [fits, setFits] = useState<Fit[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const probe = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const el = probe.current;
    if (!el) return;
    const h = (sel: string) => el.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    const rowHeights = Array.from(el.querySelectorAll('[data-measure="row"]')).map(r => r.getBoundingClientRect().height);
    if (rowHeights.length !== rows.length) return;
    setPlan(planPages({
      header: h('[data-measure="header"]'),
      thead: h('[data-measure="thead"]'),
      rows: rowHeights,
      bottom: h('[data-measure="bottom"]'),
      footer: h('[data-measure="footer"]'),
      blank: h('[data-measure="blank"]') || BLANK_ROW_PX,
    }));
  }, [rows.length]);

  // 글자 크기 맞춤은 브라우저에서만 잴 수 있다 — 서버 그림과 어긋나지 않게 붙인 뒤에 계산한다
  useLayoutEffect(() => {
    setPlan(null);
    const ctx = document.createElement('canvas').getContext('2d');
    setFits(rows.map(r => r.kind !== 'item' || !ctx
      ? { name: NAME_FONT, remark: REMARK_FONT }
      : { name: fitFont(ctx, r.showName ? r.item.product_name : '', NAME_TEXT_PX, NAME_FONT), remark: fitFont(ctx, r.item.remark ?? '', REMARK_TEXT_PX, REMARK_FONT) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useLayoutEffect(() => {
    if (plan || !fits) return;
    measure();
    // 맑은 고딕이 늦게 들어오면 줄 높이가 바뀐다 — 글꼴이 다 들어온 뒤 한 번 더 잰다
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; };
  }, [plan, fits, measure]);

  const pages = plan?.pages ?? [rows.map((_, i) => i)];
  const total = pages.length;

  return (
    <>
      {/* 높이를 재는 보이지 않는 사본 — 쪽 폭(190mm)에 같은 글꼴로 그린다 */}
      {fits && !plan && (
        <div ref={probe} aria-hidden style={{ position: 'absolute', left: '-10000px', top: 0, visibility: 'hidden', width: `${PAGE_W_MM - 2 * PAD_X_MM}mm`, fontFamily: FONT, color: '#111827' }}>
          <SheetHeader data={data} />
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <TableHead />
            <tbody>
              {rows.map((row, i) => <SheetRow key={i} row={row} fit={fits[i]} measure />)}
              <BlankRow measure />
            </tbody>
          </table>
          <BottomBox />
          <Footer page={1} pages={1} />
        </div>
      )}

      <div id="work-order-sheet" className="wo-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {pages.map((idx, p) => {
          const last = p === total - 1;
          return (
            <div key={p} className="wo-page" style={plan ? pageStyle : { ...pageStyle, height: 'auto', minHeight: `${PAGE_H_MM}mm` }}>
              {p === 0 && <SheetHeader data={data} />}
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <TableHead />
                <tbody>
                  {idx.map(i => <SheetRow key={i} row={rows[i]} fit={fits?.[i]} />)}
                  {last && Array.from({ length: plan?.blanks ?? 0 }).map((_, i) => <BlankRow key={`b-${i}`} />)}
                </tbody>
              </table>
              {last && <BottomBox />}
              <Footer page={p + 1} pages={total} />
            </div>
          );
        })}
      </div>
    </>
  );
}
