/**
 * Normalizes legacy strings and record objects into unique tag records.
 * Later duplicate records can update metadata while blank values preserve earlier data.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} entries Records to normalize.
 * @returns {{tag: string, description: string, url: string}[]} Unique normalized records.
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
 * Validates changed URL fields and identifies duplicate resulting keys.
 * Unchanged entries participate in duplicate detection but do not receive errors.
 * Set `validate` to true to validate a new URL with no saved original value.
 * @param {Array<{originalTag?: string, originalUrl?: string, url: string, validate?: boolean}>} entries Saved or proposed URL values.
 * @returns {Array<null|{type: 'invalid'}|{type: 'duplicate', tag: string}>} Error for each entry, if any.
 */
function getTagUrlValidationErrors(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    const candidates = entries.map((entry) => {
        const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
        const originalUrl =
            typeof entry?.originalUrl === 'string' ? entry.originalUrl.trim() : '';
        const changed = entry?.validate === true || url !== originalUrl;
        const derivedTag = changed ? getTagFromAmazonUrl(url) : '';
        const valid = !changed || Boolean(derivedTag);
        const tag = changed ? (valid ? derivedTag : '') : entry?.originalTag;
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
 * Selects the newest valid per-tag timestamp while migrating legacy records.
 * @param {Array<{tag: string, lastAccessed: string}>|undefined} entries Legacy saved records.
 * @returns {{tag: string, lastAccessed: string}|null} The latest access record, or null.
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
 * Derives a key from a supported HTTP(S) URL containing one distinct non-empty `tag` value.
 * @param {string|undefined} url URL to inspect.
 * @returns {string} The derived key, or an empty string for invalid or ambiguous URLs.
 */
function getTagFromAmazonUrl(url) {
    if (typeof url !== 'string' || !url) {
        return '';
    }

    try {
        const parsedUrl = new URL(url);
        if (
            !isAmazonHostname(parsedUrl.hostname) ||
            (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
        ) {
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
 * Checks whether a supported URL derives exactly the supplied key.
 * @param {string|undefined} url URL to validate.
 * @param {string} tag Expected key.
 * @returns {boolean} Whether the URL is valid and contains the expected key.
 */
function isValidAmazonTagUrl(url, tag) {
    return typeof tag === 'string' &&
        Boolean(tag.trim()) &&
        getTagFromAmazonUrl(url) === tag.trim();
}

/**
 * Evaluates the notification state for a page using the saved key list.
 * @param {string|undefined} url Active page URL.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} entries Saved records.
 * @param {{tag?: string, lastAccessed?: string}|null|undefined} accessRecord Latest accessed key and time.
 * @param {number} now Current timestamp for expiration checks.
 * @returns {'valid'|'different'|'expired'|'invalid'|'hidden'} Notification state.
 */
function getBadgeStatus(url, entries, accessRecord, now = Date.now()) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return 'hidden';
    }

    if (!isAmazonHostname(parsedUrl.hostname)) {
        return 'hidden';
    }

    const supportedProtocol =
        parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    const tagValues = supportedProtocol
        ? parsedUrl.searchParams.getAll('tag')
        : [];
    const uniqueTags = [...new Set(tagValues.map((tag) => tag.trim()))];
    const hasExplicitTag = tagValues.length > 0;
    const explicitTag = hasExplicitTag &&
        tagValues.every((tag) => tag.trim()) &&
        uniqueTags.length === 1
        ? uniqueTags[0]
        : '';
    const isInferredTag = supportedProtocol && !hasExplicitTag;
    const accessTag =
        typeof accessRecord?.tag === 'string' ? accessRecord.tag.trim() : '';
    const tag = explicitTag || (isInferredTag ? accessTag : '');
    const savedEntry = normalizeTagEntries(entries)
        .find((entry) => entry.tag === tag);
    if (!tag || !savedEntry || !isValidAmazonTagUrl(savedEntry.url, tag)) {
        return 'invalid';
    }

    if (isInferredTag) {
        const accessAge = now - Date.parse(accessRecord?.lastAccessed);
        return accessAge >= 0 && accessAge < 24 * 60 * 60 * 1000
            ? 'different'
            : 'expired';
    }
    return accessTag === tag ? 'valid' : 'different';
}

/**
 * Checks whether a URL uses `amazon.com`, one of its subdomains, or a regional domain.
 * @param {string|undefined} url URL to inspect.
 * @returns {boolean} Whether the URL uses a supported Amazon hostname.
 */
function isAmazonDomainUrl(url) {
    if (typeof url !== 'string' || !url) {
        return false;
    }

    try {
        return isAmazonHostname(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Matches Amazon domain names at label boundaries, including regional domains.
 * @param {string} hostname Hostname to check.
 * @returns {boolean} Whether the hostname is supported.
 */
function isAmazonHostname(hostname) {
    return /(^|\.)amazon\.com(\.|$)/.test(hostname);
}
