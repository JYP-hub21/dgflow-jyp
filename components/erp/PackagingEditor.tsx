'use client';

/**
 * 포장 직접 짜기
 *
 * 발주서에 포장 단위가 명확히 적혀 있으면 자동으로 나눈다. 하지만 작성자마다 적는 방식이 달라
 * 알아보기 힘든 발주서가 계속 들어온다. 그때 사원이 직접 행을 골라 포장을 짜는 화면이다.
 *
 * ── 지키는 것 ──────────────────────────────────────────────
 *  · **빈 화면에서 시작하지 않는다** — 자동 결과를 복사해 놓고 틀린 것만 옮기게 한다.
 *  · **행을 잃어버릴 수 없다** — 미배정 행을 크게 띄우고, 남아 있으면 다운로드에 경고를 건다.
 *  · **발주서 행 번호를 보여 준다** — 사원이 발주서 원본과 나란히 놓고 대조해야 한다.
 *  · **장수가 실시간으로 보인다** — 발주서에 적힌 수량과 눈으로 맞출 수 있어야 한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import NativeSelect from '@/components/ui/native-select';
import { chipClass, chipCountClass } from '@/components/ui/chip';
import { Boxes, Plus, Trash2, Save, Check, Loader2, TriangleAlert, Undo2 } from 'lucide-react';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';
import { type ManualPackage, newPackageId, unassignedRows } from '@/lib/erp/packaging-rule';

const UNASSIGNED = '__none__';

/** 빠른 선택 기준 — 값이 2종 이상 나오는 것만 화면에 띄운다 */
const GROUP_BY = [
  { key: 'block', label: '품명 블록', of: (r: WorkOrderSourceItem) => r.product_name },
  { key: 'dong', label: '동', of: (r: WorkOrderSourceItem) => r.location_dong ?? '' },
  { key: 'unit', label: '동·호', of: (r: WorkOrderSourceItem) => [r.location_dong, r.location_line].filter(Boolean).join(' ') },
  { key: 'floor', label: '층', of: (r: WorkOrderSourceItem) => r.location_floor ?? '' },
  { key: 'location', label: '위치', of: (r: WorkOrderSourceItem) => locationOf(r) },
] as const;

export interface PackagingEditorProps {
  rows: WorkOrderSourceItem[];
  packages: ManualPackage[];
  onChange: (packages: ManualPackage[]) => void;
  onResetToAuto: () => void;
  /** 저장된 규칙 적용/저장 */
  savedRules: { id?: string; name: string; reusable: boolean; description: string }[];
  onApplyRule: (name: string) => void;
  onSaveRule: (name: string) => Promise<void>;
  defaultRuleName: string;
  saveNotes: string[];
}

