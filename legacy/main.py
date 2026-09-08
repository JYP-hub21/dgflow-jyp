"""동일유리 발주서 → ERP 데이터 생성 MVP"""

import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime, date
from io import BytesIO
import re

from product_master import convert_product_name, calculate_m2, PRODUCT_CONVERSION
from order_parser import parse_excel_file

st.set_page_config(page_title="동일유리 발주서 관리", layout="wide", page_icon="🏭")

# --- Session State 초기화 ---
if "order_lines" not in st.session_state:
    st.session_state.order_lines = []
if "header" not in st.session_state:
    st.session_state.header = {
        "order_id": "",
        "order_date": date.today(),
        "delivery_date": None,
        "customer": "",
        "site_name": "",
        "orderer": "",
    }


def add_empty_line():
    st.session_state.order_lines.append({
        "product_name": "",
        "width_mm": 0,
        "height_mm": 0,
        "quantity": 0,
        "location_raw": "",
        "dong": "",
        "line": "",
        "position": "",
        "type": "",
        "window_type": "",
        "sealant": "",
        "remarks": "",
    })


def group_lines(lines: list[dict], product_name_erp: str) -> list[dict]:
    """동일 품명 + 동일 규격(가로x세로)인 항목끼리 그룹핑"""
    from collections import defaultdict

    # 그룹 키: (가로, 세로)
    groups = defaultdict(list)
    for line in lines:
        key = (line["width_mm"], line["height_mm"])
        groups[key].append(line)

    grouped = []
    for (w, h), items in groups.items():
        total_qty = sum(it["quantity"] for it in items)
        # 위치 통합
        locations = [it["location_raw"] for it in items if it["location_raw"]]
        merged_location = merge_locations(locations) if locations else ""

        grouped.append({
            "product_name_erp": product_name_erp,
            "width_mm": w,
            "height_mm": h,
            "quantity": total_qty,
            "location_merged": merged_location,
            "m2": calculate_m2(w, h, total_qty),
            "original_count": len(items),
        })

    # 규격 내림차순 정렬 (가로x세로 면적 기준)
    grouped.sort(key=lambda x: x["width_mm"] * x["height_mm"], reverse=True)
    return grouped


def merge_locations(locations: list[str]) -> str:
    """위치 문자열들을 병합 (단순 병합 - 고급 통합은 Phase 2)"""
    if len(locations) == 1:
        return locations[0]
    # 중복 제거 후 합치기
    unique = list(dict.fromkeys(locations))
    if len(unique) == 1:
        return unique[0]
    # 간단한 통합: 공통 접두사 찾기
    return " / ".join(unique[:5]) + ("..." if len(unique) > 5 else "")


def generate_erp_excel(header: dict, grouped_by_product: dict) -> bytes:
    """ERP Import 엑셀 생성 (16컬럼 바이투 포맷)"""
    rows = []
    order_id = header.get("order_id", "")
    if not order_id:
        order_id = datetime.now().strftime("%y%m%d") + "-01"

    order_date = header.get("order_date", date.today())
    delivery_date = header.get("delivery_date")
    customer = header.get("customer", "")
    site_name = header.get("site_name", "")

    for product_raw, items in grouped_by_product.items():
        erp_name, thickness, division = convert_product_name(product_raw)
        grouped = group_lines(items, erp_name)

        for g in grouped:
            rows.append({
                "주문번호": order_id,
                "주문일자": order_date,
                "납품일자": delivery_date if delivery_date else "",
                "거래처": customer,
                "현장명": site_name,
                "구분": division,
                "품명": erp_name,
                "두께": thickness,
                "가로규격": g["width_mm"],
                "세로규격": g["height_mm"],
                "주문수량": g["quantity"],
                "출고수량": "",
                "잔여수량": g["quantity"],
                "면적": g["m2"],
                "미출고액": "",
                "비고": g["location_merged"],
            })

    df = pd.DataFrame(rows)
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="ERP불러오기")
    return output.getvalue()


