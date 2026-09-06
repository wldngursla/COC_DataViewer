# Attached firmware compatibility

The viewer remains backward-compatible with the repository's legacy V1
`reference/protocol.h`, and also recognizes the compatible extension found in
the supplied `COC_DataLogger-main (1).zip` firmware.

The extension keeps `PROTOCOL_VERSION=1`, `LOG_MAGIC=0xAE`, the checksum, type
numbers, and the 24-byte record size unchanged. The BOOT byte at payload offset
1 is interpreted as `feature_flags`:

- bit 0: DIGITAL payload is four little-endian IEEE-754 float32 wheel speeds in
  FL, FR, RL, RR order, in km/h;
- bit 1: SYSTEM records include `CFG:*` configuration and `SNS:*` runtime sensor
  status events.

When bit 0 is clear, DIGITAL retains the legacy four-`uint32` GPIO-level layout.
This discriminator is required because both layouts use protocol version 1.

The attached wheel firmware computes speed before logging it. Its checked-in
configuration uses front PPR 15, rear PPR 14, dry tire diameter 0.406 m, and a
500 ms stop timeout. The viewer reads the logged km/h floats directly and does
not recalculate them.

CAN records are always retained and shown as raw identifier/DLC/payload data.
Only signals listed in `reference/CAN_SIGNALS_SELECTED.md` receive semantic
decoding; other bytes remain visible as raw data without inferred meanings.
