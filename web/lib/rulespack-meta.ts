export function slugifyPackName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "custom-pack";
}

/** Name + slug + short description from a natural-language prompt. */
export function deriveRulespackMeta(prompt: string): {
  name: string;
  slug: string;
  description: string;
} {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const words = cleaned.split(" ").filter(Boolean).slice(0, 8);
  const name =
    words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
      .slice(0, 80) || "Custom pack";
  const slug = slugifyPackName(words.join(" "));
  return {
    name,
    slug,
    description: cleaned.slice(0, 240),
  };
}

export function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}