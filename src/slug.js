const RESERVED_SLUGS = new Set([
  'login', 'logout', 'setup', 'dashboard', 'admin', 'api',
  'static', 'uploads', 'public', 'css', 'js', 'assets',
  'favicon.ico', 'robots.txt', 'health',
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'Slug is required.';
  if (slug.length < 1 || slug.length > 80) return 'Slug must be 1-80 characters.';
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug may only contain lowercase letters, numbers, and hyphens (no leading/trailing/double hyphens).';
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is a reserved word and can't be used as a slug.`;
  return null;
}

module.exports = { RESERVED_SLUGS, SLUG_PATTERN, slugify, validateSlug };
