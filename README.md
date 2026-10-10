# DEWPOP

같은 색 액체를 왼쪽 벽부터 오른쪽 벽까지 이으면 팡! 터지는 액체 물리 퍼즐입니다. 위에 얹으면 아래 물이 눌려 퍼지고, 무거운 색은 가라앉고, 흔들면 순식간에 정렬됩니다. 웹(모바일 세로 화면 우선)에서 동작합니다.

## 실행
```bash
npm start            # http://localhost:4181 (node server.mjs: 정적 파일 + 플레이 기록 저장 API)
npm test             # 입자 엔진 테스트 (node)
node tests-grid.mjs  # 칸 엔진 테스트
npm run test:browser # Playwright 모바일·데스크톱 통합 테스트 (서버 실행 중일 때)
node sim.mjs 5 smart 200          # 무한 모드 봇 생존 측정 (random | smart)
node balance-levels.mjs 2 20 6    # 레벨별 봇 클리어율
node analyze.mjs                  # logs/ 의 플레이 기록 분석
node replay.mjs [id]              # 기록을 그대로 재생해 recordings/<id>/replay.webm + 장면 캡처 생성
node replay-check.mjs             # 기록 → 재생 결과가 동일한지 검증
```

## 구조
| 파일 | 역할 |
|---|---|
| `dist/engine-grid.js` | **기본 엔진.** 칸 기반 액체(셀 오토마타): 낙하·비탈·퍼짐 예산·눌림·기울이기. 예측 가능하고 결정적 |
| `dist/engine.js` | 순수 로직: 2D 입자 액체(이중 밀도 완화 + 같은 색 스프링 응집 + 벽 젖음 + 수면), 방울 세트, 벽-벽 팡 판정, 진흙·진주, 기울이기, 목표 |
| `dist/liquid-gl.js` | WebGL2 렌더러: 색별 밀도 필드(MRT) → 가우시안 블러 → 굴절·정반사·프레넬 합성 |
| `dist/app.js` | 입력(끌어 놓기 조준), HUD, 사운드(WebAudio 합성), 화면 전환, 진행 저장 |
| `dist/levels.js` | 어드벤처 20레벨 |
| `assets-src/`, `asset-prompts.json`, `gen.sh` | Codex imagegen 원본과 프롬프트 |

`dist/` 폴더만 정적 호스팅하면 됩니다. WebGL2가 없으면 2D 원 렌더링으로 대체됩니다.

## 플레이 기록
- 실험 옵션의 "플레이 기록 (분석용)"이 켜져 있으면(기본값), 매 판의 시드, 설정, 모든 조작(물리 스텝 번호 포함)과 결과가 `logs/<id>.json`에 저장됩니다. 기록 중에는 화면 위에 ● REC가 표시됩니다.
- 엔진이 결정적이라 `?replay=<id>`로 열면 같은 판이 정확히 재현됩니다.

## 홈 화면에 추가 (PWA)
- `dist/manifest.webmanifest`, `dist/sw.js`(네트워크 우선 + 오프라인 캐시, /api 제외), 아이콘 192/512/maskable.
- 시작 화면의 "📲 홈 화면에 추가": Android/데스크톱 Chrome은 설치 창, iOS는 공유 → 홈 화면에 추가 안내.
- 서비스 워커·Android 설치 창은 HTTPS(또는 localhost)에서만 동작. iOS 홈 화면 추가는 http에서도 전체 화면으로 열림.
