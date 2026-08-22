# COC Data Viewer V1

## 목적

COC 자작차의 ESP32 데이터로거에서 생성된 binary .log 파일을
사용자의 PC에서 직접 읽고 차량 주행 데이터를 분석하는 오프라인 웹 뷰어.

범용 데이터 뷰어가 아니라 COC 차량 테스트를 빠르게 분석하는 것이 목적이다.

## 개발 원칙

- 서버 사용하지 않음
- 로그인 없음
- 데이터베이스 없음
- 파일 외부 업로드 없음
- 모든 분석은 브라우저 내부에서 수행
- 기존 ESP32 firmware의 protocol.h를 데이터 포맷의 기준으로 사용
- 원본 .log 파일은 수정하지 않음
- V1 범위를 넘어서는 기능은 임의로 추가하지 않음

## 기술 스택

- React
- TypeScript
- Vite
- ECharts
- Browser File API

## V1 기능

### 1. File Loading

- .log 파일 선택
- Drag & Drop
- 파일 크기 표시
- Parsing 진행상태 표시
- 잘못된 파일 오류 처리

### 2. Overview

- 기록 날짜
- 주행 시간
- 전체 Record 수
- CAN Record 수
- GPS Record 수
- IMU Record 수
- 최고 속도
- 최대 RPM
- 최대 종가속도
- 최대 횡가속도
- 시작 SOC
- 종료 SOC

### 3. Graph

표시 가능한 signal:

Vehicle
- GPS Speed
- Motor RPM

Wheel (V1 보류 — "V1 보류 항목" 참조)
- FL
- FR
- RL
- RR

Dynamics
- Acc X
- Acc Y
- Acc Z
- Yaw Rate
- Steering Angle (V1 보류 — "V1 보류 항목" 참조)

Battery
- SOC
- Voltage
- Current
- Power

필수 그래프 기능:
- Signal ON/OFF
- Zoom
- Pan
- Tooltip
- synchronized time cursor

### 4. Vehicle Analysis

Wheel Speed (V1 보류 — "V1 보류 항목" 참조)
- GPS Speed
- FL / FR / RL / RR
- 4 wheel average
- GPS 대비 각 wheel speed 오차율

Steering Response (V1 보류 — "V1 보류 항목" 참조)
- Steering Angle
- Yaw Rate
- Lateral Acceleration

Battery
- SOC
- Voltage
- Current
- Power
- 누적 소비 에너지(kWh)
- GPS 기반 주행거리(km)
- 전체 전비(km/kWh)

Battery Power:
P = V * I

전비:
Efficiency = Distance(km) / Consumed Energy(kWh)

회생제동 분석은 V1에 포함하지 않는다.

### 5. Data Health

각 데이터 source에 대해:
- Record count
- Average sampling frequency
- Maximum timestamp gap
- 큰 timestamp gap 횟수

표시:
- Normal
- Warning
- Missing

## V1 보류 항목 (데이터 소스 미확정)

아래 기능은 데이터 소스 사양이 확정될 때까지 V1 구현 대상에서 보류한다.
보류 중에도 raw DIGITAL/ANALOG record parsing은 유지한다 (로그에 있는 데이터는 버리지 않는다).

- Wheel Speed (FL/FR/RL/RR, 4 wheel average, GPS 대비 오차율):
  wheel speed sensor의 PPR(pulses per revolution), tire circumference,
  그리고 주행 중 DIGITAL pulse가 온전히 기록되는지의 실측 확인이 필요하다.
- Steering Angle / Steering Response:
  steering sensor가 연결된 channel과 calibration formula(전압 → 조향각)가 필요하다.

사양이 확정되면 해당 기능을 V1 범위로 복귀시킨다.

## V1 제외

- Live telemetry
- Wi-Fi
- MQTT
- Backend server
- Login
- Database
- DBC import
- Run compare
- Lap timing
- G-G diagram
- Understeer / Oversteer automatic detection
- Regen analysis
- Voltage sag analysis
- Suspension roll / pitch analysis
- AI analysis