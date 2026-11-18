/** Smoke-tests the unpacked extension in Chromium using Puppeteer. */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const extensionPath = path.resolve(__dirname, '..');

test('loads the extension and exercises basic options and popup flows', {
    timeout: 60000,
}, async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });
    const pageErrors = [];

    try {
        const worker = await browser.waitForTarget(
            (target) => (
                target.type() === 'service_worker' &&
                target.url().startsWith('chrome-extension://')
            ),
            {timeout: 15000},
        );
        const extensionId = new URL(worker.url()).hostname;
        const optionsPage = await browser.newPage();
        optionsPage.on('pageerror', (error) => pageErrors.push(error));
        await optionsPage.goto(
            `chrome-extension://${extensionId}/options.html`,
            {waitUntil: 'domcontentloaded'},
        );

        const manifest = await optionsPage.evaluate(
            () => chrome.runtime.getManifest(),
        );
        assert.equal(manifest.manifest_version, 3);
        assert.equal(manifest.background.service_worker, 'background.js');
        assert.equal(manifest.action.default_popup, 'popup.html');
        await optionsPage.waitForSelector('#add-form');
        assert.equal(
            await optionsPage.$eval('#add-button', (button) => button.disabled),
            true,
        );

        await optionsPage.locator('#new-url').fill('https://example.com/?tag=invalid-20');
        assert.equal(
            await optionsPage.$eval('#add-button', (button) => button.disabled),
            true,
            'rejects a tag URL outside supported Amazon domains',
        );

        await optionsPage.locator('#new-description').fill('Puppeteer smoke test');
        await optionsPage.locator('#new-url').fill(
            'https://www.amazon.com/dp/example?tag=puppeteer-check-20',
        );
        assert.equal(
            await optionsPage.$eval('#add-button', (button) => button.disabled),
            false,
        );
        await optionsPage.$eval('#add-form', (form) => form.requestSubmit());
        await optionsPage.waitForSelector(
            '#tag-list li[data-original-tag="puppeteer-check-20"]',
        );

        const popupPage = await browser.newPage();
        popupPage.on('pageerror', (error) => pageErrors.push(error));
        await popupPage.goto(
            `chrome-extension://${extensionId}/popup.html`,
            {waitUntil: 'domcontentloaded'},
        );
        await popupPage.waitForFunction(
            () => document.querySelector('#saved-tag option[value="puppeteer-check-20"]'),
        );
        assert.equal(
            await popupPage.$eval(
                '#saved-tag option[value="puppeteer-check-20"]',
                (option) => option.textContent,
            ),
            'Puppeteer smoke test',
        );
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
    }
});
