import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const datasetsTable = pgTable(
  "datasets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 12 }).notNull(),
    objectPath: text("object_path").notNull(),
    fileSize: integer("file_size").notNull(),
    rowCount: integer("row_count").notNull(),
    columnCount: integer("column_count").notNull(),
    qualityScore: real("quality_score").notNull(),
    targetCandidates: jsonb("target_candidates").$type<string[]>().notNull(),
    profile: jsonb("profile")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("datasets_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const insertDatasetSchema = createInsertSchema(datasetsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDataset = typeof datasetsTable.$inferInsert;
export type Dataset = typeof datasetsTable.$inferSelect;

export const uploadTicketsTable = pgTable(
  "dataset_upload_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    size: integer("size").notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dataset_upload_tickets_object_path_idx").on(table.objectPath),
    index("dataset_upload_tickets_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const experimentsTable = pgTable(
  "experiments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasetsTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    problemType: varchar("problem_type", { length: 32 }).notNull(),
    targetColumn: varchar("target_column", { length: 255 }).notNull(),
    featureColumns: jsonb("feature_columns").$type<string[]>().notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    metrics: jsonb("metrics")
      .$type<Record<string, unknown>>()
      .notNull(),
    featureImportance: jsonb("feature_importance")
      .$type<Array<{ feature: string; importance: number }>>()
      .notNull(),
    confusionMatrix: jsonb("confusion_matrix").$type<number[][]>(),
    durationSeconds: real("duration_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("experiments_user_created_idx").on(table.userId, table.createdAt),
    index("experiments_dataset_idx").on(table.datasetId),
  ],
);

export const reportsTable = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasetsTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    content: jsonb("content")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reports_user_created_idx").on(table.userId, table.createdAt),
  ],
);