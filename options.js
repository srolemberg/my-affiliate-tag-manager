/**
 * Controls the options page: keeps the local key list synchronized and allows
 * adding, editing, deleting, and importing/exporting saved tag records.
 * Mutations are sent to the service worker to serialize writes to
 * `chrome.storage.local`.
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

let savedTags = [];

/**
 * Sends an operation to the service worker and updates the displayed list.
 * @param {{type: string, [key: string]: any}} operation CRUD operation.
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
 * Renders the editing fields and actions for the saved keys.
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

        const actions = document.createElement('div');
        actions.className = 'tag-actions';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = chrome.i18n.getMessage('deleteButton');
        /** Confirms and requests deletion of this key. */
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
                    chrome.i18n.getMessage('deleteTagError', error.message);
            }
        });
        actions.append(deleteButton);
        item.append(fields, actions);
        tagList.append(item);
    }

    tagList.querySelectorAll('input').forEach(
        /** Recalculates the button state when any field is edited. */
        (input) => {
            input.addEventListener('input', updateSaveButtonState);
        },
    );
    tagList.querySelectorAll('.tag-url-input').forEach((input) => {
        input.addEventListener('input', () => {
            const keyDisplay = input.closest('li').querySelector('.tag-key-display');
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
 * Reads unsaved changes from the list fields.
 * @returns {{oldTag: string, tag: string, description: string, url: string}[]} Pending changes.
 */
function getPendingUpdates() {
    return [...tagList.querySelectorAll('li')]
        .map(
            /** Converts an item's fields into an update. */
            (item) => {
            const [descriptionInput, urlInput] = item.querySelectorAll('input');
            if (!descriptionInput || !urlInput) {
                return null;
            }

            return {
                oldTag: item.dataset.originalTag,
                tag: getTagFromAmazonUrl(urlInput.value),
                description: descriptionInput.value.trim(),
                originalDescription: descriptionInput.dataset.originalDescription,
                url: urlInput.value.trim(),
                originalUrl: urlInput.dataset.originalUrl,
            };
            },
        )
        .filter(
            /** Discards unchanged items and items without editable fields. */
            (entry) => entry && (
                entry.tag !== entry.oldTag ||
                entry.description !== entry.originalDescription ||
                entry.url !== entry.originalUrl
            ),
        )
        .map(
            /** Returns only the data needed to persist the update. */
            ({oldTag, tag, description, url}) => ({oldTag, tag, description, url}),
        );
}

/** Validates edited URLs and enables saving only for unique valid updates. */
function updateSaveButtonState() {
    const urlInputs = [...tagList.querySelectorAll('.tag-url-input')];
    const errors = getTagUrlValidationErrors(urlInputs.map((input) => ({
        originalTag: input.dataset.originalTag,
        originalUrl: input.dataset.originalUrl,
        url: input.value,
    })));
    let hasInvalidUpdate = false;
    for (const [index, input] of urlInputs.entries()) {
        const validationError = errors[index];
        const error = validationError?.type === 'invalid'
            ? chrome.i18n.getMessage('invalidAmazonTagUrl')
            : validationError?.type === 'duplicate'
                ? chrome.i18n.getMessage(
                    'duplicateTagAddError',
                    validationError.tag,
                )
                : '';
        const errorElement = input
            .closest('label')
            .querySelector('.tag-url-error');
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

/**
 * Loads the keys initially displayed on the options page from local storage.
 * @returns {Promise<void>}
 */
async function loadTags() {
    try {
        const stored = await chrome.storage.local.get('savedTags');
        savedTags = normalizeTagEntries(stored.savedTags);
        renderTags();
    } catch (error) {
        statusElement.textContent =
            chrome.i18n.getMessage('loadTagsError', error.message);
    }
}

/** Validates the add URL and blocks invalid or duplicate keys. */
function updateAddFormState() {
    const url = newUrlInput.value.trim();
    const tag = getTagFromAmazonUrl(newUrlInput.value);
    const validUrl = isValidAmazonTagUrl(url, tag);
    const duplicate = hasTagEntry(tag, savedTags);
    addButton.disabled = !validUrl || duplicate;
    addError.textContent = duplicate
        ? chrome.i18n.getMessage('duplicateTagAddError', tag)
        : url && !validUrl
            ? chrome.i18n.getMessage('invalidAmazonTagUrl')
            : '';
}

/** Validates and adds a tag and its original Amazon URL. */
addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = newUrlInput.value.trim();
    const tag = getTagFromAmazonUrl(url);
    updateAddFormState();
    if (hasTagEntry(tag, savedTags)) {
        return;
    }

    if (!isValidAmazonTagUrl(url, tag)) {
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
            chrome.i18n.getMessage('addTagError', error.message);
    }
});

newUrlInput.addEventListener('input', () => {
    const tag = getTagFromAmazonUrl(newUrlInput.value);
    newTagPreview.textContent = tag
        ? chrome.i18n.getMessage('currentKeyLabel', tag)
        : '';
    updateAddFormState();
});

/** Persists all pending edits in a single operation. */
saveTagsButton.addEventListener('click', async () => {
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
            chrome.i18n.getMessage('saveChangesError', error.message);
    }
});

/** Requests two confirmations before deleting all keys. */
deleteAllButton.addEventListener('click', async () => {
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
            chrome.i18n.getMessage('deleteAllError', error.message);
    }
});

/** Generates and downloads a JSON file containing all keys and descriptions. */
exportButton.addEventListener('click', () => {
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
        /** Releases the temporary URL after the download starts. */
        () => URL.revokeObjectURL(downloadUrl),
        1000,
    );
    statusElement.textContent = chrome.i18n.getMessage('exportedJson');
});

/** Validates and merges the keys selected in a JSON file. */
importFileInput.addEventListener('change', async () => {
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
                /** Rejects invalid records or fields with incorrect types. */
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
        const message = error instanceof Error ? error.message : String(error);
        statusElement.textContent =
            chrome.i18n.getMessage('importFileError', message);
    } finally {
        importFileInput.value = '';
    }
});

/** Updates the list when another part of the extension changes storage. */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.savedTags) {
        savedTags = normalizeTagEntries(changes.savedTags.newValue);
        updateAddFormState();
        if (getPendingUpdates().length === 0) {
            renderTags();
        } else {
            updateSaveButtonState();
        }
    }
});

void loadTags();
