import { useCallback, useState } from "react";
import {
  INITIAL_BIRDIE_WORLD_CONTEXT,
  sceneZoneToBirdieWorldContext,
  type BirdieWorldContextProjection,
  type ThreeHotelSceneZone
} from "./worldContext";

/**
 * React-only bridge from the existing renderer zone into a transient,
 * engine-neutral UI projection. The returned state is never persisted.
 */
export function useBirdieWorldBridge(
  initialContext: BirdieWorldContextProjection = INITIAL_BIRDIE_WORLD_CONTEXT
) {
  const [worldContext, setWorldContext] =
    useState<BirdieWorldContextProjection>(initialContext);

  const onSceneZoneChange = useCallback((zone: ThreeHotelSceneZone) => {
    setWorldContext(sceneZoneToBirdieWorldContext(zone));
  }, []);

  return { worldContext, onSceneZoneChange } as const;
}
