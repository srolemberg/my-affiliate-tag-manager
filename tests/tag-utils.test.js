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

test('recognizes supported Amazon hostnames and rejects invalid URLs', () => {
    assert.equal(utilities.isAmazonDomainUrl('https://www.amazon.com/dp/item'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://amazon.com.br/'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://example.com/'), false);
    assert.equal(utilities.isAmazonDomainUrl('not a URL'), false);
    assert.equal(utilities.isAmazonDomainUrl(undefined), false);
});
