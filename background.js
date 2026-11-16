/**
 * Extension service worker: monitors navigation on Amazon domains, records
 * `tag` parameter values, and updates the badge. Persists keys and descriptions
 * in `chrome.storage.local` and handles CRUD operations from the options page.
 * Each saved record has the `{ tag, description }` format.
 */
importScripts('tag-utils.js');

const TAG_STORAGE_KEY = 'savedTags';
let latestUpdate = 0;
let tagMutationQueue = Promise.resolve();

/**
 * Merges records, preserving existing descriptions when incoming ones are empty.
 * @param {Array<string|{tag: string, description?: string}>} existingEntries Current records.
 * @param {Array<string|{tag: string, description?: string}>} incomingEntries Incoming records.
 * @returns {{tag: string, description: string}[]} Merged records.
 */
function mergeTagEntries(existingEntries, incomingEntries) {
    const mergedEntries = new Map(
        normalizeTagEntries(existingEntries).map(
            /** Indexes existing records by key. */
            (entry) => [entry.tag, entry],
        ),
    );

    for (const entry of normalizeTagEntries(incomingEntries)) {
        const existing = mergedEntries.get(entry.tag);
        mergedEntries.set(entry.tag, {
            tag: entry.tag,
            description: entry.description || existing?.description || '',
        });
    }

    return [...mergedEntries.values()];
}

/**
 * Runs CRUD operations sequentially and persists the updated records.
 * @param {{type: string, [key: string]: any}} operation Requested operation.
 * @returns {Promise<{tag: string, description: string}[]>} Persisted list.
 */
function mutateStoredTags(operation) {
    const pendingMutation = tagMutationQueue.then(
        /** Applies the mutation after previous operations have completed. */
        async () => {
            const stored = await chrome.storage.local.get(TAG_STORAGE_KEY);
            const tags = normalizeTagEntries(stored[TAG_STORAGE_KEY]);
            let updatedTags;

            switch (operation?.type) {
                case 'add':
                    updatedTags = mergeTagEntries(tags, operation.tags);
                    break;
                case 'updateMany': {
                    const updates = operation.updates;
                    if (!Array.isArray(updates)) {
                        throw new Error(chrome.i18n.getMessage('invalidUpdatesList'));
                    }

                    const updatesByTag = new Map();
                    for (const update of updates) {
                        if (!update || typeof update !== 'object') {
                            throw new Error(chrome.i18n.getMessage('invalidUpdate'));
                        }

                        const newTag =
                            typeof update.tag === 'string' ? update.tag.trim() : '';
                        if (
                            typeof update.oldTag !== 'string' ||
                            !newTag ||
                            (update.description !== undefined &&
                                typeof update.description !== 'string')
                        ) {
                            throw new Error(chrome.i18n.getMessage('invalidKeysOrDescriptions'));
                        }

                        if (updatesByTag.has(update.oldTag)) {
                            throw new Error(chrome.i18n.getMessage('duplicateEditedKey'));
                        }
                        updatesByTag.set(update.oldTag, {
                            tag: newTag,
                            description: update.description?.trim() || '',
                        });
                    }

                    for (const oldTag of updatesByTag.keys()) {
                        if (!tags.some(
                            /** Checks whether the edited key still exists. */
                            (entry) => entry.tag === oldTag,
                        )) {
                            throw new Error(chrome.i18n.getMessage('editedKeyNotFound'));
                        }
                    }

                    updatedTags = tags.map(
                        /** Applies changes while leaving other records untouched. */
                        (entry) => {
                            const update = updatesByTag.get(entry.tag);
                            return update ? {tag: update.tag, description: update.description} : entry;
                        },
                    );
                    const uniqueTags = new Set(
                        updatedTags.map(
                            /** Extracts keys to validate uniqueness. */
                            (entry) => entry.tag,
                        ),
                    );
                    if (uniqueTags.size !== updatedTags.length) {
                        throw new Error(chrome.i18n.getMessage('duplicateKeysResult'));
                    }
                    break;
                }
                case 'delete':
                    updatedTags = tags.filter(
                        /** Keeps every record except the requested key. */
                        (entry) => entry.tag !== operation.tag,
                    );
                    break;
                case 'deleteAll':
                    await chrome.storage.local.remove(TAG_STORAGE_KEY);
                    updatedTags = normalizeTagEntries(
                        (await chrome.storage.local.get(TAG_STORAGE_KEY))[TAG_STORAGE_KEY],
                    );
                    if (updatedTags.length > 0) {
                        throw new Error(chrome.i18n.getMessage('storageDeleteError'));
                    }
                    return updatedTags;
                case 'merge':
                    updatedTags = mergeTagEntries(tags, operation.tags);
                    break;
                default:
                    throw new Error(chrome.i18n.getMessage('invalidTagOperation'));
            }

            await chrome.storage.local.set({[TAG_STORAGE_KEY]: updatedTags});
            return updatedTags;
        },
    );

    tagMutationQueue = pendingMutation.catch(
        /** Logs the failure and allows the queue to accept new operations. */
        (error) => {
            console.error(chrome.i18n.getMessage('mutateTagsError'), error);
        },
    );
    return pendingMutation;
}

