import { z } from "zod";

export const projectStatuses = [
  "PREPARATION",
  "WORKSHOP_UPLOADED",
  "CANDIDATES_READY",
  "BUILDING",
  "READY_FOR_REVIEW",
] as const;
export const agentRoles = ["architect", "coder", "data", "qa"] as const;
export const uuid = z.string().uuid();
export const generationModeSchema = z.enum(["mock", "ai"]);
export type GenerationMode = z.infer<typeof generationModeSchema>;
export const workerCapabilitiesSchema = z.object({
  mode: generationModeSchema,
  openai_configured: z.boolean(),
  video_signals_configured: z.boolean(),
});
export const aiCapabilitiesSchema = z.discriminatedUnion("status", [
  workerCapabilitiesSchema.extend({ status: z.literal("available") }),
  z.object({ status: z.literal("unavailable") }),
]);
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;
const timestamp = z.union([z.date(), z.string()]).transform((value) =>
  value instanceof Date ? value.toISOString() : value,
);

export const projectSchema = z.object({
  id: uuid,
  title: z.string(),
  language: z.enum(["fi", "en"]),
  description: z.string().nullable(),
  target_systems: z.array(z.string()),
  status: z.enum(projectStatuses),
  workshop_agenda: z.string().nullable(),
  agenda_mode: generationModeSchema.nullable(),
  active_delivery_id: uuid.nullable(),
  delivery_mode: z.enum(["PROMPTS", "PLAN", "AGENTS"]).nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const contextDocumentSchema = z.object({
  id: uuid,
  project_id: uuid,
  filename: z.string(),
  content_text: z.string().nullable(),
  source_type: z.enum(["text", "file", "github"]),
  source_url: z.string().nullable(),
  source_revision: z.string().nullable(),
  storage_path: z.string().nullable(),
  embedding: z.preprocess(
    (value) => typeof value === "string" ? JSON.parse(value) : value,
    z.array(z.number()).length(1536).nullable(),
  ),
  created_at: timestamp,
});
export const painPointSchema = z.object({
  timestamp_seconds: z.number().nonnegative(),
  emotion: z.string(),
  intensity: z.number().min(0).max(1),
  quote: z.string(),
  description: z.string(),
});
export const sessionSchema = z.object({
  id: uuid,
  project_id: uuid,
  video_path: z.string().nullable(),
  transcript_vtt: z.string().nullable(),
  transcript_path: z.string().nullable(),
  transcript_filename: z.string().nullable(),
  pain_points_json: z.union([
    z.array(painPointSchema),
    z.object({ error: z.string() }),
    z.object({ status: z.enum(["pending", "running"]) }),
  ]).nullable(),
  current_state_mermaid: z.string().nullable(),
  title: z.string(),
  created_at: timestamp,
  agenda: z.string().nullable(),
  agenda_mode: generationModeSchema.nullable(),
  analysis_mode: generationModeSchema.nullable(),
  notes: z.string(),
  scheduled_at: timestamp.nullable(),
  meeting_url: z.string().nullable(),
  uploaded_at: timestamp.nullable(),
  processed_at: timestamp.nullable(),
});
export const candidateSchema = z.object({
  id: uuid,
  project_id: uuid,
  title: z.string(),
  summary: z.string().nullable(),
  benefits: z.array(z.string()),
  risks: z.array(z.string()),
  generation_mode: generationModeSchema.nullable(),
  architecture_spec: z.string().nullable(),
  is_selected: z.boolean(),
  is_superseded: z.boolean(),
  solution_type: z.enum(["TECHNICAL", "PROCESS", "HYBRID"]),
  implementation_status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"]),
  implementation_notes: z.string(),
  implementation_url: z.string().nullable(),
  implementation_updated_at: timestamp,
});
export const agentTaskSchema = z.object({
  id: uuid,
  project_id: uuid,
  candidate_id: uuid,
  agent_role: z.enum(agentRoles),
  status: z.enum(["pending", "running", "completed", "failed"]),
  output_log: z.string().nullable(),
  generation_mode: generationModeSchema.nullable(),
  artifacts_path: z.string().nullable(),
  delivery_id: uuid.nullable(),
  updated_at: timestamp,
});
export const createProjectSchema = z.object({
  language: z.enum(["fi", "en"]).optional(),
  title: z.string().trim().min(1, "Anna projektin otsikko.").max(200),
  description: z.string().trim().min(1, "Kuvaa projektin tavoite.").max(10000),
  target_systems: z.array(z.string().trim().min(1).max(200)).max(50),
});
export const createContextSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  content_text: z.string().trim().min(1).max(100000),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectStatus = Project["status"];
export type DeliveryMode = NonNullable<Project["delivery_mode"]>;
export type ContextDocument = z.infer<typeof contextDocumentSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SolutionCandidate = z.infer<typeof candidateSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type PainPoint = z.infer<typeof painPointSchema>;
export interface Artifact {
  path: string;
  size: number;
}
export interface Workspace {
  ai: AiCapabilities;
  project: Project;
  documents: ContextDocument[];
  sessions: Session[];
  candidates: SolutionCandidate[];
  tasks: AgentTask[];
  artifacts: Artifact[];
}
export type StoredWorkspace = Omit<Workspace, "artifacts" | "ai">;

export const workspaceSchema = z.object({
  ai: aiCapabilitiesSchema,
  project: projectSchema,
  documents: z.array(contextDocumentSchema),
  sessions: z.array(sessionSchema),
  candidates: z.array(candidateSchema),
  tasks: z.array(agentTaskSchema),
  artifacts: z.array(z.object({ path: z.string(), size: z.number() })),
});
