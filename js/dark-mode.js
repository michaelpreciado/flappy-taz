// Day / night toggle. Remembers the choice; the first visit follows the OS setting.
document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('dark-mode-toggle');
    const body = document.body;
    const themeMeta = document.querySelector('meta[name="theme-color"]');

    function stored() {
        try { return localStorage.getItem('darkMode'); } catch (e) { return null; }
    }

    function apply(dark, persist) {
        body.classList.toggle('dark-mode', dark);
        if (toggle) {
            toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
            toggle.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
        }
        if (themeMeta) themeMeta.setAttribute('content', dark ? '#04060a' : '#0b1a2b');
        if (persist) {
            try { localStorage.setItem('darkMode', dark ? 'true' : 'false'); } catch (e) { /* ignore */ }
        }
        if (window.updateGameTheme) window.updateGameTheme(dark);
    }

    const saved = stored();
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(saved === null ? prefersDark : saved === 'true', false);

    if (toggle) {
        toggle.addEventListener('click', function () {
            apply(!body.classList.contains('dark-mode'), true);
        });
    }
});
