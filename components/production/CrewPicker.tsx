'use client';

import { useMemo, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Eraser, Search, UserPlus } from 'lucide-react';
import { searchCrew, type CrewMember } from '@/lib/production/crew';
import { cn } from '@/lib/utils';

/**
 * 주간생산일지 투입 인원 한 칸 — 눌러서 명단(조직도 생산부)에서 고른다 (2026-11-09).
 * 명단에 없는 이름도 그대로 넣을 수 있고, 생산 입력 권한이 있으면 명단에 더할 수 있다.
 */
export default function CrewPicker({ value, label, members, usedNames, canEdit, canAdd, onChange, onAdd }: {
  value: string;
  /** 칸 이름 — 투입 · 마킹 … */
  label: string;
  members: CrewMember[];
  /** 이 주에 적혀 있는데 명단에 없는 이름 */
  usedNames: string[];
  canEdit: boolean;
  /** 명단 표가 있고 더할 수 있는지 */
  canAdd: boolean;
  onChange: (name: string) => void;
  onAdd: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const found = useMemo(() => searchCrew(members, query), [members, query]);
  const extra = useMemo(() => {
    const q = query.replace(/\s+/g, '');
    return usedNames.filter(n => !members.some(m => m.name === n) && (!q || n.includes(q)));
  }, [usedNames, members, query]);
  const typed = query.trim();
  const exact = typed && (members.some(m => m.name === typed) || usedNames.includes(typed));

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setQuery('');
  }

  async function addAndPick() {
    if (!typed) return;
    setAdding(true);
    try { await onAdd(typed); pick(typed); } finally { setAdding(false); }
  }

  if (!canEdit) return <span className="block min-w-14 px-1 text-center text-sm">{value}</span>;

  return (
    <Popover.Root open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(''); }}>
      <Popover.Trigger
        aria-label={`${label} 인원 고르기`}
        className={cn(
          'flex h-8 w-full min-w-16 items-center justify-center rounded-md border px-1.5 text-sm transition-colors',
          value ? 'border-input bg-card font-medium text-foreground hover:border-brand-600' : 'border-dashed border-input bg-muted/40 text-muted-foreground hover:border-brand-600 hover:bg-brand-50',
          open && 'border-brand-600 ring-2 ring-brand-600/20',
        )}>
        {value || '+'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="center" sideOffset={6} className="z-50">
          <Popover.Popup className="w-72 rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{label} · 사람 고르기</p>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 · 영문 이름 찾기"
                aria-label="인원 찾기"
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (found[0]) pick(found[0].name);
                  else if (typed) pick(typed);
                }}
                className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-2 text-sm outline-none focus:border-brand-600" />
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto">
              {found.length > 0 && (
                <div className="grid grid-cols-3 gap-1">
                  {found.map(m => (
                    <button key={m.id} type="button" onClick={() => pick(m.name)}
                      title={[m.position, m.full_name].filter(Boolean).join(' · ')}
                      className={cn('rounded-md px-1.5 py-1.5 text-center text-sm leading-tight transition-colors',
                        m.name === value ? 'bg-brand-800 font-semibold text-white' : 'bg-muted/60 hover:bg-brand-50 hover:text-brand-900')}>
                      {m.name}
                      {m.position && <span className={cn('block text-[10px]', m.name === value ? 'text-white/70' : 'text-muted-foreground')}>{m.position}</span>}
                    </button>
                  ))}
                </div>
              )}
              {extra.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">이 주에 적힌 다른 이름</p>
                  <div className="flex flex-wrap gap-1">
                    {extra.map(n => (
                      <button key={n} type="button" onClick={() => pick(n)}
                        className={cn('rounded-md px-2 py-1 text-sm', n === value ? 'bg-brand-800 text-white' : 'bg-muted/60 hover:bg-brand-50')}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              {found.length === 0 && extra.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">{members.length === 0 ? '명단이 아직 없습니다. 이름을 적어 넣으세요.' : '맞는 사람이 없습니다.'}</p>
              )}
            </div>

            {(typed && !exact) || value ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                {typed && !exact && (
                  <>
                    <button type="button" onClick={() => pick(typed)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      &lsquo;{typed}&rsquo; 그대로 넣기
                    </button>
                    {canAdd && (
                      <button type="button" onClick={addAndPick} disabled={adding}
                        className="inline-flex items-center gap-1 rounded-md border border-brand-600/40 px-2 py-1 text-xs text-brand-800 hover:bg-brand-50">
                        <UserPlus className="h-3 w-3" />명단에 추가하고 넣기
                      </button>
                    )}
                  </>
                )}
                {value && (
                  <button type="button" onClick={() => pick('')} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Eraser className="h-3 w-3" />비우기
                  </button>
                )}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
