'use client';

import { useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProductionLine } from '@/lib/production/lines';

/**
 * 호기 편집 — 이름 바꾸기 · 새 호기 더하기 · 안 쓰기. 지우지는 않는다(지난 기록이 그 번호를 쓴다).
 * 2026-10-30 회의: "미니라인처럼 라인이 늘 수 있으니 호기를 고정하지 말고 편집할 수 있게" (주간 · 야간은 그대로).
 */
export default function LinesEditor({ lines, storage, onSaved, onClose }: {
  lines: ProductionLine[];
  storage: 'db' | 'none';
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => lines.map(l => ({ ...l })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const add = () => {
    const next = Math.max(0, ...draft.map(l => l.line_number)) + 1;
    setDraft(d => [...d, { line_number: next, name: `${next}호기`, sort_order: d.length + 1, is_active: true }]);
  };

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/production/lines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.code === 'NO_TABLE'
        ? '호기 표가 아직 데이터베이스에 없습니다. 배포할 때 함께 만들면 쓸 수 있습니다.'
        : body.error || '저장하지 못했습니다.');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">호기 편집 <span className="font-normal text-muted-foreground">— 이름을 바꾸거나 새 호기(미니라인 등)를 더합니다</span></p>
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      {storage === 'none' && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs">호기 표가 아직 데이터베이스에 없어 지금은 1호기 · 2호기만 씁니다. 배포할 때 표를 함께 만들면 여기서 고칠 수 있습니다.</p>
      )}
      <div className="space-y-2">
        {draft.map((l, i) => (
          <div key={l.line_number} className="flex flex-wrap items-center gap-2">
            <span className="tabular w-10 text-xs text-muted-foreground">#{l.line_number}</span>
            <Input value={l.name} maxLength={20} aria-label={`${l.line_number}번 호기 이름`}
              onChange={e => setDraft(d => d.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
              className="h-9 w-40" />
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-800" checked={l.is_active}
                onChange={e => setDraft(d => d.map((x, k) => (k === i ? { ...x, is_active: e.target.checked } : x)))} />
              쓰는 중
            </label>
          </div>
        ))}
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={add} disabled={draft.length >= 20}><Plus />호기 더하기</Button>
        <Button size="sm" onClick={save} disabled={saving || storage === 'none'}><Save />{saving ? '저장 중…' : '저장'}</Button>
      </div>
    </div>
  );
}
