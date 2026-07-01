import { PrismaClient } from "@prisma/client";
import { applyOperations } from "../src/lib/operations";
import { JOB_TEMPLATES } from "../src/lib/honeydone";
import { RATEBOOK_ID, RATEBOOK_NAME, seedRateBook } from "../src/lib/rates";
import type { Estimate, Operation } from "../src/lib/types";

const prisma = new PrismaClient();

/** A blank estimate the operations engine can build onto. */
function emptyEstimate(): Estimate {
  return {
    id: "EST-10002",
    projectId: "PRJ-10001",
    name: "Fascia Replacement & Rot Repair",
    status: "draft",
    location: "Tampa, FL",
    markupDefault: 25, // HoneyDone materials markup
    finishLevel: "medium",
    aiUpdateCount: 0,
    groups: [],
    totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
  };
}

// Seed from a real HoneyDone job template so the app opens with believable data.
// The engine assigns 25% markup to materials and 0% to labor/other automatically.
const fascia = JOB_TEMPLATES.find((t) => t.key === "fascia-rot")!;
const seedOps: Operation[] = [];
for (const g of fascia.groups) {
  seedOps.push({ op: "add_group", name: g.name });
  for (const item of g.items) seedOps.push(item);
}

async function main() {
  const built = applyOperations(emptyEstimate(), seedOps).estimate;

  await prisma.chatMessage.deleteMany({ where: { estimateId: built.id } });
  await prisma.estimate.upsert({
    where: { id: built.id },
    create: {
      id: built.id,
      projectId: built.projectId,
      name: built.name,
      status: built.status,
      location: built.location,
      markupDefault: built.markupDefault,
      finishLevel: built.finishLevel,
      aiUpdateCount: built.aiUpdateCount,
      data: JSON.stringify({ groups: built.groups, totals: built.totals }),
    },
    update: {
      name: built.name,
      status: built.status,
      location: built.location,
      markupDefault: built.markupDefault,
      data: JSON.stringify({ groups: built.groups, totals: built.totals }),
    },
  });

  await prisma.chatMessage.create({
    data: {
      estimateId: built.id,
      role: "ai",
      content:
        "Here is a starting point for the fascia and rot repair. Tell me what to change, adjust the footage, swap materials, or add a section, and I will update it at HoneyDone pricing.",
    },
  });

  // Pre-populate the learning rate book from the static HoneyDone price book.
  const rateItems = seedRateBook();
  await prisma.catalog.upsert({
    where: { id: RATEBOOK_ID },
    create: { id: RATEBOOK_ID, name: RATEBOOK_NAME, type: "mixed", items: JSON.stringify(rateItems) },
    update: { items: JSON.stringify(rateItems) },
  });

  console.log(
    `Seeded ${built.name}: ${built.groups.length} groups, ` +
      `$${built.totals.estimateTotal.toLocaleString()} total. ` +
      `Rate book: ${rateItems.length} items.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
