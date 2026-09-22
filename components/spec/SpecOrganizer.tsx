'use client';

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Download, ChevronDown, ChevronRight, AlertTriangle, Check, Plus, Trash2 } from 'lucide-react';
import { detectOrder, readOrder, FORMAT_LABEL, type DetectedOrder, type ReadOrder } from '@/lib/parser/detect';
import {
  organize, suggestBundles, availableKinds, bundleName, unitOf, rowsToRanges, rangesToUnits, UNIT_LABEL,
  type Bundle, type UnitKind,
} from '@/lib/spec/organize';
import { buildSpecWorkbook } from '@/lib/spec/excel';

/**
 * 규격정리 — 어떤 발주서든: 올리기 → 시트 → 묶음 → 결과 → 엑셀.
 *
 * 묶음(작업의뢰서 한 장)은 매번 사람이 발주서를 보고 정한다. 기본은 "행 범위" 다 —
 * "15~135행, 200~240행" 처럼 자르면 그 안에서 같은 품명·같은 규격끼리 합쳐진다.
 * 시스템은 지난 패턴이나 추측으로 묶음을 미리 채우지 않는다. 사람이 자르고, 기계가 합친다.
 * 동·호나 층으로 나누는 방식은 사람이 골랐을 때만 쓴다.
 */

const COLORS = ['border-l-blue-400', 'border-l-emerald-400', 'border-l-amber-400', 'border-l-violet-400', 'border-l-rose-400', 'border-l-cyan-400', 'border-l-lime-500', 'border-l-orange-400'];
const DOTS = ['bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-violet-400', 'bg-rose-400', 'bg-cyan-400', 'bg-lime-500', 'bg-orange-400'];

const renumber = (list: Bundle[]) => list.map((b, i) => ({ ...b, id: `G${i + 1}` }));

