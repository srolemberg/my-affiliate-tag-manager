/** Tests normalization, URL validation, and migration helpers in tag-utils.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'tag-utils.js'),
    'utf8',
);
const utilities = vm.createContext({URL});
vm.runInContext(source, utilities);

test('normalizes tag records and omits per-tag access timestamps', () => {
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

test('selects the latest legacy per-tag timestamp for migration', () => {
    assert.deepEqual(
        JSON.parse(JSON.stringify(utilities.getLatestAccessRecord([
            {tag: 'older-20', lastAccessed: '2026-01-01T00:00:00.000Z'},
            {tag: 'newer-20', lastAccessed: '2026-01-02T00:00:00.000Z'},
            {tag: 'invalid-20', lastAccessed: 'not a date'},
        ]))),
        {tag: 'newer-20', lastAccessed: '2026-01-02T00:00:00.000Z'},
    );
});

test('returns an empty list when tag entries are not an array', () => {
    assert.deepEqual(
        JSON.parse(JSON.stringify(utilities.normalizeTagEntries(null))),
        [],
    );
});

test('validates changed URLs and reports invalid or duplicate keys per field', () => {
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

test('validates that the original URL is a supported Amazon URL containing its tag', () => {
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

test('derives one tag from a valid HTTP(S) URL and rejects ambiguous or invalid URLs', () => {
    assert.equal(
        utilities.getTagFromAmazonUrl('https://www.amazon.com/?tag=account-20'),
        'account-20',
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
});

test('recognizes supported Amazon hostnames and rejects invalid URLs', () => {
    assert.equal(utilities.isAmazonDomainUrl('https://www.amazon.com/dp/item'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://amazon.com/'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://amazon.com.br/'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://www.amazon.com.br/'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://aamazon.com/'), false);
    assert.equal(utilities.isAmazonDomainUrl('https://notamazon.com/'), false);
    assert.equal(utilities.isAmazonDomainUrl('https://amazon.comexample/'), false);
    assert.equal(utilities.isAmazonDomainUrl('https://example.com/'), false);
    assert.equal(utilities.isAmazonDomainUrl('not a URL'), false);
    assert.equal(utilities.isAmazonDomainUrl(undefined), false);
});

test('requires a valid Amazon domain and a tag matching the URL key', () => {
    assert.equal(
        utilities.isValidAmazonTagUrl('https://aamazon.com/?tag=account-20', 'account-20'),
        false,
    );
    assert.equal(
        utilities.isValidAmazonTagUrl('https://amazon.com.br/?tag=account-20', 'account-20'),
        true,
    );
    assert.equal(
        utilities.isValidAmazonTagUrl('https://www.amazon.com/?tag=other-20', 'account-20'),
        false,
    );
});
