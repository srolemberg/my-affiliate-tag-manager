/**
 * Controls tag management: renders saved records and handles add, edit, delete,
 * import, and export actions. Mutations go through the service worker to
 * serialize writes to `chrome.storage.local`.
 */
const tagList = document.getElementById('tag-list');
const addForm = document.getElementById('add-form');
const newDescriptionInput = document.getElementById('new-description');
const newUrlInput = document.getElementById('new-url');
const newTagPreview = document.getElementById('new-tag-preview');
const addError = document.getElementById('add-error');
const addButton = document.getElementById('add-button');
const importFileInput = document.getElementById('import-file');
const statusElement = document.getElementById('status');
const saveTagsButton = document.getElementById('save-tags-button');
const exportButton = document.getElementById('export-button');
const deleteAllButton = document.getElementById('delete-all-button');
const themeSystemInput = document.getElementById('theme-system');
const themeLightInput = document.getElementById('theme-light');
const themeDarkInput = document.getElementById('theme-dark');

const optionsElements = {
    'tag-list': tagList,
    'add-form': addForm,
    'new-description': newDescriptionInput,
    'new-url': newUrlInput,
    'new-tag-preview': newTagPreview,
    'add-error': addError,
    'add-button': addButton,
    'import-file': importFileInput,
    status: statusElement,
    'save-tags-button': saveTagsButton,
    'export-button': exportButton,
    'delete-all-button': deleteAllButton,
    'theme-system': themeSystemInput,
    'theme-light': themeLightInput,
    'theme-dark': themeDarkInput,
};
const optionsReady = Object.values(optionsElements).every(Boolean);
const themePreferenceInputs = [
    themeSystemInput,
    themeLightInput,
    themeDarkInput,
];
let savedThemePreference = 'system';
let themePreferenceRevision = 0;
let savedTags = [];

if (!optionsReady) {
    const missingElements = Object.entries(optionsElements)
        .filter(([, element]) => !element)
        .map(([id]) => `#${id}`);
    console.error(`Options page is missing required elements: ${missingElements.join(', ')}`);
}

/**
 * Registers a page listener only after all required page controls are present.
 * @param {Element|null} element Event target.
 * @param {string} type Event name.
 * @param {EventListener} listener Event handler.
 */
function listenOnOptionsPage(element, type, listener) {
    if (optionsReady && element) {
        element.addEventListener(type, listener);
    }
}

/**
 * Sends a saved-tag operation to the service worker and refreshes the list.
 * @param {{type: string, [key: string]: any}} operation Mutation to perform.
 * @returns {Promise<void>}
 */
async function mutateTags(operation) {
    const response = await chrome.runtime.sendMessage({
        type: 'tags:mutate',
        operation,
    });
    if (response?.error) {
        throw new Error(response.error);
    }
    if (!response || !Array.isArray(response.tags)) {
        throw new Error(chrome.i18n.getMessage('serviceWorkerInvalidResponse'));
    }

    savedTags = normalizeTagEntries(response.tags);
    renderTags();
}

/**
 * Renders saved records, their editable fields, and available actions.
 */
