import { EOC_CONFIG } from "../eoc-config.js";
import { PUMP_INVENTORY_CONFIG } from "../pump-inventory-config.js";
import { arcGeometry } from "./command-model.js";
import { authorizeDrainage } from "./drainage-model.js";
import { openFacilitySource, queryFacilities } from "./facility-data.js";
import { FACILITY_PRESETS } from "./facility-presets.js";
import { pumpInventoryProblem } from "./power-nearby-model.js";
import { openPumpCopy } from "./pump-copy-data.js";
import { loadCoreSdk } from "./sdk.js";

const facilityPreset = FACILITY_PRESETS.find(
  (preset) => preset.id === "facilities",
);
const cleared = () => ({
  features: [],
  concerns: [],
  loading: false,
  error: null,
});

function concern(id, kind, name, coordinates, values) {
  const geometry = arcGeometry(coordinates);
  if (!geometry) throw Error("Invalid inventory geometry.");
  const feature = {
    type: "Feature",
    id,
    geometry,
    properties: { id, name, kind, color: "#93bfc5", private: true },
  };
  return {
    id,
    kind,
    name,
    private: true,
    group: 3,
    review: false,
    features: [feature],
    evidence: [],
    links: [],
    ...values,
  };
}

function facilityConcern(id, site, checked, quality) {
  return concern(id, "asset", site.name, site.geometry, {
    change: "County facility inventory · current status unconfirmed",
    time: site.updated ?? checked,
    timeLabel: site.updated
      ? "Inventory record updated"
      : "Inventory retrieved",
    quality,
    nextAction:
      "Verify current use, access and backup power with the facility owner.",
    details: [
      site.owner && "Department in inventory: " + site.owner,
      site.status && "Status in inventory: " + site.status,
      "The inventory does not establish current power, operating status or approved staging.",
    ].filter(Boolean),
  });
}

function pumpConcern(id, pump, inventory, problem) {
  return concern(
    id,
    "pump",
    pump.name.replace(/ · record \d+$/, ""),
    pump.geometry,
    {
      change: "Existing pump in inventory · operation unconfirmed",
      time: inventory.sourceChecked,
      timeLabel: "FMFCD source verified",
      quality: problem ?? "Existing-only county AGOL inventory",
      nextAction: "Confirm pump identity, power and operation with FMFCD.",
      details: [
        "Authenticated county AGOL copy of FMFCD pump locations.",
        "Inventory location does not establish pump readiness.",
      ],
      evidence: [
        {
          label: "FMFCD inventory check",
          value: null,
          units: "",
          time: inventory.sourceChecked,
          source: "FMFCD via county AGOL",
          quality: problem ?? "Source verified",
        },
      ],
    },
  );
}

/** @param {{onChange?: (state: ReturnType<typeof cleared>) => void, loadSdk?: typeof loadCoreSdk}} [options] */
export function createCommandAssets({
  onChange = () => {},
  loadSdk = loadCoreSdk,
} = {}) {
  let state = cleared();
  let session = null,
    generation = 0,
    destroyed = false;
  const adapters = new Set();
  const ids = new Map();
  const publish = (next) => {
    state = next;
    onChange(state);
  };

  function closeReads() {
    generation++;
    for (const adapter of adapters) adapter.close();
    adapters.clear();
  }
  function clear() {
    closeReads();
    ids.clear();
    publish(cleared());
  }
  function connect(next) {
    if (destroyed) return;
    session = next?.portal?.id === EOC_CONFIG.orgId ? next : null;
    clear();
  }
  function idFor(scope, key) {
    const identity = scope + ":" + key;
    if (!ids.has(identity))
      ids.set(identity, "authorized-" + crypto.randomUUID());
    return ids.get(identity);
  }

  async function load(county) {
    if (destroyed) return;
    closeReads();
    if (!session) {
      publish({
        ...cleared(),
        error: "County AGOL sign-in is required to load authorized sites.",
      });
      return;
    }
    if (
      !county?.geometry ||
      (county.properties?.GEOID && county.properties.GEOID !== "06019")
    ) {
      publish({
        ...cleared(),
        error: "The Fresno County boundary is still loading. Retry shortly.",
      });
      return;
    }
    const current = session;
    const epoch = generation;
    const active = () => epoch === generation;
    publish({ ...cleared(), loading: true });
    try {
      await authorizeDrainage(EOC_CONFIG, current);
      await current.getToken();
    } catch {
      if (active()) {
        ids.clear();
        publish({
          ...cleared(),
          error: "County sign-in and private EOC viewer access are required.",
        });
      }
      return;
    }
    if (!active()) return;

    // Fixed county AGOL sources use the signed-in credential already held by the SDK.
    const sdk = async () => {
      const api = await loadSdk();
      return {
        async import(paths) {
          const [request] = await api.import(paths);
          return [
            async (url, options) => {
              const token = options.query.token ?? (await current.getToken());
              if (!active() || options.method !== "post")
                throw Error("Private inventory request ended.");
              return request(url, {
                ...options,
                authMode: "no-prompt",
                query: { ...options.query, token },
              });
            },
          ];
        },
      };
    };

    async function read(open, query) {
      const adapter = await open();
      if (!active()) {
        adapter.close();
        return null;
      }
      adapters.add(adapter);
      try {
        return await query(adapter);
      } finally {
        if (adapters.delete(adapter)) adapter.close();
      }
    }

    const [facilities, pumps] = await Promise.allSettled([
      read(
        () => openFacilitySource(facilityPreset.url, current, sdk),
        (adapter) =>
          queryFacilities(
            { ...facilityPreset, url: adapter.url },
            adapter.metadata,
            adapter.query,
            county,
          ),
      ),
      read(
        () => openPumpCopy(PUMP_INVENTORY_CONFIG, EOC_CONFIG, current, sdk),
        (adapter) => adapter.read(),
      ),
    ]);
    if (!active()) return;
    try {
      await current.getToken();
    } catch {
      if (active()) {
        ids.clear();
        publish({
          ...cleared(),
          error:
            "County sign-in expired. Sign in again to load authorized sites.",
        });
      }
      return;
    }
    if (!active()) return;

    const checked = Date.now();
    const errors = [];
    const concerns = [];
    if (facilities.status === "fulfilled") {
      const { rows, accounting } = facilities.value;
      const quality = accounting.rejected
        ? "Incomplete inventory · some locations or identifiers were rejected"
        : "Authorized county facility points";
      if (accounting.rejected)
        errors.push(
          "Some facility locations or identifiers could not be verified.",
        );
      concerns.push(
        ...rows.map((site) =>
          facilityConcern(idFor("facility", site.key), site, checked, quality),
        ),
      );
    } else
      errors.push("County facility points unavailable. Check layer access.");
    if (pumps.status === "fulfilled") {
      const inventory = { ...pumps.value, connected: true, checked };
      const problem = pumpInventoryProblem(inventory, checked);
      if (problem) errors.push(problem);
      concerns.push(
        ...inventory.rows
          .filter((row) => row.kind === "pump" && row.category === "existing")
          .map((pump) =>
            pumpConcern(idFor("pump", pump.key), pump, inventory, problem),
          ),
      );
    } else
      errors.push(
        "Private AGOL pump inventory unavailable. Check layer access.",
      );
    publish({
      concerns,
      features: concerns.flatMap((row) => row.features),
      loading: false,
      error: errors.join(" ") || null,
    });
  }

  return {
    connect,
    load,
    clear,
    get state() {
      return state;
    },
    destroy() {
      destroyed = true;
      session = null;
      clear();
    },
  };
}
