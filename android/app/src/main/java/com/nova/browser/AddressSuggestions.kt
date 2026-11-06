package com.nova.browser

import com.nova.browser.model.Bookmark
import com.nova.browser.model.HistoryEntry

/** One row under the address bar while typing. */
data class AddressSuggestion(val kind: Kind, val title: String, val url: String) {
    enum class Kind { GO, SEARCH, BOOKMARK, HISTORY }
}

/**
 * Address-bar suggestions: first what Enter will do with the typed text (open the URL, or search
 * for it), then matching bookmarks and history. Typing the start of a site ("gma") ranks that site
 * above pages that only mention the text.
 */
object AddressSuggestions {

    private fun bare(url: String): String =
        url.lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.")

    /** 3: the site starts with the text; 2: the address contains it; 1: the title does; 0: no match. */
    private fun score(query: String, title: String, url: String): Int {
        val q = bare(query.trim())
        if (q.isEmpty()) return 0
        val b = bare(url)
        return when {
            b.startsWith(q) -> 3
            b.contains(q) -> 2
            title.lowercase().contains(query.trim().lowercase()) -> 1
            else -> 0
        }
    }

    fun suggest(
        query: String,
        history: List<HistoryEntry>,
        bookmarks: List<Bookmark>,
        searchTemplate: String,
        limit: Int = 6,
    ): List<AddressSuggestion> {
        val text = query.trim()
        if (text.isEmpty()) return emptyList()
        val resolved = UrlInputResolver.resolve(text, searchTemplate)
        val isSearch = resolved == UrlInputResolver.buildSearchUrl(text, searchTemplate)
        val first = if (isSearch) AddressSuggestion(AddressSuggestion.Kind.SEARCH, text, resolved)
        else AddressSuggestion(AddressSuggestion.Kind.GO, bare(resolved).removeSuffix("/"), resolved)

        data class Candidate(val s: AddressSuggestion, val score: Int, val order: Int)
        val candidates = bookmarks.mapIndexed { i, b ->
            Candidate(AddressSuggestion(AddressSuggestion.Kind.BOOKMARK, b.title.ifBlank { b.url }, b.url), score(text, b.title, b.url), i)
        } + history.sortedByDescending { it.visitedAt }.mapIndexed { i, h ->
            Candidate(AddressSuggestion(AddressSuggestion.Kind.HISTORY, h.title.ifBlank { h.url }, h.url), score(text, h.title, h.url), bookmarks.size + i)
        }
        val seen = mutableSetOf(bare(resolved).removeSuffix("/"))
        val ranked = candidates.filter { it.score > 0 }
            .sortedWith(compareByDescending<Candidate> { it.score }.thenBy { it.order })
            .map { it.s }
            .filter { seen.add(bare(it.url).removeSuffix("/")) }
        return (listOf(first) + ranked).take(limit)
    }
}
