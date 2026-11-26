(() => {
    const root = document.documentElement;
    const themeStorageKey = 'themePreference';
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const moreContrast = window.matchMedia('(prefers-contrast: more)');
    const lessContrast = window.matchMedia('(prefers-contrast: less)');
    const paletteClasses = [
        'light',
        'light-medium-contrast',
        'light-high-contrast',
        'dark',
        'dark-medium-contrast',
        'dark-high-contrast',
    ];
    let themePreference = 'system';
    let preferenceRevision = 0;

    function updateTheme() {
        const scheme = themePreference === 'system'
            ? colorScheme.matches ? 'dark' : 'light'
            : themePreference;
        const contrast = moreContrast.matches
            ? 'high-contrast'
            : lessContrast.matches
                ? 'medium-contrast'
                : '';
        root.classList.remove(...paletteClasses);
        root.classList.add([scheme, contrast].filter(Boolean).join('-'));
    }

    updateTheme();
    colorScheme.addEventListener('change', () => {
        if (themePreference === 'system') {
            updateTheme();
        }
    });
    moreContrast.addEventListener('change', updateTheme);
    lessContrast.addEventListener('change', updateTheme);

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[themeStorageKey]) {
            return;
        }
        const preference = changes[themeStorageKey].newValue;
        preferenceRevision += 1;
        themePreference = ['system', 'light', 'dark'].includes(preference)
            ? preference
            : 'system';
        updateTheme();
    });

    const initialPreferenceRevision = preferenceRevision;
    chrome.storage.local.get(themeStorageKey).then((stored) => {
        if (preferenceRevision !== initialPreferenceRevision) {
            return;
        }
        const preference = stored?.[themeStorageKey];
        themePreference = ['system', 'light', 'dark'].includes(preference)
            ? preference
            : 'system';
        updateTheme();
    }).catch((error) => {
        console.error('Could not load the saved theme preference:', error);
    });
})();
