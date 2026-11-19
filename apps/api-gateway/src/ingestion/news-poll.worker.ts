// ═══════════════════════════════════════════════════════════════
// FootStats — News Ingestion Poller (BullMQ)
// ═══════════════════════════════════════════════════════════════
//
// Polls for football news from RSS feeds and stores them in the
// news_articles table. In mock mode, generates realistic fake
// news articles. Runs every 2 minutes.
//
// Flow: Poll → Deduplicate → Insert → Publish to Kafka → Index
//

import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config';
import { QueueNames, KafkaTopics } from '@footstats/shared-types';
import { query, queryOne } from '@footstats/db';
import { publishMessage } from '../infra/kafka';
import { getRedis } from '../infra/redis';

const POLL_INTERVAL_MS = 120_000; // 2 minutes

// ─── Mock News Templates ────────────────────────────────────

const NEWS_TEMPLATES = {
  BREAKING: [
    '{team} confirm {player} injury — out for {weeks} weeks',
    'BREAKING: {team} agree personal terms with {player}',
    '{team} manager addresses squad unrest ahead of {opponent} clash',
    '{player} reaches verbal agreement with {team} — medical scheduled',
  ],
  TRANSFERS: [
    '{team} eye €{amount}m move for {opponent} star {player}',
    '{player} turns down {team} contract offer — wants {opponent} move',
    '{team} set to trigger {player}\'s release clause',
    'Exclusive: {team} in advanced talks for {player} — fee agreed at €{amount}m',
    '{team} prepare improved bid after {opponent} reject initial €{amount}m offer',
  ],
  INJURIES: [
    '{player} suffers hamstring injury in {team} training',
    '{team} provide {player} update — scan results expected tomorrow',
    '{player} ruled out of {team} vs {opponent} with knee issue',
    'Good news for {team}: {player} returns to full training',
  ],
  MATCH_REPORTS: [
    '{team} {score_home}-{score_away} {opponent}: {player} stars in {result}',
    '{team} come from behind to beat {opponent} {score_home}-{score_away}',
    '{player} brace seals {team} victory over {opponent}',
    'Late drama as {team} salvage point against {opponent}',
  ],
  TACTICS: [
    'How {team}\'s new 3-4-3 is unlocking {player}',
    'The tactical tweak that transformed {team}\'s season',
    '{team}\'s pressing intensity: a statistical deep dive',
    'Why {player} is thriving in new {team} role under manager',
  ],
  VAR_WATCH: [
    'VAR controversy in {team} vs {opponent} — penalty overturned',
    'Should {player}\'s goal have been disallowed? Offside line analysis',
    '{team} denied clear penalty — VAR angle breakdown',
  ],
} as const;

const MOCK_TEAMS = [
  'Arsenal', 'Manchester City', 'Liverpool', 'Chelsea', 'Manchester United',
  'Tottenham', 'Newcastle', 'Real Madrid', 'Barcelona', 'Bayern Munich',
  'PSG', 'Inter Milan', 'Juventus', 'AC Milan', 'Borussia Dortmund',
  'Bayer Leverkusen', 'Atlético Madrid', 'Napoli',
];

const MOCK_PLAYERS = [
  'Saka', 'Haaland', 'Salah', 'Palmer', 'Mbappé', 'Bellingham',
  'Kane', 'Vinicius Jr.', 'Yamal', 'Musiala', 'Wirtz', 'Rice',
  'Rodri', 'Foden', 'De Bruyne', 'Rashford', 'Isak', 'Son',
  'Osimhen', 'Thuram', 'Pedri', 'Raphinha', 'Lewandowski',
];

const MOCK_SOURCES = [
  'BBC Sport', 'The Athletic', 'ESPN FC', 'Sky Sports',
  'The Guardian', 'Marca', 'L\'Équipe', 'Gazzetta dello Sport',
  'Kicker', 'Fabrizio Romano',
];

function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a mock news article with realistic-looking content.
 */
