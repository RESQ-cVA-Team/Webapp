/**
 * Extracts candidate autocomplete targets from the user's input.
 * Returns up to `maxWords` trailing words first, then the last word fallback.
 * Example:
 * "I want Door T" -> ["Door T", "T"]
 */
export function extractAutocompleteTargets(input: string, maxWords = 3): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const words = trimmed.split(/\s+/);
  const multiWord = words.slice(-Math.max(1, maxWords)).join(" ");
  const singleWord = words[words.length - 1] || "";

  const out = [multiWord, singleWord]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(out));
}
