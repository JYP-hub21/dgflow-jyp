'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Download, ChevronDown, ChevronRight, AlertTriangle, Check, Save, History } from 'lucide-react';
import { detectOrder, readOrder, FORMAT_LABEL, type DetectedOrder, type ReadOrder } from '@/lib/parser/detect';
import {
  organize, suggestBundles, unitsOf, availableKinds, bundleName, UNIT_LABEL,
  type Bundle, type UnitKind,
} from '@/lib/spec/organize';
import { buildSpecWorkbook } from '@/lib/spec/excel';

/**
 * 규격정리 — 어떤 발주서든: 올리기 → 시트 → 단위 → 묶음 → 결과 → 엑셀.
 *
 * 묶음은 사람이 정한다. 화면은 (1) 통일 양식의 포장묶음 칸, (2) 같은 현장의 지난 패턴,
 * (3) 단위별 기본 제안 순서로 미리 채워 두고, 담당자는 고치거나 확인만 한다.
 */

const MEMORY_KEY = 'dgflow.spec.patterns';
type Pattern = { site: string; kind: UnitKind; bundles: Bundle[]; savedAt: string };

function loadPatterns(): Pattern[] {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]'); } catch { return []; }
}
function savePattern(p: Pattern) {
  try {
    const rest = loadPatterns().filter(x => !(x.site === p.site && x.kind === p.kind));
    localStorage.setItem(MEMORY_KEY, JSON.stringify([p, ...rest].slice(0, 50)));
  } catch { /* 저장 못 해도 동작에는 지장 없음 */ }
}

function renumber(list: Bundle[]): Bundle[] {
  return list.filter(b => b.units.length > 0).map((b, i) => ({ ...b, id: `G${i + 1}` }));
}

