import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { EstateFallbackWorld } from "./EstateFallbackWorld";
import {
  ESTATE_CONTRACT_VERSION,
  type EstateDistrictId,
  type EstateInteractionEvent
} from "./estateContract";
import type { ImmersiveEstateSceneProps } from "./ImmersiveEstateScene";

const LazyImmersiveEstateScene = lazy(async () => {
  const module = await import("./ImmersiveEstateScene");
  return { default: module.ImmersiveEstateScene };
});

function supportsWebgl2() {
  const canvas = document.createElement("canvas");
  try {
    const context = canvas.getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export type EstateWorldProps = Omit<ImmersiveEstateSceneProps, "forceFallback">;

export function EstateWorld({
  paused = false,
  className,
  onDistrictChange,
  onInteraction,
  onNearbyInteractionChange,
  onWebglStatusChange
}: EstateWorldProps) {
  const [webglAvailable] = useState(supportsWebgl2);
  const [fallbackDistrict, setFallbackDistrict] =
    useState<EstateDistrictId>("arrival-court");

  useEffect(() => {
    if (webglAvailable) return;
    onDistrictChange?.("arrival-court");
    onNearbyInteractionChange?.(null);
    onWebglStatusChange?.("unavailable");
  }, [onDistrictChange, onNearbyInteractionChange, onWebglStatusChange, webglAvailable]);

  if (webglAvailable) {
    return (
      <EstateWorldSurface>
        <Suspense
          fallback={
            <EstateWorldLoading
              className={className}
              paused={paused}
            />
          }
        >
          <LazyImmersiveEstateScene
            className={className}
            paused={paused}
            onDistrictChange={onDistrictChange}
            onInteraction={onInteraction}
            onNearbyInteractionChange={onNearbyInteractionChange}
            onWebglStatusChange={onWebglStatusChange}
          />
        </Suspense>
      </EstateWorldSurface>
    );
  }

  const classNames = ["immersive-estate-scene", className]
    .filter(Boolean)
    .join(" ");
  const handleFallbackDistrict = (district: EstateDistrictId) => {
    setFallbackDistrict(district);
    onDistrictChange?.(district);
  };
  const handleFallbackInteraction = (interaction: EstateInteractionEvent) => {
    onInteraction?.(interaction);
  };

  return (
    <EstateWorldSurface>
      <section
        className={classNames}
        data-immersive-estate={ESTATE_CONTRACT_VERSION}
        data-estate-district={fallbackDistrict}
        data-estate-zone={fallbackDistrict}
        data-estate-webgl="unavailable"
        data-render-mode="fallback"
        data-scene-ready="false"
        data-estate-paused={paused ? "true" : "false"}
        aria-label="Begehbares Birdie & Breakfast Grundstück"
      >
        <EstateFallbackWorld
          activeDistrict={fallbackDistrict}
          paused={paused}
          reason="unavailable"
          onDistrictChange={handleFallbackDistrict}
          onInteraction={handleFallbackInteraction}
        />
      </section>
    </EstateWorldSurface>
  );
}

function EstateWorldSurface({ children }: { children: ReactNode }) {
  return (
    <div
      className="estate-world-surface"
      data-estate-world-surface="true"
      data-estate-world-focus="true"
      tabIndex={-1}
      aria-label="BirdieWorld Grundstück fokussieren"
    >
      {children}
    </div>
  );
}

function EstateWorldLoading({
  paused,
  className
}: Pick<EstateWorldProps, "paused" | "className">) {
  const classNames = ["immersive-estate-scene", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      className={classNames}
      data-immersive-estate={ESTATE_CONTRACT_VERSION}
      data-estate-district="arrival-court"
      data-estate-zone="arrival-court"
      data-estate-webgl="initializing"
      data-render-mode="webgl"
      data-scene-ready="false"
      data-estate-paused={paused ? "true" : "false"}
      aria-label="BirdieWorld 3D-Welt wird vorbereitet"
      aria-busy="true"
    >
      <div className="estate-world-loading" role="status">
        <span aria-hidden="true" />
        <strong>Das Grundstück wird geöffnet…</strong>
      </div>
    </section>
  );
}
