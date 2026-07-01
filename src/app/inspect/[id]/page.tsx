import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import InspectionWorkspace from "@/components/InspectionWorkspace";
import type { Inspection, InspectionIssue } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const row = await prisma.inspection.findUnique({ where: { id } });
  if (!row) notFound();
  if (session && session.role !== "admin" && row.userId !== session.uid) notFound();

  let issues: InspectionIssue[] = [];
  try {
    issues = (JSON.parse(row.data || "{}").issues ?? []) as InspectionIssue[];
  } catch {
    issues = [];
  }
  const inspection: Inspection = {
    id: row.id,
    name: row.name,
    location: row.location,
    status: row.status,
    userId: row.userId,
    issues,
  };
  return <InspectionWorkspace initial={inspection} />;
}
