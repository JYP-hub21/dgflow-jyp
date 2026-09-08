import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import copy

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
BLACK = RGBColor(0x00, 0x00, 0x00)
DARK_GRAY = RGBColor(0x33, 0x33, 0x33)
MID_GRAY = RGBColor(0x66, 0x66, 0x66)
LIGHT_GRAY = RGBColor(0xCC, 0xCC, 0xCC)
VERY_LIGHT_GRAY = RGBColor(0xF2, 0xF2, 0xF2)
ACCENT_BLUE = RGBColor(0x2B, 0x57, 0x9A)
ACCENT_RED = RGBColor(0xC0, 0x39, 0x2B)
ACCENT_GREEN = RGBColor(0x27, 0xAE, 0x60)
ACCENT_ORANGE = RGBColor(0xE6, 0x7E, 0x22)
HEADER_BG = RGBColor(0x2B, 0x57, 0x9A)
ROW_ALT = RGBColor(0xF7, 0xF9, 0xFC)

def set_slide_bg(slide, color=WHITE):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color

def add_textbox(slide, left, top, width, height, text, font_size=18, bold=False, color=BLACK, alignment=PP_ALIGN.LEFT, font_name='맑은 고딕'):
    txBox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.bold = bold
    p.font.color.rgb = color
    p.font.name = font_name
    p.alignment = alignment
    return txBox

def add_multi_text(slide, left, top, width, height, lines, font_size=16, color=BLACK, line_spacing=1.3, font_name='맑은 고딕'):
    txBox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = txBox.text_frame
    tf.word_wrap = True
    for i, (text, bold, fsize, fcolor) in enumerate(lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = text
        p.font.size = Pt(fsize if fsize else font_size)
        p.font.bold = bold
        p.font.color.rgb = fcolor if fcolor else color
        p.font.name = font_name
        p.space_after = Pt(4)
    return txBox

def add_table(slide, left, top, width, height, rows, cols, data, col_widths=None, font_size=11):
    table_shape = slide.shapes.add_table(rows, cols, Inches(left), Inches(top), Inches(width), Inches(height))
    table = table_shape.table

    if col_widths:
        for i, w in enumerate(col_widths):
            table.columns[i].width = Inches(w)

    for r in range(rows):
        for c in range(cols):
            cell = table.cell(r, c)
            cell.text = str(data[r][c]) if r < len(data) and c < len(data[r]) else ""
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE

            for paragraph in cell.text_frame.paragraphs:
                paragraph.font.size = Pt(font_size)
                paragraph.font.name = '맑은 고딕'
                paragraph.alignment = PP_ALIGN.CENTER

                if r == 0:
                    paragraph.font.bold = True
                    paragraph.font.color.rgb = WHITE
                else:
                    paragraph.font.color.rgb = DARK_GRAY

            if r == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = HEADER_BG
            elif r % 2 == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = ROW_ALT
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = WHITE

    return table_shape

def add_box(slide, left, top, width, height, fill_color=VERY_LIGHT_GRAY, border_color=LIGHT_GRAY):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.color.rgb = border_color
    shape.line.width = Pt(1)
    shape.rotation = 0
    return shape

def add_arrow_right(slide, left, top, width=0.5, height=0.3):
    shape = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = ACCENT_BLUE
    shape.line.fill.background()
    return shape

def add_rect(slide, left, top, width, height, text, fill_color=ACCENT_BLUE, font_color=WHITE, font_size=14, bold=True):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    tf = shape.text_frame
    tf.word_wrap = True
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.bold = bold
    p.font.color.rgb = font_color
    p.font.name = '맑은 고딕'
    shape.text_frame.paragraphs[0].space_before = Pt(0)
    shape.text_frame.paragraphs[0].space_after = Pt(0)
    return shape

def add_down_arrow(slide, left, top, width=0.4, height=0.35):
    shape = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = ACCENT_BLUE
    shape.line.fill.background()
    return shape

def add_line(slide, left, top, width, color=LIGHT_GRAY, thickness=1.5):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(width), Pt(thickness))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    return shape

# ========================================
# 슬라이드 1: 표지
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)

add_line(slide, 2, 1.8, 9.333, ACCENT_BLUE, 3)
add_textbox(slide, 1, 2.2, 11.333, 1.2, "동일유리 AX 프로젝트", font_size=44, bold=True, color=DARK_GRAY, alignment=PP_ALIGN.CENTER)
add_textbox(slide, 1, 3.4, 11.333, 0.8, "업무 분석 및 개발 방향", font_size=28, color=MID_GRAY, alignment=PP_ALIGN.CENTER)
add_line(slide, 2, 4.3, 9.333, ACCENT_BLUE, 3)

add_textbox(slide, 1, 5.2, 11.333, 0.5, "업무지원: 발주서 정리·검토·ERP 입력  |  생산: 재단·복층 실적 집계", font_size=18, color=MID_GRAY, alignment=PP_ALIGN.CENTER)
add_textbox(slide, 1, 6.2, 11.333, 0.5, "2026. 08. 30  |  충북대학교 & 동일유리 PBL 교육", font_size=16, color=LIGHT_GRAY, alignment=PP_ALIGN.CENTER)

