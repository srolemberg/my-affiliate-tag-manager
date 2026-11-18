/** Verifies UI scripts handle missing DOM nodes without null dereferences. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
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

for (const fileName of ['i18n.js', 'popup.js', 'options.js', 'footer.js']) {
    test(`${fileName} starts safely when expected DOM elements are missing`, () => {
        assert.doesNotThrow(() => runUiScript(fileName));
    });
}
