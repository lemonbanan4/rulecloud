/** Glob → regex (aligned with server guardrail_eval semantics). */

export function globToRegex(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/").trim();
  if (p.startsWith("./")) p = p.slice(2);
  // *.ts at repo root should still match nested TypeScript files
  if (/^\*\.[\w.+-]+$/.test(p)) {
    p = `**/${p}`;
  }
  const parts: string[] = [];
  let i = 0;
  while (i < p.length) {
    if (p.slice(i, i + 3) === "**/") {
      parts.push("(?:.*/)?");
      i += 3;
    } else if (p.slice(i, i + 2) === "**") {
      parts.push(".*");
      i += 2;
    } else if (p[i] === "*") {
      parts.push("[^/]*");
      i += 1;
    } else if (p[i] === "?") {
      parts.push("[^/]");
      i += 1;
    } else {
      let j = i;
      while (j < p.length && p[j] !== "*" && p[j] !== "?") j += 1;
      parts.push(p.slice(i, j).replace(/[.+^${}()|[\]\\]/g, "\\$&"));
      i = j;
    }
  }
  return new RegExp("^" + parts.join("") + "$", "i");
}

export function globMatch(pattern: string, relpath: string): boolean {
  const norm = relpath.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    return globToRegex(pattern).test(norm);
  } catch {
    return norm.includes(pattern.replace(/\\/g, "/"));
  }
}

export function matchAny(patterns: string[], relpath: string): boolean {
  if (!patterns.length) return true;
  return patterns.some((p) => globMatch(p, relpath));
}

export function expandExtensionIncludes(extensions: unknown): string[] {
  if (!Array.isArray(extensions)) return [];
  return extensions.map((raw) => {
    const s = String(raw).trim();
    if (!s) return "";
    const ext = s.startsWith(".") ? s : `.${s}`;
    return `**/*${ext}`;
  }).filter(Boolean);
}