/**
 * Lightweight Markdown → HTML renderer for untrusted content.
 *
 * Approach:
 *  1. Escape all HTML special characters first (prevents any tag injection).
 *  2. Apply safe inline transforms (bold, italic, line breaks).
 *
 * No external dependencies — keeps the bundle small.
 */

/** Escape HTML special chars. Use this for plain-text values in HTML attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a small Markdown subset to HTML.
 *
 * Supported syntax:
 *  - `**bold**`   → `<strong>bold</strong>`
 *  - `*italic*`   → `<em>italic</em>`  (single asterisk, not inside **)
 *  - `\n`         → `<br />`
 *
 * HTML is fully escaped before transforms are applied, so user content
 * cannot inject arbitrary tags or event handlers.
 */
export function renderMarkdown(text: string): string {
  return (
    escapeHtml(text)
      // Bold: **text** — non-greedy, no newlines inside
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      // Italic: *text* — single asterisk, not adjacent to another *
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
      // Line breaks
      .replace(/\n/g, "<br />")
  );
}
