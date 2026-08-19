export type EntityKind = "wine" | "winery";
export type JsonObject = Record<string, unknown>;

export const wineFields = [
  "official_name", "producer", "vintage", "varietals", "blend_composition", "vineyard",
  "appellation", "region", "state_province", "country", "category", "style", "sweetness",
  "abv", "residual_sugar", "acidity", "ph", "production_information", "aging_method",
  "oak_treatment", "description", "tasting_notes", "food_pairings", "serving_recommendations",
  "aging_guidance", "production_quantity", "technical_details",
] as const;

export const wineryFields = [
  "official_name", "website_url", "street_address", "city", "state_province", "postal_code",
  "country", "region", "appellation", "latitude", "longitude", "phone", "email", "description",
  "tasting_room_information", "reservation_information", "hours", "social_links", "official_details",
] as const;

export function sanitizeData(kind: EntityKind, data: unknown) {
  const allowed = new Set<string>(kind === "wine" ? wineFields : wineryFields);
  const source = data && typeof data === "object" && !Array.isArray(data) ? data as JsonObject : {};
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key) && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)));
}

export function automaticAcceptance(kind: EntityKind, record: JsonObject, result: JsonObject, sources: JsonObject[]) {
  const primaryTypes = new Set(["official_winery", "producer_technical_sheet", "official_pdf", "official_distributor", "tourism_organization", "official_business"]);
  const hasPrimary = sources.some((source) => primaryTypes.has(String(source.source_type)) && source.exact_match === true);
  const exactIdentity = result.exact_name === true && result.exact_producer === true;
  const exactVintage = kind === "winery" || record.non_vintage === true || record.vintage == null || result.exact_vintage === true;
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  return result.confidence === "high" && result.match_type === "exact" && hasPrimary && exactIdentity && exactVintage && conflicts.length === 0;
}
