import type { ProcessAdapter } from '../adapters/base.js';
import { resolveAdapter } from '../adapters/index.js';
import type { Config, RoutingConfig } from '../types.js';
import { classify, normalizeProfile, type RoutingProfile } from './classifier.js';

/** The outcome of routing one task: which adapter runs it, and any per-profile model override. */
export interface RouteDecision {
  adapter: ProcessAdapter;
  /** Model override for this profile, or `undefined` to use the adapter/config default. */
  model?: string;
  /** The profile that was selected, or `'fixed'` when routing is disabled. */
  profile: RoutingProfile | 'fixed';
}

/**
 * Selects the backend adapter for a task. The single per-request routing decision point
 * that replaces the boot-fixed `AGENT_ADAPTER`.
 */
export interface Router {
  /**
   * @param task - The task prompt (used by the classifier when no explicit profile is given).
   * @param profile - Optional explicit profile from request metadata; overrides the classifier.
   */
  select(task: string, profile?: unknown): RouteDecision;
}

/**
 * Routing disabled: always returns the single configured adapter — byte-identical to the
 * pre-routing behavior. Used whenever no `routing` config is present.
 */
export class FixedRouter implements Router {
  constructor(private readonly adapter: ProcessAdapter) {}

  select(): RouteDecision {
    return { adapter: this.adapter, profile: 'fixed' };
  }
}

/**
 * Routing enabled: classifies the task (or honours an explicit profile) and maps the
 * resulting {@link RoutingProfile} to an adapter via the `routing` config.
 *
 * Adapter names are validated against the registry at construction, so a bad config fails
 * fast at startup rather than on the first request.
 */
export class ProfileRouter implements Router {
  constructor(private readonly routing: RoutingConfig) {
    // Fail fast: reject adapter names not in the registry.
    for (const profile of ['COMPLEX', 'MID', 'ROUTINE'] as const) {
      resolveAdapter(routing[profile].adapter);
    }
  }

  select(task: string, profile?: unknown): RouteDecision {
    const chosen = normalizeProfile(profile) ?? classify(task);
    const entry = this.routing[chosen];
    return { adapter: resolveAdapter(entry.adapter), model: entry.model, profile: chosen };
  }
}

/**
 * Builds the router for the running server: a {@link ProfileRouter} when `routing` config is
 * present, otherwise a {@link FixedRouter} around the boot adapter (unchanged behavior).
 */
export function createRouter(config: Config, defaultAdapter: ProcessAdapter): Router {
  return config.routing ? new ProfileRouter(config.routing) : new FixedRouter(defaultAdapter);
}
