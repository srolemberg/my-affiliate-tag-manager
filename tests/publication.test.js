const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {describe, test} = require('node:test');

const root = path.join(__dirname, '..');
const localeDirectory = path.join(root, '_locales');
const locales = fs.readdirSync(localeDirectory, {withFileTypes: true})
    .filter((entry) => (
        entry.isDirectory() &&
        fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json'))
    ))
    .map((entry) => entry.name);
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
);
const localizedMarkupFiles = ['popup.html', 'options.html', 'footer.html'];
const localizedScriptFiles = [
    'background.js',
    'footer.js',
    'i18n.js',
    'options.js',
    'popup.js',
];

function collectLocalizationReferences() {
    const references = new Set();
    const markupPattern = /data-i18n(?:-[a-z-]+)?=["']([^"']+)["']/g;
    const scriptPattern = /chrome\.i18n\.getMessage\(\s*["']([^"']+)["']/g;
    const manifestPattern = /__MSG_([^_]+)__/g;

    for (const fileName of localizedMarkupFiles) {
        const markup = fs.readFileSync(path.join(root, fileName), 'utf8');
        for (const match of markup.matchAll(markupPattern)) {
            references.add(match[1]);
        }
    }
    for (const fileName of localizedScriptFiles) {
        const source = fs.readFileSync(path.join(root, fileName), 'utf8');
        for (const match of source.matchAll(scriptPattern)) {
            references.add(match[1]);
        }
    }
    for (const match of JSON.stringify(manifest).matchAll(manifestPattern)) {
        references.add(match[1]);
    }
    return references;
}

describe('extension permissions and privacy information', () => {
    test('should request only used browser permissions when the extension manifest is loaded', () => {
        assert.equal(manifest.permissions.includes('activeTab'), false);
        assert.equal(manifest.permissions.includes('tabs'), true);
        assert.equal(manifest.permissions.includes('storage'), true);
        assert.equal(manifest.permissions.includes('webNavigation'), true);
        assert.equal(manifest.permissions.includes('alarms'), true);
    });

    test('should describe extension functionality in every available locale when the manifest is localized', () => {
        for (const locale of locales) {
            const messages = JSON.parse(
                fs.readFileSync(
                    path.join(root, '_locales', locale, 'messages.json'),
                    'utf8',
                ),
            );
            assert.match(messages.appName.message, /\S/, `${locale} app name`);
            assert.match(
                messages.appDescription.message,
                /Amazon/i,
                `${locale} app description`,
            );
            assert.ok(
                messages.privacyPolicyLink?.message,
                `${locale} privacy policy link label`,
            );
        }
    });

    test('should define every referenced localization key and matching placeholders in every locale', () => {
        const messagesByLocale = new Map(locales.map((locale) => [
            locale,
            JSON.parse(fs.readFileSync(
                path.join(root, '_locales', locale, 'messages.json'),
                'utf8',
            )),
        ]));
        const [baseLocale, baseMessages] = messagesByLocale.entries().next().value;
        const expectedKeys = Object.keys(baseMessages).sort();
        const references = collectLocalizationReferences();

        for (const [locale, messages] of messagesByLocale) {
            assert.deepEqual(
                Object.keys(messages).sort(),
                expectedKeys,
                `${locale} defines the same message identifiers as ${baseLocale}`,
            );
            for (const key of references) {
                assert.equal(
                    typeof messages[key]?.message,
                    'string',
                    `${locale} defines referenced message ${key}`,
                );
            }
            for (const key of expectedKeys) {
                assert.deepEqual(
                    Object.keys(messages[key].placeholders ?? {}).sort(),
                    Object.keys(baseMessages[key].placeholders ?? {}).sort(),
                    `${locale} uses the same placeholders for ${key}`,
                );
            }
        }
    });

    test('should explain local storage and browser navigation when users read the privacy policy', () => {
        const policy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
        assert.match(policy, /chrome\.storage\.local/);
        assert.match(policy, /not sent/i);
        assert.match(policy, /delete/i);
    });

    test('should link to the configured privacy policy when users open the popup', () => {
        const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
        assert.match(
            popup,
            /gist\.githubusercontent\.com\/srolemberg\/3c63430f265ed88fd8774c147da845ba\/raw\/cf3e2fd92779a8e687a3849d79a4d2f14349468b\/gistfile1\.txt/,
        );
    });
});
