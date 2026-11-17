/**
 * Converts legacy and current formats into unique tag records.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} entries Records to validate.
 * @returns {{tag: string, description: string, url: string}[]} Normalized records.
 */
function normalizeTagEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    const normalized = new Map();
    for (const entry of entries) {
        const tagValue =
            typeof entry === 'string'
                ? entry
                : entry && typeof entry === 'object'
                    ? entry.tag
                    : '';
        const tag = typeof tagValue === 'string' ? tagValue.trim() : '';
        if (!tag) {
            continue;
        }

        const description =
            entry &&
            typeof entry === 'object' &&
            typeof entry.description === 'string'
                ? entry.description.trim()
                : '';
        const url =
            entry && typeof entry === 'object' && typeof entry.url === 'string'
                ? entry.url.trim()
                : '';
        const existing = normalized.get(tag);
        normalized.set(tag, {
            tag,
            description: description || existing?.description || '',
            url: url || existing?.url || '',
        });
    }

    return [...normalized.values()];
}

/**
 * Selects the most recent legacy per-tag access timestamp for migration.
 * @param {Array<{tag: string, lastAccessed: string}>|undefined} entries Legacy records.
 * @returns {{tag: string, lastAccessed: string}|null} The latest valid timestamp.
 */
function getLatestAccessRecord(entries) {
    if (!Array.isArray(entries)) {
        return null;
    }

    return entries
        .filter((entry) => (
            typeof entry?.tag === 'string' &&
            typeof entry.lastAccessed === 'string' &&
            !Number.isNaN(Date.parse(entry.lastAccessed))
        ))
        .sort((left, right) => (
            Date.parse(left.lastAccessed) - Date.parse(right.lastAccessed)
        ))
        .map(({tag, lastAccessed}) => ({tag, lastAccessed}))
        .at(-1) || null;
}

/**
 * Checks whether a saved URL is on a supported Amazon domain and contains its tag.
 * @param {string|undefined} url URL to validate.
 * @param {string} tag Tag key the URL must contain.
 * @returns {boolean} Whether the URL is valid for this tag.
 */
function isValidAmazonTagUrl(url, tag) {
    if (typeof tag !== 'string' || !tag.trim() || !isAmazonDomainUrl(url)) {
        return false;
    }

    try {
        return new URL(url).searchParams.getAll('tag').includes(tag.trim());
    } catch {
        return false;
    }
}

/**
 * Checks whether a URL's hostname contains `amazon.com`.
 * @param {string|undefined} url URL to check.
 * @returns {boolean} Whether the URL belongs to a domain considered Amazon.
 */
function isAmazonDomainUrl(url) {
    if (typeof url !== 'string' || !url) {
        return false;
    }

    try {
        return new URL(url).hostname.includes('amazon.com');
    } catch {
        return false;
    }
}
