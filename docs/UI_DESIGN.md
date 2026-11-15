# COC interface design

The UI uses a light iPhone-inspired presentation: near-white backgrounds, rounded cards, clear numeric hierarchy and translucent navigation. The references are Apple's [Materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) and [new software design introduction](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/). This is a browser implementation, not Apple's native material renderer or an Apple product.

## Styling

`src/ui/iosTheme.css` is imported last by `main.tsx`, after the existing page/component styles. It overrides the original dark tokens and layout without rewriting the underlying legacy stylesheet. Use its tokens for new UI. `AppIdentity`, `NavigationIcon` and `OverviewHero` supply code-native SVGs and the overview introduction; no remote fonts, icon library or image requests are added.

* Navigation uses high-opacity glass with blur and an opaque selected segment. Data cards stay opaque for legibility. Status retains text/icons in addition to color.
* Desktop uses a sticky two-row header, separate file action and navigation, a restrained hero and consistent card spacing.
* At <=760px navigation becomes a fixed six-item bottom bar with labels and icons. Safe-area insets and bottom content padding prevent covering the final rows. Small phones simplify the brand and fall back to single-column cards at <=370px.
* A mobile fixed navigation bar must not sit beneath an ancestor with `backdrop-filter`: that can make the ancestor the containing block. The mobile header's blur is on its pseudo-element instead.
* Charts retain dark backgrounds because their existing canvas labels/series palette are designed for dark telemetry. Light cards surround them. G-force uses a light dial and blue dot/trail. No signal colors or numerical calculations change.
* Tables scroll inside their containers; long filenames wrap or truncate. Calibration controls use responsive grids. IMU/rear-wheel labs are disclosures; their charts mount only after opening so ECharts is not initialized at zero width.
* Reduced motion disables decorative transitions. Reduced transparency / increased contrast request opaque navigation and stronger border/text tokens. Keyboard focus, selected navigation state, button labels and minimum control sizes remain explicit.

## Scope and checks

Parsing, decoding, formulas, export data and playback were not changed. Existing unrelated working-tree changes were excluded from the commit. Strict TypeScript, the full isolated committed test suite, production build and lint passed. Native browser inspection was attempted, but the browser host was unavailable and the accessible native window did not provide a reliable preview; desktop/mobile visual verification remains incomplete. The mobile/desktop breakpoints and overlap behavior were reviewed in CSS, not certified by a device screenshot.
