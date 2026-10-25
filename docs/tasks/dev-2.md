# 보관용 README 추가

요청: 저장소 맨 위에 README.md 파일을 새로 만들어줘. 내용은 "이 앱은 더 이상 사용하지 않음. AI_Agent 투자 에이전트로 옮길 부품 보관용 저장소. 주요 부품: api/ 폴더(naver, yahoo, edgar, fng, kis 시세 수집), public/kis_master.json(매주 자동 갱신), public/backtest.js·gurus.js(백테스트), index.html의 TRUSTED_SOURCES·SOURCE_RULES(AI 출처 규칙)" 를 쉬운 말로 정리. 다른 파일은 건드리지 마.

## 무엇을 바꾸나
- 새 파일 1개만 만듭니다: 저장소 맨 위의 `README.md`
- 이유: 이 앱은 이제 쓰지 않고, 쓸만한 부품을 새 'AI_Agent 투자 에이전트'로 옮기기 위해 보관만 합니다. 나중에 누가 봐도 "어떤 부품이 어디에 있는지" 바로 알 수 있게 안내문을 남기는 것입니다.
- 지금 저장소에는 README가 없습니다(확인함).

## README에 쓸 내용 (쉬운 말로)
1. 첫 줄 안내: "이 앱은 더 이상 사용하지 않습니다. AI_Agent 투자 에이전트로 옮길 부품을 보관하는 저장소입니다."
2. 주요 부품 목록:
   - `api/` 폴더 — 시세·정보를 가져오는 부품. naver.js(네이버), yahoo.js·yahoo-sector.js(야후), edgar.js(미국 공시), fng.js·fng-kr.js(공포·탐욕 지수), kis.js·kis-history.js·kis-sector.js·kis-dividend.js(한국투자증권). 실제로 있는 파일 이름을 그대로 적습니다.
   - `public/kis_master.json` — 종목 목록 파일. 매주 자동으로 새로 받아짐(`.github/workflows/update-kis-master.yml`이 담당). 미국 종목판 `kis_master_us.json`도 함께 있다고 한 줄 덧붙입니다.
   - `public/backtest.js`, `public/gurus.js` — 과거 데이터로 투자 방법을 시험해 보는(백테스트) 부품.
   - `index.html` 안의 `TRUSTED_SOURCES`, `SOURCE_RULES` — AI가 답할 때 어떤 출처를 믿고 어떻게 표시할지 정한 규칙(약 666~669번째 줄 근처).
3. 각 부품은 한두 줄로 "무엇을 하는지"만 짧게 적고, 어려운 용어는 괄호로 풀어 씁니다.
4. 열쇠·비밀번호 같은 비밀값은 README에 적지 않습니다.

## 화면·동작은 어떻게 달라지나
- 앱 화면과 동작은 전혀 바뀌지 않습니다. GitHub 저장소 첫 페이지에 안내문이 보이게 될 뿐입니다.

## 확인 방법 (자동 테스트가 없음)
- `git status`로 바뀐 파일이 `README.md` 하나뿐인지 봅니다.
- `git show --stat HEAD`로 커밋에 `README.md`만 들어갔는지 봅니다.
- README를 열어 위 4가지 부품이 모두 적혀 있는지, 적힌 파일 이름이 실제로 있는지(api/ 폴더 목록, public/ 폴더 목록과 비교) 눈으로 확인합니다.
- `index.html`에서 `TRUSTED_SOURCES`, `SOURCE_RULES`를 검색해 실제로 있는지 확인합니다.

## 하지 않을 것
- README.md 말고 다른 파일(코드, index.html, json, workflow)은 열어서 고치지 않습니다.
- 앱을 끄거나 지우거나 배포 설정을 바꾸지 않습니다.
- push 하지 않습니다(앱이 함). data/ 폴더나 비밀값은 읽지 않습니다.

## 확인 목록
1. 저장소 맨 위에 README.md 파일이 새로 생겼다
2. README 첫 부분에 '더 이상 사용하지 않음, AI_Agent 투자 에이전트로 옮길 부품 보관용'이라는 안내가 있다
3. api/ 폴더 부품(naver, yahoo, edgar, fng, kis)이 실제 파일 이름과 함께 적혀 있다
4. public/kis_master.json이 매주 자동 갱신된다는 설명이 있다
5. public/backtest.js와 gurus.js가 백테스트 부품이라고 적혀 있다
6. index.html의 TRUSTED_SOURCES·SOURCE_RULES가 AI 출처 규칙이라고 적혀 있다
7. README에 비밀값(키·비밀번호)이 들어 있지 않다
8. git show --stat HEAD 결과에 README.md 하나만 바뀌었다
9. 커밋 메시지가 한국어로 짧게 적혀 있고 push는 하지 않았다
