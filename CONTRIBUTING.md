# Contributing

Thank you for contributing to My Affiliate Tags. This project uses native JavaScript, HTML, and Manifest V3 without a framework.

## Before you start

- Read `README.md` to understand the extension's behavior.
- Consult `AGENTS.md` for the repository's technical and maintenance standards.
- Do not include credentials, personal data, private affiliate information, or other sensitive data.
- Keep changes small and related to the described issue.

## Local setup

1. Fork the repository and clone it locally.
2. Run `npm install` to install the development dependencies.
3. Open `chrome://extensions` in Chrome.
4. Enable Developer mode.
5. Select **Load unpacked** and choose the project folder.

Local loading allows you to test the popup, options page, and service worker directly in the browser.

## Workflow

1. Create a branch from the main branch.
2. Implement one change at a time and follow existing patterns.
3. Add or update tests for the new or corrected behavior.
4. Run the applicable checks before submitting a pull request.
5. Clearly describe the problem, solution, and tests performed in the pull request.

## Code standards

- Preserve the native JavaScript and HTML already used by the project.
- Avoid unnecessary dependencies.
- Use `tag-utils.js` for tag normalization, record merging, and Amazon URL validation.
- Use `i18n.js` and `chrome.i18n.getMessage()` for text and messages displayed by the interface.
- Add new text to `_locales/pt_BR/messages.json` and `_locales/en/messages.json`, keeping identifiers and placeholders consistent.
- Validate data from storage, messages, and DOM elements; account for missing or malformed values.
- Do not write to the `savedTags` list directly from the options page. Mutations must pass through the `tagMutationQueue` in the service worker.
- Preserve existing data formats and compatibility with legacy records.
- Use JSDoc when changing shared helpers or service-worker and interface behavior.

## Tests

Run all tests:

```sh
npm test
```

To run specific parts:

```sh
node --test tests/tag-utils.test.js
node --test tests/background.test.js
npm run test:extension
```

Before submitting a change, also check modified JavaScript files:

```sh
node --check path/to/file.js
```

Tests should cover valid results, invalid inputs, and relevant failures.

## Internationalization

When adding or changing visible text:

- Use `data-i18n` and `data-i18n-aria-label` in HTML.
- Use `chrome.i18n.getMessage()` in JavaScript.
- Do not use `__MSG_...__` in HTML files; this syntax is reserved for `manifest.json`.
- Keep the `pt_BR` and `en` catalogs synchronized.
- For new languages, create `_locales/<language-code>/messages.json` with the same identifiers.

## Documentation

Update `README.md` when the change affects:

- installation or local loading;
- visible behavior;
- permissions;
- tests;
- JSON import or export;
- internationalization.

Validate modified JSON, including `manifest.json` and localization catalogs.

## Files and packaging

Before changing resources loaded by the manifest or HTML pages, review the current references in `manifest.json`, HTML, and stylesheets. Explicitly update the allowlist and packaging scripts when necessary.

Run this validation before preparing a distribution release:

```sh
npm run package:validate
```

The packaging scripts can be run with:

```sh
npm run package:extension
npm run package:extension:sh
```

Do not include tests, development files, source artwork, or unnecessary distribution images in the package.

## Pull requests

Include in the pull request:

- a clear description of the change;
- the motivation and problem solved;
- the test commands executed;
- instructions to reproduce or verify the change;
- screenshots or videos when there is a visual change.
