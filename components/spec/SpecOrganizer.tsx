'use client';

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Download, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, Check } from 'lucide-react';
import { listWoomiSheets, parseWoomiOrder, type WoomiHeader, type WoomiSheetInfo } from '@/lib/parser/woomi-order';
import { organize, defaultBundles, foldNums, type Bundle, type OrderLine } from '@/lib/spec/organize';
import { buildSpecWorkbook } from '@/lib/spec/excel';

/**
 * 규격정리 — 발주서를 올리고, 묶음(작업의뢰서 단위)을 정한 뒤, 규격정리 엑셀을 받는다.
 *
 * 묶음은 사람이 정한다. 화면은 동마다 한 묶음을 기본으로 제안하고,
 * 담당자가 고객 포장 지시대로 호를 나누거나 합친다.
 */
export default function SpecOrganizer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<WoomiSheetInfo[]>([]);
  const [sheet, setSheet] = useState('');
  const [header, setHeader] = useState<WoomiHeader | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(''); setLines([]); setBundles([]); setHeader(null); setSheet('');
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const found = listWoomiSheets(buf);
      setBuffer(buf); setSheets(found);
      const rec = found.find(s => s.recommended);
      if (!rec) { setError('우미(KCC) 양식으로 읽히는 시트가 없습니다. 13행에 "위 치 / 제 품 명" 머리가 있고 I·J·K열에 동호·실명·타입층이 있어야 합니다.'); return; }
      loadSheet(buf, rec.name);
    } catch {
      setError('엑셀 파일을 읽을 수 없습니다.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function loadSheet(buf: ArrayBuffer, name: string) {
    const { header: h, lines: ls } = parseWoomiOrder(buf, name);
    setSheet(name); setHeader(h); setLines(ls);
    setBundles(defaultBundles(ls));
    setOpen(new Set());
  }

  // ── 묶음 편집 ──────────────────────────────────────────────────────
  const dongs = useMemo(() => [...new Set(lines.map(l => l.dong))].sort((a, b) => a - b), [lines]);
  const hosOf = (dong: number) => [...new Set(lines.filter(l => l.dong === dong).map(l => l.ho))].sort((a, b) => a - b);

  function renumber(list: Bundle[]) {
    return list.map((b, i) => ({ ...b, id: `G${i + 1}` }));
  }
  function setBundleHo(id: string, text: string) {
    const ho = text.split(/[,\s]+/).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));
    setBundles(prev => prev.map(b => (b.id === id ? { ...b, ho } : b)));
  }
  function addBundle(dong: number) {
    setBundles(prev => renumber([...prev, { id: '', dong, ho: [] }]));
  }
  function removeBundle(id: string) {
    setBundles(prev => renumber(prev.filter(b => b.id !== id)));
  }
  function splitByHo(dong: number) {
    // 호마다 한 묶음으로 쪼갠다
    setBundles(prev => renumber([
      ...prev.filter(b => b.dong !== dong),
      ...hosOf(dong).map(ho => ({ id: '', dong, ho: [ho] })),
    ].sort((a, b) => a.dong - b.dong || a.ho[0] - b.ho[0])));
  }
  function mergeDong(dong: number) {
    setBundles(prev => renumber([
      ...prev.filter(b => b.dong !== dong),
      { id: '', dong, ho: hosOf(dong) },
    ].sort((a, b) => a.dong - b.dong || (a.ho[0] ?? 0) - (b.ho[0] ?? 0))));
  }

  // ── 결과 ───────────────────────────────────────────────────────────
  const { results, unassigned } = useMemo(() => organize(lines, bundles), [lines, bundles]);
  const warnings = results.flatMap(r => r.warnings.map(w => ({ id: r.bundle.id, w })));
  const dupHo = useMemo(() => {
    // 같은 동의 같은 호가 두 묶음에 들어가면 경고
    const seen = new Map<string, string>(); const dup: string[] = [];
    for (const b of bundles) for (const h of b.ho) { const k = `${b.dong}-${h}`; if (seen.has(k)) dup.push(`${b.dong}동 ${h}호 (${seen.get(k)}, ${b.id})`); else seen.set(k, b.id); }
    return dup;
  }, [bundles]);

  function toggle(id: string) {
    setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function download() {
    if (!header) return;
    const wb = buildSpecWorkbook(header, results, unassigned);
    const base = fileName.replace(/\.xlsx?$/i, '');
    XLSX.writeFile(wb, `규격정리-${base}(${sheet}).xlsx`);
  }

  const totalRight = results.reduce((s, r) => s + r.blocks.reduce((t, b) => t + b.right.length, 0), 0);

  return (
    <div className="space-y-6">
      {/* 1. 파일 */}
      <section className="rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-white">1</span>
          <h2 className="text-sm font-semibold text-gray-900">발주서 올리기</h2>
          <span className="text-xs text-gray-500">우미 · KCC 양식 (위치 / 제품명 / 규격 / 수량 … 동호·실명·타입층 열이 있는 것)</span>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />엑셀 고르기
          </Button>
          {fileName && <span className="flex items-center gap-1.5 text-sm text-gray-700"><FileSpreadsheet className="h-4 w-4 text-gray-400" />{fileName}</span>}
        </div>

        {sheets.length > 1 && buffer && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-gray-500">시트 고르기 — 차수별로 시트가 나뉜 파일입니다</p>
            <div className="flex flex-wrap gap-1.5">
              {sheets.map(s => (
                <button
                  key={s.name} type="button" onClick={() => s.lines > 0 && loadSheet(buffer, s.name)}
                  disabled={s.lines === 0}
                  className={`rounded-md border px-2.5 py-1 text-xs ${sheet === s.name ? 'border-gray-900 bg-gray-900 text-white' : s.lines === 0 ? 'text-gray-300' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {s.name}{s.lines > 0 && <span className="ml-1 opacity-60">{s.lines}줄</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {header && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-gray-500">현장</dt><dd className="text-gray-900">{header.site || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">발주번호</dt><dd className="text-gray-900">{header.orderNo || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">발주일 · 출고일</dt><dd className="text-gray-900">{header.orderDate || '-'} · {header.dueDate || '-'}</dd></div>
            <div><dt className="text-xs text-gray-500">읽은 품목</dt><dd className="text-gray-900 tabular-nums">{lines.length}줄 · {[...new Set(lines.map(l => l.product))].length}종 · {dongs.length}개 동</dd></div>
            {header.note && <div className="col-span-full"><dt className="text-xs text-gray-500">고객 지시 원문</dt><dd className="rounded bg-amber-50 px-2 py-1 text-amber-900">{header.note}</dd></div>}
          </dl>
        )}
      </section>

      {/* 2. 묶음 */}
      {lines.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-white">2</span>
            <h2 className="text-sm font-semibold text-gray-900">묶음 정하기 — 한 줄이 작업의뢰서 한 장</h2>
          </div>
          <p className="mb-4 text-xs text-gray-500">
            고객 지시 원문을 보고 호를 나눠 적으세요. <span className="font-mono">1,2,3</span> 처럼 쉼표로. 기본은 동마다 한 묶음입니다.
          </p>

          <div className="space-y-4">
            {dongs.map(dong => (
              <div key={dong} className="rounded-md border border-gray-200">
                <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-900">{dong}동 <span className="ml-1 text-xs font-normal text-gray-500">호: {hosOf(dong).join(', ')}</span></span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => addBundle(dong)} className="rounded border bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"><Plus className="mr-1 inline h-3 w-3" />묶음 추가</button>
                    <button type="button" onClick={() => splitByHo(dong)} className="rounded border bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100">호마다 따로</button>
                    <button type="button" onClick={() => mergeDong(dong)} className="rounded border bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100">동 전체 하나로</button>
                  </div>
                </div>
                <ul className="divide-y">
                  {bundles.filter(b => b.dong === dong).map(b => {
                    const r = results.find(x => x.bundle.id === b.id);
                    return (
                      <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className="w-8 font-mono text-xs text-gray-500">{b.id}</span>
                        <span className="text-xs text-gray-500">호</span>
                        <Input
                          defaultValue={b.ho.join(',')}
                          onBlur={e => setBundleHo(b.id, e.target.value)}
                          className={`h-8 w-40 font-mono text-sm ${b.ho.length === 0 ? 'border-red-300' : ''}`}
                          placeholder="1,2,3"
                        />
                        <span className="text-sm text-gray-700">→ {b.dong}동 {b.ho.length ? foldNums(b.ho) + '호' : '(호를 적으세요)'}</span>
                        {r && <span className="ml-auto text-xs text-gray-500 tabular-nums">{r.lines.length}줄 → {r.blocks.reduce((s, x) => s + x.right.length, 0)}줄 · {r.totalQty.toLocaleString()}매</span>}
                        <button type="button" onClick={() => removeBundle(b.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" title="묶음 삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {(dupHo.length > 0 || unassigned.length > 0) && (
            <div className="mt-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {dupHo.map(d => <p key={d}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />같은 호가 두 묶음에 들어 있습니다: {d}</p>)}
              {unassigned.length > 0 && <p><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />어느 묶음에도 안 들어간 줄 {unassigned.length}개 — {[...new Set(unassigned.map(u => `${u.dong}동 ${u.ho}호`))].join(', ')}</p>}
            </div>
          )}
        </section>
      )}

      {/* 3. 결과 */}
      {results.length > 0 && (
        <section className="rounded-lg border bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-white">3</span>
              <h2 className="text-sm font-semibold text-gray-900">규격정리 결과</h2>
              <span className="text-xs text-gray-500 tabular-nums">{lines.length}줄 → {totalRight}줄 · 묶음 {results.length}개</span>
            </div>
            <Button type="button" onClick={download} disabled={dupHo.length > 0 || bundles.some(b => b.ho.length === 0)}>
              <Download className="mr-2 h-4 w-4" />규격정리 엑셀 받기
            </Button>
          </div>

          {warnings.length > 0 ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="mb-1 font-medium"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />검산 {warnings.length}건 — 고객 파일에 짝이 빠진 줄입니다. 지어내지 않았으니 담당자가 확인하세요.</p>
              {warnings.map((w, i) => <p key={i} className="font-mono text-xs">{w.id}  {w.w}</p>)}
            </div>
          ) : (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><Check className="mr-1 inline h-3.5 w-3.5" />外/內 짝 검산 통과 — 빠진 줄이 없습니다.</p>
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
                    <span className="text-sm font-medium text-gray-900">{r.bundle.dong}동 {foldNums(r.bundle.ho)}호</span>
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
