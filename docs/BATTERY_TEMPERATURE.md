# Battery temperature and default run

User-confirmed signal: CAN 0x18964001 (Daly Data ID 0x96), temperature in °C = stored byte − 40.
The supplied firmware's `bms_parse_96` assigns byte 0 to the frame number (1-based, with 0 accepted as frame 1),
and bytes 1–7 to seven consecutive probes. 0xFF is absent. At most 24 probes are supported.
Data ID 0x94 byte 1 supplies the fitted probe count, preventing padding from appearing as extra probes.

Battery shows each probe's final/minimum/maximum temperature; Graphs provides per-probe time series;
All Data decodes the original CAN payload.

The user-requested default log is bundled unchanged as `public/data/default-run.bin` (binary .log contents).
Original name: `00000175-2026-09-20-16-26-47.log`.
SHA-256: `0366DFA77B322C394F5E41B67FB0B7C283AAB04C6D68D133BF6705CD982F32F7`.
The asset is publicly downloadable when deployed, as requested for the default website dataset.
Other user-selected logs continue to be parsed locally. The header's 파일 변경 button opens the file picker screen.