def generate_review_excel(header: dict, lines: list[dict]) -> bytes:
    """내부검토용 규격정리 엑셀 생성"""
    from collections import defaultdict

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        # 품명별로 분리
        by_product = defaultdict(list)
        for line in lines:
            by_product[line["product_name"]].append(line)

        all_rows = []
        for product_raw, items in by_product.items():
            erp_name, thickness, _ = convert_product_name(product_raw)
            display_name = f"{thickness}T {erp_name}" if thickness else erp_name

            # 헤더 행
            all_rows.append({
                "품명": display_name,
                "위치": "", "가로": "", "세로": "", "수량": "", "평": "",
                "M2": "", "비고": ""
            })

            for item in sorted(items, key=lambda x: (-x["width_mm"] * x["height_mm"])):
                m2 = calculate_m2(item["width_mm"], item["height_mm"], item["quantity"])
                pyeong = round(m2 * 0.3025 * 100, 2)  # m2 → 평 근사값
                all_rows.append({
                    "품명": "",
                    "위치": item["location_raw"],
                    "가로": item["width_mm"],
                    "세로": item["height_mm"],
                    "수량": item["quantity"],
                    "평": pyeong,
                    "M2": m2,
                    "비고": item["remarks"],
                })

            # 소계
            subtotal_qty = sum(it["quantity"] for it in items)
            subtotal_m2 = sum(calculate_m2(it["width_mm"], it["height_mm"], it["quantity"]) for it in items)
            all_rows.append({
                "품명": "소계",
                "위치": "", "가로": "", "세로": "",
                "수량": subtotal_qty, "평": "",
                "M2": subtotal_m2, "비고": ""
            })

        df = pd.DataFrame(all_rows)
        df.to_excel(writer, index=False, sheet_name="규격정리")

    return output.getvalue()


# =========================================
# UI
# =========================================

st.title("동일유리 발주서 관리 시스템")
st.caption("발주서 입력 → 규격정리 → ERP 데이터 생성")

# --- 탭 구성 ---
tab1, tab2, tab3, tab4 = st.tabs([
    "1. 발주서 입력",
    "2. 내부검토 (규격정리)",
    "3. ERP 데이터 생성",
    "4. 품명 변환 관리",
])

