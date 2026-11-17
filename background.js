/**
 * Service worker for detecting affiliate tags on supported Amazon domains,
 * updating the extension badge, and managing saved records and global access
 * data in `chrome.storage.local`.
 */
importScripts('tag-utils.js');

const TAG_STORAGE_KEY = 'savedTags';
const LAST_ACCESSED_STORAGE_KEY = 'lastAccessedTag';
let latestUpdate = 0;
let tagMutationQueue = Promise.resolve();

/**
 * Merges records by key, retaining existing descriptions when incoming ones
 * are empty and optionally preferring existing URLs.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} existingEntries Records currently saved.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} incomingEntries Records to merge.
 * @param {boolean} preserveExistingUrls Whether saved URLs take precedence over incoming URLs.
 * @returns {{tag: string, description: string, url: string}[]} The merged, normalized records.
 */
function mergeTagEntries(existingEntries, incomingEntries, preserveExistingUrls = false) {
    const mergedEntries = new Map(
        normalizeTagEntries(existingEntries).map(
            /** Creates a key-to-record entry for the map. */
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
 * Serializes a tag operation, applies it to stored data, and persists the result.
 * @param {{type: string, [key: string]: any}} operation Operation requested by an extension page.
 * @returns {Promise<{tag: string, description: string, url: string}[]>} Updated records.
 */
function mutateStoredTags(operation) {
    const pendingMutation = tagMutationQueue.then(
        /** Waits for earlier writes before applying this operation. */
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
                        operation.tags.some((entry) => {
                            const tag = getTagFromAmazonUrl(entry?.url);
                            return (
                                !entry ||
                                typeof entry !== 'object' ||
                                !tag ||
                                (entry.description !== undefined &&
                                    typeof entry.description !== 'string') ||
                                (entry.tag !== undefined &&
                                    entry.tag !== tag)
                            );
                        })
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
                            /** Confirms that the original key is still saved. */
                            (entry) => entry.tag === oldTag,
                        )) {
                            throw new Error(chrome.i18n.getMessage('editedKeyNotFound'));
                        }
                    }

                    updatedTags = tags.map(
                        /** Updates edited records and retains all other records. */
                        (entry) => {
                            const update = updatesByTag.get(entry.tag);
                            return update
                                ? {...entry, ...update}
                                : entry;
                        },
                    );
                    const uniqueTags = new Set(
                        updatedTags.map(
                            /** Collects resulting keys for the uniqueness check. */
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
                        /** Removes the record matching the requested key. */
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
        /** Logs failures without leaving the mutation queue rejected. */
        (error) => {
            console.error(chrome.i18n.getMessage('mutateTagsError'), error);
        },
    );
    return pendingMutation;
}

/**
 * Returns a record when a supported URL contains exactly one distinct tag.
 * @param {string|undefined} url URL to inspect.
 * @returns {{tag: string, url: string}[]} The derived key and its source URL, or an empty array.
 */
function getAmazonTagEntries(url) {
    const tag = getTagFromAmazonUrl(url);
    if (!tag) {
        return [];
    }

    return [{tag, url}];
}

/**
 * Extracts and deduplicates non-empty tag values from a supported Amazon URL.
 * @param {string|undefined} url URL to inspect.
 * @returns {string[]} Normalized tag values, or an empty array for an invalid URL.
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
 * Sets the badge marker for supported domains and colors it by `tag` presence.
 * @param {string|undefined} url URL of the tab to represent.
 * @returns {Promise<void>}
 */
async function updateBadge(url) {
    let parsedUrl;
    try {
        parsedUrl = url ? new URL(url) : undefined;
    } catch {
        parsedUrl = undefined;
    }

    const isAmazonDomain = Boolean(
        parsedUrl && isAmazonHostname(parsedUrl.hostname),
    );
    const hasTag = isAmazonDomain && parsedUrl.searchParams.has('tag');

    await Promise.all([
        chrome.action.setBadgeText({text: isAmazonDomain ? '!' : ''}),
        chrome.action.setBadgeBackgroundColor({
            color: hasTag ? '#008000' : '#ff0000',
        }),
    ]);
}

/**
 * Updates the badge while logging Chrome API failures.
 * @param {string|undefined} url URL of the tab to represent.
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
 * Saves a discovered tag and records access after navigation completes.
 * @param {string|undefined} url URL from the completed navigation.
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
 * Updates the badge for one tab without changing the last-access record.
 * @param {number} tabId Chrome tab identifier.
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
 * Finds the active tab in the focused window and updates its badge.
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

/** Refreshes the badge after a tab becomes active. */
chrome.tabs.onActivated.addListener(({tabId}) => {
    return updateBadgeForTab(tabId);
});

/** Records a tag only after the main-frame navigation completes successfully. */
chrome.webNavigation.onCompleted.addListener(({frameId, url}) => {
    if (frameId === 0) {
        return saveDiscoveredTags(url);
    }
});

/** Refreshes the badge when an active tab's URL changes; does not record access. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
        void updateBadgeForActiveTab();
    }
});

/** Initializes the badge after installation or an extension update. */
chrome.runtime.onInstalled.addListener(() => {
    void updateBadgeForActiveTab();
});
/** Initializes the badge when Chrome starts. */
chrome.runtime.onStartup.addListener(() => {
    void updateBadgeForActiveTab();
});

/** Handles saved-tag operations requested by an extension page. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'tags:mutate') {
        return;
    }

    mutateStoredTags(message.operation)
        .then(
            /** Sends the updated records to the requesting page. */
            (tags) => sendResponse({tags}),
        )
        .catch(
            /** Sends the operation error to the requesting page. */
            (error) => sendResponse({error: error.message}),
        );
    return true;
});
