/** Which map Command draws on (docs/county-3d-checklist.md).
 *  The three.js county scene is the default on desktops. MapLibre is used on phones (until the 3D view passes on
 *  actual devices), when the browser has no usable WebGL2, when the 3D scene fails to start, and whenever the URL
 *  asks for it with ?renderer=maplibre. ?renderer=three forces the 3D scene, even on a phone. */
export type RendererId = "three" | "maplibre";
export type RendererReason = "requested" | "default" | "phone" | "no-webgl" | "failed";

export interface RendererEnvironment {
  /** A phone-sized touch screen (by the device's screen, not the window, so a narrow desktop window keeps 3D). */
  phone: boolean;
  /** WebGL2 is available without a major performance caveat (software rendering counts as unavailable). */
  webgl: boolean;
}

export const MODULE: Record<RendererId, "county-scene-map" | "watch-terrain-map"> = {
  three: "county-scene-map",
  maplibre: "watch-terrain-map",
};

export function chooseRenderer(search: string, env: RendererEnvironment): { id: RendererId; reason: RendererReason } {
  const asked = new URLSearchParams(search).get("renderer");
  if (asked === "three" || asked === "maplibre") return { id: asked, reason: "requested" };
  if (env.phone) return { id: "maplibre", reason: "phone" };
  if (!env.webgl) return { id: "maplibre", reason: "no-webgl" };
  return { id: "three", reason: "default" };
}

/** Link to the same place with the other map. The parameter is always explicit so the choice survives a reload. */
export function switchHref(pathname: string, search: string, hash: string, current: RendererId): string {
  const params = new URLSearchParams(search);
  params.set("renderer", current === "three" ? "maplibre" : "three");
  return `${pathname}?${params}${hash}`;
}

export function switchLabel(current: RendererId): string {
  return current === "three" ? "Use the standard map" : "Use the 3D map";
}

/** One line under the map when the standard map is shown in place of the 3D default; empty when nothing to say. */
export function fallbackNote(reason: RendererReason): string {
  if (reason === "failed") return "The 3D map could not start on this computer, so the standard map is shown.";
  if (reason === "no-webgl") return "This browser cannot draw the 3D map (no hardware WebGL2), so the standard map is shown.";
  return "";
}

/** Browser probes, kept out of chooseRenderer so it stays testable. */
export function detectEnvironment(): RendererEnvironment {
  const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
  let webgl = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    webgl = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { webgl = false; }
  return { phone, webgl };
}
