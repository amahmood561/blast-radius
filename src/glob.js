// Minimal glob matcher. No dependencies, on purpose: a guard that fails because
// one of its dependencies broke is worse than no guard at all.
//
// Supports  *  **  ?  and {a,b}.  A pattern containing no "/" is also matched
// against the basename, so "package-lock.json" catches it at any depth — the
// same convention .gitignore uses, and the one people expect.

const RE_SPECIAL = /[.+^${}()|[\]\\]/g;
const esc = (s) => s.replace(RE_SPECIAL, "\\$&");

export function globToRegExp(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?"; // **/ may match nothing at all
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
        i += 1;
      } else {
        out += "(?:" + glob.slice(i + 1, end).split(",").map(esc).join("|") + ")";
        i = end + 1;
      }
    } else {
      out += esc(c);
      i += 1;
    }
  }
  return new RegExp("^" + out + "$");
}

export function matches(path, pattern) {
  const p = String(path).replace(/\\/g, "/").replace(/^\.\//, "");
  const re = globToRegExp(pattern);
  if (re.test(p)) return true;
  if (!pattern.includes("/")) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    return re.test(base);
  }
  return false;
}

export const matchesAny = (path, patterns = []) =>
  patterns.some((pattern) => matches(path, pattern));

export const firstMatch = (path, patterns = []) =>
  patterns.find((pattern) => matches(path, pattern)) ?? null;
