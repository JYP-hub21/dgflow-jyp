import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
wb.creator = 'DG-Flow';
wb.created = new Date();

const ws = wb.addWorksheet('표준 발주서', {
  pageSetup: {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  },
  properties: { defaultRowHeight: 20 },
});

// 9열 구조 (A~I): 김길홍/오동석 원본과 동일
ws.columns = [
  { width: 12 },   // A: 위치
  { width: 30 },   // B: 제품명
  { width: 10 },   // C: 두께(mm)
  { width: 10 },   // D: 가로
  { width: 10 },   // E: 세로
  { width: 7.5 },  // F: 수량
  { width: 12 },   // G: 평수
  { width: 12 },   // H: 실리콘
  { width: 30 },   // I: 비고
];

// ---- Style definitions ----
const thinBorder = { style: 'thin', color: { argb: 'FF000000' } };
const mediumBorder = { style: 'medium', color: { argb: 'FF000000' } };
const allThinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const allMediumBorders = { top: mediumBorder, bottom: mediumBorder, left: mediumBorder, right: mediumBorder };

const headerLabelFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const tableHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const subtotalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

const titleFont = { name: '맑은 고딕', size: 20, bold: true };
const headerLabelFont = { name: '맑은 고딕', size: 10, bold: true };
const headerValueFont = { name: '맑은 고딕', size: 10 };
const tableHeaderFont = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const dataFont = { name: '맑은 고딕', size: 9.5 };
const subtotalFont = { name: '맑은 고딕', size: 9.5, bold: true };

const centerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true };
const leftAlign = { horizontal: 'left', vertical: 'middle', wrapText: true };

// ============================================
// Row 1~3: 타이틀 (3행 병합) + 발주번호
// ============================================
ws.getRow(1).height = 20;
ws.getRow(2).height = 20;
ws.getRow(3).height = 20;

// A1:G3 타이틀 병합
ws.mergeCells('A1:G3');
const titleCell = ws.getCell('A1');
titleCell.value = '발   주   서';
titleCell.font = titleFont;
titleCell.alignment = centerAlign;
titleCell.border = {
  top: mediumBorder, left: mediumBorder, right: thinBorder,
  bottom: { style: 'double', color: { argb: 'FF4472C4' } },
};

// H1: 발주번호 라벨
ws.getCell('H1').value = '발주번호';
ws.getCell('H1').font = { name: '맑은 고딕', size: 9, bold: true };
ws.getCell('H1').alignment = centerAlign;
ws.getCell('H1').fill = headerLabelFill;
ws.getCell('H1').border = { top: mediumBorder, left: thinBorder, right: thinBorder, bottom: thinBorder };

ws.getCell('I1').value = '';
ws.getCell('I1').border = { top: mediumBorder, left: thinBorder, right: mediumBorder, bottom: thinBorder };

// H2:I2 발주번호 값
ws.mergeCells('H2:I2');
ws.getCell('H2').value = '';
ws.getCell('H2').font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0000FF' } };
ws.getCell('H2').alignment = centerAlign;
ws.getCell('H2').border = { top: thinBorder, left: thinBorder, right: mediumBorder, bottom: thinBorder };

// H3:I3 빈 행 (타이틀 높이 맞춤)
ws.mergeCells('H3:I3');
ws.getCell('H3').border = { top: thinBorder, left: thinBorder, right: mediumBorder, bottom: mediumBorder };

// ============================================
// Row 4~7: 헤더 정보
// ============================================
function addHeaderRow(rowNum, label1, mergeRange1, label2Col, label2, mergeRange2) {
  const row = ws.getRow(rowNum);
  row.height = 24;

  // Label 1 (A열)
  const l1 = ws.getCell(`A${rowNum}`);
  l1.value = label1;
  l1.font = headerLabelFont;
  l1.alignment = centerAlign;
  l1.fill = headerLabelFill;
  l1.border = allThinBorders;

  // Value 1
  ws.mergeCells(mergeRange1);
  const v1 = ws.getCell(`B${rowNum}`);
  v1.font = headerValueFont;
  v1.alignment = leftAlign;
  v1.border = allThinBorders;

  // Label 2
  if (label2) {
    const l2 = ws.getCell(`${label2Col}${rowNum}`);
    l2.value = label2;
    l2.font = headerLabelFont;
    l2.alignment = centerAlign;
    l2.fill = headerLabelFill;
    l2.border = allThinBorders;

    // Value 2
    ws.mergeCells(mergeRange2);
    // mergeRange2의 시작 셀 (label2Col 다음 열)
    const startCol = String.fromCharCode(label2Col.charCodeAt(0) + 1);
    const v2 = ws.getCell(`${startCol}${rowNum}`);
    v2.font = headerValueFont;
    v2.alignment = leftAlign;
    v2.border = allThinBorders;
  }
}

