# NetOps 운용 콘솔 — 공개판

계정·로그인 없이 쓰는 멀티벤더 네트워크 운용 웹앱 (Cisco·Huawei·Juniper·Arista·Extreme EXOS/VOSS·ALE·Nokia·A10).

**열기:** https://seong26-cpu.github.io/netops/

## 저장 방식 — 내 저장소만 사용
| 순서 | 저장소 | 설명 |
|---|---|---|
| ① 추천 | 내 PC 폴더 | 처음 화면 또는 관리 › 저장소·표준 팩에서 폴더 지정 (PC Chrome·Edge). `data/*.json`에 자동 저장 |
| ② | 이 브라우저 | 폴더를 지정하지 않으면 IndexedDB에 임시 저장 |
| ③ | 백업 파일 | 설정 › 백업 파일 저장·복원 (어느 브라우저든) |

- 서버·계정 없음. 운영자도 사용자 데이터를 볼 수 없습니다.
- 비밀번호·장비 출력 원문은 저장하지 않습니다.
- 폴더를 구글 드라이브·OneDrive 동기화 폴더나 USB로 고르면 다른 PC에서 같은 폴더를 지정해 이어서 씁니다.

## 저장 폴더 구조
```
📁 내 폴더
├ data/           구성도·설정·작업 (자동)
├ standard-pack/  벤더·OS별 표준 CONFIG + model-ports.txt
├ exports/        만든 CONFIG
└ backup/         폴더 연결 전 브라우저 내용
```

## 표준 CONFIG 팩 (`packs/standard-pack.json`)
- 벤더·OS 10종 기본 보안·관리 틀: hostname·SSH·계정·NTP·Syslog·SNMPv3·배너
- 공식/공개 자료로 문법을 확인한 줄만 그대로, 확인 못 한 줄은 `[확인 필요]` 주석 처리. 각 틀에 출처 URL 포함
- 모델별 포트 구성 5종(데이터시트 기준) → 버튼 하나로 설정 › 모델 목록에 추가

## 파일
- `storage.js` — 폴더 저장소·표준 팩·첫 화면 안내
- `ui-fix.js` — 밝은 화면 기본·화면 폭별 배치·경계선 크기 조절
- `addons.js` — 운용 도구(원복 CONFIG·비교·IP 계획표·점검 명령·변경 이력)
- `pwa-install.js`, `sw.js`, `manifest.webmanifest` — 휴대폰·PC 앱 설치, 오프라인
