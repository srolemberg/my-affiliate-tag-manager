/** Verifies UI scripts handle missing DOM nodes without null dereferences. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {describe, test} = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function runUiScript(fileName) {
    const source = fs.readFileSync(path.join(root, fileName), 'utf8');
    const context = {
        console: {error() {}},
        document: {
            getElementById() {
                return null;
            },
            querySelectorAll() {
                return [];
            },
        },
        chrome: {
            i18n: {
                getMessage() {
                    return '';
                },
            },
            runtime: {
                getManifest() {
                    return {};
                },
            },
            storage: {
                onChanged: {
                    addListener() {},
                },
            },
        },
    };
    vm.runInNewContext(source, context, {filename: fileName});
}

function createOptionsHarness(locale, {
    failSavedTagsRead = false,
    failThemeRead = false,
    failThemeWrite = false,
    themePreference = 'system',
    initialSavedTags = [],
} = {}) {
    const messages = JSON.parse(
        fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'),
    );
    const ids = [
        'tag-list', 'add-form', 'new-description', 'new-url', 'new-tag-preview',
        'add-error', 'add-button', 'import-file', 'import-button', 'status',
        'save-tags-button', 'export-button', 'delete-all-button', 'theme-system',
        'theme-light', 'theme-dark',
    ];
    const elements = new Map(ids.map((id) => [id, {
        id,
        value: id === 'theme-system' ? 'system' : id === 'theme-light' ? 'light' : id === 'theme-dark' ? 'dark' : '',
        checked: id === 'theme-system',
        dataset: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        replaceChildren() { this.children = []; },
        append(...children) { (this.children ??= []).push(...children); },
    }]));
    const storageChanged = {addListener(listener) { this.listener = listener; }};
    const context = vm.createContext({
        console: {error() {}},
        document: {
            getElementById(id) { return elements.get(id) || null; },
            createElement(tagName) {
                return {
                    tagName: tagName.toUpperCase(),
                    dataset: {},
                    setAttribute() {},
                    append() {},
                    click() {},
                };
            },
        },
        chrome: {
            i18n: {
                getMessage(key, substitution) {
                    const message = messages[key]?.message ?? '';
                    return substitution === undefined
                        ? message
                        : message.replace('$1', String(substitution));
                },
            },
            runtime: {sendMessage: async () => ({tags: []})},
            storage: {
                onChanged: storageChanged,
                local: {
                    async get(key) {
                        if (key === 'savedTags') {
                            if (failSavedTagsRead) throw new Error('storage unavailable');
                            return {savedTags: initialSavedTags};
                        }
                        if (failThemeRead) throw new Error('storage unavailable');
                        return {themePreference};
                    },
                    async set() {
                        if (failThemeWrite) throw new Error('storage unavailable');
                    },
                },
            },
        },
        normalizeTagEntries: (entries) => entries ?? [],
        getTagFromAmazonUrl: () => '',
        isValidAmazonTagUrl: () => false,
        getErrorMessage: (error) => error.message,
        window: {confirm: () => true},
        URL: {
            createObjectURL(blob) {
                context.exportBlob = blob;
                return 'blob:options-export-test';
            },
            revokeObjectURL() {},
        },
        Blob,
        setTimeout,
    });
    vm.runInContext(
        fs.readFileSync(path.join(root, 'options.js'), 'utf8'),
        context,
        {filename: 'options.js'},
    );
    return {elements, storageChanged, context};
}

async function waitForStatus(status) {
    for (let attempt = 0; attempt < 20 && !status.textContent; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function createPopupHarness(locale, {failTabRead = false, failStorageRead = false} = {}) {
    const messages = JSON.parse(
        fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'),
    );
    const ids = [
        'last-access-avatar', 'last-access-title', 'last-access-subtitle',
        'saved-tag-button', 'saved-tag-button-label', 'saved-tag-menu',
        'open-current-tab-button', 'open-new-tab-button', 'open-settings-button', 'status',
    ];
    const elements = new Map(ids.map((id) => [id, {
        id,
        dataset: {},
        disabled: false,
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this[name] = value; },
        append() {},
    }]));
    const context = vm.createContext({
        console: {error() {}},
        document: {
            getElementById(id) { return elements.get(id) || null; },
            querySelector() { return null; },
            addEventListener() {},
            createElement() { return {dataset: {}, setAttribute() {}}; },
        },
        chrome: {
            i18n: {getMessage: (key) => messages[key]?.message ?? ''},
            tabs: {
                async query() {
                    if (failTabRead) throw new Error('tab access unavailable');
                    return [];
                },
            },
            storage: {local: {async get() {
                if (failStorageRead) throw new Error('storage unavailable');
                return {savedTags: [], lastAccessedTag: null};
            }}},
            runtime: {openOptionsPage: async () => {}},
        },
        normalizeTagEntries: () => [],
        isValidAmazonTagUrl: () => true,
        getLatestAccessRecord: () => null,
        getErrorMessage: (error) => error.message,
        window: {close() {}},
        Intl,
        Date,
        Number,
    });
    vm.runInContext(
        fs.readFileSync(path.join(root, 'popup.js'), 'utf8'),
        context,
        {filename: 'popup.js'},
    );
    return {elements};
}

describe('extension interface behavior', () => {
    for (const fileName of ['i18n.js', 'popup.js', 'options.js', 'footer.js']) {
        test(`should start ${fileName} safely when expected DOM elements are missing`, () => {
            assert.doesNotThrow(() => runUiScript(fileName));
        });
    }

    test('should open the JSON file picker when the options import action is clicked', () => {
        const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
        const elementIds = [
            'tag-list',
            'add-form',
            'new-description',
            'new-url',
            'new-tag-preview',
            'add-error',
            'add-button',
            'import-file',
            'import-button',
            'status',
            'save-tags-button',
            'export-button',
            'delete-all-button',
            'theme-system',
            'theme-light',
            'theme-dark',
        ];
        const elements = new Map(elementIds.map((id) => [id, {
            addEventListener(type, listener) {
                this.listeners ??= {};
                this.listeners[type] = listener;
            },
            click() {
                this.clickCount = (this.clickCount || 0) + 1;
            },
        }]));
        const context = {
            console: {error() {}},
            document: {
                getElementById(id) {
                    return elements.get(id) || null;
                },
                createElement() {
                    return {};
                },
            },
            chrome: {
                i18n: {getMessage: () => ''},
                runtime: {sendMessage: async () => ({tags: []})},
                storage: {
                    local: {get: () => new Promise(() => {})},
                    onChanged: {addListener() {}},
                },
            },
        };

        vm.runInNewContext(source, context, {filename: 'options.js'});
        elements.get('import-button').listeners.click();

        assert.equal(elements.get('import-file').clickCount, 1);
    });

    test('should export saved tags without theme preferences and show localized feedback in every locale', async () => {
        const localeDirectory = path.join(root, '_locales');
        const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() &&
                fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json')))
            .map((entry) => entry.name);
        const initialSavedTags = [{
            tag: 'sample-20',
            description: 'Sample description',
            url: 'https://www.amazon.com/dp/example?tag=sample-20',
        }];

        for (const locale of locales) {
            const {elements, context} = createOptionsHarness(locale, {initialSavedTags});
            await new Promise((resolve) => setImmediate(resolve));
            elements.get('export-button').listeners.click();
            const exportedJson = await context.exportBlob.text();
            const messages = JSON.parse(fs.readFileSync(
                path.join(localeDirectory, locale, 'messages.json'), 'utf8',
            ));

            assert.deepEqual(
                JSON.parse(exportedJson),
                {version: 1, tags: initialSavedTags},
                `${locale} exports the versioned tag data without preferences`,
            );
            assert.equal(
                elements.get('status').textContent,
                messages.exportedJson.message,
                `${locale} confirms the export to the user`,
            );
        }
    });

    test('should show the localized theme loading error when local storage rejects the preference read in every locale', async () => {
        const localeDirectory = path.join(root, '_locales');
        const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() &&
                fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json')))
            .map((entry) => entry.name);

        for (const locale of locales) {
            const {elements} = createOptionsHarness(locale, {failThemeRead: true});
            const status = elements.get('status');
            await waitForStatus(status);
            const messages = JSON.parse(fs.readFileSync(
                path.join(localeDirectory, locale, 'messages.json'), 'utf8',
            ));
            assert.equal(
                status.textContent,
                messages.themePreferenceLoadError.message.replace('$1', 'storage unavailable'),
                `${locale} shows the storage failure while loading the theme preference`,
            );
        }
    });

    test('should restore the previous theme and show localized feedback when saving a preference fails in every locale', async () => {
        const localeDirectory = path.join(root, '_locales');
        const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() &&
                fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json')))
            .map((entry) => entry.name);

        for (const locale of locales) {
            const {elements} = createOptionsHarness(locale, {failThemeWrite: true});
            const system = elements.get('theme-system');
            const light = elements.get('theme-light');
            await new Promise((resolve) => setImmediate(resolve));
            system.checked = false;
            light.checked = true;
            await light.listeners.change();

            const messages = JSON.parse(fs.readFileSync(
                path.join(localeDirectory, locale, 'messages.json'), 'utf8',
            ));
            assert.equal(system.checked, true, `${locale} restores the previous theme`);
            assert.equal(
                elements.get('status').textContent,
                messages.themePreferenceSaveError.message.replace('$1', 'storage unavailable'),
                `${locale} shows the localized theme save error`,
            );
        }
    });

    test('should show the localized saved-tag loading error when local storage rejects the tag read in every locale', async () => {
        const localeDirectory = path.join(root, '_locales');
        const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() &&
                fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json')))
            .map((entry) => entry.name);

        for (const locale of locales) {
            const {elements} = createOptionsHarness(locale, {failSavedTagsRead: true});
            await waitForStatus(elements.get('status'));
            const messages = JSON.parse(fs.readFileSync(
                path.join(localeDirectory, locale, 'messages.json'), 'utf8',
            ));
            assert.equal(
                elements.get('status').textContent,
                messages.loadTagsError.message.replace('$1', 'storage unavailable'),
                `${locale} explains why saved tags could not be loaded`,
            );
        }
    });

    test('should select the system theme when storage contains no supported preference', async () => {
        for (const themePreference of [undefined, 'sepia']) {
            const {elements} = createOptionsHarness('en', {themePreference});
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(elements.get('theme-system').checked, true);
            assert.equal(elements.get('theme-light').checked, false);
            assert.equal(elements.get('theme-dark').checked, false);
        }
    });

    test('should select a theme changed by another extension page', async () => {
        const {elements, storageChanged} = createOptionsHarness('en');
        storageChanged.listener({
            themePreference: {newValue: 'dark'},
        }, 'local');
        assert.equal(elements.get('theme-dark').checked, true);

        storageChanged.listener({
            themePreference: {newValue: 'unsupported'},
        }, 'local');
        assert.equal(elements.get('theme-system').checked, true);
    });

    test('should show localized popup feedback when the active tab or saved data cannot be loaded in every locale', async () => {
        const localeDirectory = path.join(root, '_locales');
        const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() &&
                fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json')))
            .map((entry) => entry.name);

        for (const locale of locales) {
            const messages = JSON.parse(fs.readFileSync(
                path.join(localeDirectory, locale, 'messages.json'), 'utf8',
            ));
            for (const failure of [
                {failTabRead: true},
                {failStorageRead: true},
            ]) {
                const {elements} = createPopupHarness(locale, failure);
                await waitForStatus(elements.get('status'));
                assert.equal(
                    elements.get('status').textContent,
                    messages.popupLoadError.message,
                    `${locale} explains popup loading failure: ${Object.keys(failure)[0]}`,
                );
            }
        }
    });
});
