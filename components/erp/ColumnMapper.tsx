'use client';

/**
 * 열 지정 + 양식 프로파일 저장
 *
 * 자동 판정이 늘 성공할 수는 없다. 그래서 사원이 "이 열이 위치예요" 를 직접 찍을 수 있게 하고,
 * 그 지정을 거래처별로 저장해 다음 발주서부터 자동 적용한다.
 *
 * 이게 "어떤 발주서가 올지 모른다" 는 문제에 대한 답이다 —
 * 만능 파서를 만드는 대신, 한 번 가르치는 비용을 한 번만 내게 한다.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NativeSelect from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { Columns3, Save, Check, Loader2 } from 'lucide-react';
import type { OrderScan, ScanColumns } from '@/lib/parser/order-scan';
import type { FormProfile } from '@/lib/parser/form-profile';

/** 사람이 고칠 수 있는 열들 — 나머지(두께·평수)는 ERP 출력에 쓰이지 않는다 */
const FIELDS: { key: keyof ScanColumns; label: string; hint?: string }[] = [
  { key: 'product_name', label: '제품명', hint: '품명 블록을 나누는 기준' },
  { key: 'width_mm', label: '가로' },
  { key: 'height_mm', label: '세로' },
  { key: 'quantity', label: '수량' },
  { key: 'location', label: '위치' },
  { key: 'remark', label: '비고', hint: '위치가 비고 칸에 적힌 양식이 있습니다' },
];

const LOCATION_SOURCE_LABEL: Record<OrderScan['location_source'], string> = {
  'location-column': '위치 열에서 읽기',
  'remark-column': '비고 열에서 읽기',
  both: '위치 열 + 비고 열 함께 읽기',
  none: '위치 없음',
};

export interface ColumnMapperProps {
  scan: OrderScan;
  /** 헤더 행의 실제 글자 — 어느 열이 무엇인지 사람이 알아볼 수 있게 보여 준다 */
  headerCells: string[];
  /** 데이터 첫 행 — 값 예시 */
  sampleCells: string[];
  columns: Partial<ScanColumns>;
  locationSource: OrderScan['location_source'];
  appliedProfile: FormProfile | null;
  defaultName: string;
  reconcileOk: boolean;
  onChangeColumn: (key: keyof ScanColumns, value: number | null) => void;
  onChangeLocationSource: (value: OrderScan['location_source']) => void;
  onSaveProfile: (name: string) => Promise<void>;
}

export default function ColumnMapper({
  scan, headerCells, sampleCells, columns, locationSource,
  appliedProfile, defaultName, reconcileOk,
  onChangeColumn, onChangeLocationSource, onSaveProfile,
}: ColumnMapperProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const columnCount = Math.max(headerCells.length, sampleCells.length);
  const options = Array.from({ length: columnCount }, (_, i) => i);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSaveProfile(name.trim() || defaultName);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Columns3 className="h-4 w-4 text-muted-foreground" />
            읽은 열
            <span className="text-xs font-normal text-muted-foreground">
              헤더 {scan.header_row}행 · {LOCATION_SOURCE_LABEL[locationSource]}
            </span>
            {appliedProfile && (
              <Badge variant="info" title="저장된 양식 프로파일을 적용했습니다">
                {appliedProfile.name}
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setOpen(v => !v)}>
            {open ? '접기' : '열이 잘못 읽혔나요?'}
          </Button>
        </div>
        {!open && (
          <p className="text-xs text-muted-foreground">
            {FIELDS.filter(f => columns[f.key] !== null && columns[f.key] !== undefined)
              .map(f => `${f.label}=${columnLetter(columns[f.key] as number)}`)
              .join(' · ')}
          </p>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            열 이름이 실제 내용과 다른 발주서가 있습니다. 직접 골라 주시면 결과가 바로 다시 계산됩니다.
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map(field => (
              <label key={field.key} className="space-y-1">
                <span className="block text-[13px] font-semibold">
                  {field.label}
                  {field.hint && (
                    <span className="ml-1 font-normal text-muted-foreground">— {field.hint}</span>
                  )}
                </span>
                <NativeSelect
                  value={columns[field.key] === null || columns[field.key] === undefined ? '' : String(columns[field.key])}
                  onChange={e =>
                    onChangeColumn(field.key, e.target.value === '' ? null : Number(e.target.value))
                  }
                >
                  <option value="">(없음)</option>
                  {options.map(i => (
                    <option key={i} value={i}>
                      {columnLetter(i)} · {truncate(headerCells[i] || sampleCells[i] || '(빈 열)')}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ))}

            <label className="space-y-1">
              <span className="block text-[13px] font-semibold">위치를 어디서 읽을지</span>
              <NativeSelect
                value={locationSource}
                onChange={e => onChangeLocationSource(e.target.value as OrderScan['location_source'])}
              >
                {(Object.keys(LOCATION_SOURCE_LABEL) as OrderScan['location_source'][]).map(k => (
                  <option key={k} value={k}>{LOCATION_SOURCE_LABEL[k]}</option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {/* 저장 — 다음 발주서부터 자동 적용된다 */}
          <div className="space-y-2 rounded-xl border bg-muted/40 p-4">
            <p className="text-sm font-semibold">이 거래처 양식으로 저장</p>
            <p className="text-xs text-muted-foreground">
              저장해 두면 같은 거래처의 다음 발주서는 이 지정대로 자동으로 읽습니다.
              {reconcileOk
                ? ' 지금 검산이 전부 맞으므로 저장하기 좋은 상태입니다.'
                : ' 검산이 맞지 않는 상태입니다 — 열을 먼저 맞춰 주세요.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="예) KCC건설 여의도 오피스텔"
                className="max-w-sm"
              />
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="animate-spin" />
                ) : saved ? (
                  <Check />
                ) : (
                  <Save />
                )}
                {saved ? '저장했습니다' : '양식 저장'}
              </Button>
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** 0 → A, 25 → Z, 26 → AA — 엑셀 열 이름으로 보여 줘야 사원이 알아본다 */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const truncate = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n)}…` : s);
