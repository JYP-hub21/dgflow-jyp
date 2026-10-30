'use client';

import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Progress from '@/components/ui/progress';
import Segmented from '@/components/ui/segmented';
import PageHeader from '@/components/layout/PageHeader';
import { Save, CheckCircle, CheckCheck, SlidersHorizontal, Sun, Moon, Pencil, ChevronUp, Settings2, Plus } from 'lucide-react';
import ProductionCards from '@/components/production/ProductionCards';
import ProductionLogList, { type ProductionLog } from '@/components/production/ProductionLogList';
import QtyStepper from '@/components/production/QtyStepper';
import LinesEditor from '@/components/production/LinesEditor';
import { useProductionLines } from '@/components/production/useProductionLines';
import { useCurrentUser } from '@/components/layout/CurrentUser';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { activeLines, lineName } from '@/lib/production/lines';
import { blockTotals, formatDays, itemNo, productionDaysByItem } from '@/lib/production/item-view';
import type { SiteContact } from '@/lib/production/contacts';

interface WorkOrderItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  produced_quantity: number;
  area_m2: number;
  /** 작업의뢰서 비고 — 동 · 호 · 위치. 현장 시공자가 이걸 보고 유리를 붙인다 */
  remark: string | null;
  sort_order: number;
}

/** 이 PC(한국 시간) 기준 오늘 — toISOString 은 UTC 라 새벽 0~9시에 전날로 잡혔다 */
function localToday() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type WorkOrderHead = WorkOrderLabelSource & { work_order_number: string };

