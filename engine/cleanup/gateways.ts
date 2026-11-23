import type { IResourceGateway } from "../types";

/**
 * What the tests may create, one gateway per kind of record: how to read one back by id, list the
 * test user's own, and delete one. `track: { kind, title }` and the setups name these kinds;
 * cleanup and `pnpm sweep` go through them, and the guard (./guard.ts) checks every record first.
 *
 * None ship: a gateway calls the app's own API, so it is written for each app — an object with
 * kind, fetch, listOwned and remove, added to this list (docs/guide.md → Test data and cleanup).
 */
export const RESOURCE_GATEWAYS: readonly IResourceGateway[] = [];

export const GATEWAYS_BY_KIND: ReadonlyMap<string, IResourceGateway> = new Map(
  RESOURCE_GATEWAYS.map((gateway) => [gateway.kind, gateway])
);

/** The gateway of a kind; a kind nobody registered is a mistake in a test or a setup. */
export function gatewayFor(kind: string): IResourceGateway {
  const gateway = GATEWAYS_BY_KIND.get(kind);
  if (gateway === undefined) {
    const known = [...GATEWAYS_BY_KIND.keys()];
    throw new Error(
      `No resource gateway for "${kind}" — ${
        known.length === 0
          ? "none is registered"
          : `registered: ${known.join(", ")}`
      } (engine/cleanup/gateways.ts)`
    );
  }
  return gateway;
}
