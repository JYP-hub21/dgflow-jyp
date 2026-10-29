#!/usr/bin/env node
/**
 * 동일유리 로고 JPEG(흰 배경) → 배경 투명 PNG 생성.
 *
 *   node scripts/make-logo-transparent.mjs
 *
 * 원본이 흰 배경 위에 합성된 상태라고 보고 되돌린다(unmultiply).
 * 픽셀 밝기가 흰색에 가까울수록 투명해지므로 글자 가장자리의
 * 안티에일리어싱이 계단 없이 부드럽게 남는다.
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const SRC = resolve(root, 'public/dongil-logo.jpeg');
const OUT = resolve(root, 'public/dongil-logo.png');

/** 이 값 이상으로 밝은 픽셀은 완전 투명 처리 (JPEG 링잉 노이즈 제거) */
const WHITE_CUTOFF = 247;
/** 이 값 이하는 완전 불투명 */
const SOLID_CUTOFF = 232;

const { data, info } = await sharp(SRC)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
const out = Buffer.alloc(width * height * 4);

for (let i = 0, o = 0; i < data.length; i += channels, o += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];

  // 가장 밝은 채널로 "흰색에 얼마나 가까운지" 판단
  const lightest = Math.max(r, g, b);

  let alpha;
  if (lightest >= WHITE_CUTOFF) alpha = 0;
  else if (lightest <= SOLID_CUTOFF) alpha = 255;
  else alpha = Math.round(255 * (WHITE_CUTOFF - lightest) / (WHITE_CUTOFF - SOLID_CUTOFF));

  if (alpha === 0) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    continue;
  }

  // 흰 배경과의 합성을 되돌려 원래 잉크 색을 복원
  const a = alpha / 255;
  const un = (c) => Math.max(0, Math.min(255, Math.round((c - 255 * (1 - a)) / a)));

  out[o] = un(r);
  out[o + 1] = un(g);
  out[o + 2] = un(b);
  out[o + 3] = alpha;
}

await sharp(out, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
console.log(`생성: public/dongil-logo.png  ${meta.width}x${meta.height}  alpha=${meta.hasAlpha}`);
