import type { IResourceRegistry, ITrackedResource } from "./types";

/** What one test created, in creation order; cleanup walks it backwards. */
export class ResourceRegistry implements IResourceRegistry {
  private readonly resources: ITrackedResource[] = [];

  track(resource: ITrackedResource): void {
    this.resources.push(resource);
  }

  list(): readonly ITrackedResource[] {
    return this.resources;
  }
}

export function describeResource(resource: ITrackedResource): string {
  const reference = resource.id === null ? "" : ` ${resource.id}`;
  const link = resource.url === null ? "" : ` ${resource.url}`;
  return `${resource.kind}${reference} "${resource.title}"${link}`;
}
