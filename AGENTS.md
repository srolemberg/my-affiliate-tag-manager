# Agent Instructions

This root-level file is the single source of repository instructions for all coding agents. Keep shared project guidance here rather than adding tool-specific instruction files.

## Project context

- Chrome extension using Manifest V3, implemented with native JavaScript and HTML, without a framework.
- Detects the `tag` parameter in URLs on `amazon.com` and its domain variants, stores tag keys, original URLs, and descriptions in `chrome.storage.local`, and keeps a single global most-recent access record for the popup.
- `manifest.json` registers `background.js` as the service worker and the popup/options pages as extension interfaces.
- `background.js` monitors tab activation and URL changes, records discovered tags, updates the action badge, and handles tag mutations.
- `popup.html`/`popup.js` show the global last-access time and open a saved URL in the current or a new tab on every page.
- `options.html`/`options.js` implement tag/URL management, batch edits, deletion, and JSON import/export.
- `tag-utils.js` provides shared normalization, merging, Amazon URL parsing, and tag validation. It loads supported store domains from `amazon_store_domains.json` and is loaded using `importScripts()` in the service worker and script tags in both HTML pages.
- `i18n.js` applies localized text and aria labels to marked HTML elements and formats thrown values for UI errors.
- Messages are stored in `_locales/pt_BR/messages.json` and `_locales/en/messages.json`. The default language is set by `default_locale` in `manifest.json`.
- Tests use Node.js's built-in test runner and are located in `tests/`.

## Commands

- Run all tests: `npm test`
- Run the Puppeteer extension smoke test: `npm run test:extension`
- Run the utility tests: `node --test tests/tag-utils.test.js`
- Run the service-worker tests: `node --test tests/background.test.js`
- Run a named test: `node --test --test-name-pattern="test name"`
- Check a modified JavaScript file: `node --check path/to/file.js`
- There is no build or lint script. `npm install` installs Chrome API type definitions and Puppeteer; Puppeteer downloads its compatible browser for the extension smoke test.
- To load the extension manually, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the repository root.

## Data and message flow

- The canonical list key is `savedTags` in `chrome.storage.local`. Records use `{ tag: string, description: string, url: string }`; `tag` is derived from the single distinct `tag` query value in the HTTP(S) URL. The single global `{ tag, lastAccessed }` access record is stored separately as `lastAccessedTag`. Legacy per-record timestamps are consolidated during migration.
- The options page sends `{ type: 'tags:mutate', operation }` messages to the service worker and expects either `{ tags }` or `{ error }`.
- `background.js` serializes mutations through `tagMutationQueue`; route tag-list writes through this queue rather than writing directly from the options page.
- Merge operations retain existing descriptions when incoming entries have none. `webNavigation.onCompleted` for the main frame on a supported URL preserves an existing URL and captures the full URL for a new tag. Completed navigation and popup opens update the global key and timestamp. Tab focus and `tabs.onUpdated` do not change access timestamps.
- The badge shows a green check for an explicit valid saved URL whose key matches the global last-access key, a yellow exclamation mark for an explicit valid saved URL whose key differs, and a red x for an invalid or unsaved URL. On a supported Amazon URL with no `tag` parameter, the global last-access key can identify the saved URL only when that key exists in the saved records and its original URL is valid; this inferred state is yellow until its access timestamp reaches 24 hours, then red. An alarm refreshes the badge at expiry.
- `TAG_ACCESS_VALIDITY_MS` in `tag-utils.js` is the shared 24-hour duration for inferred badge status and the service-worker alarm.
- `getBadgeStatus()` in `tag-utils.js` is the single source of notification-state evaluation used by the service worker to update the toolbar badge. The popup does not display a separate notification-status field.
- Badge validation rules for future changes:
  1. Parse the active URL once; hide the badge when parsing fails or its hostname is not a supported Amazon hostname.
  2. Only HTTP(S) URLs can provide/infer a key. An explicit `tag` parameter must contain one non-empty distinct value; repeated identical values are accepted, while empty or conflicting values are invalid and must not fall back to the last-access key.
  3. If there is no `tag` parameter, infer the key from `lastAccessedTag` only for a supported HTTP(S) URL. The inferred key must match a saved record whose original URL validates for that key.
  4. For an explicit saved key, show green when it matches `lastAccessedTag.tag`, otherwise yellow. For an inferred saved key, show yellow while its valid `lastAccessed` timestamp is less than 24 hours old, otherwise red. Missing/invalid saved records and invalid explicit values are red.
  5. Keep the badge decision in one validation flow and read/normalize saved records once; keep the expiration alarm synchronized with access-record writes.
