'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Save, Paperclip, X, Image, FileSpreadsheet, FileText } from 'lucide-react';
import { calculateArea } from '@/lib/calc/area';
import ExcelUpload from '@/components/order/ExcelUpload';
import type { ParsedOrderItem, ParsedOrderMeta } from '@/lib/parser/excel-order';
import { type OrderItemForm, type OrderFormData, EMPTY_ORDER_ITEM, SELECT_CLASS } from '@/types/order-form';

interface Customer { id: string; name: string; short_name: string; }
interface Site { id: string; site_name: string; customer_id: string; }
interface Product { id: string; display_name: string; product_code: string; }
interface ProductMapping { product_id: string; variant_name: string; }

interface StagedFile {
  file: File;
  category: string;
  preview?: string;
}

function guessCategoryFromFile(file: File): string {
  if (file.type.startsWith('image/')) return 'chat_capture';
  if (file.type.includes('spreadsheet') || file.type.includes('excel')) return 'purchase_order';
  if (file.type.includes('pdf')) return 'purchase_order';
  return 'etc';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
  if (type.includes('spreadsheet') || type.includes('excel')) return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
  return <Paperclip className="h-4 w-4 text-gray-500" />;
}

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
];

interface OrderFormProps {
  mode: 'create' | 'edit';
  title: string;
  initialData?: OrderFormData;
  orderId?: string;
  onSave: (data: OrderFormData) => Promise<{ error?: string; orderId?: string }>;
  onCancel: () => void;
}

