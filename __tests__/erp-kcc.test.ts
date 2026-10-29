// @vitest-environment node
/**
 * KCC건설 여의도 오피스텔 — 발주서 → ERP 업로드 엑셀 전수 대조.
 *
 * 기준 자료 (전부 실물)
 *   발주서   : 엑셀 자료/KCC건설 여의도오피스텔 발주서.xlsx  시트 `2026.09.17`
 *   규격정리 : 엑셀 자료/규격정리-KCC건설.xlsx              826~901행 (사람이 만든 중간 산출물)
 *   ERP      : 엑셀 자료/ERP-2026년 - KCC추가.xlsx          `케이씨씨여의도급`, `케이씨씨여의도급 (2)`
 *
 * 이 체인에서 사람이 판단한 것은 **품명 변환 하나뿐**이고,
 * 나머지(행·순서·위치 문자열·포장 분리)는 전부 기계적이다.
 * ERP 양식에는 품명 열이 없으므로 우리 출력은 실물과 문자 단위로 같아야 한다.
 *
 * 우미 발주서(`erp-upload.test.ts`)와 **같은 양식인데 위치를 적는 칸이 다르다**.
 * 두 테스트가 같이 통과해야 한 코드가 두 양식을 다 처리한다는 뜻이다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { scanOrderSheet } from '@/lib/parser/order-scan';
import { rowsFromScan, packagesFromScan } from '@/lib/erp/from-scan';
import { buildErpUpload } from '@/lib/erp/upload-sheet';
import { reconcile } from '@/lib/erp/reconcile';

const DIR = path.join(process.cwd(), '엑셀 자료');
const ORDER_FILE = path.join(DIR, 'KCC건설 여의도오피스텔 발주서.xlsx');
const ERP_FILE = path.join(DIR, 'ERP-2026년 - KCC추가.xlsx');
const SHEET = '2026.09.17';

const hasFixture = fs.existsSync(ORDER_FILE) && fs.existsSync(ERP_FILE);

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

function build() {
  const wb = XLSX.readFile(ORDER_FILE);
  const scan = scanOrderSheet(wb.Sheets[SHEET]);
  const rows = rowsFromScan(scan);
  const packages = packagesFromScan(scan);
  return { scan, rows, build: buildErpUpload(rows, packages, 'instruction') };
}

/** 실물 ERP 시트에서 `위치 | 가로 | 세로 | 수량` 을 읽는다. */
function readErpSheet(name: string) {
  const wb = XLSX.readFile(ERP_FILE);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
  return rows
    .slice(1)
    .filter(r => norm(r[0]))
    .map(r => ({ location: norm(r[0]), w: Number(r[1]), h: Number(r[2]), qty: Number(r[3]) }));
}

