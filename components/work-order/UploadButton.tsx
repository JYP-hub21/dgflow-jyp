'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Check, AlertTriangle, Loader2 } from 'lucide-react';

interface PreviewItem {
  work_order_number: string;
  customer_name: string;
  site_name: string;
  item_count: number;
  total_quantity: number;
  is_duplicate: boolean;
}

interface PreviewResult {
  preview: true;
  totalRows: number;
  workOrders: PreviewItem[];
  newCount: number;
  skippedCount: number;
  skippedNumbers: string[];
  errors: string[];
}

interface CreateResult {
  createdCount: number;
  skippedCount: number;
  skippedNumbers: string[];
  errors: string[];
}

export default function WorkOrderUploadButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'select' | 'preview' | 'creating' | 'done'>('select');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileObjRef = useRef<File | null>(null);

  function reset() {
    setStep('select');
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(false);
    fileObjRef.current = null;
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() {
    setOpen(false);
    if (step === 'done') {
      window.location.reload();
    }
    reset();
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    fileObjRef.current = file;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'preview');

      const res = await fetch('/api/work-orders/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '파싱 실패');
        return;
      }

      setPreview(data as PreviewResult);
      setStep('preview');
    } catch {
      setError('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!fileObjRef.current) return;

    setStep('creating');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', fileObjRef.current);
      formData.append('mode', 'create');

      const res = await fetch('/api/work-orders/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '생성 실패');
        setStep('preview');
        return;
      }

      setResult(data as CreateResult);
      setStep('done');
    } catch {
      setError('작업의뢰서 생성 중 오류가 발생했습니다.');
      setStep('preview');
    }
  }

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }} variant="outline">
        <Upload className="mr-2 h-4 w-4" />바이투 업로드
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                바이투 작업의뢰서 업로드
              </h2>

              {/* 파일 선택 단계 */}
              {step === 'select' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    바이투 ERP에서 export한 작업의뢰서 엑셀 파일을 선택하세요.
                    의뢰번호별로 작업의뢰서가 자동 생성됩니다.
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileSelect}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {loading && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />파싱 중...
                    </div>
                  )}
                  {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
              )}

              {/* 미리보기 단계 */}
              {step === 'preview' && preview && (
                <div className="space-y-4">
                  <div className="flex gap-4 text-sm">
                    <span className="px-3 py-1 bg-gray-100 rounded">전체 {preview.totalRows}행</span>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded">신규 {preview.newCount}건</span>
                    {preview.skippedCount > 0 && (
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded">중복 스킵 {preview.skippedCount}건</span>
                    )}
                  </div>

                  <div className="border rounded max-h-[300px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">의뢰번호</th>
                          <th className="text-left p-2">거래처</th>
                          <th className="text-left p-2">현장</th>
                          <th className="text-right p-2">품목수</th>
                          <th className="text-right p-2">총수량</th>
                          <th className="text-center p-2">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.workOrders.map(wo => (
                          <tr key={wo.work_order_number} className={wo.is_duplicate ? 'bg-yellow-50 text-gray-400' : ''}>
                            <td className="p-2 font-medium">{wo.work_order_number}</td>
                            <td className="p-2 max-w-[150px] truncate">{wo.customer_name}</td>
                            <td className="p-2 max-w-[150px] truncate">{wo.site_name}</td>
                            <td className="p-2 text-right">{wo.item_count}</td>
                            <td className="p-2 text-right">{wo.total_quantity.toLocaleString()}</td>
                            <td className="p-2 text-center">
                              {wo.is_duplicate
                                ? <span className="text-yellow-600 text-xs">중복</span>
                                : <span className="text-green-600 text-xs">신규</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {preview.errors.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                      <div className="flex items-center gap-1 text-yellow-700 text-sm font-medium mb-1">
                        <AlertTriangle className="h-4 w-4" />경고 ({preview.errors.length}건)
                      </div>
                      <ul className="text-xs text-yellow-600 space-y-0.5 max-h-[100px] overflow-auto">
                        {preview.errors.map((err, i) => <li key={i}>{err}</li>)}
                      </ul>
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={handleClose}>취소</Button>
                    <Button onClick={handleCreate} disabled={preview.newCount === 0}>
                      {preview.newCount}건 생성
                    </Button>
                  </div>
                </div>
              )}

              {/* 생성 중 */}
              {step === 'creating' && (
                <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" />작업의뢰서 생성 중...
                </div>
              )}

              {/* 완료 */}
              {step === 'done' && result && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">{result.createdCount}건의 작업의뢰서가 생성되었습니다.</span>
                  </div>
                  {result.skippedCount > 0 && (
                    <p className="text-sm text-yellow-600">
                      중복 스킵: {result.skippedNumbers.join(', ')}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={handleClose}>확인</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
