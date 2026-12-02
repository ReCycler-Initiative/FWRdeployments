import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/db";
import { listArtifacts } from "@/lib/media";
import { uuid } from "@/lib/types";
import { WorkspaceView } from "@/components/workspace-view";
import { getAiCapabilities } from "@/lib/ai-capabilities";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const input = uuid.safeParse((await params).id);
  if (!input.success) notFound();
  const workspace = await getWorkspace(input.data);
  if (!workspace) notFound();
  const [artifacts, ai] = await Promise.all([listArtifacts(input.data), getAiCapabilities()]);
  return <WorkspaceView initial={{ ...workspace, artifacts, ai }} />;
}
