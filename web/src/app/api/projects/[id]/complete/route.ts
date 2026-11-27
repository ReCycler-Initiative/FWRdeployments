import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { requireActDecision, transaction } from "@/lib/db";
import { uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      expected_iteration_id: uuid,
      expected_delivery_id: uuid,
      feedback: z.string().trim().min(1).max(10000),
    }));
    await transaction(async (client) => {
      const project = (await client.query(
        `SELECT p.*,c.id AS candidate_id FROM projects p
         JOIN solution_candidates c ON c.project_id=p.id AND c.is_selected WHERE p.id=$1 FOR UPDATE OF p`, [id],
      )).rows[0];
      if (!project || project.status !== "READY_FOR_REVIEW" || project.active_delivery_id !== input.expected_delivery_id) {
        throw new ApiError(409, "Katselmoi nykyinen valmis tuotos ennen kierroksen päättämistä.");
      }
      const iteration = await requireActDecision(client, id, project.candidate_id);
      if (iteration.id !== input.expected_iteration_id) throw new ApiError(409, "Päätöskierros on muuttunut. Päivitä työtila ja tarkista valinta.");
      await client.query(
        `INSERT INTO baseline_versions(project_id,version_number,summary,snapshot)
         SELECT $1,(SELECT max(version_number)+1 FROM baseline_versions WHERE project_id=$1),$2,
           b.snapshot || jsonb_build_object(
             'documents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'content_text',d.content_text))
               FROM context_documents d WHERE d.project_id=$1),'[]'::jsonb),
             'workshops',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'notes',s.notes,
               'transcripts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'filename',t.filename,'content',t.content))
                 FROM workshop_transcripts t WHERE t.session_id=s.id),'[]'::jsonb)))
               FROM sessions s WHERE s.project_id=$1),'[]'::jsonb),
             'accepted_deliveries',COALESCE(b.snapshot->'accepted_deliveries','[]'::jsonb) ||
               jsonb_build_array(jsonb_build_object('delivery_id',$3::uuid,'candidate_id',$4::uuid,'iteration_id',$5::uuid,
                 'decision_rationale',$6::text,'hypothesis',$7::text,'feedback',$2::text)))
         FROM baseline_versions b WHERE b.id=$8`,
        [id, input.feedback, input.expected_delivery_id, project.candidate_id, iteration.id,
          iteration.decision_rationale, iteration.hypothesis, iteration.baseline_version_id],
      );
      await client.query(
        "UPDATE ooda_iterations SET status='COMPLETED',completed_at=now(),accepted_delivery_id=$2 WHERE id=$1",
        [iteration.id, input.expected_delivery_id],
      );
    });
    return Response.json({ status: "completed" });
  });
}