function renderTags() {
    tagList.replaceChildren();
    saveTagsButton.disabled = true;
    exportButton.disabled = savedTags.length === 0;
    deleteAllButton.disabled = savedTags.length === 0;
    updateAddFormState();

    if (savedTags.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.textContent = chrome.i18n.getMessage('noSavedTags');
        tagList.append(emptyItem);
        return;
    }

    for (const entry of savedTags) {
        const item = document.createElement('li');
        const fields = document.createElement('div');
        fields.className = 'tag-fields';

        item.dataset.originalTag = entry.tag;
        const tagLabel = document.createElement('div');
        tagLabel.className = 'tag-key-display';
        tagLabel.textContent = chrome.i18n.getMessage('currentKeyLabel', entry.tag);

        const descriptionLabel = document.createElement('label');
        descriptionLabel.textContent =
            chrome.i18n.getMessage(
                'currentDescriptionLabel',
                entry.description || chrome.i18n.getMessage('undefinedDescription'),
            );
        const descriptionInput = document.createElement('input');
        descriptionInput.value = entry.description;
        descriptionInput.dataset.originalDescription = entry.description;
        descriptionInput.setAttribute(
            'aria-label',
            chrome.i18n.getMessage(
                'editDescriptionAriaLabel',
                entry.description || entry.tag,
            ),
        );
        descriptionLabel.append(descriptionInput);
        const urlLabel = document.createElement('label');
        urlLabel.className = 'tag-url-field';
        urlLabel.textContent = chrome.i18n.getMessage('originalUrlLabel');
        const urlInput = document.createElement('input');
        urlInput.className = 'tag-url-input';
        urlInput.type = 'url';
        urlInput.required = true;
        urlInput.value = entry.url;
        urlInput.dataset.originalUrl = entry.url;
        urlInput.dataset.originalTag = entry.tag;
        urlInput.setAttribute(
            'aria-label',
            chrome.i18n.getMessage('editOriginalUrlAriaLabel', entry.tag),
        );
        const urlError = document.createElement('output');
        urlError.className = 'tag-url-error';
        urlError.setAttribute('aria-live', 'polite');
        urlLabel.append(urlInput, urlError);
        fields.append(tagLabel, descriptionLabel, urlLabel);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = chrome.i18n.getMessage('deleteButton');
        /** Confirms the request before deleting this record. */
        deleteButton.addEventListener('click', async () => {
            if (!window.confirm(
                chrome.i18n.getMessage('confirmDeleteTag', entry.tag),
            )) {
                return;
            }

            try {
                await mutateTags({type: 'delete', tag: entry.tag});
                statusElement.textContent = chrome.i18n.getMessage('tagDeleted');
            } catch (error) {
                statusElement.textContent =
                    chrome.i18n.getMessage('deleteTagError', getErrorMessage(error));
            }
        });
        item.append(fields, deleteButton);
        tagList.append(item);
    }

    tagList.querySelectorAll('input').forEach(
        /** Rechecks pending edits whenever a field changes. */
        (input) => {
            input.addEventListener('input', updateSaveButtonState);
        },
    );
    tagList.querySelectorAll('.tag-url-input').forEach((input) => {
        input.addEventListener('input', () => {
            const keyDisplay = input.closest('li')?.querySelector('.tag-key-display');
            if (!keyDisplay) {
                console.error('Could not find the tag key display for an edited URL.');
                updateSaveButtonState();
                return;
            }
            const tag = getTagFromAmazonUrl(input.value);
            keyDisplay.textContent = chrome.i18n.getMessage(
                'currentKeyLabel',
                tag || chrome.i18n.getMessage('invalidTagUrlKey'),
            );
            updateSaveButtonState();
        });
    });
    updateSaveButtonState();
}

/**
 * Collects changed record fields and derives each key from its URL.
 * @returns {{oldTag: string, tag: string, description: string, url: string}[]} Pending updates.
 */
function getPendingUpdates() {
    return [...tagList.querySelectorAll('li')]
        .map(
            /** Converts one list item into an update object. */
            (item) => {
                const [descriptionInput, urlInput] = item.querySelectorAll('input');
                if (!descriptionInput || !urlInput) {
                    return null;
                }

                return {
                    oldTag: item.dataset?.originalTag || '',
                    tag: getTagFromAmazonUrl(urlInput.value),
                    description: descriptionInput.value.trim(),
                    originalDescription: descriptionInput.dataset.originalDescription,
                    url: urlInput.value.trim(),
                    originalUrl: urlInput.dataset.originalUrl,
                };
            },
        )
        .filter(
            /** Excludes unchanged items and items without the expected inputs. */
            (entry) => entry && (
                entry.tag !== entry.oldTag ||
                entry.description !== entry.originalDescription ||
                entry.url !== entry.originalUrl
            ),
        )
        .map(
            /** Removes UI-only fields before sending the updates. */
            ({oldTag, tag, description, url}) => ({oldTag, tag, description, url}),
        );
}

/** Shows per-field URL errors and enables saving only for valid unique edits. */
function updateSaveButtonState() {
    const urlInputs = [...tagList.querySelectorAll('.tag-url-input')];
    const errors = getTagUrlValidationErrors(urlInputs.map((input) => ({
        originalTag: input.dataset.originalTag,
        originalUrl: input.dataset.originalUrl,
        url: input.value,
    })));
    let hasInvalidUpdate = false;
    for (const [index, input] of urlInputs.entries()) {
        const error = getTagUrlValidationMessage(errors[index]);
        const errorElement = input
            .closest('label')
            ?.querySelector('.tag-url-error');
        if (!errorElement) {
            console.error('Could not find the validation message for a tag URL.');
            input.setAttribute('aria-invalid', 'true');
            hasInvalidUpdate = true;
            continue;
        }
        errorElement.textContent = error;
        if (error) {
            input.setAttribute('aria-invalid', 'true');
            hasInvalidUpdate = true;
        } else {
            input.removeAttribute('aria-invalid');
        }
    }

    saveTagsButton.disabled =
        getPendingUpdates().length === 0 || hasInvalidUpdate;
}