- Keep tag normalization/merging and Amazon tag URL parsing in `tag-utils.js`; do not recreate equivalent implementations in page scripts or the service worker.
- Treat storage values, message payloads, and DOM lookups as potentially absent or malformed. Validate required page controls before registering handlers, guard selector results before use, and surface operation failures instead of relying on `TypeError` behavior.
- Tag keys and descriptions are trimmed, and tag keys remain unique. `getTagFromAmazonUrl()` derives the key only from valid HTTP(S) URLs on domains listed under `stores` in `amazon_store_domains.json` (or their subdomains), with exactly one distinct non-empty `tag` value; reject ambiguous URLs. Do not treat `additional_domains` as store domains. The options page shows keys as read-only, and editing a URL changes the derived key.
- JSON export uses `{ "version": 1, "tags": [...] }` with `tag`, `description`, and `url`; the global access record is not exported. Imports also accept older arrays and records without URLs, ignore any imported `lastAccessed`, merge with stored tags, and remove duplicates.

## Maintenance guidelines

1. Read the files related to the request and follow existing patterns. Do not change files or behavior outside the scope.
2. Make surgical changes and preserve compatibility with stored data and JSON import/export formats.
3. Keep extension permissions to the minimum necessary. `webNavigation` distinguishes completed main-frame navigations from tab activation for last-access timestamps; `alarms` refreshes the inferred-key badge state at 24 hours. Document permission changes in README.
4. Put new user-facing text in both locale catalogs. Keep message identifiers and placeholders consistent; use `data-i18n`/`data-i18n-aria-label` in HTML and `chrome.i18n.getMessage()` in JavaScript. HTML scripts load `i18n.js` and `tag-utils.js` before the page-specific script.
5. When changing logic, add or update tests in `tests/`. Cover valid results, invalid input, and relevant failures.
6. Update `README.md` when changing installation, behavior, permissions, tests, import/export, or localization.
7. Avoid unnecessary dependencies. Prefer native Chrome and Node.js APIs already used by the project.
8. Use the shared `getTagFromAmazonUrl()` and `isValidAmazonTagUrl()` helpers wherever supported Amazon tag URLs must be validated. Their domain source is `amazon_store_domains.json`'s `stores` array, with subdomains allowed at label boundaries. Do not accept arbitrary hostnames merely because they contain or start with an Amazon domain.
9. Do not disguise errors with success-shaped values or silent failures; preserve localized UI error messages and useful service-worker logging.
10. Update JSDoc when changing shared helpers or UI/service-worker behavior. Keep the documentation aligned with the actual DOM and event flows.
11. Do not include credentials, personal data, or secrets. Do not make destructive changes or discard pre-existing work.
12. During release or package preparation, do not include `screen001.png` or GIMP source files such as `store001.xcf` in the repository package or distribution.

## Verification

- Run `npm test` after changes to behavior or tests.
- Run `node --check` on modified JavaScript files.
- Validate any modified JSON files, including `manifest.json` and locale catalogs.
- When changing localization, verify that identifiers and placeholders remain consistent across languages and that HTML contains no `__MSG_...__` tokens (these are reserved for the manifest).
- Clearly report any verification that could not be run, and do not claim the extension was tested in Chrome unless it was.

## Delivery

Implement the request directly when its scope is clear. When finished, summarize what changed and report the tests run and their results, without mentioning unrelated changes.

## Publication information

Never include information about the Chrome Web Store publication process anywhere in the repository or in documentation, including README.md, AGENTS.md, comments, messages, guides, or other files. This restriction also applies to release, submission, listing, screenshots, privacy-practice, dashboard, and store-package instructions. Do not add such information unless explicitly requested by the maintainer.
