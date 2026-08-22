# COC Data Logger — Binary Log Format 명세 (V1 파서 기준)

이 문서는 `reference/protocol.h`를 기준으로 확정한 `.log` 파일 포맷 명세다.
확정 항목은 모두 원본 ESP32 펌웨어의 실제 기록 코드로 교차검증했다.
**추측한 필드는 넣지 않는다.** 확정할 수 없는 것은 마지막 절에 분리해 둔다.

교차검증에 사용한 펌웨어 파일 (이 repo 밖, `COC_DataLogger-main/device/firmware/main/`):
`include/protocol.h`, `include/main.h`, `include/config.h`,
`peripheral/sdcard.c`, `peripheral/gps.c`, `peripheral/gyroscope.c`,
`peripheral/can.c`, `peripheral/digital.c`, `peripheral/analog.c`

---

## 1. 파일 구조

- **헤더/매직 프리앰블 없음.** 파일 전체가 24 byte 고정 크기 레코드의 배열이다.
- 모든 정수는 **little-endian** (ESP32-S3).
- **레코드 0은 항상 BOOT 레코드**다 (`sdcard.c`가 파일 생성 직후 기록하고, 이후 in-place
  수정 시에도 이 invariant를 확인한다).
- 레코드는 큐에서 꺼낸 순서대로 200 ms 주기로 배치 append 된다.

### 24 byte인 이유

```
log_t = magic(1) + type(1) + checksum(2) + timestamp(4) + payload union(16) = 24
```

payload union은 `uint64_t boot_time`을 가진 `boot_record_t` 때문에 alignment가 8이다.
헤더가 정확히 8 byte이므로 union이 offset 8에 딱 맞고, 전체 크기 24도 8의 배수라
**padding이 전혀 생기지 않는다**. `protocol.h` 주석의 "parses log_t in 24-byte chunks"와 일치.

---

## 2. Header

| offset | size | field | type | 비고 |
|--------|------|-------|------|------|
| 0x00 | 1 | `magic` | u8 | 항상 `0xAE` (`LOG_MAGIC`) |
| 0x01 | 1 | `type` | u8 | 아래 표 |
| 0x02 | 2 | `checksum` | u16 LE | 4절 |
| 0x04 | 4 | `timestamp` | u32 LE | 부팅 후 **밀리초** |
| 0x08 | 16 | `payload` | union | 3절 |

### `type` 값 (`log_type_t`)

| 값 | 이름 | 기록 주기 |
|----|------|-----------|
| 0 | `INVALID` | (미사용) |
| 1 | `BOOT` | 파일당 1회, 레코드 0 |
| 2 | `CAN` | 이벤트 (프레임 수신마다) |
| 3 | `GPS` | 10 Hz (u-blox를 100 ms + GPRMC 전용으로 설정) |
| 4 | `ANALOG` | 100 Hz |
| 5 | `DIGITAL` | 이벤트 (상태 변화시, 10 ms 디바운스) |
| 6 | `GYROSCOPE` | 100 Hz |
| 7 | `SYSTEM` | 이벤트 |
| 8 | `USER_EVENT` | 이벤트 |

---

## 3. Payload (LOG_TYPE별)

offset은 **레코드 시작 기준 절대값**이다.

### BOOT (1) — `boot_record_t`

| abs | size | field | type | 비고 |
|-----|------|-------|------|------|
| 8 | 1 | `protocol_version` | u8 | `PROTOCOL_VERSION` = 1 |
| 9 | 1 | `_reserved[1]` | — | |
| 10 | 6 | `mac[6]` | u8[6] | 로거 MAC |
| 16 | 8 | `boot_time` | u64 LE | **epoch 초 (UTC)** |

`boot_time`은 RTC 백업이 없어 GPS 첫 유효 픽스 전에는 0이다. GPS로 시계가 잡히면
펌웨어가 **레코드 0의 `boot_time`만 in-place로 덮어쓰고 checksum을 재계산**한다.
GPS 픽스가 끝까지 없던 로그는 절대 날짜를 알 수 없다 (`boot_time == 0`).

### CAN (2) — `can_record_t`

| abs | size | field | type | 비고 |
|-----|------|-------|------|------|
| 8 | 4 | `id` | u32 LE | CAN identifier |
| 12 | 1 | `extended` | u8 | 0/1 (29-bit 여부) |
| 13 | 1 | `remote` | u8 | 0/1 (RTR) |
| 14 | 1 | `len` | u8 | DLC |
| 15 | 1 | `_reserved[1]` | — | 펌웨어가 0으로 채움 |
| 16 | 8 | `data[8]` | u8[8] | |

- `len`은 비표준 노드가 8을 초과해 보낼 수 있고, 그 경우 `data`는 8 byte로 잘린다.
  → **유효 바이트 수 = `min(len, 8)`**
