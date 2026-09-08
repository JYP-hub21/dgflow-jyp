'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Save } from 'lucide-react';

interface RawGlass { id: string; glass_type: string; width_mm: number; height_mm: number; area_m2: number; }
interface CuttingLog { id: string; product_name: string; quantity: number; raw_glass_type: string; raw_width_mm: number; raw_height_mm: number; raw_quantity: number; raw_area_m2: number; shift: string; is_manual: boolean; remark: string; cutting_date: string; }

export default function CuttingInputPage() {
  const params = useParams();
  const router = useRouter();
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
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">재단실적 입력</h1>
        <p className="text-gray-500">의뢰번호: {workOrder?.work_order_number}</p>
      </div>

      {/* 입력 폼 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">재단 기록 추가</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">품명 *</Label>
            <Input className="h-9 text-sm" value={productName} onChange={e => setProductName(e.target.value)} placeholder="5CL+5로이" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">절단 수량 *</Label>
            <Input className="h-9 text-sm" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">원판 종류</Label>
            <select className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              value={selectedGlass} onChange={e => setSelectedGlass(e.target.value)}>
              <option value="">선택</option>
              {rawGlasses.map(g => (
                <option key={g.id} value={g.id}>{g.glass_type} ({g.width_mm}×{g.height_mm})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">원판 사용량</Label>
            <Input className="h-9 text-sm" type="number" value={rawQuantity} onChange={e => setRawQuantity(e.target.value)} placeholder="장" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">주/야간</Label>
            <select className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              value={shift} onChange={e => setShift(e.target.value)}>
              <option value="day">주간</option>
              <option value="night">야간</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">비고</Label>
            <Input className="h-9 text-sm" value={remark} onChange={e => setRemark(e.target.value)} placeholder="같이재단, 오도시 등" />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isManual} onChange={e => setIsManual(e.target.checked)} />
              오도시
            </label>
            <Button onClick={handleSave} disabled={saving || !productName || !quantity}>
              <Plus className="mr-1 h-4 w-4" />{saving ? '저장 중...' : '추가'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 기록 목록 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">재단 기록 ({logs.length}건)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>원판</TableHead>
                <TableHead className="text-right">원판 수량</TableHead>
                <TableHead className="text-right">원판 면적(m²)</TableHead>
                <TableHead>구분</TableHead>
                <TableHead>비고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-gray-500">재단 기록이 없습니다</TableCell></TableRow>
              ) : logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm">{log.cutting_date}</TableCell>
                  <TableCell className="font-medium">{log.product_name}</TableCell>
                  <TableCell className="text-right">{log.quantity}</TableCell>
                  <TableCell className="text-sm">{log.raw_glass_type || '-'}</TableCell>
                  <TableCell className="text-right">{log.raw_quantity || '-'}</TableCell>
                  <TableCell className="text-right">{log.raw_area_m2 ? Number(log.raw_area_m2).toFixed(2) : '-'}</TableCell>
                  <TableCell className="text-xs">{log.shift === 'night' ? '야간' : '주간'}{log.is_manual ? ' / 오도시' : ''}</TableCell>
                  <TableCell className="text-xs">{log.remark || ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => router.push('/work-orders')}>돌아가기</Button>
    </div>
  );
}