# ========================================
# 슬라이드 2: 목차
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 5, 0.7, "목차", font_size=32, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.1, 11.733, ACCENT_BLUE, 2)

items = [
    ("01", "AX 대상 업무 개요"),
    ("02", "AS-IS: 발주서 → 작업의뢰서 프로세스"),
    ("03", "AS-IS: 발주서 양식 분석"),
    ("04", "AS-IS: 발주서 → 규격정리 → ERP 입력 (데이터 변환)"),
    ("05", "AS-IS: 발주서 ↔ 작업의뢰서 검증"),
    ("06", "AS-IS: 복층 생산실적 집계"),
    ("07", "AS-IS: 재단 생산실적 (절단일보)"),
    ("08", "TO-BE: AX 개발 방향"),
    ("09", "TO-BE: 기능별 상세"),
    ("10", "확인 필요 사항 / 논의"),
]

for i, (num, title) in enumerate(items):
    y = 1.5 + i * 0.55
    add_rect(slide, 1.2, y, 0.7, 0.4, num, fill_color=ACCENT_BLUE, font_color=WHITE, font_size=14, bold=True)
    add_textbox(slide, 2.1, y, 9, 0.4, title, font_size=20, color=DARK_GRAY)

# ========================================
# 슬라이드 3: AX 대상 업무 개요
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 10, 0.7, "01  AX 대상 업무 개요", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 전체 업무 흐름 5단계
steps = [
    ("1. 공사관리", "발주서 작성\n(실측/도면)", LIGHT_GRAY, DARK_GRAY),
    ("2. 업무지원", "발주서 정리, 검토\nERP 입력, 생산지시", ACCENT_BLUE, WHITE),
    ("3. 생산관리", "작업계획서 정리\n생산계획 수립", LIGHT_GRAY, DARK_GRAY),
    ("4. 생산", "재단·복층 실적\n(일간/주간)", ACCENT_RED, WHITE),
    ("5. 출고", "출고 진행\n실적관리", LIGHT_GRAY, DARK_GRAY),
]

add_textbox(slide, 0.8, 1.4, 12, 0.5, "동일유리 전체 업무 흐름", font_size=20, bold=True, color=DARK_GRAY)

for i, (title, desc, bg, fc) in enumerate(steps):
    x = 0.8 + i * 2.5
    add_rect(slide, x, 2.1, 2.1, 0.5, title, fill_color=bg, font_color=fc, font_size=15, bold=True)
    shape = add_rect(slide, x, 2.7, 2.1, 0.8, desc, fill_color=WHITE, font_color=DARK_GRAY, font_size=12, bold=False)
    shape.line.color.rgb = bg
    shape.line.width = Pt(2)
    if i < 4:
        add_arrow_right(slide, x + 2.15, 2.25, 0.3, 0.25)

add_textbox(slide, 0.8, 3.8, 12, 0.5, "AX 대상 2개 영역", font_size=20, bold=True, color=DARK_GRAY)

# AX 대상 상세
data = [
    ["영역", "현재 업무", "현재 방식", "문제점", "AX 목표"],
    ["업무지원", "발주서 → 규격정리\n→ ERP입력 → 작업의뢰서", "수작업 엑셀 정리\n수동 ERP 입력", "양식 다양, 수기 검증\n오류 가능성 높음", "자동 파싱·정리·검증"],
    ["생산실적", "작업의뢰서 → 수기체크\n→ 생산일지/절단일보", "수기 표시 후\n수동 엑셀 입력", "수기 기록 누락\n집계 시간 과다", "자동 집계·리포트"],
]
add_table(slide, 0.8, 4.4, 11.733, 2.0, 3, 5, data, col_widths=[1.4, 2.8, 2.2, 2.6, 2.733], font_size=12)

# ========================================
# 슬라이드 4: AS-IS 발주서 프로세스
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 10, 0.7, "02  AS-IS: 발주서 → 작업의뢰서 프로세스", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 4단계 프로세스
process_steps = [
    ("STEP 1", "발주요청 수취", "담당자로부터\n발주서 수신\n(엑셀 파일)", "0.8"),
    ("STEP 2", "규격 정리", "품목별 규격·수량 정리\n동일 규격 그룹핑\nM2 면적 계산", "3.9"),
    ("STEP 3", "ERP 입력", "정리 엑셀을\nERP(바이투)에 입력\n작업의뢰서 생성", "7.0"),
    ("STEP 4", "검증 및 전달", "발주서 vs 작업의뢰서\n비교 검토\n생산지원팀 전달", "10.1"),
]

for step_num, title, desc, x_str in process_steps:
    x = float(x_str)
    add_rect(slide, x, 1.5, 2.7, 0.5, f"{step_num}: {title}", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=14)
    shape = add_box(slide, x, 2.1, 2.7, 1.2)
    add_textbox(slide, x + 0.1, 2.2, 2.5, 1.0, desc, font_size=13, color=DARK_GRAY)

for x in [3.55, 6.65, 9.75]:
    add_arrow_right(slide, x, 2.5, 0.3, 0.25)

# 현재 문제점
add_textbox(slide, 0.8, 3.7, 12, 0.5, "현재 문제점", font_size=20, bold=True, color=ACCENT_RED)

