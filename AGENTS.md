# Project Maintenance Agent

This file provides guidance for coding agents maintaining this repository. Act as a careful maintainer of the **My Affiliate Tags** extension and make complete, focused, verifiable changes.

## Project context

- Chrome extension using Manifest V3, implemented with native JavaScript and HTML, without a framework.
- Detects the `tag` parameter in URLs whose hostname contains `amazon.com`, stores tags and descriptions in `chrome.storage.local`, and lets users manage or switch tags through the popup.
- `background.js` is the service worker; `popup.html`/`popup.js` implement the popup; `options.html`/`options.js` implement tag management.
- `tag-utils.js` contains shared functions. `i18n.js` localizes HTML.
- Messages are stored in `_locales/pt_BR/messages.json` and `_locales/en/messages.json`. The default language is set by `default_locale` in `manifest.json`.
- Tests use Node.js's built-in test runner and are located in `tests/`.

## Maintenance guidelines

1. Read the files related to the request and follow existing patterns. Do not change files or behavior outside the scope.
2. Make surgical changes and preserve compatibility with stored data and JSON import/export formats.
3. Keep extension permissions to the minimum necessary. If a change requires a new permission, justify it and update the documentation.
4. Put new user-facing text in the localization catalogs. Keep identifiers and placeholders consistent across all existing languages; use `data-i18n`/`data-i18n-aria-label` in HTML and `chrome.i18n.getMessage()` in JavaScript.
5. When changing logic, add or update tests in `tests/`. Cover valid results, invalid input, and relevant failures.
6. Update `README.md` when changing installation, behavior, permissions, tests, import/export, or localization.
7. Avoid unnecessary dependencies. Prefer native Chrome and Node.js APIs already used by the project.
8. Do not disguise errors with success-shaped values or silent failures; preserve useful error handling and logging.
9. Do not include credentials, personal data, or secrets. Do not make destructive changes or discard pre-existing work.

## Verification

- Run `npm test` after changes to behavior or tests.
- Run `node --check` on modified JavaScript files.
- Validate any modified JSON files, including `manifest.json` and locale catalogs.
- When changing localization, verify that identifiers and placeholders remain consistent across languages and that HTML contains no `__MSG_...__` tokens (these are reserved for the manifest).
- Clearly report any verification that could not be run, and do not claim the extension was tested in Chrome unless it was.

## Delivery

Implement the request directly when its scope is clear. When finished, summarize what changed and report the tests run and their results, without mentioning unrelated changes.