export default function SpecOrganizer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [detected, setDetected] = useState<DetectedOrder | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [read, setRead] = useState<ReadOrder | null>(null);
  const [kind, setKind] = useState<UnitKind>('rows');
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [current, setCurrent] = useState('G1');          // 행 표에서 클릭하면 들어갈 묶음
  const [pendingStart, setPendingStart] = useState<{ sheet: string; row: number } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  // ── 1. 파일 ─────────────────────────────────────────────────────────
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(''); setRead(null); setBundles([]); setDetected(null); setPendingStart(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const d = detectOrder(buf);
      if (d.sheets.length === 0) { setError('품목을 찾지 못했습니다. 품명·가로·세로·수량 머리가 있는 시트가 필요합니다.'); return; }
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
    // 언제나 행 범위, 빈 묶음 하나로 시작한다 — 어디서 자를지는 사람이 발주서를 보고 정한다
    setKind('rows');
    setBundles(initialBundles(r, 'rows'));
    setCurrent('G1'); setPendingStart(null); setOpen(new Set());
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
  /** 행 범위는 빈 묶음 하나로 시작(사람이 자른다). 다른 단위는 사람이 골랐을 때만 단위별로 제안 */
  function initialBundles(r: ReadOrder, k: UnitKind): Bundle[] {
    if (k === 'rows') return [{ id: 'G1', units: [] }];
    return suggestBundles(r.lines, k);
  }

  function changeKind(k: UnitKind) {
    if (!read) return;
    setKind(k); setBundles(initialBundles(read, k)); setCurrent('G1'); setPendingStart(null);
  }

  const units = useMemo(() => (read ? unitsOf(read.lines, kind) : []), [read, kind]);
  const assignment = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bundles) for (const u of b.units) m.set(u, b.id);
    return m;
  }, [bundles]);
  const colorOf = (id: string) => { const i = bundles.findIndex(b => b.id === id); return i < 0 ? '' : COLORS[i % COLORS.length]; };
  const dotOf = (id: string) => { const i = bundles.findIndex(b => b.id === id); return i < 0 ? 'bg-gray-300' : DOTS[i % DOTS.length]; };

  /** 단위들을 한 묶음으로 옮긴다 (다른 묶음에서는 뺀다) */
  function moveUnits(unitList: string[], bundleId: string) {
    setBundles(prev => {
      const set = new Set(unitList);
      let list = prev.map(b => ({ ...b, units: b.units.filter(u => !set.has(u)) }));
      if (bundleId === 'new') list.push({ id: '', units: unitList });
      else if (bundleId) list = list.map(b => (b.id === bundleId ? { ...b, units: [...b.units, ...unitList] } : b));
      return renumber(list);
    });
  }
  const addBundle = () => { setBundles(prev => renumber([...prev, { id: '', units: [] }])); setCurrent(`G${bundles.length + 1}`); };
  const removeBundle = (id: string) => setBundles(prev => renumber(prev.filter(b => b.id !== id)));
  const eachOwn = () => setBundles(units.map((u, i) => ({ id: `G${i + 1}`, units: [u] })));
  const allOne = () => setBundles([{ id: 'G1', units: [...units] }]);
  const bySuggest = () => { if (read) setBundles(suggestBundles(read.lines, kind)); };

  /** 행 범위 글자를 묶음에 적용 */
  function applyRangeText(id: string, text: string) {
    if (!read) return;
    const b = bundles.find(x => x.id === id);
    if (!b) return;
    const next = rangesToUnits(text, read.lines);
    setBundles(prev => renumber(prev.map(x => {
      if (x.id === id) return { ...x, units: next };
      return { ...x, units: x.units.filter(u => !next.includes(u)) };   // 겹치면 다른 묶음에서 뺀다
    })));
  }

  /** 행 표 클릭: 첫 클릭 = 시작, 둘째 클릭 = 끝 → 그 사이 행을 현재 묶음으로 */
  function clickRow(sheet: string, row: number) {
    if (!read) return;
    if (!pendingStart || pendingStart.sheet !== sheet) { setPendingStart({ sheet, row }); return; }
    const lo = Math.min(pendingStart.row, row), hi = Math.max(pendingStart.row, row);
    const unitList = read.lines.filter(l => (l.sheet ?? '') === sheet && l.row >= lo && l.row <= hi).map(l => unitOf(l, 'rows'));
    moveUnits(unitList, bundles.some(b => b.id === current) ? current : 'new');
    setPendingStart(null);
  }

  // ── 3. 결과 ─────────────────────────────────────────────────────────
  const { results, unassigned } = useMemo(
    () => (read ? organize(read.lines, bundles, kind) : { results: [], unassigned: [] }),
    [read, bundles, kind],
  );
  const warnings = results.flatMap(r => r.warnings.map(w => ({ id: r.bundle.id, w })));
  const totalRight = results.reduce((s, r) => s + r.blocks.reduce((t, b) => t + b.right.length, 0), 0);
  const unassignedUnits = units.filter(u => !assignment.has(u));
  const multiSheet = read ? new Set(read.lines.map(l => l.sheet)).size > 1 : false;

  function download() {
    if (!read) return;
    const wb = buildSpecWorkbook(read.header, results.filter(r => r.lines.length), unassigned);
    XLSX.writeFile(wb, `규격정리-${fileName.replace(/\.xlsx?$/i, '')}.xlsx`);
  }
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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
            <p className="mb-2 text-xs font-medium text-gray-500">시트 — {detected.multiSelect ? '여러 장을 함께 읽습니다 (누르면 켜고 끕니다)' : '한 장을 고르세요'}</p>
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
          </dl>
        )}
      </section>

      {/* 2. 묶음 */}
      {read && read.lines.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <Step n={2} title="묶음 정하기" sub="한 묶음이 작업의뢰서 한 장 · 묶음 안에서 같은 품명·같은 규격끼리 합칩니다" />

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">무엇으로 나눌까요</span>
            {availableKinds(read.lines).map(k => (
              <button key={k} type="button" onClick={() => changeKind(k)}
                className={`rounded-md border px-2.5 py-1 text-xs ${kind === k ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                {UNIT_LABEL[k]}
              </button>
            ))}
            <span className="ml-auto flex gap-1.5">
              {kind !== 'rows' && <button type="button" onClick={bySuggest} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">기본 제안</button>}
              {kind !== 'rows' && <button type="button" onClick={eachOwn} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">단위마다 따로</button>}
              <button type="button" onClick={allOne} className="rounded border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">전부 하나로</button>
            </span>
          </div>

          {kind === 'rows' ? (
            <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
              {/* 묶음 목록 — 범위 글자로 */}
              <div className="space-y-2">
                <p className="text-xs text-gray-500">묶음마다 행 범위를 적으세요. <span className="font-mono">15~135, 200~240</span> 처럼 여러 범위도 됩니다.
                  {multiSheet && <> 시트가 여럿이면 <span className="font-mono">7차: 15~135</span> 처럼 앞에 시트 이름을.</>}</p>
                {bundles.map((b, i) => {
                  const r = results.find(x => x.bundle.id === b.id);
                  return (
                    <div key={b.id} className={`rounded-md border border-l-4 p-2.5 ${COLORS[i % COLORS.length]} ${current === b.id ? 'ring-2 ring-gray-900/20' : ''}`}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <button type="button" onClick={() => setCurrent(b.id)} title="행 표에서 클릭하면 이 묶음으로 들어갑니다"
                          className={`rounded px-1.5 py-0.5 font-mono text-xs ${current === b.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{b.id}</button>
                        <span className="text-xs text-gray-500 tabular-nums">{r ? `${r.lines.length}줄 → ${r.blocks.reduce((s, x) => s + x.right.length, 0)}줄 · ${r.totalQty.toLocaleString()}매` : ''}</span>
                        <button type="button" onClick={() => removeBundle(b.id)} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" title="묶음 삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <input
                        key={`${b.id}-${b.units.length}`}
                        defaultValue={b.units.length ? rowsToRanges(b.units, read.lines).replace(/행/g, '') : ''}
                        onBlur={e => applyRangeText(b.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        placeholder="예: 15~135"
                        className={`h-8 w-full rounded border px-2 font-mono text-sm ${b.units.length === 0 ? 'border-red-300' : ''}`}
                      />
                    </div>
                  );
                })}
                <button type="button" onClick={addBundle} className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs text-gray-600 hover:bg-gray-50"><Plus className="h-3.5 w-3.5" />묶음 추가</button>
                {unassignedUnits.length > 0 && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />어느 묶음에도 없는 줄 {unassignedUnits.length}개 — 오른쪽 표에서 붉게 표시</p>
                )}
              </div>

              {/* 행 표 — 클릭 두 번으로 범위 */}
              <div>
                <p className="mb-1.5 text-xs text-gray-500">
                  {pendingStart
                    ? <span className="text-gray-900">시작 <b>{pendingStart.row}행</b> — 끝 행을 누르면 <b>{current}</b>에 들어갑니다</span>
                    : <>표에서 <b>시작 행</b>을 누르고 <b>끝 행</b>을 누르면 그 범위가 <b>{current}</b>에 들어갑니다. 행 번호는 엑셀과 같습니다.</>}
                </p>
                <div className="max-h-[520px] overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500">
                      <tr><th className="px-2 py-1.5 text-right font-medium">행</th>{multiSheet && <th className="px-2 py-1.5 text-left font-medium">시트</th>}<th className="px-2 py-1.5 text-left font-medium">품명</th><th className="px-2 py-1.5 text-right font-medium">가로×세로</th><th className="px-2 py-1.5 text-right font-medium">수량</th><th className="px-2 py-1.5 text-left font-medium">위치</th><th className="px-2 py-1.5 text-left font-medium">묶음</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {read.lines.map(l => {
                        const u = unitOf(l, 'rows');
                        const bid = assignment.get(u);
                        const isStart = pendingStart && pendingStart.sheet === (l.sheet ?? '') && pendingStart.row === l.row;
                        return (
                          <tr key={u} onClick={() => clickRow(l.sheet ?? '', l.row)}
                            className={`cursor-pointer border-l-4 ${bid ? colorOf(bid) : 'border-l-red-300 bg-red-50/60'} ${isStart ? 'bg-yellow-100' : 'hover:bg-gray-50'}`}>
                            <td className="px-2 py-1 text-right font-mono text-gray-500 tabular-nums">{l.row}</td>
                            {multiSheet && <td className="px-2 py-1 text-gray-500">{l.sheet}</td>}
                            <td className="max-w-[220px] truncate px-2 py-1 text-gray-800" title={l.product}>{l.product}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.w}×{l.h}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.qty}</td>
                            <td className="max-w-[220px] truncate px-2 py-1 text-gray-500" title={l.rawLoc}>{l.rawLoc}</td>
                            <td className="px-2 py-1 font-mono text-gray-500">{bid ? <><span className={`mr-1 inline-block h-2 w-2 rounded-full ${dotOf(bid)}`} />{bid}</> : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr><th className="px-3 py-2 text-left font-medium">단위 ({UNIT_LABEL[kind]})</th><th className="px-3 py-2 text-right font-medium">줄</th><th className="px-3 py-2 text-right font-medium">수량</th><th className="px-3 py-2 text-left font-medium">묶음</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {units.map(u => {
                      const mine = read.lines.filter(l => unitOf(l, kind) === u);
                      const cur = assignment.get(u) ?? '';
                      return (
                        <tr key={u} className={cur ? '' : 'bg-red-50/60'}>
                          <td className="px-3 py-1.5 text-gray-900">{u}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{mine.length}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{mine.reduce((s, l) => s + l.qty, 0)}</td>
                          <td className="px-3 py-1.5">
                            <select value={cur} onChange={e => moveUnits([u], e.target.value)} className="h-7 rounded border bg-white px-1.5 text-xs">
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
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />묶음이 없는 단위 {unassignedUnits.length}개: {unassignedUnits.slice(0, 6).join(', ')}{unassignedUnits.length > 6 ? ' …' : ''}</p>
              )}
            </>
          )}
        </section>
      )}

      {/* 3. 결과 */}
      {results.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Step n={3} title="규격정리 결과" sub={`${read!.lines.length}줄 → ${totalRight}줄 · 묶음 ${results.filter(r => r.lines.length).length}개`} />
            <Button type="button" onClick={download} disabled={unassignedUnits.length > 0}><Download className="mr-2 h-4 w-4" />규격정리 엑셀 받기</Button>
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
            {results.filter(r => r.lines.length).map(r => {
              const isOpen = open.has(r.bundle.id);
              const rightCount = r.blocks.reduce((s, b) => s + b.right.length, 0);
              return (
                <li key={r.bundle.id}>
                  <button type="button" onClick={() => toggle(r.bundle.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotOf(r.bundle.id)}`} />
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