- 짧은 프레임의 남는 `data` 바이트는 0으로 채워진다 (스택 쓰레기 아님).

### GPS (3) — `gps_record_t`

| abs | size | field | type | 단위 |
|-----|------|-------|------|------|
| 8 | 4 | `latitude` | u32 LE | NMEA `ddmm.mmmmm` × 1e5 |
| 12 | 4 | `longitude` | u32 LE | NMEA `dddmm.mmmmm` × 1e5 |
| 16 | 1 | `lat_dir` | u8 | ASCII `'N'`(0x4E) / `'S'`(0x53) |
| 17 | 1 | `lon_dir` | u8 | ASCII `'E'`(0x45) / `'W'`(0x57) |
| 18 | 2 | `_reserved[2]` | — | |
| 20 | 2 | `speed` | u16 LE | **km/h × 100** |
| 22 | 2 | `course` | u16 LE | **degree × 100** (true course) |

**lat/lon은 십진도가 아니다.** NMEA GPRMC의 도-분 표기를 그대로 1e5배한 정수다
(`parse_nmea_fixed(field, 5)`). 십진도 변환:

```
dd  = floor(raw / 1e7)          // 도
min = raw / 1e5 - dd * 100      // 분
deg = dd + min / 60
sign: lat_dir 'S' → 음수, lon_dir 'W' → 음수
```

`speed`는 NMEA의 knots×100에 `× 1852 / 1000`을 적용한 값이라 결과 단위가 km/h×100이 된다.

### ANALOG (4) — `analog_record_t`

`int16` LE × 8. `ain1`..`ain8` at abs 8, 10, 12, 14, 16, 18, 20, 22.

ADS1115 2개(I2C 0x48 → ain1~4, 0x49 → ain5~8), **±4.096 V FSR**, 16-bit signed,
860 SPS, 100 Hz 샘플링. → `V = raw × 4.096 / 32768` (125 µV/LSB)

### DIGITAL (5) — `digital_record_t`

`uint32` LE × 4. `din1`..`din4` at abs 8, 12, 16, 20.

**값은 GPIO 레벨 0 또는 1이다 (펄스 카운터가 아니다).**
4채널 스냅샷을 상태가 바뀔 때만 기록하며, ISR + 10 ms quiet 디바운스가 걸려 있다.
채널↔바퀴 대응은 이 repo의 `reference/`에 없다 (7절 참조).

### GYROSCOPE (6) — `gyroscope_record_t`

| abs | size | field | type |
|-----|------|-------|------|
| 8 | 2 | `accel_x` | i16 LE |
| 10 | 2 | `accel_y` | i16 LE |
| 12 | 2 | `accel_z` | i16 LE |
| 14 | 2 | `temperature` | i16 LE |
| 16 | 2 | `gyro_x` | i16 LE |
| 18 | 2 | `gyro_y` | i16 LE |
| 20 | 2 | `gyro_z` | i16 LE |
| 22 | 2 | `_reserved[2]` | — |

센서 full-scale 설정이 **±8 g / ±500 dps** (GYRO_CONFIG/ACCEL_CONFIG에 `1<<3`, `1<<4`)이므로:

```
g   = raw / 4096      (8 g   → 32768/8   = 4096 LSB/g)
dps = raw / 65.5      (500dps → 32768/500 = 65.536 LSB/dps)
```

부팅 시 32샘플을 1 ms 간격으로 모아 **자이로 오프셋만** 하드웨어 레지스터로 자동 보정한다
(정지 상태 가정). 가속도계는 보정하지 않는다.

### SYSTEM (7) / USER_EVENT (8) — `system_event_t`

`char msg[16]` at abs 8..23.

**NUL 종단이 보장되지 않는다** (`strncpy` 후 "no need to null-terminate").
16 byte를 읽고 NUL이 있으면 거기서 자르는 방식으로 디코딩해야 한다.

---

## 4. Checksum

`checksum` 필드를 0으로 만든 뒤, 24 byte를 **u32 LE 6개로 보고 전부 XOR**하고,
결과의 상위 16비트와 하위 16비트를 **더해서** 16비트로 접는다.

```
w0' = w0 & 0x0000FFFF          // checksum은 word0의 상위 16비트에 위치
x   = w0' ^ w1 ^ w2 ^ w3 ^ w4 ^ w5
expected = ((x & 0xFFFF) + (x >>> 16)) & 0xFFFF
```

**마지막 `& 0xFFFF`가 중요하다.** C 원본은 `(chksum & 0xFFFF) + (chksum >> 16)`을
`uint16_t`에 대입하므로, 합이 0xFFFF를 넘으면 **잘린다(두 번 접지 않는다)**.
이 truncation을 재현하지 않으면 정상 레코드를 손상으로 오판한다.

