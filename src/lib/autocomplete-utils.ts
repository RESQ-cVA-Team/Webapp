/**
 * Extracts only the last word being typed from the user's input.
 * Example:
 * "I want to see do" → "do"
 */
export function extractAutocompleteTarget(input: string): string {
  const words = input.trim().split(/\s+/);
  return words[words.length - 1] || "";
}
