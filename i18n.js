/**
 * Replaces marked HTML text and attributes with messages for the language
 * selected in the browser.
 */
function localizeDocument() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const message = chrome.i18n.getMessage(element.dataset.i18n);
        if (message) {
            element.textContent = message;
        }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        const message = chrome.i18n.getMessage(element.dataset.i18nAriaLabel);
        if (message) {
            element.setAttribute('aria-label', message);
        }
    });

    const title = document.querySelector('title[data-i18n]');
    if (title) {
        const message = chrome.i18n.getMessage(title.dataset.i18n);
        if (message) {
            document.title = message;
        }
    }
}

localizeDocument();
