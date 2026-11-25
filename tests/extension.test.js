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
        assert.match(
            await optionsPage.evaluate(() => document.documentElement.className),
            /^(light|dark)(-(medium|high)-contrast)?$/,
            'selects a Material 3 color and contrast palette',
        );
        assert.notEqual(
            await optionsPage.evaluate(
                () => getComputedStyle(document.body).backgroundColor,
            ),
            'rgba(0, 0, 0, 0)',
            'loads the local Material 3 surface styles',
        );
        assert.equal(
            await optionsPage.evaluate(
                () => getComputedStyle(document.querySelector('#add-button'), '::before').transitionDuration,
            ),
            '0.15s',
            'loads Material 3 button state-layer transitions',
        );
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
        await optionsPage.evaluate(async () => {
            await chrome.storage.local.set({
                lastAccessedTag: {
                    tag: 'puppeteer-check-20',
                    lastAccessed: '2026-11-25T12:34:56.000Z',
                },
            });
        });

        const popupPage = await browser.newPage();
        popupPage.on('pageerror', (error) => pageErrors.push(error));
        await optionsPage.close();
        await popupPage.goto(
            `chrome-extension://${extensionId}/popup.html`,
            {waitUntil: 'domcontentloaded'},
        );
        await popupPage.waitForSelector(
            '#saved-tag-menu [data-tag="puppeteer-check-20"]',
        );
        assert.equal(await popupPage.$('input#saved-tag'), null);
        assert.equal(await popupPage.$('label[for="saved-tag"]'), null);
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => (
                getComputedStyle(button).borderRadius
            )),
            '16px',
            'renders the tonal trigger with the reference corner radius',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => (
                getComputedStyle(button).height
            )),
            '48px',
            'renders the tonal trigger at medium size',
        );
        assert.equal(await popupPage.$eval('#saved-tag-button svg', (icon) => (
            icon.querySelector('path')?.getAttribute('d').includes('9-9A2')
        )), true, 'uses a Material tag icon');
        assert.equal(
            await popupPage.$eval(
                '#saved-tag-button-label',
                (label) => label.textContent,
            ),
            'Selecione uma tag',
            'shows the default selection prompt on the button',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => button.title),
            'Selecione uma tag',
            'provides a tooltip for the saved-tag picker',
        );
        assert.deepEqual(
            await popupPage.$$eval(
                '.open-buttons button',
                (buttons) => buttons.map((button) => button.title),
            ),
            ['Abrir na aba atual', 'Abrir em nova aba'],
            'provides a tooltip for each URL-opening button',
        );
        const tagButtonWidth = await popupPage.$eval(
            '#saved-tag-button',
            (button) => button.getBoundingClientRect().width,
        );
        await popupPage.click('#saved-tag-button');
        await popupPage.waitForSelector('#saved-tag-button > .md-ripple');
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => (
                button.getBoundingClientRect().width
            )),
            tagButtonWidth,
            'keeps the tag button width fixed while its ripple is active',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-menu', (menu) => menu.hidden),
            false,
            'opens the saved-tag menu from the button',
        );
        assert.equal(
            await popupPage.$eval(
                '#saved-tag-menu [data-tag="puppeteer-check-20"]',
                (option) => option.textContent,
            ),
            'Puppeteer smoke test',
            'shows the same saved-tag label as the former dropdown',
        );
        assert.equal(
            await popupPage.$eval(
                '#saved-tag-menu [data-tag="puppeteer-check-20"]',
                (option) => option.title,
            ),
            'Puppeteer smoke test',
            'provides a tooltip for each saved-tag menu item',
        );
        await popupPage.click('#saved-tag-menu [data-tag="puppeteer-check-20"]');
        assert.equal(
            await popupPage.$eval(
                '#saved-tag-button-label',
                (label) => label.textContent,
            ),
            'Puppeteer smoke test',
            'updates the button label with the selected tag label',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => button.title),
            'Puppeteer smoke test',
            'updates the picker tooltip to match the selected tag',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-menu', (menu) => menu.hidden),
            true,
            'closes the menu after choosing a tag',
        );
        assert.equal(
            await popupPage.$eval('#open-new-tab-button', (button) => button.disabled),
            false,
            'enables URL actions after selecting a valid tag',
        );
        assert.deepEqual(
            await popupPage.$$eval(
                '.open-buttons button',
                (buttons) => buttons.map((button) => ({
                    borderRadius: getComputedStyle(button).borderRadius,
                    height: getComputedStyle(button).height,
                    iconCount: button.querySelectorAll('svg').length,
                })),
            ),
            [
                {borderRadius: '999px', height: '48px', iconCount: 0},
                {borderRadius: '999px', height: '48px', iconCount: 0},
            ],
            'renders both tab-opening actions as medium round text-only buttons',
        );
        await popupPage.evaluate(() => {
            const button = document.createElement('button');
            button.id = 'interaction-test-button';
            button.textContent = 'Interaction test';
            button.style.position = 'fixed';
            button.style.left = '0';
            button.style.top = '0';
            document.body.append(button);
        });
        await popupPage.hover('#interaction-test-button');
        await popupPage.waitForFunction(
            () => getComputedStyle(
                document.querySelector('#interaction-test-button'),
                '::before',
            ).opacity === '0.08',
        );
        assert.equal(
            await popupPage.$eval(
                '#interaction-test-button',
                (button) => getComputedStyle(button, '::before').opacity,
            ),
            '0.08',
            'shows the Material 3 hover state layer',
        );
        const supportsReducedMotion = await popupPage.evaluate(
            () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
        await popupPage.mouse.down();
        if (!supportsReducedMotion) {
            await popupPage.waitForSelector(
                '#interaction-test-button > .md-ripple',
            );
        }
        await popupPage.mouse.up();
        if (!supportsReducedMotion) {
            await popupPage.waitForFunction(
                () => !document.querySelector('#interaction-test-button > .md-ripple'),
                {timeout: 2000},
            );
        }
        await popupPage.evaluate(() => {
            const button = document.getElementById('interaction-test-button');
            button.remove();
        });
        assert.equal(
            await popupPage.$eval('.last-access-card', (card) => (
                getComputedStyle(card).height
            )),
            '80px',
            'renders the last-access card at medium height',
        );
        assert.equal(
            await popupPage.$eval('.last-access-avatar', (avatar) => (
                getComputedStyle(avatar).height
            )),
            '40px',
            'renders the card avatar at medium size',
        );
        assert.equal(
            await popupPage.$eval('#last-access-title', (element) => element.textContent),
            'puppeteer-check-20',
            'shows the accessed tag as the card title',
        );
        assert.equal(
            await popupPage.$eval('#last-access-avatar', (element) => element.textContent),
            'P',
            'uses the saved description initial for the avatar',
        );
        assert.match(
            await popupPage.$eval('#last-access-subtitle', (element) => element.textContent),
            /Last accessed:|Último acesso:/,
            'shows localized last-access details in the card subtitle',
        );
        const badgeLegendCodePoints = await popupPage.$$eval(
            '.badge-legend-symbol',
            (elements) => elements.map((element) => element.textContent.codePointAt(0)),
        );
        assert.equal(
            await popupPage.$eval(
                '.popup-app-bar h1',
                (heading) => heading.textContent.trim().length > 0,
            ),
            true,
            'renders the app title in the app bar',
        );
        assert.equal(await popupPage.$('#open-settings-button') !== null, true);
        assert.equal(
            await popupPage.$eval(
                '#open-settings-button',
                (button) => button.title,
            ),
            'Configurações',
            'provides the localized settings tooltip',
        );
        assert.equal(await popupPage.$('#manage-tags-link'), null);
        assert.equal(
            await popupPage.$$eval('body > h1', (headings) => headings.length),
            0,
            'does not render a separate legacy title',
        );
        assert.deepEqual(
            badgeLegendCodePoints,
            [0x2713, 0x0021, 0x2717],
            'popup legend must render the exact success, alert, and error code points',
        );
        const settingsTargetPromise = browser.waitForTarget(
            (target) => target.url() === `chrome-extension://${extensionId}/options.html`,
            {timeout: 10000},
        );
        await popupPage.click('#open-settings-button');
        const settingsTarget = await settingsTargetPromise;
        const settingsPage = await settingsTarget.page();
        await settingsPage.waitForSelector('#add-form');
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
    }
});
