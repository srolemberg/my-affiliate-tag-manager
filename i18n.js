/**
 * Localizes marked text and attributes using the browser's selected language.
 */
function localizeDocument() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const message = chrome.i18n.getMessage(element.dataset.i18n);
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
            const message = chrome.i18n.getMessage(element.dataset[datasetKey]);
            if (message) {
                element.setAttribute(attribute, message);
            }
        });
    }
}

localizeDocument();
