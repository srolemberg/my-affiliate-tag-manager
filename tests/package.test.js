/** Ensures the release allowlist follows all runtime file references. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {describe, test} = require('node:test');
const packageDefinition = require('../scripts/extension-package.json');
const {
    getRequiredFiles,
    validatePackageDefinition,
} = require('../scripts/validate-extension-package');

const root = path.join(__dirname, '..');

describe('release package validation', () => {
    test('should include every manifest, HTML, and locale dependency when validating the release allowlist', () => {
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

    test('should report a missing package file when a required resource is omitted from the allowlist', () => {
        const requiredFiles = getRequiredFiles();
        assert.ok(requiredFiles.has('background.js'));

        const result = validatePackageDefinition(
            packageDefinition.files.filter((file) => file !== 'background.js'),
            packageDefinition.directories,
        );
        assert.ok(result.missingFiles.includes('background.js'));
    });

    test('should reject unrelated package files when they are added to the release allowlist', () => {
        const result = validatePackageDefinition(
            [...packageDefinition.files, 'README.md'],
            packageDefinition.directories,
        );
        assert.ok(result.unneededFiles.includes('README.md'));
    });

    test('should validate the shared allowlist before either platform packager creates an archive', () => {
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
});