problems = [
    "발주서 양식이 담당자마다 완전히 다름 → 수작업 정리에 시간 소요",
    "규격 그룹핑(동일 규격 묶기)을 사람이 직접 판단·실행",
    "ERP 입력 후 작업의뢰서와 원본 발주서의 일치 여부를 육안으로 대조",
    "오류 발생 시 생산 공정까지 영향 → 재작업, 납기 지연 위험",
]

for i, prob in enumerate(problems):
    y = 4.3 + i * 0.45
    add_textbox(slide, 1.2, y, 0.3, 0.4, "●", font_size=12, color=ACCENT_RED)
    add_textbox(slide, 1.5, y, 11, 0.4, prob, font_size=15, color=DARK_GRAY)

# 개선 희망
add_box(slide, 0.8, 6.2, 11.733, 0.7, fill_color=RGBColor(0xFD, 0xF2, 0xF0), border_color=ACCENT_RED)
add_textbox(slide, 1.2, 6.3, 11, 0.5, "💡 개선 희망:  최초 발주요청서와 완성된 작업의뢰서의 내용이 일치하는지 자동 확인", font_size=16, bold=True, color=ACCENT_RED)

# ========================================
# 슬라이드 5: 발주서 양식 분석
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 10, 0.7, "03  AS-IS: 발주서 양식 분석 — 6종의 서로 다른 양식", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

data = [
    ["담당자", "시트 구성", "양식 특징", "주요 컬럼", "데이터 규모"],
    ["안광식 상무", "17개 시트", "골조도(동호수 배치도)\n+ 물량산출서 + 차수별", "골조도 매트릭스에서\n위치→규격 매핑", "85행×69열"],
    ["이충언 이사", "3개 시트\n(타입별)", "타입별 주문내역\nEA 단위, 개소×수량", "NO/외판내판/두께\n가로/세로/m2/위치", "154행×21열"],
    ["김길홍 과장", "1개 시트", "발주서 표 형태\n발주번호 체계", "위치/제품명/규격\n수량/평수/실리콘/비고", "64행×9열"],
    ["오동석 부장", "32개 시트\n(날짜+내용별)", "매우 세분화된\n발주 이력 관리", "공사명/시공자\n발주일/출고일", "28행×13열"],
    ["외주\n대진글라스", "6개 시트", "골조도 + 동호수 배치도\n글레이징/알유리 구분", "배치도 기반\n위치 매핑", "42행×45열"],
    ["외주\n정석개발", "1개 시트", "생산의뢰서 형태\n대량 데이터", "품목/가로/세로/수량\n위치비고/M2", "484행×16열"],
]
add_table(slide, 0.8, 1.3, 11.733, 5.5, 7, 5, data, col_widths=[1.6, 1.8, 2.8, 2.8, 2.733], font_size=11)

add_box(slide, 0.8, 6.5, 11.733, 0.6, fill_color=RGBColor(0xFD, 0xF2, 0xF0), border_color=ACCENT_RED)
add_textbox(slide, 1.2, 6.55, 11, 0.5, "→ 핵심 과제: 6종 이상의 서로 다른 양식에서 품명/규격/수량/위치를 정확히 추출하는 파서 개발", font_size=15, bold=True, color=ACCENT_RED)

# ========================================
# 슬라이드 6: 데이터 변환 과정
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "04  AS-IS: 발주서 → 규격정리 → ERP 입력 (데이터 변환 과정)", font_size=26, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# Step 1: 원본 발주 데이터
add_rect(slide, 0.5, 1.3, 3.8, 0.4, "① 발주 원본 (34행)", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=13)
data1 = [
    ["품명", "가로", "세로", "수량", "동", "라인", "창", "타입"],
    ["접합+로이", "543", "1745", "6", "302", "1라인(1~6층)", "발코니1", "59A"],
    ["접합+로이", "543", "1745", "6", "302", "2라인(1~6층)", "발코니1", "59B"],
    ["접합+로이", "591", "1748", "6", "302", "1라인(1~6층)", "침실2", "59A"],
    ["접합+로이", "591", "1748", "6", "302", "1라인(1~6층)", "침실3", "59A"],
    ["접합+로이", "591", "1748", "6", "302", "2라인(1~6층)", "침실2", "59B"],
    ["...", "...", "...", "...", "...", "...", "...", "..."],
]
add_table(slide, 0.5, 1.75, 3.8, 2.8, 7, 8, data1, col_widths=[0.7, 0.4, 0.4, 0.35, 0.35, 0.7, 0.5, 0.4], font_size=9)

add_arrow_right(slide, 4.4, 2.8, 0.4, 0.3)

# Step 2: 규격정리
add_rect(slide, 5.0, 1.3, 3.5, 0.4, "② 규격정리 (크기순 정렬 + M2)", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=13)
data2 = [
    ["위치", "가로", "세로", "수량", "M2"],
    ["302동1라인거실59A외창", "1646", "1748", "6", "17.26"],
    ["302동2라인거실59B외창", "1646", "1748", "6", "17.26"],
    ["302동3라인거실59A외창", "1646", "1748", "5", "14.39"],
    ["302동1라인침실2 59A외창", "591", "1748", "6", "6.20"],
    ["302동1라인침실3 59A외창", "591", "1748", "6", "6.20"],
    ["...", "...", "...", "63", "95.41"],
]
add_table(slide, 5.0, 1.75, 3.5, 2.8, 7, 5, data2, col_widths=[1.2, 0.5, 0.5, 0.4, 0.5], font_size=9)

