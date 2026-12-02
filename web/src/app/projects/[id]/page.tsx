import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/db";
import { listArtifacts } from "@/lib/media";
import { uuid } from "@/lib/types";
import { WorkspaceView } from "@/components/workspace-view";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const input = uuid.safeParse((await params).id);
  if (!input.success) notFound();
  const workspace = await getWorkspace(input.data);
  if (!workspace) notFound();
  return <WorkspaceView initial={{ ...workspace, artifacts: await listArtifacts(input.data) }} />;
}
