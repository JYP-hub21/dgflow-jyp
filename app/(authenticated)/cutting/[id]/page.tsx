'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import NativeSelect from '@/components/ui/native-select';
import Segmented from '@/components/ui/segmented';
import PageHeader from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { Plus, Sun, Moon } from 'lucide-react';

interface RawGlass { id: string; glass_type: string; width_mm: number; height_mm: number; area_m2: number; }
interface CuttingLog { id: string; product_name: string; quantity: number; raw_glass_type: string; raw_width_mm: number; raw_height_mm: number; raw_quantity: number; raw_area_m2: number; shift: string; is_manual: boolean; remark: string; cutting_date: string; }

export default function CuttingInputPage() {
  const params = useParams();
  const supabase = createClient();
  const workOrderId = params.id as string;

  const [workOrder, setWorkOrder] = useState<{ work_order_number: string } | null>(null);
  const [rawGlasses, setRawGlasses] = useState<RawGlass[]>([]);
  const [logs, setLogs] = useState<CuttingLog[]>([]);
  const [saving, setSaving] = useState(false);

  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [selectedGlass, setSelectedGlass] = useState('');
  const [rawQuantity, setRawQuantity] = useState('');
  const [shift, setShift] = useState('day');
  const [isManual, setIsManual] = useState(false);
  const [remark, setRemark] = useState('');

  useEffect(() => {
    supabase.from('dgflow_work_orders').select('work_order_number').eq('id', workOrderId).single()
      .then(({ data }) => setWorkOrder(data));
    supabase.from('dgflow_raw_glasses').select('*').eq('is_active', true).order('glass_type')
      .then(({ data }) => setRawGlasses(data || []));
    loadLogs();
  }, [workOrderId]);

  async function loadLogs() {
    const { data } = await supabase
      .from('dgflow_cutting_logs')
      .select('*')
      .eq('work_order_id', workOrderId)
      .order('created_at', { ascending: false });
    setLogs(data || []);
  }

  async function handleSave() {
    if (!productName || !quantity) return;
    setSaving(true);

    const glass = rawGlasses.find(g => g.id === selectedGlass);

    await fetch('/api/cutting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_order_id: workOrderId,
        product_name: productName,
        quantity: parseInt(quantity),
        raw_glass_type: glass?.glass_type || null,
        raw_width_mm: glass?.width_mm || null,
        raw_height_mm: glass?.height_mm || null,
        raw_quantity: rawQuantity ? parseInt(rawQuantity) : null,
        shift,
        is_manual: isManual,
        remark,
      }),
    });

    setProductName(''); setQuantity(''); setSelectedGlass(''); setRawQuantity(''); setRemark(''); setIsManual(false);
    setSaving(false);
    loadLogs();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        back={{ href: `/work-orders/${workOrderId}`, label: '작업의뢰서로' }}
        title="재단실적 입력"
        description={workOrder?.work_order_number}
      />

      {/* 입력 폼 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">재단 기록 추가</CardTitle>
          <p className="text-sm text-muted-foreground"><span className="text-destructive">*</span> 표시는 꼭 적어야 합니다.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="품명" required>
              <Input value={productName} onChange={e => setProductName(e.target.value)} placeholder="예) 5CL+5로이" />
            </FormField>
            <FormField label="절단 수량" required>
              <Input inputMode="numeric" className="tabular" value={quantity}
                onChange={e => setQuantity(e.target.value.replace(/[^0-9]/g, ''))} placeholder="장" />
            </FormField>
            <FormField label="원판 종류">
              <NativeSelect value={selectedGlass} onChange={e => setSelectedGlass(e.target.value)}>
                <option value="">선택 안 함</option>
                {rawGlasses.map(g => (
                  <option key={g.id} value={g.id}>{g.glass_type} ({g.width_mm}×{g.height_mm})</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="원판 사용량">
              <Input inputMode="numeric" className="tabular" value={rawQuantity}
                onChange={e => setRawQuantity(e.target.value.replace(/[^0-9]/g, ''))} placeholder="장" />
            </FormField>
            <FormField label="주 / 야간">
              <Segmented value={shift as 'day' | 'night'} onChange={setShift} className="w-full"
                options={[{ value: 'day', label: '주간', icon: Sun }, { value: 'night', label: '야간', icon: Moon }]} />
            </FormField>
            <FormField label="비고" className="sm:col-span-2 lg:col-span-3">
              <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="같이재단 등" />
            </FormField>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
              <input type="checkbox" checked={isManual} onChange={e => setIsManual(e.target.checked)}
                className="h-5 w-5 rounded accent-brand-800" />
              오도시 (수작업 재단)
            </label>
            <Button size="lg" onClick={handleSave} disabled={saving || !productName || !quantity} className="sm:min-w-40">
              <Plus />{saving ? '저장 중…' : '기록 추가'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 기록 목록 */}
      <Card className="gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">재단 기록 <span className="font-normal text-muted-foreground">{logs.length}건</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">날짜</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>원판</TableHead>
                <TableHead className="text-right">원판 수량</TableHead>
                <TableHead className="text-right">원판 면적(m²)</TableHead>
                <TableHead>구분</TableHead>
                <TableHead className="pr-5">비고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">재단 기록이 없습니다</TableCell></TableRow>
              ) : logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="tabular pl-5">{log.cutting_date}</TableCell>
                  <TableCell className="font-semibold">{log.product_name}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{log.quantity}</TableCell>
                  <TableCell>{log.raw_glass_type || '-'}</TableCell>
                  <TableCell className="tabular text-right">{log.raw_quantity || '-'}</TableCell>
                  <TableCell className="tabular text-right">{log.raw_area_m2 ? Number(log.raw_area_m2).toFixed(2) : '-'}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      {log.shift === 'night' ? '야간' : '주간'}
                      {log.is_manual && <Badge variant="warning">오도시</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 text-xs text-muted-foreground">{log.remark || ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FormField({ label, required, className, children }: {
  label: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[13px] font-semibold">
        {label}{required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
