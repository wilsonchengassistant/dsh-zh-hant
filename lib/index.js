/**
 * dsh-zh-hant — Host half.
 *
 * Deliberately empty. Every dictionary in this plugin is browser-side: the
 * locale catalog lives in the client runtime, and the language definition is
 * registered by `lib/client.js` through the `locale` service.
 *
 * The Host row exists only because `cordis.patch.yml` inserts this package by
 * name, and a DSH bundle row must name a Host module to load. Without this file
 * the host reports `zh-hant (dsh-zh-hant): failed to import` and skips the row —
 * which also means the client half never loads.
 */

/** No Cordis services are required — the client half declares its own. */
const inject = [];

/** No Host-side behaviour to set up or tear down. */
function apply() {
	// Intentionally empty.
}

export { apply, inject };
