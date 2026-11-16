const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createEvent() {
    return {
        addListener(listener) {
            this.listener = listener;
        },
    };
}

function createBackgroundHarness(initialStorage = {}) {
    const storage = {...initialStorage};
    const badgeCalls = [];
    const chrome = {
        action: {
            async setBadgeText(details) {
                badgeCalls.push({type: 'text', ...details});
            },
            async setBadgeBackgroundColor(details) {
                badgeCalls.push({type: 'color', ...details});
            },
        },
        i18n: {
            getMessage(messageName) {
                return messageName;
            },
        },
        runtime: {
            onInstalled: createEvent(),
            onStartup: createEvent(),
            onMessage: createEvent(),
        },
        storage: {
            local: {
                async get(key) {
                    return {[key]: storage[key]};
                },
                async remove(key) {
                    delete storage[key];
                },
                async set(values) {
                    Object.assign(storage, values);
                },
            },
        },
        tabs: {
            onActivated: createEvent(),
            onUpdated: createEvent(),
            async get() {
                return {};
            },
            async query() {
                return [];
            },
        },
    };

    const context = vm.createContext({
        chrome,
        console: {error() {}},
        URL,
        importScripts(fileName) {
            const utilityPath = path.join(__dirname, '..', fileName);
            vm.runInContext(fs.readFileSync(utilityPath, 'utf8'), context);
        },
    });
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'background.js'),
        'utf8',
    );
    vm.runInContext(
        `${source}\nglobalThis.testApi = {mergeTagEntries, mutateStoredTags, getAmazonTags, updateBadge};`,
        context,
    );

    return {api: context.testApi, storage, badgeCalls, chrome};
}

test('extracts unique tag values only from supported Amazon URLs', () => {
    const {api} = createBackgroundHarness();

    assert.deepEqual(
        JSON.parse(JSON.stringify(
            api.getAmazonTags('https://www.amazon.com/dp/item?tag=one-20&tag=two-20&tag=one-20'),
        )),
        ['one-20', 'two-20'],
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.getAmazonTags('https://example.com/?tag=one-20'))),
        [],
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.getAmazonTags('not a URL'))),
        [],
    );
});

test('adds, merges, edits, and deletes tags in storage', async () => {
    const {api, storage} = createBackgroundHarness({
        savedTags: [{tag: 'existing-20', description: 'My account'}],
    });

    const added = await api.mutateStoredTags({
        type: 'add',
        tags: [
            {tag: 'existing-20'},
            {tag: 'new-20', description: 'New account'},
        ],
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(added)),
        [
            {tag: 'existing-20', description: 'My account'},
            {tag: 'new-20', description: 'New account'},
        ],
    );

    const updated = await api.mutateStoredTags({
        type: 'updateMany',
        updates: [{oldTag: 'new-20', tag: 'renamed-20', description: 'Renamed'}],
    });
    assert.equal(updated[1].tag, 'renamed-20');
    assert.equal(updated[1].description, 'Renamed');

    const deleted = await api.mutateStoredTags({
        type: 'delete',
        tag: 'existing-20',
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(deleted)),
        [{tag: 'renamed-20', description: 'Renamed'}],
    );
    assert.deepEqual(storage.savedTags, deleted);
});

test('rejects duplicate edits without changing stored tags', async () => {
    const original = [
        {tag: 'first-20', description: ''},
        {tag: 'second-20', description: ''},
    ];
    const {api, storage} = createBackgroundHarness({savedTags: original});

    await assert.rejects(
        api.mutateStoredTags({
            type: 'updateMany',
            updates: [
                {oldTag: 'first-20', tag: 'same-20'},
                {oldTag: 'second-20', tag: 'same-20'},
            ],
        }),
        /duplicateKeysResult/,
    );
    assert.deepEqual(storage.savedTags, original);
});

test('deletes all tags from storage', async () => {
    const {api, storage} = createBackgroundHarness({
        savedTags: [{tag: 'account-20', description: ''}],
    });

    const result = await api.mutateStoredTags({type: 'deleteAll'});

    assert.deepEqual(JSON.parse(JSON.stringify(result)), []);
    assert.equal(Object.hasOwn(storage, 'savedTags'), false);
});

test('sets badge text and color for tagged, untagged, and non-Amazon URLs', async () => {
    const {api, badgeCalls} = createBackgroundHarness();

    await api.updateBadge('https://www.amazon.com/?tag=account-20');
    await api.updateBadge('https://www.amazon.com/');
    await api.updateBadge('https://example.com/');

    assert.deepEqual(badgeCalls, [
        {type: 'text', text: '!'},
        {type: 'color', color: '#008000'},
        {type: 'text', text: '!'},
        {type: 'color', color: '#ff0000'},
        {type: 'text', text: ''},
        {type: 'color', color: '#ff0000'},
    ]);
});
