import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  questionCount: integer("question_count").notNull(),
  typesJson: text("types_json").notNull(),
  salt: text("salt").notNull(),
  ownerHash: text("owner_hash").notNull().default(""),
  hashesJson: text("hashes_json").notNull(),
  currentAnswersJson: text("current_answers_json").notNull().default("[]"),
  resultsJson: text("results_json"),
  attemptCount: integer("attempt_count").notNull().default(0),
  usedAt: text("used_at"),
  answerKeysJson: text("answer_keys_json"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at"),
  createdAt: text("created_at").notNull(),
});

export const appUsers = sqliteTable("app_users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  pinSalt: text("pin_salt").notNull(),
  pinHash: text("pin_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("app_users_normalized_name_unique").on(table.normalizedName)]);

export const appSessions = sqliteTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").references(() => appUsers.id),
  role: text("role").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("app_sessions_user_id_idx").on(table.userId), index("app_sessions_expires_at_idx").on(table.expiresAt)]);

export const assignmentProgress = sqliteTable("assignment_progress", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  userId: text("user_id").notNull().references(() => appUsers.id),
  currentAnswersJson: text("current_answers_json").notNull().default("[]"),
  resultsJson: text("results_json").notNull().default("[]"),
  attemptCount: integer("attempt_count").notNull().default(0),
  startedAt: text("started_at"),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("assignment_progress_assignment_user_unique").on(table.assignmentId, table.userId),
  index("assignment_progress_user_id_idx").on(table.userId),
]);

export const answerChanges = sqliteTable("answer_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  userId: text("user_id").references(() => appUsers.id),
  questionIndex: integer("question_index").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  previousAnswer: text("previous_answer").notNull(),
  newAnswer: text("new_answer").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("answer_changes_assignment_user_idx").on(table.assignmentId, table.userId)]);
