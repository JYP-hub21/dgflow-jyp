'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, AlertCircle, Check, X } from 'lucide-react';
import {
  parseOrderExcel,
  listOrderSheets,
  type ParsedOrderItem,
  type ParsedOrderMeta,
  type SheetInfo,
} from '@/lib/parser/excel-order';

interface ExcelUploadProps {
  onParsed: (items: ParsedOrderItem[], meta: ParsedOrderMeta) => void;
}

export default function ExcelUpload({ onParsed }: ExcelUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setStatus(null);
    setSheets([]);
    setPicked([]);

    try {
      const buf = await file.arrayBuffer();
      const found = listOrderSheets(buf);

      if (found.length === 0) {
        setStatus({ type: 'error', message: '시트를 찾을 수 없습니다.' });
        return;
      }

      setBuffer(buf);
      setSheets(found);

      // 시트가 한 장뿐이면 고를 것이 없으니 바로 가져온다
      if (found.length === 1) {
        applySheets(buf, [found[0].name]);
        return;
      }

      // 여러 장이면 사람이 고르게 한다. 품목이 가장 많이 읽힌 시트만 미리 체크해 둔다.
      const recommended = found.filter(s => s.recommended).map(s => s.name);
      setPicked(recommended);
      setStatus({
        type: 'warning',
        message: `시트가 ${found.length}장입니다. 가져올 시트를 고른 뒤 아래 버튼을 눌러 주세요.`,
      });
    } catch {
      setStatus({ type: 'error', message: '엑셀 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.' });
    }

    // 같은 파일 재업로드 가능하도록 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function applySheets(buf: ArrayBuffer, names: string[]) {
    const result = parseOrderExcel(buf, { sheets: names });

    if (result.items.length === 0) {
      setStatus({
        type: 'error',
        message: result.warnings.join(' ') || '고른 시트에서 품목을 찾지 못했습니다. 다른 시트를 골라 보세요.',
      });
      return;
    }

    onParsed(result.items, result.meta);

    const metaInfo = [
      result.meta.site_name && `현장: ${result.meta.site_name}`,
      result.meta.order_date && `주문일: ${result.meta.order_date}`,
    ].filter(Boolean).join(', ');
    const warningMsg = result.warnings.length > 0 ? ` (${result.warnings.join(', ')})` : '';

    setStatus({
      type: result.warnings.length > 0 ? 'warning' : 'success',
      message: `${names.length === 1 ? `"${names[0]}" 시트` : `시트 ${names.length}장(${names.join(', ')})`}에서 품목 ${result.items.length}건을 가져왔습니다. ${metaInfo}${warningMsg}`,
    });
  }

  function toggleSheet(name: string) {
    setPicked(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
  }

  function reset() {
    setSheets([]);
    setPicked([]);
    setBuffer(null);
    setFileName('');
    setStatus(null);
  }

  const multiSheet = sheets.length > 1;

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
        <Upload className="h-4 w-4" />
        기존 엑셀 발주서 업로드
      </Button>

      {fileName && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FileSpreadsheet className="h-4 w-4" />
          {fileName}
          {sheets.length > 0 && <span className="text-gray-400">· 시트 {sheets.length}장</span>}
        </div>
      )}

      {/* 시트 고르기 — 여러 장일 때만 */}
      {multiSheet && buffer && (
        <div className="rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div>
              <p className="text-sm font-medium text-gray-900">가져올 시트 고르기</p>
              <p className="text-xs text-gray-500">여러 장을 고르면 품목을 이어 붙입니다.</p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPicked(sheets.filter(s => s.items > 0).map(s => s.name))}
                className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                품목 있는 시트 전체
              </button>
              <button
                type="button"
                onClick={() => setPicked([])}
                className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                선택 해제
              </button>
            </div>
          </div>

          <ul className="max-h-64 divide-y overflow-auto">
            {sheets.map(sheet => {
              const on = picked.includes(sheet.name);
              const empty = sheet.items === 0;
              return (
                <li key={sheet.name}>
                  <button
                    type="button"
                    onClick={() => toggleSheet(sheet.name)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 ${on ? 'bg-blue-50/60' : ''}`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{sheet.name}</span>
                    {sheet.recommended && (
                      <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">
                        품목 가장 많음
                      </span>
                    )}
                    <span className={`shrink-0 text-xs tabular-nums ${empty ? 'text-gray-400' : 'text-gray-600'}`}>
                      {empty ? '품목 없음' : `품목 ${sheet.items}건`}
                      <span className="text-gray-400"> · {sheet.rows}행</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Button type="button" size="sm" disabled={picked.length === 0} onClick={() => applySheets(buffer, picked)}>
              {picked.length === 0 ? '시트를 고르세요' : `${picked.length}장 가져오기`}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              <X className="mr-1 h-3.5 w-3.5" />
              취소
            </Button>
            <span className="text-xs text-gray-500">
              다시 고르면 앞서 가져온 품목을 덮어씁니다.
            </span>
          </div>
        </div>
      )}

      {status && (
        <div
          className={`flex items-start gap-2 rounded p-2 text-sm ${
            status.type === 'success'
              ? 'bg-green-50 text-green-700'
              : status.type === 'warning'
              ? 'bg-yellow-50 text-yellow-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {status.message}
        </div>
      )}
    </div>
  );
}
