/**
 * Controls the extension popup: validates the active tab's domain, displays
 * tags found in the URL, and allows replacing the `tag` parameter with a saved
 * key. The list is read from `chrome.storage.local`.
 */
const detectedTagElement = document.getElementById('detected-tag');
const tagSelect = document.getElementById('saved-tag');
const applyTagButton = document.getElementById('apply-tag-button');
const statusElement = document.getElementById('status');
const tagForm = document.getElementById('tag-form');
const amazonContent = document.getElementById('amazon-content');
const domainMessage = document.getElementById('domain-message');

/**
 * Loads the active tab, displays the detected tag, and populates the tag
 * selector. Hides the controls when the URL is not on a supported domain.
 * @returns {Promise<void>}
 */
async function loadPopup() {
    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const activeTab = tabs[0];
        if (!activeTab?.url) {
            amazonContent.hidden = true;
            domainMessage.textContent = chrome.i18n.getMessage('invalidDomainUnavailable');
            domainMessage.hidden = false;
            return;
        }

        const currentUrl = new URL(activeTab.url);
        if (!isAmazonDomainUrl(activeTab.url)) {
            amazonContent.hidden = true;
            domainMessage.textContent = chrome.i18n.getMessage('invalidDomainForTags');
            domainMessage.hidden = false;
            return;
        }

        const stored = await chrome.storage.local.get('savedTags');
        const tagValues = currentUrl.searchParams.getAll('tag');
        const hasTag = currentUrl.searchParams.has('tag');
        detectedTagElement.textContent = hasTag
            ? tagValues.filter(Boolean).join(', ') || chrome.i18n.getMessage('tagWithoutValue')
            : chrome.i18n.getMessage('noTagIdentified');
        detectedTagElement.style.color = hasTag ? 'green' : 'red';
        tagForm.dataset.tabId = String(activeTab.id);

        const storedTags = Array.isArray(stored.savedTags) ? stored.savedTags : [];
        const savedTags = storedTags
            .map(
                /** Converts legacy keys to records with an empty description. */
                (entry) => (
                typeof entry === 'string'
                    ? {tag: entry, description: ''}
                    : entry
                ),
            )
            .filter(
                /** Keeps only records with a valid key. */
                (entry) => typeof entry?.tag === 'string' && entry.tag.trim(),
            );

        for (const entry of savedTags) {
            const option = document.createElement('option');
            option.value = entry.tag;
            option.textContent = entry.description || entry.tag;
            tagSelect.append(option);
        }
        tagSelect.value = '';
        applyTagButton.disabled = true;

        if (tagSelect.options.length === 1) {
            statusElement.textContent = chrome.i18n.getMessage('addTagInSettings');
        }
    } catch (error) {
        amazonContent.hidden = true;
        domainMessage.textContent = chrome.i18n.getMessage('invalidDomainValidation');
        domainMessage.hidden = false;
        console.error(chrome.i18n.getMessage('popupLoadError'), error);
    }
}

/** Updates the button state when the selection changes. */
tagSelect.addEventListener('change', () => {
    applyTagButton.disabled = !tagSelect.value;
});

/** Applies the selected tag to the active tab and closes the popup. */
tagForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tabId = Number(tagForm.dataset.tabId);
    const selectedTag = tagSelect.value;

    if (!Number.isInteger(tabId) || !selectedTag) {
        statusElement.textContent = chrome.i18n.getMessage('selectValidTag');
        return;
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url) {
            throw new Error(chrome.i18n.getMessage('tabUrlUnavailable'));
        }

        const updatedUrl = new URL(tab.url);
        updatedUrl.searchParams.set('tag', selectedTag);
        await chrome.tabs.update(tabId, {url: updatedUrl.toString()});
        window.close();
    } catch (error) {
        statusElement.textContent = chrome.i18n.getMessage('applyTagError', error.message);
    }
});

void loadPopup();
