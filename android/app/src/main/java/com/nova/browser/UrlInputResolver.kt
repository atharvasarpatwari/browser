package com.nova.browser

/**
 * Converts raw address-bar text into a navigable, engine-safe URL string.
 *
 * Mirrors the semantics of the engine's canonical parser
 * (`src/browser/navigation/url-parser.ts` `UrlParser.normalize()` +
 * `isSearchQuery()`), which is single-sourced for the desktop omnibox. The
 * engine's NavigationController re-parses whatever Kotlin hands it, so this
 * resolver only needs to (1) decide URL-vs-search and (2) add a scheme when
 * the user omits one — but it must produce a string the engine accepts.
 *
 * The one deliberate divergence from the engine: a dotted hostname with a
 * port (`example.com:3000`) is classified as a hostname here and gets an
 * explicit `https://` prefix, whereas the engine's `normalize()` can
 * mis-read `example.com:` as a scheme and reject it. Prefixing lets the
 * engine parse it correctly.
 */
object UrlInputResolver {

    // ── Pattern library ─────────────────────────────────────────────────────
    // Mirrors src/browser/navigation/url-parser.ts private-static patterns.
    // Kotlin Regex.matches() requires a full-string match, same as JS ^…$.

    /** Bare localhost with optional port and path. e.g. "localhost:4000/app" */
    private val LOCALHOST_RE = Regex("^localhost(:\\d{1,5})?(/[^\\s]*)?$", RegexOption.IGNORE_CASE)

    /** Bare IPv4 with optional port and path. e.g. "192.168.1.1:8080" */
    private val IPV4_RE = Regex("^(\\d{1,3}\\.){3}\\d{1,3}(:\\d{1,5})?(/[^\\s]*)?$")

    /** Single-label hostname with optional port/path/query/fragment. */
    private val SINGLE_LABEL_HOSTNAME_RE =
        Regex("^[a-zA-Z][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](:\\d{1,5})?(/[^\\s/][^\\s]*)?(\\?[^\\s]*)?(#[^\\s]*)?$")

    /** Any scheme prefix, including scheme-only forms. e.g. "https://", "about:" */
    private val SCHEME_RE = Regex("^[a-zA-Z][a-zA-Z0-9+\\-.]*:")

    /** Dotted hostname (TLD 2+ letters) with optional port/path/query/fragment. */
    private val BARE_HOSTNAME_RE =
        Regex("^[a-zA-Z0-9]([a-zA-Z0-9-]*\\.)+[a-zA-Z]{2,}(:\\d{1,5})?(/[^\\s]*)?(\\?[^\\s]*)?(#[^\\s]*)?$")

    /**
     * Resolve raw address-bar input into a URL the engine can parse.
     *
     * @return the cleaned input unchanged when empty, an absolute URL for
     *         URL-like input, or a search-engine URL built from [searchTemplate].
     */
    fun resolve(input: String, searchTemplate: String): String {
        val s = sanitize(input)
        if (s.isEmpty()) return s

        // Hostname forms are matched BEFORE the generic scheme check so that
        // "localhost:3000" is a hostname+port, never a "localhost:" scheme.
        if (LOCALHOST_RE.matches(s)) return "https://$s"
        if (IPV4_RE.matches(s)) return "https://$s"
        if (SINGLE_LABEL_HOSTNAME_RE.matches(s)) return "https://$s"

        // Dotted hosts first: protects "example.com:3000" from being read as
        // the scheme "example.com:" (engine divergence — see class doc).
        if (BARE_HOSTNAME_RE.matches(s)) return "https://$s"

        // Any explicit scheme is passed through untouched (http/https/ftp/
        // file/about/nova/mailto/ws/wss/data/blob/…). The engine applies its
        // own normalization, security gates, and blocked-protocol checks on
        // the other side, so wrapped or modified text here would only break it.
        // Note: containsMatchIn, not matches() — the pattern anchors only the
        // START (like JS RegExp.test), so trailing path/query content is legal.
        if (SCHEME_RE.containsMatchIn(s)) return s

        return buildSearchUrl(s, searchTemplate)
    }

    /**
     * Build a search-engine URL for a query.
     *
     * Equivalent to the engine's `UrlParser.buildSearchUrl()`: the JS
     * `encodeURIComponent()` character set (NOT `application/x-www-form-urlencoded`,
     * which would encode spaces as "+").
     */
    fun buildSearchUrl(query: String, searchTemplate: String): String {
        val encoded = encodeURIComponent(sanitize(query))
        return if (searchTemplate.contains("%s")) searchTemplate.replace("%s", encoded) else searchTemplate
    }

    /** Trim surrounding whitespace and collapse internal runs to one space. */
    private fun sanitize(input: String): String {
        return input.trim().replace(Regex("\\s+"), " ")
    }

    private fun encodeURIComponent(input: String): String {
        val sb = StringBuilder()
        for (ch in input) {
            if (ch.isLetterOrDigit() || ch in "-_.!~*'()") {
                sb.append(ch)
            } else {
                for (b in ch.toString().toByteArray(Charsets.UTF_8)) {
                    val v = b.toInt() and 0xFF
                    sb.append('%').append(HEX[v ushr 4]).append(HEX[v and 0xF])
                }
            }
        }
        return sb.toString()
    }

    private const val HEX = "0123456789ABCDEF"
}