/** Tests service-worker storage mutations, navigation tracking, and badge updates. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

/** Creates a minimal Chrome event mock that stores its registered listener. */
function createEvent() {
    return {
        addListener(listener) {
            this.listener = listener;
        },
    };
}

/**
 * Evaluates the service worker with mocked Chrome APIs and in-memory storage.
 * @param {Record<string, unknown>} initialStorage Initial local-storage values.
 * @returns {object} Service-worker API, storage state, badge calls, and Chrome mocks.
 */
function createBackgroundHarness(initialStorage = {}) {
    const storage = {...initialStorage};
    const badgeCalls = [];
    const chrome = {
        action: {
            async setBadgeText(details) {
                badgeCalls.push({type: 'text', ...details});
            },
            async setBadgeTextColor(details) {
                badgeCalls.push({type: 'text-color', ...details});
            },
            async setBadgeBackgroundColor(details) {
                badgeCalls.push({type: 'color', ...details});
            },
            async setTitle(details) {
                badgeCalls.push({type: 'title', ...details});
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
            onChanged: createEvent(),
            local: {
                async get(key) {
                    if (Array.isArray(key)) {
                        return Object.fromEntries(
                            key.map((name) => [name, storage[name]]),
                        );
                    }
                    return {[key]: storage[key]};
                },
                async remove(key) {
                    for (const name of Array.isArray(key) ? key : [key]) {
                        delete storage[name];
                    }
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
        webNavigation: {
            onCompleted: createEvent(),
        },
        alarms: {
            onAlarm: createEvent(),
            async clear(name) {
                delete chrome.alarms.scheduled[name];
                return true;
            },
            create(name, details) {
                chrome.alarms.scheduled[name] = details;
            },
            scheduled: {},
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
        `${source}\nglobalThis.testApi = {mutateStoredTags, getAmazonTagEntries, updateBadge};`,
        context,
    );

    return {api: context.testApi, storage, badgeCalls, chrome};
}

test('discovers only one distinct tag from supported Amazon URLs', () => {
    const {api} = createBackgroundHarness();

    assert.deepEqual(
        JSON.parse(JSON.stringify(
            api.getAmazonTagEntries(
                'https://www.amazon.com/?tag=one-20&tag=one-20',
            ),
        )),
        [{
            tag: 'one-20',
            url: 'https://www.amazon.com/?tag=one-20&tag=one-20',
        }],
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(
            api.getAmazonTagEntries('https://example.com/?tag=one-20'),
        )),
        [],
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.getAmazonTagEntries('not a URL'))),
        [],
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(
            api.getAmazonTagEntries(
                'https://www.amazon.com/?tag=one-20&tag=two-20',
            ),
        )),
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
            {
                url: 'https://www.amazon.com/?tag=existing-20',
            },
            {
                description: 'New account',
                url: 'https://www.amazon.com/?tag=new-20',
            },
        ],
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(added)),
        [
            {tag: 'existing-20', description: 'My account', url: 'https://www.amazon.com/?tag=existing-20'},
            {tag: 'new-20', description: 'New account', url: 'https://www.amazon.com/?tag=new-20'},
        ],
    );
    assert.equal(added.length, 2);

    const updated = await api.mutateStoredTags({
        type: 'updateMany',
        updates: [{
            oldTag: 'new-20',
            description: 'Renamed',
            url: 'https://www.amazon.com/?tag=renamed-20',
        }],
    });
    assert.equal(updated[1].tag, 'renamed-20');
    assert.equal(updated[1].description, 'Renamed');

    const deleted = await api.mutateStoredTags({
        type: 'delete',
        tag: 'existing-20',
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(deleted)),
        [{
            tag: 'renamed-20',
            description: 'Renamed',
            url: 'https://www.amazon.com/?tag=renamed-20',
        }],
    );
    assert.deepEqual(storage.savedTags, deleted);
    assert.equal(storage.lastAccessedTag, null);
});

