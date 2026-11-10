'use client';

/**
 * 규격정리 미리보기 — 엑셀을 받지 않아도 화면에서 바로 본다
 * (2026-11-10 사용자 "엑셀까지 다운로드 안 해도 이런 기준이면 어떻게 규격정리되는지 미리 볼 수 있으면").
 *
 * 받을 엑셀과 같은 계산(`specSheetBlocks`)을 쓴다. 좌 = 발주서 순서 그대로, 우 = ERP 순서.
 * 위에서 포장 방식을 바꾸면 우측 순서가 바로 바뀐다.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chipClass, chipCountClass } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import type { SpecBlock, SpecRow } from '@/lib/erp/spec-sheet';

const n0 = (v: number) => v.toLocaleString();
const n2 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function SpecSheetPreview({ blocks, excludedRows, onDownload }: {
  blocks: SpecBlock[];
  /** DG 프리즘이 이번 ERP 에서 뺀 품목 행 수 — 규격정리에도 넣지 않았다 */
  excludedRows: number;
  onDownload: () => void;
}) {
  // 포장별로 골라 보기 — 덩어리가 포장 × 품명이라 포장이 많으면 길어진다
  const [only, setOnly] = useState<string | null>(null);
  const packages = [...new Set(blocks.map(b => b.package_label))].map(label => {
    const mine = blocks.filter(b => b.package_label === label);
    return { label, qty: mine.reduce((s, b) => s + b.right_qty, 0), off: mine.some(b => b.left_qty !== b.right_qty) };
  });
  const products = new Set(blocks.map(b => b.product_name)).size;
  const leftQty = blocks.reduce((s, b) => s + b.left_qty, 0);
  const rightQty = blocks.reduce((s, b) => s + b.right_qty, 0);
  const sai = blocks.reduce((s, b) => s + b.right_sai, 0);
  const m2 = blocks.reduce((s, b) => s + b.right_m2, 0);
  const shown = only === null || !packages.some(x => x.label === only) ? blocks : blocks.filter(b => b.package_label === only);

  return (
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4.5 w-4.5 text-success" />규격정리 미리보기
            </CardTitle>
            <p className="mt-1 break-keep text-sm text-muted-foreground">
              다운로드할 엑셀과 같은 내용입니다. 왼쪽은 <b className="font-semibold text-foreground">발주서 순서 그대로</b>, 오른쪽은{' '}
              <b className="font-semibold text-foreground">ERP 순서</b>(포장 순서 · 세로↓ 가로↓)입니다. 위에서 포장 방식을 변경하면 오른쪽이 바로 다시 정리됩니다.
            </p>
          </div>
          <Button variant="outline" onClick={onDownload} className="shrink-0">
            <Download />규격정리 다운로드
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="포장 · 품명" value={`${packages.length}개 · ${products}가지`} />
          <Stat label="발주서 → ERP 수량" value={`${n0(leftQty)} → ${n0(rightQty)}조`}
            tone={leftQty === rightQty ? 'ok' : 'warn'}
            note={leftQty === rightQty ? '좌우 일치' : `${n0(Math.abs(leftQty - rightQty))}조 차이`} />
          <Stat label="재(엑셀의 '평' 열)" value={n2(sai)} />
          <Stat label="면적" value={`${n2(m2)} m²`} />
        </dl>
        {excludedRows > 0 && (
          <p className="text-xs text-muted-foreground">DG 프리즘이 이번 ERP 에서 제외한 품목 {n0(excludedRows)}행은 규격정리 양쪽에서도 제외했습니다.</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {packages.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOnly(null)} className={chipClass(only === null, 'h-8 text-xs')}>
              전체 <span className={chipCountClass(only === null)}>포장 {packages.length}</span>
            </button>
            {packages.map(x => (
              <button key={x.label} type="button" onClick={() => setOnly(x.label)}
                className={chipClass(only === x.label, 'h-8 max-w-full text-xs')}>
                <span className="max-w-[260px] truncate">{x.label}</span>
                <span className={chipCountClass(only === x.label)}>{n0(x.qty)}조</span>
                {x.off && <span className="h-2 w-2 rounded-full bg-warning" title="좌우 수량이 다른 블록이 있습니다" />}
              </button>
            ))}
          </div>
        )}

        {blocks.length === 0 && (
          <p className="rounded-lg bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">규격정리에 포함할 품목이 없습니다.</p>
        )}

        {shown.map((b, i) => (
          <div key={`${b.package_label}-${b.product_name}-${i}`} className="space-y-2">
            {b.first_in_package && (
              <p className={cn('flex items-center gap-2 text-sm font-bold', i > 0 && 'pt-2')}>
                <span className="rounded-md bg-brand-800 px-2 py-0.5 text-xs text-white">포장</span>{b.package_label}
              </p>
            )}
            <Block block={b} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm font-bold tabular-nums">
        {value}
        {note && (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold',
            tone === 'warn' ? 'text-[color-mix(in_oklch,var(--warning),black_35%)]' : 'text-success')}>
            {tone === 'warn' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{note}
          </span>
        )}
      </dd>
    </div>
  );
}

function Block({ block: b }: { block: SpecBlock }) {
  const depth = Math.max(b.left.length, b.right.length);
  const suggested = b.erp_name !== b.product_name;
  return (
    <section className="overflow-hidden rounded-xl border">
      {/* 품명 머리글 — 엑셀 1행과 같은 자리 */}
      <div className="grid gap-2 border-b bg-muted/50 px-3.5 py-2.5 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground">발주서 품명</p>
          <p className="truncate text-sm font-bold" title={b.product_name}>{b.product_name}</p>
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            ERP 품명
            {suggested
              ? <span className="inline-flex items-center gap-0.5 text-brand-700"><Sparkles className="h-3 w-3" />DG 프리즘 제안 — 확인 필요</span>
              : <span>— 사내 품목명으로 변경하세요</span>}
          </p>
          <p className={cn('truncate text-sm font-bold', suggested && 'text-brand-800')} title={b.erp_name}>{b.erp_name}</p>
        </div>
      </div>
      {b.left_qty !== b.right_qty && (
        <p className="flex items-center gap-1.5 border-b bg-warning-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          발주서 {n0(b.left_qty)}조, ERP {n0(b.right_qty)}조 — {n0(Math.abs(b.left_qty - b.right_qty))}조 차이가 있습니다. ERP 표에서 수정한 곳이 있는지 확인하세요.
        </p>
      )}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
            <tr className="text-[11px] text-muted-foreground">
              <th colSpan={5} className="px-2.5 pt-2 text-left font-semibold">발주서 순서 그대로</th>
              <th className="w-3 bg-muted/70" />
              <th colSpan={6} className="px-2.5 pt-2 text-left font-semibold">ERP 순서</th>
            </tr>
            <tr className="text-xs">
              <Head left>위치</Head><Head>규</Head><Head>격</Head><Head>수량</Head><Head title="머리글은 '평' 이지만 값은 재(303×303mm)">평</Head>
              <th className="w-3 bg-muted/70" />
              <Head left>위치</Head><Head>규</Head><Head>격</Head><Head>수량</Head><Head title="머리글은 '평' 이지만 값은 재(303×303mm)">평</Head><Head>M2</Head>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: depth }, (_, i) => (
              <tr key={i} className="border-t border-border/60 hover:bg-muted/40">
                <Cells row={b.left[i]} />
                <td className="w-3 bg-muted/70" />
                <Cells row={b.right[i]} />
                <td className="px-2.5 py-1.5 text-right text-muted-foreground">{b.right[i] ? n3(b.right[i].m2) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/50 font-bold">
              <td className="px-2.5 py-2 text-left text-xs text-muted-foreground" colSpan={3}>합계</td>
              <td className="px-2.5 py-2 text-right">{n0(b.left_qty)}</td>
              <td className="px-2.5 py-2 text-right">{n2(b.left_sai)}</td>
              <td className="w-3 bg-muted/70" />
              <td className="px-2.5 py-2" colSpan={3} />
              <td className="px-2.5 py-2 text-right">{n0(b.right_qty)}</td>
              <td className="px-2.5 py-2 text-right">{n2(b.right_sai)}</td>
              <td className="px-2.5 py-2 text-right">{n3(b.right_m2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Head({ children, left, title }: { children: React.ReactNode; left?: boolean; title?: string }) {
  return <th title={title} className={cn('px-2.5 py-1.5 font-semibold', left ? 'text-left' : 'text-right')}>{children}</th>;
}

function Cells({ row }: { row: SpecRow | undefined }) {
  if (!row) return <><td /><td /><td /><td /><td /></>;
  return (
    <>
      <td className="max-w-[280px] truncate px-2.5 py-1.5 text-left" title={row.location}>{row.location || <span className="text-muted-foreground">—</span>}</td>
      <td className="px-2.5 py-1.5 text-right">{row.width_mm}</td>
      <td className="px-2.5 py-1.5 text-right">{row.height_mm}</td>
      <td className="px-2.5 py-1.5 text-right font-semibold">{row.quantity}</td>
      <td className="px-2.5 py-1.5 text-right text-muted-foreground">{n2(row.sai)}</td>
    </>
  );
}
