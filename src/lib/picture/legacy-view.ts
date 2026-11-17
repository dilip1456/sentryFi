/** Views that were merged into the single My Financial Picture ("myfinances"). */
const LEGACY_PICTURE_VIEWS = new Set(["myfinances-redesign"]);

/** True for an old Picture view id (saved in sessionStorage or deep-linked). */
export function isLegacyPictureView(view: unknown): boolean {
  return typeof view === "string" && LEGACY_PICTURE_VIEWS.has(view);
}

/** Map a stored/deep-linked view id to the current one. */
export function normalizeView(view: string): string {
  return isLegacyPictureView(view) ? "myfinances" : view;
}
