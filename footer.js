/** Displays the extension version in the shared footer app bar. */
const footerLabel = document.getElementById('footer-label');
const extensionVersion = chrome.runtime.getManifest()?.version;
if (!footerLabel || typeof extensionVersion !== 'string') {
    console.error('Could not render the extension footer: required data is missing.');
} else {
    footerLabel.textContent = chrome.i18n.getMessage(
        'extensionFooter',
        extensionVersion,
    );
}
