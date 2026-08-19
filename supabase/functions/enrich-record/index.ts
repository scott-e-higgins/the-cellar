import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { automaticAcceptance, sanitizeData, wineFields, wineryFields, type EntityKind, type JsonObject } from "../_shared/enrichment.ts";

type AttemptType = "find" | "refresh" | "batch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const stringArray = { type: "array", items: { type: "string" } };

function dataSchema(kind: EntityKind) {
  const properties: Record<string, unknown> = {};
  const fields = kind === "wine" ? wineFields : wineryFields;
  for (const field of fields) properties[field] = ["varietals", "food_pairings", "social_links"].includes(field) ? stringArray : ["vintage", "abv", "ph", "latitude", "longitude"].includes(field) ? nullableNumber : nullableString;
  return { type: "object", additionalProperties: false, properties, required: [...fields] };
}

function resultSchema(kind: EntityKind) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
      match_type: { type: "string", enum: ["exact", "general", "inferred", "ambiguous", "none"] },
      exact_name: { type: "boolean" },
      exact_producer: { type: "boolean" },
      exact_vintage: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      match_explanation: { type: "string" },
      data: dataSchema(kind),
      conflicts: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { field: { type: "string" }, existing: nullableString, online: nullableString, reason: { type: "string" } },
          required: ["field", "existing", "online", "reason"],
        },
      },
      sources: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            name: { type: "string" }, url: { type: "string" },
            source_type: { type: "string", enum: ["official_winery", "producer_technical_sheet", "official_pdf", "official_distributor", "wine_database", "professional_source", "retailer", "tourism_organization", "official_business", "secondary", "other"] },
            exact_match: { type: "boolean" },
            contributed_fields: stringArray,
          },
          required: ["name", "url", "source_type", "exact_match", "contributed_fields"],
        },
      },
    },
    required: ["confidence", "match_type", "exact_name", "exact_producer", "exact_vintage", "match_explanation", "data", "conflicts", "sources"],
  };
}

function promptFor(kind: EntityKind, record: JsonObject, winery?: JsonObject | null) {
  const identity = kind === "wine"
    ? { winery: winery?.name ?? null, wine_name: record.name, vintage: record.non_vintage ? "NV" : record.vintage, existing_facts: { style: record.style, category: record.category, sweetness: record.sweetness, country: record.country, state: record.state, region: record.region, appellation: record.appellation, vineyard: record.vineyard } }
    : { winery_name: record.name, existing_facts: { city: record.city, state: record.state, country: record.country, region: record.region, website_url: record.website_url } };
  return `Research this ${kind} for a private household wine cellar. Prefer official producer pages, official technical sheets/PDFs, official distributors, and official regional organizations. Do not rely on snippets, user reviews, random blogs, or SEO pages when primary sources exist. Do not invent missing facts.\n\nIdentity:\n${JSON.stringify(identity)}\n\nMatching rules:\n- Be conservative. Punctuation and accents may vary, but the producer and wine identity must agree.\n- For a vintage wine, HIGH confidence requires the exact vintage for vintage-specific claims. A general producer page may only support general facts and must use match_type general with at most MEDIUM confidence.\n- If a source is for another vintage, do not transfer vintage-specific details; report the mismatch in conflicts.\n- For a winery, HIGH confidence requires a clear official-site identity match.\n- Keep descriptions concise, factual, and free of marketing fluff.\n- Return null or [] when a field is not reliably available.\n- List only sources actually used and identify which fields each source supports.`;
}

