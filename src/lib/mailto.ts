/**
 * Build a mailto: URL with optional subject and body.
 * Used to open the user's email client with a pre-filled scheduling message.
 */
export function buildMailtoUrl(options: {
  to: string;
  subject?: string;
  body?: string;
}): string {
  const { to, subject = '', body = '' } = options;
  const trimmedTo = to.trim();
  if (!trimmedTo) return '';

  // Support multiple recipients separated by commas, semicolons, or whitespace.
  const recipients = trimmedTo
    .split(/[;,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (recipients.length === 0) return '';

  const toField = recipients.join(',');

  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);

  const query = params.toString();
  // Encode the address list but keep commas literal so multiple recipients are preserved.
  const encodedTo = encodeURIComponent(toField).replace(/%2C/gi, ',');
  const base = `mailto:${encodedTo}`;
  return query ? `${base}?${query}` : base;
}
