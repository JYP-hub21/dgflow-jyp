'use client';

/**
 * 발주서 업로드 → ERP 업로드용 엑셀 생성
 *
 * ── 이 화면이 하는 일 ──────────────────────────────────────
 * 실제 업무는 `발주서 → 규격정리 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서` 다.
 * 그중 **규격정리와 ERP 업로드 엑셀** 을 대신 만들어 준다.
 * 사람이 판단해야 하는 것은 품명 변환 하나뿐이고, 나머지는 기계적으로 결정된다.
 *
 * ── 설계 원칙 ──────────────────────────────────────────────
 * 발주서는 거래처가 직접 만들어 작성자마다 다르고, 학습되지 않은 양식이 계속 들어온다.
 * 그래서 "완벽하게 읽는다" 를 목표로 하지 않고 세 가지로 받친다.
 *
 *  1. **검산** — 발주서가 적어 둔 계·합계·총계와 우리 계산을 대조해 보여 준다.
 *                맞으면 믿고 넘어가고, 틀리면 어디서 틀렸는지 보인다.
 *  2. **편집** — 미리보기를 직접 고칠 수 있다. 80%만 맞혀도 일이 끝난다.
 *  3. **프로파일** — 한 번 찍어 준 열 지정을 거래처별로 기억해 다음부터 자동 적용한다.
 *
 * 그리고 판단이 필요한 값은 여전히 비운 채 사람에게 올린다 —
 * 추측으로 채운 값이 ERP를 거쳐 작업의뢰서까지 가면 유리를 잘못 자른다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { downloadChunked, uploadChunked, formatBytes } from '@/lib/purchase-order/chunks';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, AlertTriangle, Loader2, Info, FileSpreadsheet, Inbox, Save } from 'lucide-react';
import { chipClass, chipCountClass } from '@/components/ui/chip';
import StepTitle from '@/components/ui/step-title';
import type { SheetInfo } from '@/lib/parser/excel-order';
import { scanOrderSheet, sheetMatrix, type OrderScan, type ScanColumns } from '@/lib/parser/order-scan';
import { readWorkbook } from '@/lib/parser/read-workbook';
import {
  matchProfile, profileFromScan, toOverrides, type FormProfile,
} from '@/lib/parser/form-profile';
import { filterByPackaging, type PackagingGroup, type WorkOrderSourceItem } from '@/lib/work-order/build';
import { buildErpUpload, type ErpUploadBuild, type ErpUploadRow } from '@/lib/erp/upload-sheet';
import {
  applyRule, deriveRule, describeRule, seedFromGroups, toPackagingGroups,
  type ManualPackage, type PackagingRule,
} from '@/lib/erp/packaging-rule';
import PackagingEditor from './PackagingEditor';
import { rowsFromScan, packagesFromScan, packagingEvidenceFromScan } from '@/lib/erp/from-scan';
import { detectPackaging, groupsByDongPublic, groupsByUnit, type PackagingDetection } from '@/lib/erp/packaging-note';
import { hintsFromWorksheet } from '@/lib/erp/sheet-hints';
import { erpUploadBlob, erpUploadOneBlob, erpUploadFileName } from '@/lib/erp/upload-excel';
import { specSheetBlob, specSheetFileName } from '@/lib/erp/spec-sheet';
import { reconcile, reconcileSummary } from '@/lib/erp/reconcile';
import ReconcilePanel from './ReconcilePanel';
import SheetEditor from './SheetEditor';
import ColumnMapper from './ColumnMapper';

interface Meta {
  customer_name: string;
  site_name: string;
  order_date: string;
  delivery_date: string;
}

/**
 * 포장 분리 방식.
 * 포장 단위는 발주서를 주는 사람과 건물 형태에 따라 달라진다.
 * 자동으로 찾은 것을 기본으로 두되, 사람이 바꿀 수 있어야 한다.
 */
type SplitMode = 'sheet-total' | 'detected' | 'by-dong' | 'by-unit' | 'single' | 'manual';

const SPLIT_LABEL: Record<SplitMode, string> = {
  'sheet-total': '발주서 합계 행 단위',
  detected: '발주서 포장 지시문',
  'by-dong': '동별로 나누기',
  'by-unit': '동·호별로 나누기',
  single: '나누지 않기 (전체 한 장)',
  manual: '직접 짜기',
};

/** 발주서 접수함에서 열었을 때 — 그 건의 발주서를 바로 읽고, 결과를 그 건에 저장한다 */
export interface PurchaseOrderSource {
  id: string;
  intake_number: string;
  label: string;
  files: { id: string; file_name: string; mime_type: string; size_bytes: number; storage_prefix: string; chunk_count: number }[];
}

