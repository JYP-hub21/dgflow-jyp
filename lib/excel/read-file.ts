import * as XLSX from 'xlsx';

/**
 * 엑셀 · CSV 파일 읽기 (브라우저).
 *
 * 2026-10-30 생산부서 피드백: "예전 버전 엑셀(xls)도, csv 도 불러올 수 있으면".
 * xls 는 SheetJS 가 원래 읽는다. CSV 는 글자 인코딩이 문제다 — 한국 엑셀에서 "CSV 로 저장" 하면 보통
 * EUC-KR(CP949)이라 UTF-8 로 읽으면 한글이 깨진다. UTF-8 로 먼저 읽어 보고 깨지면 EUC-KR 로 다시 읽는다.
 */
export const isCsv = (name: string) => name.toLowerCase().endsWith('.csv');

/** CSV 바이트 → 글자. UTF-8(BOM 포함)이 아니면 EUC-KR 로 */
export function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

/** 파일 → 워크북 (xlsx · xls · csv) */
export async function readWorkbookFile(file: File, opts: XLSX.ParsingOptions = {}): Promise<XLSX.WorkBook> {
  if (isCsv(file.name)) return XLSX.read(decodeCsv(await file.arrayBuffer()), { ...opts, type: 'string' });
  return XLSX.read(await file.arrayBuffer(), { ...opts, type: 'array' });
}

/** xlsx 바이트로 — xlsx 바이트만 받는 경로(작업자 스레드 등)에 CSV 를 넘길 때 */
export async function fileToXlsxBuffer(file: File): Promise<ArrayBuffer> {
  if (!isCsv(file.name)) return file.arrayBuffer();
  const wb = XLSX.read(decodeCsv(await file.arrayBuffer()), { type: 'string' });
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
