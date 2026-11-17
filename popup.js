/**
 * Controls the extension popup: validates the active tab's domain, displays
 * last-access time, and opens a saved tag's captured URL in the current or a
 * new tab.
 */
const detectedTagElement = document.getElementById('detected-tag');
const tagSelect = document.getElementById('saved-tag');
const openCurrentTabButton = document.getElementById('open-current-tab-button');
const openNewTabButton = document.getElementById('open-new-tab-button');
const statusElement = document.getElementById('status');
const tagForm = document.getElementById('tag-form');
const amazonContent = document.getElementById('amazon-content');
const domainMessage = document.getElementById('domain-message');
let savedTags = [];

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

        const stored = await chrome.storage.local.get([
            'savedTags',
            'lastAccessedTag',
        ]);
        savedTags = normalizeTagEntries(stored.savedTags);
        let lastAccessedTag = stored.lastAccessedTag;
        if (
            !lastAccessedTag ||
            typeof lastAccessedTag.tag !== 'string' ||
            typeof lastAccessedTag.lastAccessed !== 'string' ||
            Number.isNaN(Date.parse(lastAccessedTag.lastAccessed))
        ) {
            lastAccessedTag = getLatestAccessRecord(stored.savedTags);
            if (lastAccessedTag) {
                await chrome.storage.local.set({
                    savedTags,
                    lastAccessedTag,
                });
            }
        }

        if (lastAccessedTag) {
            const accessedDate = new Date(lastAccessedTag.lastAccessed);
            const date = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'short',
            }).format(accessedDate);
            const time = new Intl.DateTimeFormat(undefined, {
                timeStyle: 'medium',
            }).format(accessedDate);
            detectedTagElement.textContent = chrome.i18n.getMessage(
                'lastAccessedTagValue',
                [lastAccessedTag.tag, date, time],
            );
        } else {
            detectedTagElement.textContent = chrome.i18n.getMessage('noAccessRecorded');
        }
        tagForm.dataset.tabId = String(activeTab.id);

        for (const entry of savedTags) {
            const option = document.createElement('option');
            option.value = entry.tag;
            option.textContent = entry.description || entry.tag;
            option.disabled = !isValidAmazonTagUrl(entry.url, entry.tag);
            tagSelect.append(option);
        }
        tagSelect.value = '';
        openCurrentTabButton.disabled = true;
        openNewTabButton.disabled = true;

        if (savedTags.length === 0) {
            statusElement.textContent = chrome.i18n.getMessage('addTagInSettings');
        } else if (!savedTags.some((entry) => isValidAmazonTagUrl(entry.url, entry.tag))) {
            statusElement.textContent = chrome.i18n.getMessage('savedUrlRequired');
        }
    } catch (error) {
        amazonContent.hidden = true;
        domainMessage.textContent = chrome.i18n.getMessage('invalidDomainValidation');
        domainMessage.hidden = false;
        console.error(chrome.i18n.getMessage('popupLoadError'), error);
    }
}

/** Updates both open buttons when a saved tag is selected. */
tagSelect.addEventListener('change', () => {
    const selected = savedTags.find((entry) => entry.tag === tagSelect.value);
    const canOpen = Boolean(selected && isValidAmazonTagUrl(selected.url, selected.tag));
    openCurrentTabButton.disabled = !canOpen;
    openNewTabButton.disabled = !canOpen;
});

/** Opens the selected record's captured URL and records the access time. */
async function openSelectedTag(openInNewTab) {
    const tabId = Number(tagForm.dataset.tabId);
    const selectedTag = tagSelect.value;
    const selected = savedTags.find((entry) => entry.tag === selectedTag);

    if (!selected || !isValidAmazonTagUrl(selected.url, selected.tag) ||
        (!openInNewTab && !Number.isInteger(tabId))) {
        statusElement.textContent = chrome.i18n.getMessage('selectValidTag');
        return;
    }

    try {
        if (openInNewTab) {
            await chrome.tabs.create({url: selected.url});
        } else {
            await chrome.tabs.update(tabId, {url: selected.url});
        }

        const response = await chrome.runtime.sendMessage({
            type: 'tags:mutate',
            operation: {type: 'access', tag: selected.tag},
        });
        if (response?.error) {
            throw new Error(response.error);
        }
        if (!response || !Array.isArray(response.tags)) {
            throw new Error(chrome.i18n.getMessage('serviceWorkerInvalidResponse'));
        }
        window.close();
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('openSavedUrlError', error.message);
    }
}

openCurrentTabButton.addEventListener('click', () => {
    void openSelectedTag(false);
});
openNewTabButton.addEventListener('click', () => {
    void openSelectedTag(true);
});

void loadPopup();
