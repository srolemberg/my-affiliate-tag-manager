# Agent Instructions

This root-level file is the single source of repository instructions for all coding agents. Keep shared project guidance here rather than adding tool-specific instruction files.

## Project context

- Chrome extension using Manifest V3, implemented with native JavaScript and HTML, without a framework.
- Detects the `tag` parameter in URLs whose hostname contains `amazon.com`, stores tags and descriptions in `chrome.storage.local`, and lets users manage or switch tags through the popup.
- `manifest.json` registers `background.js` as the service worker and the popup/options pages as extension interfaces.
- `background.js` monitors tab activation and URL changes, records discovered tags, updates the action badge, and handles tag mutations.
- `popup.html`/`popup.js` show the active tab's tag and switch it to a saved tag.
- `options.html`/`options.js` implement tag management, batch edits, deletion, and JSON import/export.
- `tag-utils.js` provides shared normalization and Amazon URL validation. It is loaded using `importScripts()` in the service worker and script tags in both HTML pages.
- `i18n.js` applies localized text and aria labels to marked HTML elements.
- Messages are stored in `_locales/pt_BR/messages.json` and `_locales/en/messages.json`. The default language is set by `default_locale` in `manifest.json`.
- Tests use Node.js's built-in test runner and are located in `tests/`.

## Commands

- Run all tests: `npm test`
- Run the utility tests: `node --test tests/tag-utils.test.js`
- Run the service-worker tests: `node --test tests/background.test.js`
- Run a named test: `node --test --test-name-pattern="test name"`
- Check a modified JavaScript file: `node --check path/to/file.js`
- There is no build or lint script. `npm install` is optional and only needed to install Chrome API type definitions for editor support.
- To load the extension manually, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the repository root.

## Data and message flow

- The canonical storage key is `savedTags` in `chrome.storage.local`. Current records use `{ tag: string, description: string }`; legacy string entries remain supported and are normalized by `normalizeTagEntries()` in `tag-utils.js`.
- The options page sends `{ type: 'tags:mutate', operation }` messages to the service worker and expects either `{ tags }` or `{ error }`.
- `background.js` serializes mutations through `tagMutationQueue`; route tag-list writes through this queue rather than writing directly from the options page.
- Merge operations retain an existing description when an incoming entry has none. Tag keys and descriptions are trimmed, and tag keys remain unique.
- JSON export uses `{ "version": 2, "tags": [...] }`. Imports also accept an array of strings or records, merge with stored tags, and remove duplicates.

## Maintenance guidelines

1. Read the files related to the request and follow existing patterns. Do not change files or behavior outside the scope.
2. Make surgical changes and preserve compatibility with stored data and JSON import/export formats.
3. Keep extension permissions to the minimum necessary. If a change requires a new permission, justify it and update the documentation.
4. Put new user-facing text in both locale catalogs. Keep message identifiers and placeholders consistent; use `data-i18n`/`data-i18n-aria-label` in HTML and `chrome.i18n.getMessage()` in JavaScript. HTML scripts load `i18n.js` and `tag-utils.js` before the page-specific script.
5. When changing logic, add or update tests in `tests/`. Cover valid results, invalid input, and relevant failures.
6. Update `README.md` when changing installation, behavior, permissions, tests, import/export, or localization.
7. Avoid unnecessary dependencies. Prefer native Chrome and Node.js APIs already used by the project.
8. Use the shared `isAmazonDomainUrl()` rule (`new URL(url).hostname.includes('amazon.com')`) wherever supported Amazon URLs must be validated.
9. Do not disguise errors with success-shaped values or silent failures; preserve localized UI error messages and useful service-worker logging.
10. Do not include credentials, personal data, or secrets. Do not make destructive changes or discard pre-existing work.

## Verification

- Run `npm test` after changes to behavior or tests.
- Run `node --check` on modified JavaScript files.
- Validate any modified JSON files, including `manifest.json` and locale catalogs.
- When changing localization, verify that identifiers and placeholders remain consistent across languages and that HTML contains no `__MSG_...__` tokens (these are reserved for the manifest).
- Clearly report any verification that could not be run, and do not claim the extension was tested in Chrome unless it was.

## Delivery

Implement the request directly when its scope is clear. When finished, summarize what changed and report the tests run and their results, without mentioning unrelated changes.
