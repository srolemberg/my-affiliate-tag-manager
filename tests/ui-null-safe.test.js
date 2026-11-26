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
});
