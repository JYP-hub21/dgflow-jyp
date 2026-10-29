/**
 * ERP 업로드용 엑셀 파일 생성
 *
 * 실제 양식(ERP-2026년.xlsx)과 같은 구조로 쓴다.
 *  - 4열: 위치 | 규 | 격 | 수량
 *  - 1행이 헤더이고, "규" 와 "격" 이 각각 가로·세로 칸의 머리글이다 (병합이 아니라 두 칸에 나눠 적혀 있다)
 *  - 시트 1장 = 포장 1개
 */
import * as XLSX from 'xlsx';
import type { ErpUploadBuild } from './upload-sheet';

/** 실제 ERP 양식의 헤더 — 가로/세로 자리에 "규", "격" 이 나눠 들어간다. */
const HEADER = ['위치', '규', '격', '수량'];

export function buildErpUploadWorkbook(build: ErpUploadBuild): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  for (const sheet of build.sheets) {
    const aoa: (string | number)[][] = [HEADER];
    for (const row of sheet.rows) {
      aoa.push([row.location, row.width_mm, row.height_mm, row.quantity]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 44 }, { wch: 9 }, { wch: 9 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheet_name);
  }

  // 포장에 못 들어간 품목은 버리지 않고 별도 시트로 남긴다.
  // ERP 에 그대로 올릴 값이 아니라 사람이 처리해야 할 잔여분이라는 뜻에서 이름을 구분한다.
  if (build.unassigned.length > 0) {
    const aoa: (string | number)[][] = [['위치(원본)', '품명', '가로', '세로', '수량']];
    for (const u of build.unassigned) {
      const loc = [u.location_dong, u.location_line, u.location_type, u.location_floor, u.location_room]
        .filter(Boolean)
        .join(' ');
      aoa.push([loc, u.product_name, u.width_mm, u.height_mm, u.quantity]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 40 }, { wch: 28 }, { wch: 9 }, { wch: 9 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, '_미배정');
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER]), '빈 시트');
  }

  return wb;
}

/** 브라우저에서 바로 내려받을 수 있는 Blob */
export function erpUploadBlob(build: ErpUploadBuild): Blob {
  return toBlob(buildErpUploadWorkbook(build));
}

/**
 * 포장 한 개만 담은 파일.
 *
 * 실물 ERP 파일은 한 통에 시트를 여러 장 담아 두지만,
 * ERP에 한 건씩 올리는 쪽이 편할 수 있어 포장 단위로도 뽑을 수 있게 둔다.
 */
export function erpUploadOneBlob(build: ErpUploadBuild, index: number): Blob {
  const sheet = build.sheets[index];
  if (!sheet) throw new Error(`${index}번 포장이 없습니다.`);
  return toBlob(
    buildErpUploadWorkbook({ ...build, sheets: [sheet], unassigned: [] }),
  );
}

function toBlob(wb: XLSX.WorkBook): Blob {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** `ERP업로드_우미-남원주_7차_20260918.xlsx` 형태의 파일명 */
export function erpUploadFileName(siteName: string, sheetName: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return ['ERP업로드', safe(siteName), safe(sheetName), stamp].filter(Boolean).join('_') + '.xlsx';
}
