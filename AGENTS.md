# AGENTS.md — COC Data Viewer V1 개발 가이드

이 문서는 대화 기록 없이 repository만 보고 개발을 이어가는 coding agent를 위한 가이드다.
여기 적힌 내용은 전부 이 repo의 실제 파일에서 확인할 수 있다.

## 1. 프로젝트 목적

COC 자작차(Formula Student)의 ESP32 데이터로거가 SD 카드에 남기는 **binary `.log` 파일**을
브라우저에서 분석하는 오프라인 웹 뷰어 (**COC Data Viewer V1**).

- **browser-local / offline / serverless**: 서버·로그인·DB·외부 업로드 없음.
  모든 파싱과 분석은 브라우저 안에서만 수행한다 (Browser File API + Web Worker).
- 범용 뷰어가 아니라 COC 차량 테스트를 빠르게 분석하는 도구다.
- 스택: React + TypeScript(strict) + Vite + ECharts(Graphs 단계에서 사용 예정) + Vitest.

## 2. Source of truth 우선순위

충돌 시 위가 이긴다. 아래 파일에 없는 것은 **추측하지 말고 사용자에게 물어라.**

1. **`reference/protocol.h`** — binary 레코드 레이아웃의 유일한 기준 (ESP32 펌웨어 원본 헤더)
2. **`docs/PROTOCOL_SPEC.md`** — protocol.h를 파서 관점에서 확정한 명세.
   offset/단위/checksum 알고리즘 + **"확정할 수 없는 것" 목록(7절)** 포함. 먼저 읽어라.
3. **`docs/REQUIREMENTS.md`** — V1 기능 범위, V1 보류 항목, V1 제외 목록
4. **`reference/CAN_SIGNALS_SELECTED.md`** — 디코딩이 허용된 CAN 신호 정의 (이 문서에 없는 신호는 구현 금지)

`reference/` 디렉토리는 **읽기 전용**이다. 절대 수정하지 마라.

### 포맷 핵심 요약 (상세는 PROTOCOL_SPEC.md)

- 파일 = 헤더 없는 **24 byte 고정 레코드 배열**, little-endian, 레코드 0은 BOOT
- 헤더: `magic 0xAE`(1B) + `type`(1B) + `checksum`(u16) + `timestamp`(u32, **부팅 후 ms**)
- checksum: 필드를 0으로 놓고 u32×6 XOR 후 상/하위 16bit 덧셈 폴딩 — **uint16 truncation 재현 필수**
- 절대 시각 = BOOT의 `boot_time`(epoch 초, UTC) + timestamp/1000. `boot_time==0`이면 GPS fix 없던 로그
- GPS lat/lon은 십진도가 아니라 **NMEA ddmm.mmmmm × 1e5**

## 3. 현재 Architecture

관심사 분리가 이 프로젝트의 핵심 규칙이다. 데이터 흐름:

```
File → src/parser (Web Worker) → ParsedLog(columnar) → App state(LoadedRun) → pages
```

| 디렉토리 | 역할 |
|---|---|
| `src/parser/` | binary `.log` 파싱. React 의존 0. `types.ts`(레코드 타입·columnar 시리즈·ParseStats), `checksum.ts`, `parseLog.ts`(2-pass: 검증·카운트 → 디코드; 손상 레코드는 버리고 통계 집계), `worker.ts`(Web Worker 엔트리), `parseLogFile.ts`(**UI가 쓰는 유일한 파서 API** — Promise + 진행률 콜백) |
| `src/decoder/` | raw → 물리 단위. `gps.ts`(ddmm×1e5 → 십진도, haversine), `imu.ts`(±8g/±500dps 스케일, `IMU_AXIS_MAP`), `can.ts`(문서화된 신호만: EZkontrol=LE, Daly BMS=BE, CAN ID 상수) |
| `src/calculations/` | 파생 차량 값 (순수 함수, React 금지). Overview/Graphs/Data Health/Battery/Vehicle 계산 모듈 |
| `src/state/` | `loadedRun.ts` — 파싱 결과 1개를 App이 소유하고 모든 페이지가 prop으로 공유 |
| `src/components/` | 재사용 UI 조각 (StatTile, FileDropZone, ParseSummary, AppNav) |
| `src/pages/` | File Loader와 5개 분석 화면 (Overview/Graphs/Vehicle/Battery/Data Health) |
| `src/ui/` | 표시용 포맷터 (`format.ts`) |

