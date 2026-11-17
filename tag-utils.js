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
 * Checks whether a key already exists in a list of tag records.
 * @param {string|undefined} tag Key to find.
 * @param {Array<string|{tag: string}>|undefined} entries Records to search.
 * @returns {boolean} Whether the key is already present.
 */
function hasTagEntry(tag, entries) {
    if (typeof tag !== 'string' || !tag.trim() || !Array.isArray(entries)) {
        return false;
    }

    const normalizedTag = tag.trim();
    return entries.some((entry) => {
        const entryTag = typeof entry === 'string' ? entry : entry?.tag;
        return typeof entryTag === 'string' && entryTag.trim() === normalizedTag;
    });
}

/**
 * Validates only changed URLs and detects duplicate resulting keys.
 * @param {Array<{originalTag: string, originalUrl: string, url: string}>} entries URL edits.
 * @returns {Array<null|{type: 'invalid'}|{type: 'duplicate', tag: string}>} Per-entry errors.
 */
function getTagUrlValidationErrors(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    const candidates = entries.map((entry) => {
        const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
        const originalUrl =
            typeof entry?.originalUrl === 'string' ? entry.originalUrl.trim() : '';
        const changed = url !== originalUrl;
        const derivedTag = changed ? getTagFromAmazonUrl(url) : '';
        const valid = !changed || isValidAmazonTagUrl(url, derivedTag);
        const tag = changed && valid ? derivedTag : entry?.originalTag;
        return {
            changed,
            tag,
            valid,
        };
    });
    const tagCounts = new Map();
    for (const candidate of candidates) {
        if (typeof candidate.tag === 'string' && candidate.tag) {
            tagCounts.set(candidate.tag, (tagCounts.get(candidate.tag) || 0) + 1);
        }
    }

    return candidates.map((candidate) => {
        if (!candidate.changed) {
            return null;
        }
        if (!candidate.valid) {
            return {type: 'invalid'};
        }
        if ((tagCounts.get(candidate.tag) || 0) > 1) {
            return {type: 'duplicate', tag: candidate.tag};
        }
        return null;
    });
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
 * Returns the single tag key represented by a valid supported HTTP(S) URL.
 * @param {string|undefined} url URL to inspect.
 * @returns {string} The URL's tag key, or an empty string when invalid or ambiguous.
 */
function getTagFromAmazonUrl(url) {
    if (!isAmazonDomainUrl(url)) {
        return '';
    }

    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return '';
        }

        const tagValues = parsedUrl.searchParams.getAll('tag');
        if (tagValues.length === 0 || tagValues.some((tag) => !tag.trim())) {
            return '';
        }

        const uniqueTags = [...new Set(tagValues.map((tag) => tag.trim()))];
        return uniqueTags.length === 1 ? uniqueTags[0] : '';
    } catch {
        return '';
    }
}

/**
 * Checks whether a URL represents exactly the supplied tag key.
 * @param {string|undefined} url URL to validate.
 * @param {string} tag Tag key expected in the URL.
 * @returns {boolean} Whether the URL is valid for this tag.
 */
function isValidAmazonTagUrl(url, tag) {
    return typeof tag === 'string' &&
        Boolean(tag.trim()) &&
        getTagFromAmazonUrl(url) === tag.trim();
}

/**
 * Checks whether the hostname is `amazon.com` or has it as a domain boundary.
 * @param {string|undefined} url URL to check.
 * @returns {boolean} Whether the URL belongs to a domain considered Amazon.
 */
function isAmazonDomainUrl(url) {
    if (typeof url !== 'string' || !url) {
        return false;
    }

    try {
        const hostname = new URL(url).hostname;
        return /(^|\.)amazon\.com(\.|$)/.test(hostname);
    } catch {
        return false;
    }
}
