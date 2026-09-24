import { describe, it, expect } from "vitest";
import {
  BackupSchema,
  sanitizeBackupJson,
  BACKUP_SCHEMA_VERSION,
} from "../src/storage/backup";

describe("sanitizeBackupJson", () => {
  it("strips secret-bearing keys", () => {
    const cleaned = sanitizeBackupJson({
      schemaVersion: 1,
      secrets: [{ providerId: "openai", key: "sk-secret" }],
      apiKeys: { openai: "sk-secret" },
      transcripts: [],
    }) as Record<string, unknown>;
    expect(cleaned.secrets).toBeUndefined();
    expect(cleaned.apiKeys).toBeUndefined();
    expect(cleaned.transcripts).toEqual([]);
  });
});

describe("BackupSchema", () => {
  it("rejects backups that claim a different schema version", () => {
    const result = BackupSchema.safeParse({
      schemaVersion: 99,
      exportedAt: Date.now(),
      transcripts: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty valid backup", () => {
    const result = BackupSchema.safeParse({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      transcripts: [],
      notes: [],
      highlights: [],
    });
    expect(result.success).toBe(true);
  });
});