add_arrow_right(slide, 8.6, 2.8, 0.4, 0.3)

# Step 3: ERP 입력용
add_rect(slide, 9.2, 1.3, 3.6, 0.4, "③ ERP 입력용 (10행으로 압축)", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=13)
data3 = [
    ["위치 (묶음)", "가로", "세로", "수량"],
    ["302동1~3라인\n거실59A,B외창픽스", "1646", "1748", "17"],
    ["302동1~3라인\n침실2,3 59A,B외창픽스", "591", "1748", "34"],
    ["302동1,2라인\n발코니159A,B단창픽스", "543", "1745", "12"],
    ["302동1~3라인\n주방/식당59A,B내창", "435", "794", "34"],
    ["302동1~3라인\n다용도59A,B내창", "285", "794", "34"],
]
add_table(slide, 9.2, 1.75, 3.6, 2.8, 6, 4, data3, col_widths=[1.6, 0.5, 0.5, 0.5], font_size=9)

# 그룹핑 규칙 설명
add_textbox(slide, 0.5, 4.8, 12, 0.5, "규격 그룹핑 규칙", font_size=20, bold=True, color=DARK_GRAY)

rules = [
    ["규칙", "원본 (개별)", "결과 (묶음)", "설명"],
    ["라인 통합", "1라인 + 2라인 + 3라인", "1~3라인", "연속: 1~3, 불연속: 1,2"],
    ["타입 통합", "59A + 59B", "59A,B", "동일 규격의 다른 타입"],
    ["위치 통합", "침실2 + 침실3", "침실2,3", "동일 규격의 다른 위치"],
    ["수량 합산", "6 + 6 + 6 + 6 + 5 + 5", "34", "개별 수량 단순 합산"],
    ["M2 계산", "-", "가로×세로×수량 / 1,000,000", "mm 단위 → m2 변환"],
]
add_table(slide, 0.5, 5.3, 12.333, 2.0, 6, 4, rules, col_widths=[1.5, 3.0, 3.5, 4.333], font_size=11)

# ========================================
# 슬라이드 7: 발주서 ↔ 작업의뢰서 검증
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "05  AS-IS: 발주서 ↔ 작업의뢰서 검증", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 좌측: 원본 발주 데이터
add_rect(slide, 0.5, 1.4, 5.5, 0.4, "원본 발주서 (ERP 입력용)", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=14)
data_l = [
    ["No", "품명", "규격", "수량", "비고"],
    ["1", "26.76T 10.76투명접합\n+10A+6로이", "1,646×1,748", "17", "거실59A,B외창픽스"],
    ["2", "", "591×1,748", "34", "침실2,3 외창픽스"],
    ["3", "", "543×1,745", "12", "발코니1 단창픽스"],
    ["소계", "", "", "63", ""],
    ["4", "24T 6CL+12A+6CL", "435×794", "34", "주방/식당 내창"],
    ["5", "", "285×794", "34", "다용도 내창"],
    ["소계", "", "", "68", ""],
    ["합계", "", "", "262", ""],
]
add_table(slide, 0.5, 1.85, 5.5, 3.6, 9, 5, data_l, col_widths=[0.5, 1.6, 1.0, 0.6, 1.5], font_size=10)

# 비교 화살표
add_textbox(slide, 6.1, 3.2, 1, 0.5, "비교\n검증", font_size=16, bold=True, color=ACCENT_RED, alignment=PP_ALIGN.CENTER)
add_arrow_right(slide, 6.2, 2.8, 0.6, 0.3)
add_textbox(slide, 6.0, 3.7, 1.2, 0.3, "(현재: 육안)", font_size=11, color=MID_GRAY, alignment=PP_ALIGN.CENTER)

# 우측: 작업의뢰서
add_rect(slide, 7.0, 1.4, 5.5, 0.4, "ERP 출력 작업의뢰서 (의뢰번호: 26-2247)", fill_color=ACCENT_GREEN, font_color=WHITE, font_size=14)
data_r = [
    ["No", "품명", "규격", "수량", "면적", "비고"],
    ["1", "26.76T 10.76투명접합\n+10A+6로이", "1,646×1,748", "17", "48.96", "거실59A,B외창픽스"],
    ["2", "", "591×1,748", "34", "35.02", "침실2,3 외창픽스"],
    ["3", "", "543×1,745", "12", "11.40", "발코니1 단창픽스"],
    ["소계", "", "", "63", "95.38", ""],
    ["4", "24T 6CL+12A+6CL", "435×794", "34", "11.90", "주방/식당 내창"],
    ["5", "", "285×794", "34", "9.52", "다용도 내창"],
    ["소계", "", "", "68", "21.42", ""],
    ["합계", "", "", "262", "206.74", ""],
]
add_table(slide, 7.0, 1.85, 5.5, 3.6, 9, 6, data_r, col_widths=[0.5, 1.3, 1.0, 0.6, 0.6, 1.2], font_size=10)