export default function ErpUploadBuilder({ purchaseOrder }: { purchaseOrder?: PurchaseOrderSource } = {}) {
  const router = useRouter();
  const [fileName, setFileName] = useState('');
  /** 저장소에서 발주서를 받는 중 (조각 n/총) */
  const [fetching, setFetching] = useState<{ done: number; total: number } | null>(null);
  const [savingPo, setSavingPo] = useState(false);

  /**
   * 파싱한 워크북을 한 번만 만들어 들고 있는다.
   *
   * 발주서 파일은 144MB 짜리도 있다(KCC 여의도 — 이미지가 잔뜩 들어 있다).
   * 브라우저에서 `XLSX.read` 한 번이 10초 넘게 메인 스레드를 잡아먹어서,
   * 시트를 고를 때마다 다시 읽으면 화면이 통째로 멈춘다("응답 없는 페이지").
   * 그래서 파일을 고를 때 딱 한 번 읽고, 원본 ArrayBuffer 는 바로 버린다.
   */
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [meta, setMeta] = useState<Meta | null>(null);

  const [scan, setScan] = useState<OrderScan | null>(null);
  const [detection, setDetection] = useState<PackagingDetection | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>('sheet-total');

  /** 사람이 찍은 열 지정 — 있으면 자동 판정을 덮어쓴다 */
  const [columnOverrides, setColumnOverrides] = useState<Partial<ScanColumns>>({});
  const [locationOverride, setLocationOverride] = useState<OrderScan['location_source'] | null>(null);

  /** 시트별 수정본. null 이면 자동 생성값을 그대로 쓴다 */
  const [edits, setEdits] = useState<Record<number, ErpUploadRow[]>>({});
  const [openSheet, setOpenSheet] = useState(0);

  /** 열 지정 화면에 보여 줄 실제 글자들 — 시트를 읽을 때 같이 뽑아 둔다 */
  const [headerCells, setHeaderCells] = useState<string[]>([]);
  const [sampleCells, setSampleCells] = useState<string[]>([]);
  const [signature, setSignature] = useState('');

  const [profiles, setProfiles] = useState<FormProfile[]>([]);
  const [appliedProfile, setAppliedProfile] = useState<FormProfile | null>(null);

  /** 사원이 직접 짠 포장. splitMode === 'manual' 일 때만 쓴다 */
  const [manualPackages, setManualPackages] = useState<ManualPackage[]>([]);
  const [rules, setRules] = useState<PackagingRule[]>([]);
  const [ruleNotes, setRuleNotes] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 저장된 양식 프로파일과 포장 방식을 미리 받아 둔다 (권한이 없으면 조용히 비운다)
  useEffect(() => {
    fetch('/api/form-profiles')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(j => setProfiles((j.data ?? []) as FormProfile[]))
      .catch(() => setProfiles([]));

    fetch('/api/packaging-rules')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(j => setRules((j.data ?? []) as PackagingRule[]))
      .catch(() => setRules([]));
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadWorkbook(file.name, () => file.arrayBuffer());
  }

  /** 발주 건에 올라온 발주서를 저장소에서 받아 읽는다. 담당자가 열면 그게 "확인" 이다 */
  async function openPurchaseOrderFile(f: PurchaseOrderSource['files'][number]) {
    if (!purchaseOrder) return;
    fetch(`/api/purchase-orders/${purchaseOrder.id}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'erp_opened', file_id: f.id }),
    }).catch(() => {});
    setFetching({ done: 0, total: f.chunk_count });
    try {
      await loadWorkbook(f.file_name, async () => {
        const blob = await downloadChunked(createClient(), f.storage_prefix, f.chunk_count, f.mime_type,
          (done, total) => setFetching({ done, total }));
        return blob.arrayBuffer();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '발주서를 받지 못했습니다.');
    } finally {
      setFetching(null);
    }
  }

  // 발주서가 하나뿐이면 고를 것 없이 바로 연다
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current || !purchaseOrder || purchaseOrder.files.length !== 1) return;
    openedRef.current = true;
    openPurchaseOrderFile(purchaseOrder.files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder]);

  async function loadWorkbook(name: string, read: () => Promise<ArrayBuffer>) {
    setBusy(true);
    setError('');
    setFileName(name);
    resetResult();
    workbookRef.current = null;
    setHasFile(false);
    setSheets([]);

    let only: string | null = null;
    try {
      // 파싱은 워커에서 한다 — 144MB 짜리 발주서는 13초가 걸려서
      // 메인 스레드에서 읽으면 그 동안 버튼이 하나도 안 눌린다.
      const wb = await readWorkbook(await read());
      workbookRef.current = wb;
      setHasFile(true);
      setSheets(wb.SheetNames.map(name => ({ name, rows: rowCountOf(wb.Sheets[name]) })));
      setActiveSheet('');
      if (wb.SheetNames.length === 1) only = wb.SheetNames[0];
    } catch {
      setError('엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.');
    } finally {
      setBusy(false);
    }
    // 시트가 하나뿐이면 고를 것이 없다 — 바로 변환한다 (흥화·계룡 발주서가 그랬다)
    if (only) run(only, {}, null, true);
  }

  function resetResult() {
    setScan(null);
    setMeta(null);
    setDetection(null);
    setEdits({});
    setColumnOverrides({});
    setLocationOverride(null);
    setAppliedProfile(null);
  }

  /** 시트를 읽는다. 열 지정이 바뀌면 같은 경로로 다시 읽는다. */
  const run = useCallback(
    (
      sheetName: string,
      overrides: Partial<ScanColumns>,
      locationSource: OrderScan['location_source'] | null,
      useProfile: boolean,
    ) => {
      const wb = workbookRef.current;
      if (!wb) return;
      setBusy(true);
      setError('');
      try {
        const ws = wb.Sheets[sheetName];

        // 1) 먼저 자동으로 읽어 거래처·지문을 얻는다
        const probe = scanOrderSheet(ws);
        const matrix = sheetMatrix(ws);
        const sig = signatureFromRow(matrix[probe.header_row - 1]);
        const info = readMeta(ws);

        // 2) 저장된 양식 프로파일이 있으면 적용한다
        const profile = useProfile
          ? matchProfile(profiles, { signature: sig, customer: info.customer_name, site: info.site_name })
          : appliedProfile;

        let merged = scanOrderSheet(ws, {
          ...toOverrides(profile),
          columns: { ...toOverrides(profile).columns, ...overrides },
          location_source: locationSource ?? toOverrides(profile).location_source,
        });
        let usedProfile = profile;

        // 안전장치 — 저장된 프로파일을 적용했는데 품목이 오히려 줄면 그 프로파일은 이 파일에 안 맞는다.
        // 조용히 빈 결과를 내보내면 사원이 "이 발주서는 안 읽히나 보다" 하고 넘어가게 된다.
        const itemsOf = (s: OrderScan) => s.rows.filter(r => r.kind === 'item').length;
        if (profile && itemsOf(merged) === 0 && itemsOf(probe) > 0) {
          merged = scanOrderSheet(ws, { columns: overrides, location_source: locationSource ?? undefined });
          merged.notes.unshift(
            `저장된 양식 "${profile.name}" 을 적용하니 품목이 하나도 읽히지 않아 자동 판정으로 되돌렸습니다. ` +
              '그 양식이 이 발주서와 맞지 않습니다.',
          );
          usedProfile = null;
        }

        // 3) 포장 단위 — 발주서 합계 행이 먼저, 없으면 상단 지시문·동·호
        const parsedRows = rowsFromScan(merged);
        const hints = hintsFromWorksheet(ws);
        const found = detectPackaging(hints.topLines, hints.markerCells, parsedRows);

        const fromSheet = packagesFromScan(merged);
        const mode: SplitMode = fromSheet.length > 0
          ? 'sheet-total'
          : found.groups.length > 0
            ? 'detected'
            : 'single';

        // 열 지정 화면에 보여 줄 글자들도 여기서 한 번에 뽑는다
        // (따로 useMemo 로 두면 그때마다 시트를 다시 훑게 된다)
        const rowText = (excelRow: number) =>
          (matrix[excelRow - 1] ?? []).map(c => String(c ?? '').replace(/\s+/g, ' ').trim());
        const firstItem = merged.rows.find(r => r.kind === 'item')?.excel_row ?? 0;

        setScan(merged);
        setMeta(info);
        setDetection(found);
        setSplitMode(mode);
        setColumnOverrides(overrides);
        setLocationOverride(locationSource);
        setAppliedProfile(usedProfile);
        setActiveSheet(sheetName);
        setHeaderCells(rowText(merged.header_row));
        setSampleCells(firstItem > 0 ? rowText(firstItem) : []);
        setSignature(sig);
        setEdits({});
        setOpenSheet(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ERP 엑셀을 만들지 못했습니다.');
      } finally {
        setBusy(false);
      }
    },
    [hasFile, profiles, appliedProfile],
  );

  const rows: WorkOrderSourceItem[] = useMemo(() => (scan ? rowsFromScan(scan) : []), [scan]);

  const autoBuild: ErpUploadBuild | null = useMemo(() => {
    if (!scan) return null;
    const groups = splitMode === 'manual'
      ? toPackagingGroups(manualPackages)
      : groupsFor(scan, rows, detection, splitMode);
    const source =
      splitMode === 'sheet-total' ? 'instruction'
        : splitMode === 'detected' ? (detection?.source ?? 'fallback-single')
          : splitMode === 'single' ? 'fallback-single'
            : 'derived';
    return buildErpUpload(rows, groups, source, splitMode === 'manual' ? [] : (detection?.dongOrder ?? []));
  }, [scan, rows, detection, splitMode, manualPackages]);

  /** 사람이 고친 행을 반영한 최종 결과 — 다운로드도 이걸 쓴다 */
  const build: ErpUploadBuild | null = useMemo(() => {
    if (!autoBuild) return null;
    const sheetsOut = autoBuild.sheets.map((s, i) => {
      const edited = edits[i];
      if (!edited) return s;
      return { ...s, rows: edited, total_quantity: edited.reduce((n, r) => n + (Number(r.quantity) || 0), 0) };
    });
    return {
      ...autoBuild,
      sheets: sheetsOut,
      total_quantity: sheetsOut.reduce((n, s) => n + s.total_quantity, 0),
    };
  }, [autoBuild, edits]);

  const reconciliation = useMemo(
    () =>
      scan
        ? reconcile(scan, build?.total_quantity ?? null, {
            // 발주서 합계 행으로 나눴을 때만 스캔이 읽은 포장과 화면의 포장이 같다
            includePackages: splitMode === 'sheet-total',
          })
        : null,
    [scan, build, splitMode],
  );

  /**
   * 포장 분리 방식을 바꾼다.
   *
   * 직접 짜기로 들어갈 때는 **빈 화면이 아니라 지금 보고 있는 자동 결과에서 시작한다** —
   * 103행을 처음부터 배정하게 만들면 아무도 쓰지 않는다.
   */
  function changeSplit(mode: SplitMode) {
    if (mode === 'manual' && scan) {
      const from = splitMode === 'manual'
        ? toPackagingGroups(manualPackages)
        : groupsFor(scan, rows, detection, splitMode);
      setManualPackages(seedFromGroups(rows, from, filterByPackaging));
      setRuleNotes([]);
    }
    setSplitMode(mode);
    setEdits({});
    setOpenSheet(0);
  }

  function applyPackagingRule(name: string) {
    const rule = rules.find(r => r.name === name);
    if (!rule) return;
    const result = applyRule(rule, rows);
    setManualPackages(result.packages);
    setRuleNotes(result.notes);
    setSplitMode('manual');
    setEdits({});
    setOpenSheet(0);
  }

  async function savePackagingRule(name: string) {
    const derived = deriveRule(manualPackages, rows);
    const res = await fetch('/api/packaging-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        site_hint: meta?.site_name || null,
        customer_hint: meta?.customer_name || null,
        groups: derived.groups,
        reusable: derived.reusable,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? '저장하지 못했습니다.');

    const saved = (await res.json()).data as PackagingRule;
    setRules(prev => [saved, ...prev.filter(r => r.name !== saved.name)]);
    setRuleNotes(derived.notes);
  }

  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 만든 ERP 엑셀 · 규격정리를 발주 건에 저장한다. 포장(시트)별 행도 같이 보내서
   * 나중에 돌아올 작업의뢰서와 짝을 맞추고 대조하는 기준으로 쓴다.
   */
  async function saveToPurchaseOrder() {
    if (!purchaseOrder || !build || !scan) return;
    if (build.unassigned.length > 0 && !confirm(`포장에 배정되지 않은 품목이 ${build.unassigned.length}건 있습니다. 그대로 저장할까요?`)) return;
    setSavingPo(true);
    try {
      const supabase = createClient();
      const made = [
        { kind: 'erp' as const, blob: erpUploadBlob(build), file_name: erpUploadFileName(meta?.site_name || '', activeSheet) },
        { kind: 'spec' as const, blob: specSheetBlob(scan, build), file_name: specSheetFileName(meta?.site_name || '', activeSheet) },
      ];
      const files = [];
      for (const m of made) {
        const id = crypto.randomUUID();
        const chunkCount = await uploadChunked(supabase, `${purchaseOrder.id}/${id}`, m.blob);
        files.push({ id, kind: m.kind, file_name: m.file_name, mime_type: m.blob.type, size_bytes: m.blob.size, chunk_count: chunkCount });
      }
      const res = await fetch(`/api/purchase-orders/${purchaseOrder.id}/erp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet_name: activeSheet,
          files,
          packages: build.sheets.map(s => ({
            label: s.packaging_label,
            rows: s.rows.map(r => ({ location: r.location, width_mm: r.width_mm, height_mm: r.height_mm, quantity: r.quantity })),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '저장하지 못했습니다.');
      toast.success(`${purchaseOrder.intake_number} 에 저장했습니다 — 포장 ${build.sheets.length}개`);
      router.push(`/purchase-orders/${purchaseOrder.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.');
    } finally {
      setSavingPo(false);
    }
  }

  async function saveProfile(name: string) {
    if (!scan) return;
    const payload = profileFromScan(
      scan, name,
      { signature, customer: meta?.customer_name, site: meta?.site_name },
      reconciliation?.ok ?? false,
    );

    const res = await fetch('/api/form-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, verified: reconciliation?.ok ?? false }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? '저장하지 못했습니다.');

    const saved = (await res.json()).data as FormProfile;
    setProfiles(prev => [saved, ...prev.filter(p => p.name !== saved.name)]);
    setAppliedProfile(saved);
  }

  const reviewCount = build
    ? build.sheets.reduce((s, sh) => s + sh.rows.filter(r => r.review.length > 0).length, 0)
    : 0;

  // 동·호 기반 감지의 경고는 그 방식을 실제로 쓸 때만 의미가 있다
  const activeNotes = splitMode === 'detected' ? (detection?.notes ?? []) : [];

  /**
   * 이 현장에 저장해 둔 포장 방식.
   *
   * "직접 짜기" 안에 숨어 있으면 사원이 있는 줄도 모른다. 포장 분리 자리에서 바로 권한다.
   * 다만 **자동으로 적용하지는 않는다** — 차수마다 포장이 달라지는 현장이 있어
   * 조용히 바뀌면 사원이 알아채지 못한 채 ERP에 올리게 된다.
   */
  const matchingRules = useMemo(() => {
    const site = norm(meta?.site_name);
    const customer = norm(meta?.customer_name);
    if (!site && !customer) return [];
    return rules.filter(r => {
      const s = norm(r.site_hint);
      const c = norm(r.customer_hint);
      return (site && s && (s.includes(site) || site.includes(s)))
        || (customer && c && (c.includes(customer) || customer.includes(c)));
    });
  }, [rules, meta]);

  /** 포장을 무엇을 근거로 나눴는지 한 줄로 */
  const packagingEvidence = !scan
    ? ''
    : splitMode === 'manual'
      ? `사원이 직접 짠 포장 ${manualPackages.filter(p => p.rows.length > 0).length}개`
      : splitMode === 'sheet-total'
        ? packagingEvidenceFromScan(scan)
        : splitMode === 'detected'
          ? (detection?.evidence ?? '')
          : '';

  return (
    <div className="space-y-6">
      {/* 1. 파일 선택 */}
      <Card>
        <CardHeader>
          <StepTitle step={1}>발주서 올리기</StepTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {purchaseOrder && (
            <div className="space-y-2 rounded-xl border border-brand-600/30 bg-brand-50/70 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
                <Inbox className="h-4 w-4" />발주 {purchaseOrder.intake_number} · {purchaseOrder.label}
                <span className="font-normal text-muted-foreground">— 만든 결과를 이 건에 저장합니다</span>
              </p>
              {purchaseOrder.files.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {purchaseOrder.files.map(f => (
                    <button key={f.id} type="button" disabled={busy || !!fetching}
                      onClick={() => openPurchaseOrderFile(f)} className={chipClass(fileName === f.file_name)}>
                      <FileSpreadsheet className="h-4 w-4" />{f.file_name}
                      <span className={chipCountClass(fileName === f.file_name)}>{formatBytes(f.size_bytes)}</span>
                    </button>
                  ))}
                </div>
              )}
              {fetching && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />발주서를 받는 중 ({fetching.done}/{fetching.total})
                </p>
              )}
            </div>
          )}
          <label className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors hover:border-brand-600 hover:bg-brand-50 ${
            fileName ? 'border-brand-600/50 bg-brand-50/50' : 'border-input bg-muted/30'
          }`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-800 transition-colors group-hover:bg-brand-800 group-hover:text-white">
              {fileName ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
            </span>
            <span className="text-[15px] font-semibold text-foreground">
              {fileName || '발주서 엑셀 파일을 선택하세요'}
            </span>
            <span className="text-sm text-muted-foreground">
              {fileName ? '다른 파일을 올리려면 다시 누르세요' : '여기를 눌러 .xlsx 파일을 고릅니다'}
            </span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </label>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm font-medium text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
            </p>
          )}

          {sheets.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">
                차수 시트 선택 <span className="font-normal text-muted-foreground">— 한 번에 한 차수씩 변환합니다</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {sheets.map(s => (
                  <button
                    key={s.name}
                    onClick={() => run(s.name, {}, null, true)}
                    disabled={busy}
                    className={chipClass(activeSheet === s.name)}
                  >
                    {s.name}
                    <span className={chipCountClass(activeSheet === s.name)}>{s.rows}행</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 처리 중…
            </p>
          )}
        </CardContent>
      </Card>

      {scan && build && reconciliation && (
        <>
          {/* 2. 검산 — 제일 먼저 보여 준다 */}
          <ReconcilePanel result={reconciliation} />

          {/* 3. 읽은 열 + 양식 프로파일 */}
          <ColumnMapper
            scan={scan}
            headerCells={headerCells}
            sampleCells={sampleCells}
            columns={{ ...scan.columns, ...columnOverrides }}
            locationSource={scan.location_source}
            appliedProfile={appliedProfile}
            defaultName={[meta?.customer_name, meta?.site_name].filter(Boolean).join(' ') || fileName}
            reconcileOk={reconciliation.ok}
            onChangeColumn={(key, value) =>
              run(activeSheet, { ...columnOverrides, [key]: value }, locationOverride, false)
            }
            onChangeLocationSource={value => run(activeSheet, columnOverrides, value, false)}
            onSaveProfile={saveProfile}
          />

          {/* 4. 결과 */}
          <Card>
            <CardHeader className="flex flex-col gap-3 border-b lg:flex-row lg:items-start lg:justify-between">
              <div>
                <StepTitle step={2}>
                  ERP 업로드 엑셀 <span className="font-normal text-muted-foreground">— 시트 {build.sheets.length}장 · 총 {build.total_quantity.toLocaleString()}장</span>
                </StepTitle>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {[meta?.customer_name, meta?.site_name, activeSheet].filter(Boolean).join(' · ')}
                  {meta?.delivery_date ? ` · 출고 ${meta.delivery_date}` : ''}
                  {' · '}
                  {reconcileSummary(reconciliation)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => save(specSheetBlob(scan, build), specSheetFileName(meta?.site_name || '', activeSheet))}
                  title="발주서 순서(좌) + ERP 순서(우) 2단 구조. 품명만 ERP 품목명으로 바꾸시면 됩니다"
                >
                  <FileSpreadsheet />
                  규격정리 받기
                </Button>
                <Button
                  size="lg"
                  onClick={() => save(erpUploadBlob(build), erpUploadFileName(meta?.site_name || '', activeSheet))}
                  variant={build.unassigned.length > 0 ? 'outline' : 'default'}
                  title={
                    build.unassigned.length > 0
                      ? `포장에 배정되지 않은 품목이 ${build.unassigned.length}건 있습니다 — _미배정 시트로 내려갑니다`
                      : undefined
                  }
                >
                  {build.unassigned.length > 0
                    ? <AlertTriangle className="text-warning" />
                    : <Download />}
                  ERP 엑셀 받기 (시트 {build.sheets.length}장)
                  {build.unassigned.length > 0 && (
                    <span className="text-[color-mix(in_oklch,var(--warning),black_35%)]">· 미배정 {build.unassigned.length}건</span>
                  )}
                </Button>
                {purchaseOrder && (
                  <Button size="lg" onClick={saveToPurchaseOrder} disabled={savingPo}
                    title="ERP 엑셀 · 규격정리를 발주 건에 붙이고, 포장마다 돌아올 작업의뢰서를 기다립니다">
                    {savingPo ? <Loader2 className="animate-spin" /> : <Save />}
                    {purchaseOrder.intake_number} 에 저장
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* 포장 분리 방식 */}
              <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-semibold">포장 분리 방식</p>
                {packagingEvidence && (
                  <p className="rounded-lg border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {splitMode === 'manual' ? '' : '발주서 근거: '}{packagingEvidence}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(['sheet-total', 'detected', 'by-dong', 'by-unit', 'single', 'manual'] as SplitMode[]).map(mode => {
                    const count =
                      mode === 'single' ? 1
                        : mode === 'manual' ? Math.max(manualPackages.length, 1)
                          : groupsFor(scan, rows, detection, mode).length;
                    return (
                      <button
                        key={mode}
                        onClick={() => changeSplit(mode)}
                        disabled={count === 0}
                        className={chipClass(splitMode === mode)}
                      >
                        {SPLIT_LABEL[mode]}
                        {count > 0 && <span className={chipCountClass(splitMode === mode)}>{count}장</span>}
                      </button>
                    );
                  })}
                </div>

                {/* 이 현장에 저장해 둔 포장 방식 — 권하기만 하고 자동 적용하지 않는다 */}
                {matchingRules.length > 0 && splitMode !== 'manual' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs">
                    <span className="text-muted-foreground">이 현장에 저장된 포장 방식:</span>
                    {matchingRules.map(rule => (
                      <button
                        key={rule.name}
                        onClick={() => applyPackagingRule(rule.name)}
                        title={describeRule(rule)}
                        className={chipClass(false, 'h-8 border-brand-600/40 text-brand-800')}
                      >
                        {rule.name}
                        <span className={chipCountClass(false)}>{rule.groups.length}장 적용</span>
                      </button>
                    ))}
                    {matchingRules.some(r => !r.reusable) && (
                      <span className="text-[color-mix(in_oklch,var(--warning),black_35%)]">
                        일부는 행 번호로 저장돼 다른 차수에는 맞지 않을 수 있습니다
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 확인 필요 사항 —
                  지금 쓰지 않는 경로의 경고는 숨긴다.
                  발주서 합계 행으로 포장이 깔끔하게 나뉘었는데 "동·호를 읽지 못했다" 고 띄우면
                  멀쩡한 결과를 의심하게 만든다. */}
              {(reviewCount > 0 || build.review.length > 0 || scan.notes.length > 0 || activeNotes.length > 0) && (
                <div className="space-y-2 rounded-xl border border-warning/40 bg-warning-50 p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    확인이 필요한 항목
                    {reviewCount > 0 && <Badge variant="warning">{reviewCount}행</Badge>}
                  </p>
                  <ul className="space-y-1 text-sm text-amber-900">
                    {[...scan.notes, ...activeNotes, ...build.review].map((w, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-px">•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                    {reviewCount > 0 && (
                      <li className="flex gap-1.5">
                        <span className="mt-px">•</span>
                        <span>
                          아래 표에서 <span className="font-semibold">노란 배지</span>가 붙은 행은 자동으로
                          확정할 수 없는 값입니다. <span className="font-semibold">표에서 바로 고치실 수 있습니다.</span>
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                ERP 양식에는 품명 열이 없습니다. 품명은 ERP 화면에서 지정하세요. 아래 품명은 참고용입니다.
              </p>

              {/* 시트 탭 */}
              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-semibold">
                  포장별 시트 <span className="font-normal text-muted-foreground">— 눌러서 아래에서 확인·수정</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {build.sheets.map((s, i) => {
                    const flagged = s.rows.filter(r => r.review.length > 0).length;
                    const on = openSheet === i;
                    return (
                      <button
                        key={`${s.sheet_name}-${i}`}
                        onClick={() => setOpenSheet(i)}
                        className={chipClass(on)}
                      >
                        {s.packaging_label}
                        <span className={chipCountClass(on)}>{s.rows.length}행</span>
                        {edits[i] && <span className={on ? 'text-white' : 'text-brand-600'} title="수정함">✎</span>}
                        {flagged > 0 && <span className="h-2 w-2 rounded-full bg-warning" title="확인 필요" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {splitMode === 'manual' && (
            <PackagingEditor
              rows={rows}
              packages={manualPackages}
              onChange={next => { setManualPackages(next); setEdits({}); setOpenSheet(0); }}
              onResetToAuto={() => changeSplit(detection && detection.groups.length > 0 ? 'detected' : 'sheet-total')}
              savedRules={rules.map(r => ({
                id: r.id,
                name: r.name,
                reusable: r.reusable,
                description: describeRule(r),
              }))}
              onApplyRule={applyPackagingRule}
              onSaveRule={savePackagingRule}
              defaultRuleName={[meta?.customer_name, meta?.site_name].filter(Boolean).join(' ') || fileName}
              saveNotes={ruleNotes}
            />
          )}

          {build.sheets[openSheet] && autoBuild && (
            <SheetEditor
              sheet={build.sheets[openSheet]}
              original={autoBuild.sheets[openSheet]?.rows ?? []}
              edited={!!edits[openSheet]}
              onChange={next => setEdits(prev => ({ ...prev, [openSheet]: next }))}
              onReset={() =>
                setEdits(prev => {
                  const next = { ...prev };
                  delete next[openSheet];
                  return next;
                })
              }
              onDownload={() =>
                save(
                  erpUploadOneBlob(build, openSheet),
                  erpUploadFileName(meta?.site_name || '', `${activeSheet} ${build.sheets[openSheet].packaging_label}`),
                )
              }
            />
          )}

          {build.unassigned.length > 0 && <UnassignedTable build={build} />}
        </>
      )}
    </div>
  );
}

function UnassignedTable({ build }: { build: ErpUploadBuild }) {
  return (
    <Card className="border-warning/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-amber-900">
          포장에 배정되지 않은 품목 {build.unassigned.length}건
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          버리지 않고 엑셀의 <code>_미배정</code> 시트에 함께 내려갑니다. ERP에 올리기 전에 처리해 주세요.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>위치(원본)</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="w-20 text-right">가로</TableHead>
                <TableHead className="w-20 text-right">세로</TableHead>
                <TableHead className="w-20 text-right">수량</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {build.unassigned.map((u, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">
                    {u.location_text ||
                      [u.location_dong, u.location_line, u.location_type, u.location_floor, u.location_room]
                        .filter(Boolean)
                        .join(' ') || <span className="text-muted-foreground">(위치 불명)</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.product_name}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{u.width_mm}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{u.height_mm}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{u.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/** 고른 분리 방식으로 포장 단위를 정한다. */
function groupsFor(
  scan: OrderScan | null,
  rows: WorkOrderSourceItem[],
  detection: PackagingDetection | null,
  mode: SplitMode,
): PackagingGroup[] {
  if (mode === 'single') return [];
  if (mode === 'sheet-total') return scan ? packagesFromScan(scan) : [];
  if (mode === 'by-dong') return groupsByDongPublic(rows);
  if (mode === 'by-unit') return groupsByUnit(rows);
  return detection?.groups ?? [];
}

/** 시트의 행 수 — sheet_to_json 없이 범위만 보고 센다 (큰 파일에서 훨씬 싸다) */
function rowCountOf(ws: XLSX.WorkSheet | undefined): number {
  if (!ws || !ws['!ref']) return 0;
  const range = XLSX.utils.decode_range(ws['!ref']);
  return Math.max(0, range.e.r - range.s.r + 1);
}

/** 헤더 행의 글자를 이어 붙인 지문 — 이미 읽어 둔 행에서 만든다 */
function signatureFromRow(row: unknown[] | undefined): string {
  return (row ?? [])
    .map(c => String(c ?? '').replace(/s+/g, ''))
    .filter(Boolean)
    .join('|');
}

/** 발주서 상단에서 거래처·현장·날짜를 읽는다 */
function readMeta(ws: XLSX.WorkSheet | undefined): Meta {
  const empty = { customer_name: '', site_name: '', order_date: '', delivery_date: '' };
  if (!ws) return empty;

  const rows = sheetMatrix(ws).slice(0, 12);
  const out = { ...empty };

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const label = String(row[i] ?? '').replace(/\s+/g, '');
      const value = nextValue(row, i);
      if (!value) continue;
      if (!out.site_name && /^(공사명|현장명|현장)$/.test(label)) out.site_name = value;
      if (!out.order_date && /^(발주일|주문일|작성일)$/.test(label)) out.order_date = asDate(value);
      if (!out.delivery_date && /^(출고일|납품일|납기일)$/.test(label)) out.delivery_date = asDate(value);
    }
  }

  // 공사명에 거래처가 붙어 있는 양식이 많다 — "KCC건설 - 여의도 오피스텔 신축공사 현장"
  if (out.site_name.includes('-')) {
    const [head, ...rest] = out.site_name.split('-');
    out.customer_name = head.trim();
    out.site_name = rest.join('-').trim() || out.site_name;
  }

  return out;
}

function nextValue(row: unknown[], from: number): string {
  for (let k = from + 1; k < Math.min(from + 4, row.length); k++) {
    const v = String(row[k] ?? '').trim();
    if (v.length > 1) return v;
  }
  return '';
}

/** 엑셀 시리얼 번호(46283)와 "2026년 07월 07일" 둘 다 받는다 */
function asDate(value: string): string {
  const n = Number(value);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  const m = value.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(value);
  return !isNaN(d.getTime()) && d.getFullYear() > 2000 ? d.toISOString().split('T')[0] : value;
}

/** 거래처·현장 이름 비교용 — 법인 표기와 공백 차이를 지운다 */
function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\(주\)|\(유\)|\(사\)|주식회사/g, '').replace(/\s+/g, '').toLowerCase();
}
