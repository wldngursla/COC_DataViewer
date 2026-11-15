import type { LoadedRun } from '../state/loadedRun';
import { LOG_TYPE_NAMES } from '../parser/types';
import * as can from '../decoder/can';
import { rawToDecimalDegrees, rawToKmh, rawToCourseDeg } from '../decoder/gps';
import { rawToG, rawToDps } from '../decoder/imu';
import { analogRawToVolts } from '../decoder/analog';
import { computeTimeRange } from '../calculations/logSummary';
import { computeBatteryAnalysis } from '../calculations/batteryAnalysis';
import { computeMaxGpsSpeedKmh, computeMaxMotorRpm, computeMaxAccelG } from '../calculations/overview';
import { createGraphSeriesProvider, GRAPH_SIGNALS } from '../calculations/graphSeries';
import { describeCanFrame } from '../ui/canDisplay';
import { computeBatteryTemperatures } from '../calculations/batteryTemperature';
import { computeDataHealth } from '../calculations/dataHealth';
import { analyzeRearWheels, defaultRearSettings, type RearSettings } from '../calculations/rearCalibration';
import { analyzeImu, defaultImuSettings, type ImuSettings } from '../calculations/imuCalibration';
import { imuGForce } from '../calculations/imuGForce';

export type Cell = string | number | boolean | null;
export interface ExportTable { name: string; headers: string[]; rows: () => Iterable<Cell[]> }
export function exportTables(run: LoadedRun, rearSettings: RearSettings = defaultRearSettings(), imuSettings: ImuSettings = defaultImuSettings()): ExportTable[] {
  const p = run.result;
  const rear = analyzeRearWheels(p, rearSettings);
  const rearByIndex = new Map(rear.rows.map((r) => [r.sourceIndex, r]));
  const imu = analyzeImu(p, imuSettings);
  const imuByIndex = new Map(imu.rows.map((r) => [r.sourceIndex, r]));
  const tables: ExportTable[] = [];
  const table = (name: string, headers: string[], rows: () => Iterable<Cell[]>) => tables.push({ name, headers, rows });
  const time = (t: number): Cell[] => [t, p.bootTimeEpochSec === null ? null : p.bootTimeEpochSec + t / 1000];
  const timeHeaders = ['Timestamp (ms since boot)', 'Absolute UTC (epoch s)'];
  table('Summary', ['Category', 'Metric', 'Value'], function* () {
    yield ['Source', 'LOG filename', run.fileName];
    yield ['Source', 'File size (bytes)', run.fileSize];
    const range = computeTimeRange(p);
    yield ['Source', 'Boot UTC (epoch s)', p.bootTimeEpochSec];
    yield ['Source', 'First timestamp (ms)', range?.firstMs ?? null];
    yield ['Source', 'Last timestamp (ms)', range?.lastMs ?? null];
    yield ['Source', 'Duration (ms)', range?.durationMs ?? null];
    for (const [key, value] of Object.entries(p.stats)) {
      if (key !== 'byType') yield ['Parser integrity', key, value as Cell];
    }
    for (const [type, count] of Object.entries(p.stats.byType)) yield ['Record counts', LOG_TYPE_NAMES[Number(type)] ?? type, count];
    yield ['Analysis', 'Max GPS speed (km/h)', computeMaxGpsSpeedKmh(p.gps)];
    yield ['Analysis', 'Max motor RPM (rpm)', computeMaxMotorRpm(p.can)];
    const force = imuGForce(imu, 'filtered');
    yield ['Filtered IMU analysis', 'Max XY G (g)', force.samples.length ? force.maxG : null];
    yield ['IMU calibration', 'Status', imu.status];
    yield ['IMU calibration', 'Stationary start (ms)', imu.stationary?.start ?? null];
    yield ['IMU calibration', 'Stationary end (ms)', imu.stationary?.end ?? null];
    yield ['IMU calibration', 'Stationary samples', imu.stationary?.count ?? 0];
    yield ['IMU calibration', 'Stationary source', imu.stationary?.source ?? 'NONE'];
    yield ['IMU calibration', 'GPS lag (ms)', imu.lag.ms];
    yield ['IMU calibration', 'GPS lag status', imu.lag.source];
    for (let j = 0; j < 3; j++) {
      yield ['IMU calibration', `Gyro bias sensor ${'XYZ'[j]} (deg/s)`, imu.stationary?.bias[j] ?? null];
      yield ['IMU calibration', `Gravity reference sensor ${'XYZ'[j]} (g)`, imu.stationary?.gravity[j] ?? null];
      for (let k = 0; k < 3; k++) yield ['IMU rotation vehicle←sensor', `R${j + 1}${k + 1}`, imu.rotation?.[j][k] ?? null];
    }
    for (const [key, value] of Object.entries(imu.settings)) yield ['IMU settings', key, Array.isArray(value) ? JSON.stringify(value) : value];
    for (const key of ['forwardError', 'turnValidation', 'rawYawError', 'yawError', 'lateralError'] as const) for (const [metric, value] of Object.entries(imu[key])) yield ['IMU GPS holdout comparison', `${key} ${metric}`, value];
    for (const c of imu.calibrations) {
      yield ['IMU epoch calibration', `${c.epoch} start ms`, c.start]; yield ['IMU epoch calibration', `${c.epoch} end ms`, c.end];
      for (let j = 0; j < 3; j++) { yield ['IMU epoch calibration', `${c.epoch} bias sensor ${'XYZ'[j]} deg/s`, c.bias[j]]; yield ['IMU epoch calibration', `${c.epoch} gravity sensor ${'XYZ'[j]} g`, c.gravity[j]]; }
    }
    for (const [key, value] of Object.entries(imu.counts)) yield ['IMU quality', key, value];
    for (const note of imu.notes) yield ['IMU limitations', 'Note', note];
    const acc = computeMaxAccelG(p.gyro);
    yield ['Analysis assumed axes', 'Peak longitudinal (g)', acc?.longitudinalG ?? null];
    yield ['Analysis assumed axes', 'Peak lateral (g)', acc?.lateralG ?? null];
    const battery = computeBatteryAnalysis(p);
    yield ['Analysis', 'Distance (km)', battery.totalDistanceKm];
    yield ['Analysis', 'Efficiency (km/kWh)', battery.efficiencyKmPerKwh];
    for (const [key, value] of Object.entries(battery.battery ?? {})) yield ['Battery analysis (units in field names)', key, value];
    yield ['Notes', 'Raw columns', 'All parsed samples, file order, original timestamps. No resampling.'];
    yield ['Notes', 'Decoded columns', 'Existing decoders only. Blank means unavailable; numeric zero is preserved.'];
    yield ['Notes', 'Analysis', 'Separate derived graph series; may contain null gap markers and smoothing. Not raw measurements.'];
    yield ['Notes', 'Precision', 'Excel stores ~15 significant decimal digits. Integer raw columns preserve exact sensor counts. Non-finite values are explicit text.'];
    yield ['Notes', 'Counts', 'Motor/BMS/Accelerator are CAN subsets; Analysis contains derived duplicates. Do not sum these as raw record counts.'];
    for (const [key, value] of Object.entries(rear.settings)) yield ['Rear calibration settings', key, Array.isArray(value) ? JSON.stringify(value) : value];
    for (const [key, value] of Object.entries(rear.motorComparison.gps)) yield ['Motor vs GPS', key, value];
    for (let w = 0; w < 2; w++) for (const stage of ['raw', 'corrected', 'filtered'] as const) for (const [key, value] of Object.entries(rear.motorComparison.wheels[w][stage])) yield ['Hall vs Motor', `${w ? 'RR' : 'RL'} ${stage} ${key}`, value];
    for (let w = 0; w < 2; w++) {
      const name = w ? 'RR' : 'RL'; const fit = rear.fits[w]; const applied = rear.coefficients[w];
      yield ['Rear calibration', `${name} applied method`, applied.applied];
      yield ['Rear calibration', `${name} applied a`, applied.a]; yield ['Rear calibration', `${name} applied b`, applied.b];
      yield ['Rear calibration', `${name} estimated a`, fit.a]; yield ['Rear calibration', `${name} confidence`, fit.reason];
      yield ['Rear calibration', `${name} training interval ms`, JSON.stringify(fit.interval)];
      yield ['Rear calibration', `${name} training count`, fit.training]; yield ['Rear calibration', `${name} validation count`, fit.validation];
      yield ['Rear calibration', `${name} lag ms`, fit.lagMs];
      for (const [key, value] of Object.entries(fit.validationFit)) yield ['Rear model validation', `${name} ${key}`, value];
      for (const key of ['raw', 'corrected', 'filtered', 'commonRaw'] as const) for (const [metric, value] of Object.entries(fit[key])) yield ['Rear holdout metrics', `${name} ${key} ${metric}`, value];
    }
  });
  table('BOOT', [...timeHeaders, 'Protocol version', 'Feature flags', 'MAC', 'Boot UTC (epoch s raw)'], function* () {
    if (p.boot) yield [...time(p.boot.timestamp), p.boot.protocolVersion, p.boot.featureFlags, p.boot.mac, p.boot.bootTime];
  });
  table('GPS', [...timeHeaders, 'Latitude raw (NMEA x1e5)', 'Longitude raw (NMEA x1e5)', 'Lat dir (ASCII raw)', 'Lon dir (ASCII raw)', 'Speed raw (km/h x100)', 'Course raw (deg x100)', 'Latitude decoded (deg)', 'Longitude decoded (deg)', 'Speed decoded (km/h)', 'Course decoded (deg)'], function* () {
    const g = p.gps;
    for (let i = 0; i < g.count; i++) yield [...time(g.timestamp[i]), g.latitudeRaw[i], g.longitudeRaw[i], g.latDir[i], g.lonDir[i], g.speedRaw[i], g.courseRaw[i], rawToDecimalDegrees(g.latitudeRaw[i], g.latDir[i]), rawToDecimalDegrees(g.longitudeRaw[i], g.lonDir[i]), rawToKmh(g.speedRaw[i]), rawToCourseDeg(g.courseRaw[i])];
  });
  const vectorHeaders = (label: string, unit: string) => ['X', 'Y', 'Z'].map((axis) => `${label} ${axis} (${unit})`);
  const vectorCells = (v: number[] | null) => v ?? [null, null, null];
  table('IMU', [...timeHeaders, ...['Accel X', 'Accel Y', 'Accel Z', 'Temperature', 'Gyro X', 'Gyro Y', 'Gyro Z'].map((n) => `${n} (raw)`), 'Accel X (g)', 'Accel Y (g)', 'Accel Z (g)', 'Gyro X (deg/s)', 'Gyro Y (deg/s)', 'Gyro Z (deg/s)', ...vectorHeaders('Vehicle calibrated specific force', 'g'), ...vectorHeaders('Vehicle calibrated angular rate', 'deg/s'), ...vectorHeaders('Vehicle filtered specific force', 'g'), ...vectorHeaders('Vehicle filtered angular rate', 'deg/s'), ...vectorHeaders('Vehicle linear acceleration', 'g'), ...vectorHeaders('Vehicle filtered linear acceleration', 'g'), ...vectorHeaders('Gravity direction vehicle', 'g'), 'GPS longitudinal (g)', 'GPS yaw CCW (deg/s)', 'GPS lateral (g)', 'IMU Quality Flag', 'Calibration Status'], function* () {
    const g = p.gyro;
    for (let i = 0; i < g.count; i++) { const r = imuByIndex.get(i)!; yield [...time(g.timestamp[i]), g.accelX[i], g.accelY[i], g.accelZ[i], g.temperature[i], g.gyroX[i], g.gyroY[i], g.gyroZ[i], rawToG(g.accelX[i]), rawToG(g.accelY[i]), rawToG(g.accelZ[i]), rawToDps(g.gyroX[i]), rawToDps(g.gyroY[i]), rawToDps(g.gyroZ[i]), ...vectorCells(r.accel), ...vectorCells(r.gyro), ...vectorCells(r.filteredAccel), ...vectorCells(r.filteredGyro), ...vectorCells(r.linear), ...vectorCells(r.filteredLinear), ...vectorCells(r.gravity), r.gpsAccel, r.gpsYaw, r.gpsLateral, r.flags.join('|'), imu.status]; }
  });
  table('Analog', [...timeHeaders, ...p.analog.ain.map((_, i) => `AIN${i + 1} (raw)`), ...p.analog.ain.map((_, i) => `AIN${i + 1} decoded (V)`)], function* () {
    for (let i = 0; i < p.analog.count; i++) yield [...time(p.analog.timestamp[i]), ...p.analog.ain.map((a) => a[i]), ...p.analog.ain.map((a) => analogRawToVolts(a[i]))];
  });
  table('IMU_Sensor_Processed', [...timeHeaders, ...vectorHeaders('Sensor bias-corrected angular rate', 'deg/s'), ...vectorHeaders('Sensor filtered specific force', 'g'), ...vectorHeaders('Sensor filtered bias-corrected angular rate', 'deg/s'), 'Gyro calibration epoch', 'Quality'], function* () {
    for (let i = 0; i < p.gyro.count; i++) { const r = imuByIndex.get(i)!; yield [...time(r.t), ...vectorCells(r.biasCorrectedSensorGyro), ...vectorCells(r.filteredSensorAccel), ...vectorCells(r.filteredSensorGyro), r.epoch, r.flags.join('|')]; }
  });
  const digital = p.digital;
  table('Digital', [...timeHeaders, ...(digital.format === 'gpio-level' ? ['DIN1 raw', 'DIN2 raw', 'DIN3 raw', 'DIN4 raw'] : ['FL stored (km/h)', 'FR stored (km/h)', 'RL stored (km/h)', 'RR stored (km/h)']), 'RL Corrected (km/h)', 'RR Corrected (km/h)', 'RL Filtered (km/h)', 'RR Filtered (km/h)', 'RL Outlier flag', 'RR Outlier flag', 'RL Quality status', 'RR Quality status'], function* () {
    for (let i = 0; i < digital.count; i++) { const r = rearByIndex.get(i)!; yield [...time(digital.timestamp[i]), ...(digital.format === 'gpio-level' ? digital.din : digital.wheelSpeedKmh).map((a) => a[i]), ...r.corrected, ...r.filtered, ...r.outlier, ...r.flags]; }
  });
  table('WheelSpeed_Analysis', [...timeHeaders, 'GPS reference (km/h)', 'Motor-derived (km/h)', 'RL Raw (km/h)', 'RR Raw (km/h)', 'RL Corrected (km/h)', 'RR Corrected (km/h)', 'RL Filtered (km/h)', 'RR Filtered (km/h)', 'RL lag-matched GPS (km/h)', 'RR lag-matched GPS (km/h)', 'RL corrected minus GPS (km/h)', 'RR corrected minus GPS (km/h)', 'Yaw expected RR minus RL (km/h)', 'RL Quality', 'RR Quality'], function* () {
    for (const r of rear.rows) yield [...time(r.t), r.gps, r.motor, ...r.raw, ...r.corrected, ...r.filtered, ...r.matchedGps, ...r.corrected.map((v, w) => v === null || r.matchedGps[w] === null ? null : v - r.matchedGps[w]!), r.expectedDelta, ...r.flags];
  });
  table('Events', [...timeHeaders, 'Type raw', 'Type', 'Message'], function* () { for (const e of p.events) yield [...time(e.timestamp), e.type, LOG_TYPE_NAMES[e.type], e.message]; });
  const c = p.can;
  const frame = (i: number) => c.data.subarray(i * 8, i * 8 + 8);
  table('CAN', [...timeHeaders, 'ID raw', 'ID hex', 'Extended raw', 'Remote raw', 'DLC raw', ...Array.from({ length: 8 }, (_, i) => `B${i} raw`), 'Decoded description'], function* () {
    for (let i = 0; i < c.count; i++) yield [...time(c.timestamp[i]), c.id[i], `0x${c.id[i].toString(16)}`, c.extended[i], c.remote[i], c.len[i], ...frame(i), c.remote[i] === 0 && c.len[i] >= 8 ? describeCanFrame(c.id[i], frame(i)).summary : null];
  });
  const matches = function* (ids: number[]) { for (let i = 0; i < c.count; i++) if (ids.includes(c.id[i]) && c.remote[i] === 0 && c.len[i] >= 8) yield i; };
  table('Motor', [...timeHeaders, 'CAN ID raw', 'RPM decoded (rpm)', 'Bus voltage (V)', 'Bus current (A)', 'Controller temp (degC)', 'Motor temp (degC)', 'Fault flags B4 raw', 'Fault flags B5 raw', 'Fault flags B6 raw', 'Faults decoded'], function* () {
    for (const i of matches([can.CAN_ID_EZ_MSG1, can.CAN_ID_EZ_MSG2])) { const b = frame(i); const first = c.id[i] === can.CAN_ID_EZ_MSG1;
      yield [...time(c.timestamp[i]), c.id[i], first ? can.decodeMotorRpm(b) : null, first ? can.decodeEzBusVoltage(b) : null, first ? can.decodeEzBusCurrent(b) : null, first ? null : can.decodeControllerTemp(b), first ? null : can.decodeMotorTemp(b), first ? null : b[4], first ? null : b[5], first ? null : b[6], first ? null : can.decodeEzFaults(b).active.join(', ')]; }
  });
  table('Accelerator', [...timeHeaders, 'Pedal decoded (%)', 'B2 raw'], function* () { for (const i of matches([can.CAN_ID_EZ_MSG2])) yield [...time(c.timestamp[i]), can.decodeAccelerator(frame(i)), frame(i)[2]]; });
  table('BMS', [...timeHeaders, 'CAN ID raw', 'Voltage (V)', 'Current (A)', 'SOC (%)', 'Power derived (kW)', 'Remaining capacity (mAh)', 'Fault code raw', 'Faults decoded'], function* () {
    for (const i of matches([can.CAN_ID_DALY_90, can.CAN_ID_DALY_93, can.CAN_ID_DALY_98])) { const b = frame(i); const main = c.id[i] === can.CAN_ID_DALY_90; const fault = c.id[i] === can.CAN_ID_DALY_98;
      yield [...time(c.timestamp[i]), c.id[i], main ? can.decodeBmsVoltage(b) : null, main ? can.decodeBmsCurrent(b) : null, main ? can.decodeBmsSoc(b) : null, main ? can.decodeBmsVoltage(b) * can.decodeBmsCurrent(b) / 1000 : null, c.id[i] === can.CAN_ID_DALY_93 ? can.decodeBmsRemainingCapacityMah(b) : null, fault ? b[7] : null, fault ? can.decodeDalyFaults(b).active.join(', ') : null]; }
  });
  table('BMS_Temperature', [...timeHeaders, 'Sensor index', 'Temperature decoded (degC)', 'Temperature raw'], function* () {
    const temperatures = computeBatteryTemperatures(c);
    for (let sensor = 0; sensor < temperatures.length; sensor++) for (const sample of temperatures[sensor]) yield [...time(sample.timestampMs), sensor + 1, sample.temperatureC, sample.temperatureC + 40];
  });
  table('Analysis', ['Timestamp (ms since boot)', 'Elapsed (s)', 'Signal', 'Value (unit column)', 'Unit'], function* () {
    const provider = createGraphSeriesProvider(p); const first = computeTimeRange(p)?.firstMs ?? 0;
    for (const def of GRAPH_SIGNALS) for (const [t, value] of provider.get(def.id).points) yield [first + t * 1000, t, def.label, value, def.unit];
  });
  table('GForce_Analysis', [...timeHeaders, 'Filtered vehicle lateral Y (g)', 'Filtered vehicle longitudinal X (g)', 'Filtered vehicle XY magnitude (g)'], function* () {
    for (const s of imuGForce(imu, 'filtered').samples) yield [...time(s.timestampMs), s.x, s.y, s.magnitude];
  });
  table('GForce_Sensor_Raw', [...timeHeaders, 'Raw sensor X specific force (g)', 'Raw sensor Y specific force (g)', 'Raw sensor XY magnitude (g)'], function* () {
    for (const s of imuGForce(imu, 'raw').samples) yield [...time(s.timestampMs), s.x, s.y, s.magnitude];
  });
  table('GPS_IMU_Reference', [...timeHeaders, 'GPS speed (km/h)', 'GPS longitudinal (m/s2)', 'GPS yaw CCW (deg/s)', 'GPS lateral (g)'], function* () {
    for (const r of imu.gps) yield [...time(r.t), r.speed, r.acceleration, r.yaw, r.lateral];
  });
  table('Data_Health', ['First timestamp (ms since boot)', 'Source', 'Records', 'Last timestamp (ms since boot)', 'Average (Hz)', 'Median interval (ms)', 'Maximum gap (ms)', 'Large gaps', 'Status'], function* () {
    for (const h of computeDataHealth(p).sources) yield [h.firstTimestampMs, h.source.label, h.count, h.lastTimestampMs, h.averageHz, h.medianIntervalMs, h.maximumGapMs, h.largeGapCount, h.status];
  });
  return tables;
}
