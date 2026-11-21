/** Ensures the release allowlist follows all runtime file references. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const packageDefinition = require('../scripts/extension-package.json');
const {
    getRequiredFiles,
    validatePackageDefinition,
} = require('../scripts/validate-extension-package');

const root = path.join(__dirname, '..');

test('release allowlist includes every manifest, HTML, and localization dependency', () => {
    const result = validatePackageDefinition(
        packageDefinition.files,
        packageDefinition.directories,
    );
    assert.deepEqual(result, {
        missingFiles: [],
        missingSourceFiles: [],
        missingDirectories: [],
        invalidFiles: [],
        invalidDirectories: [],
        unneededFiles: [],
        unneededDirectories: [],
    });
});

test('package validation detects a newly required file omitted from its allowlist', () => {
    const requiredFiles = getRequiredFiles();
    assert.ok(requiredFiles.has('background.js'));

    const result = validatePackageDefinition(
        packageDefinition.files.filter((file) => file !== 'background.js'),
        packageDefinition.directories,
    );
    assert.ok(result.missingFiles.includes('background.js'));
});

test('package validation rejects unrelated files added to the release allowlist', () => {
    const result = validatePackageDefinition(
        [...packageDefinition.files, 'README.md'],
        packageDefinition.directories,
    );
    assert.ok(result.unneededFiles.includes('README.md'));
});

test('both platform packagers consume the shared allowlist and validate before archiving', () => {
    for (const script of ['package-extension.ps1', 'package-extension.sh']) {
        const source = fs.readFileSync(
            path.join(root, 'scripts', script),
            'utf8',
        );
        assert.match(source, /extension-package\.json/);
        assert.match(source, /validate-extension-package\.js/);
        assert.ok(
            source.indexOf('validate-extension-package.js') <
                source.search(/CreateEntry|zip -qr/),
            `${script} must validate before creating the archive`,
        );
    }
});
