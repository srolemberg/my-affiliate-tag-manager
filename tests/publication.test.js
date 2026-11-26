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
