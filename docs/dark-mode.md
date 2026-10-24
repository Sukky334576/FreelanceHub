# Appearance themes

FreelanceHub supports Light, Dark and System themes. Use the sun/moon button in the page header (also available on the login screen), or Settings → รูปแบบหน้าจอ to select a preference.

The default is System. Explicit choices are remembered on this device in `freelancehub_theme`, and synchronized between browser tabs. Theme preferences do not alter account data. If browser storage is unavailable, switching still works for the current page.

## Implementation

- `js/theme.js` applies the saved preference before styles paint, updates native form controls/browser chrome and accessible toggle labels, and follows OS changes when System is selected.
- `css/app-ui.css` provides charcoal surfaces (`#121212`, `#1c1c1c`, `#242424`), gray borders and a mint green accent (`#3ecf8e`) inspired by the supplied reference.
- Shared tokens cover dashboard, navigation, login, settings, dialogs, slip review, calendar labels and charts. Printed invoice styling remains independent.
- The production build allowlist includes the theme module.

## Verification — 2026-10-24

Five behavioral tests cover initial preference, OS changes, reload persistence, cross-tab synchronization and blocked storage. They run as part of `npm test` alongside existing regression checks.

Browser checks used synthetic local data: dashboard, calendar, settings, chart and slip fields/footer; light/dark switching and reload persistence; layouts at 320px, 390px, 768px and desktop widths. These are browser viewport checks, not a claim of physical iPhone testing. No real financial records were created during theme verification.
