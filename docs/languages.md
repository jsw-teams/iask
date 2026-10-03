# Languages and accessibility

The widget includes English, Simplified Chinese (`zh-CN`, `zh-SG`), Traditional Chinese (`zh-TW`), Japanese, Korean, German, French, Spanish, Portuguese, Russian, Arabic, Hebrew, Hindi, Italian, Indonesian and Vietnamese. English and the site's existing Chinese variants remain in the small base module. Other packs load only for the current visitor's language, with content-hash URLs and one-year immutable caching.

Any valid BCP 47 tag is accepted. Selection tries the exact tag, script/region-aware Chinese variant, language/script, base language, then English. An unknown language remains usable through English fallback; this does not mean every world language has a bundled translation. Dates use the requested locale through `Intl.DateTimeFormat`.

Add a JSON file to `static/commentnest/languages/<canonical-locale>.json`, using the message keys in `static/commentnest/locales.js`. A pack may override any subset; missing messages inherit English. Builds reject unknown keys, non-string values and unsafe filenames. Rebuild to publish its hashed URL. For a complete new translation, include all base keys.

The iframe follows host light/dark changes and adopts solid host background, foreground and accent colors when their contrast is at least 4.5:1. Unsupported or low-contrast colors retain the accessible defaults. The iframe keeps its own responsive layout, semantic controls and focus styles, so a host theme cannot hide labels or shift the editor.

Arabic, Hebrew and other RTL language tags set RTL direction; comment text uses automatic text direction. The form has associated labels and help text, status announcements, visible focus, keyboard sticker controls and deletion confirmation. Forced-color and reduced-motion preferences are respected.
