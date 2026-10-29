import React from 'react';

export interface SheetItem {
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
 * 동일유리 작업의뢰서 A4 양식.
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

/** 품명이 같은 연속 구간을 묶어 소계 위치를 잡는다 (양식이 묶음마다 소계를 넣는다). */
function withSubtotals(items: SheetItem[]) {
  const rows: (
    | { kind: 'item'; item: SheetItem; no: number; showName: boolean }
    | { kind: 'subtotal'; quantity: number; area: number }
  )[] = [];

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

    rows.push({ kind: 'item', item, no: index + 1, showName: isNewGroup });
    groupQty += item.quantity;
    groupArea += Number(item.area_m2);
  });

  if (items.length > 0) {
    rows.push({ kind: 'subtotal', quantity: groupQty, area: round2(groupArea) });
  }

  return rows;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function WorkOrderSheet({ data }: { data: SheetData }) {
  const rows = withSubtotals(data.items);
  const totalQuantity = data.items.reduce((s, i) => s + i.quantity, 0);
  const totalArea = round2(data.items.reduce((s, i) => s + Number(i.area_m2), 0));

  // A4 한 장에 14줄 정도가 들어가고 나머지는 빈 칸으로 채워 양식 느낌을 맞춘다
  const blankRows = Math.max(0, 20 - rows.length);

  return (
    <div
      id="work-order-sheet"
      style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '12mm 10mm',
        backgroundColor: '#ffffff',
        color: '#111827',
        fontFamily: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
        boxSizing: 'border-box',
      }}
    >
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

      {/* 품목 표 */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '36px' }}>No</th>
            <th style={{ ...th, width: '32%' }}>품명</th>
            <th style={{ ...th, width: '18%' }}>규격</th>
            <th style={{ ...th, width: '9%' }}>수량</th>
            <th style={{ ...th, width: '11%' }}>면적</th>
            <th style={{ ...th }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) =>
            row.kind === 'item' ? (
              <tr key={`i-${index}`}>
                <td style={{ ...td, textAlign: 'center' }}>{row.no}</td>
                <td style={td}>{row.showName ? row.item.product_name : ''}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {row.item.width_mm.toLocaleString()} X {row.item.height_mm.toLocaleString()}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{row.item.quantity}</td>
                <td style={{ ...td, textAlign: 'right' }}>{Number(row.item.area_m2).toFixed(2)}</td>
                <td style={{ ...td, fontSize: '11px' }}>{row.item.remark}</td>
              </tr>
            ) : (
              <tr key={`s-${index}`} style={{ backgroundColor: '#e5e7eb' }}>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }} colSpan={3}>
                  소계
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{row.quantity}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{row.area.toFixed(2)}</td>
                <td style={td} />
              </tr>
            )
          )}

          <tr style={{ backgroundColor: '#d1d5db' }}>
            <td style={{ ...td, textAlign: 'center', fontWeight: 700 }} colSpan={3}>
              합계
            </td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totalQuantity}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totalArea.toFixed(2)}</td>
            <td style={td} />
          </tr>

          {Array.from({ length: blankRows }).map((_, i) => (
            <tr key={`b-${i}`}>
              {Array.from({ length: 6 }).map((__, j) => (
                <td key={j} style={{ ...td, height: '21px' }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 하단 비고 박스 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '-1px' }}>
        <tbody>
          <tr>
            <td style={{ ...th, width: '36px', height: '80px' }}>비고</td>
            <td style={td} />
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px' }}>
        <span>Page : 1/1</span>
        <span style={{ fontWeight: 600 }}>동일유리(주)</span>
        <span>A4 (210*297mm)</span>
      </div>
    </div>
  );
}
