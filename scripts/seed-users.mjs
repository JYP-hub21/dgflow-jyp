/**
 * DG-Flow 마스터 계정 시딩
 *
 * 역할 5종(관리자/공사관리부/경영지원팀/생산관리팀/시스템관리자)과 그에 딸린
 * 테스트 계정 8개는 모두 정리했다. 이제 전권을 가진 마스터 계정 하나만 시딩하고,
 * 사원 계정은 마스터가 "사용자 관리" 화면에서 추가한 뒤 기능 권한을 지정한다.
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
  { email: 'admin@dgflow.kr', password: 'dgflow2026!', name: '김경영', role: 'master', department: '경영진' },
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

  console.log('\nDone! Master account:');
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
