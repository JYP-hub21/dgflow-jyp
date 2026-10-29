'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Plus, Trash2, Check, TriangleAlert, Copy, Upload } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StepTitle from '@/components/ui/step-title';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { verifyScan, expectedArea } from '@/lib/work-order/verify';
import type { ScanCheck, WorkOrderInput } from '@/lib/work-order/verify';
import { parseWorkOrderSheet } from '@/lib/work-order/excel';
import type { ParsedPdf } from '@/lib/work-order/pdf';

/**
 * ERP 작업의뢰서를 옮겨 적어 생산현황의 출발점으로 삼는다.
 *
 * 지금까지는 이 종이를 인쇄해 수량 옆에 손으로 적었다. 그 종이를 여기에 옮기면
 * 생산실적 입력 화면으로 이어진다.
 *
 * ERP 출력물 둘이 서로를 메운다 —
 *  · **엑셀** 은 품목표를 준다. 비고가 온전하다.
 *  · **PDF** 는 머리글(의뢰번호 · 업체명 · 현장명 · 날짜)을 준다. 엑셀에는 없는 값이다.
 * 둘 다 올리면 칠 게 없다. 하나만 올려도, 아무것도 없어도 손으로 칠 수 있다.
 *
 * 손으로 칠 때 줄여 주는 것들 —
 *  ① **면적은 안 친다.** 규격·수량에서 계산한다 (`expectedArea`).
 *  ② **블록 복제.** 복층유리라 外피/內피 블록의 규격·수량이 같다.
 *     우미 26-1952 는 1~6행과 7~12행이 완전히 같고 품명과 外/內 만 달랐다.
 *
 * 어느 길로 채웠든 문서의 소계·합계와 대조한다 — 빠뜨린 행이나 오타가 바로 드러난다.
 */

interface Row {
  product_name: string;
  width_mm: number | '';
  height_mm: number | '';
  quantity: number | '';
  /** 비우면 규격·수량으로 계산한다. 문서와 다를 때만 직접 친다 */
  area_m2: number | '';
  remark: string;
}

const EMPTY: Row = {
  product_name: '', width_mm: '', height_mm: '', quantity: '', area_m2: '', remark: '',
};

/**
 * 품명은 의뢰서에서 병합 셀이다 — 블록의 첫 행에만 적히고 아래는 비어 있다.
 * 비운 행은 위에서 가장 가까운, 품명이 적힌 행의 것을 물려받는다.
 * 사원이 블록당 한 번만 치면 되게 하려고 화면도 같은 규칙으로 움직인다.
 */
function resolveNames(rows: Row[]): string[] {
  let current = '';
  return rows.map((row) => {
    if (row.product_name.trim()) current = row.product_name.trim();
    return current;
  });
}

/** 계산한 면적. 규격·수량이 덜 채워졌으면 0 */
function areaOf(row: Row): number {
  if (row.area_m2 !== '') return Number(row.area_m2);
  if (!row.width_mm || !row.height_mm || !row.quantity) return 0;
  return expectedArea(Number(row.width_mm), Number(row.height_mm), Number(row.quantity));
}

/** 발주 건 화면의 "작업의뢰서 올리기" 로 들어왔을 때 — 어느 건의 어느 포장인가 */
interface Target {
  po: { id: string; intake_number: string; customer_name: string | null; site_name: string | null };
  pkg: { id: string; label: string; sheet_name: string; total_quantity: number } | null;
}

