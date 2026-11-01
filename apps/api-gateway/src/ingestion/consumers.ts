// ═══════════════════════════════════════════════════════════════
// FootStats — Kafka Consumers (Delta → DB + Redis)
// ═══════════════════════════════════════════════════════════════
//
// Consume events from Kafka topics and persist to PostgreSQL.
// Also handles standings updates and ML inference results.
//

import { createConsumer } from '../infra/kafka';
import { KafkaTopics } from '@footstats/shared-types';
import { query, queryOne, transaction } from '@footstats/db';
import type { EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'footstats-db-writers';

/**
 * Start all Kafka consumers for the API Gateway.
 * Each consumer writes to PostgreSQL and/or updates Redis.
 */
export async function startKafkaConsumers(): Promise<void> {
  // ─── Match State Delta Consumer ──────────────────────────
  await createConsumer(
    `${CONSUMER_GROUP}-state`,
    [KafkaTopics.MATCH_STATE_DELTA],
    handleMatchStateDelta,
  );

  // ─── Match Events Consumer ───────────────────────────────
  await createConsumer(
    `${CONSUMER_GROUP}-events`,
    [KafkaTopics.MATCH_EVENTS],
    handleMatchEvent,
  );

  // ─── Standings Update Consumer ───────────────────────────
  await createConsumer(
    `${CONSUMER_GROUP}-standings`,
    [KafkaTopics.STANDINGS_UPDATE],
    handleStandingsUpdate,
  );

  console.log('[KafkaConsumers] All consumers started');
}

/**
 * Handle match state delta: update the match row in PostgreSQL
 * with the latest score, status, stats, and lineups.
 */
async function handleMatchStateDelta(payload: EachMessagePayload): Promise<void> {
  const { message } = payload;
  if (!message.value) return;

  try {
    const delta = JSON.parse(message.value.toString()) as {
      matchProviderId: string;
      isNewMatch: boolean;
      status: string;
      minute: number | null;
      addedTime: number;
      homeScore: number;
      awayScore: number;
      homeHtScore: number | null;
      awayHtScore: number | null;
      stats: Record<string, unknown> | null;
      lineups: Record<string, unknown> | null;
      timestamp: string;
    };

    // Find the internal match ID from the provider ID
    // For now, the mock provider uses the internal UUID directly
    const matchId = delta.matchProviderId;

    // Update the match row
    await query(
      `UPDATE matches SET
        status = $1,
        minute = $2,
        added_time = $3,
        home_score = $4,
        away_score = $5,
        home_ht_score = COALESCE($6, home_ht_score),
        away_ht_score = COALESCE($7, away_ht_score),
        stats = COALESCE($8, stats),
        lineups = COALESCE($9, lineups),
        state_version = state_version + 1,
        updated_at = NOW()
      WHERE id = $10
        OR provider_ids->>'mock' = $10`,
      [
        delta.status,
        delta.minute,
        delta.addedTime,
        delta.homeScore,
        delta.awayScore,
        delta.homeHtScore,
        delta.awayHtScore,
        delta.stats ? JSON.stringify(delta.stats) : null,
        delta.lineups ? JSON.stringify(delta.lineups) : null,
        matchId,
      ],
    );

    // If match just finished, update FT scores
    if (['FT', 'AET', 'AP'].includes(delta.status)) {
      await query(
        `UPDATE matches SET
          home_ft_score = home_score,
          away_ft_score = away_score
        WHERE (id = $1 OR provider_ids->>'mock' = $1)
          AND home_ft_score IS NULL`,
        [matchId],
      );
    }
  } catch (err) {
    console.error('[KafkaConsumer:state] Error processing delta:', err);
  }
}

/**
 * Handle individual match events: insert into match_events table.
 * Uses upsert logic to avoid duplicate events.
 */
async function handleMatchEvent(payload: EachMessagePayload): Promise<void> {
  const { message } = payload;
  if (!message.value) return;

  try {
    const data = JSON.parse(message.value.toString()) as {
      matchProviderId: string;
      event: {
        eventType: string;
        minute: number;
        addedTime: number;
        playerName: string | null;
        relatedPlayerName: string | null;
        teamSide: 'home' | 'away';
        detail?: Record<string, unknown>;
      };
      timestamp: string;
    };

    const { event, matchProviderId } = data;

    // Look up match to get internal ID and team IDs
    const match = await queryOne<{
      id: string;
      home_team_id: string;
      away_team_id: string;
      home_score: number;
      away_score: number;
    }>(
      `SELECT id, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE id = $1 OR provider_ids->>'mock' = $1`,
      [matchProviderId],
    );

    if (!match) {
      console.warn(`[KafkaConsumer:events] Match not found: ${matchProviderId}`);
      return;
    }

    const teamId = event.teamSide === 'home' ? match.home_team_id : match.away_team_id;
    const isHome = event.teamSide === 'home';

    // Insert the event (ignore duplicates based on match + minute + type + player)
    await query(
      `INSERT INTO match_events (
        match_id, event_type, minute, added_time, period,
        player_name, related_player_name,
        team_id, is_home, detail,
        home_score_at_event, away_score_at_event,
        sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT DO NOTHING`,
      [
        match.id,
        event.eventType,
        event.minute,
        event.addedTime,
        null, // period determined by status
        event.playerName,
        event.relatedPlayerName,
        teamId,
        isHome,
        JSON.stringify(event.detail ?? {}),
        match.home_score,
        match.away_score,
        event.minute * 100 + event.addedTime,
      ],
    );
  } catch (err) {
    console.error('[KafkaConsumer:events] Error processing event:', err);
  }
}

/**
 * Handle standings updates from the standings poller.
 */
async function handleStandingsUpdate(payload: EachMessagePayload): Promise<void> {
  const { message } = payload;
  if (!message.value) return;

  try {
    const data = JSON.parse(message.value.toString()) as {
      competitionId: string;
      seasonId: string;
      standings: Array<{
        teamId: string;
        position: number;
        played: number;
        won: number;
        drawn: number;
        lost: number;
        goalsFor: number;
        goalsAgainst: number;
        points: number;
        form: string | null;
      }>;
    };

    await transaction(async (client) => {
      for (const row of data.standings) {
        await client.query(
          `INSERT INTO standings (
            competition_id, season_id, team_id,
            position, played, won, drawn, lost,
            goals_for, goals_against, points, form,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (competition_id, season_id, group_name, team_id)
          DO UPDATE SET
            position = EXCLUDED.position,
            played = EXCLUDED.played,
            won = EXCLUDED.won,
            drawn = EXCLUDED.drawn,
            lost = EXCLUDED.lost,
            goals_for = EXCLUDED.goals_for,
            goals_against = EXCLUDED.goals_against,
            points = EXCLUDED.points,
            form = EXCLUDED.form,
            live_position_delta = standings.position - EXCLUDED.position,
            updated_at = NOW()`,
          [
            data.competitionId,
            data.seasonId,
            row.teamId,
            row.position,
            row.played,
            row.won,
            row.drawn,
            row.lost,
            row.goalsFor,
            row.goalsAgainst,
            row.points,
            row.form,
          ],
        );
      }
    });
  } catch (err) {
    console.error('[KafkaConsumer:standings] Error processing update:', err);
  }
}