# 검증 항목
add_textbox(slide, 0.5, 5.7, 12, 0.5, "검증 대상 항목", font_size=18, bold=True, color=DARK_GRAY)

checks = [
    ["검증 항목", "비교 내용", "불일치 유형 예시"],
    ["품명", "발주서 표기 ↔ ERP 표기", "5CL/0.76PVB/5CL+10ALC+6EMT178 ≠ 26.76T 10.76투명접합+10A+6로이 (표기법 차이)"],
    ["규격(가로×세로)", "mm 단위 정수 비교", "591×1748 vs 591×1,748 (쉼표 유무)"],
    ["수량", "발주 수량 = 의뢰 수량", "발주 34 ≠ 의뢰 30 (입력 오류)"],
    ["비고(위치)", "위치정보 일치 여부", "침실2,3 ≠ 침실2 (누락)"],
]
add_table(slide, 0.5, 6.2, 12.333, 1.2, 5, 3, checks, col_widths=[1.8, 2.5, 8.033], font_size=10)

# ========================================
# 슬라이드 8: 복층 생산실적 AS-IS
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "06  AS-IS: 복층 생산실적 집계", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 프로세스 흐름
steps_prod = [
    ("작업의뢰서\n(ERP 출력)", 0.5),
    ("복층 생산\n+ MES 라벨", 3.3),
    ("수기 체크\n(작업의뢰서에 표시)", 6.1),
    ("복층생산일지\n(엑셀 수기 입력)", 8.9),
    ("주간생산일지\n(주간 집계)", 11.3),
]

for i, (text, x) in enumerate(steps_prod):
    add_rect(slide, x, 1.3, 2.3, 0.7, text, fill_color=ACCENT_BLUE if i != 2 else ACCENT_RED, font_color=WHITE, font_size=12)
    if i < len(steps_prod) - 1:
        add_arrow_right(slide, x + 2.35, 1.5, 0.4, 0.25)

# 수기 체크 방식 설명
add_textbox(slide, 0.5, 2.3, 6, 0.5, "수기 체크 방식 (작업의뢰서에 직접 표시)", font_size=18, bold=True, color=DARK_GRAY)

marks = [
    ["표시 방법", "의미", "예시"],
    ["빨간 동그라미 ⭕", "전량 생산 완료", "수량 120 → ⭕ (120매 전량 완료)"],
    ["수기 숫자 (빨간펜)", "해당 수량만 생산 완료", "수량 60 중 30만 완료 → '30'"],
    ["검정 동그라미", "이전에 생산된 수량", "전일 생산분 표시"],
    ["날짜 메모", "분할 생산 기록", "8/22 23기, 납기 8/21"],
]
add_table(slide, 0.5, 2.8, 6.2, 1.8, 5, 3, marks, col_widths=[2.0, 2.0, 2.2], font_size=11)

# 복층생산일지 샘플
add_textbox(slide, 0.5, 4.8, 6, 0.5, "복층생산일지 엑셀 (일간) — 샘플", font_size=18, bold=True, color=DARK_GRAY)

prod_data = [
    ["주문번호", "거래처", "종류", "재료종류", "두께", "AR", "가로", "세로", "수량외", "수량(매)", "수량(평)"],
    ["26-0302", "계룡건설 KT인재개발원", "U3", "6CL+12A+6로이", "24", "", "770", "1981", "10조외10", "20", "216.71"],
    ["26-0304", "계룡건설 KT인재개발원", "U3", "5CL+12Ar.+5로이", "22", "AR", "1725", "1981", "18조외183", "201", "2334.92"],
    ["", "", "U3", "6CL+12A+6로이", "24", "", "615", "1981", "10조외18", "28", "223.03"],
    ["26-0354", "제일건설 인천검단", "U3", "5newGN+14A+5로이", "24", "", "618", "1890", "12조외60", "72", "437.12"],
    ["", "", "U3", "5CL+14A+5로이", "24", "", "1662", "1890", "10조외90", "100", "1039.99"],
]
add_table(slide, 0.5, 5.3, 12.333, 2.0, 6, 11, prod_data, col_widths=[0.9, 2.0, 0.5, 1.6, 0.5, 0.4, 0.6, 0.6, 1.0, 0.7, 0.8], font_size=9)

# 참고: 외판+내판 쌍
add_textbox(slide, 7.0, 2.3, 5.5, 0.4, "참고: 복층유리 = 외판 + 내판 1쌍", font_size=16, bold=True, color=DARK_GRAY)
add_textbox(slide, 7.0, 2.8, 5.5, 1.5,
    "• 하나의 주문번호에 2행씩 기록 (외판/내판)\n"
    "• 종류 'U3': 복층유리 분류 코드\n"
    "• AR: 아르곤 가스 충전 여부\n"
    "• 수량외: '2조외24' = 2팔레트 + 24매\n"
    "• 시트 수: 103개 (1월~5월 영업일)\n"
    "• 업체현장명 마스터: 167개 거래처",
    font_size=13, color=DARK_GRAY)

# ========================================
# 슬라이드 9: 재단 생산실적 AS-IS
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "07  AS-IS: 재단 생산실적 (절단일보)", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 프로세스
add_textbox(slide, 0.5, 1.3, 12, 0.5, "재단 프로세스", font_size=18, bold=True, color=DARK_GRAY)

