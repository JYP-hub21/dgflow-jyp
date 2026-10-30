'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/layout/PageHeader';
import { chipClass } from '@/components/ui/chip';
import { Plus, Pencil, Save, X, UserCheck, UserX, KeyRound } from 'lucide-react';
import { USER_ROLES, type UserRole, type UserStatus } from '@/types/user';
import { DEPARTMENTS, DEPT_BY_KEY, type DeptKey } from '@/lib/departments';
import {
  PERMISSION_GROUPS, PERMISSION_LABELS, DEPT_PERMISSIONS, MENU_ITEMS,
  deptBlocksOf, hasPermission, normalizePermissions, type PermissionSubject,
} from '@/lib/auth/role-guard';
import { DEPT_STYLE } from '@/components/layout/dept-style';
import { cn } from '@/lib/utils';

interface UserRow {
  id: string;
  login_id: string;
  name: string;
  phone: string | null;
  birth_date: string | null;
  department: string | null;
  position: string | null;
  role: UserRole;
  permissions: string[];
  status: UserStatus;
  is_active: boolean;
  created_at: string;
}

interface NewUser {
  loginId: string;
  password: string;
  name: string;
  phone: string;
  department: string;
  position: string;
  role: UserRole;
  permissions: string[];
}

type Me = PermissionSubject & { id: string };