/**
 * Extracts `tag` values from URLs whose hostname contains `amazon.com`.
 * @param {string|undefined} url Tab URL.
 * @returns {string[]} Detected tag values.
 */
function getAmazonTags(url) {
    if (!url) {
        return [];
    }

    try {
        const parsedUrl = new URL(url);
        if (!isAmazonDomainUrl(url)) {
            return [];
        }

        return normalizeTagEntries(parsedUrl.searchParams.getAll('tag')).map(
            /** Returns each key value found in the URL. */
            (entry) => entry.tag,
        );
    } catch {
        return [];
    }
}

/**
 * Updates the badge based on the Amazon domain and presence of the `tag` parameter.
 * @param {string|undefined} url Current tab URL.
 * @returns {Promise<void>}
 */
async function updateBadge(url) {
    let parsedUrl;
    try {
        parsedUrl = url ? new URL(url) : undefined;
    } catch {
        parsedUrl = undefined;
    }

    const isAmazonDomain = isAmazonDomainUrl(url);
    const hasTag = isAmazonDomain && parsedUrl.searchParams.has('tag');

    await Promise.all([
        chrome.action.setBadgeText({text: isAmazonDomain ? '!' : ''}),
        chrome.action.setBadgeBackgroundColor({
            color: hasTag ? '#008000' : '#ff0000',
        }),
    ]);
}

/**
 * Updates the badge and logs extension API failures.
 * @param {string|undefined} url Current tab URL.
 * @returns {Promise<void>}
 */
async function safelyUpdateBadge(url) {
    try {
        await updateBadge(url);
    } catch (error) {
        console.error(chrome.i18n.getMessage('updateBadgeError'), error);
    }
}

/**
 * Saves tags discovered in a URL to storage.
 * @param {string|undefined} url URL being checked.
 * @returns {Promise<void>}
 */
async function saveDiscoveredTags(url) {
    const discoveredTags = getAmazonTags(url);
    if (discoveredTags.length > 0) {
        try {
            await mutateStoredTags({type: 'add', tags: discoveredTags});
        } catch (error) {
            console.error(chrome.i18n.getMessage('saveDiscoveredTagsError'), error);
        }
    }
}

/**
 * Updates discovered tags and the badge for a specific tab.
 * @param {number} tabId Tab identifier.
 * @returns {Promise<void>}
 */
async function updateBadgeForTab(tabId) {
    const requestId = ++latestUpdate;

    try {
        const tab = await chrome.tabs.get(tabId);
        if (requestId !== latestUpdate) {
            return;
        }

        await saveDiscoveredTags(tab.url);
        if (requestId !== latestUpdate) {
            return;
        }
        await safelyUpdateBadge(tab.url);
    } catch (error) {
        if (requestId !== latestUpdate) {
            return;
        }

        console.error(chrome.i18n.getMessage('getActiveTabError'), error);
        await safelyUpdateBadge(undefined);
    }
}

/**
 * Gets the active tab in the focused window and updates its badge.
 * @returns {Promise<void>}
 */
async function updateBadgeForActiveTab() {
    const requestId = ++latestUpdate;

    try {
        const tabs = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
        });
        if (requestId !== latestUpdate) {
            return;
        }

        const url = tabs[0]?.url;
        await saveDiscoveredTags(url);
        if (requestId !== latestUpdate) {
            return;
        }
        await safelyUpdateBadge(url);
    } catch (error) {
        if (requestId !== latestUpdate) {
            return;
        }

        console.error(chrome.i18n.getMessage('identifyActiveTabError'), error);
        await safelyUpdateBadge(undefined);
    }
}

/** Processes the tab that was just activated. */
chrome.tabs.onActivated.addListener(({tabId}) => {
    void updateBadgeForTab(tabId);
});

/** Saves tags from a new URL and updates the active tab's badge. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        void saveDiscoveredTags(changeInfo.url);
        if (tab.active) {
            void updateBadgeForActiveTab();
        }
    }
});

/** Initializes the badge after installation or extension update. */
chrome.runtime.onInstalled.addListener(() => {
    void updateBadgeForActiveTab();
});
/** Initializes the badge when the browser starts. */
chrome.runtime.onStartup.addListener(() => {
    void updateBadgeForActiveTab();
});

/** Handles tag mutation requests sent by the options page. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'tags:mutate') {
        return;
    }

    mutateStoredTags(message.operation)
        .then(
            /** Returns the updated records to the requester. */
            (tags) => sendResponse({tags}),
        )
        .catch(
            /** Returns the operation failure to the requester. */
            (error) => sendResponse({error: error.message}),
        );
    return true;
});
