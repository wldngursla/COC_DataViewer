# COC Data Viewer V1

COC 자작 EV의 ESP32 데이터로거가 기록한 binary `.log` 파일을 차량 시험평가 관점에서 분석하는
오프라인 웹 뷰어입니다. 파일은 브라우저 내부에서만 파싱되며 서버, 로그인, 데이터베이스 또는 외부
업로드를 사용하지 않습니다.

## Web App

https://wldngursla.github.io/COC_DataViewer/

Usage:

1. Open the website
2. Select or drag a `.log` file
3. Analyze the run locally in the browser

Log files are processed locally in the browser and are not uploaded to a backend.

## Analysis workflow

```text
차량 데이터 취득
→ binary/log integrity 검증
→ measurement data quality 확인
→ time-aligned multi-signal 분석
→ 차량 성능 평가
```

## V1 features

- **File Loader**: Drag & Drop / 파일 선택, Web Worker 기반 파싱, 진행률과 parser 통계
- **Overview**: 시험 시간, record 수, 최고 GPS 속도·Motor RPM·가속도, SOC·전압 요약
- **Graphs**: GPS/Accelerator/Motor/IMU/Daly BMS stacked graph, GPS Track Map 양방향 시간 동기화,
  0.5×/1×/2× playback과 nearest-sample Current Values
- **Battery**: 방전 소비 에너지, GPS 누적 거리, 전비, SOC·전압·전류·전력 KPI
- **Data Health**: source timestamp cadence/gap과 parser file integrity 점검
- **Vehicle**: GPS 최고속도, Motor 최고 RPM, IMU sensor-axis X/Y/Z 가속도 및 Gyro Z 절대 피크,
  GPS speed-colored Track Map과 위치 선택 기반 nearest-timestamp telemetry 조회

값을 계산할 수 있는 source가 없으면 추측값이나 0 대신 `N/A`를 표시합니다.

## Vehicle analysis limitations

현재 Vehicle 탭의 GPS speed, Motor RPM, IMU raw-axis acceleration, Gyro Z 분석은 사용할 수 있습니다.
다음 항목은 필요한 센서 사양이 확정될 때까지 수치를 계산하지 않습니다.

- **Wheel speed**: wheel sensor PPR, tire circumference, 실제 주행 중 DIGITAL pulse 기록 검증 필요
- **Steering angle/response**: analog channel, center/zero, voltage-to-angle calibration과 angle range 필요
- **IMU vehicle axes**: 장착 방향이 확정되지 않아 X/Y/Z를 차량 종·횡·수직축으로 해석하지 않음

DIGITAL record는 pulse counter가 아니라 10 ms debounce가 적용된 GPIO level snapshot입니다.

## Run locally

```bash
npm install
npm run dev
```

브라우저에서 표시된 로컬 주소를 열고 COC `.log` 파일을 선택합니다. 하나의 `ParsedLog`를 모든 탭이
공유하므로 탭 전환 시 파일을 다시 파싱하지 않습니다.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm run lint
git diff --check
```

## Protocol source of truth

Binary layout와 decoder 변경 전 다음 순서를 확인해야 합니다.

1. [`reference/protocol.h`](reference/protocol.h)
2. [`docs/PROTOCOL_SPEC.md`](docs/PROTOCOL_SPEC.md)
3. [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
4. [`reference/CAN_SIGNALS_SELECTED.md`](reference/CAN_SIGNALS_SELECTED.md)

`reference/`는 읽기 전용이며, 문서화되지 않은 CAN signal이나 calibration은 추가하지 않습니다.