# ===== 탭 1: 발주서 입력 =====
with tab1:
    st.subheader("주문 헤더 정보")

    col1, col2, col3 = st.columns(3)
    with col1:
        st.session_state.header["order_id"] = st.text_input(
            "주문번호", value=st.session_state.header["order_id"],
            placeholder="260821-08 (자동생성 가능)")
        st.session_state.header["customer"] = st.text_input(
            "거래처", value=st.session_state.header["customer"],
            placeholder="(주)대진글라스a")
    with col2:
        st.session_state.header["order_date"] = st.date_input(
            "주문일자", value=st.session_state.header["order_date"])
        st.session_state.header["site_name"] = st.text_input(
            "현장명", value=st.session_state.header["site_name"],
            placeholder="대우건설_산성역헤리스톤3BL현장")
    with col3:
        st.session_state.header["delivery_date"] = st.date_input(
            "납품일자", value=st.session_state.header.get("delivery_date") or date.today())
        st.session_state.header["orderer"] = st.selectbox(
            "담당자", ["직접입력", "안광식 상무", "이충언 이사", "김길홍 과장", "오동석 부장", "외주"],
            index=0)

    st.divider()

    # --- 입력 방식 선택 ---
    input_method = st.radio(
        "입력 방식", ["엑셀 파일 업로드", "직접 입력 (표준 양식)"],
        horizontal=True)

    if input_method == "엑셀 파일 업로드":
        st.subheader("발주서 엑셀 업로드")
        uploaded = st.file_uploader(
            "발주서 파일을 업로드하세요 (xlsx, xls)",
            type=["xlsx", "xls"],
            help="담당자별 양식을 자동으로 감지합니다.")

        if uploaded:
            with st.spinner("파싱 중..."):
                result = parse_excel_file(uploaded.read(), uploaded.name)

            if "error" in result:
                st.error(f"파싱 오류: {result['error']}")
            elif not result:
                st.warning("파싱 가능한 데이터가 없습니다. 시트 구조를 확인하세요.")
            else:
                st.success(f"{len(result)}개 시트에서 데이터를 발견했습니다.")

                # 시트 선택
                selected_sheets = st.multiselect(
                    "가져올 시트 선택",
                    options=list(result.keys()),
                    default=list(result.keys()))

                if st.button("선택한 시트 데이터 가져오기", type="primary"):
                    new_lines = []
                    for sheet in selected_sheets:
                        new_lines.extend(result[sheet])
                    st.session_state.order_lines = new_lines
                    st.success(f"{len(new_lines)}개 항목을 가져왔습니다.")
                    st.rerun()

                # 미리보기
                for sheet_name, lines in result.items():
                    if sheet_name in selected_sheets:
                        with st.expander(f"시트: {sheet_name} ({len(lines)}행)", expanded=False):
                            preview_df = pd.DataFrame(lines)
                            st.dataframe(preview_df, use_container_width=True)

    else:
        st.subheader("직접 입력")
        if st.button("행 추가", type="secondary"):
            add_empty_line()

        if st.button("5행 일괄 추가"):
            for _ in range(5):
                add_empty_line()

    # --- 현재 데이터 편집 ---
    if st.session_state.order_lines:
        st.subheader(f"주문 라인 ({len(st.session_state.order_lines)}건)")

        # 데이터프레임으로 편집
        edit_df = pd.DataFrame(st.session_state.order_lines)
        display_cols = ["product_name", "width_mm", "height_mm", "quantity", "location_raw", "sealant", "remarks"]
        display_names = {
            "product_name": "품명",
            "width_mm": "가로(mm)",
            "height_mm": "세로(mm)",
            "quantity": "수량",
            "location_raw": "위치",
            "sealant": "실란트",
            "remarks": "비고",
        }

        # 표시할 컬럼만
        show_df = edit_df[display_cols].copy()
        show_df.columns = [display_names.get(c, c) for c in display_cols]

        edited = st.data_editor(
            show_df,
            use_container_width=True,
            num_rows="dynamic",
            column_config={
                "품명": st.column_config.TextColumn(width="large"),
                "가로(mm)": st.column_config.NumberColumn(min_value=0, step=1),
                "세로(mm)": st.column_config.NumberColumn(min_value=0, step=1),
                "수량": st.column_config.NumberColumn(min_value=0, step=1),
                "위치": st.column_config.TextColumn(width="large"),
            },
            key="line_editor",
        )

        # 편집 결과 반영
        if edited is not None:
            reverse_names = {v: k for k, v in display_names.items()}
            updated_lines = []
            for _, row in edited.iterrows():
                line = {}
                for col_kr, val in row.items():
                    col_en = reverse_names.get(col_kr, col_kr)
                    line[col_en] = val if not pd.isna(val) else ""
                # 누락 필드 보충
                for field in ["dong", "line", "position", "type", "window_type"]:
                    if field not in line:
                        line[field] = ""
                updated_lines.append(line)
            st.session_state.order_lines = updated_lines

        # 요약
        total_qty = sum(
            l.get("quantity", 0) for l in st.session_state.order_lines
            if l.get("quantity") and not pd.isna(l.get("quantity", 0))
        )
        total_m2 = sum(
            calculate_m2(l.get("width_mm", 0) or 0, l.get("height_mm", 0) or 0, l.get("quantity", 0) or 0)
            for l in st.session_state.order_lines
            if l.get("width_mm") and l.get("height_mm") and l.get("quantity")
        )

        col1, col2, col3 = st.columns(3)
        col1.metric("총 항목 수", f"{len(st.session_state.order_lines)}건")
        col2.metric("총 수량", f"{int(total_qty)}EA")
        col3.metric("총 면적", f"{total_m2:.2f}m2")

    else:
        st.info("엑셀 파일을 업로드하거나, '직접 입력'을 선택하여 행을 추가하세요.")


