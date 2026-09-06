import type { ParsedLog } from '../parser/types';
import { CAN_DATA_BYTES, LogType } from '../parser/types';
import { analogRawToVolts } from '../decoder/analog';
import { rawToCourseDeg, rawToDecimalDegrees, rawToKmh } from '../decoder/gps';
import { rawToDps, rawToG } from '../decoder/imu';
import { describeCanFrame } from '../ui/canDisplay';
import { formatElapsedTime } from '../ui/format';

export type ExplorerSource = 'can' | 'gps' | 'analog' | 'digital' | 'imu' | 'events';

interface RecordExplorerTableProps {
  result: ParsedLog;
  source: ExplorerSource;
  start: number;
  end: number;
}

function formatAbsolute(result: ParsedLog, timestampMs: number): string {
  if (result.bootTimeEpochSec === null) return 'N/A';
  return new Date(result.bootTimeEpochSec * 1000 + timestampMs).toISOString();
}

function TimeCells({ result, timestampMs }: { result: ParsedLog; timestampMs: number }) {
  return (
    <>
      <td>{timestampMs.toLocaleString('en-US')}</td>
      <td>T+{formatElapsedTime(timestampMs)}</td>
      <td>{formatAbsolute(result, timestampMs)}</td>
    </>
  );
}

