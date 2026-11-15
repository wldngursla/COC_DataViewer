# Rear wheel speed audit and calibration

## Sources and limits (2026-11-15)

The parser is unchanged. `protocol.h` / `PROTOCOL_SPEC.md` describe 24-byte records. DIGITAL with the wheel-speed feature bit stores four float32 **km/h** measurements, not edge timestamps or pulse counters. Legacy DIGITAL stores GPIO levels. The new lab does not infer km/h from legacy levels. Raw columnar arrays and original log files remain unchanged.

Two firmware generations were available for inspection:

* The adjacent extracted logger's `device/firmware/main/peripheral/digital.c` records any-edge GPIO levels with a shared 10 ms quiet debounce. It does not implement the newer wheel-speed calculation.
* The user-supplied `COC_DataLogger-main (1).zip`, at `device/firmware/main/peripheral/digital.c` and `include/config.h`, implements positive-edge pulse-period measurement. Front PPR=15, rear PPR=14. Dry diameter=0.406 m, wet diameter=0.50 m; the supplied compile-time default selects dry. These source defaults are not proof of the hardware configuration or the build used for a particular run.

The ZIP implementation uses:

```
period_s = interval_us / 1_000_000
wheel_rps = 1 / (period_s * PPR)
speed_kmh = wheel_rps * circumference_m * 3.6
```

This is dimensionally correct for one rising edge per tooth and the specified PPR. It is a last-pulse-period method, not a fixed-window pulse-count method. Interrupts less than 1,000 µs apart are rejected without moving the accepted baseline. First pulses and intervals >=500,000 µs establish a zero-speed baseline; the task also clears stale speed after 500 ms. Zero intervals are checked before division. Accepted intervals fit uint32; subtraction uses int64 monotonic microseconds and coherent critical-section snapshots. The unsigned pulse counter can wrap, but is used for change detection, not as the divisor. No confirmed arithmetic overflow, ms/µs mistake or missing 3.6 conversion was found in this source.

## Why approximately 327 km/h?

With the supplied dry default, `C=pi*0.406=1.2754866 m`. At the shortest accepted rear interval of 1 ms, the formula gives **327.9823 km/h**. At 1,001 µs it gives about **327.6546**, and at 1,002 µs about **327.3276 km/h**. These closely match the observed float32 maxima. This is evidence consistent with near-threshold accepted intervals, rather than evidence of a 327.67 integer storage ceiling: the protocol stores float32, and the actual values vary.

In the bundled run RL has one sample in 320–329 km/h (633623 ms, 327.65457); RR has five, including 327.32761 at 635673 and 681333 ms. They are isolated observations, not a constant saturation plateau. A spurious edge just over 1 ms can pass this guard and produce a very large speed. Electrical noise, duplicate edges, sensor geometry, actual PPR/diameter mismatch and installation remain hypotheses. A 1 ms rejection threshold is not a realistic maximum-speed validation at this wheel geometry. A lower measured interval can also be real under a different configuration.

No firmware formula was changed: no proven arithmetic defect was identified, and the viewer repository does not contain the authoritative build for this run. Changing an external/archived firmware copy would not repair recorded samples. To resolve the cause, confirm flashed build, wheel tooth count and loaded rolling circumference, then capture accepted/rejected edge intervals or a logic-analyzer trace. Future firmware should record these diagnostics and use a physically justified configurable interval guard; do not silently change PPR to make GPS agree. Neither `reference/` nor protocol records were modified.

## Processing and UI

Graphs now contains **Rear Wheel Calibration Lab**. This is a separate diagnostic view; existing graphs, playback and maps retain their behavior. Raw / Corrected / Filtered / Compare display GPS, configured motor speed and independent RL/RR series on common elapsed-time axes. A second plot shows RR−RL. Scrollable legends, responsive setting fields and a horizontally scrollable results table keep the added controls within their panel.

