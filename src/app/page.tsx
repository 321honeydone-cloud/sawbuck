import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import NewEstimateEmpty from "@/components/NewEstimateEmpty";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Land on the most recently updated estimate; if there are none, offer to create one.
export default async function Home() {
  const session = await getSession();
  const where = session && session.role !== "admin" ? { userId: session.uid } : {};
  const recent = await prisma.estimate.findFirst({
    where,
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (recent) redirect(`/estimate/${recent.id}`);
  return <NewEstimateEmpty />;
}