function CanTable({ result, start, end }: RecordExplorerTableProps) {
  const rows = [];
  for (let index = start; index < end; index++) {
    const can = result.can;
    const timestampMs = can.timestamp[index];
    const payloadLength = Math.min(can.len[index], CAN_DATA_BYTES);
    const fullData = can.data.subarray(index * CAN_DATA_BYTES, (index + 1) * CAN_DATA_BYTES);
    const shownData = fullData.subarray(0, payloadLength);
    const completeDataFrame = can.remote[index] === 0 && can.len[index] >= CAN_DATA_BYTES;
    const display = completeDataFrame
      ? describeCanFrame(can.id[index], fullData)
      : {
          source: can.remote[index] === 1 ? 'RTR frame' : 'Short CAN frame',
          summary: 'Raw payload only',
          hasFault: false,
        };
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={timestampMs} />
        <td>0x{can.id[index].toString(16).toUpperCase().padStart(8, '0')}</td>
        <td>{can.extended[index] === 1 ? 'Extended' : 'Standard'}</td>
        <td>{can.remote[index] === 1 ? 'RTR' : 'Data'}</td>
        <td>{can.len[index]}</td>
        <td>{[...shownData].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ') || '—'}</td>
        <td>{display.source}</td>
        <td className={display.hasFault ? 'record-fault' : undefined}>{display.summary}</td>
      </tr>,
    );
  }
  return (
    <table className="record-table record-table-can">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th><th>CAN ID</th><th>ID type</th><th>Frame</th><th>DLC</th><th>Payload</th><th>Known source</th><th>Decoded values / faults</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function GpsTable({ result, start, end }: RecordExplorerTableProps) {
  const rows = [];
  for (let index = start; index < end; index++) {
    const gps = result.gps;
    const timestampMs = gps.timestamp[index];
    const latDir = String.fromCharCode(gps.latDir[index]);
    const lonDir = String.fromCharCode(gps.lonDir[index]);
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={timestampMs} />
        <td>{gps.latitudeRaw[index]}</td><td>{latDir} ({gps.latDir[index]})</td>
        <td>{rawToDecimalDegrees(gps.latitudeRaw[index], gps.latDir[index]).toFixed(7)}°</td>
        <td>{gps.longitudeRaw[index]}</td><td>{lonDir} ({gps.lonDir[index]})</td>
        <td>{rawToDecimalDegrees(gps.longitudeRaw[index], gps.lonDir[index]).toFixed(7)}°</td>
        <td>{gps.speedRaw[index]}</td><td>{rawToKmh(gps.speedRaw[index]).toFixed(2)} km/h</td>
        <td>{gps.courseRaw[index]}</td><td>{rawToCourseDeg(gps.courseRaw[index]).toFixed(2)}°</td>
      </tr>,
    );
  }
  return (
    <table className="record-table record-table-gps">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th><th>Latitude raw</th><th>Lat dir</th><th>Latitude</th><th>Longitude raw</th><th>Lon dir</th><th>Longitude</th><th>Speed raw</th><th>Speed</th><th>Course raw</th><th>Course</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function AnalogTable({ result, start, end }: RecordExplorerTableProps) {
  const rows = [];
  for (let index = start; index < end; index++) {
    const analog = result.analog;
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={analog.timestamp[index]} />
        {analog.ain.map((channel, channelIndex) => (
          <td key={channelIndex}>{channel[index]} / {analogRawToVolts(channel[index]).toFixed(4)} V</td>
        ))}
      </tr>,
    );
  }
  return (
    <table className="record-table">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th>{result.analog.ain.map((_, index) => <th key={index}>AIN{index + 1} raw / V</th>)}</tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function DigitalTable({ result, start, end }: RecordExplorerTableProps) {
  const digital = result.digital;
  const rows = [];
  for (let index = start; index < end; index++) {
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={digital.timestamp[index]} />
        {digital.format === 'wheel-speed-kmh'
          ? digital.wheelSpeedKmh.map((wheel, wheelIndex) => <td key={wheelIndex}>{wheel[index].toFixed(3)} km/h</td>)
          : digital.din.map((channel, channelIndex) => <td key={channelIndex}>{channel[index]}</td>)}
      </tr>,
    );
  }
  const labels = digital.format === 'wheel-speed-kmh'
    ? ['Wheel FL', 'Wheel FR', 'Wheel RL', 'Wheel RR']
    : ['DIN1 level', 'DIN2 level', 'DIN3 level', 'DIN4 level'];
  return (
    <table className="record-table">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function ImuTable({ result, start, end }: RecordExplorerTableProps) {
  const rows = [];
  for (let index = start; index < end; index++) {
    const gyro = result.gyro;
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={gyro.timestamp[index]} />
        <td>{gyro.accelX[index]} / {rawToG(gyro.accelX[index]).toFixed(4)} g</td>
        <td>{gyro.accelY[index]} / {rawToG(gyro.accelY[index]).toFixed(4)} g</td>
        <td>{gyro.accelZ[index]} / {rawToG(gyro.accelZ[index]).toFixed(4)} g</td>
        <td>{gyro.temperature[index]}</td>
        <td>{gyro.gyroX[index]} / {rawToDps(gyro.gyroX[index]).toFixed(3)} deg/s</td>
        <td>{gyro.gyroY[index]} / {rawToDps(gyro.gyroY[index]).toFixed(3)} deg/s</td>
        <td>{gyro.gyroZ[index]} / {rawToDps(gyro.gyroZ[index]).toFixed(3)} deg/s</td>
      </tr>,
    );
  }
  return (
    <table className="record-table">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th><th>Accel X raw / g</th><th>Accel Y raw / g</th><th>Accel Z raw / g</th><th>Temperature raw</th><th>Gyro X raw / deg/s</th><th>Gyro Y raw / deg/s</th><th>Gyro Z raw / deg/s</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function EventTable({ result, start, end }: RecordExplorerTableProps) {
  const rows = [];
  for (let index = start; index < end; index++) {
    const event = result.events[index];
    const category = event.message.startsWith('CFG:')
      ? 'Sensor config'
      : event.message.startsWith('SNS:') ? 'Sensor status' : 'Event';
    rows.push(
      <tr key={index}>
        <th scope="row">{index + 1}</th>
        <TimeCells result={result} timestampMs={event.timestamp} />
        <td>{event.type === LogType.System ? 'SYSTEM' : 'USER_EVENT'}</td>
        <td>{category}</td>
        <td>{event.message || '—'}</td>
      </tr>,
    );
  }
  return (
    <table className="record-table record-table-events">
      <thead><tr><th>#</th><th>Timestamp ms</th><th>Boot elapsed</th><th>Absolute UTC</th><th>Type</th><th>Category</th><th>Message (16 bytes max)</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function RecordExplorerTable(props: RecordExplorerTableProps) {
  switch (props.source) {
    case 'can': return <CanTable {...props} />;
    case 'gps': return <GpsTable {...props} />;
    case 'analog': return <AnalogTable {...props} />;
    case 'digital': return <DigitalTable {...props} />;
    case 'imu': return <ImuTable {...props} />;
    case 'events': return <EventTable {...props} />;
  }
}
