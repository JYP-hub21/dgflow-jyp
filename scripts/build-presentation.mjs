#!/usr/bin/env node
/**
 * 발표자료 HTML → PDF 빌드.
 *
 *   node scripts/build-presentation.mjs
 *
 * docs/presentation/*.html 의 LOGO_SRC 를 로고 base64 로 치환한 뒤
 * Chrome(없으면 Edge) 헤드리스로 인쇄해 data/*.pdf 를 만든다.
 * 내용 수정은 PDF 가 아니라 HTML 쪽에서 한다.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const browser = BROWSERS.find(existsSync);
if (!browser) {
  console.error('Chrome 또는 Edge 를 찾지 못했습니다. BROWSERS 배열에 경로를 추가하세요.');
  process.exit(1);
}

const TARGETS = [
  { src: 'docs/presentation/deck.html', out: 'data/발표자료_DG-Flow_소개및시연.pdf' },
  { src: 'docs/presentation/plan.html', out: 'data/시연_진행계획서.pdf' },
];

const logo = 'data:image/png;base64,' +
  readFileSync(resolve(root, 'public/dongil-logo.png')).toString('base64');

const work = mkdtempSync(join(tmpdir(), 'dgflow-deck-'));
console.log(`브라우저: ${browser}`);

for (const { src, out } of TARGETS) {
  const html = readFileSync(resolve(root, src), 'utf-8').split('LOGO_SRC').join(logo);
  const staged = join(work, src.replace(/[\\/]/g, '_'));
  writeFileSync(staged, html);

  const outPath = resolve(root, out);
  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    '--no-pdf-header-footer',
    `--print-to-pdf=${outPath}`,
    pathToFileURL(staged).href,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  console.log(`  ✓ ${out}`);
}

console.log('\n완료.');