addHeaderRow(4, '공 사 명', 'B4:F4', 'G', '시 공 자', 'H4:I4');
addHeaderRow(5, '수   신', 'B5:E5', 'F', '발   신', 'G5:I5');
addHeaderRow(6, '발 주 일', 'B6:E6', 'F', '검 측 자', 'G6:I6');

// Row 7: 출고일 + 도착장소 (원본 구조)
ws.getRow(7).height = 24;
ws.getCell('A7').value = '출 고 일';
ws.getCell('A7').font = headerLabelFont;
ws.getCell('A7').alignment = centerAlign;
ws.getCell('A7').fill = headerLabelFill;
ws.getCell('A7').border = allThinBorders;

ws.mergeCells('B7:E7');
ws.getCell('B7').font = headerValueFont;
ws.getCell('B7').alignment = leftAlign;
ws.getCell('B7').border = allThinBorders;

ws.getCell('F7').value = '도착장소';
ws.getCell('F7').font = headerLabelFont;
ws.getCell('F7').alignment = centerAlign;
ws.getCell('F7').fill = headerLabelFill;
ws.getCell('F7').border = allThinBorders;

ws.mergeCells('G7:I7');
ws.getCell('G7').font = headerValueFont;
ws.getCell('G7').alignment = leftAlign;
ws.getCell('G7').border = allThinBorders;

// ============================================
// Row 8~9: 빈 행
// ============================================
ws.getRow(8).height = 6;
ws.getRow(9).height = 6;

// ============================================
// Row 10~11: 메시지
// ============================================
ws.getRow(10).height = 22;
ws.mergeCells('A10:I10');
ws.getCell('A10').value = '아래 제품을 출고(주문)요청하오니 위 공사에 납품하여 주시기 바랍니다.';
ws.getCell('A10').font = { name: '맑은 고딕', size: 10 };
ws.getCell('A10').alignment = { horizontal: 'left', vertical: 'middle' };

ws.getRow(11).height = 20;
ws.mergeCells('A11:I11');
ws.getCell('A11').value = '※ 발주서 별 포장 요망';
ws.getCell('A11').font = { name: '맑은 고딕', size: 9, color: { argb: 'FFFF0000' } };
ws.getCell('A11').alignment = { horizontal: 'left', vertical: 'middle' };

// ============================================
// Row 12~13: 테이블 헤더 (원본과 동일한 2행 구조)
// ============================================
ws.getRow(12).height = 26;
ws.getRow(13).height = 26;

// 병합: 위치, 제품명, 수량, 평수, 실리콘, 비고는 2행 병합
ws.mergeCells('A12:A13'); // 위치
ws.mergeCells('B12:B13'); // 제품명
ws.mergeCells('C12:E12'); // 규격 (3열 가로 병합)
ws.mergeCells('F12:F13'); // 수량
ws.mergeCells('G12:G13'); // 평수
ws.mergeCells('H12:H13'); // 실리콘
ws.mergeCells('I12:I13'); // 비고

const tableHeaders = [
  ['A12', '위 치'],
  ['B12', '제 품 명'],
  ['C12', '규      격'],
  ['F12', '수 량'],
  ['G12', '평 수'],
  ['H12', '실리콘'],
  ['I12', '비 고'],
  ['C13', '두께(mm)'],
  ['D13', '가 로'],
  ['E13', '세 로'],
];

for (const [ref, val] of tableHeaders) {
  const cell = ws.getCell(ref);
  cell.value = val;
  cell.font = tableHeaderFont;
  cell.alignment = centerAlign;
  cell.fill = tableHeaderFill;
  cell.border = { top: mediumBorder, bottom: mediumBorder, left: thinBorder, right: thinBorder };
}

// 좌우 외곽 medium
for (const ref of ['A12', 'A13']) {
  ws.getCell(ref).border = { ...ws.getCell(ref).border, left: mediumBorder };
}
for (const ref of ['I12', 'I13']) {
  ws.getCell(ref).border = { ...ws.getCell(ref).border, right: mediumBorder };
}