# ===== 탭 2: 내부검토 (규격정리) =====
with tab2:
    if not st.session_state.order_lines:
        st.info("먼저 탭 1에서 발주서 데이터를 입력하세요.")
    else:
        st.subheader("내부검토용 규격정리")

        lines = st.session_state.order_lines
        from collections import defaultdict
        by_product = defaultdict(list)
        for line in lines:
            pn = line.get("product_name", "")
            if pn:
                by_product[pn].append(line)
            else:
                by_product["(품명 미지정)"].append(line)

        for product_raw, items in by_product.items():
            erp_name, thickness, _ = convert_product_name(product_raw)
            display_name = f"{thickness}T {erp_name}" if thickness else product_raw

            st.markdown(f"#### {display_name}")

            col_left, col_right = st.columns(2)

            with col_left:
                st.caption("원본 (위치별)")
                left_data = []
                for item in items:
                    m2 = calculate_m2(
                        item.get("width_mm", 0) or 0,
                        item.get("height_mm", 0) or 0,
                        item.get("quantity", 0) or 0
                    )
                    left_data.append({
                        "위치": item.get("location_raw", ""),
                        "가로": item.get("width_mm", 0),
                        "세로": item.get("height_mm", 0),
                        "수량": item.get("quantity", 0),
                        "M2": m2,
                    })
                left_df = pd.DataFrame(left_data)
                st.dataframe(left_df, use_container_width=True, hide_index=True)

                subtotal_qty = sum(d["수량"] for d in left_data)
                subtotal_m2 = sum(d["M2"] for d in left_data)
                st.caption(f"소계: {subtotal_qty}EA / {subtotal_m2:.2f}m2")

            with col_right:
                st.caption("규격순 정렬 (그룹핑)")
                grouped = group_lines(items, erp_name)
                right_data = []
                for g in grouped:
                    right_data.append({
                        "위치(통합)": g["location_merged"],
                        "가로": g["width_mm"],
                        "세로": g["height_mm"],
                        "수량": g["quantity"],
                        "M2": g["m2"],
                        "원본행수": g["original_count"],
                    })
                right_df = pd.DataFrame(right_data)
                st.dataframe(right_df, use_container_width=True, hide_index=True)

                gtotal_qty = sum(d["수량"] for d in right_data)
                gtotal_m2 = sum(d["M2"] for d in right_data)
                st.caption(f"소계: {gtotal_qty}EA / {gtotal_m2:.2f}m2")

            # 검증: 좌우 합계 일치 확인
            if subtotal_qty != gtotal_qty:
                st.error(f"수량 불일치: 원본 {subtotal_qty} vs 그룹핑 {gtotal_qty}")
            else:
                st.success("수량 합계 일치 확인")

            st.divider()

        # 규격정리 엑셀 다운로드
        review_bytes = generate_review_excel(st.session_state.header, lines)
        st.download_button(
            "규격정리 엑셀 다운로드",
            data=review_bytes,
            file_name=f"규격정리_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


# ===== 탭 3: ERP 데이터 생성 =====
with tab3:
    if not st.session_state.order_lines:
        st.info("먼저 탭 1에서 발주서 데이터를 입력하세요.")
    else:
        st.subheader("ERP Import 데이터 미리보기")

        lines = st.session_state.order_lines
        from collections import defaultdict
        by_product = defaultdict(list)
        for line in lines:
            pn = line.get("product_name", "")
            if pn:
                by_product[pn].append(line)
            else:
                by_product["(품명 미지정)"].append(line)

        # 주문번호 자동 생성
        header = st.session_state.header
        if not header.get("order_id"):
            header["order_id"] = header["order_date"].strftime("%y%m%d") + "-01"

        # ERP 미리보기 테이블
        preview_rows = []
        for product_raw, items in by_product.items():
            erp_name, thickness, division = convert_product_name(product_raw)
            grouped = group_lines(items, erp_name)

            for g in grouped:
                preview_rows.append({
                    "주문번호": header["order_id"],
                    "거래처": header["customer"],
                    "현장명": header["site_name"],
                    "구분": division,
                    "품명": erp_name,
                    "두께": thickness,
                    "가로": g["width_mm"],
                    "세로": g["height_mm"],
                    "수량": g["quantity"],
                    "면적(m2)": g["m2"],
                    "비고": g["location_merged"],
                })

        if preview_rows:
            preview_df = pd.DataFrame(preview_rows)
            st.dataframe(preview_df, use_container_width=True, hide_index=True)

            # 합계
            total_qty = sum(r["수량"] for r in preview_rows)
            total_m2 = sum(r["면적(m2)"] for r in preview_rows)
            col1, col2, col3 = st.columns(3)
            col1.metric("총 행 수", f"{len(preview_rows)}행")
            col2.metric("총 수량", f"{total_qty}EA")
            col3.metric("총 면적", f"{total_m2:.2f}m2")

            st.divider()

            # 작업의뢰서 미리보기
            st.subheader("작업의뢰서 미리보기")
            st.markdown(f"""
            | 항목 | 값 |
            |------|-----|
            | **주문번호** | {header['order_id']} |
            | **거래처** | {header['customer']} |
            | **현장명** | {header['site_name']} |
            | **의뢰일자** | {header['order_date']} |
            | **납품일자** | {header.get('delivery_date', '')} |
            """)

            # 품명별 소계가 있는 작업의뢰서 형태
            no = 1
            work_order_rows = []
            for product_raw, items in by_product.items():
                erp_name, thickness, _ = convert_product_name(product_raw)
                grouped = group_lines(items, erp_name)
                for g in grouped:
                    work_order_rows.append({
                        "No": no,
                        "품명": erp_name,
                        "규격": f"{g['width_mm']:,} X {g['height_mm']:,}",
                        "수량": g["quantity"],
                        "면적": g["m2"],
                        "비고": g["location_merged"],
                    })
                    no += 1
                # 소계
                sub_qty = sum(g["quantity"] for g in grouped)
                sub_m2 = sum(g["m2"] for g in grouped)
                work_order_rows.append({
                    "No": "소계",
                    "품명": "",
                    "규격": "",
                    "수량": sub_qty,
                    "면적": sub_m2,
                    "비고": "",
                })

            # 합계
            work_order_rows.append({
                "No": "합계",
                "품명": "",
                "규격": "",
                "수량": total_qty,
                "면적": total_m2,
                "비고": "",
            })

            wo_df = pd.DataFrame(work_order_rows)
            st.dataframe(wo_df, use_container_width=True, hide_index=True)

            st.divider()

            # ERP 엑셀 다운로드
            erp_bytes = generate_erp_excel(header, by_product)
            st.download_button(
                "ERP Import 엑셀 다운로드",
                data=erp_bytes,
                file_name=f"ERP불러오기_{header['order_id']}_{datetime.now().strftime('%Y%m%d')}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                type="primary",
            )


# ===== 탭 4: 품명 변환 관리 =====
with tab4:
    st.subheader("품명 변환 테이블")
    st.caption("발주서 품명 → ERP 품명 매핑 관리")

    conv_data = []
    for raw, (erp, thick, div) in PRODUCT_CONVERSION.items():
        conv_data.append({
            "발주서 표기": raw,
            "ERP 품명": erp,
            "두께(T)": thick,
            "구분": div,
        })

    conv_df = pd.DataFrame(conv_data)
    st.dataframe(conv_df, use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("변환 규칙")
    st.markdown("""
    | 패턴 | 변환 | 설명 |
    |------|------|------|
    | `ALC` | → `A` | 알루미늄 간봉 약어 통일 |
    | `EMT178` | → `로이` | 로이코팅 유리 코드 |
    | `Ar.` | → `A` | 아르곤 가스 간봉 |
    | `PVB` 포함 | → `접합` | 접합유리 표시 |
    | 두께 | 각 구성 합산 | 예: 5+0.76+5+10+6 = 26.76T |

    **주의:** 현재 확인된 매핑만 등록되어 있습니다. 새로운 품명이 발견되면 추가 필요합니다.
    """)

    # 현재 데이터에서 미매핑 품명 확인
    if st.session_state.order_lines:
        unmapped = set()
        for line in st.session_state.order_lines:
            pn = line.get("product_name", "")
            if pn and pn not in PRODUCT_CONVERSION:
                unmapped.add(pn)
        if unmapped:
            st.warning(f"현재 데이터에 미매핑 품명 {len(unmapped)}건:")
            for u in unmapped:
                erp, thick, div = convert_product_name(u)
                st.text(f"  {u} → (자동추정) {thick}T {erp}")
