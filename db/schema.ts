import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  questionCount: integer("question_count").notNull(),
  typesJson: text("types_json").notNull(),
  salt: text("salt").notNull(),
  hashesJson: text("hashes_json").notNull(),
  resultsJson: text("results_json"),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});
