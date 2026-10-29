'use client';

/**
 * ERP 시트 미리보기 — **고칠 수 있는** 표
 *
 * 전에는 자동으로 만든 값을 보여 주기만 했다. 틀린 곳이 하나라도 있으면 사원은
 * 엑셀을 내려받아 고치거나, 아예 처음부터 손으로 만들어야 했다.
 *
 * 파서가 80%만 맞혀도 나머지를 여기서 고칠 수 있으면 일이 끝난다.
 * 그래서 위치·가로·세로·수량을 직접 편집하고 행을 지우거나 옮길 수 있게 했다.
 * 고친 값은 그대로 엑셀로 나간다.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  FileSpreadsheet, Download, ChevronRight, ChevronUp, ChevronDown, Trash2, Undo2, Plus,
} from 'lucide-react';
import type { ErpUploadRow, ErpUploadSheet } from '@/lib/erp/upload-sheet';
import { packagingSourceLabel } from '@/lib/erp/upload-sheet';

export interface SheetEditorProps {
  sheet: ErpUploadSheet;
  /** 자동 생성값 — 되돌리기 비교용 */
  original: ErpUploadRow[];
  edited: boolean;
  onChange: (rows: ErpUploadRow[]) => void;
  onReset: () => void;
  onDownload: () => void;
}

export default function SheetEditor({
  sheet, original, edited, onChange, onReset, onDownload,
}: SheetEditorProps) {
  const rows = sheet.rows;

  function patch(index: number, change: Partial<ErpUploadRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addBelow(index: number) {
    const next = [...rows];
    next.splice(index + 1, 0, {
      location: '',
      width_mm: 0,
      height_mm: 0,
      quantity: 1,
      product_name: rows[index]?.product_name ?? '',
      merged_from: 1,
      review: ['직접 추가한 행입니다.'],
    });
    onChange(next);
  }

  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          {sheet.packaging_label}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-normal text-muted-foreground">
            시트명 &quot;{sheet.sheet_name}&quot; · {rows.length}행 · {total.toLocaleString()}장
          </span>
          {edited && <Badge variant="info">직접 고침</Badge>}
        </CardTitle>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            포장 단위 근거: {packagingSourceLabel(sheet.source)} · 칸을 눌러 바로 고칠 수 있습니다
          </p>
          <div className="flex gap-2">
            {edited && (
              <Button size="sm" variant="outline" onClick={onReset}>
                <Undo2 />
                자동값으로 되돌리기 ({original.length}행)
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDownload}>
              <Download />이 포장만 받기
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead className="min-w-[18rem]">위치</TableHead>
                <TableHead className="w-24 text-right">가로</TableHead>
                <TableHead className="w-24 text-right">세로</TableHead>
                <TableHead className="w-20 text-right">수량</TableHead>
                <TableHead className="w-48">품명 (참고)</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i} className={row.review.length > 0 ? 'bg-warning-50/70' : ''}>
                  <TableCell className="tabular py-2 text-xs text-muted-foreground">{i + 1}</TableCell>

                  <TableCell className="py-2">
                    <Input
                      value={row.location}
                      placeholder="위치를 읽지 못했습니다 — 직접 입력"
                      onChange={e => patch(i, { location: e.target.value })}
                      className="h-9 text-sm"
                    />
                    {row.merged_from > 1 && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        발주서 {row.merged_from}행 합산
                      </span>
                    )}
                    {row.review.map((r, k) => (
                      <span
                        key={k}
                        className="mt-1 block whitespace-normal rounded-md border border-warning/40 bg-warning-50 px-2 py-1 text-xs font-medium leading-relaxed text-amber-900"
                      >
                        {r}
                      </span>
                    ))}
                  </TableCell>

                  <NumberCell value={row.width_mm} onChange={v => patch(i, { width_mm: v })} />
                  <NumberCell value={row.height_mm} onChange={v => patch(i, { height_mm: v })} />
                  <NumberCell value={row.quantity} onChange={v => patch(i, { quantity: v })} bold />

                  <TableCell className="text-xs text-muted-foreground">{row.product_name}</TableCell>

                  <TableCell className="py-2">
                    <div className="flex items-center gap-1">
                      <IconButton label="위로" onClick={() => move(i, -1)} disabled={i === 0}>
                        <ChevronUp className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="아래로" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                        <ChevronDown className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="아래에 행 추가" onClick={() => addBelow(i)}>
                        <Plus className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="행 삭제" onClick={() => remove(i)} danger>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberCell({
  value, onChange, bold,
}: { value: number; onChange: (v: number) => void; bold?: boolean }) {
  return (
    <TableCell className="py-2 text-right">
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        className={`h-9 text-right text-sm tabular-nums ${bold ? 'font-bold' : ''}`}
      />
    </TableCell>
  );
}

function IconButton({
  children, label, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-25 ${
        danger
          ? 'border-destructive/25 text-destructive hover:bg-destructive hover:text-white'
          : 'border-input bg-card text-foreground hover:border-brand-600/50 hover:bg-brand-50'
      }`}
    >
      {children}
    </button>
  );
}
