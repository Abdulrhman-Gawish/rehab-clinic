// "  Ahmed   Hassan " -> "Ahmed Hassan"
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

// Same person name, ignoring case and extra whitespace.
export function samePersonName(a: string, b: string): boolean {
  return (
    normalizePersonName(a).toLowerCase() ===
    normalizePersonName(b).toLowerCase()
  );
}
