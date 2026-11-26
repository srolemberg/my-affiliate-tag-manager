/** Tests normalization, URL validation, and migration helpers in tag-utils.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {describe, test} = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'tag-utils.js'),
    'utf8',
);
const storeDomains = require('../amazon_store_domains.json');
const utilities = vm.createContext({
    URL,
});
vm.runInContext(source, utilities);

describe('saved tag records, Amazon URLs, and badge rules', () => {
    test('should normalize saved tag records and omit per-tag access timestamps when records are loaded', () => {
        const result = utilities.normalizeTagEntries([
            ' first ',
            {tag: 'second', description: ' Account ', url: ' https://www.amazon.com/?tag=second ', lastAccessed: '2026-01-02T03:04:05.000Z'},
            {tag: 'first', description: 'Updated account', url: 'https://www.amazon.com/?tag=first'},
            {tag: 'second', description: ''},
            {tag: '   ', description: 'Ignored'},
            null,
            {tag: 42},
        ]);

        assert.deepEqual(
            JSON.parse(JSON.stringify(result)),
            [
                {tag: 'first', description: 'Updated account', url: 'https://www.amazon.com/?tag=first'},
                {tag: 'second', description: 'Account', url: 'https://www.amazon.com/?tag=second'},
            ],
        );
    });

    test('should keep optional saved-tag descriptions trimmed or empty for card supporting text', () => {
        const result = utilities.normalizeTagEntries([
            {tag: 'described-20', description: '  Product note  '},
            {tag: 'blank-20', description: '   '},
            {tag: 'missing-20'},
        ]);

        assert.deepEqual(
            JSON.parse(JSON.stringify(result.map(({tag, description}) => ({tag, description})))),
            [
                {tag: 'described-20', description: 'Product note'},
                {tag: 'blank-20', description: ''},
                {tag: 'missing-20', description: ''},
            ],
        );
    });

    test('should select the latest legacy access timestamp when migrating saved records', () => {
        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.getLatestAccessRecord([
                {tag: 'older-20', lastAccessed: '2026-01-01T00:00:00.000Z'},
                {tag: ' newer-20 ', lastAccessed: '2026-01-02T00:00:00.000Z'},
                {tag: 'invalid-20', lastAccessed: 'not a date'},
                {tag: '   ', lastAccessed: '2026-01-03T00:00:00.000Z'},
                null,
            ]))),
            {tag: 'newer-20', lastAccessed: '2026-01-02T00:00:00.000Z'},
        );
        assert.equal(utilities.getLatestAccessRecord(null), null);
    });

    test('should return an empty saved-tag list when stored entries are not an array', () => {
        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.normalizeTagEntries(null))),
            [],
        );
    });

    test('should merge duplicate tag records once and preserve existing metadata when incoming metadata is empty', () => {
        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.mergeTagEntries(
                [
                    {tag: 'saved-20', description: 'Saved description', url: 'https://www.amazon.com/?tag=saved-20'},
                    {tag: 'legacy-20', description: 'Legacy description'},
                ],
                [
                    {tag: 'saved-20', description: '', url: 'https://www.amazon.com/dp/new?tag=saved-20'},
                    {tag: 'legacy-20', description: '', url: 'https://www.amazon.com/?tag=legacy-20'},
                    {tag: 'new-20', description: 'New description'},
                ],
                true,
            ))),
            [
                {tag: 'saved-20', description: 'Saved description', url: 'https://www.amazon.com/?tag=saved-20'},
                {tag: 'legacy-20', description: 'Legacy description', url: 'https://www.amazon.com/?tag=legacy-20'},
                {tag: 'new-20', description: 'New description', url: ''},
            ],
        );
        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.mergeTagEntries(null, null))),
            [],
        );
    });

    test('should report invalid or duplicate tag keys when saved URLs are edited', () => {
        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.getTagUrlValidationErrors([
                {
                    originalTag: 'legacy-20',
                    originalUrl: '',
                    url: '',
                },
                {
                    originalTag: 'first-20',
                    originalUrl: 'https://www.amazon.com/?tag=first-20',
                    url: 'https://aamazon.com/?tag=first-20',
                },
                {
                    originalTag: 'second-20',
                    originalUrl: 'https://www.amazon.com/?tag=second-20',
                    url: 'https://www.amazon.com/?tag=first-20',
                },
            ]))),
            [
                null,
                {type: 'invalid'},
                null,
            ],
        );

        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.getTagUrlValidationErrors([
                {
                    originalTag: 'account-20',
                    originalUrl: 'https://www.amazon.com/?tag=account-20',
                    url: 'https://www.amazon.com/?tag=account-20',
                },
                {
                    originalTag: '',
                    originalUrl: '',
                    url: 'https://www.amazon.com/?tag=account-20',
                    validate: true,
                },
            ]))),
            [null, {type: 'duplicate', tag: 'account-20'}],
        );

        assert.deepEqual(
            JSON.parse(JSON.stringify(utilities.getTagUrlValidationErrors([
                {url: '', originalUrl: '', validate: true},
            ]))),
            [{type: 'invalid'}],
        );
    });

    test('should accept an original URL when it is a supported Amazon URL containing its tag', () => {
        assert.equal(
            utilities.isValidAmazonTagUrl('https://www.amazon.com/dp/item?tag=account-20', 'account-20'),
            true,
        );
        assert.equal(
            utilities.isValidAmazonTagUrl('https://www.amazon.com/dp/item?tag=other-20', 'account-20'),
            false,
        );
        assert.equal(
            utilities.isValidAmazonTagUrl('https://example.com/?tag=account-20', 'account-20'),
            false,
        );
        assert.equal(utilities.isValidAmazonTagUrl('', 'account-20'), false);
    });

    test('should derive one tag from a supported HTTP URL and reject ambiguous or invalid URLs', () => {
        assert.equal(
            utilities.getTagFromAmazonUrl('https://www.amazon.com/?tag=account-20'),
            'account-20',
        );
        assert.equal(
            utilities.getTagFromAmazonUrl(
                'https://www.amazon.com/?tag=account-20&tag=account-20',
            ),
            'account-20',
            'repeated identical tag values remain unambiguous',
        );
        assert.equal(
            utilities.getTagFromAmazonUrl('http://www.amazon.com/?tag=account-20'),
            'account-20',
        );
        assert.equal(
            utilities.getTagFromAmazonUrl('ftp://www.amazon.com/?tag=account-20'),
            '',
        );
        assert.equal(
            utilities.getTagFromAmazonUrl('https://www.amazon.com/?tag=one&tag=two'),
            '',
        );
        assert.equal(
            utilities.getTagFromAmazonUrl('https://www.amazon.com/?tag='),
            '',
        );
        assert.equal(utilities.getTagFromAmazonUrl(null), '');
    });

    test('should accept listed store domains and reject spoofed domains when loading the store list', () => {
        assert.deepEqual(
            [...vm.runInContext('amazonStoreDomains', utilities)],
            storeDomains.stores.map(({store_domain}) => store_domain),
            'the static runtime allowlist must match the store-domain catalog',
        );

        for (const {store_domain: domain} of storeDomains.stores) {
            assert.equal(
                utilities.getTagFromAmazonUrl(`https://www.${domain}/?tag=store-20`),
                'store-20',
                `${domain} and its subdomains should be supported`,
            );
            assert.equal(
                utilities.getTagFromAmazonUrl(`https://${domain}.attacker.example/?tag=store-20`),
                '',
                `${domain}.attacker.example should not be supported`,
            );
        }

        for (const domain of storeDomains.additional_domains.redirects) {
            assert.equal(
                utilities.getTagFromAmazonUrl(`https://${domain}/?tag=redirect-20`),
                '',
                `${domain} is a redirect domain, not a store domain`,
            );
        }
    });

    test('should accept a tag URL when its Amazon domain and URL key are valid', () => {
        assert.equal(
            utilities.isValidAmazonTagUrl('https://aamazon.com/?tag=account-20', 'account-20'),
            false,
        );
        assert.equal(
            utilities.isValidAmazonTagUrl('https://amazon.com.br/?tag=account-20', 'account-20'),
            true,
        );
        assert.equal(
            utilities.isValidAmazonTagUrl(
                'https://amazon.com.attacker.example/?tag=account-20',
                'account-20',
            ),
            false,
        );
        assert.equal(
            utilities.isValidAmazonTagUrl('https://www.amazon.com/?tag=other-20', 'account-20'),
            false,
        );
    });

    test('should show the expected badge state when a supported URL has an explicit or inferred saved key', () => {
        const savedTags = [
            {tag: 'active-20', url: 'https://www.amazon.com/?tag=active-20'},
            {tag: 'other-20', url: 'https://www.amazon.com/?tag=other-20'},
        ];
        const recentAccess = {
            tag: 'active-20',
            lastAccessed: '2026-01-01T00:00:00.000Z',
        };
        const now = Date.parse('2026-01-01T12:00:00.000Z');

        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/?tag=active-20',
                savedTags,
                recentAccess,
                now,
            ),
            'valid',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/?tag=other-20',
                savedTags,
                recentAccess,
                now,
            ),
            'different',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                savedTags,
                recentAccess,
                now,
            ),
            'different',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                savedTags,
                {...recentAccess, lastAccessed: '2025-12-30T00:00:00.000Z'},
                now,
            ),
            'expired',
        );
        assert.equal(
            utilities.getBadgeStatus('https://example.com/', savedTags, recentAccess, now),
            'hidden',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                savedTags,
                null,
                now,
            ),
            'invalid',
        );
        assert.equal(
            utilities.getBadgeStatus(null, null, null, now),
            'hidden',
        );
    });

    test('should reject ambiguous badge keys and expire inferred access at the 24-hour boundary', () => {
        const savedTags = [
            {tag: 'active-20', url: 'https://www.amazon.com/?tag=active-20'},
        ];
        const recentAccess = {
            tag: 'active-20',
            lastAccessed: '2026-01-01T00:00:00.000Z',
        };
        const now = Date.parse('2026-01-02T00:00:00.000Z');

        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/?tag=active-20&tag=active-20',
                savedTags,
                recentAccess,
                now,
            ),
            'valid',
        );
        for (const url of [
            'https://www.amazon.com/?tag=',
            'https://www.amazon.com/?tag=unknown-20&tag=active-20',
            'ftp://www.amazon.com/',
        ]) {
            assert.equal(
                utilities.getBadgeStatus(url, savedTags, recentAccess, now),
                'invalid',
                `${url} must not use the recent access record as a fallback`,
            );
        }

        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                savedTags,
                recentAccess,
                now,
            ),
            'expired',
            'an inferred access expires at exactly 24 hours',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                savedTags,
                {...recentAccess, lastAccessed: 'not a timestamp'},
                now,
            ),
            'expired',
        );
        assert.equal(
            utilities.getBadgeStatus(
                'https://www.amazon.com/',
                [{tag: 'active-20', url: 'https://example.com/?tag=active-20'}],
                recentAccess,
                now - 60_000,
            ),
            'invalid',
            'the inferred saved record must contain its matching valid Amazon URL',
        );
    });
});
