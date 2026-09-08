/**
 * DG-Flow DB 유틸리티
 *
 * 사용법:
 *   node scripts/db.mjs "SELECT * FROM dgflow_users"                    -- SELECT (exec_sql RPC, 빠름)
 *   node scripts/db.mjs --ddl "CREATE TABLE dgflow_test (id serial)"    -- DDL/DML (supabase db query)
 *   node scripts/db.mjs --ddl -f supabase/migrations/001.sql            -- SQL 파일 실행
 *   node scripts/db.mjs tables                                           -- dgflow_ 테이블 목록
 *   node scripts/db.mjs all-tables                                       -- 전체 테이블 목록
 *   node scripts/db.mjs describe <table>                                 -- 테이블 컬럼 구조
 *   node scripts/db.mjs count <table>                                    -- 행 수
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
config({ path: resolve(projectRoot, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// === SELECT 전용: exec_sql RPC (빠름) ===
async function execSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!res.ok) {
    const err = await res.json();
    console.error('SQL Error:', err.message || err.details || JSON.stringify(err));
    process.exit(1);
  }

  return await res.json();
}

// === DDL/DML: supabase db query (느리지만 모든 SQL 가능) ===
function execDDL(sql) {
  try {
    const result = execSync(`echo "${sql.replace(/"/g, '\\"')}" | npx supabase db query --linked`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    try {
      const parsed = JSON.parse(result.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}');
      return parsed.rows || [];
    } catch {
      // JSON이 아닌 경우 raw 출력
      console.log(result);
      return [];
    }
  } catch (err) {
    console.error('DDL Error:', err.stderr || err.message);
    process.exit(1);
  }
}

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log('(0 rows)');
    return;
  }
  console.table(rows);
  console.log(`(${rows.length} rows)`);
}

// --- 명령어 파싱 ---
const args = process.argv.slice(2);
let ddlMode = false;
let fileMode = null;
const filtered = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ddl') { ddlMode = true; continue; }
  if (args[i] === '-f' && args[i+1]) { fileMode = args[++i]; continue; }
  filtered.push(args[i]);
}

const command = filtered.join(' ').trim();

if (!command && !fileMode) {
  console.log(`DG-Flow DB Utility

Usage:
  node scripts/db.mjs "<SELECT ...>"              SELECT 실행 (exec_sql, 빠름)
  node scripts/db.mjs --ddl "<CREATE/INSERT...>"   DDL/DML 실행 (supabase db query)
  node scripts/db.mjs --ddl -f <file.sql>          SQL 파일 실행
  node scripts/db.mjs tables                       dgflow_* 테이블 목록
  node scripts/db.mjs all-tables                   전체 테이블 목록
  node scripts/db.mjs describe <table>             테이블 컬럼 구조
  node scripts/db.mjs count <table>                행 수`);
  process.exit(0);
}

// --- SQL 파일 실행 ---
if (fileMode) {
  const sqlPath = resolve(projectRoot, fileMode);
  const sql = readFileSync(sqlPath, 'utf-8');
  console.log(`Executing: ${fileMode}`);
  const rows = execDDL(sql);
  printTable(rows);
  process.exit(0);
}

// --- 단축 명령어 ---
if (command === 'tables') {
  const rows = await execSQL(`
    SELECT table_name,
           (SELECT count(*) FROM information_schema.columns c
            WHERE c.table_name = t.table_name AND c.table_schema = 'public') as columns
    FROM information_schema.tables t
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE 'dgflow_%'
    ORDER BY table_name
  `);
  if (rows.length === 0) {
    console.log('\ndgflow_* 테이블이 아직 없습니다.\n');
  } else {
    console.log(`\n=== dgflow_* 테이블 (${rows.length}개) ===`);
    printTable(rows);
  }
} else if (command === 'all-tables') {
  const rows = await execSQL(`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  printTable(rows);
} else if (command.startsWith('describe ')) {
  const table = command.replace('describe ', '').trim();
  const rows = await execSQL(`
    SELECT column_name, data_type, is_nullable, column_default,
           character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}'
    ORDER BY ordinal_position
  `);
  if (rows.length === 0) {
    console.error(`Table '${table}' not found.`);
  } else {
    console.log(`\n=== ${table} ===`);
    printTable(rows);
  }
} else if (command.startsWith('count ')) {
  const table = command.replace('count ', '').trim();
  const rows = await execSQL(`SELECT count(*) as count FROM ${table}`);
  console.log(`${table}: ${rows[0]?.count ?? 'error'} rows`);
} else if (ddlMode) {
  // DDL/DML 모드
  const rows = execDDL(command);
  printTable(rows);
} else {
  // 기본: SELECT (exec_sql RPC)
  const rows = await execSQL(command);
  printTable(rows);
}