/** Returns the localized message for a tag URL validation error. */
function getTagUrlValidationMessage(error) {
    if (error?.type === 'invalid') {
        return chrome.i18n.getMessage('invalidAmazonTagUrl');
    }
    if (error?.type === 'duplicate') {
        return chrome.i18n.getMessage('duplicateTagError', error.tag);
    }
    return '';
}

/** Validates the add URL against saved keys using the shared URL validator. */
function getAddFormUrlValidationError(url) {
    const entries = savedTags.map(({tag, url: originalUrl}) => ({
        originalTag: tag,
        originalUrl,
        url: originalUrl,
    }));
    entries.push({url, originalUrl: '', originalTag: '', validate: true});
    return getTagUrlValidationErrors(entries).at(-1);
}

/**
 * Loads saved tag records from local storage and renders the options page.
 * @returns {Promise<void>}
 */
async function loadTags() {
    if (!optionsReady) {
        return;
    }

    try {
        const stored = await chrome.storage.local.get('savedTags');
        savedTags = normalizeTagEntries(stored.savedTags);
        renderTags();
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('loadTagsError', getErrorMessage(error));
    }
}

/** Displays add-form URL errors and blocks invalid or duplicate keys. */
function updateAddFormState() {
    const url = newUrlInput.value.trim();
    const validationError = getAddFormUrlValidationError(url);
    addButton.disabled = Boolean(validationError);
    addError.textContent = url ? getTagUrlValidationMessage(validationError) : '';
}

/** Loads and selects the stored theme preference. */
function selectThemePreference(preference) {
    savedThemePreference = ['system', 'light', 'dark'].includes(preference)
        ? preference
        : 'system';
    const selectedInput = themePreferenceInputs.find(
        (input) => input.value === savedThemePreference,
    );
    if (!selectedInput) {
        throw new Error('Could not find the matching theme preference control.');
    }
    selectedInput.checked = true;
}

async function loadThemePreference() {
    const revision = themePreferenceRevision;
    try {
        const stored = await chrome.storage.local.get('themePreference');
        if (revision !== themePreferenceRevision) {
            return;
        }
        selectThemePreference(stored?.themePreference);
    } catch (error) {
        statusElement.textContent = chrome.i18n.getMessage(
            'themePreferenceLoadError',
            getErrorMessage(error),
        );
    }
}

/** Persists the selected theme for every extension page. */
themePreferenceInputs.forEach((input) => {
    listenOnOptionsPage(input, 'change', async () => {
        if (!input.checked) {
            return;
        }

        themePreferenceRevision += 1;
        try {
            await chrome.storage.local.set({themePreference: input.value});
            savedThemePreference = input.value;
            statusElement.textContent = '';
        } catch (error) {
            const previousInput = themePreferenceInputs.find(
                (candidate) => candidate.value === savedThemePreference,
            );
            if (previousInput) {
                previousInput.checked = true;
            }
            statusElement.textContent = chrome.i18n.getMessage(
                'themePreferenceSaveError',
                getErrorMessage(error),
            );
        }
    });
});

/** Validates the source URL and adds its derived key and optional description. */
listenOnOptionsPage(addForm, 'submit', async (event) => {
    event.preventDefault();
    const url = newUrlInput.value.trim();
    const tag = getTagFromAmazonUrl(url);
    updateAddFormState();
    if (getAddFormUrlValidationError(url)) {
        return;
    }

    if (!tag) {
        statusElement.textContent = chrome.i18n.getMessage('invalidAmazonTagUrl');
        return;
    }

    try {
        await mutateTags({
            type: 'add',
            tags: [{
                tag,
                description: newDescriptionInput.value.trim(),
                url,
            }],
        });
        newDescriptionInput.value = '';
        newUrlInput.value = '';
        newTagPreview.textContent = '';
        updateAddFormState();
        statusElement.textContent = chrome.i18n.getMessage('tagAdded');
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('addTagError', getErrorMessage(error));
    }
});

listenOnOptionsPage(newUrlInput, 'input', () => {
    const tag = getTagFromAmazonUrl(newUrlInput.value);
    newTagPreview.textContent = tag
        ? chrome.i18n.getMessage('currentKeyLabel', tag)
        : '';
    updateAddFormState();
});

