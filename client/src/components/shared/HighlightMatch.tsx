/**
 * `text` with every word of `query` in bold, for search results.
 *
 * Word by word, because search matches word by word: "omar alami" finds
 * "ALAMI Omar", and both words should show why. Single letters are skipped —
 * one would light up half the line.
 */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))]
    // Longest first, so "alami" wins over "al" where both match.
    .sort((a, b) => b.length - a.length);
  if (!text || words.length === 0) return <>{text}</>;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        words.includes(part.toLowerCase()) ? (
          <strong key={i} className="search-highlight">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