steps_cut = [
    ("작업의뢰서\n수령", 0.5),
    ("원판에서\n유리 재단(절단)", 3.3),
    ("수기 체크\n(원판 종류/수량 기록)", 6.1),
    ("절단일보\n(엑셀 수기 입력)", 8.9),
]
for i, (text, x) in enumerate(steps_cut):
    add_rect(slide, x, 1.8, 2.3, 0.7, text, fill_color=ACCENT_BLUE if i != 2 else ACCENT_RED, font_color=WHITE, font_size=12)
    if i < len(steps_cut) - 1:
        add_arrow_right(slide, x + 2.35, 1.95, 0.4, 0.25)

# 절단일보 샘플
add_textbox(slide, 0.5, 2.8, 12, 0.5, "절단일보 엑셀 (일간) — 2026.08.25 샘플", font_size=18, bold=True, color=DARK_GRAY)

cut_data = [
    ["주문번호", "거래처", "두께", "품명", "수량", "m2", "", "원판 품명", "원판 가로", "원판 세로", "원판 수량", "원판 m2", "비고"],
    ["26-2239", "대원-용인", "10", "10투명강화", "1", "2.41", "", "10CL", "2438", "3353", "3", "24.52", "2239,2222 같이재단"],
    ["26-2222", "유광-오창", "10", "10투명강화", "5", "15.85", "", "", "", "", "", "", "같이재단"],
    ["26-2248", "대진-대우", "24", "6CL+6CL", "102", "139.91", "", "6CL", "2438", "3353", "20", "163.49", "일면투명 재단"],
    ["26-2191", "정석-테크노", "22", "5newGN+5DURA", "34", "54.96", "", "5NX", "1829", "3353", "12", "73.59", "정석 원판 사용"],
    ["", "", "22", "5CL+5DURA", "34", "54.96", "", "5CL", "1829", "3353", "12", "73.59", "정석 원판 사용"],
]
add_table(slide, 0.5, 3.3, 12.333, 2.3, 6, 13, cut_data,
    col_widths=[0.85, 0.9, 0.4, 1.1, 0.5, 0.6, 0.15, 0.9, 0.65, 0.65, 0.65, 0.65, 1.4], font_size=9)

# 핵심 특징
add_textbox(slide, 0.5, 5.8, 6, 0.5, "절단일보 핵심 특징", font_size=18, bold=True, color=DARK_GRAY)

features = [
    "• 좌측: 재단 대상 (어떤 주문의 어떤 유리를 절단했는지)",
    "• 우측: 사용 원판 (어떤 원판에서 몇 장을 사용했는지)",
    "• 여러 주문을 하나의 원판에서 함께 재단 가능 ('같이재단')",
    "• '오도시': 소량 건은 재단기 없이 수작업 절단",
    "• 시트 수: 185개 (1월~8월 영업일)",
]
add_textbox(slide, 0.5, 6.3, 6.5, 1.2, "\n".join(features), font_size=13, color=DARK_GRAY)

# 표준 원판 규격
add_textbox(slide, 7.5, 5.8, 5, 0.5, "확인된 표준 원판 규격", font_size=18, bold=True, color=DARK_GRAY)

plate_data = [
    ["원판 코드", "가로(mm)", "세로(mm)", "면적(m2)"],
    ["표준1", "2438", "3353", "8.17"],
    ["표준2", "1981", "3353", "6.64"],
    ["표준3", "1829", "3353", "6.13"],
    ["표준4", "1829", "3048", "5.57"],
]
add_table(slide, 7.5, 6.3, 5.0, 1.2, 5, 4, plate_data, col_widths=[1.2, 1.1, 1.1, 1.1], font_size=11)

# ========================================
# 슬라이드 10: TO-BE 개발 방향
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "08  TO-BE: AX 개발 방향", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 영역 1: 업무지원
add_rect(slide, 0.5, 1.3, 5.8, 0.5, "영역 ①  업무지원 AX: 발주서 자동 정리·검증", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=16)

funcs_1 = [
    ("기능 1", "발주서 자동 파싱\n& 규격 정리", "발주서 엑셀 업로드\n→ 품명/규격/수량/위치\n   자동 추출\n→ 동일 규격 그룹핑\n→ ERP 입력용 엑셀 생성"),
    ("기능 2", "발주서 ↔ 작업의뢰서\n자동 비교 검증", "발주서 + 작업의뢰서\n→ 품명/규격/수량/비고\n   항목별 자동 대조\n→ 불일치 리포트 생성"),
    ("기능 3", "ERP 입력 데이터\n자동 생성", "규격정리 결과\n→ ERP 엑셀 양식(16열)\n   자동 매핑\n→ 면적/두께 자동 계산"),
]

for i, (num, title, desc) in enumerate(funcs_1):
    x = 0.5 + i * 2.0
    add_rect(slide, x, 1.9, 1.8, 0.6, f"{num}\n{title}", fill_color=VERY_LIGHT_GRAY, font_color=DARK_GRAY, font_size=10, bold=True)
    shape = add_box(slide, x, 2.6, 1.8, 1.6)
    add_textbox(slide, x + 0.1, 2.65, 1.6, 1.5, desc, font_size=9, color=DARK_GRAY)

