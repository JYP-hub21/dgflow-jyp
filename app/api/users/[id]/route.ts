import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission, normalizePermissions } from '@/lib/auth/role-guard';
import { birthDateError, normalizePhone, passwordError, toAuthPassword } from '@/lib/auth/account';
import { USER_COLUMNS } from '@/lib/auth/create-account';
import { USER_ROLES, type UserRole } from '@/types/user';
import { NextRequest, NextResponse } from 'next/server';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * 사용자 정보 · 역할 · 권한 고치기, 가입 승인(approve), 비밀번호 초기화(password).
 *
 * 사용자 관리 권한을 받은 사원이 자기를 마스터로 올리거나 자기에게 없는 권한을
 * 남에게 나눠 주면 권한 체계가 무너진다. 그래서
 *   - 역할(마스터/사원)은 마스터만 바꾼다
 *   - 사원 관리자는 자기가 가진 권한 안에서만 주고 뺀다
 *   - 마스터 계정의 정보 · 비밀번호는 마스터만 고친다
 *   - 자기 자신을 비활성화하거나 마스터에서 내리지 못한다 (관리자가 0명이 되는 것 방지)
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/users/[id]'>) {
  const me = await getCurrentUser();
  if (!me) return bad('Unauthorized', 401);
  if (!hasPermission(me, 'admin:users')) return bad('사용자를 관리할 권한이 없습니다.', 403);

  const { id } = await ctx.params;
  const body = await request.json();
  const supabase = createServiceRoleClient();

  const { data: target } = await supabase
    .from('dgflow_users')
    .select('id, auth_id, role, permissions, status')
    .eq('id', id)
    .single();
  if (!target) return bad('사용자를 찾을 수 없습니다.', 404);
  if (target.role === 'master' && me.role !== 'master') return bad('마스터 계정은 마스터만 고칠 수 있습니다.', 403);

  const update: Record<string, unknown> = {};

  if (typeof body.name === 'string') {
    if (!body.name.trim()) return bad('이름을 비울 수 없습니다.');
    update.name = body.name.trim();
  }
  if ('department' in body) update.department = body.department?.trim() || null;
  if ('position' in body) update.position = body.position?.trim() || null;
  if ('phone' in body) {
    if (!body.phone) update.phone = null;
    else {
      const phone = normalizePhone(String(body.phone));
      if (!phone) return bad('전화번호를 확인하세요.');
      update.phone = phone;
    }
  }
  if ('birth_date' in body) {
    if (!body.birth_date) update.birth_date = null;
    else {
      const err = birthDateError(String(body.birth_date));
      if (err) return bad(err);
      update.birth_date = body.birth_date;
    }
  }

  if (typeof body.is_active === 'boolean') {
    if (target.id === me.id && !body.is_active) return bad('자기 계정은 비활성화할 수 없습니다.');
    update.is_active = body.is_active;
  }

  if (body.approve === true) {
    if (target.status !== 'pending') return bad('이미 승인된 계정입니다.');
    update.status = 'active';
    update.approved_by = me.id;
    update.approved_at = new Date().toISOString();
  }

  if (body.role !== undefined && body.role !== target.role) {
    if (!(body.role in USER_ROLES)) return bad('알 수 없는 역할입니다.');
    if (me.role !== 'master') return bad('역할은 마스터만 바꿀 수 있습니다.', 403);
    if (target.id === me.id) return bad('자기 계정의 역할은 바꿀 수 없습니다.');
    update.role = body.role as UserRole;
  }

  if (Array.isArray(body.permissions)) {
    const next = normalizePermissions(body.permissions.map(String));
    if (me.role !== 'master') {
      // 바뀌는 권한(새로 주거나 빼는 것)이 전부 내가 가진 것이어야 한다
      const before = new Set<string>(target.permissions ?? []);
      const changed = [...next.filter(k => !before.has(k)), ...[...before].filter(k => !next.includes(k))];
      if (changed.some(k => !hasPermission(me, k))) return bad('자기에게 없는 권한은 주거나 뺄 수 없습니다.', 403);
    }
    update.permissions = next;
  }

  if (typeof body.password === 'string') {
    const err = passwordError(body.password);
    if (err) return bad(err);
    const { error } = await supabase.auth.admin.updateUserById(target.auth_id, {
      password: toAuthPassword(body.password),
    });
    if (error) return bad(error.message, 500);
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ success: true });

  const { data, error } = await supabase
    .from('dgflow_users')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(USER_COLUMNS)
    .single();
  if (error) return bad(error.message, 500);

  return NextResponse.json({ data });
}

/**
 * 가입 신청 거절 — 승인 대기 계정만 지운다. 지우면 그 아이디로 다시 신청할 수 있다.
 * 쓰던 계정은 기록(생산 실적 작성자 등)이 걸려 있어 지우지 않고 비활성화한다.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/users/[id]'>) {
  const me = await getCurrentUser();
  if (!me) return bad('Unauthorized', 401);
  if (!hasPermission(me, 'admin:users')) return bad('사용자를 관리할 권한이 없습니다.', 403);

  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  const { data: target } = await supabase
    .from('dgflow_users').select('id, auth_id, status').eq('id', id).single();
  if (!target) return bad('사용자를 찾을 수 없습니다.', 404);
  if (target.status !== 'pending') return bad('승인된 계정은 지우지 않고 비활성화합니다.');

  const { error } = await supabase.from('dgflow_users').delete().eq('id', id);
  if (error) return bad(error.message, 500);
  if (target.auth_id) await supabase.auth.admin.deleteUser(target.auth_id);

  return NextResponse.json({ success: true });
}
