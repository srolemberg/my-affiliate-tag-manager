# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-26

### Added

- Automated checks for missing localization keys and placeholders, plus
  untranslated static text in the extension pages.
- Made browser-driven localization tests set Chromium's Linux UI language for
  each locale so CI exercises the intended message catalog.

### Changed

- Corrected Portuguese terminology for the toolbar indicator and updated the
  privacy help text to point to the project link in Settings.
- Clarified localization and command-scope guidance for maintainers.
- Corrected terminology in the changelog and removed a misplaced footer item
  from the README tag-management list.

## [0.3.0] - 2026-11-26

### Added

- Supporting descriptions below saved tag keys when a description is present.
- App-bar actions for rating the extension and viewing the project, plus an
  issue-reporting action in the footer.
- A linked availability badge image in the README.

### Changed

- Refined the options, popup, and footer layouts to follow Material 3 surfaces,
  typography, spacing, and icon-action patterns.
- Changed the options app bar to identify the Settings screen, and added
  localized tooltips for the rating, project, and report actions.
- Made the footer a centered version app bar with a report-problems icon, and
  constrained its width to the options content on wider screens.
- Expanded the popup menu, accordion rows, and dividers to the available content
  width; accordion sections continue to open and close without animation.
- Expanded visual, localization, and unit coverage for the updated interface and
  optional saved-tag descriptions. Updated shared agent guidance for scenario
  coverage and Material 3 hierarchy.

## [0.2.0] - 2026-11-26

### Added

- Material 3 palettes and shared interaction styles across the popup, options
  page, and footer, including system, light, and dark theme preferences saved
  locally.
- Reduced-motion-aware button ripples.
- Expanded unit and browser-driven coverage for theme controls, popup interactions,
  saved-tag management, and release package resources.
- Frontend test naming and observability conventions for maintainers.

### Changed

- Redesigned the options page with Material 3 cards, floating-label fields,
  app-bar actions for JSON import and export, supporting status text, and compact
  icon actions for deleting individual tags.
- Redesigned the popup with a last-access card and contextual avatar, an
  accessible keyboard-operable saved-tag menu, a settings action in the app bar,
  and Material list-item accordions for help, badge details, and privacy.
- Updated the shared footer to follow the selected theme and system contrast
  preference.
- Refreshed the toolbar badge for the active tab in the focused window when tab
  or window focus changes.
- Clarified localized badge descriptions for the active tab and the 24-hour
  inferred-access period, and shortened the message shown after deleting all
  saved keys.
- Ignored local AI-tool configuration directories while keeping `AGENTS.md` as
  the shared project guidance.

## [0.1.1] - 2026-11-24

### Added

- Automated extension ZIP packaging for Windows and POSIX, driven by a shared
  runtime-file allowlist.
- Package validation for manifest and HTML resources, with regression tests.
- Contributor guidance and a local privacy summary.

### Changed

- Refined Amazon tag URL validation and expanded service-worker and utility test
  coverage.
- Reviewed extension permissions and removed the unnecessary `activeTab`
  permission.
- Updated privacy disclosures and project documentation.

## [0.1.0] - 2026-11-17

### Added

- Initial Chrome Manifest V3 extension for discovering and managing Amazon affiliate tags.
- Popup for viewing the latest accessed tag and opening saved URLs.
- Options page for adding, editing, deleting, importing, and exporting saved tags.
- Main-frame navigation detection for automatic tag and URL discovery.
- Global most-recent access record and 24-hour toolbar badge state.
- Portuguese (Brazil) and English interface localization.
- Support for Amazon store domains listed in `amazon_store_domains.json`.
- MIT license and project documentation.
- Node.js unit tests and Puppeteer extension smoke tests.

### Changed

- Consolidated legacy per-tag access timestamps into a single global access record.
- Limited Amazon URL parsing to supported store domains and their subdomains.
- Added shared tag normalization, URL parsing, and merge helpers.
- Updated the popup, options page, footer, and badge behavior.