# 영역 2: 생산
add_rect(slide, 6.8, 1.3, 5.8, 0.5, "영역 ②  생산 AX: 생산실적 자동 집계", fill_color=ACCENT_RED, font_color=WHITE, font_size=16)

funcs_2 = [
    ("기능 4", "복층 생산실적\n자동 집계", "작업의뢰서 로딩\n→ 생산완료 입력 UI\n  (전량/부분/분할)\n→ 복층생산일지\n   자동 작성"),
    ("기능 5", "재단 실적\n(절단일보) 자동", "작업의뢰서 로딩\n→ 재단 수량 입력\n→ 사용 원판 입력\n→ 절단일보\n   자동 작성"),
    ("기능 6", "주간 생산실적\n자동 집계", "일간 생산 데이터\n→ 주차별 자동 집계\n→ KPI 계산\n  (생산조/M2/목표대비)\n→ 주간생산일지"),
]

for i, (num, title, desc) in enumerate(funcs_2):
    x = 6.8 + i * 2.0
    add_rect(slide, x, 1.9, 1.8, 0.6, f"{num}\n{title}", fill_color=VERY_LIGHT_GRAY, font_color=DARK_GRAY, font_size=10, bold=True)
    shape = add_box(slide, x, 2.6, 1.8, 1.6)
    add_textbox(slide, x + 0.1, 2.65, 1.6, 1.5, desc, font_size=9, color=DARK_GRAY)

# 개발 접근 전략
add_textbox(slide, 0.5, 4.5, 12, 0.5, "개발 접근 전략", font_size=20, bold=True, color=DARK_GRAY)

strategy = [
    ["단계", "내용", "산출물", "비고"],
    ["1단계\nMVP", "핵심 기능 우선 개발\n(발주서 파싱 + 검증)", "Python 기반\n엑셀 자동화 도구", "가장 큰 Pain point\n해결 우선"],
    ["2단계\n확장", "생산실적 자동 집계\n+ 웹 대시보드", "웹 기반\n실적 조회/모니터링", "MES 연동\n검토"],
    ["3단계\n고도화", "현장 입력 UI\n+ AI 기반 이상탐지", "태블릿/모바일 앱\n바코드 스캔 연동", "전사 시스템\n통합"],
]
add_table(slide, 0.5, 5.0, 12.333, 2.2, 4, 4, strategy, col_widths=[1.5, 3.5, 3.0, 4.333], font_size=12)

# ========================================
# 슬라이드 11: TO-BE 기능별 상세
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "09  TO-BE: 기능별 상세 — 품명 변환 & 위치 정보 체계", font_size=26, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 품명 매핑 테이블
add_textbox(slide, 0.5, 1.3, 12, 0.5, "품명 변환 테이블 (발주서 표기 → ERP/작업의뢰서 표기)", font_size=18, bold=True, color=DARK_GRAY)

name_map = [
    ["발주서 표기", "ERP/작업의뢰서 표기", "두께 계산", "유리 구성"],
    ["5CL/0.76PVB/5CL+10ALC+6EMT178", "26.76T 10.76투명접합+10A+6로이", "5+0.76+5+10+6=26.76", "접합유리+간봉+로이"],
    ["6CL+12ALC+6CL", "24T 6CL+12A+6CL", "6+12+6=24", "투명+간봉+투명"],
    ["6CL+12ALC+6EMT178", "24T 6CL+12A+6로이", "6+12+6=24", "투명+간봉+로이"],
    ["5GN+12AR+5LE", "22T 5newGN+12Ar.+5로이", "5+12+5=22", "그린+아르곤+로이"],
    ["5CL+12AR+5LE", "22T 5CL+12Ar.+5로이", "5+12+5=22", "투명+아르곤+로이"],
    ["그린 로이복층유리", "22T 5newGN+12Ar.+5로이", "5+12+5=22", "한글 표기 → 코드"],
    ["22mm 그린 로이복층 (아르곤)", "22T 5newGN+12Ar.+5DURA MAX", "22T", "정석개발 양식"],
]
add_table(slide, 0.5, 1.8, 12.333, 3.0, 8, 4, name_map, col_widths=[3.5, 3.5, 2.333, 3.0], font_size=10)

# 위치 정보 체계
add_textbox(slide, 0.5, 5.0, 12, 0.5, "위치 정보 구조 분석", font_size=18, bold=True, color=DARK_GRAY)

loc_data = [
    ["구성요소", "예시 값", "패턴", "비고"],
    ["동", "101동, 201동, 302동, 9동", "{N}동", "건물 동 번호"],
    ["라인", "1라인, 2라인, 1~3라인, 1,2라인", "{N}라인 또는 {N~M}라인", "세대 라인 (호수 계열)"],
    ["층 범위", "(1~6층), (2~6층), (16F-18F)", "({N~M}층) 또는 [{NF-MF}]", "해당 층 범위"],
    ["창 위치", "거실, 침실1~3, 발코니1, 주방/식당,\n다용도, 드레스룸, 알파룸, 세탁실", "고정 텍스트", "건물 내 위치"],
    ["타입", "59A, 59B, 55F, 84AL, 113C", "{면적}{타입코드}", "세대 평형/타입"],
    ["창 구분", "외창픽스, 외창밴트(SL), 내창(LS),\n단창픽스, 단창밴트", "고정 텍스트", "창호 종류"],
]
add_table(slide, 0.5, 5.5, 12.333, 1.8, 7, 4, loc_data, col_widths=[1.3, 3.0, 3.0, 5.033], font_size=10)

