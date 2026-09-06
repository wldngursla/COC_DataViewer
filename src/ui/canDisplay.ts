/** Presentation-ready descriptions for the CAN signals approved in the decoder spec. */

import {
  CAN_ID_DALY_90,
  CAN_ID_DALY_93,
  CAN_ID_DALY_98,
  CAN_ID_EZ_MSG1,
  CAN_ID_EZ_MSG2,
  decodeAccelerator,
  decodeBmsCurrent,
  decodeBmsRemainingCapacityMah,
  decodeBmsSoc,
  decodeBmsVoltage,
  decodeControllerTemp,
  decodeDalyFaults,
  decodeEzBusCurrent,
  decodeEzBusVoltage,
  decodeEzFaults,
  decodeMotorRpm,
  decodeMotorTemp,
} from '../decoder/can';

export interface CanFrameDisplay {
  source: string;
  summary: string;
  hasFault: boolean;
}

const listFaults = (faults: readonly string[]): string =>
  faults.length === 0 ? 'Faults clear' : `Faults: ${faults.join(', ')}`;

export function describeCanFrame(id: number, data: Uint8Array): CanFrameDisplay {
  switch (id >>> 0) {
    case CAN_ID_EZ_MSG1:
      return {
        source: 'EZkontrol Msg1',
        summary: `Bus ${decodeEzBusVoltage(data).toFixed(1)} V · ${decodeEzBusCurrent(data).toFixed(1)} A · ${decodeMotorRpm(data).toFixed(0)} rpm`,
        hasFault: false,
      };
    case CAN_ID_EZ_MSG2: {
      const faults = decodeEzFaults(data);
      return {
        source: 'EZkontrol Msg2',
        summary: `Controller ${decodeControllerTemp(data).toFixed(0)} °C · Motor ${decodeMotorTemp(data).toFixed(0)} °C · Pedal ${decodeAccelerator(data).toFixed(0)} % · ${listFaults(faults.active)}`,
        hasFault: !faults.clear,
      };
    }
    case CAN_ID_DALY_90:
      return {
        source: 'Daly BMS 0x90',
        summary: `${decodeBmsVoltage(data).toFixed(1)} V · ${decodeBmsCurrent(data).toFixed(1)} A · SOC ${decodeBmsSoc(data).toFixed(1)} %`,
        hasFault: false,
      };
    case CAN_ID_DALY_93:
      return {
        source: 'Daly BMS 0x93',
        summary: `Remaining ${decodeBmsRemainingCapacityMah(data).toLocaleString('en-US')} mAh`,
        hasFault: false,
      };
    case CAN_ID_DALY_98: {
      const faults = decodeDalyFaults(data);
      return {
        source: 'Daly BMS 0x98',
        summary: `${listFaults(faults.active)} · Fault code ${faults.faultCode}`,
        hasFault: !faults.clear,
      };
    }
    default:
      return {
        source: 'Raw CAN frame',
        summary: 'No documented decoder for this ID',
        hasFault: false,
      };
  }
}
