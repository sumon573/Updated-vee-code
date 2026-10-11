/**
 * Shared story camera-effect definitions (Batch C, Note 2).
 * Index 0 = no effect. Used by StoryShareScreen (editor) and
 * StoryViewer/PlanetScreen (rendering saved stories).
 */
export const STORY_EFFECTS = [
  { name: 'Normal', tint: null as string | null },
  { name: 'Warm', tint: 'rgba(255,149,0,0.18)' },
  { name: 'Cool', tint: 'rgba(10,132,255,0.18)' },
  { name: 'Mono', tint: 'rgba(128,128,128,0.30)' },
  { name: 'Vivid', tint: 'rgba(255,45,146,0.10)' },
] as const;

/** Resolve the overlay tint for a saved effect index. */
export function storyEffectTint(effect?: number): string | null {
  if (!effect || effect <= 0 || effect >= STORY_EFFECTS.length) return null;
  return STORY_EFFECTS[effect].tint;
}