// ============================================
// Row 14+: 샘플 데이터 (원본 패턴 그대로)
// ============================================
const sampleData = [
  { loc: '9동', prod: '5GN+12AR+5LE', thick: '22T', w: 766, h: 1963, qty: 12, area: 18.05, sil: 130.99, note: '9동 1-6라인 55A,B,F 거실 외창-S', type: 'data' },
  { loc: '', prod: '단열간봉,아르곤', thick: '', w: 1650, h: 1963, qty: 12, area: 38.87, sil: 173.42, note: '9동 1-6라인 55A,B,F 거실 외창-F', type: 'data' },
  { loc: '', prod: '', thick: '', w: 608, h: 963, qty: 24, area: 14.05, sil: 150.82, note: '9동 1-6라인 55A,B,F 침실 외창', type: 'data' },
  { loc: '', prod: '', thick: '', w: 458, h: 963, qty: 24, area: 10.58, sil: 136.42, note: '9동 1-6라인 55A,B,F 알파룸 외창', type: 'data' },
  { loc: '', prod: '', thick: '', w: 463, h: 161, qty: 24, area: 1.79, sil: 59.90, note: '9동 1-6라인 55A,B,F 주방/식당 외창', type: 'data' },
  { loc: '', prod: '', thick: '', w: '계', h: '', qty: 96, area: 83.34, sil: 651.55, note: '', type: 'subtotal' },
  { type: 'empty' },
  { loc: '', prod: '5CL+12AR+5LE', thick: '22T', w: 761, h: 1953, qty: 12, area: 17.83, sil: 130.27, note: '9동 1-6라인 55A,B,F 거실 내창-S', type: 'data' },
  { loc: '', prod: '단열간봉,아르곤', thick: '', w: 1643, h: 1953, qty: 12, area: 38.49, sil: 172.61, note: '9동 1-6라인 55A,B,F 거실 내창-F', type: 'data' },
  { loc: '', prod: '', thick: '', w: 603, h: 953, qty: 24, area: 13.79, sil: 149.38, note: '9동 1-6라인 55A,B,F 침실 내창', type: 'data' },
  { loc: '', prod: '', thick: '', w: 453, h: 953, qty: 24, area: 10.36, sil: 134.98, note: '9동 1-6라인 55A,B,F 알파룸 내창', type: 'data' },
  { loc: '', prod: '', thick: '', w: 458, h: 151, qty: 24, area: 1.66, sil: 58.46, note: '9동 1-6라인 55A,B,F 주방/식당 내창', type: 'data' },
  { loc: '', prod: '', thick: '', w: '계', h: '', qty: 96, area: 82.13, sil: 645.70, note: '', type: 'subtotal' },
  { type: 'empty' },
  { loc: 'カ자리', prod: '6GN+12A+6LE', thick: '24T', w: 310, h: 770, qty: 24, area: 5.73, sil: 103.68, note: '9동 1-6라인 55A,B,F 세탁실 단창', type: 'data' },
  { loc: '', prod: '단열간봉', thick: '', w: 608, h: 1768, qty: 18, area: 19.35, sil: 171.07, note: '9동 1-6라인 55A,B,F 발코니 단창', type: 'data' },
  { loc: '', prod: '', thick: '', w: '계', h: '', qty: 42, area: 25.08, sil: 274.75, note: '', type: 'subtotal' },
];

const colKeys = ['loc', 'prod', 'thick', 'w', 'h', 'qty', 'area', 'sil', 'note'];

for (let i = 0; i < sampleData.length; i++) {
  const d = sampleData[i];
  const rowNum = 14 + i;
  const row = ws.getRow(rowNum);

  if (d.type === 'empty') {
    row.height = 6;
    for (let c = 1; c <= 9; c++) {
      row.getCell(c).border = { left: thinBorder, right: thinBorder };
    }
    row.getCell(1).border = { ...row.getCell(1).border, left: mediumBorder };
    row.getCell(9).border = { ...row.getCell(9).border, right: mediumBorder };
    continue;
  }

  row.height = 22;

  for (let c = 0; c < colKeys.length; c++) {
    const cell = row.getCell(c + 1);
    const val = d[colKeys[c]];

    if (val !== '' && val !== undefined) {
      cell.value = val;
    }

    // Font
    cell.font = d.type === 'subtotal' ? subtotalFont : dataFont;

    // Alignment
    if (c === 0) { // 위치
      cell.alignment = centerAlign;
    } else if (c === 1) { // 제품명
      cell.alignment = leftAlign;
    } else if (c >= 2 && c <= 5) { // 두께, 가로, 세로, 수량
      cell.alignment = centerAlign;
    } else if (c === 6 || c === 7) { // 평수, 실리콘
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.numFmt = '#,##0.00';
    } else { // 비고
      cell.alignment = leftAlign;
    }

    // Fill
    if (d.type === 'subtotal') {
      cell.fill = subtotalFill;
      if (c === 1) cell.alignment = centerAlign; // "계" 중앙정렬
    } else if (i % 2 === 1 && d.type === 'data') {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    }

    // Borders
    cell.border = { ...allThinBorders };
    if (c === 0) cell.border.left = mediumBorder;
    if (c === 8) cell.border.right = mediumBorder;
  }
}

