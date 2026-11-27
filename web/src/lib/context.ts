import "server-only";
import { ensureOpenIteration, requireEvidenceEditing, transaction } from "./db";
import { ApiError } from "./api";
import { contextDocumentSchema } from "./types";

export async function saveContext(id: string, input: {
  filename: string; content_text: string;
  source_type: "text" | "file" | "github";
  source_url?: string; source_revision?: string; storage_path?: string;
}) {
  return transaction(async (client) => {
    const project = await client.query("SELECT status FROM projects WHERE id = $1 FOR UPDATE", [id]);
    if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
    if (!["PREPARATION", "CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.rows[0].status)) {
      throw new ApiError(409, "Taustamateriaaleja voi lisätä valmistelussa tai työpajojen välillä.");
    }
    await requireEvidenceEditing(client, id);
    await ensureOpenIteration(client, id);
    const result = await client.query(
      `INSERT INTO context_documents
       (project_id, filename, content_text, source_type, source_url, source_revision, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, input.filename, input.content_text, input.source_type,
        input.source_url ?? null, input.source_revision ?? null, input.storage_path ?? null],
    );
    await client.query("UPDATE solution_candidates SET is_superseded=true WHERE project_id=$1", [id]);
    await client.query(
      `UPDATE projects SET workshop_agenda=NULL,agenda_mode=NULL,status=CASE WHEN EXISTS(
         SELECT 1 FROM sessions WHERE project_id=$1 AND uploaded_at IS NOT NULL)
         THEN 'WORKSHOP_UPLOADED' ELSE 'PREPARATION' END WHERE id=$1`, [id],
    );
    return contextDocumentSchema.parse(result.rows[0]);
  });
}