# ========================================
# 슬라이드 12: 확인 필요사항 / 논의
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)
add_textbox(slide, 0.8, 0.4, 12, 0.7, "10  확인 필요 사항 / 논의", font_size=28, bold=True, color=DARK_GRAY)
add_line(slide, 0.8, 1.05, 11.733, ACCENT_BLUE, 2)

# 업무지원 질문
add_rect(slide, 0.5, 1.3, 6.0, 0.4, "업무지원 (발주서) 관련", fill_color=ACCENT_BLUE, font_color=WHITE, font_size=14)

q1 = [
    ("Q1", "발주서 양식 통일 가능한가?\n→ 6종 이상의 완전히 다른 양식, 최소 필수 컬럼이라도 통일 가능?"),
    ("Q2", "발주서 수취 경로는?\n→ 이메일? 카카오톡? 공유폴더? 형태(엑셀/PDF/이미지)?"),
    ("Q3", "규격 그룹핑 규칙에 예외가 있는가?\n→ 납기일/시공 순서 등으로 묶지 않는 경우?"),
    ("Q4", "ERP(바이투) API 연동 가능한가?\n→ 현재는 엑셀 import만, API 존재 여부?"),
    ("Q5", "품명 변환 규칙이 정리되어 있는가?\n→ 발주서 표기 → ERP 표기 매핑 테이블?"),
]

for i, (q, text) in enumerate(q1):
    y = 1.85 + i * 0.65
    add_rect(slide, 0.5, y, 0.5, 0.3, q, fill_color=ACCENT_BLUE, font_color=WHITE, font_size=10, bold=True)
    add_textbox(slide, 1.1, y - 0.05, 5.4, 0.6, text, font_size=11, color=DARK_GRAY)

# 생산실적 질문
add_rect(slide, 6.8, 1.3, 6.0, 0.4, "생산실적 관련", fill_color=ACCENT_RED, font_color=WHITE, font_size=14)

q2 = [
    ("Q6", "MES에서 생산 완료 데이터 추출 가능한가?\n→ 바코드 스캔 이력, 생산 수량 데이터 export?"),
    ("Q7", "분할 생산 빈도는?\n→ 하나의 의뢰서를 여러 날에 걸쳐 생산하는 비율?"),
    ("Q8", "재단 ↔ 복층 연결 관계는?\n→ 동일 작업의뢰서? 별도 문서?"),
    ("Q9", "원판 규격/종류 마스터 목록이 있는가?\n→ 표준 원판 사이즈 전체 리스트?"),
    ("Q10", "두 영역 중 우선순위는?\n→ 업무지원 vs 생산실적, 어느 쪽 Pain point가 더 큰지?"),
]

for i, (q, text) in enumerate(q2):
    y = 1.85 + i * 0.65
    add_rect(slide, 6.8, y, 0.5, 0.3, q, fill_color=ACCENT_RED, font_color=WHITE, font_size=10, bold=True)
    add_textbox(slide, 7.4, y - 0.05, 5.4, 0.6, text, font_size=11, color=DARK_GRAY)

# 추가 데이터 요청
add_textbox(slide, 0.5, 5.4, 12, 0.5, "추가 데이터 요청", font_size=18, bold=True, color=DARK_GRAY)

req_data = [
    ["요청 항목", "용도", "현재 상태"],
    ["품명 코드 마스터 목록", "품명 자동 변환 규칙 구축", "일부 매핑 확인, 전체 목록 필요"],
    ["거래처/현장 마스터 목록", "ERP 데이터 매핑", "업체현장명 시트에 167개 확인"],
    ["ERP(바이투) import 양식 사양서", "ERP 연동 개발", "16열 양식 확인, 상세 규칙 필요"],
    ["MES 데이터 export 샘플", "생산실적 자동화", "라벨 구조 확인, 이력 데이터 필요"],
    ["원판 규격/종류 마스터", "절단일보 자동화", "4개 규격 확인, 전체 목록 필요"],
]
add_table(slide, 0.5, 5.9, 12.333, 1.4, 6, 3, req_data, col_widths=[3.5, 4.0, 4.833], font_size=11)

# ========================================
# 슬라이드 13: 감사 / Q&A
# ========================================
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_slide_bg(slide)

add_line(slide, 2, 2.5, 9.333, ACCENT_BLUE, 3)
add_textbox(slide, 1, 3.0, 11.333, 1.0, "감사합니다", font_size=44, bold=True, color=DARK_GRAY, alignment=PP_ALIGN.CENTER)
add_textbox(slide, 1, 4.0, 11.333, 0.8, "Q & A", font_size=32, color=MID_GRAY, alignment=PP_ALIGN.CENTER)
add_line(slide, 2, 4.8, 9.333, ACCENT_BLUE, 3)

output_path = "data/동일유리_AX_프로젝트_분석.pptx"
prs.save(output_path)
print(f"PPT 저장 완료: {output_path}")
