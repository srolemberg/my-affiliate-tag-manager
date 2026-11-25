/**
 * Controls the extension popup: displays the global last-access record,
 * presents saved tags in an accessible button menu, and opens saved URLs.
 */
const lastAccessAvatar = document.getElementById('last-access-avatar');
const lastAccessTitle = document.getElementById('last-access-title');
const lastAccessSubtitle = document.getElementById('last-access-subtitle');
const tagButton = document.getElementById('saved-tag-button');
const tagButtonLabel = document.getElementById('saved-tag-button-label');
const tagMenu = document.getElementById('saved-tag-menu');
const tagPicker = document.querySelector?.('.tag-picker') || null;
const openCurrentTabButton = document.getElementById('open-current-tab-button');
const openNewTabButton = document.getElementById('open-new-tab-button');
const openSettingsButton = document.getElementById('open-settings-button');
const statusElement = document.getElementById('status');
const popupElements = {
    'last-access-avatar': lastAccessAvatar,
    'last-access-title': lastAccessTitle,
    'last-access-subtitle': lastAccessSubtitle,
    'saved-tag-button': tagButton,
    'saved-tag-button-label': tagButtonLabel,
    'saved-tag-menu': tagMenu,
    'open-current-tab-button': openCurrentTabButton,
    'open-new-tab-button': openNewTabButton,
    'open-settings-button': openSettingsButton,
    status: statusElement,
};
const popupReady = Object.values(popupElements).every(Boolean);
let savedTags = [];
let selectedTag = '';

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
            const savedTag = savedTags.find(
                (entry) => entry.tag === lastAccessedTag.tag,
            );
            lastAccessTitle.textContent = lastAccessedTag.tag;
            lastAccessSubtitle.textContent = chrome.i18n.getMessage(
                'lastAccessedDetails',
                [date, time],
            );
            lastAccessAvatar.textContent = (
                savedTag?.description || lastAccessedTag.tag
            ).trim().charAt(0).toLocaleUpperCase();
        } else {
            lastAccessTitle.textContent = chrome.i18n.getMessage('noAccessTagTitle');
            lastAccessSubtitle.textContent = chrome.i18n.getMessage('noAccessRecorded');
            lastAccessAvatar.textContent = '';
        }
        tagButton.dataset.tabId = Number.isInteger(activeTab?.id)
            ? String(activeTab.id)
            : '';

        for (const entry of savedTags) {
            const option = document.createElement('button');
            option.className = 'saved-tag-option';
            option.type = 'button';
            option.dataset.tag = entry.tag;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.textContent = entry.description || entry.tag;
            option.disabled = !isValidAmazonTagUrl(entry.url, entry.tag);
            tagMenu.append(option);
        }
        tagButtonLabel.textContent = chrome.i18n.getMessage('selectTag');
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

/** Updates the trigger label, listbox selection, and URL-opening button states. */
function selectSavedTag(tag) {
    const selected = savedTags.find((entry) => entry.tag === tag);
    if (!selected) {
        return;
    }

    selectedTag = selected.tag;
    tagButtonLabel.textContent = selected.description || selected.tag;
    for (const option of tagMenu.querySelectorAll('[role="option"]')) {
        option.setAttribute(
            'aria-selected',
            String(option.dataset.tag === selectedTag),
        );
    }
    closeTagMenu();

    const canOpen = Boolean(selected && isValidAmazonTagUrl(selected.url, selected.tag));
    const hasTabId = tagButton.dataset.tabId !== '' &&
        Number.isInteger(Number(tagButton.dataset.tabId));
    if (openCurrentTabButton) {
        openCurrentTabButton.disabled = !canOpen || !hasTabId;
    }
    if (openNewTabButton) {
        openNewTabButton.disabled = !canOpen;
    }
    tagButton.focus();
}

/** Shows or hides the saved-tag listbox and updates the trigger state. */
function setTagMenuOpen(open) {
    if (!tagMenu || !tagButton) {
        return;
    }
    tagMenu.hidden = !open;
    tagButton.setAttribute('aria-expanded', String(open));
}

function closeTagMenu() {
    setTagMenuOpen(false);
}

function toggleTagMenu() {
    setTagMenuOpen(tagMenu?.hidden ?? true);
}

function focusMenuOption(index) {
    const options = [...tagMenu.querySelectorAll('[role="option"]:not(:disabled)')];
    if (options.length === 0) {
        return;
    }
    options[Math.max(0, Math.min(index, options.length - 1))].focus();
}

tagButton?.addEventListener('click', () => {
    toggleTagMenu();
    if (!tagMenu.hidden) {
        focusMenuOption(0);
    }
});
tagMenu?.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && !option.disabled) {
        selectSavedTag(option.dataset.tag);
    }
});
tagMenu?.addEventListener('keydown', (event) => {
    const options = [...tagMenu.querySelectorAll('[role="option"]:not(:disabled)')];
    const currentIndex = options.indexOf(event.target);
    let nextIndex;
    if (event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
        nextIndex = 0;
    } else if (event.key === 'End') {
        nextIndex = options.length - 1;
    } else if (event.key === 'Escape') {
        event.preventDefault();
        closeTagMenu();
        tagButton.focus();
        return;
    } else {
        return;
    }
    event.preventDefault();
    options[nextIndex]?.focus();
});
document.addEventListener?.('click', (event) => {
    if (tagPicker && !tagPicker.contains(event.target)) {
        closeTagMenu();
    }
});

/** Opens the selected saved URL and updates the global last-access record. */
async function openSelectedTag(openInNewTab) {
    if (!tagButton) {
        setPopupStatus(chrome.i18n.getMessage('selectValidTag'));
        return;
    }

    const hasTabId = tagButton.dataset.tabId !== '' &&
        Number.isInteger(Number(tagButton.dataset.tabId));
    const tabId = hasTabId ? Number(tagButton.dataset.tabId) : undefined;
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
openSettingsButton?.addEventListener('click', async () => {
    try {
        await chrome.runtime.openOptionsPage();
    } catch (error) {
        const message = chrome.i18n.getMessage('openSettingsError');
        setPopupStatus(message);
        console.error(message, error);
    }
});

if (popupReady) {
    void loadPopup();
}
