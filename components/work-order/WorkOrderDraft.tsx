'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Factory, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

/** 발주의뢰서에 적혀 있는 품목 한 줄 */
export interface SourceItem {
  id: string;
  product_id: string | null;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  location_dong: string | null;
  location_line: string | null;
  location_floor: string | null;
  location_room: string | null;
  location_type: string | null;
  location_window_type: string | null;
  remark: string | null;
}

/** 같은 규격끼리 묶은 결과 한 줄 — 작업의뢰서 한 줄이 된다 */
interface DraftRow {
  key: string;
  product_id: string | null;
  sourceProductName: string;  // 발주의뢰서에 적혀 있던 품명
  workOrderName: string;      // 담당자가 작업의뢰서에 적을 품명
  width_mm: number;
  height_mm: number;
  quantity: number;
  locationSummary: string;
  sources: SourceItem[];
}

/** 1,2,3 처럼 이어지면 1~3 으로, 아니면 1,2 로 묶는다 */
function mergeNumbers(values: string[]): string {
  const nums = values
    .map(v => parseInt(String(v).replace(/[^0-9]/g, ''), 10))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return values.join(',');
  if (nums.length === 1) return String(nums[0]);
  const isSequential = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return isSequential ? `${nums[0]}~${nums[nums.length - 1]}` : nums.join(',');
}

function summarize(items: SourceItem[]): string {
  const uniq = (key: keyof SourceItem) =>
    [...new Set(items.map(i => i[key]).filter(Boolean))] as string[];

  const parts: string[] = [];
  const dongs = uniq('location_dong');
  const lines = uniq('location_line');
  const floors = uniq('location_floor');
  const rooms = uniq('location_room');
  const types = uniq('location_type');
  const windows = uniq('location_window_type');

  if (dongs.length) parts.push(`${mergeNumbers(dongs)}동`);
  if (lines.length) parts.push(`${mergeNumbers(lines)}라인`);
  if (floors.length) parts.push(`(${floors.join(',')})`);
  if (rooms.length) parts.push(rooms.join(','));
  if (types.length) parts.push(types.join(','));
  if (windows.length) parts.push(windows.join(','));
  return parts.join(' ');
}

