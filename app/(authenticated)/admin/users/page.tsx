'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Save, X } from 'lucide-react';
import { USER_ROLES, type UserRole } from '@/types/user';

interface UserRow {
  id: string;
  auth_id: string;
  email: string;
  name: string;
  role: UserRole;
  department: string | null;
  is_active: boolean;
}

interface NewUser {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  department: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  construction_mgr: 'bg-blue-100 text-blue-800',
  biz_support: 'bg-green-100 text-green-800',
  production_mgr: 'bg-orange-100 text-orange-800',
  system_admin: 'bg-red-100 text-red-800',
};

export default function UsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<Partial<UserRow> | null>(null);
  const [creating, setCreating] = useState<NewUser | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from('dgflow_users').select('*').order('name');
    setUsers(data || []);
  }

  async function handleCreate() {
    if (!creating) return;
    if (!creating.email || !creating.password || !creating.name) {
      setError('이메일, 비밀번호, 이름은 필수입니다.');
      return;
    }
    setError('');
    setSaving(true);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creating),
    });

    const result = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(result.error || '사용자 생성에 실패했습니다.');
      return;
    }

    setCreating(null);
    load();
  }

  async function handleUpdate() {
    if (!editing?.id) return;
    setSaving(true);
    await supabase.from('dgflow_users')
      .update({ name: editing.name, role: editing.role, department: editing.department, is_active: editing.is_active })
      .eq('id', editing.id);
    setSaving(false);
    setEditing(null);
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">사용자 관리</h1>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">사용자 ({users.length}명)</CardTitle>
          <Button size="sm" onClick={() => { setCreating({ email: '', password: 'dgflow2026!', name: '', role: 'construction_mgr', department: '' }); setEditing(null); }}>
            <Plus className="mr-1 h-4 w-4" />사용자 추가
          </Button>
        </CardHeader>
        <CardContent>
          {/* 새 사용자 생성 폼 */}
          {creating && (
            <div className="mb-4 p-4 border rounded-lg bg-blue-50 space-y-3">
              <p className="font-medium text-sm">새 사용자 등록</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">이메일 *</Label>
                  <Input className="h-8 text-sm" type="email" placeholder="user@dgflow.kr"
                    value={creating.email} onChange={e => setCreating({ ...creating, email: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">비밀번호 *</Label>
                  <Input className="h-8 text-sm" type="text"
                    value={creating.password} onChange={e => setCreating({ ...creating, password: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">이름 *</Label>
                  <Input className="h-8 text-sm" placeholder="홍길동"
                    value={creating.name} onChange={e => setCreating({ ...creating, name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">역할</Label>
                  <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                    value={creating.role} onChange={e => setCreating({ ...creating, role: e.target.value as UserRole })}>
                    {Object.entries(USER_ROLES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">부서</Label>
                  <Input className="h-8 text-sm" placeholder="공사관리부"
                    value={creating.department} onChange={e => setCreating({ ...creating, department: e.target.value })} />
                </div>
                <div className="flex items-end gap-2">
                  <Button size="sm" onClick={handleCreate} disabled={saving}>
                    <Save className="mr-1 h-3 w-3" />{saving ? '등록 중...' : '등록'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setCreating(null); setError(''); }}>
                    <X className="mr-1 h-3 w-3" />취소
                  </Button>
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}

          {/* 수정 폼 */}
          {editing && (
            <div className="mb-4 p-4 border rounded-lg bg-yellow-50 space-y-3">
              <p className="font-medium text-sm">사용자 수정: {editing.email}</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">이름</Label>
                  <Input className="h-8 text-sm" value={editing.name || ''}
                    onChange={e => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">역할</Label>
                  <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                    value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as UserRole })}>
                    {Object.entries(USER_ROLES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">부서</Label>
                  <Input className="h-8 text-sm" value={editing.department || ''}
                    onChange={e => setEditing({ ...editing, department: e.target.value })} />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                    활성
                  </label>
                  <Button size="sm" onClick={handleUpdate} disabled={saving}>
                    <Save className="mr-1 h-3 w-3" />저장
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    <X className="mr-1 h-3 w-3" />취소
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>부서</TableHead>
                <TableHead>상태</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Badge className={ROLE_COLORS[u.role] || ''} variant="secondary">
                      {USER_ROLES[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{u.department || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? 'default' : 'secondary'}>
                      {u.is_active ? '활성' : '비활성'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(u); setCreating(null); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
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
