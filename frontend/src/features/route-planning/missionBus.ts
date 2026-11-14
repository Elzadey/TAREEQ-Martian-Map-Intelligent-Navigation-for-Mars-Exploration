// Tiny event bus so the 3D / split views can ask the 2D map to start a mission.
// If the 2D map is not mounted yet (view switch in progress), the request stays
// pending and RoutePlanner picks it up when it mounts.
const EVENT = 'tareeq:mission-start';
let pending = false;

export function requestMissionStart(): void {
  pending = true;
  window.dispatchEvent(new Event(EVENT));
}

// Returns true (once) if a start request is waiting.
export function consumeMissionStart(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function onMissionStart(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