function outputText(response: JsonObject) {
  for (const item of (response.output as JsonObject[] | undefined) ?? []) {
    if (item.type !== "message") continue;
    for (const content of (item.content as JsonObject[] | undefined) ?? []) if (content.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return "";
}

function safeSource(source: JsonObject) {
  try {
    const url = new URL(String(source.url));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return {
      source_name: String(source.name || url.hostname), source_url: url.toString(),
      source_type: String(source.source_type || "other"), exact_match: Boolean(source.exact_match),
      contributed_fields: Array.isArray(source.contributed_fields) ? source.contributed_fields.map(String).slice(0, 30) : [],
    };
  } catch { return null; }
}

async function callOpenAI(kind: EntityKind, record: JsonObject, winery?: JsonObject | null) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("The enrichment provider is not configured yet.");
  const model = Deno.env.get("ENRICHMENT_MODEL") || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: [
        { role: "system", content: "You are a cautious wine and winery research assistant. Extract only source-grounded facts and obey the supplied JSON schema." },
        { role: "user", content: promptFor(kind, record, winery) },
      ],
      text: { format: { type: "json_schema", name: `${kind}_enrichment`, strict: true, schema: resultSchema(kind) } },
      max_output_tokens: 2600,
      store: false,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Provider request failed (${response.status}).`);
  const text = outputText(body as JsonObject);
  if (!text) throw new Error("The enrichment provider returned no structured result.");
  return { body: body as JsonObject, result: JSON.parse(text) as JsonObject, model };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishable = (() => {
    const values = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    if (values) { try { return JSON.parse(values).default as string; } catch { /* legacy fallback */ } }
    return Deno.env.get("SUPABASE_ANON_KEY")!;
  })();
  const authorization = request.headers.get("Authorization") ?? "";
  const client = createClient(supabaseUrl, publishable, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return Response.json({ error: "Sign in is required." }, { status: 401, headers: corsHeaders });

  try {
    const body = await request.json() as { action?: string; entityKind?: EntityKind; entityId?: string; force?: boolean; householdId?: string; limit?: number };
    if (body.action === "batch") {
      if (!body.householdId || (body.entityKind !== "wine" && body.entityKind !== "winery")) throw new Error("A household and record type are required.");
      const { data: membership } = await client.from("household_members").select("role").eq("household_id", body.householdId).eq("user_id", authData.user.id).single();
      if (!membership || !["owner", "editor"].includes(membership.role)) return Response.json({ error: "Full household access is required." }, { status: 403, headers: corsHeaders });
      const table = body.entityKind === "wine" ? "wines" : "wineries";
      const idColumn = body.entityKind === "wine" ? "wine_id" : "winery_id";
      const limit = Math.max(1, Math.min(Number(body.limit) || 3, 5));
      const { data: records, error } = await client.from(table).select("id").eq("household_id", body.householdId).order("created_at").limit(500);
      if (error) throw error;
      const { data: attempts } = await client.from("enrichment_attempts").select(idColumn).eq("household_id", body.householdId).not(idColumn, "is", null);
      const attempted = new Set((attempts ?? []).map((row: JsonObject) => String(row[idColumn])));
      const ids = (records ?? []).map((row: JsonObject) => String(row.id)).filter((id: string) => !attempted.has(id)).slice(0, limit);
      const results = [];
      for (const entityId of ids) results.push(await enrichOne(client, authData.user.id, body.entityKind, entityId, "batch", false));
      return Response.json({ processed: results.length, remaining: Math.max(0, (records?.length ?? 0) - attempted.size - results.length), results }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.entityKind !== "wine" && body.entityKind !== "winery") throw new Error("Choose a wine or winery.");
    if (!body.entityId) throw new Error("A record is required.");
    const result = await enrichOne(client, authData.user.id, body.entityKind, body.entityId, body.force ? "refresh" : "find", Boolean(body.force));
    return Response.json(result, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed.";
    return Response.json({ error: message }, { status: message.includes("configured") ? 503 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function enrichOne(client: ReturnType<typeof createClient>, userId: string, kind: EntityKind, entityId: string, attemptType: AttemptType, force: boolean) {
  const table = kind === "wine" ? "wines" : "wineries";
  const idColumn = kind === "wine" ? "wine_id" : "winery_id";
  const onlineTable = kind === "wine" ? "wine_online_info" : "winery_online_info";
  const onlineId = kind === "wine" ? "wine_id" : "winery_id";
  const { data: record, error: recordError } = await client.from(table).select("*").eq("id", entityId).single();
  if (recordError || !record) throw new Error("Record not found or not authorized.");
  const { data: membership } = await client.from("household_members").select("role").eq("household_id", record.household_id).eq("user_id", userId).single();
  if (!membership || !["owner", "editor"].includes(membership.role)) throw new Error("Full household access is required.");
  if (!force) {
    const { data: cached } = await client.from(onlineTable).select("*").eq(onlineId, entityId).maybeSingle();
    if (cached) return { cached: true, status: "enriched", onlineInfo: cached };
    const { data: prior } = await client.from("enrichment_attempts").select("*").eq(idColumn, entityId).in("status", ["ready_for_review", "no_match"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prior) return { cached: true, status: prior.status, attempt: prior };
  }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: minuteCount }, { count: dayCount }] = await Promise.all([
    client.from("enrichment_attempts").select("id", { count: "exact", head: true }).eq("household_id", record.household_id).gte("created_at", minuteAgo),
    client.from("enrichment_attempts").select("id", { count: "exact", head: true }).eq("household_id", record.household_id).gte("created_at", dayAgo),
  ]);
  if ((minuteCount ?? 0) >= 12 || (dayCount ?? 0) >= 300) throw new Error("Enrichment rate limit reached. Please try again later.");
  const { data: attempt, error: attemptError } = await client.from("enrichment_attempts").insert({ household_id: record.household_id, [idColumn]: entityId, status: "searching", attempt_type: attemptType, created_by: userId, provider: "openai" }).select("*").single();
  if (attemptError || !attempt) throw attemptError ?? new Error("Could not start enrichment.");
  try {
    let winery: JsonObject | null = null;
    if (kind === "wine" && record.winery_id) winery = (await client.from("wineries").select("*").eq("id", record.winery_id).single()).data as JsonObject | null;
    const { body, result, model } = await callOpenAI(kind, record as JsonObject, winery);
    const data = sanitizeData(kind, result.data);
    const sources = ((result.sources as JsonObject[] | undefined) ?? []).map(safeSource).filter(Boolean) as JsonObject[];
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    const noMatch = result.confidence === "none" || result.match_type === "none" || Object.keys(data).length === 0 || sources.length === 0;
    const autoAccepted = !noMatch && automaticAcceptance(kind, record as JsonObject, result, sources);
    const status = noMatch ? "no_match" : autoAccepted ? "enriched" : "ready_for_review";
    const usage = body.usage && typeof body.usage === "object" ? body.usage : {};
    const update = await client.from("enrichment_attempts").update({ status, confidence: noMatch ? "none" : result.confidence, match_type: noMatch ? "none" : result.match_type, proposed_data: data, conflict_data: { conflicts }, match_explanation: String(result.match_explanation || ""), model, request_id: String(body.id || ""), auto_accepted: autoAccepted, completed_at: new Date().toISOString(), usage_data: usage }).eq("id", attempt.id).select("*").single();
    if (update.error) throw update.error;
    if (sources.length) {
      const sourceInsert = await client.from("enrichment_sources").insert(sources.map((source) => ({ ...source, household_id: record.household_id, attempt_id: attempt.id })));
      if (sourceInsert.error) throw sourceInsert.error;
    }
    if (autoAccepted) {
      const accepted = await client.rpc("accept_enrichment_attempt", { p_attempt_id: attempt.id, p_edited_data: null });
      if (accepted.error) throw accepted.error;
    }
    return { cached: false, status, attempt: update.data, sources, autoAccepted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed.";
    await client.from("enrichment_attempts").update({ status: "failed", confidence: "none", match_type: "none", failure_reason: message.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", attempt.id);
    throw new Error(message);
  }
}
