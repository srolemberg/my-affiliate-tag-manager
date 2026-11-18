# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Added a changelog for documenting future releases.

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