/** Sends all pending record edits as one service-worker operation. */
listenOnOptionsPage(saveTagsButton, 'click', async () => {
    updateSaveButtonState();
    const updates = getPendingUpdates();
    if (saveTagsButton.disabled || updates.length === 0) {
        return;
    }

    try {
        await mutateTags({type: 'updateMany', updates});
        statusElement.textContent = chrome.i18n.getMessage('changesSaved');
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('saveChangesError', getErrorMessage(error));
    }
});

/** Requires two confirmations before deleting every saved record. */
listenOnOptionsPage(deleteAllButton, 'click', async () => {
    if (savedTags.length === 0) {
        return;
    }

    if (!window.confirm(chrome.i18n.getMessage('confirmDeleteAll'))) {
        return;
    }

    if (!window.confirm(chrome.i18n.getMessage('confirmDeleteAllWarning'))) {
        return;
    }

    try {
        await mutateTags({type: 'deleteAll'});
        statusElement.textContent = chrome.i18n.getMessage('allTagsDeleted');
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('deleteAllError', getErrorMessage(error));
    }
});

/** Exports saved records as a versioned JSON file. */
listenOnOptionsPage(exportButton, 'click', () => {
    if (savedTags.length === 0) {
        return;
    }

    const exportTags = savedTags.map(({tag, description, url}) => ({
        tag,
        description,
        url,
    }));
    const json = JSON.stringify({version: 1, tags: exportTags}, null, 2);
    const file = new Blob([json], {type: 'application/json'});
    const downloadUrl = URL.createObjectURL(file);
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = chrome.i18n.getMessage('exportFileName');
    downloadLink.click();
    setTimeout(
        /** Revokes the temporary download URL after the download begins. */
        () => URL.revokeObjectURL(downloadUrl),
        1000,
    );
    statusElement.textContent = chrome.i18n.getMessage('exportedJson');
});

/** Validates a JSON file and merges its records with the saved list. */
listenOnOptionsPage(importFileInput, 'change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) {
        return;
    }

    try {
        if (typeof file.text !== 'function') {
            throw new Error(chrome.i18n.getMessage('fileReadError'));
        }

        const imported = JSON.parse(await file.text());
        const entries = Array.isArray(imported)
            ? imported
            : imported && typeof imported === 'object'
                ? imported.tags
                : undefined;
        if (
            !Array.isArray(entries) ||
            entries.length === 0 ||
            entries.some(
                /** Rejects malformed records, field types, and supplied URLs. */
                (entry) => {
                    if (typeof entry === 'string') {
                        return !entry.trim();
                    }
                    return (
                        !entry ||
                        typeof entry !== 'object' ||
                        Array.isArray(entry) ||
                        typeof entry.tag !== 'string' ||
                        !entry.tag.trim() ||
                        (entry.description !== undefined &&
                            typeof entry.description !== 'string') ||
                        (entry.url !== undefined &&
                            typeof entry.url !== 'string') ||
                        (entry.url &&
                            !isValidAmazonTagUrl(entry.url, entry.tag))
                    );
                },
            )
        ) {
            throw new Error(
                chrome.i18n.getMessage('invalidJsonTags'),
            );
        }

        await mutateTags({
            type: 'merge',
            tags: entries.map((entry) => (
                typeof entry === 'string'
                    ? entry
                    : {
                        tag: entry.tag,
                        description: entry.description,
                        url: entry.url,
                    }
            )),
        });
        statusElement.textContent = chrome.i18n.getMessage('importedTags');
    } catch (error) {
        const message = getErrorMessage(error);
        statusElement.textContent =
            chrome.i18n.getMessage('importFileError', message);
    } finally {
        importFileInput.value = '';
    }
});

/** Synchronizes the page when another extension component updates storage. */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!optionsReady || areaName !== 'local') {
        return;
    }
    if (changes?.themePreference) {
        themePreferenceRevision += 1;
        try {
            selectThemePreference(changes.themePreference.newValue);
        } catch (error) {
            statusElement.textContent = chrome.i18n.getMessage(
                'themePreferenceLoadError',
                getErrorMessage(error),
            );
        }
    }
    if (changes?.savedTags) {
        savedTags = normalizeTagEntries(changes.savedTags.newValue);
        updateAddFormState();
        if (getPendingUpdates().length === 0) {
            renderTags();
        } else {
            updateSaveButtonState();
        }
    }
});

if (optionsReady) {
    void loadTags();
    void loadThemePreference();
}
