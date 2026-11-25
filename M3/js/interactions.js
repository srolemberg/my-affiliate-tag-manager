(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function addRipple(button, clientX, clientY) {
        if (reducedMotion.matches || button.disabled) {
            return;
        }

        const bounds = button.getBoundingClientRect();
        const x = clientX - bounds.left;
        const y = clientY - bounds.top;
        const diameter = 2 * Math.max(
            Math.hypot(x, y),
            Math.hypot(bounds.width - x, y),
            Math.hypot(x, bounds.height - y),
            Math.hypot(bounds.width - x, bounds.height - y),
        );
        const ripple = document.createElement('span');
        ripple.className = 'md-ripple';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.width = `${diameter}px`;
        ripple.style.height = `${diameter}px`;
        ripple.style.left = `${x - diameter / 2}px`;
        ripple.style.top = `${y - diameter / 2}px`;
        ripple.addEventListener('animationend', () => ripple.remove(), {once: true});
        button.append(ripple);
    }

    document.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0) {
            return;
        }
        const button = event.target.closest('button');
        if (button) {
            addRipple(button, event.clientX, event.clientY);
        }
    });

    document.addEventListener('click', (event) => {
        if (event.detail !== 0) {
            return;
        }
        const button = event.target.closest('button');
        if (button) {
            const bounds = button.getBoundingClientRect();
            addRipple(button, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        }
    });
})();