성능상 중요: 파서 출력은 record 객체 배열이 아니라 **type별 columnar typed array**다
(수십만~수백만 레코드를 ECharts에 넘겨야 함). 이 구조를 유지하라.

## 4. 완료된 기능

- **Binary parser**: 24B 레코드, magic → checksum → type 순 검증, protocol version 검증
  (`UNSUPPORTED_PROTOCOL` 오류), 손상/트레일링 바이트 통계, slot 기반 진행률, Web Worker 실행
- **Checksum**: folded-XOR + uint16 truncation (firmware `log_prepare()`와 동일)
- **Decoder**: GPS(위치/속도/방위), IMU(가속도 g/자이로 dps), CAN(EZkontrol RPM·버스전압·전류·온도,
  Daly BMS 전압·전류·SOC·잔여용량)
- **File Loading 화면**: 파일 선택 버튼, Drag & Drop, 파일명/크기, 진행률 바, 성공/실패 처리,
  Parse Summary(record 카운트·무결성 통계)
- **상단 네비게이션**: Overview / Graphs / Vehicle / Battery / Data Health
  5개 분석 탭 모두 활성
- **Graphs 화면**: time-aligned stacked signal plot (ECharts 단일 인스턴스, 신호별 grid).
  신호 11개(GPS Speed, Accelerator Pedal, Motor RPM, Acc X/Y/Z, Gyro Z, SOC, Voltage, Current,
  Power=V×I/1000 signed),
  signal ON/OFF, zoom/pan/tooltip, 전 grid가 X 시간범위·axis pointer 공유(경과 시간 기준),
  소스 없는 신호는 N/A, 소스 내 큰 timestamp 공백은 null break로 표시(interpolation 금지).
  GPS Track Map과 graph/map 양방향 시간 선택, 0.5×/1×/2× playback, nearest-sample Current Values가
  하나의 selected time으로 동기화된다.
  시리즈 생성은 `src/calculations/graphSeries.ts`, 차트는 `src/components/StackedSignalChart.tsx`
- **Overview 화면**: run duration, total records, max GPS speed, max motor RPM,
  max 종/횡가속도, start/end SOC, battery voltage range, run metadata.
  데이터 없으면 **N/A + 사유 힌트** (추측값 표시 금지)
- **Data Health 화면**: source별 record count·first/last timestamp·평균 Hz·median interval·최대 gap·
  large gap count·상태, parser stats 기반 file integrity. Large gap은 로그 내부 cadence heuristic이며
  NORMAL은 센서 정상 판정이 아니라 구조적 timestamp anomaly가 없다는 의미
- **Battery 화면**: Daly BMS SOC·전압·peak 방전 전류/전력, 실제 timestamp 기반 방전 에너지 적분,
  GPS haversine 주행거리, 전비(km/kWh). 충전·회생 구간은 consumed energy에서 제외
- **Vehicle 화면**: max GPS speed, max motor RPM, IMU sensor-axis Acc X/Y/Z·Gyro Z 절대 피크,
  GPS speed-colored Track Map과 위치 선택 기반 nearest-timestamp telemetry 조회.
  Wheel Speed와 Steering Response는 필요한 설정을 명시하고 N/A로 유지
- **테스트**: Vitest 104건 (parser/checksum/decoder/calculations).
  합성 레코드 생성기는 `src/parser/__tests__/fixtures.ts` — 새 테스트에 재사용하라.

## 5. V1 완료 상태

V1의 File Loader / Overview / Graphs / Vehicle / Battery / Data Health 화면이 구현되었다.
Vehicle의 Wheel Speed / Steering Response 수치 계산은 센서 사양 확정 대기 상태이며(6절),
보류 해제 전에는 구현하지 마라.

V1 제외 목록(REQUIREMENTS.md 하단)의 기능은 요청 없이 절대 추가하지 마라.

## 6. 보류된 사항 (구현 금지 — 사양 확정 대기)

- **Wheel Speed (FL/FR/RL/RR)**: 확정되지 않은 것 —
  ① wheel speed sensor의 **PPR**(pulses per revolution), ② **tire circumference**,
  ③ 주행 중 DIGITAL pulse가 온전히 기록되는지 실측 여부.
  DIGITAL 레코드는 GPIO **레벨 스냅샷(0/1)** + 10ms 디바운스라 주파수 역산이 필요하다.