* Sort by timestamp, retain source index for Excel file order, and flag original duplicate/regressing DIGITAL timestamps. Matching uses bounded nearest samples (default 250 ms), without interpolation. Rejected GPS records cannot be replaced by a neighboring sample across that record. GPS checks validate coordinates, configured speed limit, adjacent cadence and acceleration (5 m/s² heuristic). Satellite count/fix/HDOP are absent from this protocol, so quality cannot be certified. Low speed (<8 km/h default) is excluded from regression and error metrics.
* Reserve the last 30% of valid GPS time for validation. Estimate lag only in training: scan −2..+2 s at 100 ms, require speed span >=10 km/h, >=30 pairs, correlation >=0.7, an interior maximum and >=0.02 advantage over offsets at least 500 ms away. Otherwise use 0 and label the estimate withheld. Positive lag compares Hall(t) to GPS(t+lag).
* Estimate each rear wheel independently with through-origin Huber IRLS (30 iterations, MAD residual scale, 1.345 cutoff). This preserves physical zero. Training candidates use GPS acceleration <=2.5 m/s², |sensor Gyro Z|<=5 deg/s when available, and raw left/right difference <=20%. These are tunable-analysis heuristics, not a verified vehicle-axis interpretation. Missing gyro is allowed and GPS quality remains limited.
* Automatic application requires >=30 training and >=15 validation pairs, >=10 km/h training span over >=10 s, validation R²>=0.5 and RMSE<=max(3 km/h, mean validation GPS*20%). The UI defaults to coefficients OFF (estimation only). GPS estimation can be disabled; independent manual a,b are available. Failed auto validation retains a=1,b=0 and flags AUTO_WITHHELD. Candidate coefficients and model validation errors remain visible.
* Corrected = a*Raw+b. Preserve this value even if it fails physical checks; do not clamp it to the limit. Negative/non-finite raw, negative/over-limit corrected speed, timestamps and excessive acceleration receive flags. Defaults 160 km/h and 20 m/s² are editable analysis limits, not confirmed vehicle specifications. Consecutive invalid samples become gaps. Reliable recovery resumes after a gap/reset or a sample consistent with the last accepted observation.
* Filtered: centered Hampel window=7, threshold=3*MAD scale, minimum five valid neighbors, 0.1 km/h noise floor. A detected isolated spike can be replaced by its local median and is flagged HAMPEL_REPLACED. Unrecoverable physical failures remain null. Eligibility is snapshotted before Hampel to avoid traversal-order effects. EMA then uses `1-exp(-dt/tau)`, tau=0.2 s; nulls and >1 s gaps reset state. No gap is plotted as a continuous line. Raw and Corrected never receive the filter replacement.
* Motor speed = abs(decoded RPM)/G*C*60/1000. G means motor/wheel revolutions. Effective circumference and G start **unset**, so derived speed and its metrics are N/A until supplied. PPR is retained as analysis metadata only; it cannot reconstruct missing pulse intervals. Drivetrain structure is explicit unknown/single/both metadata; motor speed is not asserted to equal either rear wheel's true ground speed. Slip, braking and turning can create legitimate disagreement.
* A yaw comparison is available only with confirmed Gyro Z vehicle yaw, sign and rear track: expected RR−RL = yaw(rad/s)*track(m)*3.6. It is diagnostic, assumes limited slip, and never forces measured wheel speeds to match. Hardware settings are session-wide; the same snapshot goes to Excel.

Analysis and Excel generation run in workers. Cleanup cancels superseded analyses. All samples are processed; display sampling does not reduce exported data. The exporter reuses ParsedLog and adds corrected/filtered/boolean outlier/status columns to Digital, a timestamp-aligned WheelSpeed_Analysis sheet, and settings, coefficients, training intervals, confidence and GPS/motor metrics to Summary. Existing raw sheets, numeric precision handling and worksheet splitting are retained.

## Real-run evaluation

No separate Excel file accompanied this request. Evaluation uses the unchanged bundled `public/data/default-run.bin`, originally `00000175-2026-09-20-16-26-47.log`, 2,452,032 bytes, SHA256 `0366dfa77b322c394f5e41b67fb0b7c283aab04c6d68d133bf6705cd982f32f7`: GPS=7,216, DIGITAL=28,137. Reproduce with the real-log case in `rearCalibration.test.ts`; it writes a JSON report into the system temporary directory.

With defaults except mode=auto:

| Item | RL | RR |
|---|---:|---:|
| Raw maximum km/h | 327.655 | 327.328 |
| Estimated a, b=0 | 0.981386 | 0.990080 |
| Training interval, ms since boot | 430350–570150 | 430248–570248 |
| Training / validation candidates | 967 / 741 | 983 / 731 |
| Estimated GPS lag | +600 ms | withheld → 0 ms |
| Training lag correlation | 0.724 | 0.514 |
| Candidate validation RMSE km/h | 11.931 | 13.923 |
| Candidate validation R² | −0.792 | −1.437 |
| Applied a | **1 (withheld)** | **1 (withheld)** |
| Holdout Raw MAE / RMSE km/h | 14.084 / 32.247 | 14.069 / 41.758 |
| Holdout Corrected MAE / RMSE | 14.084 / 32.247 | 14.069 / 41.758 |
| Raw / Corrected holdout n | 13,321 | 13,292 |
| Holdout Filtered MAE / RMSE km/h | 11.146 / 22.139 | 1.110 / 1.426 |
| Filtered holdout n | 7,053 | 8,596 |
| Raw MAE / RMSE on the SAME filtered rows | 11.107 / 22.136 | 1.198 / 1.515 |
| Filtered maximum km/h | 71.690 | 65.675 |
| Flagged outliers, entire log | 13,389 (47.59%) | 9,686 (34.42%) |
| Non-null filtered rows, entire log | 14,979 | 18,818 |

The filtered-vs-full-raw metrics have different coverage and are **not** evidence that rejected samples were accurately recovered. Same-row comparison shows RL has not improved; RR improves modestly. RL still has substantial valid-looking measurement error. Both estimated scale models fail independent validation and are not automatically applied: this dataset does not support a trustworthy single scale correction. No coefficients were tuned on the holdout to manufacture a good result. Speed-bin and per-time errors are available in the UI/export. GPS lag remains an estimate, not known sensor latency.

Motor-vs-GPS and Hall-vs-Motor numeric validation is N/A for this real run because total gear ratio and effective rolling circumference were not confirmed. Formula/decoder integration is verified synthetically (3,000 RPM, G=6, C=1.2 m gives 36 km/h); these test parameters are never filled into real-run settings.

## Verification

Tests cover bounded time matching, known/ambiguous delay, Huber scale and holdout, independent rear coefficients, corner differences, motor decoder/formula, confirmed yaw units, implausible speed/acceleration, continuous errors, GPS jumps/missing references, duplicate/regressing timestamps, Hampel restoration, irregular EMA/reset, stationary zero, legacy GPIO, original-array immutability and numeric Excel roundtrip/counts/settings. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`.
