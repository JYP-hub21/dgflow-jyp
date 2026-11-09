import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { parseWorkOrderPdfText } from '@/lib/work-order/pdf';

/**
 * ERP 작업의뢰서 PDF 에서 글자를 읽는다. 외부 호출 없이 서버에서 처리한다.
 *
 * ERP 가 뽑은 PDF 는 글자가 데이터로 박혀 있어 변환 없이 그대로 읽는다 — 머리글(의뢰번호 · 업체명 · 현장명 · 날짜)과
 * 품목 · 규격 · 수량 · 면적 · 비고가 모두 들어 있다(2026-11-09 실물 5쌍 167줄을 엑셀과 칸마다 대조해 전부 같음).
 * `unpdf` 를 서버에서 쓰는 이유는 pdf.js 워커를 브라우저 번들에 끌어들이지 않으려는 것이다.
 */

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'work_order:create')) {
    return NextResponse.json({ error: '작업의뢰서 생성 권한이 없습니다.' }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'PDF 파일을 올려 주세요.' }, { status: 400 });
  }
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'PDF 파일만 올릴 수 있습니다.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일이 20MB 를 넘습니다.' }, { status: 400 });
  }

  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });

    // 글자가 없으면 종이를 스캔한 PDF 다 — 그림뿐이라 읽을 수 없다
    if (text.replace(/\s/g, '').length < 50) {
      return NextResponse.json(
        { error: '글자가 박혀 있지 않은 PDF예요 (스캔본 · 사진). ERP에서 작업의뢰서를 PDF로 다시 뽑아 올려 주세요. 안 되면 아래 표에 직접 입력하세요.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: parseWorkOrderPdfText(text) });
  } catch {
    return NextResponse.json({ error: 'PDF 를 읽지 못했습니다.' }, { status: 502 });
  }
}
