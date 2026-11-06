package com.nova.browser

import android.content.SharedPreferences

/** Address-bar search engines offered in Settings. */
enum class SearchEngine(val label: String, val template: String) {
    GOOGLE("Google", "https://www.google.com/search?q=%s"),
    DUCKDUCKGO("DuckDuckGo", "https://duckduckgo.com/?q=%s"),
    BING("Bing", "https://www.bing.com/search?q=%s"),
    BRAVE("Brave Search", "https://search.brave.com/search?q=%s");

    companion object {
        /** Unknown or missing ids (e.g. an old prefs value) fall back to Google. */
        fun fromId(id: String?): SearchEngine = entries.firstOrNull { it.name == id } ?: GOOGLE
    }
}

/** User preferences that live natively (SharedPreferences "nova"). */
class NovaSettings(private val prefs: SharedPreferences) {
    var searchEngine: SearchEngine
        get() = SearchEngine.fromId(prefs.getString(KEY_SEARCH_ENGINE, null))
        set(value) { prefs.edit().putString(KEY_SEARCH_ENGINE, value.name).apply() }

    /** Sites the user switched into compatibility mode (see CompatSites). */
    var compatOn: Set<String>
        get() = prefs.getStringSet(KEY_COMPAT_ON, null)?.toSet() ?: emptySet()
        set(value) { prefs.edit().putStringSet(KEY_COMPAT_ON, value).apply() }

    /** Default compatibility sites the user switched back to Nova's engine. */
    var compatOff: Set<String>
        get() = prefs.getStringSet(KEY_COMPAT_OFF, null)?.toSet() ?: emptySet()
        set(value) { prefs.edit().putStringSet(KEY_COMPAT_OFF, value).apply() }

    private companion object {
        const val KEY_SEARCH_ENGINE = "searchEngine"
        const val KEY_COMPAT_ON = "compatOn"
        const val KEY_COMPAT_OFF = "compatOff"
    }
}
