import type { Database } from "bun:sqlite";

function nowIsoString() {
  return new Date().toISOString();
}

function shouldIgnoreMigrationStatementError(sqlite: Database, statement: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.toLowerCase().includes("duplicate column name:")) {
    return false;
  }

  const match = /^\s*alter\s+table\s+(\w+)\s+add\s+column\s+(\w+)/i.exec(statement);
  if (!match) {
    return false;
  }

  const [, tableName, columnName] = match;
  const rows = sqlite.query(`pragma table_info(${tableName})`).all() as Array<{
    name?: string;
  }>;

  return rows.some((row) => row.name === columnName);
}

export { nowIsoString, shouldIgnoreMigrationStatementError };