// 마지막 데이터 행 하단 medium border
const lastDataRow = 14 + sampleData.length - 1;
for (let c = 1; c <= 9; c++) {
  const cell = ws.getRow(lastDataRow).getCell(c);
  cell.border = { ...cell.border, bottom: mediumBorder };
}

// ============================================
// Sheet 2: 양식 설명
// ============================================
const ws2 = wb.addWorksheet('양식 설명', {
  properties: { defaultRowHeight: 20 },
});

ws2.columns = [
  { width: 22 },
  { width: 55 },
  { width: 38 },
];

const descData = [
  { vals: ['DG-Flow 표준 발주서 양식 설명', '', ''], isTitle: true },
  { vals: ['', '', ''] },
  { vals: ['[기본 구조 - 김길홍/오동석 양식 기반 (9열, A~I)]', '', ''], isSection: true },
  { vals: ['영역', '설명', '비고'], isTableHeader: true },
  { vals: ['Row 1~3', '발주서 타이틀 (3행 병합) + 발주번호', 'A1:G3 병합, H1~I2 발주번호'] },
  { vals: ['Row 4~7', '헤더 정보 (공사명/수신/발주일/출고일)', '라벨+값 쌍'] },
  { vals: ['Row 10~11', '요청 메시지 + 포장 안내', ''] },
  { vals: ['Row 12~13', '테이블 헤더 (2행)', '규격 3열 가로 병합'] },
  { vals: ['Row 14~', '품목 데이터 (소계/합계 포함)', '제품별 소계 행'] },
  { vals: ['', '', ''] },
  { vals: ['[헤더 필드]', '', ''], isSection: true },
  { vals: ['필드', '설명', '출처'], isTableHeader: true },
  { vals: ['발주번호', '현장코드-YYYYMMDD-일련번호', '김길홍/오동석'] },
  { vals: ['공사명', '프로젝트/현장 명칭', '공통'] },
  { vals: ['시공자', '현장 시공 담당자(소장)', '김길홍/오동석'] },
  { vals: ['수신 / 발신', '수신처 / 발신처', '김길홍/오동석'] },
  { vals: ['발주일', '발주서 작성일', '공통'] },
  { vals: ['검측자', '검측 담당자', '김길홍/오동석'] },
  { vals: ['출고일', '희망 납품일', '공통'] },
  { vals: ['도착장소', '납품 장소 주소', '김길홍/오동석'] },
  { vals: ['', '', ''] },
  { vals: ['[품목 컬럼 (9열)]', '', ''], isSection: true },
  { vals: ['컬럼', '설명', '비고'], isTableHeader: true },
  { vals: ['위치', '동/층/라인 등 설치 위치', ''] },
  { vals: ['제품명', '유리 제품명 + 간봉/가스 정보', '병합 셀: 다규격 시 한번만 기재'] },
  { vals: ['두께(mm)', '총 두께 (22T, 24T, 28T 등)', ''] },
  { vals: ['가로', '가로 치수 (mm)', '소계 행에서 "계" 표시'] },
  { vals: ['세로', '세로 치수 (mm)', ''] },
  { vals: ['수량', '발주 수량', ''] },
  { vals: ['평수', '면적 (자평 기준)', '원본 그대로 유지'] },
  { vals: ['실리콘', '실리콘/실란트 소요량', ''] },
  { vals: ['비고', '동+라인+타입+방 위치 등', ''] },
  { vals: ['', '', ''] },
  { vals: ['[안광식/대진글라스 양식은 골조도(배치도)로 별도 관리]', '', ''], isSection: true },
];

for (let i = 0; i < descData.length; i++) {
  const d = descData[i];
  const row = ws2.getRow(i + 1);

  for (let c = 0; c < 3; c++) {
    const cell = row.getCell(c + 1);
    cell.value = d.vals[c];
    cell.font = { name: '맑은 고딕', size: 10 };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }

  if (d.isTitle) {
    row.height = 30;
    row.getCell(1).font = { name: '맑은 고딕', size: 14, bold: true };
  } else if (d.isSection) {
    row.height = 24;
    row.getCell(1).font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF2F5496' } };
  } else if (d.isTableHeader) {
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = tableHeaderFill;
      cell.border = allThinBorders;
      cell.alignment = centerAlign;
    }
  } else if (d.vals[0] && !d.vals[0].startsWith('[') && d.vals[1]) {
    for (let c = 1; c <= 3; c++) {
      row.getCell(c).border = allThinBorders;
    }
  }
}

// ============================================
// Write
// ============================================
const outPath = 'data/1. 발주서 관련/DG-Flow_표준발주서_양식.xlsx';
await wb.xlsx.writeFile(outPath);
console.log('Created:', outPath);
