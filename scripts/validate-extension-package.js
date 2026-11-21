const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
);
const packageDefinition = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'extension-package.json'), 'utf8'),
);

function collectManifestFiles(value, key, requiredFiles) {
    if (typeof value === 'string') {
        if (
            ['service_worker', 'default_popup', 'page', 'devtools_page'].includes(key) ||
            key === 'default_path' ||
            key === 'js' ||
            key === 'css' ||
            key === 'resources' ||
            key === 'icons' ||
            key === 'default_icon'
        ) {
            if (value.includes('*')) {
                throw new Error(
                    `Manifest resource pattern requires explicit package validation: ${value}`,
                );
            }
            requiredFiles.add(value);
        }
        return;
    }

    if (
        ['icons', 'default_icon'].includes(key) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        for (const file of Object.values(value)) {
            if (typeof file === 'string') {
                requiredFiles.add(file);
            }
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectManifestFiles(entry, key, requiredFiles);
        }
        return;
    }

    if (value && typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) {
            collectManifestFiles(childValue, childKey, requiredFiles);
        }
    }
}

function getLocalReference(reference, sourceFile) {
    const trimmed = reference.trim();
    if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('//') ||
        /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ) {
        return null;
    }

    const pathname = decodeURIComponent(trimmed.split(/[?#]/, 1)[0]);
    const resolved = path.posix.normalize(pathname.startsWith('/')
        ? pathname.replace(/^\/+/, '')
        : path.posix.join(path.posix.dirname(sourceFile), pathname));
    if (resolved === '..' || resolved.startsWith('../')) {
        throw new Error(`Local resource escapes the extension root: ${reference}`);
    }
    return resolved;
}

function collectStylesheet(sourceFile, visitedStylesheets, requiredFiles) {
    if (visitedStylesheets.has(sourceFile)) {
        return;
    }
    visitedStylesheets.add(sourceFile);

    const fullPath = path.join(root, ...sourceFile.split('/'));
    if (!fs.existsSync(fullPath)) {
        return;
    }
    const css = fs.readFileSync(fullPath, 'utf8');
    const references = [
        ...css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi),
        ...css.matchAll(/@import\s+(["'])(.*?)\1/gi),
    ];
    for (const [, , reference] of references) {
        const localFile = getLocalReference(reference, sourceFile);
        if (!localFile) {
            continue;
        }
        requiredFiles.add(localFile);
        if (localFile.endsWith('.css')) {
            collectStylesheet(localFile, visitedStylesheets, requiredFiles);
        }
    }
}

function collectHtmlFiles(sourceFile, visitedHtml, visitedStylesheets, requiredFiles) {
    if (visitedHtml.has(sourceFile)) {
        return;
    }
    visitedHtml.add(sourceFile);

    const fullPath = path.join(root, ...sourceFile.split('/'));
    if (!fs.existsSync(fullPath)) {
        return;
    }
    const html = fs.readFileSync(fullPath, 'utf8');
    for (const [, , source] of html.matchAll(
        /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi,
    )) {
        if (!getLocalReference(source, sourceFile)) {
            throw new Error(
                `Non-local script reference is not allowed in ${sourceFile}: ${source}`,
            );
        }
    }
    const references = [
        ...html.matchAll(/\b(?:src|href|poster|data)\s*=\s*(["'])(.*?)\1/gi),
        ...html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi),
    ];

    for (const [, , reference] of references) {
        const localFile = getLocalReference(reference, sourceFile);
        if (!localFile) {
            continue;
        }
        requiredFiles.add(localFile);
        if (localFile.endsWith('.html')) {
            collectHtmlFiles(
                localFile,
                visitedHtml,
                visitedStylesheets,
                requiredFiles,
            );
        } else if (localFile.endsWith('.css')) {
            collectStylesheet(localFile, visitedStylesheets, requiredFiles);
        }
    }
}

function getRequiredFiles() {
    const requiredFiles = new Set(['manifest.json']);
    collectManifestFiles(manifest, '', requiredFiles);
    requiredFiles.add(
        path.posix.join('_locales', manifest.default_locale, 'messages.json'),
    );
    const htmlPages = new Set(
        [...requiredFiles].filter((file) => file.endsWith('.html')),
    );
    const visitedHtml = new Set();
    const visitedStylesheets = new Set();
    for (const htmlPage of htmlPages) {
        collectHtmlFiles(
            htmlPage,
            visitedHtml,
            visitedStylesheets,
            requiredFiles,
        );
    }
    return requiredFiles;
}

function validatePackageDefinition(files, directories) {
    const packagedFiles = new Set(files);
    const packagedDirectories = new Set(directories);
    const requiredFiles = getRequiredFiles();
    const missingFiles = [...requiredFiles].filter((file) => (
        !packagedFiles.has(file) &&
        ![...packagedDirectories].some((directory) => (
            file.startsWith(`${directory}/`)
        ))
    ));
    const missingSourceFiles = [...requiredFiles].filter((file) => (
        !fs.existsSync(path.join(root, ...file.split('/')))
    ));
    const missingDirectories = [
        '_locales',
        `_locales/${manifest.default_locale}`,
    ].filter((directory) => !packagedDirectories.has(directory) &&
        !packagedDirectories.has(path.posix.dirname(directory)));
    const invalidFiles = [...packagedFiles].filter((file) => {
        const fullPath = path.join(root, ...file.split('/'));
        return !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile();
    });
    const invalidDirectories = [...packagedDirectories].filter((directory) => {
        const fullPath = path.join(root, ...directory.split('/'));
        return !fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory();
    });
    const unneededFiles = [...packagedFiles].filter((file) => !requiredFiles.has(file));
    const unneededDirectories = [...packagedDirectories].filter(
        (directory) => directory !== '_locales',
    );

    return {
        missingFiles,
        missingSourceFiles,
        missingDirectories,
        invalidFiles,
        invalidDirectories,
        unneededFiles,
        unneededDirectories,
    };
}

function validate() {
    const result = validatePackageDefinition(
        packageDefinition.files,
        packageDefinition.directories,
    );
    const failures = Object.entries(result)
        .filter(([, values]) => values.length > 0)
        .map(([name, values]) => `${name}: ${values.join(', ')}`);
    if (failures.length > 0) {
        throw new Error(`Extension package definition is out of date:\n${failures.join('\n')}`);
    }
}

if (require.main === module) {
    try {
        validate();
        console.log('Extension package definition covers all required local resources.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {getRequiredFiles, validatePackageDefinition};
