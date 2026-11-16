/**
 * Converts legacy and current formats into unique key and description records.
 * @param {Array<string|{tag: string, description?: string}>} entries Records to validate.
 * @returns {{tag: string, description: string}[]} Normalized records.
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
        const existing = normalized.get(tag);
        normalized.set(tag, {
            tag,
            description: description || existing?.description || '',
        });
    }

    return [...normalized.values()];
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