describe.skipIf(!hasFixture)('KCC 여의도 9/17 → ERP 업로드 엑셀', () => {
  it('회색 합계 행으로 포장 2장이 나온다', () => {
    const { build: b } = build();
    expect(b.sheets).toHaveLength(2);
    expect(b.sheets.map(s => s.total_quantity)).toEqual([56, 47]);
  });

  it('포장에 못 들어간 품목이 없다', () => {
    const { build: b } = build();
    expect(b.unassigned).toEqual([]);
  });

  it('검산이 전부 일치한다', () => {
    const { scan, build: b } = build();
    const r = reconcile(scan, b.total_quantity);
    const bad = r.lines.filter(l => l.ok === false);
    expect(bad).toEqual([]);
    expect(r.ok).toBe(true);
  });

  /**
   * 실물 ERP 는 위치 앞에 `구조마감` 이 붙어 있는 행이 있다.
   *
   * 그런데 그건 발주서 `비 고` 열에 적힌 값이 아니라, **사원이 자기가 아는 내용을 보고
   * 그때그때 판단해 덧붙인 것**이다. 고정된 규칙이 없어 기계가 맞힐 수 없다.
   * 그래서 우리는 비고 값만 넣고, 이런 부수 정보는 사원이 미리보기에서 직접 보탠다.
   *
   * 실물과 대조할 때는 그 사람 손길만 벗겨 내고 나머지를 전부 비교한다.
   */
  const stripManual = (s: string) => s.replace(/^구조마감\s*/, '');

  it.each([
    ['케이씨씨여의도급', 0],
    ['케이씨씨여의도급 (2)', 1],
  ])('실물 %s 와 행 수·위치·규격·수량이 전부 일치한다 (사원이 덧붙인 구조마감 제외)', (erpSheet, index) => {
    const { build: b } = build();
    const expected = readErpSheet(erpSheet as string);
    const actual = b.sheets[index as number].rows;

    expect(actual).toHaveLength(expected.length);

    const diffs: string[] = [];
    expected.forEach((e, i) => {
      const a = actual[i];
      if (!a) {
        diffs.push(`${i + 1}행 없음 — 실물 ${e.location} ${e.w}x${e.h} ${e.qty}`);
        return;
      }
      const e_location = stripManual(e.location);
      if (norm(a.location) !== e_location || a.width_mm !== e.w || a.height_mm !== e.h || a.quantity !== e.qty) {
        diffs.push(
          `${i + 1}행 실물[${e_location} ${e.w}x${e.h} ${e.qty}] ≠ 생성[${norm(a.location)} ${a.width_mm}x${a.height_mm} ${a.quantity}]`,
        );
      }
    });

    expect(diffs).toEqual([]);
  });

  it('같은 위치 · 같은 규격이 두 줄이면 합치지 않는다', () => {
    const { build: b } = build();
    const dup = b.sheets[1].rows.filter(
      r => r.width_mm === 1345 && r.height_mm === 2830,
    );
    // 실물 ERP 도 4장짜리 두 줄이다 (발주서 60행·78행). 합쳐서 8장 한 줄이 되면 안 된다.
    expect(dup.map(r => r.quantity)).toEqual([4, 4]);
  });

  it('스텝 유리의 내판 폭이 위치 문자열에 남아 있다', () => {
    const { build: b } = build();
    const step = b.sheets[1].rows.filter(r => r.location.includes('스텝'));
    // 비고 열에 적힌 그대로다. 실물에 붙어 있는 `구조마감` 은 사원이 덧붙인 것이라 넣지 않는다.
    expect(step.map(r => r.location)).toEqual([
      '근생/1층/38/AW 우스텝-1W:920',
      '근생/1층/38/AW 우스텝-2W;920',
      '근생/1층/38/AW 우스텝-3W:1385',
      '근생/1층/38/AW 우스텝-4W:1385',
      '근생/1층/38/AW 좌스텝-1W:1390',
      '근생/1층/38/AW 좌스텝-2W:1390',
    ]);
  });

  it('제품명에서 가져온 구조마감을 위치에 붙이지 않는다', () => {
    const { build: b } = build();
    // 위치는 발주서 `비 고` 열의 값이 전부다. 제품명 칸의 `구조마감`·`PJ-구조마감` 은
    // 사원이 필요하다고 판단할 때만 손으로 넣는 값이라 기계가 끼워 넣으면 안 된다.
    const all = b.sheets.flatMap(s => s.rows);
    expect(all.filter(r => r.location.includes('구조마감'))).toHaveLength(0);
  });
});

describe.skipIf(!hasFixture)('규격정리 엑셀 생성', () => {
  it('재(才) 계산이 실물 규격정리와 같다', async () => {
    const { buildSpecSheetWorkbook } = await import('@/lib/erp/spec-sheet');
    const { scan, build: b } = build();
    const wb = buildSpecSheetWorkbook(scan, b);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['규격정리'], {
      header: 1, defval: null,
    });

    // 실물 규격정리 828행: 구조마감 근생// · 195×540×1 · 재 1.1469463778060975
    const row = rows.find(r => r[1] === 195 && r[2] === 540 && r[3] === 1);
    expect(row).toBeDefined();
    expect(Number(row![4])).toBeCloseTo(1.1469463778060975, 6);
  });

  it('좌측은 발주서 순서, 우측은 ERP 순서다', async () => {
    const { buildSpecSheetWorkbook } = await import('@/lib/erp/spec-sheet');
    const { scan, build: b } = build();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      buildSpecSheetWorkbook(scan, b).Sheets['규격정리'], { header: 1, defval: null },
    );

    const header = rows.findIndex(r => r[0] === '위치');
    // 실물 828~837행: 좌측 첫 줄은 발주서 15행(195×540), 우측 첫 줄은 ERP 첫 줄(1028×2750)
    expect([rows[header + 1][1], rows[header + 1][2]]).toEqual([195, 540]);
    expect([rows[header + 1][7], rows[header + 1][8]]).toEqual([1028, 2750]);
  });
});