export default function PackagingEditor({
  rows, packages, onChange, onResetToAuto,
  savedRules, onApplyRule, onSaveRule, defaultRuleName, saveNotes,
}: PackagingEditorProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<string>('block');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [ruleName, setRuleName] = useState(defaultRuleName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const assignment = useMemo(() => {
    const map = new Map<number, string>();
    for (const pkg of packages) for (const row of pkg.rows) map.set(row, pkg.id);
    return map;
  }, [packages]);

  const leftover = useMemo(() => unassignedRows(rows, packages), [rows, packages]);
  const leftoverSet = useMemo(() => new Set(leftover.map(r => r.source_row!)), [leftover]);

  const visible = onlyUnassigned ? rows.filter(r => leftoverSet.has(r.source_row!)) : rows;

  /** 빠른 선택 칩 — 기준별로 값과 행 수를 뽑는다 */
  const chips = useMemo(() => {
    const field = GROUP_BY.find(g => g.key === groupBy) ?? GROUP_BY[0];
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const key = field.of(r);
      if (!key || r.source_row === undefined) continue;
      map.set(key, [...(map.get(key) ?? []), r.source_row]);
    }
    return [...map.entries()].map(([label, rowNumbers]) => ({ label, rows: rowNumbers }));
  }, [rows, groupBy]);

  const availableGroupBy = useMemo(
    () =>
      GROUP_BY.filter(g => {
        const values = new Set(rows.map(g.of).filter(Boolean));
        return values.size >= 2;
      }),
    [rows],
  );

  /*
    한 번에 여러 행 고르기 (2026-10-13 실사용 피드백 — "체크박스나 드래그로 한 번에").
      · 드래그: 행을 누른 채 위아래로 끌면 지나간 행이 전부 골라진다.
                골라진 행에서 시작하면 반대로 풀린다.
      · Shift+클릭: 마지막으로 누른 행부터 지금 행까지 범위로 고른다.
      · 머리 체크박스: 지금 보이는 행 전부.
  */
  const [drag, setDrag] = useState<{ select: boolean } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [drag]);

  function setRows(rowNumbers: number[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      rowNumbers.forEach(n => (on ? next.add(n) : next.delete(n)));
      return next;
    });
  }

  function startDrag(row: number, e: React.PointerEvent) {
    // 포장 드롭다운을 누른 건 선택이 아니다
    if ((e.target as HTMLElement).closest('select')) return;
    e.preventDefault();
    const order = visible.map(r => r.source_row!);
    if (e.shiftKey && anchor !== null && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(row)].sort((x, y) => x - y);
      setRows(order.slice(a, b + 1), true);
      return;
    }
    const select = !selected.has(row);
    setRows([row], select);
    setAnchor(row);
    setDrag({ select });
  }

  function dragOver(row: number) {
    if (drag) setRows([row], drag.select);
  }

  /** 고른 행으로 새 포장을 만든다 */
  function packSelectedAsNew() {
    if (selected.size === 0) return;
    const moving = selected;
    const fresh: ManualPackage = {
      id: newPackageId(),
      label: `포장 ${packages.length + 1}`,
      rows: rows.map(r => r.source_row!).filter(n => moving.has(n)),
    };
    onChange([...packages.map(p => ({ ...p, rows: p.rows.filter(r => !moving.has(r)) })), fresh]);
    setSelected(new Set());
  }

  function selectChip(rowNumbers: number[]) {
    setSelected(prev => {
      const next = new Set(prev);
      const allIn = rowNumbers.every(n => next.has(n));
      rowNumbers.forEach(n => (allIn ? next.delete(n) : next.add(n)));
      return next;
    });
  }

  /** 선택한 행을 한 포장으로 옮긴다 (다른 포장에서는 빠진다 — 한 행은 한 포장에만) */
  function moveSelected(targetId: string) {
    if (selected.size === 0) return;
    const moving = new Set(selected);
    const next = packages.map(p => ({
      ...p,
      rows: p.rows.filter(r => !moving.has(r)),
    }));

    if (targetId !== UNASSIGNED) {
      const target = next.find(p => p.id === targetId);
      if (target) {
        // 발주서 순서를 유지한다 — 사원이 원본과 대조할 수 있어야 한다
        target.rows = rows
          .map(r => r.source_row!)
          .filter(n => target.rows.includes(n) || moving.has(n));
      }
    }

    onChange(next);
    setSelected(new Set());
  }

  function setRowPackage(row: number, targetId: string) {
    const next = packages.map(p => ({ ...p, rows: p.rows.filter(r => r !== row) }));
    if (targetId !== UNASSIGNED) {
      const target = next.find(p => p.id === targetId);
      if (target) {
        target.rows = rows.map(r => r.source_row!).filter(n => target.rows.includes(n) || n === row);
      }
    }
    onChange(next);
  }

  function addPackage() {
    onChange([...packages, { id: newPackageId(), label: `포장 ${packages.length + 1}`, rows: [] }]);
  }

  function removePackage(id: string) {
    onChange(packages.filter(p => p.id !== id));
  }

  function rename(id: string, label: string) {
    onChange(packages.map(p => (p.id === id ? { ...p, label } : p)));
  }

  async function saveRule() {
    setSaving(true);
    setError('');
    try {
      await onSaveRule(ruleName.trim() || defaultRuleName);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const quantityOf = (rowNumbers: number[]) => {
    const wanted = new Set(rowNumbers);
    return rows.reduce((s, r) => (r.source_row !== undefined && wanted.has(r.source_row) ? s + r.quantity : s), 0);
  };

  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const assignedQuantity = packages.reduce((s, p) => s + quantityOf(p.rows), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            포장 직접 짜기
            <span className="text-xs font-normal text-muted-foreground">
              발주서 {rows.length}행 · {total.toLocaleString()}장
            </span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onResetToAuto}>
            <Undo2 />
            자동 분리로 되돌리기
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          자동으로 나눈 결과에서 시작합니다. 행을 골라 다른 포장으로 옮기면 ERP 엑셀 시트가 그대로 바뀝니다.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 포장 목록 */}
        <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {packages.map((pkg, i) => (
              <div
                key={pkg.id}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-input bg-card pl-2.5 pr-1 shadow-xs"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-800 text-[11px] font-bold text-white">{i + 1}</span>
                <Input
                  value={pkg.label}
                  onChange={e => rename(pkg.id, e.target.value)}
                  className="h-8 w-32 border-0 px-1 text-sm font-semibold shadow-none hover:border-0 focus-visible:ring-0"
                />
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {pkg.rows.length}행 · {quantityOf(pkg.rows).toLocaleString()}장
                </span>
                <button
                  type="button"
                  onClick={() => removePackage(pkg.id)}
                  title="포장 삭제 (행은 미배정으로 돌아갑니다)"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive hover:text-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addPackage}>
              <Plus />포장 추가
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular-nums text-muted-foreground">
              배정 {assignedQuantity.toLocaleString()}장 / 전체 {total.toLocaleString()}장
            </span>
            {leftover.length > 0 ? (
              <button
                type="button"
                onClick={() => setOnlyUnassigned(v => !v)}
                className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 font-semibold transition-colors ${
                  onlyUnassigned
                    ? 'border-destructive bg-destructive text-white'
                    : 'border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10'
                }`}
              >
                <TriangleAlert className="h-4 w-4" />
                미배정 {leftover.length}행
                <span className="font-normal opacity-70">{onlyUnassigned ? '· 전체 보기' : '· 눌러서 보기'}</span>
              </button>
            ) : (
              <span className="flex h-9 items-center gap-1.5 rounded-lg border border-success/30 bg-success-50 px-3 font-semibold text-success">
                <Check className="h-4 w-4" />
                모든 행이 배정됐습니다
              </span>
            )}
          </div>
        </div>

        {/* 빠른 선택 */}
        {availableGroupBy.length > 0 && (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">빠른 선택</span>
              <NativeSelect
                value={groupBy}
                onChange={e => setGroupBy(e.target.value)}
                className="h-9 w-auto"
              >
                {availableGroupBy.map(g => (
                  <option key={g.key} value={g.key}>{g.label} 기준</option>
                ))}
              </NativeSelect>
              <button
                type="button"
                onClick={() => setSelected(new Set(rows.map(r => r.source_row!)))}
                className={chipClass(false, 'h-9')}
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className={chipClass(false, 'h-9')}
              >
                선택 해제
              </button>
            </div>

            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {chips.map(chip => {
                const allIn = chip.rows.every(n => selected.has(n));
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => selectChip(chip.rows)}
                    className={chipClass(allIn, 'h-8 px-2.5 text-[13px]')}
                    title={`${chip.rows.length}행`}
                  >
                    {truncate(chip.label)}
                    <span className={chipCountClass(allIn)}>{chip.rows.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 선택한 행 옮기기 — 표를 한참 내려가며 골라도 보이도록 화면 아래에 띄운다
            (카드가 overflow-hidden 이라 sticky 는 먹지 않는다) */}
        {selected.size > 0 && (
          <div className="fixed inset-x-4 bottom-4 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-brand-600/40 bg-brand-50/95 p-3 shadow-xl backdrop-blur md:left-[calc(16rem+1.5rem)] md:right-6">
            <Badge>{selected.size}행 · {quantityOf([...selected]).toLocaleString()}장 선택됨</Badge>
            <Button size="sm" onClick={packSelectedAsNew}>
              <Plus />새 포장으로 만들기
            </Button>
            <span className="text-sm font-semibold text-brand-900">또는 기존 포장으로 →</span>
            {packages.map(pkg => (
              <Button key={pkg.id} size="sm" variant="outline" onClick={() => moveSelected(pkg.id)}>
                {pkg.label || '(이름 없음)'}
              </Button>
            ))}
            <Button size="sm" variant="destructive" onClick={() => moveSelected(UNASSIGNED)}>
              미배정으로
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              선택 해제
            </Button>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">행을 누른 채 위아래로 끌면</b> 여러 행이 한 번에 골라집니다.
          {' '}<b className="text-foreground">Shift</b> 를 누르고 클릭하면 사이의 행이 전부 골라집니다.
        </p>

        {/* 행 목록 */}
        <div className="max-h-[32rem] select-none overflow-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
              <tr className="border-b text-left text-xs font-semibold text-muted-foreground">
                <th className="w-9 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="보이는 행 전체 선택"
                    title="보이는 행 전체 선택"
                    checked={visible.length > 0 && visible.every(r => selected.has(r.source_row!))}
                    onChange={e => setRows(visible.map(r => r.source_row!), e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-brand-800"
                  />
                </th>
                <th className="w-16 px-2 py-2">발주서</th>
                <th className="px-2 py-2">위치</th>
                <th className="w-40 px-2 py-2">품명</th>
                <th className="w-28 px-2 py-2 text-right">규격</th>
                <th className="w-14 px-2 py-2 text-right">수량</th>
                <th className="w-36 px-2 py-2">포장</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const n = row.source_row!;
                const pkgId = assignment.get(n) ?? UNASSIGNED;
                const isSelected = selected.has(n);
                const isLeftover = pkgId === UNASSIGNED;
                return (
                  <tr
                    key={n}
                    onPointerDown={e => startDrag(n, e)}
                    onPointerEnter={() => dragOver(n)}
                    className={`cursor-pointer border-b border-border/60 last:border-0 ${
                      isSelected ? 'bg-brand-100/70' : isLeftover ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-brand-50'
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      {/* 선택은 행의 pointerdown 이 맡는다 — 여기서도 바꾸면 두 번 뒤집힌다 */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                        aria-label={`${n}행 선택`}
                        className="pointer-events-none h-4 w-4 accent-brand-800"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-[13px] tabular-nums text-muted-foreground">{n}행</td>
                    <td className="px-2 py-1.5 text-[13px]">
                      {locationOf(row) || <span className="text-muted-foreground">(위치 없음)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-[13px] text-muted-foreground">{truncate(row.product_name, 22)}</td>
                    <td className="px-2 py-1.5 text-right text-[13px] tabular-nums">
                      {row.width_mm}×{row.height_mm}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[13px] font-medium tabular-nums">{row.quantity}</td>
                    <td className="px-2 py-1.5">
                      <NativeSelect
                        value={pkgId}
                        onChange={e => setRowPackage(n, e.target.value)}
                        className={`h-8 text-[13px] ${isLeftover ? 'border-destructive/60 font-semibold text-destructive' : ''}`}
                      >
                        <option value={UNASSIGNED}>미배정</option>
                        {packages.map(p => (
                          <option key={p.id} value={p.id}>{p.label || '(이름 없음)'}</option>
                        ))}
                      </NativeSelect>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 현장별 저장 / 적용 */}
        <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
          <p className="text-sm font-semibold">이 현장의 포장 방식으로 저장</p>
          <p className="text-sm text-muted-foreground">
            행 번호가 아니라 <span className="font-medium">무엇을 기준으로 묶었는지</span>를 저장합니다
            (동·호 또는 품명 블록). 그래야 다음 차수 발주서에도 적용됩니다.
          </p>

          {saveNotes.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-50 px-3 py-2 text-sm text-amber-900">
              {saveNotes.map((n, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-px">•</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={ruleName}
              onChange={e => setRuleName(e.target.value)}
              placeholder="예) 우미 남원주 — 동·호 포장"
              className="max-w-sm"
            />
            <Button onClick={saveRule} disabled={saving}>
              {saving ? (
                <Loader2 className="animate-spin" />
              ) : saved ? (
                <Check />
              ) : (
                <Save />
              )}
              {saved ? '저장했습니다' : '포장 방식 저장'}
            </Button>
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          {savedRules.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">저장된 포장 방식</p>
              {savedRules.map(rule => (
                <div key={rule.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onApplyRule(rule.name)}
                    className={chipClass(false, 'h-8 border-brand-600/40 text-brand-800')}
                  >
                    {rule.name} 적용
                  </button>
                  <span className="text-muted-foreground">{rule.description}</span>
                  {!rule.reusable && (
                    <Badge variant="warning" title="행 번호로 고정된 포장이 있어 다른 차수에는 맞지 않을 수 있습니다">
                      이 차수 전용
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function locationOf(r: WorkOrderSourceItem): string {
  return (
    r.location_text ||
    [r.location_dong, r.location_line, r.location_type, r.location_floor, r.location_room]
      .filter(Boolean)
      .join(' ')
  );
}

const truncate = (s: string, n = 18) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
