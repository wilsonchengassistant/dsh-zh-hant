/**
 * dsh-zh-hant — browser half.
 *
 * WHAT THIS IS
 * ------------
 * DeepSeek Harness ships two locales: `zh` (Simplified) and `en`. The locale
 * service in `@deepseek-ai/dsh-client-locale` is deliberately extensible — a
 * client plugin can add a language to the shared catalog and register its own
 * dictionaries — so Traditional Chinese is a plugin, not a patch. There is no
 * Host half and nothing to patch in the shipped bundles: Settings → General →
 * Language lists whatever the catalog holds, `<html lang>` follows it, and
 * every `t('key')` call in the app resolves against the new locale immediately.
 *
 * WHY THE DICTIONARIES ARE GENERATED
 * ----------------------------------
 * The web GUI has ~2,700 translation keys across ~63 namespaces, and DeepSeek
 * ships new ones every release. `scripts/build-dictionaries.mjs` reads the `zh`
 * dictionary out of every installed client bundle and runs an OpenCC Simplified
 * → Traditional conversion over it, so this file stays correct across upgrades
 * instead of drifting behind a hand-maintained table. `var DICTIONARIES` below
 * is replaced at build time; `src/client.js` is the readable source.
 *
 * WHY THE FALLBACK IS `zh` AND NOT `en`
 * -------------------------------------
 * Lookup walks the active language's fallback chain in the requested namespace,
 * repeats it in `common`, then shows the key. A key this pack does not cover
 * therefore falls back to Simplified Chinese rather than English, which is the
 * right failure mode for a Traditional reader: one unconverted string beats an
 * English one in the middle of a Chinese menu. It also means a namespace added
 * by a future DSH release degrades to Simplified instead of breaking.
 *
 * WHAT THIS DOES NOT TRANSLATE
 * ----------------------------
 * Model output, file contents, and anything a plugin registers outside a
 * dictionary (plugin titles via `resolveText`, or copy captured at registration
 * time such as command descriptions) stay as they are. That copy belongs to the
 * owning package; a language pack cannot reach it.
 */
window.__ModuleLoader__.load({
	id: 'dsh-zh-hant',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var DICTIONARIES = null /* @generated */;
		/**
		 * The catalog entry. `fallback: 'zh'` is the built-in Simplified locale,
		 * which the locale plugin registers before any consumer activates.
		 */
		var LANGUAGE = { id: 'zh-Hant', label: '繁體中文', fallback: 'zh' };
		/**
		 * Register the language first, then every namespace dictionary.
		 *
		 * Definitions and dictionaries may arrive in either order, but the two
		 * are separate effects so a duplicate `zh-Hant` from another pack fails
		 * only the definition — the dictionaries then simply never activate,
		 * instead of taking the whole client boot down with them.
		 */
		function apply(ctx) {
			var locale = ctx.locale;
			var registered = false;
			try {
				ctx.effect(function () {
					return locale.addLanguage(LANGUAGE);
				}, 'zh-hant: language');
				registered = true;
			} catch (error) {
				console.warn('dsh-zh-hant: another pack already provides ' + LANGUAGE.id + '; skipping', error);
			}
			if (!registered) return;
			var namespaces = Object.keys(DICTIONARIES);
			ctx.effect(function () {
				var disposers = namespaces.map(function (name) {
					return locale.register(name, LANGUAGE.id, DICTIONARIES[name]);
				});
				return function () {
					for (var i = disposers.length - 1; i >= 0; i--) disposers[i]();
				};
			}, 'zh-hant: dictionaries');
		}
		exports.LANGUAGE = LANGUAGE;
		/** Exported for the test harness and for debugging from the console. */
		exports.DICTIONARIES = DICTIONARIES;
		exports.NAMESPACE_COUNT = Object.keys(DICTIONARIES).length;
		exports.KEY_COUNT = Object.keys(DICTIONARIES).reduce(function (total, dict) {
			return total + Object.keys(dict).length;
		}, 0);
		exports.apply = apply;
		// Services this module consumes — NOT package names. `dsh.client.inject`
		// in package.json is the load-order list; this is Cordis service
		// injection, and `ctx.locale` is provided by dsh-client-locale under the
		// name "locale". Writing the package id here leaves the fiber pending
		// forever: "waiting for service: @deepseek-ai/dsh-client-locale", which
		// reads like a missing bundle but is a name that is never provided.
		exports.inject = ['locale'];
		return module.exports;
	}
});
