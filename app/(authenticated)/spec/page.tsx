import SpecOrganizer from '@/components/spec/SpecOrganizer';

/**
 * 규격정리 — 발주서 엑셀을 올려 담당자가 손으로 만들던 규격정리 엑셀을 받는다.
 *
 * 주문·승인 흐름과 별개의 독립 도구다. 파일은 서버로 보내지 않고 브라우저 안에서 읽고 만든다.
 */
export default function SpecPage() {
  return (
    <div className="max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">규격정리</h1>
        <p className="mt-1 text-sm text-gray-600">
          발주서를 올리고 묶음을 정하면, 묶음마다 합산·정렬·위치 접기를 해서 규격정리 엑셀을 만듭니다.
          품명은 손대지 않고, 묶음은 사람이 정합니다.
        </p>
      </div>
      <SpecOrganizer />
    </div>
  );
}