test('captures full URLs, preserves an existing URL, and updates last access time', async () => {
    const savedUrl = 'https://www.amazon.com/dp/original?tag=existing-20';
    const {api, storage} = createBackgroundHarness({
        savedTags: [{
            tag: 'existing-20',
            description: 'Account',
            url: savedUrl,
            lastAccessed: '',
        }],
    });
    const visitedUrl = 'https://www.amazon.com/dp/another?tag=new-20';

    assert.deepEqual(
        JSON.parse(JSON.stringify(api.getAmazonTagEntries(visitedUrl))),
        [{tag: 'new-20', url: visitedUrl}],
    );
    await api.mutateStoredTags({
        type: 'discover',
        tags: api.getAmazonTagEntries(visitedUrl),
    });

    assert.equal(storage.savedTags[0].url, savedUrl);
    assert.equal(storage.savedTags[0].lastAccessed, undefined);
    assert.equal(storage.savedTags[1].tag, 'new-20');
    assert.equal(storage.savedTags[1].url, visitedUrl);
    assert.equal(storage.lastAccessedTag.tag, 'new-20');
    assert.ok(Date.parse(storage.lastAccessedTag.lastAccessed));
});

test('records extension access and requires valid URLs', async () => {
    const originalUrl = 'https://www.amazon.com/dp/item?tag=account-20';
    const {api, storage, chrome} = createBackgroundHarness({
        savedTags: [{tag: 'account-20', url: originalUrl}],
    });

    await api.mutateStoredTags({type: 'access', tag: 'account-20'});
    assert.equal(storage.lastAccessedTag.tag, 'account-20');
    assert.ok(Date.parse(storage.lastAccessedTag.lastAccessed));
    const expiry = chrome.alarms.scheduled['affiliate-tag-access-expiry'].when;
    assert.ok(expiry > Date.now());
    assert.ok(expiry <= Date.now() + 24 * 60 * 60 * 1000);

    await assert.rejects(
        api.mutateStoredTags({
            type: 'updateMany',
            updates: [{
                oldTag: 'account-20',
                url: 'https://www.amazon.com/dp/item?tag=renamed-20&tag=other-20',
            }],
        }),
        /invalidAmazonTagUrl/,
    );
    await assert.rejects(
        api.mutateStoredTags({
            type: 'add',
            tags: [{tag: 'other-20', url: originalUrl}],
        }),
        /invalidAmazonTagUrl/,
    );
    await assert.rejects(
        api.mutateStoredTags({
            type: 'add',
            tags: [{
                url: 'https://www.amazon.com/?tag=first-20&tag=second-20',
            }],
        }),
        /invalidAmazonTagUrl/,
    );
});

test('stores one last-access record only after main-frame navigation completes', async () => {
    const previousAccess = '2026-01-02T03:04:05.000Z';
    const validUrl = 'https://www.amazon.com/dp/item?tag=account-20';
    const {storage, chrome} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: validUrl,
        }],
        lastAccessedTag: {tag: 'previous-20', lastAccessed: previousAccess},
    });

    await chrome.tabs.onActivated.listener({tabId: 1});
    await chrome.tabs.onUpdated.listener(1, {url: validUrl}, {url: validUrl});
    assert.deepEqual(storage.lastAccessedTag, {
        tag: 'previous-20',
        lastAccessed: previousAccess,
    });

    await chrome.tabs.onUpdated.listener(
        1,
        {status: 'complete'},
        {url: validUrl, active: false},
    );
    assert.deepEqual(storage.lastAccessedTag, {
        tag: 'previous-20',
        lastAccessed: previousAccess,
    });

    await chrome.webNavigation.onCompleted.listener({
        frameId: 1,
        url: validUrl,
    });
    assert.deepEqual(storage.lastAccessedTag, {
        tag: 'previous-20',
        lastAccessed: previousAccess,
    });

    await chrome.webNavigation.onCompleted.listener({
        frameId: 0,
        url: validUrl,
    });
    assert.notEqual(storage.lastAccessedTag.lastAccessed, previousAccess);
    assert.equal(storage.lastAccessedTag.tag, 'account-20');
    assert.ok(Date.parse(storage.lastAccessedTag.lastAccessed));
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
                {
                    oldTag: 'first-20',
                    url: 'https://www.amazon.com/?tag=same-20',
                },
                {
                    oldTag: 'second-20',
                    url: 'https://www.amazon.com/?tag=same-20',
                },
            ],
        }),
        /duplicateKeysResult/,
    );
    assert.deepEqual(storage.savedTags, original);
});

