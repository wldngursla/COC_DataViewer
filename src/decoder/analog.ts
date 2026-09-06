/** ADS1115 raw conversion for the logger's ±4.096 V full-scale setting. */

export const ADS1115_FULL_SCALE_VOLTS = 4.096;
export const ADS1115_COUNTS = 32768;

/** Signed ADS1115 count → input volts (125 µV/LSB). */
export function analogRawToVolts(raw: number): number {
  return (raw * ADS1115_FULL_SCALE_VOLTS) / ADS1115_COUNTS;
}