const ROLE_COLORS: Record<string, string> = {
  master: 'bg-brand-800 text-white',
  staff: 'bg-secondary text-secondary-foreground',
};

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const result = await res.json().catch(() => ({}));
  return result.error || '처리하지 못했습니다.';
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState<NewUser | null>(null);
  const [approving, setApproving] = useState<{ id: string; permissions: string[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const res = await fetch('/api/users');
    const result = await res.json();
    if (!res.ok) { setError(result.error || '사용자 목록을 불러오지 못했습니다.'); return; }
    setUsers(result.data || []);
    setMe(result.me);
  }

  /** 저장 · 승인 · 거절 공통 — 실패하면 안내문, 성공하면 폼을 닫고 다시 불러온다 */
  async function run(action: () => Promise<string | null>, done: string, close: () => void) {
    setError(''); setNotice('');
    setSaving(true);
    const err = await action();
    setSaving(false);
    if (err) { setError(err); return; }
    close();
    setNotice(done);
    load();
  }

  const pending = users.filter(u => u.status === 'pending');
  const members = users.filter(u => u.status === 'active');
  const canChangeRole = me?.role === 'master';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="사용자 관리" description="가입 신청을 승인하고, 사람마다 쓸 수 있는 기능을 정합니다." />
      {/* 부서 칸 추천 — 세 부서 이름이 맞아야 사이드바에 '내 부서' 가 표시된다 */}
      <datalist id="department-options">
        {DEPARTMENTS.map(d => <option key={d.key} value={d.name} />)}
      </datalist>

      {notice && <p className="rounded-lg bg-success-50 px-4 py-2.5 text-sm font-medium text-success">{notice}</p>}
      {error && !creating && !editing && !approving && (
        <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">{error}</p>
      )}

      {/* 가입 신청 */}
      {pending.length > 0 && me && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle className="text-lg">가입 신청 <span className="text-warning">{pending.length}건</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map(u => (
              <div key={u.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {u.name}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">{u.department} · {u.position}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      아이디 <b className="text-foreground">{u.login_id}</b> · {u.phone} · 생년월일 {u.birth_date}
                      · 신청 {new Date(u.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  {approving?.id !== u.id && (
                    <div className="flex gap-2">
                      <Button onClick={() => { setApproving({ id: u.id, permissions: [] }); setError(''); setNotice(''); }}>
                        <UserCheck />승인
                      </Button>
                      <Button variant="outline" disabled={saving} onClick={() => {
                        if (!confirm(`${u.name}(${u.login_id}) 님의 가입 신청을 거절할까요? 신청 내용이 지워집니다.`)) return;
                        run(() => send(`/api/users/${u.id}`, 'DELETE'), `${u.name} 님의 가입 신청을 거절했습니다.`, () => {});
                      }}>
                        <UserX />거절
                      </Button>
                    </div>
                  )}
                </div>
                {approving?.id === u.id && (
                  <div className="mt-4 space-y-4 border-t border-border pt-4">
                    <PermissionPicker me={me} role="staff" value={approving.permissions}
                      onChange={permissions => setApproving({ ...approving, permissions })} />
                    {error && <p className="text-sm font-medium text-destructive">{error}</p>}
                    <div className="flex gap-2">
                      <Button disabled={saving} onClick={() => run(
                        () => send(`/api/users/${u.id}`, 'PATCH', { approve: true, permissions: approving.permissions }),
                        `${u.name} 님을 승인했습니다. 이제 로그인할 수 있습니다.`,
                        () => setApproving(null),
                      )}>
                        <UserCheck />{saving ? '승인 중...' : '이 권한으로 승인'}
                      </Button>
                      <Button variant="outline" onClick={() => { setApproving(null); setError(''); }}><X />취소</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">사용자 ({members.length}명)</CardTitle>
          <Button onClick={() => {
            setCreating({ loginId: '', password: '', name: '', phone: '', department: '', position: '', role: 'staff', permissions: [] });
            setEditing(null); setApproving(null); setError(''); setNotice('');
          }}>
            <Plus />직접 추가
          </Button>
        </CardHeader>
        <CardContent>
          {/* 관리자가 직접 만드는 계정 — 승인 없이 바로 쓴다 */}
          {creating && me && (
            <div className="mb-5 space-y-4 rounded-xl border border-brand-600/30 bg-brand-50/60 p-5">
              <p className="font-semibold">사용자 직접 추가 <span className="text-sm font-normal text-muted-foreground">승인 없이 바로 로그인할 수 있습니다</span></p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TextField label="아이디 *" placeholder="hgd" value={creating.loginId}
                  onChange={v => setCreating({ ...creating, loginId: v })} />
                <TextField label="비밀번호 *" value={creating.password}
                  onChange={v => setCreating({ ...creating, password: v })} />
                <TextField label="이름 *" placeholder="홍길동" value={creating.name}
                  onChange={v => setCreating({ ...creating, name: v })} />
                <TextField label="전화번호" placeholder="010-1234-5678" value={creating.phone}
                  onChange={v => setCreating({ ...creating, phone: v })} />
                <TextField label="부서" placeholder="예: 업무지원부" list="department-options" value={creating.department}
                  onChange={v => setCreating({ ...creating, department: v })} />
                <TextField label="직책" placeholder="대리" value={creating.position}
                  onChange={v => setCreating({ ...creating, position: v })} />
              </div>
              {canChangeRole && (
                <RolePicker value={creating.role} onChange={role => setCreating({ ...creating, role })} />
              )}
              <PermissionPicker me={me} role={creating.role} value={creating.permissions}
                onChange={permissions => setCreating({ ...creating, permissions })} />
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button disabled={saving} onClick={() => run(
                  () => send('/api/auth/register', 'POST', creating),
                  `${creating.name} 님 계정을 만들었습니다.`,
                  () => setCreating(null),
                )}>
                  <Save />{saving ? '등록 중...' : '등록'}
                </Button>
                <Button variant="outline" onClick={() => { setCreating(null); setError(''); }}>
                  <X />취소
                </Button>
              </div>
            </div>
          )}

          {/* 수정 폼 */}
          {editing && me && (
            <div className="mb-5 space-y-4 rounded-xl border border-warning/40 bg-warning-50 p-5">
              <p className="font-semibold">사용자 수정: {editing.name} <span className="text-sm font-normal text-muted-foreground">아이디 {editing.login_id}</span></p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TextField label="이름" value={editing.name} onChange={v => setEditing({ ...editing, name: v })} />
                <TextField label="전화번호" value={editing.phone ?? ''} onChange={v => setEditing({ ...editing, phone: v })} />
                <div>
                  <Label className="mb-1.5 text-[13px] font-semibold">생년월일</Label>
                  <Input type="date" value={editing.birth_date ?? ''}
                    onChange={e => setEditing({ ...editing, birth_date: e.target.value })} />
                </div>
                <TextField label="부서" list="department-options" value={editing.department ?? ''}
                  onChange={v => setEditing({ ...editing, department: v })} />
                <TextField label="직책" value={editing.position ?? ''} onChange={v => setEditing({ ...editing, position: v })} />
                <div>
                  <Label className="mb-1.5 text-[13px] font-semibold"><KeyRound className="mr-1 inline h-3.5 w-3.5" />비밀번호 초기화</Label>
                  <Input placeholder="바꿀 때만 입력" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                </div>
              </div>
              <label className="flex h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-brand-800" checked={editing.is_active}
                  disabled={editing.id === me.id}
                  onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                사용 중 <span className="text-muted-foreground">(끄면 로그인할 수 없습니다. 퇴사자는 지우지 말고 끄세요)</span>
              </label>
              {canChangeRole && editing.id !== me.id && (
                <RolePicker value={editing.role} onChange={role => setEditing({ ...editing, role })} />
              )}
              <PermissionPicker me={me} role={editing.role} value={editing.permissions}
                onChange={permissions => setEditing({ ...editing, permissions })} />
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button disabled={saving} onClick={() => run(
                  () => send(`/api/users/${editing.id}`, 'PATCH', {
                    name: editing.name,
                    phone: editing.phone,
                    birth_date: editing.birth_date,
                    department: editing.department,
                    position: editing.position,
                    role: editing.role,
                    is_active: editing.is_active,
                    permissions: editing.permissions,
                    ...(newPassword ? { password: newPassword } : {}),
                  }),
                  newPassword ? `${editing.name} 님 정보를 저장하고 비밀번호를 바꿨습니다.` : `${editing.name} 님 정보를 저장했습니다.`,
                  () => { setEditing(null); setNewPassword(''); },
                )}>
                  <Save />{saving ? '저장 중...' : '저장'}
                </Button>
                <Button variant="outline" onClick={() => { setEditing(null); setNewPassword(''); setError(''); }}>
                  <X />취소
                </Button>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>아이디</TableHead>
                <TableHead>부서 · 직책</TableHead>
                <TableHead>전화번호</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>권한</TableHead>
                <TableHead>상태</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(u => (
                <TableRow key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-sm">{u.login_id}</TableCell>
                  <TableCell className="text-sm">{[u.department, u.position].filter(Boolean).join(' · ') || '-'}</TableCell>
                  <TableCell className="text-sm">{u.phone || '-'}</TableCell>
                  <TableCell>
                    <Badge className={ROLE_COLORS[u.role] || ''} variant="secondary">
                      {USER_ROLES[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs text-sm">
                    <PermissionSummary user={u} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? 'success' : 'secondary'}>
                      {u.is_active ? '사용 중' : '중지'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {(u.role !== 'master' || canChangeRole) && (
                      <Button variant="outline" size="sm" onClick={() => {
                        setEditing({ ...u, permissions: u.permissions ?? [] });
                        setNewPassword(''); setCreating(null); setApproving(null); setError(''); setNotice('');
                      }}>
                        <Pencil />수정
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, list }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  /** 추천 목록(datalist) id */
  list?: string;
}) {
  return (
    <div>
      <Label className="mb-1.5 text-[13px] font-semibold">{label}</Label>
      <Input placeholder={placeholder} list={list} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

/** 권한 요약 — 통째로 가진 부서는 부서 이름표로, 나머지는 낱개 이름으로 */
function PermissionSummary({ user }: { user: UserRow }) {
  if (user.role === 'master') return <span className="font-semibold text-brand-800">전체 기능</span>;
  const { blocks, extras } = deptBlocksOf(user.permissions);
  if (blocks.length === 0 && extras.length === 0) {
    return <span className="font-medium text-warning">부서 권한 없음 — 대시보드만 보입니다</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {blocks.map(k => (
        <span key={k} className={cn('rounded-full px-2 py-0.5 text-xs font-bold', DEPT_STYLE[k].chip)}>
          {DEPT_BY_KEY[k].name}
        </span>
      ))}
      {extras.length > 0 && (
        <span className="text-xs text-muted-foreground">{extras.map(k => PERMISSION_LABELS[k]).join(' · ')}</span>
      )}
    </span>
  );
}

function RolePicker({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <div>
      <Label className="mb-1.5 text-[13px] font-semibold">역할</Label>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(USER_ROLES) as UserRole[]).map(r => (
          <button key={r} type="button" className={chipClass(value === r)} onClick={() => onChange(r)}>
            {USER_ROLES[r]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 기능 권한 고르기. 마스터는 전부 쓰므로 고를 것이 없다.
 * 사원 관리자는 자기에게 없는 권한을 건드릴 수 없다 (API 도 같은 규칙으로 막는다).
 *
 * 2026-10-30 피드백 "권한은 덩어리째로" — 부서 덩어리 셋을 눌러 주고 뺀다(DEPT_PERMISSIONS).
 * 덩어리를 주면 사이드바에 그 부서 구역만 열리고, 전체 현황은 누구나 대시보드에서 본다.
 * 관리 권한 둘은 따로, 낱개 권한은 '세부 권한' 에 접어 둔다.
 */
function PermissionPicker({ me, role, value, onChange }: {
  me: PermissionSubject;
  role: UserRole;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [detail, setDetail] = useState(false);

  if (role === 'master') {
    return (
      <p className="rounded-lg bg-card px-4 py-3 text-sm text-muted-foreground">
        마스터는 모든 기능을 씁니다. 기능을 골라 주려면 역할을 사원으로 두세요.
      </p>
    );
  }

  const toggle = (key: string, on: boolean) => {
    const next = on ? [...value, key] : value.filter(k => k !== key);
    // 생산 입력을 켜면 생산 조회도 같이 켜진다
    onChange(on ? normalizePermissions(next) : next);
  };

  const has = new Set(value);
  const stateOf = (k: DeptKey): 'on' | 'some' | 'off' => {
    const n = DEPT_PERMISSIONS[k].filter(p => has.has(p)).length;
    return n === 0 ? 'off' : n === DEPT_PERMISSIONS[k].length ? 'on' : 'some';
  };
  const toggleBlock = (k: DeptKey) => {
    if (stateOf(k) === 'on') {
      // 뺄 때 다른 켜진 덩어리가 같이 쓰는 권한은 남긴다
      const keep = new Set(DEPARTMENTS.filter(d => d.key !== k && stateOf(d.key) === 'on').flatMap(d => DEPT_PERMISSIONS[d.key]));
      onChange(value.filter(p => !DEPT_PERMISSIONS[k].includes(p) || keep.has(p)));
    } else {
      onChange(normalizePermissions([...value, ...DEPT_PERMISSIONS[k]]));
    }
  };
  const adminKeys = ['admin:master', 'admin:users'];

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1.5 text-[13px] font-semibold">부서 권한 <span className="font-normal text-muted-foreground">— 누르면 그 부서 메뉴가 통째로 열리고 닫힙니다</span></Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {DEPARTMENTS.map(d => {
            const s = DEPT_STYLE[d.key];
            const state = stateOf(d.key);
            const usable = DEPT_PERMISSIONS[d.key].every(p => hasPermission(me, p));
            const tabs = MENU_ITEMS.filter(m => m.group === d.key).map(m => m.label);
            return (
              <button key={d.key} type="button" disabled={!usable} aria-pressed={state === 'on'}
                onClick={() => toggleBlock(d.key)}
                className={cn('rounded-xl p-3 text-left transition-all',
                  state === 'on' ? cn(s.solid, 'shadow-sm') : s.panel,
                  usable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}>
                <span className="flex items-center gap-2">
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    state === 'on' ? cn('bg-white', s.text) : s.solid)}>
                    {state === 'on' ? '✓' : d.order}
                  </span>
                  <span className={cn('text-[14px] font-bold', state !== 'on' && s.text)}>{d.name}</span>
                  {state === 'some' && <span className={cn('ml-auto text-[11px] font-semibold', s.text)}>일부만</span>}
                </span>
                <span className={cn('mt-1.5 block break-keep text-xs leading-relaxed', state === 'on' ? 'text-white/85' : 'text-muted-foreground')}>
                  {tabs.join(' · ')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Label className="text-[13px] font-semibold">관리 권한</Label>
        {adminKeys.map(key => {
          const mine = hasPermission(me, key);
          return (
            <label key={key} className={`flex min-h-9 items-center gap-2 text-sm ${mine ? 'cursor-pointer' : 'opacity-50'}`}>
              <input type="checkbox" className="h-5 w-5 accent-brand-800" disabled={!mine}
                checked={value.includes(key)} onChange={e => toggle(key, e.target.checked)} />
              {PERMISSION_LABELS[key]}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chipClass(detail, 'h-8 text-[13px]')} onClick={() => setDetail(v => !v)}>
          세부 권한 {detail ? '접기' : '펼치기'}
        </button>
        <button type="button" className={chipClass(false, 'h-8 text-[13px]')} onClick={() => onChange([])}>
          모두 해제
        </button>
      </div>
      {detail && <div className="grid gap-3 sm:grid-cols-2">
        {PERMISSION_GROUPS.map(g => (
          <div key={g.group} className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 text-xs font-bold tracking-wider text-muted-foreground">{g.group}</p>
            <div className="space-y-1">
              {g.items.map(item => {
                const mine = hasPermission(me, item.key);
                return (
                  <label key={item.key}
                    className={`flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm ${mine ? 'cursor-pointer hover:bg-accent' : 'opacity-50'}`}>
                    <input type="checkbox" className="h-5 w-5 accent-brand-800"
                      disabled={!mine}
                      checked={value.includes(item.key)}
                      onChange={e => toggle(item.key, e.target.checked)} />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