`_reserved`/padding 바이트도 checksum 대상이지만, 일부 기록 경로는 스택을 0으로 초기화하지
않은 채 기록한다(예: gyroscope). checksum 자체는 일관되지만
**reserved 바이트 값에 의미를 부여해서는 안 된다.**

---

## 5. 시간

- `timestamp` = **부팅 후 경과 밀리초** (`esp_timer_get_time() / 1000`), monotonic, u32.
  u32이므로 약 49.7일에 wrap (실주행에서는 무관).
- 절대 시각 = `boot_time (epoch 초, UTC) + timestamp / 1000`
- `boot_time == 0`이면 GPS 픽스가 없었던 로그 → 절대 날짜 미확정.

---

## 6. 파서가 견뎌야 하는 실제 상황

- **파일 끝 truncated 레코드**: 전원이 끊기면 `fileSize % 24 != 0`일 수 있다.
  남는 바이트는 버리고 통계(`trailingBytes`)로만 보고한다.
- **레코드 유실**: 로그 큐(2560개)가 가득 차면 `LOG()`가 조용히 실패한다.
  → timestamp gap이 생길 수 있고, 이것이 Data Health 화면이 보여줘야 하는 값이다.
- **timestamp 미세 역전**: 큐는 FIFO이고 타임스탬프도 enqueue 시점에 찍히므로 사실상
  단조증가지만, 타임스탬프 기록과 enqueue 사이의 선점으로 아주 작은 역전이 가능하다.
  파서는 이를 오류로 취급하지 않는다.
- **손상 레코드**: magic 불일치 또는 checksum 불일치 레코드는 버리고 통계에 집계한다.
  레코드 크기가 고정이므로 재동기화(resync)가 필요 없다 — 다음 24 byte 경계로 계속 진행한다.

---

## 7. 이 자료만으로 확정할 수 없는 것

| # | 항목 | 상태 |
|---|------|------|
| A | **Wheel speed** | `reference/`에 신호 정의가 없다. DIGITAL은 레벨 0/1 스냅샷 + 10 ms 디바운스여서 엣지 타이밍 역산이 필요하고, **pulses-per-revolution과 타이어 둘레가 어디에도 문서화되지 않았다.** 디바운스가 주행 중 펄스를 온전히 잡는지도 실측 필요. → V1 보류 |
| B | **Steering angle** | 데이터 소스 자체가 문서에 없다. analog 8채널의 용도가 `reference/`에 없다. → V1 보류 |
| C | **IMU 장착 방향** | x/y/z ↔ 종/횡/수직 매핑과 부호가 문서화되지 않았다. 기본 가정(X=종 전방+, Y=횡 우측+, Z=수직, Yaw=`gyro_z`)으로 구현하고 `decoder/imu.ts`의 `IMU_AXIS_MAP` 상수 한 곳에서 교체 가능하게 둔다. |
| D | **전류 부호** | `CAN_SIGNALS_SELECTED.md`에 방전 −/충전 +로 문서화되어 있으나 실측 확인 전이므로 `DISCHARGE_SIGN` 상수로 분리한다. |
| E | **Daly BMS 데이터 존재 여부** | Daly는 폴링-응답 방식이라 버스에 폴링 노드가 없으면 로그에 BMS 프레임이 아예 없을 수 있다(원문에도 "확인 필요"). SOC/전압/전류/전비 화면은 "데이터 없음"을 정상 상태로 처리해야 한다. |
| F | **CAN ID 가정** | METER 모드 `0x17`, SA `0xEF`, Daly addr `0x01`/PC `0x40` 전부 가정이다(펌웨어 `config.h`도 같은 가정에 같은 주석). ID는 상수로 분리한다. |
| G | **문서 오타** | `CAN_SIGNALS_SELECTED.md`의 Motor Speed 검산 예시가 `34000×0.1 − 32000 = 1400`으로 적혀 산수가 맞지 않는다. 표(`−2000`)와 펌웨어(`main.h`의 `rpm = raw*0.1 - 2000`)가 일치하므로 **오프셋은 −2000**이다. |
| H | IMU 온도 변환식 | 칩이 "MPU-6500/6050 호환"으로만 적혀 있어 식이 갈린다 (6050: `raw/340+36.53`, 6500: `raw/333.87+21`). V1 기능에 온도가 없어 영향 없음 → 변환하지 않고 raw 유지. |
| I | **실주행 샘플 로그** | repo에 없다. 합성 fixture로 검증했고, 실파일 확보 시 checksum 통과율·타입 분포·GPS 스케일·DIGITAL 엣지 밀도를 재검증해야 한다. |
