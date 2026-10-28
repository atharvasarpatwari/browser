/* HTTP Forever — theme + colour switcher.
   Flips three attributes on <html> and remembers the choice in localStorage.
   Runs from <head> (render-blocking) so the correct theme is set before first paint. */
(function () {
	var root = document.documentElement;
	var mq = window.matchMedia('(prefers-color-scheme: dark)');
	var MODES = ['auto', 'light', 'dark'];

	function get(key, fallback) {
		try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
	}
	function set(key, value) {
		try { localStorage.setItem(key, value); } catch (e) {}
	}

	function apply() {
		var mode = get('hf-mode', 'auto');
		var color = get('hf-color', 'green');
		root.setAttribute('data-mode', mode);
		root.setAttribute('data-theme', mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode);
		root.setAttribute('data-color', color);
		var favicon = document.getElementById('favicon');
		if (favicon) favicon.href = color === 'red' ? 'favicon-red.svg' : 'favicon.svg';
	}

	apply();
	mq.addEventListener('change', function () {
		if (get('hf-mode', 'auto') === 'auto') apply();
	});

	document.addEventListener('DOMContentLoaded', function () {
		var themeBtn = document.getElementById('themeBtn');
		var colorBtn = document.getElementById('colorBtn');

		function relabel() {
			themeBtn.setAttribute('aria-label', 'Theme: ' + root.getAttribute('data-mode') + ' (click to change)');
			var next = root.getAttribute('data-color') === 'red' ? 'green' : 'red';
			colorBtn.setAttribute('aria-label', 'Switch to ' + next + ' colour');
		}

		themeBtn.addEventListener('click', function () {
			set('hf-mode', MODES[(MODES.indexOf(get('hf-mode', 'auto')) + 1) % MODES.length]);
			apply();
			relabel();
		});
		colorBtn.addEventListener('click', function () {
			set('hf-color', get('hf-color', 'green') === 'green' ? 'red' : 'green');
			apply();
			relabel();
		});

		relabel();
	});
})();
