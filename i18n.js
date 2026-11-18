/**
 * Localizes marked text and attributes using the browser's selected language.
 */
function localizeDocument() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const messageKey = element.dataset?.i18n;
        if (!messageKey) {
            return;
        }
        const message = chrome.i18n.getMessage(messageKey);
        if (message) {
            element.textContent = message;
        }
    });

    const localizedAttributes = [
        {
            selector: '[data-i18n-aria-label]',
            datasetKey: 'i18nAriaLabel',
            attribute: 'aria-label',
        },
        {
            selector: '[data-i18n-title]',
            datasetKey: 'i18nTitle',
            attribute: 'title',
        },
    ];
    for (const {selector, datasetKey, attribute} of localizedAttributes) {
        document.querySelectorAll(selector).forEach((element) => {
            const messageKey = element.dataset?.[datasetKey];
            if (!messageKey) {
                return;
            }
            const message = chrome.i18n.getMessage(messageKey);
            if (message) {
                element.setAttribute(attribute, message);
            }
        });
    }
}

/**
 * Converts arbitrary thrown values into a safe string for localized errors.
 * @param {unknown} error Value caught by a try/catch block.
 * @returns {string} Readable error detail.
 */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

localizeDocument();