export default function OrderForm({ mode, title, initialData, orderId: existingOrderId, onSave, onCancel }: OrderFormProps) {
  const supabase = createClient();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productMappings, setProductMappings] = useState<ProductMapping[]>([]);
  const [customerId, setCustomerId] = useState(initialData?.customerId || '');
  const [siteId, setSiteId] = useState(initialData?.siteId || '');
  const [orderDate, setOrderDate] = useState(initialData?.orderDate || new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate || '');
  const [remark, setRemark] = useState(initialData?.remark || '');
  const [items, setItems] = useState<OrderItemForm[]>(initialData?.items || [{ ...EMPTY_ORDER_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingSiteName, setPendingSiteName] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // 마스터 데이터 로드
  useEffect(() => {
    supabase.from('dgflow_customers').select('id, name, short_name').eq('is_active', true).order('name')
      .then(({ data }) => setCustomers(data || []));
    supabase.from('dgflow_products').select('id, display_name, product_code').eq('is_active', true).order('display_name')
      .then(({ data }) => setProducts(data || []));
    supabase.from('dgflow_product_name_mappings').select('product_id, variant_name')
      .then(({ data }) => setProductMappings(data || []));
  }, []);

  // 거래처 변경 → 현장 로드
  useEffect(() => {
    if (customerId) {
      supabase.from('dgflow_sites').select('id, site_name, customer_id')
        .eq('customer_id', customerId).eq('is_active', true).order('site_name')
        .then(({ data }) => {
          const siteList = data || [];
          setSites(siteList);
          if (pendingSiteName) {
            const matched = siteList.find(s =>
              s.site_name.includes(pendingSiteName) || pendingSiteName.includes(s.site_name)
            );
            if (matched) setSiteId(matched.id);
            setPendingSiteName('');
          } else if (!initialData) {
            setSiteId('');
          }
        });
    }
  }, [customerId]);

  // 편집 모드 초기 현장 로드
  useEffect(() => {
    if (initialData?.customerId) {
      supabase.from('dgflow_sites').select('id, site_name, customer_id')
        .eq('customer_id', initialData.customerId).eq('is_active', true).order('site_name')
        .then(({ data }) => setSites(data || []));
    }
  }, []);

  function updateItem(index: number, field: keyof OrderItemForm, value: string) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function addItem() { setItems(prev => [...prev, { ...EMPTY_ORDER_ITEM }]); }
  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find(p => p.id === productId);
    if (product) {
      updateItem(index, 'product_id', productId);
      updateItem(index, 'product_name', product.display_name);
    }
  }

  // 품명 매칭 헬퍼
  function findProductId(parsedName: string): string {
    if (!parsedName) return '';
    const normalized = parsedName.replace(/\s+/g, '').toUpperCase();
    const direct = products.find(p => p.display_name === parsedName);
    if (direct) return direct.id;
    const mapping = productMappings.find(m =>
      m.variant_name.replace(/\s+/g, '').toUpperCase() === normalized
    );
    if (mapping) return mapping.product_id;
    const partial = productMappings.find(m =>
      normalized.includes(m.variant_name.replace(/\s+/g, '').toUpperCase()) ||
      m.variant_name.replace(/\s+/g, '').toUpperCase().includes(normalized)
    );
    if (partial) return partial.product_id;
    return '';
  }

  function handleExcelParsed(parsedItems: ParsedOrderItem[], meta: ParsedOrderMeta) {
    // site_name에서 거래처 추출
    if (!meta.customer_name && meta.site_name) {
      const parts = meta.site_name.split(/[-_]/);
      if (parts.length >= 2) meta.customer_name = parts[0].trim();
    }

    if (meta.customer_name) {
      const nameTokens = meta.customer_name.split(/[-_\s]/);
      const matched = customers.find(c => {
        const cName = c.name.replace(/\(주\)|\(유\)|\(사\)/g, '').trim();
        const cShort = (c.short_name || '').trim();
        return nameTokens.some(token =>
          token.length >= 2 && (cName.includes(token) || cShort.includes(token) || token.includes(cName) || token.includes(cShort))
        );
      });
      if (matched) setCustomerId(matched.id);
    }
    if (meta.site_name) setPendingSiteName(meta.site_name);
    if (meta.order_date) setOrderDate(meta.order_date);
    if (meta.delivery_date) setDeliveryDate(meta.delivery_date);
    if (meta.remark) setRemark(meta.remark);

    const newItems: OrderItemForm[] = parsedItems.map(p => {
      const productId = findProductId(p.product_name);
      const matchedProduct = products.find(pr => pr.id === productId);
      return {
        product_name: matchedProduct?.display_name || p.product_name,
        product_id: productId,
        width_mm: p.width_mm,
        height_mm: p.height_mm,
        quantity: p.quantity || '1',
        location_dong: p.location_dong,
        location_line: p.location_line,
        location_floor: p.location_floor,
        location_room: p.location_room,
        location_type: p.location_type,
        location_window_type: p.location_window_type,
        remark: p.remark,
      };
    });
    setItems(newItems.length > 0 ? newItems : [{ ...EMPTY_ORDER_ITEM }]);
  }

  // 첨부파일 스테이징
  function addStagedFiles(files: FileList | File[]) {
    const newFiles: StagedFile[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.size > 10 * 1024 * 1024) continue;
      if (stagedFiles.length + newFiles.length >= 10) break;
      const staged: StagedFile = { file, category: guessCategoryFromFile(file) };
      if (file.type.startsWith('image/')) {
        staged.preview = URL.createObjectURL(file);
      }
      newFiles.push(staged);
    }
    setStagedFiles(prev => [...prev, ...newFiles]);
  }

  function removeStagedFile(index: number) {
    setStagedFiles(prev => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadStagedFiles(targetOrderId: string) {
    for (const staged of stagedFiles) {
      const formData = new FormData();
      formData.append('file', staged.file);
      formData.append('category', staged.category);
      await fetch(`/api/orders/${targetOrderId}/attachments`, {
        method: 'POST',
        body: formData,
      });
    }
  }

  const totalQuantity = items.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0);
  const totalArea = items.reduce((s, i) =>
    s + calculateArea(parseInt(i.width_mm) || 0, parseInt(i.height_mm) || 0, parseInt(i.quantity) || 0), 0);

  async function handleSave() {
    setError('');
    if (!customerId || !siteId) { setError('거래처와 현장을 선택하세요.'); return; }
    const validItems = items.filter(i => i.product_name && i.width_mm && i.height_mm && i.quantity);
    if (validItems.length === 0) { setError('최소 1개 이상의 품목을 입력하세요.'); return; }

    setSaving(true);
    const result = await onSave({
      customerId, siteId, orderDate,
      deliveryDate: deliveryDate || '',
      remark: remark || '',
      items: validItems,
    });

    if (result.error) {
      setSaving(false);
      setError(result.error);
      return;
    }

    // 주문 저장 성공 후 스테이징된 파일 업로드
    const targetId = result.orderId || existingOrderId;
    if (targetId && stagedFiles.length > 0) {
      await uploadStagedFiles(targetId);
    }

    setSaving(false);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {mode === 'create' && (
            <p className="text-sm text-gray-500 mt-1">직접 입력하거나, 기존 발주서 엑셀을 업로드하여 자동으로 채울 수 있습니다.</p>
          )}
        </div>
        {mode === 'create' && <ExcelUpload onParsed={handleExcelParsed} />}
      </div>

      {/* 기본 정보 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">기본 정보</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>거래처 *</Label>
            <select className={SELECT_CLASS} value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">선택</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>현장 *</Label>
            <select className={SELECT_CLASS} value={siteId} onChange={e => setSiteId(e.target.value)} disabled={!customerId}>
              <option value="">{customerId ? '선택' : '거래처 먼저 선택'}</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.site_name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>주문일</Label>
            <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>납품일</Label>
            <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>
          <div className="col-span-full space-y-2">
            <Label>비고</Label>
            <Textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="비고 사항" rows={2} />
          </div>
        </CardContent>
      </Card>

      {/* 품목 입력 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">품목 목록</CardTitle>
          <div className="text-sm text-gray-500">
            총 수량: <span className="font-bold">{totalQuantity}</span> | 총 면적: <span className="font-bold">{totalArea.toFixed(2)} m²</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end border-b pb-4">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">품명 * {item.product_name && !item.product_id && <span className="text-orange-500">(미매칭)</span>}</Label>
                <select className={`${SELECT_CLASS} h-9 text-sm`} value={item.product_id}
                  onChange={e => { if (e.target.value) selectProduct(idx, e.target.value); else updateItem(idx, 'product_id', ''); }}>
                  <option value="">{item.product_name || '품명 선택'}</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">가로(mm)</Label>
                <Input className="h-9 text-sm" type="number" value={item.width_mm} onChange={e => updateItem(idx, 'width_mm', e.target.value)} placeholder="가로" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">세로(mm)</Label>
                <Input className="h-9 text-sm" type="number" value={item.height_mm} onChange={e => updateItem(idx, 'height_mm', e.target.value)} placeholder="세로" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">수량</Label>
                <Input className="h-9 text-sm" type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} min="1" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">면적(m²)</Label>
                <Input className="h-9 text-sm bg-gray-50" readOnly
                  value={calculateArea(parseInt(item.width_mm) || 0, parseInt(item.height_mm) || 0, parseInt(item.quantity) || 0).toFixed(2)} />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">동</Label>
                <Input className="h-9 text-sm" value={item.location_dong} onChange={e => updateItem(idx, 'location_dong', e.target.value)} placeholder="302" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">라인</Label>
                <Input className="h-9 text-sm" value={item.location_line} onChange={e => updateItem(idx, 'location_line', e.target.value)} placeholder="1" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">층</Label>
                <Input className="h-9 text-sm" value={item.location_floor} onChange={e => updateItem(idx, 'location_floor', e.target.value)} placeholder="1~6" />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">위치/타입</Label>
                <Input className="h-9 text-sm" value={item.location_room} onChange={e => updateItem(idx, 'location_room', e.target.value)} placeholder="거실" />
              </div>
              <div className="col-span-1 flex items-end">
                <Button variant="ghost" size="sm" onClick={() => removeItem(idx)} disabled={items.length <= 1}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={addItem} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> 품목 추가
          </Button>
        </CardContent>
      </Card>

      {/* 참고자료 첨부 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            참고자료 ({stagedFiles.length})
          </CardTitle>
          <div>
            <input
              ref={attachInputRef}
              type="file"
              multiple
              accept="image/*,.xlsx,.xls,.pdf"
              onChange={e => { if (e.target.files) addStagedFiles(e.target.files); e.target.value = ''; }}
              className="hidden"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => attachInputRef.current?.click()} className="gap-1">
              <Paperclip className="h-4 w-4" /> 파일 선택
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addStagedFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-lg p-4 text-center text-sm transition-colors ${
              dragOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400'
            }`}
          >
            {dragOver ? '여기에 놓으세요' : '카톡 캡처, 고객 발주서, 현장 사진 등을 드래그하세요'}
            <p className="text-xs mt-1">이미지(PNG/JPG), 엑셀(XLSX), PDF | 최대 10MB/건, 10개까지</p>
          </div>

          {stagedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {stagedFiles.map((sf, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2 rounded-lg border bg-gray-50">
                  {sf.preview ? (
                    <img src={sf.preview} alt="" className="h-10 w-10 rounded object-cover" />
                  ) : (
                    fileIcon(sf.file.type)
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{sf.file.name}</p>
                    <p className="text-xs text-gray-400">{formatFileSize(sf.file.size)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeStagedFile(idx)}>
                    <X className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? '저장 중...' : mode === 'create' ? '초안 저장' : '수정 저장'}
        </Button>
        <Button variant="outline" onClick={onCancel}>취소</Button>
      </div>
    </div>
  );
}
