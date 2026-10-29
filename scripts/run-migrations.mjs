#!/usr/bin/env node
/**
 * Supabase Management API 로 마이그레이션/SQL 파일을 순서대로 실행한다.
 *
 * 사용법:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migrations.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migrations.mjs supabase/seed_master.sql
 *
 * ACCESS TOKEN 발급: https://supabase.com/dashboard/account/tokens
 * PROJECT REF 는 .env.local 의 NEXT_PUBLIC_SUPABASE_URL 에서 자동 추출.
 */
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env.local') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 이 없습니다.'); process.exit(1); }
if (!URL_) { console.error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL 이 없습니다.'); process.exit(1); }

const ref = new URL(URL_).hostname.split('.')[0];

async function runSQL(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ ${label}\n    ${body}`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

const args = process.argv.slice(2);
const files = args.length
  ? args
  : readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
      .map(f => `supabase/migrations/${f}`);

console.log(`대상 프로젝트: ${ref}`);
console.log(`실행할 파일 ${files.length}개\n`);

for (const f of files) {
  const sql = readFileSync(resolve(root, f), 'utf-8');
  const ok = await runSQL(sql, f);
  if (!ok) { console.error('\n중단됨.'); process.exit(1); }
}
console.log('\n전체 완료.');
