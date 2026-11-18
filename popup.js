/**
 * Controls the extension popup: checks the active tab's domain, displays the
 * global last-access record, and opens saved URLs in the current or a new tab.
 */
const detectedTagElement = document.getElementById('detected-tag');
const tagSelect = document.getElementById('saved-tag');
const openCurrentTabButton = document.getElementById('open-current-tab-button');
const openNewTabButton = document.getElementById('open-new-tab-button');
const statusElement = document.getElementById('status');
let savedTags = [];

/**
 * Loads the active tab and saved records, displays the global last-access
 * record, displays the notification state, and populates the selector.
 * @returns {Promise<void>}
 */
async function loadPopup() {
    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const activeTab = tabs[0];
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
        tagSelect.dataset.tabId = Number.isInteger(activeTab?.id)
            ? String(activeTab.id)
            : '';

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
        statusElement.textContent = chrome.i18n.getMessage('popupLoadError');
        console.error(chrome.i18n.getMessage('popupLoadError'), error);
    }
}

/** Enables URL-opening buttons when the selected record has a valid URL. */
tagSelect.addEventListener('change', () => {
    const selected = savedTags.find((entry) => entry.tag === tagSelect.value);
    const canOpen = Boolean(selected && isValidAmazonTagUrl(selected.url, selected.tag));
    const hasTabId = tagSelect.dataset.tabId !== '' &&
        Number.isInteger(Number(tagSelect.dataset.tabId));
    openCurrentTabButton.disabled =
        !canOpen || !hasTabId;
    openNewTabButton.disabled = !canOpen;
});

/** Opens the selected saved URL and updates the global last-access record. */
async function openSelectedTag(openInNewTab) {
    const hasTabId = tagSelect.dataset.tabId !== '' &&
        Number.isInteger(Number(tagSelect.dataset.tabId));
    const tabId = hasTabId ? Number(tagSelect.dataset.tabId) : undefined;
    const selectedTag = tagSelect.value;
    const selected = savedTags.find((entry) => entry.tag === selectedTag);

    if (!selected || !isValidAmazonTagUrl(selected.url, selected.tag) ||
        (!openInNewTab && !hasTabId)) {
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