/** 같은 품명 + 같은 규격끼리 묶는다 (PRD 9절 규격 그룹핑 규칙) */
function buildRows(items: SourceItem[]): DraftRow[] {
  const map = new Map<string, SourceItem[]>();
  for (const item of items) {
    const key = `${item.product_name}|${item.width_mm}|${item.height_mm}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].map(([key, sources]) => ({
    key,
    product_id: sources[0].product_id,
    sourceProductName: sources[0].product_name,
    workOrderName: sources[0].product_name, // 기본값은 원본 품명 — 담당자가 고쳐 쓴다
    width_mm: sources[0].width_mm,
    height_mm: sources[0].height_mm,
    quantity: sources.reduce((sum, s) => sum + s.quantity, 0),
    locationSummary: summarize(sources),
    sources,
  }));
}

export default function WorkOrderDraft({
  orderId,
  orderNumber,
  items,
}: {
  orderId: string;
  orderNumber: string;
  items: SourceItem[];
}) {
  const router = useRouter();
  const initial = useMemo(() => buildRows(items), [items]);
  const [rows, setRows] = useState<DraftRow[]>(initial);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalArea = rows.reduce((s, r) => s + (r.width_mm * r.height_mm * r.quantity) / 1_000_000, 0);
  const emptyNames = rows.filter(r => !r.workOrderName.trim()).length;
  const changedNames = rows.filter(r => r.workOrderName.trim() !== r.sourceProductName).length;

  function setName(key: string, value: string) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, workOrderName: value } : r)));
  }

  function toggle(key: string) {
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleCreate() {
    if (emptyNames > 0) {
      setError('품명이 비어 있는 줄이 있습니다. 작업의뢰서에 넣을 품명을 적어 주세요.');
      return;
    }
    setSaving(true);
    setError('');

    const res = await fetch('/api/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        items: rows.map(r => ({
          product_id: r.product_id,
          product_name: r.workOrderName.trim(),
          source_product_name: r.sourceProductName,
          width_mm: r.width_mm,
          height_mm: r.height_mm,
          quantity: r.quantity,
          location_summary: r.locationSummary || null,
          source_item_count: r.sources.length,
          remark: null,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: '작업의뢰서를 만들지 못했습니다.' }));
      setError(body.error || '작업의뢰서를 만들지 못했습니다.');
      setSaving(false);
      return;
    }

    const { data } = await res.json();
    router.push(`/work-orders/${data.id}/compare`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              규격별로 묶은 결과
              <span className="ml-2 text-sm font-normal text-gray-500">
                발주 {items.length}줄 → 작업의뢰서 {rows.length}줄
              </span>
            </CardTitle>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>총 수량 <strong className="text-gray-900 tabular-nums">{totalQty.toLocaleString()}</strong>매</span>
              <span>총 면적 <strong className="text-gray-900 tabular-nums">{totalArea.toFixed(2)}</strong>㎡</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            같은 품명·같은 규격(가로×세로)인 발주 품목을 한 줄로 묶고 수량을 합쳤습니다.
            <strong className="font-semibold"> 작업의뢰서에 넣을 품명은 담당자가 직접 적습니다.</strong>
            {' '}기본값으로 발주서 품명을 넣어 두었으니 필요한 줄만 고치시면 됩니다.
            줄 앞의 화살표를 누르면 어떤 발주 품목이 묶였는지 볼 수 있습니다.
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>발주의뢰서 품명</TableHead>
                <TableHead className="w-[280px]">작업의뢰서 품명 (직접 입력)</TableHead>
                <TableHead className="text-right">규격</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>묶인 위치</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const isOpen = opened.has(row.key);
                const changed = row.workOrderName.trim() !== row.sourceProductName;
                return [
                  <TableRow key={row.key}>
                    <TableCell className="align-top">
                      <button
                        type="button"
                        onClick={() => toggle(row.key)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label={isOpen ? '묶인 품목 접기' : '묶인 품목 펼치기'}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm text-gray-900">{row.sourceProductName}</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        발주 {row.sources.length}줄이 묶임
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={row.workOrderName}
                          onChange={e => setName(row.key, e.target.value)}
                          placeholder="작업의뢰서에 넣을 품명"
                          className={`h-9 text-sm ${!row.workOrderName.trim() ? 'border-red-300' : ''}`}
                        />
                        {changed && (
                          <button
                            type="button"
                            onClick={() => setName(row.key, row.sourceProductName)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            title="발주서 품명으로 되돌리기"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {changed && (
                        <Badge variant="secondary" className="mt-1 text-[11px]">담당자 수정</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top text-sm tabular-nums">
                      {row.width_mm.toLocaleString()} × {row.height_mm.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right align-top text-sm font-medium tabular-nums">
                      {row.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="align-top text-sm text-gray-600">
                      {row.locationSummary || '-'}
                    </TableCell>
                  </TableRow>,
                  isOpen && (
                    <TableRow key={`${row.key}-sources`} className="bg-gray-50">
                      <TableCell />
                      <TableCell colSpan={5} className="py-2">
                        <div className="text-xs text-gray-500 mb-1">이 줄로 묶인 발주 품목</div>
                        <div className="space-y-1">
                          {row.sources.map(s => (
                            <div key={s.id} className="flex flex-wrap gap-x-4 text-xs text-gray-700">
                              <span className="tabular-nums">{s.width_mm} × {s.height_mm}</span>
                              <span className="tabular-nums">{s.quantity}매</span>
                              <span>
                                {[s.location_dong, s.location_line, s.location_floor, s.location_room, s.location_type, s.location_window_type]
                                  .filter(Boolean).join(' ') || '위치 없음'}
                              </span>
                              {s.remark && <span className="text-gray-500">{s.remark}</span>}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleCreate} disabled={saving}>
          <Factory className="mr-2 h-4 w-4" />
          {saving ? '만드는 중...' : '이 내용으로 작업의뢰서 만들기'}
        </Button>
        <span className="text-sm text-gray-500">
          {changedNames > 0
            ? `${changedNames}줄의 품명을 직접 고쳤습니다.`
            : '품명을 아직 고치지 않았습니다 (발주서 품명 그대로 들어갑니다).'}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        주문 {orderNumber} · 만들고 나면 원본 발주의뢰서와 나란히 비교하는 화면으로 이동합니다.
      </p>
    </div>
  );
}
