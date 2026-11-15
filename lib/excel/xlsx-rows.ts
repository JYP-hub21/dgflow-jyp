/**
 * 큰 xlsx 를 빠르게 줄 단위로 읽기 (2026-11-13 MES 생산실적).
 *
 * MES 에서 내려받은 생산실적 엑셀은 파일은 25MB 인데 Data 시트 XML 을 풀면 146MB · 30만 줄이다.
 * SheetJS(XLSX.read)는 셀 하나하나를 객체로 만들고 피벗 캐시까지 다루느라 Node 에서도 5분 넘게 끝나지 않았다.
 * 우리가 필요한 건 시트 하나의 값뿐이라, xlsx(zip) 에서 그 시트만 꺼내 압축을 풀면서 흘려 읽는다.
 *  - zip 은 끝의 중앙 디렉터리만 보고 필요한 파일 위치를 찾는다
 *  - 압축 풀기는 브라우저 기본 기능(DecompressionStream 'deflate-raw') — 따로 라이브러리가 필요 없다
 *  - XML 은 `</row>` 단위로 잘라 정규식으로 셀 값만 뽑는다. 문자열 전체를 한 번에 들고 있지 않는다
 *
 * 값: 공유 문자열 · 인라인 문자열 · 수식 결과 문자열은 문자열, 숫자는 숫자(날짜는 엑셀 일련번호), 참/거짓은 boolean.
 * 브라우저 · 작업자 스레드 · Node(18+) 어디서든 돈다.
 */

export type CellValue = string | number | boolean;

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** zip 중앙 디렉터리 → 파일 이름별 위치 */
function listZip(buf: Uint8Array): Map<string, ZipEntry> {
  // 끝 레코드(EOCD) — 뒤에서부터 찾는다 (주석이 붙으면 최대 65,535바이트 앞)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('엑셀(xlsx) 파일이 아니거나 손상되었습니다.');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('엑셀(xlsx) 파일 구조를 읽지 못했습니다.');
    const nameLen = u16(buf, p + 28);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method: u16(buf, p + 10), compressedSize: u32(buf, p + 20), offset: u32(buf, p + 42) });
    p += 46 + nameLen + u16(buf, p + 30) + u16(buf, p + 32);
  }
  return out;
}

function entryStream(buf: Uint8Array, e: ZipEntry): ReadableStream<Uint8Array> {
  const h = e.offset;
  if (u32(buf, h) !== 0x04034b50) throw new Error('엑셀(xlsx) 파일 구조를 읽지 못했습니다.');
  const start = h + 30 + u16(buf, h + 26) + u16(buf, h + 28);
  const raw = new Blob([buf.subarray(start, start + e.compressedSize) as Uint8Array<ArrayBuffer>]).stream();
  if (e.method === 0) return raw;
  if (e.method === 8) return raw.pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  throw new Error(`지원하지 않는 압축 방식입니다 (${e.method}).`);
}

const textOf = (s: ReadableStream<Uint8Array>) => new Response(s).text();

/** XML 글자 되돌리기 — &amp; 같은 것과 엑셀의 _x000D_ */
export function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  return s
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
      switch (e) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        default: return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      }
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** <si>…</si> 하나 → 글자. 서식이 섞인 글(<r><t>)은 이어 붙이고, 일본어 읽기(<rPh>)는 뺀다 */
function richText(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out += m[1];
  return unescapeXml(out);
}

function parseShared(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ? richText(m[1]) : '');
  return out;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** "AB12" → 0부터 센 칸 번호 (A=0) */
function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** 한 줄의 셀들 → 칸 번호별 값 (빈 칸은 undefined) */
export function parseRowXml(body: string, shared: string[]): CellValue[] {
  const row: CellValue[] = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  let next = 0;
  while ((m = re.exec(body))) {
    const tag = m[1];
    const ref = attr(tag, 'r');
    const col = ref ? colIndex(ref) : next;
    next = col + 1;
    const inner = m[2];
    if (!inner) continue;
    const t = attr(tag, 't');
    let value: CellValue | undefined;
    if (t === 'inlineStr') {
      const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
      value = is ? richText(is[1]) : '';
    } else {
      // <v xml:space="preserve"> 처럼 속성이 붙기도 한다
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (v === undefined) continue;
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'str') value = unescapeXml(v);
      else if (t === 'b') value = v === '1';
      else if (t === 'e') value = unescapeXml(v);
      else {
        const n = Number(v);
        value = Number.isFinite(n) ? n : unescapeXml(v);
      }
    }
    row[col] = value;
  }
  return row;
}

export interface XlsxBook {
  sheets: { name: string; path: string }[];
  /** 1904 날짜 체계(맥 엑셀 옛 파일) */
  date1904: boolean;
  /**
   * 시트를 줄 단위로 흘려 읽는다. onRow 가 false 를 돌려주면 거기서 멈춘다.
   * rowNumber 는 엑셀 줄 번호(1부터).
   */
  eachRow(sheetPath: string, onRow: (cells: CellValue[], rowNumber: number) => boolean | void,
    onProgress?: (rows: number) => void): Promise<void>;
}

/** xlsx 바이트 → 시트 목록 · 줄 읽기 */
export async function openXlsx(bytes: ArrayBuffer | Uint8Array): Promise<XlsxBook> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const zip = listZip(buf);
  const read = async (name: string) => {
    const e = zip.get(name);
    return e ? textOf(entryStream(buf, e)) : '';
  };

  const [workbook, rels, sharedXml] = await Promise.all([
    read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml'),
  ]);
  if (!workbook) throw new Error('엑셀(xlsx) 통합 문서 정보를 찾지 못했습니다.');
  const shared = parseShared(sharedXml);

  const targets = new Map<string, string>();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const sheets: { name: string; path: string }[] = [];
  for (const tag of workbook.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = unescapeXml(attr(tag, 'name') ?? '');
    const path = targets.get(attr(tag, 'r:id') ?? '');
    if (path && zip.has(path)) sheets.push({ name, path });
  }
  const pr = /<workbookPr\b[^>]*>/.exec(workbook)?.[0] ?? '';
  const date1904 = /date1904="(1|true)"/.test(pr);

  async function eachRow(sheetPath: string, onRow: (cells: CellValue[], rowNumber: number) => boolean | void,
    onProgress?: (rows: number) => void) {
    const entry = zip.get(sheetPath);
    if (!entry) throw new Error('시트를 찾지 못했습니다.');
    const reader = entryStream(buf, entry)
      .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
    let pending = '';
    let seen = 0;
    let rowNo = 0;
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (value) pending += value;
        const end = done ? pending.length : pending.lastIndexOf('</row>') + 6;
        if (end < 6 && !done) continue;
        // 빈 줄(<row r="5" .../>)은 지운다 — 다음 줄의 여는 태그로 잘못 읽히지 않게
        const chunk = pending.slice(0, end).replace(/<row\b[^>]*\/>/g, '');
        pending = pending.slice(end);
        rowRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rowRe.exec(chunk))) {
          const r = attr(m[1], 'r');
          rowNo = r ? Number(r) : rowNo + 1;
          seen++;
          if (onRow(parseRowXml(m[2], shared), rowNo) === false) {
            await reader.cancel();
            return;
          }
        }
        onProgress?.(seen);
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  return { sheets, date1904, eachRow };
}

/** 엑셀 날짜 일련번호 → "YYYY-MM-DD" (시각은 버린다) */
export function serialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial + 1e-9) * 86_400_000).toISOString().slice(0, 10);
}