test('deletes all tags from storage', async () => {
    const {api, storage} = createBackgroundHarness({
        savedTags: [{tag: 'account-20', description: ''}],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: '2026-01-02T03:04:05.000Z',
        },
    });

    const result = await api.mutateStoredTags({type: 'deleteAll'});

    assert.deepEqual(JSON.parse(JSON.stringify(result)), []);
    assert.equal(Object.hasOwn(storage, 'savedTags'), false);
    assert.equal(Object.hasOwn(storage, 'lastAccessedTag'), false);
});

test('sets a green check for a valid saved affiliate URL', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: 'https://www.amazon.com/dp/item?tag=account-20',
        }],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: new Date().toISOString(),
        },
    });

    await api.updateBadge('https://www.amazon.com/dp/item?tag=account-20');
    assert.deepEqual(badgeCalls, [
        {type: 'text', text: '✓'},
        {type: 'text-color', color: '#ffffff'},
        {type: 'color', color: '#188038'},
        {type: 'title', title: 'badgeStatusValid'},
    ]);
});

test('shows yellow for a bare Amazon URL with a saved, unexpired last-access key', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            description: 'Account',
            url: 'https://www.amazon.com/dp/item?tag=account-20',
        }],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: new Date().toISOString(),
        },
    });

    await api.updateBadge('https://www.amazon.com/');
    assert.equal(badgeCalls[0].text, '!');
    assert.equal(badgeCalls[2].color, '#f9ab00');
    assert.equal(badgeCalls[3].title, 'badgeStatusDifferentKey');
});

test('shows yellow for a saved inferred key until its last-access time expires', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: 'https://www.amazon.com/dp/item?tag=account-20',
        }],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
        },
    });

    await api.updateBadge('https://www.amazon.com/');
    assert.equal(badgeCalls[0].text, '!');
    assert.equal(badgeCalls[2].color, '#f9ab00');
    assert.equal(badgeCalls[3].title, 'badgeStatusDifferentKey');
});

test('shows red for a saved inferred key after its last-access time expires', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: 'https://www.amazon.com/dp/item?tag=account-20',
        }],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
    });

    await api.updateBadge('https://www.amazon.com/');
    assert.equal(badgeCalls[0].text, 'x');
    assert.equal(badgeCalls[2].color, '#d93025');
    assert.equal(badgeCalls[3].title, 'badgeStatusExpired');
});

test('sets a yellow exclamation mark when a valid saved key differs from the last accessed key', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'second-20',
            url: 'https://www.amazon.com/?tag=second-20',
        }],
        lastAccessedTag: {
            tag: 'account-20',
            lastAccessed: '2025-01-01T00:00:00.000Z',
        },
    });

    await api.updateBadge('https://www.amazon.com/?tag=second-20');
    assert.equal(badgeCalls[0].text, '!');
    assert.equal(badgeCalls[2].color, '#f9ab00');
    assert.equal(badgeCalls[3].title, 'badgeStatusDifferentKey');
});

test('sets a red x for missing or unsaved tags', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: 'https://www.amazon.com/?tag=account-20',
        }],
    });

    await api.updateBadge('https://www.amazon.com/');
    assert.equal(badgeCalls[0].text, 'x');
    assert.equal(badgeCalls[3].title, 'badgeStatusInvalid');

    badgeCalls.length = 0;
    await api.updateBadge('https://www.amazon.com/?tag=');
    assert.equal(badgeCalls[0].text, 'x');
    assert.equal(badgeCalls[3].title, 'badgeStatusInvalid');

    badgeCalls.length = 0;
    await api.updateBadge('https://www.amazon.com/?tag=unknown-20');
    assert.equal(badgeCalls[0].text, 'x');
    assert.equal(badgeCalls[3].title, 'badgeStatusInvalid');
});

test('hides the badge for unsupported domains', async () => {
    const {api, badgeCalls} = createBackgroundHarness({
        savedTags: [{
            tag: 'account-20',
            url: 'https://www.amazon.com/?tag=account-20',
        }],
    });

    await api.updateBadge('https://example.com/');
    assert.deepEqual(badgeCalls, [
        {type: 'text', text: ''},
        {type: 'title', title: 'appName'},
    ]);
});
