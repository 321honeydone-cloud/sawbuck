// photo_loader: optional Jobber GraphQL lookups (quotes, jobs, property count).
//
// Configure with JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET and JOBBER_REFRESH_TOKEN
// (or a short-lived JOBBER_ACCESS_TOKEN for testing). When none are set the
// loader runs on SawBUCK's own estimate dates only.
//
// NOT live-tested in the 2026-09-30 build session (no Jobber API credentials
// in the build container). The field names follow Jobber's public GraphQL
// schema; if a query is rejected the loader logs it and carries on without
// Jobber, so photo loading never breaks because of this file.

import { addressesMatch } from "./address";
import type { QuoteWindow } from "./types";

const GRAPHQL = "https://api.getjobber.com/api/graphql";
const VERSION = process.env.JOBBER_GRAPHQL_VERSION || "2025-01-20";

let cached: { token: string; exp: number } | null = null;

export function jobberConfigured(): boolean {
  return Boolean(process.env.JOBBER_ACCESS_TOKEN || (process.env.JOBBER_CLIENT_ID && process.env.JOBBER_CLIENT_SECRET && process.env.JOBBER_REFRESH_TOKEN));
}

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.token;
  if (process.env.JOBBER_REFRESH_TOKEN && process.env.JOBBER_CLIENT_ID && process.env.JOBBER_CLIENT_SECRET) {
    const res = await fetch("https://api.getjobber.com/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.JOBBER_CLIENT_ID,
        client_secret: process.env.JOBBER_CLIENT_SECRET,
        refresh_token: process.env.JOBBER_REFRESH_TOKEN,
      }),
    });
    if (!res.ok) throw new Error(`Jobber token refresh failed (${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: data.access_token, exp: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 };
    return data.access_token;
  }
  if (process.env.JOBBER_ACCESS_TOKEN) return process.env.JOBBER_ACCESS_TOKEN;
  throw new Error("Jobber is not configured");
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token()}`, "X-JOBBER-GRAPHQL-VERSION": VERSION },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Jobber GraphQL ${res.status}`);
  const data = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (data.errors?.length) throw new Error(`Jobber GraphQL: ${data.errors.map((e) => e.message).join("; ")}`);
  if (!data.data) throw new Error("Jobber GraphQL: empty reply");
  return data.data;
}

export interface JobberPropertyContext {
  clientId: string;
  isCompany: boolean;
  propertyCount: number;
  /** Address matched to the quote, or null when the client has one property. */
  propertyId: string | null;
  quotes: QuoteWindow[];
}

interface ClientsReply {
  clients: {
    nodes: {
      id: string;
      name: string;
      isCompany: boolean;
      properties: { nodes: { id: string; address: { street1: string | null } }[] };
      quotes: { nodes: { id: string; quoteNumber: number; title: string | null; createdAt: string; approvedAt: string | null; property: { id: string } | null; jobs: { nodes: { id: string; completedAt: string | null }[] } }[] };
    }[];
  };
}

/** Jobber quotes and jobs for the client's property that matches `streetLine`. */
export async function jobberQuotesForProperty(clientName: string, streetLine: string): Promise<JobberPropertyContext | null> {
  const reply = await gql<ClientsReply>(
    `query SawbuckPhotoLoader($term: String!) {
      clients(searchTerm: $term, first: 5) {
        nodes {
          id name isCompany
          properties(first: 50) { nodes { id address { street1 } } }
          quotes(first: 50) {
            nodes { id quoteNumber title createdAt approvedAt property { id } jobs(first: 5) { nodes { id completedAt } } }
          }
        }
      }
    }`,
    { term: clientName }
  );
  const want = clientName.trim().toLowerCase();
  const client = reply.clients.nodes.find((c) => c.name.trim().toLowerCase() === want);
  if (!client) return null;
  const props = client.properties.nodes;
  const matched = streetLine ? props.find((p) => p.address.street1 && addressesMatch(p.address.street1, streetLine)) : null;
  const propertyId = matched?.id ?? (props.length === 1 ? props[0].id : null);
  const quotes: QuoteWindow[] = client.quotes.nodes
    .filter((q) => !propertyId || !q.property || q.property.id === propertyId)
    .map((q) => ({
      id: `jobber:${q.id}`,
      label: `${q.title || "Quote"} · Jobber #${q.quoteNumber}`,
      sawbuckEstimateId: null,
      jobberQuoteNumber: String(q.quoteNumber),
      createdAt: q.createdAt,
      approvedAt: q.approvedAt,
      jobCompletedAt: q.jobs.nodes.map((j) => j.completedAt).filter(Boolean).sort().pop() ?? null,
    }));
  return { clientId: client.id, isCompany: client.isCompany, propertyCount: props.length, propertyId, quotes };
}
