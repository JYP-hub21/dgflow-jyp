/**
 * PDF 에 글자가 데이터로 박혀 있는지 본다.
 *
 *   node scripts/inspect-pdf.mjs <파일.pdf>
 *
 * ERP 가 직접 뽑은 PDF 면 글자가 들어 있어 공짜로 읽을 수 있다.
 * 종이를 스캔한 PDF 면 그림뿐이라 아무것도 안 나온다 — 그때는 사람이 친다.
 */
import fs from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';

const file = process.argv[2];
if (!file) {
  console.error('사용법: node scripts/inspect-pdf.mjs <파일.pdf>');
  process.exit(1);
}

const buf = new Uint8Array(fs.readFileSync(file));
const pdf = await getDocumentProxy(buf);
const { totalPages, text } = await extractText(pdf, { mergePages: true });

const chars = text.replace(/\s/g, '').length;

console.log('파일   :', file);
console.log('쪽수   :', totalPages);
console.log('글자수 :', chars);
console.log('판정   :', chars > 50 ? '✅ 글자가 박혀 있다 — 읽을 수 있다' : '❌ 그림뿐 (스캔본) — 읽을 수 없다');
console.log('─'.repeat(60));
console.log(text.slice(0, 2000));
