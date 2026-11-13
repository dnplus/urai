import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  protocolVersion: text("protocol_version").notNull().default("1.0"),
  progressPhase: text("progress_phase").notNull().default("not_connected"),
  progressSequence: integer("progress_sequence").notNull().default(0),
  progressAt: integer("progress_at"),
  approvalKind: text("approval_kind"),
  readHash: text("read_hash").notNull(),
  writeHash: text("write_hash").notNull(),
  nickname: text("nickname").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  submittedAt: integer("submitted_at"),
  idempotencyKey: text("idempotency_key"),
  payloadHash: text("payload_hash"),
  report: text("report"),
  selfType: text("self_type"),
  via: text("via"),
}, (table) => [index("sessions_expiry").on(table.expiresAt)]);

export const rememberedResults=sqliteTable('remembered_results',{
 id:text('id').primaryKey(),tokenHash:text('token_hash').notNull(),expiresAt:integer('expires_at').notNull(),report:text('report').notNull(),selfType:text('self_type'),
},table=>[index('remembered_expiry').on(table.expiresAt)]);

// A team board: the owner reads it with a view token; members post snapshots through the join code.
export const teams=sqliteTable('teams',{
 id:text('id').primaryKey(),name:text('name').notNull(),viewHash:text('view_hash').notNull(),joinCode:text('join_code').notNull().unique(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
},table=>[index('teams_expiry').on(table.expiresAt)]);

export const teamEntries=sqliteTable('team_entries',{
 id:text('id').primaryKey(),teamId:text('team_id').notNull(),sessionId:text('session_id').notNull(),member:text('member').notNull(),snapshot:text('snapshot').notNull(),withdrawHash:text('withdraw_hash').notNull(),createdAt:integer('created_at').notNull(),
},table=>[index('team_entries_team').on(table.teamId,table.createdAt),uniqueIndex('team_entries_session').on(table.teamId,table.sessionId)]);

// A public, revocable mirror of one result: the server renders it from the stored record, so a doctored PNG cannot match it.
export const publicCards=sqliteTable('public_cards',{
 id:text('id').primaryKey(),sessionId:text('session_id').notNull().unique(),card:text('card').notNull(),revokeHash:text('revoke_hash').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
 // The collector's own counts, present only when the owner chose to publish them. Same row, so it dies with the card.
 profile:text('profile'),
},table=>[index('public_cards_expiry').on(table.expiresAt)]);

// A third-party app allowed to ask visitors for their public profile. A client without a secret is a public client and relies on PKCE alone.
export const oauthClients=sqliteTable('oauth_clients',{
 id:text('id').primaryKey(),name:text('name').notNull(),redirectUris:text('redirect_uris').notNull(),secretHash:text('secret_hash'),createdAt:integer('created_at').notNull(),
});

// One row per app and public card: the pending authorization code, then the current access and refresh tokens. Only hashes are kept.
export const oauthGrants=sqliteTable('oauth_grants',{
 id:text('id').primaryKey(),clientId:text('client_id').notNull(),cardId:text('card_id').notNull(),scope:text('scope').notNull(),manageHash:text('manage_hash').notNull(),createdAt:integer('created_at').notNull(),
 codeHash:text('code_hash'),codeChallenge:text('code_challenge'),codeRedirectUri:text('code_redirect_uri'),codeExpiresAt:integer('code_expires_at'),
 accessHash:text('access_hash'),accessExpiresAt:integer('access_expires_at'),refreshHash:text('refresh_hash'),previousRefreshHash:text('previous_refresh_hash'),
},table=>[uniqueIndex('oauth_grants_client_card').on(table.clientId,table.cardId),index('oauth_grants_card').on(table.cardId),index('oauth_grants_code').on(table.codeHash),index('oauth_grants_access').on(table.accessHash),index('oauth_grants_refresh').on(table.refreshHash),index('oauth_grants_manage').on(table.manageHash)]);

// How many people reached each step, per day and per entry point. No ids, so no row can be traced to a visitor.
export const funnel=sqliteTable('funnel',{
 day:text('day').notNull(),source:text('source').notNull(),step:text('step').notNull(),count:integer('count').notNull().default(0),
},table=>[primaryKey({columns:[table.day,table.source,table.step]})]);

// One row per day and result shape: how many people finished, as which type and rarity, on which model family and client. No ids.
// pattern is the four letters with lean axes in lowercase and unsettled ones as '?'.
export const resultTally=sqliteTable('result_tally',{
 day:text('day').notNull(),pattern:text('pattern').notNull(),rarity:text('rarity').notNull(),family:text('family').notNull(),client:text('client').notNull(),count:integer('count').notNull().default(0),
},table=>[primaryKey({columns:[table.day,table.pattern,table.rarity,table.family,table.client]})]);
