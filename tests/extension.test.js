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
        await optionsPage.waitForFunction(
            () => getComputedStyle(document.querySelector('#save-tags-button')).backgroundColor !== 'rgba(0, 0, 0, 0)',
        );
        assert.equal(
            await optionsPage.$eval('#add-form', (form) => (
                form.querySelector('.add-card-header h2[data-i18n="manualAddHeading"]') !== null &&
                form.querySelector('.add-card-header p[data-i18n="optionsIntro"]')?.textContent.trim() ===
                    'As tags encontradas em URLs da Amazon são salvas automaticamente neste navegador.' &&
                form.querySelector('.add-card-footer #add-button')?.getAttribute('title') === 'Adicionar' &&
                form.querySelectorAll('.text-field-label').length === 2
            )),
            true,
            'places the title, supporting text, floating labels, and primary action with tooltip in the add card',
        );
        assert.equal(
            await optionsPage.$eval('#import-card', (card) => (
                card.querySelector('.import-card-header h2[data-i18n="importCardHeading"]') !== null &&
                card.querySelector('.import-card-content label[for="import-file"]') !== null &&
                card.querySelector('input[type="file"]#import-file')?.getAttribute('title') ===
                    'Importar arquivo JSON (mesclar com a lista atual)'
            )),
            true,
            'groups the import heading, instructions, and file input with tooltip in a card',
        );
        assert.deepEqual(
            await optionsPage.$eval('#import-file', (input) => {
                const style = getComputedStyle(input, '::file-selector-button');
                const sample = document.createElement('span');
                sample.style.backgroundColor = 'var(--md-sys-color-primary)';
                sample.style.color = 'var(--md-sys-color-on-primary)';
                document.body.append(sample);
                const expectedBg = getComputedStyle(sample).backgroundColor;
                const expectedColor = getComputedStyle(sample).color;
                sample.remove();
                return {
                    borderRadius: style.borderRadius,
                    minHeight: style.minHeight,
                    backgroundColor: style.backgroundColor,
                    color: style.color,
                };
            }),
            await optionsPage.evaluate(() => {
                const sample = document.createElement('span');
                sample.style.backgroundColor = 'var(--md-sys-color-primary)';
                sample.style.color = 'var(--md-sys-color-on-primary)';
                document.body.append(sample);
                const expectedBg = getComputedStyle(sample).backgroundColor;
                const expectedColor = getComputedStyle(sample).color;
                sample.remove();
                return {
                    borderRadius: '20px',
                    minHeight: '40px',
                    backgroundColor: expectedBg,
                    color: expectedColor,
                };
            }),
            'styles the file chooser as a Material primary button',
        );
        assert.equal(
            await optionsPage.$eval('#saved-tags-card', (card) => (
                card.querySelector('.saved-tags-header h2[data-i18n="savedTagsHeading"]') !== null &&
                card.querySelector('.saved-tags-content #tag-list') !== null &&
                getComputedStyle(card.querySelector('.saved-tags-content')).padding === '16px' &&
                [...card.querySelector('.toolbar').querySelectorAll('button')]
                    .map((button) => button.id)
                    .join(',') === 'save-tags-button,export-button,delete-all-button' &&
                card.querySelector('#save-tags-button').classList.contains('button-primary') &&
                card.querySelector('#save-tags-button')?.getAttribute('title') === 'Salvar alterações' &&
                card.querySelector('#export-button').classList.contains('button-secondary') &&
                card.querySelector('#export-button')?.getAttribute('title') === 'Exportar JSON' &&
                card.querySelector('#delete-all-button').classList.contains('button-tertiary') &&
                card.querySelector('#delete-all-button')?.getAttribute('title') === 'Excluir todas' &&
                getComputedStyle(card.querySelector('.toolbar')).flexWrap === 'wrap'
            )),
            true,
            'places saved tag actions in the footer with tooltips and primary, secondary, and tertiary variants',
        );
        assert.deepEqual(
            await optionsPage.$$eval(
                '#saved-tags-card .toolbar button',
                (buttons) => buttons.map((button) => {
                    const style = getComputedStyle(button);
                    return {
                        background: style.backgroundColor,
                        border: style.borderColor,
                        color: style.color,
                    };
                }),
            ),
            await optionsPage.evaluate(() => {
                const color = (token) => {
                    const sample = document.createElement('span');
                    sample.style.color = `var(--md-sys-color-${token})`;
                    sample.style.backgroundColor = `var(--md-sys-color-${token})`;
                    sample.style.borderColor = `var(--md-sys-color-${token})`;
                    document.body.append(sample);
                    const result = getComputedStyle(sample).color;
                    sample.remove();
                    return result;
                };
                return [
                    {
                        background: color('primary'),
                        border: color('primary'),
                        color: color('on-primary'),
                    },
                    {
                        background: color('secondary-container'),
                        border: color('secondary-container'),
                        color: color('on-secondary-container'),
                    },
                    {
                        background: 'rgba(0, 0, 0, 0)',
                        border: color('outline'),
                        color: color('primary'),
                    },
                ];
            }),
            'uses filled, tonal, and outlined Material button styling in order',
        );
        assert.equal(
            await optionsPage.$eval(
                '.options-app-bar h1',
                (heading) => heading.textContent.trim(),
            ),
            'Minhas Tags de Afiliado',
            'uses the app name as the options-page app-bar title',
        );
        assert.equal(
            await optionsPage.$('.options-app-bar p'),
            null,
            'keeps the app bar free of supporting text',
        );
        assert.equal(
            await optionsPage.$eval('#theme-card-heading', (heading) => (
                heading.textContent.trim()
            )),
            'Tema da aplicação',
            'shows the theme control title on the card',
        );
        assert.equal(
            await optionsPage.$eval('#theme-card', (card) => (
                card.querySelector('img, svg, .avatar') === null
            )),
            true,
            'does not add an avatar to the theme card',
        );
        assert.equal(
            await optionsPage.$eval('.theme-options', (options) => (
                getComputedStyle(options).display
            )),
            'flex',
            'lays out the theme radio options horizontally',
        );
        assert.equal(
            await optionsPage.evaluate(() => {
                const card = document.querySelector('#theme-card');
                const options = document.querySelector('.theme-options');
                return Math.abs(
                    options.getBoundingClientRect().width -
                    (card.clientWidth - 32),
                ) <= 1;
            }),
            true,
            'stretches the radio row across the theme card content width',
        );
        await optionsPage.setViewport({width: 260, height: 900});
        assert.equal(
            await optionsPage.evaluate(() => {
                const row = document.querySelector('.theme-options');
                const labels = [...row.querySelectorAll('.theme-option')];
                const rowRect = row.getBoundingClientRect();
                return row.scrollWidth <= row.clientWidth &&
                    labels.every((label) => {
                        const rect = label.getBoundingClientRect();
                        return rect.left >= rowRect.left &&
                            rect.right <= rowRect.right;
                    });
            }),
            true,
            'wraps theme choices within the card at narrow zoomed widths',
        );
        await optionsPage.setViewport({width: 800, height: 600});
        assert.deepEqual(
            await optionsPage.$$eval(
                '#theme-card input[type="radio"]',
                (inputs) => inputs.map((input) => ({
                    checked: input.checked,
                    title: input.title,
                    value: input.value,
                })),
            ),
            [
                {checked: true, title: 'Tema da aplicação: Sistema', value: 'system'},
                {checked: false, title: 'Tema da aplicação: Claro', value: 'light'},
                {checked: false, title: 'Tema da aplicação: Escuro', value: 'dark'},
            ],
            'defaults to the system theme preference with contextualized tooltips',
        );
        assert.equal(
            await optionsPage.evaluate(() => (
                document.querySelector('#theme-card').getBoundingClientRect().width ===
                document.querySelector('#add-form').getBoundingClientRect().width
            )),
            true,
            'stretches the theme card across the available content width',
        );
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
        await optionsPage.click('#theme-dark');
        await optionsPage.waitForFunction(
            () => document.documentElement.classList.contains('dark') ||
                document.documentElement.classList.contains('dark-medium-contrast') ||
                document.documentElement.classList.contains('dark-high-contrast'),
        );
        assert.equal(
            await optionsPage.evaluate(async () => (
                (await chrome.storage.local.get('themePreference')).themePreference
            )),
            'dark',
            'persists the selected theme locally',
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
        assert.equal(
            await optionsPage.$eval('#new-url', (input) => (
                input.getAttribute('aria-invalid') === 'true'
            )),
            true,
            'marks an invalid URL field for assistive technology',
        );
        assert.equal(
            await optionsPage.$eval('#add-error', (error) => error.textContent.length > 0),
            true,
            'shows the localized validation error below the URL field',
        );

        await optionsPage.locator('#new-description').fill('Puppeteer smoke test');
        await optionsPage.locator('#new-url').fill(
            'https://www.amazon.com/dp/example?tag=puppeteer-check-20',
        );
        assert.equal(
            await optionsPage.$eval('#new-url', (input) => (
                input.getAttribute('aria-invalid') === null &&
                getComputedStyle(input.nextElementSibling).fontSize === '12px'
            )),
            true,
            'clears the invalid state and floats the URL label after valid input',
        );
        assert.equal(
            await optionsPage.$eval('#add-button', (button) => button.disabled),
            false,
        );
        await optionsPage.$eval('#add-form', (form) => form.requestSubmit());
        await optionsPage.waitForSelector(
            '#tag-list li[data-original-tag="puppeteer-check-20"]',
        );
        assert.equal(
            await optionsPage.$eval(
                '#tag-list li[data-original-tag="puppeteer-check-20"]',
                (item) => {
                    const descriptionInput = item.querySelector('#tag-description-0');
                    const descriptionLabel = descriptionInput?.nextElementSibling;
                    const urlInput = item.querySelector('#tag-url-0');
                    const urlLabel = urlInput?.nextElementSibling;
                    const deleteButton = item.querySelector('.delete-tag-button');
                    return descriptionInput?.parentElement.classList.contains('text-field') &&
                        descriptionLabel?.htmlFor === descriptionInput.id &&
                        descriptionLabel?.classList.contains('text-field-label') &&
                        getComputedStyle(descriptionLabel).fontSize === '12px' &&
                        urlInput?.parentElement.classList.contains('text-field') &&
                        urlLabel?.htmlFor === urlInput.id &&
                        urlLabel?.classList.contains('text-field-label') &&
                        item.querySelector('.tag-key-display')?.tagName === 'H3' &&
                        item.querySelector('.tag-key-display')?.textContent ===
                            'puppeteer-check-20' &&
                        getComputedStyle(item.querySelector('.tag-fields'))
                            .gridTemplateColumns.split(' ').length === 1 &&
                        deleteButton?.getAttribute('aria-label') ===
                            'Excluir tag puppeteer-check-20' &&
                        deleteButton?.getAttribute('title') ===
                            'Excluir tag puppeteer-check-20' &&
                        deleteButton.querySelector('svg[aria-hidden="true"]') !== null;
                },
            ),
            true,
            'renders saved items as stacked textfields with a key heading, tooltip, and delete icon',
        );
        await optionsPage.evaluate(async () => {
            const {savedTags} = await chrome.storage.local.get('savedTags');
            await chrome.storage.local.set({
                savedTags: [...savedTags, {
                    tag: 'separator-check-20',
                    description: 'Separator test',
                    url: 'https://www.amazon.com/dp/example?tag=separator-check-20',
                }],
            });
        });
        await optionsPage.waitForFunction(
            () => document.querySelectorAll('#tag-list li[data-original-tag]').length === 2,
        );
        assert.equal(
            await optionsPage.$eval('#tag-list', (list) => {
                const dividers = [...list.querySelectorAll('.m3-divider')];
                const colorSample = document.createElement('span');
                colorSample.style.backgroundColor = 'var(--md-sys-color-outline-variant)';
                document.body.append(colorSample);
                const expectedColor = getComputedStyle(colorSample).backgroundColor;
                colorSample.remove();
                const listRect = list.getBoundingClientRect();
                const dividerRect = dividers[0].getBoundingClientRect();
                const urlInputRect = list.children[0]
                    .querySelector('.tag-url-input')
                    .getBoundingClientRect();
                const nextLabelRect = list.children[1]
                    .querySelector('.tag-key-display')
                    .getBoundingClientRect();
                const spaceAboveDivider = dividerRect.top - urlInputRect.bottom;
                const spaceBelowDivider = nextLabelRect.top - dividerRect.bottom;
                return dividers.length === 1 &&
                    dividers[0].getAttribute('aria-hidden') === 'true' &&
                    getComputedStyle(dividers[0]).height === '2px' &&
                    getComputedStyle(dividers[0]).backgroundColor === expectedColor &&
                    getComputedStyle(list).borderStyle === 'solid' &&
                    getComputedStyle(list).borderColor === expectedColor &&
                    getComputedStyle(list.children[0]).backgroundColor ===
                        getComputedStyle(list).backgroundColor &&
                    Math.abs(dividerRect.left - (listRect.left + list.clientLeft)) < 1 &&
                    Math.abs(dividerRect.right - (listRect.right - list.clientLeft)) < 1 &&
                    Math.abs(spaceAboveDivider - 16) < 1 &&
                    Math.abs(spaceBelowDivider - 16) < 1 &&
                    Math.abs(spaceAboveDivider - spaceBelowDivider) < 1 &&
                    getComputedStyle(list.children[0]).borderRadius === '16px 16px 0px 0px' &&
                    getComputedStyle(list.children[1]).borderRadius === '0px 0px 16px 16px';
            }),
            true,
            'renders an outlined continuous rounded list card with full-width Material dividers and balanced spacing',
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
        assert.match(
            await popupPage.evaluate(() => document.documentElement.className),
            /^dark/,
            'applies the saved dark theme to the popup',
        );
        assert.equal(
            await popupPage.$('#extension-footer'),
            null,
            'does not render a footer in the popup',
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
            await popupPage.$$eval(
                '.m3-accordion > summary.m3-list-item',
                (items) => items.length,
            ),
            3,
            'renders each collapsible section as a list item',
        );
        assert.equal(
            await popupPage.$eval(
                '.m3-accordion-list',
                (list) => getComputedStyle(list).rowGap,
            ),
            '0px',
            'keeps the accordion list items flush without spacing',
        );
        assert.equal(
            await popupPage.$eval('.how-it-works .affiliate-tag-note', (paragraph) => {
                const colorProbe = document.createElement('span');
                colorProbe.style.color = 'var(--md-sys-color-error)';
                document.body.append(colorProbe);
                const expectedColor = getComputedStyle(colorProbe).color;
                colorProbe.remove();
                return getComputedStyle(paragraph).color === expectedColor;
            }),
            true,
            'highlights the affiliate-tag explanation with the error color',
        );
        assert.deepEqual(
            await popupPage.evaluate(() => {
                const buttons = document.querySelector('.open-buttons');
                const divider = document.querySelector('.m3-divider');
                const list = document.querySelector('.m3-accordion-list');
                const buttonRect = buttons.getBoundingClientRect();
                const dividerRect = divider.getBoundingClientRect();
                const listRect = list.getBoundingClientRect();
                return {
                    above: dividerRect.top - buttonRect.bottom,
                    below: listRect.top - dividerRect.bottom,
                };
            }),
            {above: 16, below: 8},
            'adds spacing above the divider when the status message is empty',
        );
        assert.equal(
            await popupPage.evaluate(() => {
                const picker = document.querySelector('.tag-picker');
                const buttons = document.querySelector('.open-buttons');
                return buttons.getBoundingClientRect().top -
                    picker.getBoundingClientRect().bottom;
            }),
            16,
            'matches the spacing below the tag button to the spacing above it',
        );
        assert.equal(
            await popupPage.$$eval(
                '.m3-accordion > summary button',
                (buttons) => buttons.length,
            ),
            0,
            'keeps each accordion list item focused only on toggling its section',
        );
        const accordionItems = await popupPage.$$('.m3-accordion');
        await accordionItems[0].$('summary').then((summary) => summary.click());
        assert.equal(
            await popupPage.$eval('.m3-accordion', (accordion) => accordion.open),
            true,
            'opens an accordion when its list item is activated',
        );
        await accordionItems[1].$('summary').then((summary) => summary.click());
        assert.deepEqual(
            await popupPage.$$eval(
                '.m3-accordion',
                (accordions) => accordions.map((accordion) => accordion.open),
            ),
            [false, true, false],
            'opens only the activated accordion in the list group',
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
        assert.match(
            await popupPage.$eval(
                '.badge-legend [data-i18n="badgeLegendHidden"]',
                (item) => item.textContent,
            ),
            /^(O ícone não é exibido.*URL da aba ativa|The icon is not displayed.*active tab's URL)\.$/i,
            'explains when the notification icon is not displayed',
        );
        assert.equal(
            await popupPage.$$eval('.badge-legend li', (items) => (
                items.every((item) => /aba ativa|active tab/i.test(item.textContent))
            )),
            true,
            'describes every notification state in terms of the active tab',
        );
        assert.deepEqual(
            await popupPage.$$eval(
                '.badge-legend-symbol',
                (symbols) => symbols.map((symbol) => getComputedStyle(symbol).color),
            ),
            ['rgb(24, 128, 56)', 'rgb(249, 171, 0)', 'rgb(217, 48, 37)'],
            'uses the same colors as the corresponding notification badges',
        );
        const settingsTargetPromise = browser.waitForTarget(
            (target) => target.url() === `chrome-extension://${extensionId}/options.html`,
            {timeout: 10000},
        );
        await popupPage.click('#open-settings-button');
        const settingsTarget = await settingsTargetPromise;
        const settingsPage = await settingsTarget.page();
        await settingsPage.waitForSelector('#add-form');
        assert.equal(
            await settingsPage.$eval('#theme-dark', (input) => input.checked),
            true,
            'restores the saved theme selection in settings',
        );
        await settingsPage.evaluate(() => {
            window.exportedJson = '';
            URL.createObjectURL = (blob) => {
                blob.text().then((text) => {
                    window.exportedJson = text;
                });
                return 'blob:theme-export-test';
            };
            HTMLAnchorElement.prototype.click = function click() {};
        });
        await settingsPage.click('#export-button');
        await settingsPage.waitForFunction(() => Boolean(window.exportedJson));
        assert.deepEqual(
            await settingsPage.evaluate(() => Object.keys(
                JSON.parse(window.exportedJson),
            )),
            ['version', 'tags'],
            'does not include local theme preferences in tag exports',
        );
        await settingsPage.click('#theme-light');
        await popupPage.waitForFunction(
            () => document.documentElement.classList.contains('light') ||
                document.documentElement.classList.contains('light-medium-contrast') ||
                document.documentElement.classList.contains('light-high-contrast'),
        );
        await settingsPage.click('#theme-system');
        await settingsPage.waitForFunction(async () => (
            (await chrome.storage.local.get('themePreference')).themePreference === 'system'
        ));
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
    }
});