export default function SpecOrganizer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [detected, setDetected] = useState<DetectedOrder | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [read, setRead] = useState<ReadOrder | null>(null);
  const [kind, setKind] = useState<UnitKind>('all');
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [source, setSource] = useState<'form' | 'memory' | 'default' | ''>('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // ── 1. 파일 ─────────────────────────────────────────────────────────
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(''); setRead(null); setBundles([]); setDetected(null); setSource(''); setSaved(false);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const d = detectOrder(buf);
      if (d.sheets.length === 0) {
        setError('품목을 찾지 못했습니다. 품명·가로·세로·수량 머리가 있는 시트가 필요합니다.');
        return;
      }
      setBuffer(buf); setDetected(d); setChosen(d.defaultSheets);
      applySheets(buf, d, d.defaultSheets);
    } catch (err) {
      setError('엑셀 파일을 읽을 수 없습니다. ' + String(err).slice(0, 80));
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function applySheets(buf: ArrayBuffer, d: DetectedOrder, sheets: string[]) {
    if (sheets.length === 0) { setRead(null); setBundles([]); return; }
    const r = readOrder(buf, d.format, sheets);
    setRead(r);
    setKind(r.suggestedKind);
    setBundles(initialBundles(r, r.suggestedKind));
    setOpen(new Set());
  }

  function toggleSheet(name: string) {
    if (!buffer || !detected) return;
    const next = detected.multiSelect
      ? (chosen.includes(name) ? chosen.filter(n => n !== name) : [...chosen, name])
      : [name];
    setChosen(next);
    applySheets(buffer, detected, next);
  }

  // ── 2. 묶음 ─────────────────────────────────────────────────────────
  /** 묶음 초기값: 양식의 포장묶음 칸 → 지난 패턴 → 기본 제안 */
  function initialBundles(r: ReadOrder, k: UnitKind): Bundle[] {
    if (k === 'dong-ho' && r.packingHint.length) {
      const list: Bundle[] = [];
      for (const h of r.packingHint) for (const g of h.groups) list.push({ id: '', units: g.map(ho => `${h.dong}동 ${ho}호`) });
      setSource('form');
      return renumber(list);
    }
    const mem = loadPatterns().find(p => p.site && p.site === r.header.site && p.kind === k);
    if (mem) {
      const units = new Set(unitsOf(r.lines, k));
      const list = mem.bundles.map(b => ({ ...b, units: b.units.filter(u => units.has(u)) }));
      if (list.some(b => b.units.length)) { setSource('memory'); return renumber(list); }
    }
    setSource('default');
    return suggestBundles(r.lines, k);
  }

  function changeKind(k: UnitKind) {
    if (!read) return;
    setKind(k);
    setBundles(initialBundles(read, k));
  }

  const units = useMemo(() => (read ? unitsOf(read.lines, kind) : []), [read, kind]);
  const assignment = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bundles) for (const u of b.units) m.set(u, b.id);
    return m;
  }, [bundles]);

  function assign(unit: string, bundleId: string) {
    setBundles(prev => {
      let list = prev.map(b => ({ ...b, units: b.units.filter(u => u !== unit) }));
      if (bundleId === 'new') list.push({ id: '', units: [unit] });
      else if (bundleId) list = list.map(b => (b.id === bundleId ? { ...b, units: [...b.units, unit] } : b));
      return renumber(list);
    });
    setSource('');
  }
  const eachOwn = () => { if (read) { setBundles(units.map((u, i) => ({ id: `G${i + 1}`, units: [u] }))); setSource(''); } };
  const allOne = () => { setBundles([{ id: 'G1', units: [...units] }]); setSource(''); };
  const bySuggest = () => { if (read) { setBundles(suggestBundles(read.lines, kind)); setSource('default'); } };

  // ── 3. 결과 ─────────────────────────────────────────────────────────
  const { results, unassigned } = useMemo(
    () => (read ? organize(read.lines, bundles, kind) : { results: [], unassigned: [] }),
    [read, bundles, kind],
  );
  const warnings = results.flatMap(r => r.warnings.map(w => ({ id: r.bundle.id, w })));
  const totalRight = results.reduce((s, r) => s + r.blocks.reduce((t, b) => t + b.right.length, 0), 0);
  const unassignedUnits = units.filter(u => !assignment.has(u));

  useEffect(() => { setSaved(false); }, [bundles]);

  function remember() {
    if (!read?.header.site) return;
    savePattern({ site: read.header.site, kind, bundles, savedAt: new Date().toISOString() });
    setSaved(true);
  }

  function download() {
    if (!read) return;
    const wb = buildSpecWorkbook(read.header, results, unassigned);
    const base = fileName.replace(/\.xlsx?$/i, '');
    XLSX.writeFile(wb, `규격정리-${base}.xlsx`);
    if (read.header.site) remember();
  }

  function toggle(id: string) {
    setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const Step = ({ n, title, sub }: { n: number; title: string; sub?: string }) => (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-white">{n}</span>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 1. 파일 · 시트 */}
      <section className="rounded-lg border bg-white p-5">
        <Step n={1} title="발주서 올리기" sub="우미·KCC 양식, 동일유리 사내 양식, 그 밖의 엑셀 모두" />
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />엑셀 고르기</Button>
          {fileName && <span className="flex items-center gap-1.5 text-sm text-gray-700"><FileSpreadsheet className="h-4 w-4 text-gray-400" />{fileName}</span>}
          {detected && <Badge variant="secondary">{FORMAT_LABEL[detected.format]}</Badge>}
        </div>

        {detected && detected.sheets.length > 1 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-gray-500">
              시트 — {detected.multiSelect ? '여러 장을 함께 읽습니다 (누르면 켜고 끕니다)' : '한 장을 고르세요'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {detected.sheets.map(s => {
                const on = chosen.includes(s.name);
                return (
                  <button key={s.name} type="button" onClick={() => toggleSheet(s.name)} title={s.note}
                    className={`rounded-md border px-2.5 py-1 text-xs ${on ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                    {s.name}<span className="ml-1 opacity-60">{s.lines}줄</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {read && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-gray-500">현장</dt><dd className="text-gray-900">{read.header.site || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">발주번호</dt><dd className="text-gray-900">{read.header.orderNo || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">발주일 · 출고일</dt><dd className="text-gray-900">{read.header.orderDate || '-'} · {read.header.dueDate || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">읽은 품목</dt><dd className="text-gray-900 tabular-nums">{read.lines.length}줄 · {[...new Set(read.lines.map(l => l.product))].length}종</dd></div>
            {read.header.note && <div className="col-span-full"><dt className="text-xs text-gray-500">고객 지시 · 내용</dt><dd className="rounded bg-amber-50 px-2 py-1 text-amber-900">{read.header.note}</dd></div>}
            {read.shipOrder && <div className="col-span-full"><dt className="text-xs text-gray-500">출고순서</dt><dd className="text-gray-900">{read.shipOrder}</dd></div>}
          </dl>
        )}
      </section>

      {/* 2. 단위 · 묶음 */}
      {read && read.lines.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <Step n={2} title="묶음 정하기" sub="한 묶음이 작업의뢰서 한 장" />

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">무엇으로 나눌까요</span>
            {availableKinds(read.lines).map(k => (
              <button key={k} type="button" onClick={() => changeKind(k)}
                className={`rounded-md border px-2.5 py-1 text-xs ${kind === k ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                {UNIT_LABEL[k]}
              </button>
            ))}
            <span className="ml-auto flex gap-1.5">
              <button type="button" onClick={bySuggest} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">기본 제안</button>
              <button type="button" onClick={eachOwn} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">단위마다 따로</button>
              <button type="button" onClick={allOne} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">전부 하나로</button>
            </span>
          </div>

          {source === 'form' && <p className="mb-3 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><Check className="h-3.5 w-3.5" />양식의 <b>포장묶음</b> 칸을 읽어 채웠습니다. 확인만 하세요.</p>}
          {source === 'memory' && <p className="mb-3 flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"><History className="h-3.5 w-3.5" />같은 현장의 <b>지난 패턴</b>을 적용했습니다. 이번 차수와 다르면 고치세요.</p>}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="px-3 py-2 text-left font-medium">단위 ({UNIT_LABEL[kind]})</th><th className="px-3 py-2 text-right font-medium">줄</th><th className="px-3 py-2 text-right font-medium">수량</th><th className="px-3 py-2 text-left font-medium">묶음</th></tr>
              </thead>
              <tbody className="divide-y">
                {units.map(u => {
                  const mine = read.lines.filter(l => {
                    const key = kind === 'all' ? '전체' : kind === 'sheet' ? l.sheet : kind === 'floor' ? l.floor : kind === 'zone' ? l.zone
                      : kind === 'dong' ? `${l.dong}동` : kind === 'dong-ho' ? `${l.dong}동 ${l.ho ?? '?'}호` : `${l.dong}동 ${l.line ?? '?'}라인`;
                    return (key ?? '미상') === u;
                  });
                  const cur = assignment.get(u) ?? '';
                  return (
                    <tr key={u} className={cur ? '' : 'bg-red-50/60'}>
                      <td className="px-3 py-1.5 text-gray-900">{u}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{mine.length}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{mine.reduce((s, l) => s + l.qty, 0)}</td>
                      <td className="px-3 py-1.5">
                        <select value={cur} onChange={e => assign(u, e.target.value)} className="h-7 rounded border bg-white px-1.5 text-xs">
                          <option value="">(미배정)</option>
                          {bundles.map(b => <option key={b.id} value={b.id}>{b.id} · {bundleName(b, kind)}</option>)}
                          <option value="new">+ 새 묶음</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unassignedUnits.length > 0 && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />묶음이 없는 단위 {unassignedUnits.length}개: {unassignedUnits.slice(0, 6).join(', ')}{unassignedUnits.length > 6 ? ' …' : ''}
            </p>
          )}
        </section>
      )}

      {/* 3. 결과 */}
      {results.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Step n={3} title="규격정리 결과" sub={`${read!.lines.length}줄 → ${totalRight}줄 · 묶음 ${results.length}개`} />
            <div className="flex gap-2">
              {read?.header.site && (
                <Button type="button" variant="outline" onClick={remember} disabled={saved}>
                  <Save className="mr-2 h-4 w-4" />{saved ? '이 현장 패턴 기억됨' : '이 현장 패턴 기억'}
                </Button>
              )}
              <Button type="button" onClick={download} disabled={unassignedUnits.length > 0}>
                <Download className="mr-2 h-4 w-4" />규격정리 엑셀 받기
              </Button>
            </div>
          </div>

          {warnings.length > 0 ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="mb-1 font-medium"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />검산 {warnings.length}건 — 고객 파일에 짝이 빠진 줄입니다. 지어내지 않았으니 담당자가 확인하세요.</p>
              {warnings.map((w, i) => <p key={i} className="font-mono text-xs">{w.id}  {w.w}</p>)}
            </div>
          ) : (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><Check className="mr-1 inline h-3.5 w-3.5" />검산 통과 — 外/內 짝이 빠진 줄이 없습니다.</p>
          )}

          <ul className="divide-y rounded-md border">
            {results.map(r => {
              const isOpen = open.has(r.bundle.id);
              const rightCount = r.blocks.reduce((s, b) => s + b.right.length, 0);
              return (
                <li key={r.bundle.id}>
                  <button type="button" onClick={() => toggle(r.bundle.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    <span className="font-mono text-xs text-gray-500">{r.bundle.id}</span>
                    <span className="text-sm font-medium text-gray-900">{r.name}</span>
                    {r.warnings.length > 0 && <Badge variant="destructive" className="text-[11px]">검산 {r.warnings.length}</Badge>}
                    <span className="ml-auto text-xs text-gray-500 tabular-nums">{r.lines.length}줄 → {rightCount}줄 · {r.totalQty.toLocaleString()}매</span>
                  </button>
                  {isOpen && (
                    <div className="border-t bg-gray-50/60 px-3 py-3">
                      {r.blocks.map(blk => (
                        <div key={blk.product} className="mb-3 last:mb-0">
                          <p className="mb-1 text-xs font-semibold text-gray-700">{blk.product} <span className="font-normal text-gray-500">— {blk.left.length}줄 → {blk.right.length}줄</span></p>
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-500"><th className="py-1 text-left font-medium">위치</th><th className="text-right font-medium">가로</th><th className="text-right font-medium">세로</th><th className="text-right font-medium">수량</th><th className="text-right font-medium">평</th><th className="text-right font-medium">M2</th></tr></thead>
                            <tbody>
                              {blk.right.map((x, i) => (
                                <tr key={i} className="border-t border-gray-200 text-gray-800">
                                  <td className="py-1">{x.loc}</td>
                                  <td className="text-right tabular-nums">{x.w.toLocaleString()}</td>
                                  <td className="text-right tabular-nums">{x.h.toLocaleString()}</td>
                                  <td className="text-right font-medium tabular-nums">{x.qty}</td>
                                  <td className="text-right tabular-nums">{x.jae.toFixed(2)}</td>
                                  <td className="text-right tabular-nums">{x.m2.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
