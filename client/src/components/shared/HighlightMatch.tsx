/** `text` with each occurrence of `query` in bold, for search results. */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!text || !query || query.length < 2) return <>{text}</>;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    const lowerQuery = query.toLowerCase();
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === lowerQuery ? (
            <strong key={i} className="search-highlight">{part}</strong>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}
