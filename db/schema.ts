import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: text("created_at").notNull(),
});

export const answerChanges = sqliteTable("answer_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  questionIndex: integer("question_index").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  previousAnswer: text("previous_answer").notNull(),
  newAnswer: text("new_answer").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
