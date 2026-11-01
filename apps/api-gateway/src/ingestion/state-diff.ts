// ═══════════════════════════════════════════════════════════════
// FootStats — State Diff Engine (xxHash-based delta detection)
// ═══════════════════════════════════════════════════════════════
//
// Compares the current state of a match against the last-known
// hash stored in Redis. If the hash differs, a delta is detected
// and the new state is emitted for downstream processing.
//

import { getRedis } from '../infra/redis';
import { RedisKeys } from '@footstats/shared-types';
import type { RawMatchData } from './provider.interface';

// We use a simple FNV-1a 32-bit hash as a fast, dependency-free
// alternative to xxHash for detecting state changes. The collision
// probability for our use case (small JSON blobs) is negligible.
function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Fields that contribute to the match state hash.
 * Only changes to these fields will trigger a delta emission.
 */
function extractHashableState(match: RawMatchData): string {
  return JSON.stringify({
    s: match.status,
    m: match.minute,
    at: match.addedTime,
    hs: match.homeScore,
    as: match.awayScore,
    hhs: match.homeHtScore,
    ahs: match.awayHtScore,
    // Include event count to catch new events even if score unchanged
    ec: match.events?.length ?? 0,
    // Include stat snapshot hash for subtle stat changes
    sp: match.stats
      ? `${match.stats.home.possession ?? 0}:${match.stats.away.possession ?? 0}:${match.stats.home.xg ?? 0}:${match.stats.away.xg ?? 0}`
      : '',
  });
}

export interface MatchDelta {
  matchProviderId: string;
  previousHash: string | null;
  currentHash: string;
  matchData: RawMatchData;
  changedFields: string[];
  isNewMatch: boolean;
}

/**
 * Compare current match states against stored hashes in Redis.
 * Returns only the matches whose state has actually changed.
 */
export async function detectDeltas(
  matches: RawMatchData[],
): Promise<MatchDelta[]> {
  if (matches.length === 0) return [];

  const redis = getRedis();
  const deltas: MatchDelta[] = [];

  // Pipeline all hash lookups for efficiency
  const pipeline = redis.pipeline();
  for (const match of matches) {
    pipeline.get(RedisKeys.matchHash(match.providerId));
  }

  const results = await pipeline.exec();
  if (!results) return [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const [err, storedHash] = results[i] ?? [null, null];

    if (err) {
      console.error(`[StateDiff] Redis error for match ${match.providerId}:`, err);
      continue;
    }

    const stateString = extractHashableState(match);
    const currentHash = fnv1aHash(stateString);

    if (storedHash === currentHash) {
      // No change — skip this match
      continue;
    }

    // Determine what changed for logging/debugging
    const changedFields = detectChangedFields(match, storedHash as string | null);

    deltas.push({
      matchProviderId: match.providerId,
      previousHash: storedHash as string | null,
      currentHash,
      matchData: match,
      changedFields,
      isNewMatch: storedHash === null,
    });

    // Update the hash in Redis (with TTL of 6 hours for cleanup)
    await redis.set(RedisKeys.matchHash(match.providerId), currentHash, 'EX', 21600);
  }

  return deltas;
}

/**
 * Detect which fields changed (used for logging and flash type detection).
 */
function detectChangedFields(match: RawMatchData, _previousHash: string | null): string[] {
  const fields: string[] = [];

  // We can't know exact previous values from just a hash,
  // but we can infer likely changes based on the current state
  if (match.status) fields.push('status');
  if (match.minute !== null) fields.push('minute');
  if (match.homeScore > 0 || match.awayScore > 0) fields.push('score');
  if (match.events && match.events.length > 0) fields.push('events');
  if (match.stats) fields.push('stats');

  return fields;
}

/**
 * Update the hot cache for a match (full serialized state).
 * This is the primary fast read path for the REST API.
 */
export async function updateHotCache(
  matchProviderId: string,
  matchData: RawMatchData,
  ttlSeconds = 30,
): Promise<void> {
  const redis = getRedis();
  const cacheKey = RedisKeys.matchFull(matchProviderId);
  await redis.set(cacheKey, JSON.stringify(matchData), 'EX', ttlSeconds);
}

/**
 * Track which matches are currently live in a Redis set.
 * Used for efficient "how many live matches?" queries.
 */
export async function updateLiveMatchSet(
  liveMatchIds: string[],
): Promise<void> {
  const redis = getRedis();
  const key = RedisKeys.liveMatchSet();

  if (liveMatchIds.length === 0) {
    await redis.del(key);
    return;
  }

  // Replace the entire set atomically
  const pipeline = redis.pipeline();
  pipeline.del(key);
  pipeline.sadd(key, ...liveMatchIds);
  pipeline.expire(key, 120); // Auto-cleanup after 2 minutes of no updates
  await pipeline.exec();
}
