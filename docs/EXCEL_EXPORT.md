# Excel export

The All Data tab's dedicated export panel exports the current ParsedLog snapshot locally, including the default run. No log reparse or upload occurs. Export controls are separate from the global navigation; progress and cancel controls wrap within the panel.
ExcelJS runs in a dedicated Worker. The ParsedLog is cloned once into the Worker (never transferred/detached from the viewer); workbook bytes are transferred back. Only one export runs at a time.

Summary contains parser counts, integrity and existing KPIs. BOOT, GPS, IMU, Analog, Digital, CAN and Events retain every parsed sample in file order, with boot-relative millisecond timestamps first. Missing epoch times are blank. CAN retains all eight stored bytes, identifier, flags and DLC, including unknown IDs. Motor/BMS/Accelerator are explicitly decoded CAN subsets at their original timestamps; temperature probes have their own sheet. Analysis and GForce_Analysis contain derived values, separately labeled, not substitutes for raw records. Unknown calibrations are not invented.

Each sheet has a frozen header, filter and readable widths. Numeric values are numeric; no rounding is applied. Excel's approximately 15-digit decimal precision is an engine limitation; raw integer sensor counts are preserved. Non-finite float values are explicit text, never zero. Strings remain literal strings, not Excel formulas.

Sheets split at 1,048,575 data rows plus one header. Export_Index lists actual per-part row counts. Empty sensors retain header-only sheets. Analysis has its own timestamps and may have gap markers. Counts of decoded subsets must not be added to raw record totals.

Memory: the browser ExcelJS document writer retains workbook cells and ZIP buffers in memory; a Worker keeps writing and compression off the UI thread but does not eliminate browser heap limits. Extremely large exports can fail with a visible error; no partial/truncated workbook is silently downloaded. Row generators avoid an additional full row-array copy, and shared strings are not required by the exporter. Generating a large XLSX can take substantial time. The Worker is terminated on completion, failure or unmount.
