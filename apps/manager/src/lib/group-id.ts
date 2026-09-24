/**
 * A room or category id minted in the browser, so a new room can be picked
 * for channels before the first save. `crypto.randomUUID` needs a secure
 * context, which a LAN appliance over plain HTTP is not; uniqueness only has
 * to hold within one showfile, and the backend rejects a duplicate on save.
 */
export function newGroupId(prefix: "room" | "cat"): string {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${prefix}-${Date.now().toString(36)}${random}`;
}
