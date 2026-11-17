/**
 * Extension service worker: monitors navigation on Amazon domains, records
 * `tag` parameter values, and updates the badge. Persists tags, original URLs,
 * descriptions, and the single most-recent access record in `chrome.storage.local`.
 */
importScripts('tag-utils.js');

const TAG_STORAGE_KEY = 'savedTags';
const LAST_ACCESSED_STORAGE_KEY = 'lastAccessedTag';
let latestUpdate = 0;
let tagMutationQueue = Promise.resolve();

/**
 * Merges records, preserving existing metadata when incoming values are empty.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} existingEntries Current records.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} incomingEntries Incoming records.
 * @param {boolean} preserveExistingUrls Whether existing URLs take precedence.
 * @returns {{tag: string, description: string, url: string}[]} Merged records.
 */
function mergeTagEntries(existingEntries, incomingEntries, preserveExistingUrls = false) {
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
            url: preserveExistingUrls
                ? existing?.url || entry.url
                : entry.url || existing?.url || '',
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
            const stored = await chrome.storage.local.get([
                TAG_STORAGE_KEY,
                LAST_ACCESSED_STORAGE_KEY,
            ]);
            const tags = normalizeTagEntries(stored[TAG_STORAGE_KEY]);
            let lastAccessedTag = stored[LAST_ACCESSED_STORAGE_KEY];
            if (
                !lastAccessedTag ||
                typeof lastAccessedTag.tag !== 'string' ||
                typeof lastAccessedTag.lastAccessed !== 'string' ||
                Number.isNaN(Date.parse(lastAccessedTag.lastAccessed))
            ) {
                lastAccessedTag = getLatestAccessRecord(stored[TAG_STORAGE_KEY]);
            }
            let updatedTags;

            switch (operation?.type) {
                case 'add':
                    if (
                        !Array.isArray(operation.tags) ||
                        operation.tags.some(
                            (entry) => (
                                !entry ||
                                typeof entry !== 'object' ||
                                !isValidAmazonTagUrl(
                                    entry.url,
                                    getTagFromAmazonUrl(entry.url),
                                ) ||
                                (entry.description !== undefined &&
                                    typeof entry.description !== 'string') ||
                                (entry.tag !== undefined &&
                                    entry.tag !== getTagFromAmazonUrl(entry.url))
                            ),
                        )
                    ) {
                        throw new Error(chrome.i18n.getMessage('invalidAmazonTagUrl'));
                    }
                    updatedTags = mergeTagEntries(
                        tags,
                        operation.tags.map((entry) => ({
                            tag: getTagFromAmazonUrl(entry.url),
                            description: entry.description,
                            url: entry.url,
                        })),
                    );
                    break;
                case 'discover': {
                    if (!Array.isArray(operation.tags)) {
                        throw new Error(chrome.i18n.getMessage('invalidUpdatesList'));
                    }
                    updatedTags = mergeTagEntries(
                        tags,
                        operation.tags,
                        true,
                    );
                    const latestEntry = operation.tags.at(-1);
                    if (latestEntry && isValidAmazonTagUrl(latestEntry.url, latestEntry.tag)) {
                        lastAccessedTag = {
                            tag: latestEntry.tag,
                            lastAccessed: new Date().toISOString(),
                        };
                    }
                    break;
                }
                case 'access': {
                    const tag =
                        typeof operation.tag === 'string' ? operation.tag.trim() : '';
                    const existing = tags.find((entry) => entry.tag === tag);
                    if (!existing) {
                        throw new Error(chrome.i18n.getMessage('editedKeyNotFound'));
                    }
                    if (!isValidAmazonTagUrl(existing.url, existing.tag)) {
                        throw new Error(chrome.i18n.getMessage('invalidAmazonTagUrl'));
                    }
                    updatedTags = tags;
                    lastAccessedTag = {
                        tag,
                        lastAccessed: new Date().toISOString(),
                    };
                    break;
                }
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

                        const newTag = getTagFromAmazonUrl(update.url);
                        if (
                            typeof update.oldTag !== 'string' ||
                            (update.description !== undefined &&
                                typeof update.description !== 'string')
                        ) {
                            throw new Error(chrome.i18n.getMessage('invalidKeysOrDescriptions'));
                        }
                        if (
                            !newTag ||
                            !isValidAmazonTagUrl(update.url, newTag) ||
                            (update.tag !== undefined && update.tag !== newTag)
                        ) {
                            throw new Error(chrome.i18n.getMessage('invalidAmazonTagUrl'));
                        }

                        if (updatesByTag.has(update.oldTag)) {
                            throw new Error(chrome.i18n.getMessage('duplicateEditedKey'));
                        }
                        updatesByTag.set(update.oldTag, {
                            tag: newTag,
                            description: update.description?.trim() || '',
                            url: update.url.trim(),
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
                            return update
                                ? {...entry, ...update}
                                : entry;
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
                    if (lastAccessedTag) {
                        const renamedTag = updatesByTag.get(lastAccessedTag.tag)?.tag;
                        if (renamedTag) {
                            lastAccessedTag = {...lastAccessedTag, tag: renamedTag};
                        }
                    }
                    break;
                }
                case 'delete':
                    updatedTags = tags.filter(
                        /** Keeps every record except the requested key. */
                        (entry) => entry.tag !== operation.tag,
                    );
                    if (lastAccessedTag?.tag === operation.tag) {
                        lastAccessedTag = null;
                    }
                    break;
                case 'deleteAll':
                    await chrome.storage.local.remove([
                        TAG_STORAGE_KEY,
                        LAST_ACCESSED_STORAGE_KEY,
                    ]);
                    updatedTags = normalizeTagEntries(
                        (await chrome.storage.local.get(TAG_STORAGE_KEY))[TAG_STORAGE_KEY],
                    );
                    if (updatedTags.length > 0) {
                        throw new Error(chrome.i18n.getMessage('storageDeleteError'));
                    }
                    return updatedTags;
                case 'merge':
                    if (
                        !Array.isArray(operation.tags) ||
                        operation.tags.some(
                            (entry) => (
                                entry &&
                                typeof entry === 'object' &&
                                entry.url &&
                                !isValidAmazonTagUrl(entry.url, entry.tag)
                            ),
                        )
                    ) {
                        throw new Error(chrome.i18n.getMessage('invalidAmazonTagUrl'));
                    }
                    updatedTags = mergeTagEntries(tags, operation.tags);
                    break;
                default:
                    throw new Error(chrome.i18n.getMessage('invalidTagOperation'));
            }

            await chrome.storage.local.set({
                [TAG_STORAGE_KEY]: updatedTags,
                [LAST_ACCESSED_STORAGE_KEY]: lastAccessedTag,
            });
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
 * Extracts unique tag records and the full source URL from supported domains.
 * @param {string|undefined} url Tab URL.
 * @returns {{tag: string, url: string}[]} Detected tag records.
 */
function getAmazonTagEntries(url) {
    const tag = getTagFromAmazonUrl(url);
    if (!tag) {
        return [];
    }

    return [{tag, url}];
}

/**
 * Extracts tag values from a supported Amazon URL.
 * @param {string|undefined} url Tab URL.
 * @returns {string[]} Detected tag values.
 */
function getAmazonTags(url) {
    if (!url || !isAmazonDomainUrl(url)) {
        return [];
    }

    try {
        return normalizeTagEntries(new URL(url).searchParams.getAll('tag')).map(
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
    const discoveredTags = getAmazonTagEntries(url);
    if (discoveredTags.length > 0) {
        try {
            await mutateStoredTags({type: 'discover', tags: discoveredTags});
        } catch (error) {
            console.error(chrome.i18n.getMessage('saveDiscoveredTagsError'), error);
        }
    }
}

/**
 * Updates the badge for a specific tab without recording a tag access.
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
    return updateBadgeForTab(tabId);
});

/** Records tags only after the main-frame navigation successfully completes. */
chrome.webNavigation.onCompleted.addListener(({frameId, url}) => {
    if (frameId === 0) {
        return saveDiscoveredTags(url);
    }
});

/** Updates the badge when the active tab's URL changes, without recording access. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
        void updateBadgeForActiveTab();
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
