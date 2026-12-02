import "server-only";
import { Pool, type PoolClient } from "pg";
import {
  agentTaskSchema, candidateSchema, contextDocumentSchema, projectSchema,
  sessionSchema, type StoredWorkspace,
} from "./types";

const globalForDatabase = globalThis as typeof globalThis & {
  frwDatabase?: Pool;
};

export function getDatabase(): Pool {
  if (!globalForDatabase.frwDatabase) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    const pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", (error: Error) => {
      console.error("Unexpected idle PostgreSQL connection error", error);
    });
    globalForDatabase.frwDatabase = pool;
  }
  return globalForDatabase.frwDatabase;
}

export async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabase().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listProjects() {
  const result = await getDatabase().query(
    "SELECT * FROM projects ORDER BY created_at DESC",
  );
  return result.rows.map((row) => projectSchema.parse(row));
}

export async function getProject(id: string) {
  const result = await getDatabase().query("SELECT * FROM projects WHERE id = $1", [id]);
  return result.rows[0] ? projectSchema.parse(result.rows[0]) : null;
}

export async function getWorkspace(id: string): Promise<StoredWorkspace | null> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const projectResult = await client.query("SELECT * FROM projects WHERE id = $1", [id]);
    if (!projectResult.rows[0]) return null;
    const documents = await client.query(
      "SELECT * FROM context_documents WHERE project_id = $1 ORDER BY created_at", [id],
    );
    const sessions = await client.query(
      "SELECT * FROM sessions WHERE project_id = $1 ORDER BY COALESCE(uploaded_at, created_at) DESC, id", [id],
    );
    const transcripts = await client.query(
      "SELECT * FROM workshop_transcripts WHERE project_id=$1 ORDER BY created_at,id", [id],
    );
    const candidates = await client.query(
      `SELECT * FROM solution_candidates WHERE project_id = $1 AND (NOT is_superseded OR is_selected)
       ORDER BY CASE solution_type WHEN 'PROCESS' THEN 0 WHEN 'TECHNICAL' THEN 1 ELSE 2 END, id`, [id],
    );
    const tasks = await client.query(
      `SELECT t.* FROM agent_tasks t JOIN projects p ON p.id=t.project_id
       JOIN solution_candidates c ON c.id=t.candidate_id AND c.project_id=p.id
       WHERE t.project_id=$1 AND c.is_selected
         AND t.delivery_id IS NOT DISTINCT FROM p.active_delivery_id
       ORDER BY t.updated_at, t.id`, [id],
    );
    return {
      project: projectSchema.parse(projectResult.rows[0]),
      documents: documents.rows.map((row) => contextDocumentSchema.parse(row)),
      sessions: sessions.rows.map((row) => sessionSchema.parse({
        ...row, transcripts: transcripts.rows.filter((transcript) => transcript.session_id === row.id),
      })),
      candidates: candidates.rows.map((row) => candidateSchema.parse(row)),
      tasks: tasks.rows.map((row) => agentTaskSchema.parse(row)),
    };
  });
}
