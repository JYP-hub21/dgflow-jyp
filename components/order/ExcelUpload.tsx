'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { parseOrderExcel, type ParsedOrderItem, type ParsedOrderMeta } from '@/lib/parser/excel-order';

interface ExcelUploadProps {
  onParsed: (items: ParsedOrderItem[], meta: ParsedOrderMeta) => void;
}

export default function ExcelUpload({ onParsed }: ExcelUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setStatus(null);

    try {
      const buffer = await file.arrayBuffer();
      const result = parseOrderExcel(buffer);

      if (result.items.length === 0) {
        setStatus({
          type: 'error',
          message: result.warnings.join(' ') || '품목을 파싱할 수 없습니다.',
        });
        return;
      }

      console.log('[ExcelUpload] meta:', result.meta);
      console.log('[ExcelUpload] items:', result.items.length, result.items.slice(0, 2));

      onParsed(result.items, result.meta);

      const metaInfo = [
        result.meta.site_name && `현장: ${result.meta.site_name}`,
        result.meta.order_date && `주문일: ${result.meta.order_date}`,
      ].filter(Boolean).join(', ');
      const warningMsg = result.warnings.length > 0 ? ` (${result.warnings.join(', ')})` : '';
      setStatus({
        type: result.warnings.length > 0 ? 'warning' : 'success',
        message: `"${result.sheetName}" 시트에서 ${result.items.length}건 품목을 가져왔습니다. ${metaInfo}${warningMsg}`,
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: '엑셀 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.',
      });
    }

    // 같은 파일 재업로드 가능하도록 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        className="gap-2"
      >
        <Upload className="h-4 w-4" />
        기존 엑셀 발주서 업로드
      </Button>

      {fileName && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FileSpreadsheet className="h-4 w-4" />
          {fileName}
        </div>
      )}

      {status && (
        <div className={`flex items-start gap-2 text-sm p-2 rounded ${
          status.type === 'success' ? 'bg-green-50 text-green-700' :
          status.type === 'warning' ? 'bg-yellow-50 text-yellow-700' :
          'bg-red-50 text-red-700'
        }`}>
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {status.message}
        </div>
      )}
    </div>
  );
}
