import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 큰 파일을 조각내 저장소에 올리고, 받을 때 다시 붙인다.
 *
 * 발주서는 그림 때문에 151MB 짜리도 있다(KCC 여의도 — PNG 23장). 그런데
 *  - Supabase 무료 요금제는 파일 하나에 50MB 까지
 *  - Vercel 서버는 요청 하나에 4.5MB 까지
 * 라서 브라우저가 사용자 세션으로 저장소에 **직접** 45MB 조각씩 올린다.
 * 조각 경로는 `{prefix}/0000`, `{prefix}/0001` … 이다.
 */

export const PO_BUCKET = 'purchase-orders';
export const CHUNK_BYTES = 45 * 1024 * 1024;

const part = (prefix: string, i: number) => `${prefix}/${String(i).padStart(4, '0')}`;

export function chunkCountOf(size: number): number {
  return Math.max(1, Math.ceil(size / CHUNK_BYTES));
}

export async function uploadChunked(
  supabase: SupabaseClient,
  prefix: string,
  file: Blob,
  onProgress?: (uploadedBytes: number) => void,
): Promise<number> {
  const count = chunkCountOf(file.size);
  for (let i = 0; i < count; i++) {
    const piece = file.slice(i * CHUNK_BYTES, Math.min(file.size, (i + 1) * CHUNK_BYTES));
    const { error } = await supabase.storage.from(PO_BUCKET).upload(part(prefix, i), piece, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    if (error) throw new Error(`파일을 올리지 못했습니다 (${i + 1}/${count}번째 조각): ${error.message}`);
    onProgress?.(Math.min(file.size, (i + 1) * CHUNK_BYTES));
  }
  return count;
}

export async function downloadChunked(
  supabase: SupabaseClient,
  prefix: string,
  chunkCount: number,
  mimeType = '',
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const parts: Blob[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const { data, error } = await supabase.storage.from(PO_BUCKET).download(part(prefix, i));
    if (error || !data) throw new Error(`파일을 받지 못했습니다 (${i + 1}/${chunkCount}번째 조각).`);
    parts.push(data);
    onProgress?.(i + 1, chunkCount);
  }
  return new Blob(parts, { type: mimeType || 'application/octet-stream' });
}

/** 브라우저에서 Blob 을 파일로 내려받게 한다 */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}
