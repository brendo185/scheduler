/**
 * Build a mailto: URL with optional recipient, subject, and body.
 * If no recipient is provided, a subject/body-only link (mailto:?...) is returned.
 */
export function buildMailtoUrl(options: {
  to?: string;
  subject?: string;
  body?: string;
}): string {
  const { to = '', subject = '', body = '' } = options;
  const trimmedTo = to.trim();

  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString();

  if (trimmedTo) {
    // Support multiple recipients separated by commas, semicolons, or whitespace.
    const recipients = trimmedTo
      .split(/[;,]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      return query ? `mailto:?${query}` : 'mailto:';
    }

    const toField = recipients.join(',');
    // Encode the address list but keep commas literal so multiple recipients are preserved.
    const encodedTo = encodeURIComponent(toField).replace(/%2C/gi, ',');
    const base = `mailto:${encodedTo}`;
    return query ? `${base}?${query}` : base;
  }

  // No explicit recipient; allow subject/body-only links.
  return query ? `mailto:?${query}` : 'mailto:';
}
