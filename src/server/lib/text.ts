/** Make a URL-safe, human-readable slug from a show title. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Append a numeric suffix to make a slug unique given an existence check. */
export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  let slug = base || 'show'
  let n = 2
  while (exists(slug)) {
    slug = `${base}-${n}`
    n += 1
  }
  return slug
}
