(() => {
    const root = document.documentElement;
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

    function updateTheme() {
        const scheme = colorScheme.matches ? 'dark' : 'light';
        const contrast = moreContrast.matches
            ? 'high-contrast'
            : lessContrast.matches
                ? 'medium-contrast'
                : '';
        root.classList.remove(...paletteClasses);
        root.classList.add([scheme, contrast].filter(Boolean).join('-'));
    }

    updateTheme();
    colorScheme.addEventListener('change', updateTheme);
    moreContrast.addEventListener('change', updateTheme);
    lessContrast.addEventListener('change', updateTheme);
})();
