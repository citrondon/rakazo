/**
 * The bot panel edits one text that is stored as both `description` and `instructions`.
 * Send it as instructions only when it was edited in the panel, so changing the model, color
 * or voice never replaces a longer prompt (for example an imported preset) with the short
 * description.
 */
export function instructionsPatch(
  savedDescription: string,
  nextDescription: string,
): { instructions?: string } {
  return nextDescription !== savedDescription.trim() ? { instructions: nextDescription } : {};
}
