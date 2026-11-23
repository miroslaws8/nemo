// Environments CI steps asked for before their tests (ci/ingest.mts wait), by pipeline. While a
// claim lasts, the console starts no queued run there: a step that waits for a console run gets
// its turn next, and a step let through holds the environment until its stream opens.

interface IClaim {
  env: string;
  timer: NodeJS.Timeout;
}

export class CiClaims {
  private readonly claims = new Map<number, IClaim>();

  /** `onLapse`: a claim nobody renewed ran out (the step went away or never opened its stream). */
  constructor(private readonly onLapse: () => void) {}

  /** Holds `env` for `pipeline` for `ms` from now (asking again renews it). */
  hold(env: string, pipeline: number, ms: number): void {
    this.release(pipeline);
    const timer = setTimeout(() => {
      this.claims.delete(pipeline);
      this.onLapse();
    }, ms);
    timer.unref();
    this.claims.set(pipeline, { env, timer });
  }

  /** The pipeline's stream opened (its run holds the environment now), or it ended. */
  release(pipeline: number): void {
    const claim = this.claims.get(pipeline);
    if (claim !== undefined) {
      clearTimeout(claim.timer);
      this.claims.delete(pipeline);
    }
  }

  holds(env: string): boolean {
    return [...this.claims.values()].some((claim) => claim.env === env);
  }
}