- **Steering Angle / Steering Response**: 확정되지 않은 것 —
  ① 센서가 연결된 **channel**(analog ain 번호), ② center/zero 기준,
  ③ **calibration formula**(전압 → 조향각)와 angle range.
- **IMU 차량축 해석**: 장착 방향과 sensor axis ↔ 차량 종/횡/수직축 매핑이 확정되지 않았다.
  Vehicle 화면에서는 sensor X/Y/Z로만 표시한다.

보류 중에도 raw DIGITAL/ANALOG 레코드 파싱은 유지한다 (이미 파서에 구현되어 있음).

## 7. 절대 추측하면 안 되는 사항

PROTOCOL_SPEC.md 7절이 원본 목록이다. 요약:

- **CAN scaling / endian / ID**: EZkontrol=리틀엔디안, Daly=빅엔디안.
  ID의 METER 모드(0x17)·SA(0xEF)·Daly 주소(0x01/0x40)는 **가정값**이며 `src/decoder/can.ts`
  상수에만 존재한다. 새 CAN 신호는 `reference/CAN_SIGNALS_SELECTED.md`에 있을 때만 추가
- **전류 부호**: 문서상 방전 −/충전 +. `DISCHARGE_SIGN` 상수(can.ts)로 분리되어 있다 — 임의 변경 금지
- **IMU mounting**: 축↔차량(종/횡/수직) 매핑은 미확정 가정. `src/decoder/imu.ts`의
  `IMU_AXIS_MAP` 한 곳에서만 관리하고, UI에는 "가정 기준"임을 표시한다
- **Sensor calibration**: analog 채널 용도/변환식 일체 미문서화
- **Wheel PPR / tire circumference**: 미문서화 (6절)
- **IMU 온도 변환식**: MPU-6050/6500 구분 불명 — raw 유지
- **알려진 문서 오타**: CAN 문서의 Motor Speed 검산 예시 "−32000"은 오타.
  올바른 오프셋은 **−2000** (표·펌웨어 일치). 예시를 근거로 코드를 바꾸지 마라
- **Daly BMS 데이터 존재**: 폴링-응답 방식이라 로그에 아예 없을 수 있다 — N/A가 정상 상태

정보가 부족하면 **코드를 만들지 말고 사용자에게 무엇이 필요한지 명시하라.**

## 8. 개발 규칙

- **Strict TypeScript** (`tsconfig`에 strict 활성). `erasableSyntaxOnly`가 켜져 있어
  TS `enum` 사용 불가 — `src/parser/types.ts`의 `LogType`처럼 const 객체 + `as const` 패턴 사용
- **parser는 UI와 분리**: `src/parser/`, `src/decoder/`, `src/calculations/`에 React import 금지.
  React 코드는 `parseLogFile.ts`만 통해 파서에 접근
- **계산 로직을 React 컴포넌트에 넣지 마라**: 파생값은 `src/calculations/`에 순수 함수 + 단위테스트
- **`reference/` 수정 금지**, protocol.h에 없는 binary 필드 발명 금지
- **기존 dark telemetry 디자인 유지**: 색/폰트 토큰은 `src/index.css`의 CSS 변수
  (surface `#1a1a19`, accent `#3987e5`, status good/warning/critical 등).
  경고·상태 표시는 색상 단독 금지 — 아이콘/텍스트를 병행. 전면 재디자인 금지
- **한 번에 작은 feature 단위로 구현**하고 매번 9절의 명령으로 검증. 거대 컴포넌트 금지,
  조기 최적화 금지, 대규모 재작성 금지
- 원본 `.log` 파일은 절대 수정하지 않는다

## 9. 작업 후 반드시 실행

네 가지 모두 통과해야 완료다:

```
npm run typecheck
npm test
npm run build
npm run lint
```

개발 서버는 `npm run dev` (Vite, 기본 포트 5173).

## 10. Git 작업 원칙

- 기존 커밋을 임의로 rewrite(rebase/amend/force-push)하지 않는다
- 작업 시작 전 `git status`로 현재 상태를 확인한다
- 작업과 무관한 파일을 수정하지 않는다
- `.log` 데이터 파일은 커밋하지 않는다 (`.gitignore`의 `*.log`가 이미 막고 있음)
