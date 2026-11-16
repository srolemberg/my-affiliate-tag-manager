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

test('normalizes legacy strings and records, trims values, and removes duplicates', () => {
    const result = utilities.normalizeTagEntries([
        ' first ',
        {tag: 'second', description: ' Account '},
        {tag: 'first', description: 'Updated account'},
        {tag: 'second', description: ''},
        {tag: '   ', description: 'Ignored'},
        null,
        {tag: 42},
    ]);

    assert.deepEqual(
        JSON.parse(JSON.stringify(result)),
        [
            {tag: 'first', description: 'Updated account'},
            {tag: 'second', description: 'Account'},
        ],
    );
});

test('returns an empty list when tag entries are not an array', () => {
    assert.deepEqual(
        JSON.parse(JSON.stringify(utilities.normalizeTagEntries(null))),
        [],
    );
});

test('recognizes supported Amazon hostnames and rejects invalid URLs', () => {
    assert.equal(utilities.isAmazonDomainUrl('https://www.amazon.com/dp/item'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://amazon.com.br/'), true);
    assert.equal(utilities.isAmazonDomainUrl('https://example.com/'), false);
    assert.equal(utilities.isAmazonDomainUrl('not a URL'), false);
    assert.equal(utilities.isAmazonDomainUrl(undefined), false);
});
