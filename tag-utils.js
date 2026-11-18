/** Shared duration for inferred access status and its badge refresh alarm. */
const TAG_ACCESS_VALIDITY_MS = 24 * 60 * 60 * 1000;
const AMAZON_STORE_DOMAINS_FILE = 'amazon_store_domains.json';
let amazonStoreDomains = new Set();

/**
 * Loads official store domains from the bundled JSON file. Only `stores` are
 * used; redirects, short links, and unrelated Amazon services are excluded.
 * @returns {Promise<void>}
 */
async function loadAmazonStoreDomains() {
    const url = chrome.runtime.getURL(AMAZON_STORE_DOMAINS_FILE);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${AMAZON_STORE_DOMAINS_FILE}: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data?.stores) || data.stores.length === 0) {
        throw new Error(`${AMAZON_STORE_DOMAINS_FILE} has no store domain list.`);
    }

    const domains = new Set();
    for (const store of data.stores) {
        const domain = typeof store?.store_domain === 'string'
            ? store.store_domain.trim().toLowerCase()
            : '';
        if (
            !domain ||
            domain.startsWith('.') ||
            domain.endsWith('.') ||
            domain.includes('..') ||
            domain.includes('/') ||
            domain.includes(':') ||
            domain.includes('*')
        ) {
            throw new Error(`${AMAZON_STORE_DOMAINS_FILE} contains an invalid store domain.`);
        }

        domains.add(domain);
    }

    amazonStoreDomains = domains;
}

const amazonStoreDomainsReady = loadAmazonStoreDomains();

/**
 * Normalizes legacy strings and record objects into unique tag records.
 * Later duplicate records can update metadata while blank values preserve earlier data.
 * @param {Array<string|{tag: string, description?: string, url?: string}>|null|undefined} entries Records to normalize.
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
 * Merges normalized records by key while keeping useful existing metadata.
 * Incoming non-empty descriptions replace saved descriptions. URLs can be
 * configured to preserve existing values, as required for automatic capture.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} existingEntries Records currently saved.
 * @param {Array<string|{tag: string, description?: string, url?: string}>} incomingEntries Records to merge.
 * @param {boolean} preserveExistingUrls Whether saved URLs take precedence.
 * @returns {{tag: string, description: string, url: string}[]} Unique merged records.
 */
function mergeTagEntries(existingEntries, incomingEntries, preserveExistingUrls = false) {
    const mergedEntries = new Map(
        normalizeTagEntries(existingEntries).map((entry) => [entry.tag, entry]),
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
 * @param {Array<{tag: string, lastAccessed: string}>|null|undefined} entries Legacy saved records.
 * @returns {{tag: string, lastAccessed: string}|null} The latest access record, or null.
 */
function getLatestAccessRecord(entries) {
    if (!Array.isArray(entries)) {
        return null;
    }

    let latestRecord = null;
    let latestTimestamp = -Infinity;
    for (const entry of entries) {
        const tag = typeof entry?.tag === 'string' ? entry.tag.trim() : '';
        const lastAccessed = entry?.lastAccessed;
        if (!tag || typeof lastAccessed !== 'string') {
            continue;
        }

        const timestamp = Date.parse(lastAccessed);
        if (!Number.isNaN(timestamp) && timestamp >= latestTimestamp) {
            latestRecord = {tag, lastAccessed};
            latestTimestamp = timestamp;
        }
    }

    return latestRecord;
}

/**
 * Derives a key from a supported HTTP(S) URL containing one distinct non-empty `tag` value.
 * @param {string|undefined|null} url URL to inspect.
 * @returns {string} The derived key, or an empty string for invalid or ambiguous URLs.
 */
function getTagFromAmazonUrl(url) {
    const tagValues = getAmazonTagValues(url);
    if (!tagValues || tagValues.length === 0 || tagValues.some((tag) => !tag)) {
        return '';
    }

    const uniqueTags = [...new Set(tagValues)];
    return uniqueTags.length === 1 ? uniqueTags[0] : '';
}

/**
 * Parses tag values once after validating the URL protocol and Amazon hostname.
 * Empty values are preserved so callers can reject ambiguous or incomplete URLs.
 * @param {string|undefined|null} url URL to inspect.
 * @returns {string[]|null} Trimmed values, or null when the URL is unsupported.
 */
function getAmazonTagValues(url) {
    if (typeof url !== 'string' || !url) {
        return null;
    }

    try {
        const parsedUrl = new URL(url);
        if (
            !isAmazonHostname(parsedUrl.hostname) ||
            (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
        ) {
            return null;
        }
        return parsedUrl.searchParams.getAll('tag').map((tag) => tag.trim());
    } catch {
        return null;
    }
}

/**
 * Checks whether a supported URL derives exactly the supplied key.
 * @param {string|undefined|null} url URL to validate.
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
 * @param {string|undefined|null} url Active page URL.
 * @param {Array<string|{tag: string, description?: string, url?: string}>|null|undefined} entries Saved records.
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
        return accessAge >= 0 && accessAge < TAG_ACCESS_VALIDITY_MS
            ? 'different'
            : 'expired';
    }
    return accessTag === tag ? 'valid' : 'different';
}

/**
 * Matches Amazon.com and its subdomains, plus explicitly supported regional
 * Amazon.com domains. Arbitrary suffixes are rejected to prevent lookalikes
 * such as `amazon.com.attacker.example` from being treated as Amazon.
 * @param {string} hostname Hostname to check.
 * @returns {boolean} Whether the hostname is supported.
 */
function isAmazonHostname(hostname) {
    if (typeof hostname !== 'string') {
        return false;
    }

    const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
    for (const domain of amazonStoreDomains) {
        if (
            normalizedHostname === domain ||
            normalizedHostname.endsWith(`.${domain}`)
        ) {
            return true;
        }
    }
    return false;
}
