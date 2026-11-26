/** Smoke-tests the unpacked extension in Chromium using Puppeteer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const extensionPath = path.resolve(__dirname, '..');
const localeDirectory = path.join(extensionPath, '_locales');
const availableLocales = fs.readdirSync(localeDirectory, {withFileTypes: true})
    .filter((entry) => (
        entry.isDirectory() &&
        fs.existsSync(path.join(localeDirectory, entry.name, 'messages.json'))
    ))
    .map((entry) => entry.name);

async function getLocalizedMessages(page, keys, substitutions = {}) {
    return page.evaluate(({messageKeys, values}) => Object.fromEntries(
        messageKeys.map((key) => [key, chrome.i18n.getMessage(key, values[key])]),
    ), {messageKeys: keys, values: substitutions});
}

async function getUnlocalizedMarkup(page) {
    return page.evaluate(() => {
        const mismatches = [];
        for (const element of document.querySelectorAll('[data-i18n]')) {
            const expected = chrome.i18n.getMessage(element.dataset.i18n);
            if (expected && element.textContent.trim() !== expected) {
                mismatches.push(`text:${element.dataset.i18n}`);
            }
        }
        for (const [selector, datasetKey, attribute] of [
            ['[data-i18n-title]', 'i18nTitle', 'title'],
            ['[data-i18n-aria-label]', 'i18nAriaLabel', 'aria-label'],
        ]) {
            for (const element of document.querySelectorAll(selector)) {
                const expected = chrome.i18n.getMessage(element.dataset[datasetKey]);
                if (expected && element.getAttribute(attribute) !== expected) {
                    mismatches.push(`${attribute}:${element.dataset[datasetKey]}`);
                }
            }
        }
        return mismatches;
    });
}

test('should render the options and popup flows in every available locale', {
    timeout: 120000,
}, async () => {
    for (const locale of availableLocales) {
        await runExtensionFlow(locale);
    }
});

async function runExtensionFlow(locale) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            `--lang=${locale.replace('_', '-')}`,
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

        const uiLocale = await optionsPage.evaluate(
            () => chrome.i18n.getUILanguage(),
        );
        assert.equal(
            uiLocale.split(/[-_]/)[0].toLowerCase(),
            locale.split(/[-_]/)[0].toLowerCase(),
            `uses the ${locale} message catalog during this browser run`,
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
        const optionsMessages = await getLocalizedMessages(optionsPage, [
            'appName',
            'optionsScreenSupportingText',
            'rateApp',
            'goToStoreTooltip',
            'reportProblems',
            'extensionFooter',
            'extensionFooterFrameTitle',
            'projectLinkTooltip',
            'optionsIntro',
            'manualAddHeading',
            'addButton',
            'importJsonLabel',
            'exportJsonButton',
            'saveChangesButton',
            'deleteAllButton',
            'savedTagsHeading',
            'themePreferenceHeading',
            'themePreferenceIntro',
            'themeSystem',
            'themeLight',
            'themeDark',
            'themeSystemTooltip',
            'themeLightTooltip',
            'themeDarkTooltip',
            'optionalDescription',
            'originalUrlLabel',
            'deleteTagAriaLabel',
            'deleteTagTooltip',
        ], {
            deleteTagAriaLabel: 'puppeteer-check-20',
            deleteTagTooltip: 'puppeteer-check-20',
            extensionFooter: manifest.version,
        });
        assert.deepEqual(
            await getUnlocalizedMarkup(optionsPage),
            [],
            'renders localized option-page text and accessibility labels for the selected catalog',
        );
        assert.equal(
            await optionsPage.$eval('#add-form', (form, messages) => (
                form.querySelector('.add-card-header h2[data-i18n="manualAddHeading"]')?.textContent === messages.manualAddHeading &&
                form.querySelector('.add-card-header p[data-i18n="optionsIntro"]')?.textContent.trim() === messages.optionsIntro &&
                form.querySelector('.add-card-footer #add-button')?.getAttribute('title') === messages.addButton &&
                form.querySelectorAll('.text-field-label').length === 2
            ), optionsMessages),
            true,
            'places the title, supporting text, floating labels, and primary action with tooltip in the add card',
        );
        const footerFrame = optionsPage.frames().find((frame) => (
            frame.url().endsWith('/footer.html')
        ));
        assert.ok(footerFrame, 'loads the shared footer app bar');
        await footerFrame.waitForSelector('#footer-label');
        const originalViewport = optionsPage.viewport();
        const footerWidth = Math.min(720, originalViewport.width);
        const footerSideInset = (originalViewport.width - footerWidth) / 2;
        assert.deepEqual(
            await optionsPage.$eval('#extension-footer', (iframe) => ({
                title: iframe.title,
                height: getComputedStyle(iframe).height,
                position: getComputedStyle(iframe).position,
                bottom: getComputedStyle(iframe).bottom,
                width: iframe.getBoundingClientRect().width,
                left: iframe.getBoundingClientRect().left,
                right: window.innerWidth - iframe.getBoundingClientRect().right,
            })),
            {
                title: optionsMessages.extensionFooterFrameTitle,
                height: '64px',
                position: 'fixed',
                bottom: '0px',
                width: footerWidth,
                left: footerSideInset,
                right: footerSideInset,
            },
            'centers the capped-width bottom version app bar with its localized frame title',
        );
        await optionsPage.setViewport({width: 600, height: originalViewport.height});
        assert.deepEqual(
            await optionsPage.$eval('#extension-footer', (iframe) => ({
                width: iframe.getBoundingClientRect().width,
                left: iframe.getBoundingClientRect().left,
                right: window.innerWidth - iframe.getBoundingClientRect().right,
            })),
            {width: 600, left: 0, right: 0},
            'fits the bottom app bar to the available width on narrower screens',
        );
        await optionsPage.setViewport(originalViewport);
        assert.deepEqual(
            await footerFrame.evaluate(() => {
                const footer = document.querySelector('footer');
                const sample = document.createElement('span');
                sample.style.backgroundColor = 'var(--md-sys-color-surface-container)';
                document.body.append(sample);
                const surfaceContainer = getComputedStyle(sample).backgroundColor;
                sample.remove();
                return {
                    text: footer.textContent.trim(),
                    linkCount: footer.querySelectorAll('a').length,
                    display: getComputedStyle(footer).display,
                    alignItems: getComputedStyle(footer).alignItems,
                    justifyContent: getComputedStyle(footer).justifyContent,
                    fontSize: getComputedStyle(footer).fontSize,
                    lineHeight: getComputedStyle(footer).lineHeight,
                    versionCentered: Math.abs(
                        document.querySelector('#footer-label').getBoundingClientRect().left +
                            document.querySelector('#footer-label').getBoundingClientRect().width / 2 -
                            footer.getBoundingClientRect().left -
                            footer.getBoundingClientRect().width / 2,
                    ) < 1,
                    usesSurfaceContainer:
                        getComputedStyle(document.body).backgroundColor === surfaceContainer,
                };
            }),
            {
                text: optionsMessages.extensionFooter,
                linkCount: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                lineHeight: '20px',
                versionCentered: true,
                usesSurfaceContainer: true,
            },
            'centers the version in the Material 3 footer app bar',
        );
        assert.deepEqual(
            await footerFrame.$eval('#report-problem-link', (link) => ({
                title: link.title,
                ariaLabel: link.getAttribute('aria-label'),
                href: link.href,
                target: link.target,
                rel: link.rel,
                width: getComputedStyle(link).width,
                height: getComputedStyle(link).height,
                rightInset: document.querySelector('footer').getBoundingClientRect().right -
                    link.getBoundingClientRect().right,
                iconWidth: getComputedStyle(link.querySelector('svg')).width,
                iconHeight: getComputedStyle(link.querySelector('svg')).height,
            })),
            {
                title: optionsMessages.reportProblems,
                ariaLabel: optionsMessages.reportProblems,
                href: 'https://github.com/srolemberg/my-affiliate-tag-manager/issues',
                target: '_blank',
                rel: 'noopener noreferrer',
                width: '40px',
                height: '40px',
                rightInset: 16,
                iconWidth: '24px',
                iconHeight: '24px',
            },
            'provides the localized report-problems link in the footer app-bar icon action',
        );
        await footerFrame.hover('#report-problem-link');
        await footerFrame.waitForFunction(() => (
            Number.parseFloat(getComputedStyle(
                document.querySelector('#report-problem-link'),
                '::before',
            ).opacity) >= 0.08
        ));
        assert.equal(
            await optionsPage.$eval('#saved-tags-card', (card, messages) => (
                card.querySelector('.saved-tags-header-heading h2[data-i18n="savedTagsHeading"]')?.textContent === messages.savedTagsHeading &&
                card.querySelector('.saved-tags-header-heading #status[role="status"][aria-live="polite"]') !== null &&
                [...card.querySelectorAll('.saved-tags-header-actions button')]
                    .map((button) => button.id).join(',') === 'import-button,export-button' &&
                card.querySelector('#import-button svg[aria-hidden="true"] path')?.getAttribute('d') ===
                    'M18 15V18H6V15H4V18C4 19.1 4.9 20 6 20H18C19.1 20 20 19.1 20 18V15H18ZM7 9L8.41 10.41L11 7.83V16H13V7.83L15.59 10.41L17 9L12 4L7 9Z' &&
                card.querySelector('#import-button')?.getAttribute('aria-label') === messages.importJsonLabel &&
                card.querySelector('#export-button svg[aria-hidden="true"] path')?.getAttribute('d') ===
                    'M18 15V18H6V15H4V18C4 19.1 4.9 20 6 20H18C19.1 20 20 19.1 20 18V15H18ZM17 11L15.59 9.59L13 12.17V4H11V12.17L8.41 9.59L7 11L12 16L17 11Z' &&
                card.querySelector('#export-button')?.getAttribute('aria-label') === messages.exportJsonButton &&
                card.querySelector('#import-file')?.getAttribute('accept') === 'application/json,.json' &&
                getComputedStyle(card.querySelector('#import-file')).display === 'none' &&
                card.querySelector('.saved-tags-content #tag-list') !== null &&
                getComputedStyle(card.querySelector('.saved-tags-content')).padding === '16px' &&
                [...card.querySelector('.toolbar').querySelectorAll('button')]
                    .map((button) => button.id)
                    .join(',') === 'save-tags-button,delete-all-button' &&
                card.querySelector('#save-tags-button').classList.contains('button-primary') &&
                card.querySelector('#save-tags-button')?.getAttribute('title') === messages.saveChangesButton &&
                card.querySelector('#delete-all-button').classList.contains('button-tertiary') &&
                card.querySelector('#delete-all-button')?.getAttribute('title') === messages.deleteAllButton &&
                getComputedStyle(card.querySelector('.toolbar')).flexWrap === 'wrap'
            ), optionsMessages),
            true,
            'places import and export actions in the app bar and keeps save and delete actions in the footer',
        );
        assert.deepEqual(
            await optionsPage.$eval('.saved-tags-header-heading #status', (status) => {
                const style = getComputedStyle(status);
                return {fontSize: style.fontSize, lineHeight: style.lineHeight};
            }),
            {fontSize: '14px', lineHeight: '20px'},
            'styles the status message as supporting text below the saved tags heading',
        );
        const fileChooserPromise = optionsPage.waitForFileChooser();
        await optionsPage.$eval('#import-button', (button) => button.click());
        const fileChooser = await fileChooserPromise;
        await fileChooser.cancel();
        assert.equal(
            fileChooser !== null,
            true,
            'opens the JSON file picker when the app bar import button is pressed',
        );
        assert.deepEqual(
            await optionsPage.$$eval(
                '#saved-tags-card .toolbar button',
                (buttons) => buttons.map((button) => {
                    const style = getComputedStyle(button);
                    return {
                        className: button.classList.contains('button-primary')
                            ? 'button-primary'
                            : 'button-tertiary',
                        isFilled: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
                        hasBorder: style.borderColor !== 'rgba(0, 0, 0, 0)',
                        hasTextColor: style.color !== 'rgba(0, 0, 0, 0)',
                    };
                }),
            ),
            [
                {className: 'button-primary', isFilled: true, hasBorder: true, hasTextColor: true},
                {className: 'button-tertiary', isFilled: false, hasBorder: true, hasTextColor: true},
            ],
            'uses filled and outlined Material button styling in order',
        );
        assert.equal(
            await optionsPage.$eval(
                '.options-app-bar h1',
                (heading) => heading.textContent.trim(),
            ),
            optionsMessages.appName,
            'uses the app name as the options-page app-bar title',
        );
        assert.deepEqual(
            await optionsPage.evaluate(() => {
                const paragraph = document.querySelector('.options-app-bar p');
                const colorProbe = document.createElement('span');
                colorProbe.style.color = 'var(--md-sys-color-on-surface-variant)';
                document.body.append(colorProbe);
                const expectedColor = getComputedStyle(colorProbe).color;
                colorProbe.remove();
                return {
                    text: paragraph.textContent.trim(),
                    fontSize: getComputedStyle(paragraph).fontSize,
                    lineHeight: getComputedStyle(paragraph).lineHeight,
                    hasSupportingColor: getComputedStyle(paragraph).color === expectedColor,
                };
            }),
            {
                text: optionsMessages.optionsScreenSupportingText,
                fontSize: '14px',
                lineHeight: '20px',
                hasSupportingColor: true,
            },
            'shows the localized screen name as Material 3 app-bar supporting text',
        );
        assert.deepEqual(
            await optionsPage.$eval('#rate-app-link', (link) => {
                const icon = getComputedStyle(link.querySelector('svg'));
                const action = getComputedStyle(link);
                return {
                    title: link.getAttribute('title'),
                    ariaLabel: link.getAttribute('aria-label'),
                    href: link.getAttribute('href'),
                    target: link.getAttribute('target'),
                    rel: link.getAttribute('rel'),
                    iconHeight: icon.height,
                    iconWidth: icon.width,
                    isStandardAppBarAction: link.classList.contains('app-bar-action'),
                    iconIsStar: link.querySelector('svg path')?.getAttribute('d') ===
                        'm12 17.27 5.18 3.13-1.64-7.03L21 8.64l-7.19-.61L12 1.4 9.19 8.03 2 8.64l5.46 4.73-1.64 7.03L12 17.27Z',
                    buttonHeight: action.height,
                    buttonWidth: action.width,
                    borderRadius: action.borderRadius,
                };
            }),
            {
                title: optionsMessages.goToStoreTooltip,
                ariaLabel: optionsMessages.rateApp,
                href: 'https://chromewebstore.google.com/detail/khffmniafjplifpandmgibpkkfbbbnom?utm_source=item-share-app',
                target: '_blank',
                rel: 'noopener noreferrer',
                iconHeight: '24px',
                iconWidth: '24px',
                isStandardAppBarAction: true,
                iconIsStar: true,
                buttonHeight: '40px',
                buttonWidth: '40px',
                borderRadius: '50%',
            },
            'uses the standard app-bar star action with localized accessible name and tooltip',
        );
        assert.deepEqual(
            await optionsPage.$eval('#project-link', (link) => ({
                title: link.getAttribute('title'),
                ariaLabel: link.getAttribute('aria-label'),
                href: link.getAttribute('href'),
                target: link.getAttribute('target'),
                rel: link.getAttribute('rel'),
                isStandardAppBarAction: link.classList.contains('app-bar-action'),
                hasIcon: link.querySelector('svg[aria-hidden="true"] path') !== null,
                iconHeight: getComputedStyle(link.querySelector('svg')).height,
                iconWidth: getComputedStyle(link.querySelector('svg')).width,
                buttonHeight: getComputedStyle(link).height,
                buttonWidth: getComputedStyle(link).width,
                borderRadius: getComputedStyle(link).borderRadius,
            })),
            {
                title: optionsMessages.projectLinkTooltip,
                ariaLabel: optionsMessages.projectLinkTooltip,
                href: 'https://github.com/srolemberg/my-affiliate-tag-manager',
                target: '_blank',
                rel: 'noopener noreferrer',
                isStandardAppBarAction: true,
                hasIcon: true,
                iconHeight: '24px',
                iconWidth: '24px',
                buttonHeight: '40px',
                buttonWidth: '40px',
                borderRadius: '50%',
            },
            'offers the localized project link in the options app bar',
        );
        await optionsPage.hover('#rate-app-link');
        await optionsPage.waitForFunction(() => (
            Number.parseFloat(getComputedStyle(
                document.querySelector('#rate-app-link'),
                '::before',
            ).opacity) >= 0.08
        ));
        assert.equal(
            await optionsPage.$eval('#rate-app-link', (link) => (
                getComputedStyle(link, '::before').opacity
            )),
            '0.08',
            'shows the Material 3 hover state layer on the rate icon',
        );
        await optionsPage.mouse.move(0, 0);
        assert.deepEqual(
            await optionsPage.$eval('#theme-card', (card) => ({
                heading: card.querySelector('#theme-card-heading')?.textContent.trim(),
                supportingText: card.querySelector('.theme-card-supporting-text')?.textContent.trim(),
            })),
            {
                heading: optionsMessages.themePreferenceHeading,
                supportingText: optionsMessages.themePreferenceIntro,
            },
            'shows the theme control title and supporting text in the selected language',
        );
        assert.deepEqual(
            await optionsPage.$$eval('.theme-option span[data-i18n]', (labels) => (
                labels.map((label) => label.textContent.trim())
            )),
            [optionsMessages.themeSystem, optionsMessages.themeLight, optionsMessages.themeDark],
            'shows all theme choices in the selected language',
        );
        assert.deepEqual(
            await optionsPage.evaluate(() => {
                const themeCard = document.querySelector('#theme-card');
                const addCard = document.querySelector('#add-form');
                const heading = getComputedStyle(document.querySelector('.options-app-bar h1'));
                const radio = getComputedStyle(document.querySelector('.theme-option input'));
                return {
                    cardRadius: getComputedStyle(themeCard).borderRadius,
                    cardShadow: getComputedStyle(themeCard).boxShadow ===
                        getComputedStyle(addCard).boxShadow,
                    fontFamily: getComputedStyle(document.body).fontFamily,
                    headingFontSize: heading.fontSize,
                    headingLineHeight: heading.lineHeight,
                    radioHeight: radio.height,
                    radioWidth: radio.width,
                };
            }),
            {
                cardRadius: '16px',
                cardShadow: true,
                fontFamily: 'Roboto, Arial, sans-serif',
                headingFontSize: '22px',
                headingLineHeight: '28px',
                radioHeight: '20px',
                radioWidth: '20px',
            },
            'uses the shared Material 3 card, typography, and theme-control dimensions',
        );
        assert.deepEqual(
            await optionsPage.evaluate(() => {
                const themeHeading = getComputedStyle(
                    document.querySelector('#theme-card-heading'),
                );
                const addHeading = getComputedStyle(
                    document.querySelector('.add-card-header h2'),
                );
                return {
                    themeFontSize: themeHeading.fontSize,
                    addFontSize: addHeading.fontSize,
                    themeLineHeight: themeHeading.lineHeight,
                    addLineHeight: addHeading.lineHeight,
                };
            }),
            {
                themeFontSize: '22px',
                addFontSize: '22px',
                themeLineHeight: '28px',
                addLineHeight: '28px',
            },
            'matches the theme card heading size to the add card heading',
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
                {checked: true, title: optionsMessages.themeSystemTooltip, value: 'system'},
                {checked: false, title: optionsMessages.themeLightTooltip, value: 'light'},
                {checked: false, title: optionsMessages.themeDarkTooltip, value: 'dark'},
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
                (item, messages) => {
                    const descriptionInput = item.querySelector('#tag-description-0');
                    const descriptionLabel = descriptionInput?.nextElementSibling;
                    const urlInput = item.querySelector('#tag-url-0');
                    const urlLabel = urlInput?.nextElementSibling;
                    const supportingText = item.querySelector('.saved-tag-supporting-text');
                    const deleteButton = item.querySelector('.delete-tag-button');
                    const tagFields = item.querySelector('.tag-fields');
                    const tagFieldsRect = tagFields.getBoundingClientRect();
                    const descriptionRect = descriptionInput.getBoundingClientRect();
                    const deleteButtonStyle = getComputedStyle(deleteButton);
                    const gridColumns = getComputedStyle(item).gridTemplateColumns
                        .split(' ').map((value) => Number.parseFloat(value));
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
                        supportingText?.textContent === 'Puppeteer smoke test' &&
                        getComputedStyle(supportingText).fontSize === '14px' &&
                        getComputedStyle(supportingText).lineHeight === '20px' &&
                        getComputedStyle(tagFields).backgroundColor ===
                            getComputedStyle(document.querySelector('.add-card-fields')).backgroundColor &&
                        getComputedStyle(tagFields).padding === '16px 0px 16px 16px' &&
                        getComputedStyle(descriptionInput.parentElement).marginRight === '16px' &&
                        Math.abs(descriptionRect.left - tagFieldsRect.left - 16) < 1 &&
                        Math.abs(tagFieldsRect.right - descriptionRect.right - 16) < 1 &&
                        deleteButtonStyle.marginLeft === '16px' &&
                        gridColumns.length === 2 && gridColumns[1] === 56 &&
                        deleteButton?.getAttribute('aria-label') ===
                            messages.deleteTagAriaLabel &&
                        deleteButton?.getAttribute('title') ===
                            messages.deleteTagTooltip &&
                        deleteButton.querySelector('svg[aria-hidden="true"]') !== null;
                },
                optionsMessages,
            ),
            true,
            'renders saved items as stacked textfields with a key heading, tooltip, and delete icon',
        );
        await optionsPage.evaluate(async () => {
            const {savedTags} = await chrome.storage.local.get('savedTags');
            await chrome.storage.local.set({
                savedTags: [...savedTags, {
                    tag: 'separator-check-20',
                    description: '',
                    url: 'https://www.amazon.com/dp/example?tag=separator-check-20',
                }],
            });
        });
        await optionsPage.waitForFunction(
            () => document.querySelectorAll('#tag-list li[data-original-tag]').length === 2,
        );
        assert.equal(
            await optionsPage.$eval(
                '#tag-list li[data-original-tag="separator-check-20"]',
                (item) => item.querySelector('.saved-tag-supporting-text') === null,
            ),
            true,
            'omits supporting text from a saved tag card when its description is empty',
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
        const popupMessages = await getLocalizedMessages(popupPage, [
            'appName',
            'selectTag',
            'openCurrentTabButton',
            'openNewTabButton',
            'settingsTooltip',
            'badgeLegendValid',
            'badgeLegendDifferent',
            'badgeLegendInvalid',
            'badgeLegendHidden',
        ]);
        assert.deepEqual(
            await getUnlocalizedMarkup(popupPage),
            [],
            'renders localized popup text and accessibility labels for the selected catalog',
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
            '20px',
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
            popupMessages.selectTag,
            'shows the default selection prompt on the button',
        );
        assert.equal(
            await popupPage.$eval('#saved-tag-button', (button) => button.title),
            popupMessages.selectTag,
            'provides a tooltip for the saved-tag picker',
        );
        assert.deepEqual(
            await popupPage.$$eval(
                '.open-buttons button',
                (buttons) => buttons.map((button) => button.title),
            ),
            [popupMessages.openCurrentTabButton, popupMessages.openNewTabButton],
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
            await popupPage.evaluate(() => {
                const appBar = document.querySelector('.popup-app-bar').getBoundingClientRect();
                const menu = document.querySelector('#saved-tag-menu').getBoundingClientRect();
                return Math.abs(menu.left - appBar.left) < 1 &&
                    Math.abs(menu.right - appBar.right) < 1;
            }),
            true,
            'extends the saved-tag menu selection surface to the app-bar edges',
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
                {borderRadius: '20px', height: '48px', iconCount: 0},
                {borderRadius: '20px', height: '48px', iconCount: 0},
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
                getComputedStyle(card).minHeight === '80px' &&
                card.getBoundingClientRect().height >= 80
            )),
            true,
            'keeps the last-access card at least medium height while its text wraps',
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
            await popupPage.evaluate(() => {
                const appBar = document.querySelector('.popup-app-bar').getBoundingClientRect();
                const list = document.querySelector('.m3-accordion-list').getBoundingClientRect();
                const divider = document.querySelector('.m3-divider').getBoundingClientRect();
                return Math.abs(list.left - appBar.left) < 1 &&
                    Math.abs(list.right - appBar.right) < 1 &&
                    Math.abs(divider.left - appBar.left) < 1 &&
                    Math.abs(divider.right - appBar.right) < 1;
            }),
            true,
            'extends accordion list items and their divider to the app-bar edges',
        );
        assert.deepEqual(
            await popupPage.evaluate(() => ({
                contentTransition: getComputedStyle(
                    document.querySelector('.m3-accordion-content'),
                ).transitionDuration,
                chevronTransition: getComputedStyle(
                    document.querySelector('.m3-list-item-chevron'),
                ).transitionDuration,
            })),
            {contentTransition: '0s', chevronTransition: '0s'},
            'keeps accordion opening and its indicator static',
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
        await accordionItems[1].$('summary').then((summary) => summary.click());
        assert.equal(
            await popupPage.$eval('.m3-accordion:nth-child(2)', (accordion) => accordion.open),
            false,
            'closes an accordion immediately when its list item is activated again',
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
        const expectedLastAccessSubtitle = await popupPage.evaluate(() => {
            const accessedDate = new Date('2026-11-25T12:34:56.000Z');
            const date = new Intl.DateTimeFormat(undefined, {dateStyle: 'short'}).format(accessedDate);
            const time = new Intl.DateTimeFormat(undefined, {timeStyle: 'medium'}).format(accessedDate);
            return chrome.i18n.getMessage('lastAccessedDetails', [date, time]);
        });
        assert.equal(
            await popupPage.$eval('#last-access-subtitle', (element) => element.textContent),
            expectedLastAccessSubtitle,
            'shows localized last-access details in the card subtitle',
        );
        const badgeLegendCodePoints = await popupPage.$$eval(
            '.badge-legend-symbol',
            (elements) => elements.map((element) => element.textContent.codePointAt(0)),
        );
        assert.equal(
            await popupPage.$eval(
                '.popup-app-bar h1',
                (heading) => heading.textContent.trim(),
            ),
            popupMessages.appName,
            'renders the app title in the app bar',
        );
        assert.equal(await popupPage.$('#open-settings-button') !== null, true);
        assert.equal(
            await popupPage.$eval(
                '#open-settings-button',
                (button) => button.title,
            ),
            popupMessages.settingsTooltip,
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
        assert.deepEqual(
            await popupPage.$$eval(
                '.badge-legend [data-i18n^="badgeLegend"]',
                (items) => items.map((item) => item.textContent.trim()),
            ),
            [
                popupMessages.badgeLegendValid,
                popupMessages.badgeLegendDifferent,
                popupMessages.badgeLegendInvalid,
                popupMessages.badgeLegendHidden,
            ],
            'shows badge explanations from the selected locale for the active tab',
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
        await settingsPage.click('#theme-light');
        await settingsPage.waitForFunction(async () => (
            (await chrome.storage.local.get('themePreference')).themePreference === 'light'
        ));
        await popupPage.reload();
        await popupPage.waitForFunction(
            () => document.documentElement.classList.contains('light') ||
                document.documentElement.classList.contains('light-medium-contrast') ||
                document.documentElement.classList.contains('light-high-contrast'),
        );
        await settingsPage.click('#theme-system');
        await settingsPage.waitForFunction(async () => (
            (await chrome.storage.local.get('themePreference')).themePreference === 'system'
        ));
        await popupPage.reload();
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
    }
}