export default function WorkOrderReceivePage() {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [head, setHead] = useState({
    work_order_number: '', customer_label: '', site_label: '',
    request_date: '', delivery_date: '',
  });
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  /** 문서 맨 밑 합계 — 엑셀에서 오거나, 종이를 보고 친다 */
  const [printedTotal, setPrintedTotal] = useState<{ quantity: string; area_m2: string }>({
    quantity: '', area_m2: '',
  });
  /** 엑셀에서 온 소계. 손으로 칠 때는 비어 있다 (합계만 대조한다) */
  const [subtotals, setSubtotals] = useState<WorkOrderInput['printed_subtotals']>([]);
  const [fromExcel, setFromExcel] = useState(false);

  // ?po=&pkg= — 발주 건에서 왔으면 그 건을 알아 두고, 업체 · 현장을 미리 채운다
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const po = q.get('po');
    if (!po) return;
    fetch(`/api/purchase-orders/${po}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return;
        const d = j.data;
        setTarget({ po: d, pkg: d.packages.find((p: { id: string }) => p.id === q.get('pkg')) ?? null });
        setHead(h => ({
          ...h,
          customer_label: h.customer_label || d.customer_name || '',
          site_label: h.site_label || d.site_name || '',
        }));
      })
      .catch(() => {});
  }, []);

  /**
   * 올린 파일들을 **엑셀 먼저, PDF 나중에** 순서대로 처리한다.
   *
   * 동시에 돌리면 둘 다 비어 있던 시점의 `rows` 를 보고 각자 품목을 채워
   * 나중에 끝난 쪽이 이긴다 — 실제로 PDF 가 엑셀 13행을 17행으로 덮었다.
   * 품목은 비고가 온전한 엑셀이 우선이고, PDF 는 엑셀이 없을 때만 품목을 채운다.
   */
  async function handleFiles(files: File[]) {
    const isPdf = (f: File) => f.name.toLowerCase().endsWith('.pdf');
    const excels = files.filter((f) => !isPdf(f));
    const pdfs = files.filter(isPdf);

    setReading(true);
    try {
      let itemsFilled = rows.some((r) => r.width_mm && r.height_mm && r.quantity);
      for (const file of excels) {
        if (await handleExcel(file)) itemsFilled = true;
      }
      for (const file of pdfs) {
        await handlePdf(file, { fillItems: !itemsFilled });
        itemsFilled = true;
      }
    } finally {
      setReading(false);
    }
  }

  /**
   * PDF 로 머리글을 채운다.
   *
   * 엑셀에는 의뢰번호 · 업체명 · 현장명 · 날짜가 실리지 않는다. 그 다섯 칸이 PDF 에 있다.
   * PDF 에 품목도 있지만 **비고가 폭에 잘려** 들어오므로 (26-2090 의 17행이 `…84A 발`)
   * 표가 비어 있을 때만 쓰고, 그때는 비고를 확인하라고 알린다.
   */
  async function handlePdf(file: File, opts: { fillItems: boolean }) {
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/work-orders/pdf', { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error ?? 'PDF 를 읽지 못했습니다.');
        return;
      }

      const parsed = json.data as ParsedPdf;
      const h = parsed.head;
      setHead((prev) => ({
        work_order_number: h.work_order_number ?? prev.work_order_number,
        customer_label: h.customer_label ?? prev.customer_label,
        site_label: h.site_label ?? prev.site_label,
        request_date: h.request_date ?? prev.request_date,
        delivery_date: h.delivery_date ?? prev.delivery_date,
      }));

      const filled = Object.values(h).filter(Boolean).length;

      if (opts.fillItems && parsed.items.length > 0) {
        setRows(
          parsed.items.map((item, i) => ({
            product_name:
              i === 0 || item.product_name !== parsed.items[i - 1].product_name
                ? item.product_name
                : '',
            width_mm: item.width_mm,
            height_mm: item.height_mm,
            quantity: item.quantity,
            area_m2: item.area_m2,
            remark: item.remark ?? '',
          }))
        );
        setSubtotals(parsed.printed_subtotals);
        setPrintedTotal({
          quantity: parsed.printed_total ? String(parsed.printed_total.quantity) : '',
          area_m2: parsed.printed_total ? String(parsed.printed_total.area_m2) : '',
        });
        setFromExcel(true);
        toast.warning('PDF 의 비고는 잘려 있을 수 있습니다. 엑셀이 있으면 같이 올려 주세요.');
      }

      toast.success(`의뢰 정보 ${filled}칸을 채웠습니다.`);
    } catch {
      toast.error('PDF 를 읽지 못했습니다.');
    }
  }

  /** ERP 엑셀을 읽어 표를 채운다. 머리글은 엑셀에 없어서 PDF 나 사람이 채운다 */
  async function handleExcel(file: File): Promise<boolean> {
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1, defval: null, raw: true,
        });
        const parsed = parseWorkOrderSheet(sheet);

        if (parsed.items.length === 0) {
          toast.error(parsed.warnings[0] ?? '작업의뢰서 표를 찾지 못했습니다.');
          return false;
        }

        setRows(
          parsed.items.map((item, i) => ({
            // 품명은 블록 첫 행에만 남긴다 — 아래는 상속으로 따라온다
            product_name:
              i === 0 || item.product_name !== parsed.items[i - 1].product_name
                ? item.product_name
                : '',
            width_mm: item.width_mm,
            height_mm: item.height_mm,
            quantity: item.quantity,
            area_m2: item.area_m2,
            remark: item.remark ?? '',
          }))
        );
        setSubtotals(parsed.printed_subtotals);
        setPrintedTotal({
          quantity: parsed.printed_total ? String(parsed.printed_total.quantity) : '',
          area_m2: parsed.printed_total ? String(parsed.printed_total.area_m2) : '',
        });
        if (parsed.customer_label) {
          setHead((h) => ({ ...h, customer_label: h.customer_label || parsed.customer_label! }));
        }
        setFromExcel(true);

        parsed.warnings.forEach((w) => toast.warning(w));
        toast.success(`품목 ${parsed.items.length}행을 읽었습니다.`);
        return true;
      } catch {
        toast.error('엑셀을 읽지 못했습니다. ERP 에서 내려받은 파일이 맞는지 확인하세요.');
        return false;
      }
  }

  const names = useMemo(() => resolveNames(rows), [rows]);
  const countedQty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const countedArea = Math.round(rows.reduce((s, r) => s + areaOf(r), 0) * 100) / 100;

  /** 저장·검산에 쓰는 행 — 규격·수량이 찬 것만, 품명은 상속 적용 */
  const filledItems = rows
    .map((row, idx) => ({ row, name: names[idx] }))
    .filter(({ row }) => row.width_mm && row.height_mm && row.quantity)
    .map(({ row, name }, i) => ({
      no: i + 1,
      product_name: name,
      width_mm: Number(row.width_mm),
      height_mm: Number(row.height_mm),
      quantity: Number(row.quantity),
      area_m2: areaOf(row),
      remark: row.remark || null,
    }));

  const check: ScanCheck | null = useMemo(() => {
    if (!printedTotal.quantity && !printedTotal.area_m2) return null;
    const input: WorkOrderInput = {
      items: filledItems,
      // 엑셀로 받으면 소계까지 있어 어느 블록이 어긋났는지 짚어 준다
      printed_subtotals: subtotals,
      printed_total: {
        quantity: Number(printedTotal.quantity) || 0,
        area_m2: Number(printedTotal.area_m2) || 0,
      },
    };
    return verifyScan(input);
  }, [filledItems, printedTotal, subtotals]);

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY }]);
  }

  /**
   * 마지막 행의 비고에서 Enter 를 누르면 다음 행이 생기고 거기로 넘어간다.
   * 14행을 치면서 매번 `행 추가` 를 마우스로 누르게 하면 안 된다.
   */
  function handleKeyDown(e: React.KeyboardEvent, idx: number, isLastCell: boolean) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (isLastCell && idx === rows.length - 1) addRow();
    // 다음 행의 같은 칸으로. 새 행은 렌더 후에 잡힌다.
    const cell = (e.target as HTMLElement).dataset.cell;
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>(
        `[data-row="${idx + 1}"][data-cell="${cell}"]`
      );
      next?.focus();
    });
  }

  function setCell(idx: number, key: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        if (key === 'product_name' || key === 'remark') return { ...row, [key]: value };
        return { ...row, [key]: value === '' ? '' : Number(value) };
      })
    );
  }

  /**
   * 지금까지 친 행을 통째로 한 벌 더 붙인다 (外피 → 內피).
   *
   * 복층유리라 두 블록의 규격·수량이 같다 — 우미 26-1952 는 1~6행과 7~12행이
   * 완전히 같았다. 그래서 한 블록만 치고 복제한 뒤 품명 한 줄만 고치면 된다.
   *
   * 복제한 블록의 첫 행에만 품명을 남기고 나머지는 비운다.
   * 첫 행 품명을 內피 것으로 고치면 아래가 따라 바뀐다.
   */
  function duplicateAll() {
    const picked = rows
      .map((row, idx) => ({ row, name: names[idx] }))
      .filter(({ row }) => row.width_mm && row.height_mm && row.quantity);

    if (picked.length === 0) {
      toast.error('복제할 행이 없습니다. 규격과 수량을 먼저 채우세요.');
      return;
    }

    setRows([
      ...rows,
      ...picked.map(({ row, name }, i) => ({
        ...row,
        product_name: i === 0 ? name : '',
        // 外 ↔ 內 는 비고에서도 바뀐다
        remark: row.remark.replace('(外)', '(內)').replace('外', '內'),
      })),
    ]);
    toast.success(`${picked.length}행을 복제했습니다. 새 블록의 품명만 고치세요.`);
  }

  async function suggestLink(workOrderId: string, number: string) {
    const res = await fetch(`/api/purchase-orders/suggest?work_order_id=${workOrderId}`).catch(() => null);
    if (!res?.ok) return;
    const best = ((await res.json()).data ?? [])[0] as
      { package_id: string; package_label: string; intake_number: string; site_name: string | null; ok: boolean; summary: string } | undefined;
    if (!best) return;
    toast.info(`${number} 는 발주 ${best.intake_number}${best.site_name ? ` (${best.site_name})` : ''} · ${best.package_label} 에서 나온 것 같습니다 — ${best.summary}`, {
      duration: 30000,
      action: {
        label: '연결',
        onClick: async () => {
          const r = await fetch('/api/purchase-orders/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ package_id: best.package_id, work_order_id: workOrderId }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok) toast.success(`발주 ${best.intake_number} 에 연결했습니다 — ${j.data.summary}`);
          else toast.error(j.error ?? '연결하지 못했습니다.');
        },
      },
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/work-orders/from-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...head,
          request_date: head.request_date || null,
          delivery_date: head.delivery_date || null,
          notes: null,
          items: filledItems,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '저장하지 못했습니다.');
        return;
      }
      toast.success(`작업의뢰서 ${head.work_order_number} 를 등록했습니다.`);
      const workOrderId: string = json.data.id;

      // 발주 건의 포장에서 왔으면 바로 잇고 대조 결과를 보여 준 뒤 그 건으로 돌아간다
      if (target?.pkg) {
        const linked = await fetch('/api/purchase-orders/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package_id: target.pkg.id, work_order_id: workOrderId }),
        });
        const lj = await linked.json().catch(() => ({}));
        if (!linked.ok) toast.error(lj.error ?? '발주 건에 연결하지 못했습니다.');
        else if (lj.data.check.ok) toast.success(`${target.po.intake_number} · ${target.pkg.label} 에 연결 — ${lj.data.summary}`);
        else toast.warning(`${target.pkg.label} 에 연결했지만 ERP 엑셀과 다릅니다 — ${lj.data.summary}`, { duration: 15000 });
        router.push(`/purchase-orders/${target.po.id}`);
        return;
      }

      // 그냥 올렸으면 규격이 맞는 포장을 찾아 권한다 — 누르면 잇는다 (자동으로 잇지는 않는다)
      suggestLink(workOrderId, head.work_order_number);
      router.push(`/production/${workOrderId}`);
    } catch {
      toast.error('저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="작업의뢰서 등록"
        description="ERP 에서 내려받은 작업의뢰서를 올리면 채워집니다. 엑셀과 PDF 를 같이 올리면 손댈 것이 없습니다."
      />

      {target && (
        <div className="rounded-xl border border-brand-600/30 bg-brand-50/70 px-4 py-3 text-sm">
          <p className="font-semibold text-brand-900">
            발주 {target.po.intake_number} · {[target.po.customer_name, target.po.site_name].filter(Boolean).join(' ')}
            {target.pkg && <> — 포장 <b>{target.pkg.label}</b> ({target.pkg.total_quantity}장)</>}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            저장하면 이 포장에 연결되고, ERP 업로드 엑셀과 규격 · 수량을 대조합니다.
          </p>
        </div>
      )}

      <Card>
        <CardHeader><StepTitle step={1}>파일 올리기</StepTitle></CardHeader>
        <CardContent>
          <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input bg-muted/30 py-10 transition-colors hover:border-brand-600 hover:bg-brand-50">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-800 transition-colors group-hover:bg-brand-800 group-hover:text-white">
              <Upload className="h-6 w-6" />
            </span>
            <div className="text-center">
              <div className="text-[15px] font-semibold">
                {reading ? 'PDF 를 읽는 중입니다…' : '작업의뢰서 엑셀 · PDF 올리기'}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                엑셀은 <b>품목</b>을, PDF 는 <b>의뢰번호 · 업체명 · 현장명 · 날짜</b>를 채웁니다.
                둘 다 올리면 전부 채워집니다.
              </div>
            </div>
            <input type="file" accept=".xlsx,.xls,.pdf" multiple className="hidden"
              disabled={reading}
              onChange={(e) => {
                // 엑셀과 PDF 를 한 번에 올려도 되게 한다
                handleFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }} />
          </label>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            파일이 없으면 아래 표에 직접 쳐도 됩니다 —
            면적은 자동으로 계산되고, <b>Enter</b> 로 다음 행이 생깁니다.
            품명이 같은 행은 비워 두면 위 품명을 물려받습니다.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><StepTitle step={2}>의뢰 정보</StepTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="의뢰번호" placeholder="26-2286" value={head.work_order_number}
            onChange={(v) => setHead({ ...head, work_order_number: v })} />
          <Field label="업체명" value={head.customer_label}
            onChange={(v) => setHead({ ...head, customer_label: v })} />
          <Field label="현장명" value={head.site_label}
            onChange={(v) => setHead({ ...head, site_label: v })} />
          <Field label="의뢰일자" type="date" value={head.request_date}
            onChange={(v) => setHead({ ...head, request_date: v })} />
          <Field label="납품일자" type="date" value={head.delivery_date}
            onChange={(v) => setHead({ ...head, delivery_date: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <StepTitle step={3}>
            품목 <span className="tabular font-normal text-muted-foreground">— {rows.length}행 · {countedQty.toLocaleString()}장 · {countedArea.toFixed(2)}㎡</span>
          </StepTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={duplicateAll}>
              <Copy /> 블록 복제
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRows([...rows, { ...EMPTY }])}>
              <Plus /> 행 추가
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-5">No</TableHead>
                <TableHead className="min-w-56">품명</TableHead>
                <TableHead className="w-28">가로</TableHead>
                <TableHead className="w-28">세로</TableHead>
                <TableHead className="w-24">수량</TableHead>
                <TableHead className="w-28 text-right">면적</TableHead>
                <TableHead className="min-w-64">비고</TableHead>
                <TableHead className="w-14 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="tabular py-2 pl-5 text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="py-2">
                    {/* 비우면 위 품명을 물려받는다. 뭘 물려받는지 흐리게 보여 준다 */}
                    <Input value={row.product_name} data-row={idx} data-cell="name"
                      placeholder={names[idx] || (idx === 0 ? '품명' : '')}
                      className={!row.product_name && names[idx] ? 'placeholder:text-foreground/45' : undefined}
                      onKeyDown={(e) => handleKeyDown(e, idx, false)}
                      onChange={(e) => setCell(idx, 'product_name', e.target.value)} />
                  </TableCell>
                  <TableCell className="py-2">
                    <Input type="number" className="text-right tabular" value={row.width_mm} data-row={idx} data-cell="w"
                      onKeyDown={(e) => handleKeyDown(e, idx, false)}
                      onChange={(e) => setCell(idx, 'width_mm', e.target.value)} />
                  </TableCell>
                  <TableCell className="py-2">
                    <Input type="number" className="text-right tabular" value={row.height_mm} data-row={idx} data-cell="h"
                      onKeyDown={(e) => handleKeyDown(e, idx, false)}
                      onChange={(e) => setCell(idx, 'height_mm', e.target.value)} />
                  </TableCell>
                  <TableCell className="py-2">
                    <Input type="number" className="text-right font-semibold tabular" value={row.quantity} data-row={idx} data-cell="q"
                      onKeyDown={(e) => handleKeyDown(e, idx, false)}
                      onChange={(e) => setCell(idx, 'quantity', e.target.value)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {areaOf(row) ? areaOf(row).toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="py-2">
                    <Input value={row.remark} data-row={idx} data-cell="remark"
                      onKeyDown={(e) => handleKeyDown(e, idx, true)}
                      onChange={(e) => setCell(idx, 'remark', e.target.value)} />
                  </TableCell>
                  <TableCell className="py-2 pr-5">
                    <Button variant="destructive" size="icon-sm" title="행 삭제"
                      onClick={() => setRows(rows.filter((_, i) => i !== idx))}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle step={4}>
            검산 <span className="font-normal text-muted-foreground">
              — {fromExcel ? '엑셀의 소계 · 합계와 대조합니다' : '의뢰서 맨 밑 합계를 그대로 넣으세요'}
            </span>
          </StepTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {check && check.blocks.length > 0 && <BlockChecks check={check} />}
          <div className="grid gap-4 sm:grid-cols-2 max-w-md">
            <Field label="합계 수량" value={printedTotal.quantity}
              onChange={(v) => setPrintedTotal({ ...printedTotal, quantity: v })} />
            <Field label="합계 면적" value={printedTotal.area_m2}
              onChange={(v) => setPrintedTotal({ ...printedTotal, area_m2: v })} />
          </div>
          {check?.total && <TotalCheck check={check} counted={{ qty: countedQty, area: countedArea }} />}
        </CardContent>
      </Card>

      {/* 저장 막대 — 표가 길어도 화면 아래에 붙어 있다 */}
      <div className="sticky bottom-0 z-10 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-5 py-3.5 shadow-lg backdrop-blur">
          <p className="tabular text-sm">
            <b className="text-foreground">{head.work_order_number || '의뢰번호 없음'}</b>
            <span className="text-muted-foreground"> · {countedQty.toLocaleString()}장 · {countedArea.toFixed(2)}㎡</span>
          </p>
          <Button onClick={handleSave} disabled={saving} size="lg" className="w-full sm:w-auto">
            <Save />
            {saving ? '저장 중…' : '등록하고 생산실적 입력으로'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-semibold">{label}</label>
      <Input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** 품명 블록별 소계 대조 — 어긋난 블록을 짚어 준다 */
function BlockChecks({ check }: { check: ScanCheck }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>소계 구간</TableHead>
          <TableHead className="text-right">읽은 수량</TableHead>
          <TableHead className="text-right">의뢰서</TableHead>
          <TableHead className="text-right">읽은 면적</TableHead>
          <TableHead className="text-right">의뢰서</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {check.blocks.map((b, i) => (
          <TableRow key={i}>
            <TableCell className="max-w-72 truncate">
              {b.from_no}~{b.to_no} · {b.product_name}
            </TableCell>
            <TableCell className={`text-right tabular-nums ${b.quantity_ok ? '' : 'font-bold text-destructive'}`}>
              {b.counted.quantity}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{b.printed.quantity}</TableCell>
            <TableCell className={`text-right tabular-nums ${b.area_ok ? '' : 'font-bold text-destructive'}`}>
              {b.counted.area_m2.toFixed(2)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{b.printed.area_m2.toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TotalCheck({ check, counted }: {
  check: ScanCheck; counted: { qty: number; area: number };
}) {
  const ok = check.total!.quantity_ok && check.total!.area_ok;
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${ok ? 'border-success/40 bg-success-50' : 'border-destructive/40 bg-destructive/5'}`}>
      <div className="flex items-center gap-2.5 font-bold">
        {ok ? (
          <><span className="flex h-7 w-7 items-center justify-center rounded-full bg-success text-white"><Check className="h-4 w-4" /></span> 합계가 맞습니다</>
        ) : (
          <><span className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white"><TriangleAlert className="h-4 w-4" /></span> 합계가 어긋납니다 — 빠뜨린 행이나 오타가 있습니다</>
        )}
      </div>
      {!ok && (
        <div className="text-sm mt-2 space-y-0.5 tabular-nums">
          {!check.total!.quantity_ok && (
            <div>수량 — 친 것 {counted.qty} / 의뢰서 {check.total!.printed.quantity}
              {' '}(차이 {counted.qty - check.total!.printed.quantity})</div>
          )}
          {!check.total!.area_ok && (
            <div>면적 — 친 것 {counted.area.toFixed(2)} / 의뢰서 {check.total!.printed.area_m2.toFixed(2)}</div>
          )}
        </div>
      )}
    </div>
  );
}
