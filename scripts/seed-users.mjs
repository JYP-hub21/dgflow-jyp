/**
 * DG-Flow 테스트 사용자 5명 생성
 * 역할별 1명씩: admin, construction_mgr, biz_support, production_mgr, system_admin
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TEST_USERS = [
  { email: 'admin@dgflow.kr', password: 'dgflow2026!', name: '김경영', role: 'admin', department: '경영진' },
  { email: 'construction@dgflow.kr', password: 'dgflow2026!', name: '박공사', role: 'construction_mgr', department: '공사관리부' },
  { email: 'support@dgflow.kr', password: 'dgflow2026!', name: '이지원', role: 'biz_support', department: '경영지원팀' },
  { email: 'production@dgflow.kr', password: 'dgflow2026!', name: '최생산', role: 'production_mgr', department: '생산관리팀' },
  { email: 'sysadmin@dgflow.kr', password: 'dgflow2026!', name: '정시스', role: 'system_admin', department: '시스템관리' },
];

async function seedUsers() {
  for (const user of TEST_USERS) {
    console.log(`Creating: ${user.email} (${user.role})...`);

    // 1. Auth 사용자 생성
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log(`  -> Already exists, fetching...`);
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const existing = users?.find(u => u.email === user.email);
        if (existing) {
          await upsertDgflowUser(existing.id, user);
        }
        continue;
      }
      console.error(`  Auth error: ${authError.message}`);
      continue;
    }

    // 2. dgflow_users 테이블에 등록
    await upsertDgflowUser(authData.user.id, user);
  }

  console.log('\nDone! Test accounts:');
  TEST_USERS.forEach(u => console.log(`  ${u.email} / ${u.password} (${u.role})`));
}

async function upsertDgflowUser(authId, user) {
  const { error } = await supabase
    .from('dgflow_users')
    .upsert({
      auth_id: authId,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    }, { onConflict: 'auth_id' });

  if (error) {
    console.error(`  DB error: ${error.message}`);
  } else {
    console.log(`  -> OK`);
  }
}

seedUsers();
