# My Affiliate Tags

A Chrome extension for detecting, storing, and managing `tag` parameter values in URLs whose hostname contains `amazon.com`. Tags and descriptions are stored locally in the browser.

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

- Shows the `tag` parameter found in the URL, or indicates that no tag was detected.
- Lets you select a saved tag to replace the current `tag` parameter. The tab navigates to the updated URL, and the popup closes.
- Provides a link to the tag management page.

On other domains, the popup displays a message that the domain is not supported and provides a link to manage tags.

## Tag management

On the options page, you can:

- Add tags with an optional description.
- Edit tags and descriptions in a batch using **Save changes**.
- Delete an individual tag after confirmation.
- Delete all tags after two confirmations.
- Import a JSON file or export the current list.

`tag` values found while browsing supported URLs are added automatically without duplicates. Each tag is displayed either by its value or its saved description.

## JSON import and export

The exported file uses this format:

```json
{
  "version": 2,
  "tags": [
    {
      "tag": "example-20",
      "description": "My account"
    }
  ]
}
```

You can also import an array of strings or records in the form `{ "tag": "...", "description": "..." }`. Importing merges the data with existing tags and removes duplicates. The description is optional.

## Internationalization

The interface and manifest strings use Chrome's localization system. The default language is set by `default_locale` in `manifest.json`; its messages are in `_locales/pt_BR/messages.json`. English translations are in `_locales/en/messages.json` and are selected automatically when the browser language is English. The manifest uses `__MSG_messageName__` identifiers; HTML files mark text with `data-i18n` and accessible attributes with `data-i18n-aria-label`, which are applied by `i18n.js`. Scripts use `chrome.i18n.getMessage()`.

To add another language, create a folder in `_locales` using the corresponding language code and add a `messages.json` file with the same message identifiers.

## Artificial intelligence disclaimer

This project was developed with the assistance of artificial intelligence tools. The code and documentation may contain inaccuracies; review and test changes before using or distributing the extension. Use of the extension and affiliate links is the user's responsibility and must comply with Amazon's terms and applicable laws.

## Permissions

- `activeTab`: accesses the active tab when the user interacts with the extension.
- `tabs`: reads the tab URL and tracks navigation and tab changes.
- `storage`: stores tags locally in the browser.

## Main files

- `manifest.json`: Manifest V3 configuration and permissions.
- `background.js`: service worker that detects tags during navigation, updates the badge, and processes list changes.
- `popup.html` / `popup.js`: interface for identifying and switching the tag.
- `options.html` / `options.js`: interface for CRUD operations and JSON import/export.
- `tag-utils.js`: shared tag normalization and Amazon domain validation.
- `_locales/`: localized strings for the supported languages.
