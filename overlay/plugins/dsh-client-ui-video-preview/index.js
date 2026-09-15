//#region lib/types/index.js
/**
 * Video preview tab, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader, while the browser half ships
 * through `exports["./client"]`, discovered from the package.json `dsh.client`
 * declaration.
 *
 * The renderer registers its own tab type and reads the video in the Host's
 * bounded byte windows, so playback does not depend on the complete-file cap
 * that governs the document preview's image, PDF, and HTML renderers.
 */
/** Host plugin body — this package contributes browser presentation only. */
function apply() {}
//#endregion

export { apply };
