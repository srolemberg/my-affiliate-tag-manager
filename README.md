# My Affiliate Tags

A Chrome extension for detecting, storing, and managing URLs with a `tag` parameter on `amazon.com` and its domain variants (such as `www.amazon.com` and `amazon.com.br`). Each saved tag stores its key, original URL, and optional description in the browser. The most recent tag access and its time are stored once as a separate global record.

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
- Shows the extension version and a project link labeled with the author's name in a light-gray footer shared with the options page.
- Uses the badge to show link status: green check when a valid saved URL's key matches the latest accessed key, yellow exclamation mark when the valid saved URL has a different key, and red x when the URL has no valid saved tag. On a bare supported Amazon URL without a `tag` parameter, a valid saved record matching the latest accessed key shows yellow until the 24-hour access window expires, then red.
- Displays the latest access with its key and date, then the tag selector and horizontal open buttons. A horizontal rule separates these controls from the settings button and the collapsed “How it works”, privacy/data, and badge-icon explanations.
- Explains the green, yellow, and red badge states in the popup.

The popup keeps the same layout on every page. On domains where notification status does not apply, it explains that in the status area while leaving saved-tag controls and settings available.

## Tag management

On the options page, you can:

- Add a record using its required original URL and an optional description. The key is derived from the URL's single `tag` parameter; the URL must be a valid HTTP(S) URL on a supported Amazon domain. URLs with multiple distinct `tag` values are rejected.
- If the URL derives a key already in the list, adding is disabled and an error appears below the URL field.
- Edit descriptions and original URLs in a batch using **Save changes**. The displayed key is read-only and changes when the URL is edited; the URL must remain valid and the derived key unique. Invalid or duplicate URLs show an error below the field and block saving.
- Delete an individual tag after confirmation.
- Delete all tags after two confirmations.
- Import a JSON file or export the current list.
- Shows the extension version and a project link labeled with the author's name in the shared light-gray footer.

After a supported Amazon page's main-frame navigation completes, its tag and full URL are saved. The global last-access record is updated for a completed navigation or when a saved URL is opened from the popup. Switching focus to an already open tab does not update access time. Existing per-tag access timestamps are consolidated to the latest one when migrating stored data. The global access record is shown only in the popup and is not included in exports. Tag keys remain unique. Existing data without a saved URL stays compatible; a later completed navigation can populate it, or it can be entered in tag management.

The badge turns green with a white check when the current URL has a valid affiliate tag and its key matches the global last-access key. For a supported Amazon URL without a `tag` parameter, the extension uses the global last-access key only if that key exists in the saved records and its saved original URL is valid; the badge is yellow while that key's last-access timestamp is less than 24 hours old, then turns red. The badge is also yellow with a white exclamation mark when an explicit, valid saved URL has a different key from the last-access key. It turns red with a white x when there is no valid saved key to associate with the current URL. An alarm refreshes the badge when the inferred key's 24-hour window expires.

## JSON import and export

The exported file uses this format:

```json
{
  "version": 1,
  "tags": [
    {
      "tag": "example-20",
      "description": "My account",
      "url": "https://www.amazon.com/dp/example?tag=example-20"
    }
  ]
}
```

You can also import an array of strings or records in the form `{ "tag": "...", "description": "...", "url": "..." }`. Older records without URLs remain importable, and any `lastAccessed` value in an imported record is ignored; supplied URLs must be valid HTTP(S) Amazon URLs with exactly one distinct tag matching the record key. Importing merges the data with existing tags and removes duplicates. The description is optional.

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
- `alarms`: refreshes the badge when the inferred key's 24-hour access window expires.

## Main files

- `manifest.json`: Manifest V3 configuration and permissions.
- `background.js`: service worker that captures URLs and access times during navigation, updates the badge, and serializes list changes.
- `popup.html` / `popup.js`: interface for viewing last access and opening saved URLs.
- `options.html` / `options.js`: interface for tag and URL maintenance plus JSON import/export.
- `tag-utils.js`: shared tag normalization, Amazon domain, and URL/tag validation.
- `_locales/`: localized strings for the supported languages.