export default function ProductionInputPage() {
  const params = useParams();
  const supabase = createClient();
  const workOrderId = params.id as string;

  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [workOrder, setWorkOrder] = useState<WorkOrderHead | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [productionDate, setProductionDate] = useState(localToday);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [lineNumber, setLineNumber] = useState('1');
  // 호기 — 이름을 바꾸고 더할 수 있다 (표가 생기기 전에는 1호기 · 2호기)
  const { lines, storage: linesStorage, reload: reloadLines } = useProductionLines();
  const [editingLines, setEditingLines] = useState(false);
  const me = useCurrentUser();
  const canEditLines = !!me && hasAnyPermission(me, ['production:input', 'admin:master']);
  const [contact, setContact] = useState<SiteContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 폰에서는 생산일자·주야간·호기를 접어 둔다. 교대마다 한 번 정하는 값이다 */
  const [showOptions, setShowOptions] = useState(false);
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  /** "수정" 을 눌러 기록을 펼친 품목 */
  const [editItemId, setEditItemId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('dgflow_work_orders')
      .select('work_order_number, customer_label, site_label, order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))')
      .eq('id', workOrderId).single()
      .then(({ data }) => setWorkOrder(data as unknown as WorkOrderHead));
    loadItems();
    loadLogs();
    // 현장 담당자 — 이 의뢰서가 이어진 발주 건을 올린 공사개발부 담당
    fetch(`/api/work-orders/${workOrderId}/contact`).then(r => (r.ok ? r.json() : null))
      .then(b => setContact(b?.contact ?? null)).catch(() => {});
  }, [workOrderId]);

  async function loadItems() {
    const { data } = await supabase.from('dgflow_work_order_items')
      .select('*').eq('work_order_id', workOrderId).order('sort_order');
    setItems(data || []);
  }

  async function loadLogs() {
    const { data } = await supabase
      .from('dgflow_production_logs')
      .select('id, work_order_item_id, production_date, quantity_completed, area_m2, shift, line_number, item:dgflow_work_order_items(product_name, width_mm, height_mm, quantity)')
      .eq('work_order_id', workOrderId)
      .order('production_date', { ascending: false })
      .order('created_at', { ascending: false });
    setLogs((data || []) as unknown as ProductionLog[]);
  }

  /** 기록을 고치거나 지우면 품목의 완료 수량도 바뀐다 */
  async function reload() {
    await Promise.all([loadItems(), loadLogs()]);
  }

  const setQty = (itemId: string, value: string) =>
    setQuantities(prev => ({ ...prev, [itemId]: value.replace(/[^0-9]/g, '') }));

  // 입력된 항목이 있는지 확인
  const hasInput = Object.values(quantities).some(v => parseInt(v) > 0);
  // 잔여보다 많이 친 품목 — 저장하면 생산량이 의뢰량을 넘으므로 고칠 때까지 막는다
  const overCount = items.filter(i => (parseInt(quantities[i.id]) || 0) > i.quantity - i.produced_quantity).length;

  // 전체 저장
  async function handleSaveAll() {
    const entries = Object.entries(quantities).filter(([_, v]) => parseInt(v) > 0);
    if (entries.length === 0) return;

    setSaving(true);
    for (const [itemId, qty] of entries) {
      await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: workOrderId,
          work_order_item_id: itemId,
          quantity_completed: parseInt(qty),
          production_date: productionDate,
          log_type: 'partial',
          shift,
          line_number: parseInt(lineNumber),
        }),
      });
    }

    setQuantities({});
    await reload();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // 전량 완료 — 남은 수량을 입력칸에만 채운다. 확인하고 고친 뒤 "전체 저장" 으로 저장한다
  function handleAllComplete() {
    setQuantities(prev => {
      const next = { ...prev };
      for (const item of items) {
        const remaining = item.quantity - item.produced_quantity;
        if (remaining > 0) next[item.id] = String(remaining);
      }
      return next;
    });
  }

  // 1장씩 채우기 — 남은 품목마다 칸에 1장을 더한다(잔여를 넘지 않게). 누를 때마다 1장씩 는다
  // (2026-10-31 피드백 "전량 채우기 말고 전체 다 1장씩 채우기도"). 이것도 칸에만 채우고 저장은 따로 한다
  function handleAllPlusOne() {
    setQuantities(prev => {
      const next = { ...prev };
      for (const item of items) {
        const remaining = item.quantity - item.produced_quantity;
        if (remaining <= 0) continue;
        next[item.id] = String(Math.min(remaining, (parseInt(prev[item.id]) || 0) + 1));
      }
      return next;
    });
  }

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalProduced = items.reduce((s, i) => s + i.produced_quantity, 0);
  const totalInput = Object.values(quantities).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const inputCount = Object.values(quantities).filter(v => parseInt(v) > 0).length;
  const progress = totalQty > 0 ? Math.round(totalProduced / totalQty * 100) : 0;
  const incompleteCount = items.filter(i => i.quantity - i.produced_quantity > 0).length;
  const labels = workOrder ? workOrderLabels(workOrder) : null;
  // 품목별 생산 날짜 · 품명 덩어리별 소계 (워드 8번 · 회의)
  const daysByItem = productionDaysByItem(logs);
  const blocks = blockTotals(items);
  const blockEnds = new Map(blocks.map(b => [b.endIndex, b]));
  const lineOptions = activeLines(lines).map(l => ({ value: String(l.line_number), label: l.name }));
  const contactText = contact ? `공사 담당 ${contact.name}${contact.phone ? ` ${contact.phone}` : ''}` : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/*
        폰에서는 머리글이 따라다녀야 한다 — 13행을 내려가며 치다 보면
        진행률도 저장 버튼도 화면 밖으로 나가기 때문이다.
      */}
      <div className="sticky -top-4 z-20 -mx-4 -mt-4 border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold">생산실적 입력</h1>
            <p className="truncate text-sm text-muted-foreground">{workOrder?.work_order_number}</p>
          </div>
          <div className="tabular shrink-0 text-right">
            <p className="text-sm">
              <span className="font-bold">{totalProduced}/{totalQty}</span>
              <span className="text-muted-foreground"> ({progress}%)</span>
            </p>
            {totalInput > 0 && <p className="text-sm font-semibold text-brand-700">입력 {totalInput}장</p>}
          </div>
        </div>
        <Button onClick={handleSaveAll} disabled={saving || !hasInput || overCount > 0} size="lg" className="mt-3 w-full">
          {saved ? <CheckCircle /> : <Save />}
          {saving ? '저장 중…' : saved ? '저장했습니다' : `전체 저장${totalInput > 0 ? ` (${totalInput}장)` : ''}`}
        </Button>
      </div>

      {/* PC 머리글 */}
      <div className="hidden md:block">
        <PageHeader
          back={{ href: `/work-orders/${workOrderId}`, label: '작업의뢰서로' }}
          title="생산실적 입력"
          description={[workOrder?.work_order_number, labels?.customer, labels?.site, contactText].filter(Boolean).join(' · ')}
        />
      </div>

      {/* 진행 요약 (PC) */}
      <Card className="hidden md:flex">
        <CardContent className="grid grid-cols-4 items-center gap-6">
          <Summary label="의뢰" value={totalQty} />
          <Summary label="완료" value={totalProduced} tone="success" />
          <Summary label="잔여" value={totalQty - totalProduced} tone="strong" />
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">전체 진행률</p>
            <Progress value={progress} />
          </div>
        </CardContent>
      </Card>

      {/* 공통 옵션 — 폰에서는 접어 둔다 */}
      <button type="button" onClick={() => setShowOptions((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-input bg-card px-4 py-3 text-sm shadow-xs md:hidden">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <span className="tabular font-medium">
          {productionDate} · {shift === 'night' ? '야간' : '주간'} · {lineName(lines, Number(lineNumber))}
        </span>
        <span className="ml-auto font-semibold text-brand-700">{showOptions ? '닫기' : '바꾸기'}</span>
      </button>

      <Card className={showOptions ? '' : 'hidden md:flex'}>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-8">
          <Field label="생산일자">
            <Input type="date" className="w-44" value={productionDate} onChange={e => setProductionDate(e.target.value)} />
          </Field>
          <Field label="주 / 야간">
            <Segmented value={shift} onChange={setShift}
              options={[{ value: 'day', label: '주간', icon: Sun }, { value: 'night', label: '야간', icon: Moon }]} />
          </Field>
          <Field label="호기">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={lineNumber} onChange={setLineNumber} options={lineOptions} />
              {canEditLines && (
                <Button variant="ghost" size="sm" onClick={() => setEditingLines(v => !v)} className="text-muted-foreground">
                  <Settings2 />호기 편집
                </Button>
              )}
            </div>
          </Field>
          {editingLines && (
            <LinesEditor lines={lines} storage={linesStorage} onSaved={reloadLines} onClose={() => setEditingLines(false)} />
          )}
        </CardContent>
      </Card>
      {contactText && (
        <p className="text-sm text-muted-foreground md:hidden">{contactText}</p>
      )}

      {/* 품목별 입력 */}
      <Card className="gap-0 pb-0">
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">품목별 생산량</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              만든 수량을 적고 저장하세요. <b className="text-foreground">1장씩</b>은 누를 때마다 남은 품목마다 1장을 더하고,{' '}
              <b className="text-foreground">전량</b>은 남은 수량을 채웁니다 — 칸에 채우기만 하니 확인한 뒤 저장하세요.
            </p>
          </div>
          {incompleteCount > 0 && (
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <Button variant="outline" onClick={handleAllPlusOne} disabled={saving} className="w-full sm:w-auto">
                <Plus />남은 {incompleteCount}건 1장씩 채우기
              </Button>
              <Button variant="outline" onClick={handleAllComplete} disabled={saving} className="w-full sm:w-auto">
                <CheckCheck />남은 {incompleteCount}건 전량 채우기
              </Button>
            </div>
          )}
        </CardHeader>

        {/* 폰 — 품목당 카드 한 장 */}
        <CardContent className="p-3 md:hidden">
          <ProductionCards items={items} quantities={quantities} onChange={setQty} daysByItem={daysByItem}
            renderLogs={id => <ProductionLogList compact logs={logs.filter(l => l.work_order_item_id === id)} onChanged={reload} />} />
        </CardContent>

        {/* PC — 표 */}
        <CardContent className="hidden p-0 md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-5 text-center">No.</TableHead>
                <TableHead>품명 · 비고</TableHead>
                <TableHead className="text-right">규격 (mm)</TableHead>
                <TableHead className="text-right">의뢰</TableHead>
                <TableHead className="text-right">완료 · 생산일</TableHead>
                <TableHead className="text-right">잔여</TableHead>
                <TableHead className="w-[300px] pr-5">이번 생산량</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const days = daysByItem.get(item.id) ?? [];
                const blockEnd = blocks.length > 1 ? blockEnds.get(index) : undefined;
                const remaining = item.quantity - item.produced_quantity;
                const isComplete = remaining <= 0;
                const value = quantities[item.id] || '';
                const entered = parseInt(value) || 0;
                const over = entered > remaining;
                const editing = editItemId === item.id;
                const editButton = item.produced_quantity > 0 && (
                  <Button variant={editing ? 'secondary' : 'ghost'} className="h-11 px-3"
                    onClick={() => setEditItemId(editing ? null : item.id)}>
                    {editing ? <ChevronUp /> : <Pencil />}수정
                  </Button>
                );
                return (
                  <Fragment key={item.id}>
                  <TableRow
                    className={cn(
                      isComplete && 'bg-success-50/60 text-muted-foreground',
                      entered > 0 && !over && 'bg-brand-50/80'
                    )}>
                    <TableCell className="tabular pl-5 text-center text-sm font-bold text-muted-foreground">{itemNo(item, index)}</TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal">
                      <p className="font-semibold text-foreground">{item.product_name}</p>
                      {item.remark && <p className="mt-0.5 break-all text-xs text-muted-foreground">{item.remark}</p>}
                    </TableCell>
                    <TableCell className="tabular text-right">{item.width_mm} × {item.height_mm}</TableCell>
                    <TableCell className="tabular text-right">{item.quantity}</TableCell>
                    <TableCell className="tabular text-right">
                      {item.produced_quantity}
                      {days.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground" title={days.map(d => `${d.date} ${d.quantity}장`).join('\n')}>{formatDays(days)}</p>}
                    </TableCell>
                    <TableCell className="tabular text-right text-base font-bold text-foreground">
                      {isComplete ? <Badge variant="success"><CheckCircle />완료</Badge> : remaining}
                    </TableCell>
                    <TableCell className="py-2.5 pr-5">
                      {isComplete && editButton}
                      {!isComplete && (
                        <div className="flex items-center gap-2">
                          {/* 옆의 작은 + · − 로 한 장씩 (2026-10-30 피드백) */}
                          <QtyStepper value={value} onChange={v => setQty(item.id, v)} invalid={over} highlight={entered > 0} />
                          <Button variant="outline" className="h-11" onClick={() => setQty(item.id, String(remaining))}>
                            전량
                          </Button>
                          {editButton}
                        </div>
                      )}
                      {over && <p className="mt-1 text-xs font-medium text-destructive">잔여 {remaining}장보다 많습니다</p>}
                    </TableCell>
                  </TableRow>
                  {editing && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="border-l-4 border-l-brand-600 bg-brand-50/40 p-0 whitespace-normal">
                        <ProductionLogList compact logs={logs.filter(l => l.work_order_item_id === item.id)} onChanged={reload} />
                      </TableCell>
                    </TableRow>
                  )}
                  {/* 품명 덩어리가 끝나면 소계 — 품명이 하나뿐이면 총계와 같아 생략 */}
                  {blockEnd && (
                    <TableRow className="bg-muted/50 text-sm hover:bg-muted/50">
                      <TableCell />
                      <TableCell className="font-semibold text-muted-foreground" colSpan={2}>소계 · {blockEnd.count}품목</TableCell>
                      <TableCell className="tabular text-right font-semibold">{blockEnd.quantity}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{blockEnd.produced}</TableCell>
                      <TableCell className="tabular text-right font-bold">{blockEnd.quantity - blockEnd.produced}</TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
              {items.length > 0 && (
                <TableRow className="bg-brand-50/70 font-bold hover:bg-brand-50/70">
                  <TableCell />
                  <TableCell colSpan={2}>총계 · {items.length}품목</TableCell>
                  <TableCell className="tabular text-right">{totalQty}</TableCell>
                  <TableCell className="tabular text-right">{totalProduced}</TableCell>
                  <TableCell className="tabular text-right">{totalQty - totalProduced}</TableCell>
                  <TableCell className="pr-5" />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* PC — 저장 막대. 표가 길어도 화면 아래에 붙어 있다 */}
      <div className="sticky bottom-0 z-10 hidden pb-1 md:block">
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-card/95 px-5 py-3.5 shadow-lg backdrop-blur">
          <div className="text-sm">
            {saved ? (
              <span className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle className="h-4 w-4" />저장했습니다
              </span>
            ) : overCount > 0 ? (
              <span className="font-semibold text-destructive">잔여보다 많이 입력한 품목이 {overCount}건 있습니다. 고친 뒤 저장하세요.</span>
            ) : totalInput > 0 ? (
              <span>
                이번 입력 <b className="tabular text-lg text-brand-800">{totalInput}</b>장
                <span className="text-muted-foreground"> · {inputCount}개 품목</span>
              </span>
            ) : (
              <span className="text-muted-foreground">생산량을 입력하면 저장할 수 있습니다</span>
            )}
          </div>
          <Button size="lg" onClick={handleSaveAll} disabled={saving || !hasInput || overCount > 0} className="min-w-44">
            <Save />{saving ? '저장 중…' : '전체 저장'}
          </Button>
        </div>
      </div>

      {/* 저장한 생산 기록 — 고치거나 지울 수 있다 */}
      {logs.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="border-b">
            <CardTitle className="text-lg">생산 기록</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">잘못 저장한 기록은 위 표에서 품목의 <b className="text-foreground">수정</b>을 눌러 고치세요.</p>
          </CardHeader>
          <CardContent className="p-0">
            <ProductionLogList readOnly logs={logs} onChanged={reload} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'strong' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-1 text-2xl font-bold tracking-tight',
        tone === 'success' ? 'text-success' : tone === 'strong' ? 'text-brand-800' : 'text-foreground')}>
        {value}<span className="ml-0.5 text-sm font-medium text-muted-foreground">장</span>
      </p>
    </div>
  );
}
