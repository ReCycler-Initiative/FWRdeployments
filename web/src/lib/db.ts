import "server-only";
import { Pool, type PoolClient } from "pg";
import { ApiError } from "./api";
import {
  agentTaskSchema, candidateSchema, contextDocumentSchema, iterationSchema, projectSchema,
  sessionSchema, type Iteration, type StoredWorkspace,
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

export async function ensureOpenIteration(client: PoolClient, projectId: string): Promise<void> {
  const schema = await client.query<{ supported: boolean }>(
    "SELECT to_regclass('public.ooda_iterations') IS NOT NULL AS supported",
  );
  // Installations before the iteration schema do not require an iteration.
  if (!schema.rows[0].supported) return;
  const project = await client.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [projectId]);
  if (!project.rows.length) throw new ApiError(404, "Projektia ei löytynyt.");
  const active = await client.query(
    "SELECT id FROM ooda_iterations WHERE project_id=$1 AND status <> 'COMPLETED'", [projectId],
  );
  if (active.rows.length) return;
  const created = await client.query(
    `INSERT INTO ooda_iterations(project_id,iteration_number,baseline_version_id)
     SELECT $1, COALESCE((SELECT max(iteration_number) FROM ooda_iterations WHERE project_id=$1),0)+1, b.id
     FROM baseline_versions b WHERE b.project_id=$1 ORDER BY b.version_number DESC LIMIT 1
     RETURNING id`, [projectId],
  );
  if (!created.rows.length) throw new ApiError(409, "Projektin baseline puuttuu. Tarkista tietokannan migraatiot ennen aineiston lisäämistä.");
}

export async function activeIteration(client: PoolClient, projectId: string): Promise<Iteration | null> {
  const schema = await client.query<{ supported: boolean }>("SELECT to_regclass('public.ooda_iterations') IS NOT NULL AS supported");
  if (!schema.rows[0].supported) return null;
  const result = await client.query("SELECT * FROM ooda_iterations WHERE project_id=$1 AND status <> 'COMPLETED'", [projectId]);
  return result.rows[0] ? iterationSchema.parse(result.rows[0]) : null;
}

export async function requireActDecision(client: PoolClient, projectId: string, candidateId: string): Promise<Iteration> {
  const iteration = await activeIteration(client, projectId);
  if (!iteration || iteration.status !== "ACT" || iteration.selected_solution_id !== candidateId) {
    throw new ApiError(409, "Vahvista tämän ratkaisun päätös Päätä-osiossa ennen tuotoksen tekemistä.");
  }
  return iteration;
}

export async function requireEvidenceEditing(client: PoolClient, projectId: string): Promise<void> {
  if ((await activeIteration(client, projectId))?.status === "ACT") {
    throw new ApiError(409, "Kierroksen päätös on vahvistettu. Katselmoi tuotos ja päätä kierros Toimi-osiossa ennen aineiston muuttamista.");
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
    const iteration = await activeIteration(client, id);
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
      `SELECT * FROM solution_candidates WHERE project_id = $1 AND (NOT is_superseded OR is_selected OR id=$2)
       ORDER BY CASE solution_type WHEN 'PROCESS' THEN 0 WHEN 'TECHNICAL' THEN 1 ELSE 2 END, id`, [id, iteration?.selected_solution_id ?? null],
    );
    const tasks = await client.query(
      `SELECT t.* FROM agent_tasks t JOIN projects p ON p.id=t.project_id
       JOIN solution_candidates c ON c.id=t.candidate_id AND c.project_id=p.id
       WHERE t.project_id=$1 AND c.is_selected AND p.delivery_mode='AGENTS'
         AND t.delivery_id IS NOT DISTINCT FROM p.active_delivery_id
       ORDER BY t.updated_at, t.id`, [id],
    );
    return {
      iteration,
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
