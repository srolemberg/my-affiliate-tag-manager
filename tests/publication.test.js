const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
);

test('manifest requests only permissions used by the extension', () => {
    assert.equal(manifest.permissions.includes('activeTab'), false);
    assert.equal(manifest.permissions.includes('tabs'), true);
    assert.equal(manifest.permissions.includes('storage'), true);
    assert.equal(manifest.permissions.includes('webNavigation'), true);
    assert.equal(manifest.permissions.includes('alarms'), true);
});

test('localized manifest descriptions explain the extension functionality', () => {
    const locales = ['pt_BR', 'en'];
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
            /(Amazon|tags|URLs|affiliate)/,
            `${locale} app description`,
        );
        assert.ok(
            messages.privacyPolicyLink?.message,
            `${locale} privacy policy link label`,
        );
    }
});

test('privacy policy documents local storage and browser navigation', () => {
    const policy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
    assert.match(policy, /chrome\.storage\.local/);
    assert.match(policy, /not sent/i);
    assert.match(policy, /delete/i);
});

test('popup links to the configured privacy policy', () => {
    const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    assert.match(
        popup,
        /gist\.githubusercontent\.com\/srolemberg\/3c63430f265ed88fd8774c147da845ba\/raw\/cf3e2fd92779a8e687a3849d79a4d2f14349468b\/gistfile1\.txt/,
    );
});
