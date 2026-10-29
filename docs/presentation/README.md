# 발표자료 원본

동일유리 방문 시연용 자료의 HTML 원본. PDF는 `data/` 에 있다.

- `deck.html` — 발표 슬라이드 12장 (297×167mm, 16:9)
- `plan.html` — 시연 진행 계획서 (A4 2장)

`LOGO_SRC` 자리에 `public/dongil-logo.png` 의 base64 를 넣어 빌드한다.

## PDF 재생성

```bash
node scripts/build-presentation.mjs
```

Chrome 헤드리스로 인쇄한다. Chrome 이 없으면 Edge 경로로 바꿔 쓰면 된다.
내용을 고칠 때는 PDF 가 아니라 이 HTML 을 고치고 다시 빌드한다.