function generateMockArticle(): {
  title: string;
  summary: string;
  category: string;
  source: string;
  sourceUrl: string;
  imageUrl: string | null;
  publishedAt: string;
  relatedTeams: string[];
  relatedPlayers: string[];
} {
  const categories = Object.keys(NEWS_TEMPLATES) as Array<keyof typeof NEWS_TEMPLATES>;
  const category = pick(categories);
  const templates = NEWS_TEMPLATES[category];
  const template = pick(templates);

  const team = pick(MOCK_TEAMS);
  const opponent = pick(MOCK_TEAMS.filter((t) => t !== team));
  const player = pick(MOCK_PLAYERS);
  const source = pick(MOCK_SOURCES);

  const title = template
    .replace('{team}', team)
    .replace('{opponent}', opponent)
    .replace('{player}', player)
    .replace('{weeks}', String(rand(2, 8)))
    .replace('{amount}', String(rand(20, 120)))
    .replace('{score_home}', String(rand(0, 4)))
    .replace('{score_away}', String(rand(0, 3)))
    .replace('{result}', pick(['dominant victory', 'thrilling win', 'hard-fought draw']));

  const summary = `${title}. Full report and analysis from ${source} on the latest ` +
    `developments in the ${team} camp. ${player} has been a key figure in recent weeks.`;

  return {
    title,
    summary,
    category,
    source,
    sourceUrl: `https://example.com/news/${Date.now()}/${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
    imageUrl: null,
    publishedAt: new Date(Date.now() - rand(0, 3600_000)).toISOString(),
    relatedTeams: [team, opponent],
    relatedPlayers: [player],
  };
}

// ─── Worker Implementation ──────────────────────────────────

/**
 * Start the news ingestion worker.
 */
export async function startNewsPollWorker(): Promise<{ worker: Worker; queue: Queue }> {
  const connection = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  };

  const queue = new Queue(QueueNames.NEWS_POLL, { connection });

  // Clean existing repeatable jobs
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule repeatable job every 2 minutes
  await queue.add(
    'poll-news',
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  );

  // Immediate initial run
  await queue.add(
    'poll-news-initial',
    { initial: true },
    {
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 5 },
    },
  );

  const worker = new Worker(
    QueueNames.NEWS_POLL,
    async (job: Job) => {
      return await processNewsPoll(job);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    const rv = job?.returnvalue as Record<string, number> | null;
    if (rv && (rv['inserted'] ?? 0) > 0) {
      console.log(
        `[NewsPoll] ✓ ${rv['inserted']} new articles ingested (${rv['duplicates']} duplicates skipped)`,
      );
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[NewsPoll] ✗ Poll #${job?.id} failed:`, err.message);
  });

  return { worker, queue };
}

/**
 * Core news poll handler.
 * In mock mode, generates 1-3 fake articles per poll.
 * In production, would fetch from RSS feeds / news APIs.
 */
async function processNewsPoll(
  _job: Job,
): Promise<{ fetched: number; inserted: number; duplicates: number }> {
  // Generate mock articles
  const numArticles = rand(1, 3);
  const articles = Array.from({ length: numArticles }, () => generateMockArticle());

  let inserted = 0;
  let duplicates = 0;

  for (const article of articles) {
    try {
      // Deduplicate by source URL
      const existing = await queryOne(
        'SELECT id FROM news_articles WHERE source_url = $1',
        [article.sourceUrl],
      );

      if (existing) {
        duplicates++;
        continue;
      }

      // Resolve team names to UUIDs
      const teamIds: string[] = [];
      for (const teamName of article.relatedTeams) {
        const row = await queryOne<{ id: string }>(
          'SELECT id FROM teams WHERE name = $1 OR short_name = $1',
          [teamName],
        );
        if (row) {
          teamIds.push(row.id);
        }
      }
      const taggedTeamIds = `{${teamIds.join(',')}}`;
      // No seeded players yet — always empty
      const taggedPlayerIds = '{}';

      // Insert the article
      const result = await query<{ id: string }>(
        `INSERT INTO news_articles (
          title, summary, category, source_name, source_url,
          thumbnail_url, published_at, tagged_team_ids, tagged_player_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          article.title,
          article.summary,
          article.category,
          article.source,
          article.sourceUrl,
          article.imageUrl,
          article.publishedAt,
          taggedTeamIds,
          taggedPlayerIds,
        ],
      );

      if (result.length > 0) {
        inserted++;

        // Publish to Kafka for downstream (e.g., NLP pipeline)
        try {
          await publishMessage(
            KafkaTopics.NEWS_INGESTED,
            {
              articleId: result[0]!.id,
              title: article.title,
              category: article.category,
              source: article.source,
              relatedTeams: article.relatedTeams,
              timestamp: new Date().toISOString(),
            },
            result[0]!.id,
          );
        } catch {
          // Kafka not available — non-critical
        }
      }
    } catch (err) {
      console.warn(`[NewsPoll] Failed to insert article:`, (err as Error).message);
    }
  }

  // Update the news cache
  try {
    const redis = getRedis();
    await redis.del('api:news:latest');
  } catch {
    // Cache invalidation failure is non-critical
  }

  return { fetched: articles.length, inserted, duplicates };
}
