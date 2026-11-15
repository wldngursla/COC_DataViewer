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
import { computeGForce } from '../calculations/gForce';
import { computeDataHealth } from '../calculations/dataHealth';

export type Cell = string | number | boolean | null;
export interface ExportTable { name: string; headers: string[]; rows: () => Iterable<Cell[]> }
export function exportTables(run: LoadedRun): ExportTable[] {
  const p = run.result;
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
    const force = computeGForce(p);
    yield ['Filtered IMU analysis', 'Max XY G (g)', force.samples.length ? force.maxG : null];
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
  });
  table('BOOT', [...timeHeaders, 'Protocol version', 'Feature flags', 'MAC', 'Boot UTC (epoch s raw)'], function* () {
    if (p.boot) yield [...time(p.boot.timestamp), p.boot.protocolVersion, p.boot.featureFlags, p.boot.mac, p.boot.bootTime];
  });
  table('GPS', [...timeHeaders, 'Latitude raw (NMEA x1e5)', 'Longitude raw (NMEA x1e5)', 'Lat dir (ASCII raw)', 'Lon dir (ASCII raw)', 'Speed raw (km/h x100)', 'Course raw (deg x100)', 'Latitude decoded (deg)', 'Longitude decoded (deg)', 'Speed decoded (km/h)', 'Course decoded (deg)'], function* () {
    const g = p.gps;
    for (let i = 0; i < g.count; i++) yield [...time(g.timestamp[i]), g.latitudeRaw[i], g.longitudeRaw[i], g.latDir[i], g.lonDir[i], g.speedRaw[i], g.courseRaw[i], rawToDecimalDegrees(g.latitudeRaw[i], g.latDir[i]), rawToDecimalDegrees(g.longitudeRaw[i], g.lonDir[i]), rawToKmh(g.speedRaw[i]), rawToCourseDeg(g.courseRaw[i])];
  });
  table('IMU', [...timeHeaders, ...['Accel X', 'Accel Y', 'Accel Z', 'Temperature', 'Gyro X', 'Gyro Y', 'Gyro Z'].map((n) => `${n} (raw)`), 'Accel X (g)', 'Accel Y (g)', 'Accel Z (g)', 'Gyro X (deg/s)', 'Gyro Y (deg/s)', 'Gyro Z (deg/s)'], function* () {
    const g = p.gyro;
    for (let i = 0; i < g.count; i++) yield [...time(g.timestamp[i]), g.accelX[i], g.accelY[i], g.accelZ[i], g.temperature[i], g.gyroX[i], g.gyroY[i], g.gyroZ[i], rawToG(g.accelX[i]), rawToG(g.accelY[i]), rawToG(g.accelZ[i]), rawToDps(g.gyroX[i]), rawToDps(g.gyroY[i]), rawToDps(g.gyroZ[i])];
  });
  table('Analog', [...timeHeaders, ...p.analog.ain.map((_, i) => `AIN${i + 1} (raw)`), ...p.analog.ain.map((_, i) => `AIN${i + 1} decoded (V)`)], function* () {
    for (let i = 0; i < p.analog.count; i++) yield [...time(p.analog.timestamp[i]), ...p.analog.ain.map((a) => a[i]), ...p.analog.ain.map((a) => analogRawToVolts(a[i]))];
  });
  const digital = p.digital;
  table('Digital', [...timeHeaders, ...(digital.format === 'gpio-level' ? ['DIN1 raw', 'DIN2 raw', 'DIN3 raw', 'DIN4 raw'] : ['FL stored (km/h)', 'FR stored (km/h)', 'RL stored (km/h)', 'RR stored (km/h)'])], function* () {
    for (let i = 0; i < digital.count; i++) yield [...time(digital.timestamp[i]), ...(digital.format === 'gpio-level' ? digital.din : digital.wheelSpeedKmh).map((a) => a[i])];
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
  table('GForce_Analysis', [...timeHeaders, 'Filtered sensor X (g)', 'Filtered sensor Y (g)', 'Filtered XY magnitude (g)'], function* () {
    for (const s of computeGForce(p).samples) yield [...time(s.timestampMs), s.x, s.y, s.magnitude];
  });
  table('Data_Health', ['First timestamp (ms since boot)', 'Source', 'Records', 'Last timestamp (ms since boot)', 'Average (Hz)', 'Median interval (ms)', 'Maximum gap (ms)', 'Large gaps', 'Status'], function* () {
    for (const h of computeDataHealth(p).sources) yield [h.firstTimestampMs, h.source.label, h.count, h.lastTimestampMs, h.averageHz, h.medianIntervalMs, h.maximumGapMs, h.largeGapCount, h.status];
  });
  return tables;
}
