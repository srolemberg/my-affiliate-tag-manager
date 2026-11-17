# My Affiliate Tags

A Chrome extension for detecting, storing, and managing URLs with a `tag` parameter on hosts whose name contains `amazon.com`. Each saved tag stores its key, original URL, and optional description in the browser. The most recent tag access and its time are stored once as a separate global record.

## Installation

1. Clone or download this project.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Pin the extension to the toolbar to access its popup.

To enable Chrome API definitions in your editor, run `npm install`. This step is optional for using the extension.

## Tests

Run the unit tests with `npm test`. They use Node.js's built-in test runner and do not require additional dependencies.

## Popup

On a supported domain, the popup:

- Shows the single most recently accessed tag and its last-access time.
- Lets you select a saved tag and open its original URL in the current tab or a new tab.
- Updates the global last-access record to the selected tag when it is opened.
- Provides a link to the tag management page.

On other domains, the popup displays a message that the domain is not supported and provides a link to manage tags.

## Tag management

On the options page, you can:

- Add tags with a required original Amazon URL containing the same `tag` value, and an optional description.
- Edit tags, descriptions, and original URLs in a batch using **Save changes**. Edited URLs must remain on a supported Amazon domain and contain that record's tag.
- Delete an individual tag after confirmation.
- Delete all tags after two confirmations.
- Import a JSON file or export the current list.

After a supported Amazon page's main-frame navigation completes, tags in its URL are saved with the full URL and the single global last-access record is set to the last tag in that URL. Opening a saved URL in the popup also replaces that global record. Switching focus to an already open tab does not update it. Existing per-tag access timestamps are consolidated to the latest one when migrating stored data. The global access record is shown only in the popup and is not included in exports. Tag keys remain unique. Existing data without a saved URL stays compatible; a later completed navigation can populate it, or it can be entered in tag management.

## JSON import and export

The exported file uses this format:

```json
{
  "version": 3,
  "tags": [
    {
      "tag": "example-20",
      "description": "My account",
      "url": "https://www.amazon.com/dp/example?tag=example-20"
    }
  ]
}
```

You can also import an array of strings or records in the form `{ "tag": "...", "description": "...", "url": "..." }`. Older records without URLs remain importable, and any `lastAccessed` value in an imported record is ignored; new URLs are validated when supplied. Importing merges the data with existing tags and removes duplicates. The description is optional.

## Internationalization

The interface and manifest strings use Chrome's localization system. The default language is set by `default_locale` in `manifest.json`; its messages are in `_locales/pt_BR/messages.json`. English translations are in `_locales/en/messages.json` and are selected automatically when the browser language is English. The manifest uses `__MSG_messageName__` identifiers; HTML files mark text with `data-i18n` and accessible attributes with `data-i18n-aria-label`, which are applied by `i18n.js`. Scripts use `chrome.i18n.getMessage()`.

To add another language, create a folder in `_locales` using the corresponding language code and add a `messages.json` file with the same message identifiers.

## Artificial intelligence disclaimer

This project was developed with the assistance of artificial intelligence tools. The code and documentation may contain inaccuracies; review and test changes before using or distributing the extension. Use of the extension and affiliate links is the user's responsibility and must comply with Amazon's terms and applicable laws.

## Permissions

- `activeTab`: accesses the active tab when the user interacts with the extension.
- `tabs`: reads the tab URL and tracks navigation and tab changes.
- `storage`: stores tags locally in the browser.
- `webNavigation`: detects successfully completed main-frame navigations so access timestamps are not changed by tab focus alone.

## Main files

- `manifest.json`: Manifest V3 configuration and permissions.
- `background.js`: service worker that captures URLs and access times during navigation, updates the badge, and serializes list changes.
- `popup.html` / `popup.js`: interface for viewing last access and opening saved URLs.
- `options.html` / `options.js`: interface for tag and URL maintenance plus JSON import/export.
- `tag-utils.js`: shared tag normalization, Amazon domain, and URL/tag validation.
- `_locales/`: localized strings for the supported languages.
