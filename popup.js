/**
 * Controls the extension popup: displays the global last-access record and
 * opens saved URLs in the current tab or a new tab.
 */
const detectedTagElement = document.getElementById('detected-tag');
const tagSelect = document.getElementById('saved-tag');
const openCurrentTabButton = document.getElementById('open-current-tab-button');
const openNewTabButton = document.getElementById('open-new-tab-button');
const statusElement = document.getElementById('status');
const popupElements = {
    'detected-tag': detectedTagElement,
    'saved-tag': tagSelect,
    'open-current-tab-button': openCurrentTabButton,
    'open-new-tab-button': openNewTabButton,
    status: statusElement,
};
const popupReady = Object.values(popupElements).every(Boolean);
let savedTags = [];

if (!popupReady) {
    const missingElements = Object.entries(popupElements)
        .filter(([, element]) => !element)
        .map(([id]) => `#${id}`);
    console.error(`Popup is missing required elements: ${missingElements.join(', ')}`);
}

/** Updates the popup status only when its optional status node exists. */
function setPopupStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

/**
 * Loads saved records, displays the global last-access record, and populates
 * the selector. No active-tab data is required for rendering saved entries.
 * @returns {Promise<void>}
 */
async function loadPopup() {
    if (!popupReady) {
        return;
    }

    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const activeTab = tabs?.[0];
        const stored = await chrome.storage.local.get([
            'savedTags',
            'lastAccessedTag',
        ]);
        savedTags = normalizeTagEntries(stored?.savedTags);
        let lastAccessedTag = stored?.lastAccessedTag;
        if (
            !lastAccessedTag ||
            typeof lastAccessedTag.tag !== 'string' ||
            !lastAccessedTag.tag.trim() ||
            typeof lastAccessedTag.lastAccessed !== 'string' ||
            Number.isNaN(Date.parse(lastAccessedTag.lastAccessed))
        ) {
            lastAccessedTag = getLatestAccessRecord(stored?.savedTags);
            if (lastAccessedTag) {
                await chrome.storage.local.set({
                    savedTags,
                    lastAccessedTag,
                });
            }
        }

        if (lastAccessedTag) {
            lastAccessedTag = {
                ...lastAccessedTag,
                tag: lastAccessedTag.tag.trim(),
            };
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
        setPopupStatus(chrome.i18n.getMessage('popupLoadError'));
        console.error(chrome.i18n.getMessage('popupLoadError'), error);
    }
}

/** Enables URL-opening buttons when the selected record has a valid URL. */
tagSelect?.addEventListener('change', () => {
    const selected = savedTags.find((entry) => entry.tag === tagSelect.value);
    const canOpen = Boolean(selected && isValidAmazonTagUrl(selected.url, selected.tag));
    const hasTabId = tagSelect.dataset.tabId !== '' &&
        Number.isInteger(Number(tagSelect.dataset.tabId));
    if (openCurrentTabButton) {
        openCurrentTabButton.disabled = !canOpen || !hasTabId;
    }
    if (openNewTabButton) {
        openNewTabButton.disabled = !canOpen;
    }
});

/** Opens the selected saved URL and updates the global last-access record. */
async function openSelectedTag(openInNewTab) {
    if (!tagSelect) {
        setPopupStatus(chrome.i18n.getMessage('selectValidTag'));
        return;
    }

    const hasTabId = tagSelect.dataset.tabId !== '' &&
        Number.isInteger(Number(tagSelect.dataset.tabId));
    const tabId = hasTabId ? Number(tagSelect.dataset.tabId) : undefined;
    const selectedTag = tagSelect.value;
    const selected = savedTags.find((entry) => entry.tag === selectedTag);

    if (!selected || !isValidAmazonTagUrl(selected.url, selected.tag) ||
        (!openInNewTab && !hasTabId)) {
        setPopupStatus(chrome.i18n.getMessage('selectValidTag'));
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
        setPopupStatus(
            chrome.i18n.getMessage('openSavedUrlError', getErrorMessage(error)),
        );
    }
}

openCurrentTabButton?.addEventListener('click', () => {
    void openSelectedTag(false);
});
openNewTabButton?.addEventListener('click', () => {
    void openSelectedTag(true);
});

if (popupReady) {
    void loadPopup();
}
