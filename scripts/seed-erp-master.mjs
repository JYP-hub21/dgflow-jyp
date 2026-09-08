#!/usr/bin/env node
/**
 * ERP 마스터 데이터 시딩 스크립트
 * - 거래처 현장 품목명 목록.xlsx → dgflow_customers, dgflow_sites, dgflow_products
 * - 기존 데이터 유지, 신규만 추가
 * - 거래처명 뒤 알파벳(ERP 현장 구분용) 제거
 */
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── 엑셀 읽기 ──
const wb = XLSX.readFile(resolve(__dirname, '../data/1. 발주서 관련/2. 규격정리 파일/거래처 현장 품목명 목록.xlsx'));
const ws = wb.Sheets['ERP'];
const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const rows = rawRows.slice(1).filter(r => r[0] && r[0] !== '합계');

console.log(`ERP 데이터: ${rows.length}행 로드`);

// ── 거래처명 정규화: 끝의 소문자 알파벳 1~2자 제거 ──
function cleanCustomerName(name) {
  return name.toString().trim().replace(/[a-z]{1,2}$/, '');
}

// ── short_name 생성 ──
function makeShortName(name) {
  // (주) 제거, Corp 등 제거
  let s = name
    .replace(/\(주\)/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/주식회사/g, '')
    .trim();
  // 너무 길면 앞 6글자
  if (s.length > 8) s = s.slice(0, 8);
  return s || name;
}

// ── 1단계: 거래처 시딩 ──
async function seedCustomers() {
  // ERP에서 고유 거래처 추출
  const custSet = new Set();
  rows.forEach(r => {
    const name = cleanCustomerName(r[3] || '');
    if (name) custSet.add(name);
  });
  const erpCustomers = [...custSet].sort();
  console.log(`\n[거래처] ERP 고유 거래처: ${erpCustomers.length}개`);

  // 기존 거래처 조회
  const { data: existing } = await supabase
    .from('dgflow_customers')
    .select('id, name, short_name');

  const existingNames = new Set(existing.map(e => e.name));
  console.log(`[거래처] 기존 DB: ${existing.length}개`);

  // 기존 거래처명 수정 (ERP 기준 통일)
  const nameFixMap = {
    '대우건설(주)': '(주)대우건설',
    '엘엑스글라스(주)': '(주)엘엑스글라스',
    '정석개발(주)': '정석개발',
  };
  for (const old of existing) {
    if (nameFixMap[old.name]) {
      const newName = nameFixMap[old.name];
      const { error } = await supabase
        .from('dgflow_customers')
        .update({ name: newName, short_name: makeShortName(newName), updated_at: new Date().toISOString() })
        .eq('id', old.id);
      if (error) console.error(`  수정 실패: ${old.name} → ${newName}`, error.message);
      else console.log(`  수정: ${old.name} → ${newName}`);
      existingNames.delete(old.name);
      existingNames.add(newName);
    }
  }

  // 신규 거래처 추가
  const newCustomers = erpCustomers
    .filter(name => !existingNames.has(name))
    .map(name => ({
      name,
      short_name: makeShortName(name),
      is_active: true,
    }));

  if (newCustomers.length === 0) {
    console.log(`[거래처] 추가할 거래처 없음`);
    return;
  }

  console.log(`[거래처] 신규 추가: ${newCustomers.length}개`);

  // 50개씩 배치 insert
  for (let i = 0; i < newCustomers.length; i += 50) {
    const batch = newCustomers.slice(i, i + 50);
    const { error } = await supabase.from('dgflow_customers').insert(batch);
    if (error) {
      console.error(`  배치 ${i} 실패:`, error.message);
      // 개별 삽입 시도
      for (const c of batch) {
        const { error: e2 } = await supabase.from('dgflow_customers').insert(c);
        if (e2) console.error(`    ${c.name} 실패:`, e2.message);
      }
    }
  }

  console.log(`[거래처] 완료`);
}

