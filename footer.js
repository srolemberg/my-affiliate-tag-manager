const footerLabel = document.getElementById('footer-label');
footerLabel.textContent = chrome.i18n.getMessage(
    'extensionFooter',
    chrome.runtime.getManifest().version,
);
