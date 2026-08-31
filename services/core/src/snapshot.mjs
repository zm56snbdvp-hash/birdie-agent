export function createRuntimeSnapshot({ lifecycle, presence, activeTurn, microphone, connectivity }) {
  return Object.freeze({
    lifecycle,
    presence: { ...presence },
    activeTurn: activeTurn ? { ...activeTurn } : null,
    microphone,
    connectivity,
  });
}