// ── 2단계: 현장 시딩 ──
async function seedSites() {
  // ERP에서 거래처-현장 쌍 추출
  const siteMap = new Map(); // cleanCust -> Set<siteName>
  rows.forEach(r => {
    const cust = cleanCustomerName(r[3] || '');
    const site = (r[4] || '').toString().trim();
    if (!cust || !site) return;
    if (!siteMap.has(cust)) siteMap.set(cust, new Set());
    siteMap.get(cust).add(site);
  });

  let totalSites = 0;
  siteMap.forEach(s => totalSites += s.size);
  console.log(`\n[현장] ERP 고유 거래처-현장 쌍: ${totalSites}개`);

  // DB 거래처 조회 (id 매핑용)
  const { data: customers } = await supabase
    .from('dgflow_customers')
    .select('id, name');
  const custIdMap = new Map(customers.map(c => [c.name, c.id]));

  // 기존 현장 조회
  const { data: existingSites } = await supabase
    .from('dgflow_sites')
    .select('id, customer_id, site_name');
  const existingKeys = new Set(existingSites.map(s => `${s.customer_id}::${s.site_name}`));
  console.log(`[현장] 기존 DB: ${existingSites.length}개`);

  // 신규 현장 추가
  const newSites = [];
  for (const [cust, sites] of siteMap) {
    const custId = custIdMap.get(cust);
    if (!custId) {
      console.warn(`  거래처 미발견: ${cust}`);
      continue;
    }
    for (const site of sites) {
      const key = `${custId}::${site}`;
      if (!existingKeys.has(key)) {
        newSites.push({
          customer_id: custId,
          site_name: site,
          is_active: true,
        });
      }
    }
  }

  if (newSites.length === 0) {
    console.log(`[현장] 추가할 현장 없음`);
    return;
  }

  console.log(`[현장] 신규 추가: ${newSites.length}개`);

  for (let i = 0; i < newSites.length; i += 50) {
    const batch = newSites.slice(i, i + 50);
    const { error } = await supabase.from('dgflow_sites').insert(batch);
    if (error) {
      console.error(`  배치 ${i} 실패:`, error.message);
      for (const s of batch) {
        const { error: e2 } = await supabase.from('dgflow_sites').insert(s);
        if (e2) console.error(`    ${s.site_name} 실패:`, e2.message);
      }
    }
  }

  console.log(`[현장] 완료`);
}

// ── 3단계: 품명 시딩 ──
async function seedProducts() {
  // ERP에서 품명+두께 추출 (구분 TP/P/T만 = 유리 제품)
  const prodMap = new Map(); // erp_name -> { thicknesses, count }
  rows.forEach(r => {
    const cat = (r[5] || '').toString().trim();
    const name = (r[6] || '').toString().trim();
    const thickness = r[7];
    if (!name || !['TP', 'P', 'T'].includes(cat)) return;
    if (!prodMap.has(name)) prodMap.set(name, { thicknesses: new Set(), count: 0 });
    const entry = prodMap.get(name);
    entry.count++;
    if (thickness && !isNaN(Number(thickness))) entry.thicknesses.add(Number(thickness));
  });

  console.log(`\n[품명] ERP 고유 품명 (유리): ${prodMap.size}개`);

  // 기존 품명 조회
  const { data: existingProds } = await supabase
    .from('dgflow_products')
    .select('id, erp_name');
  const existingErpNames = new Set(existingProds.map(p => p.erp_name));
  console.log(`[품명] 기존 DB: ${existingProds.length}개`);

  // 신규 품명 추가
  const newProducts = [];
  for (const [name, info] of prodMap) {
    // 기존 DB는 "22T 5CL+12Ar.+5로이" 형식이지만, ERP에서는 "5CL+12Ar.+5로이"
    // 기존 erp_name에 두께 포함이므로, 두께+이름 조합도 체크
    const thicknesses = [...info.thicknesses];
    const mainThickness = thicknesses.length === 1 ? thicknesses[0] : null;

    // 기존 데이터에 두께T 포함 형식으로 있는지 체크
    if (existingErpNames.has(name)) continue;
    if (mainThickness && existingErpNames.has(`${mainThickness}T ${name}`)) continue;

    // product_code 자동 생성: P-0001 ~ P-9999
    newProducts.push({
      erp_name: name,
      display_name: name,
      product_code: `P-${String(newProducts.length + 1 + existingProds.length).padStart(4, '0')}`,
      thickness_mm: mainThickness || 0,
      is_active: true,
    });
  }

  if (newProducts.length === 0) {
    console.log(`[품명] 추가할 품명 없음`);
    return;
  }

  console.log(`[품명] 신규 추가: ${newProducts.length}개`);

  // 50개씩 배치
  for (let i = 0; i < newProducts.length; i += 50) {
    const batch = newProducts.slice(i, i + 50);
    const { error } = await supabase.from('dgflow_products').insert(batch);
    if (error) {
      console.error(`  배치 ${i} 실패:`, error.message);
      for (const p of batch) {
        const { error: e2 } = await supabase.from('dgflow_products').insert(p);
        if (e2) console.error(`    ${p.erp_name} 실패:`, e2.message);
      }
    }
  }

  console.log(`[품명] 완료`);
}

// ── 실행 ──
async function main() {
  console.log('=== ERP 마스터 데이터 시딩 시작 ===\n');
  await seedCustomers();
  await seedSites();
  await seedProducts();

  // 최종 확인
  const { count: custCount } = await supabase.from('dgflow_customers').select('*', { count: 'exact', head: true });
  const { count: siteCount } = await supabase.from('dgflow_sites').select('*', { count: 'exact', head: true });
  const { count: prodCount } = await supabase.from('dgflow_products').select('*', { count: 'exact', head: true });

  console.log('\n=== 최종 결과 ===');
  console.log(`거래처: ${custCount}개`);
  console.log(`현장: ${siteCount}개`);
  console.log(`품명: ${prodCount}개`);
}

main().catch(console.error);
