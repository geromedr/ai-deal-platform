import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  getStrategyFromDeal,
  isRecord,
  parseMargin,
  parseNumber,
  parseString,
} from "../_shared/deal-feed.ts";
import {
  formatCompactCurrency,
  formatPercentLabel,
  formatTldrHierarchy,
} from "../_shared/investor-outreach.ts";

type DealRow = Record<string, unknown>;
type InvestorRow = Record<string, unknown>;
type FinancialRow = Record<string, unknown>;
type DealTermsRow = Record<string, unknown>;
type RiskRow = Record<string, unknown>;
type SiteIntelligenceRow = Record<string, unknown>;
type QueryError = { message?: string | null } | null;
type ArrayQueryResult<T> = { data: T[] | null; error: QueryError };
type RecordQueryResult<T> = { data: T | null; error: QueryError };

type RequestPayload = {
  deal_id?: string;
  investor_id?: string;
};

const AGENT_NAME = "investor-outreach";

type FailureStep =
  | "load_environment"
  | "validate_input"
  | "load_deal"
  | "load_investor"
  | "load_financials"
  | "load_deal_terms"
  | "load_risks"
  | "load_site_intelligence"
  | "build_outreach"
  | "log_ai_action"
  | "request_handler";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function errorResponse(message: string, step: FailureStep, status = 200, extra: Record<string, unknown> = {}) {
  return jsonResponse({
    success: false,
    error: true,
    message,
    details: { step },
    ...extra,
  }, status);
}

function logStepError(step: FailureStep, error: unknown, extra: Record<string, unknown> = {}) {
  console.error("investor-outreach error", {
    step,
    message: getErrorMessage(error),
    ...extra,
  });
}

function isMissingColumnError(error: { message?: string | null } | null | undefined, column: string) {
  const message = typeof error?.message === "string" ? error.message : "";
  return message.includes(`Could not find the '${column}' column`) ||
    message.includes(`.${column} does not exist`) ||
    message.includes(`column ${column} does not exist`) ||
    message.includes(`column \"${column}`) ||
    message.includes(`column \"${column}\" does not exist`);
}

function toTitleCase(value: string) {
  try {
    return value
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  } catch (error) {
    logStepError("build_outreach", error, { value });
    return parseString(value) ?? "Property";
  }
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    ).map((item) => item.trim())
    : [];
}

function compactJoin(values: Array<string | null | undefined>, separator = ", ") {
  return values.filter((value): value is string => Boolean(value && value.trim())).join(separator);
}

function normalizeRiskStatus(value: unknown) {
  return parseString(value)?.toLowerCase() ?? null;
}

function normalizeRiskSeverity(value: unknown) {
  return parseString(value)?.toLowerCase() ?? null;
}

function isOpenRisk(risk: RiskRow) {
  const status = normalizeRiskStatus(risk.status);
  return !status || (status !== "closed" && status !== "resolved" && status !== "done");
}

function compareRiskPriority(left: RiskRow, right: RiskRow) {
  const severityWeight = (risk: RiskRow) => {
    switch (normalizeRiskSeverity(risk.severity)) {
      case "critical":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  };

  const severityDiff = severityWeight(right) - severityWeight(left);
  if (severityDiff !== 0) return severityDiff;

  const leftCreatedAt = Date.parse(parseString(left.created_at) ?? "");
  const rightCreatedAt = Date.parse(parseString(right.created_at) ?? "");
  return (Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0) -
    (Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0);
}

function describeLocation(deal: DealRow) {
  return compactJoin([
    parseString(deal.suburb),
    parseString(deal.city),
    parseString(deal.state),
    parseString(deal.country),
  ]);
}

function describeHookLocation(deal: DealRow) {
  const suburb = parseString(deal.suburb);
  const state = parseString(deal.state);
  const city = parseString(deal.city);

  if (suburb && state) return `${suburb} ${state}`;
  if (city && state) return `${city} ${state}`;
  return describeLocation(deal);
}

function describeAddress(deal: DealRow) {
  const dealName = parseString(deal.deal_name);
  const address = parseString(deal.address);
  const suburb = parseString(deal.suburb);
  const city = parseString(deal.city);
  const state = parseString(deal.state);
  const postcode = parseString(deal.postcode);
  const country = parseString(deal.country);

  if (!address) {
    return dealName ?? compactJoin([suburb, city, state, postcode, country]);
  }

  const hasSuburbInAddress = suburb
    ? address.toLowerCase().includes(suburb.toLowerCase())
    : false;
  const hasCityInAddress = city
    ? address.toLowerCase().includes(city.toLowerCase())
    : false;
  const hasStateInAddress = state
    ? address.toLowerCase().includes(state.toLowerCase())
    : false;
  const hasPostcodeInAddress = postcode
    ? address.toLowerCase().includes(postcode.toLowerCase())
    : false;
  const hasCountryInAddress = country
    ? address.toLowerCase().includes(country.toLowerCase())
    : false;

  const suffix = compactJoin([
    hasSuburbInAddress ? null : suburb,
    hasCityInAddress ? null : city,
    hasStateInAddress ? null : state,
    hasPostcodeInAddress ? null : postcode,
    hasCountryInAddress ? null : country,
  ]);

  return compactJoin([address, suffix]);
}

function buildOpportunityLabel(deal: DealRow) {
  const dealName = parseString(deal.deal_name);
  const location = describeLocation(deal);
  const state = parseString(deal.state);

  if (dealName) return dealName;
  if (location) return `${location} site`;
  if (state) return `${state} site`;
  return "apartment development opportunity";
}

function buildLocationFallback(deal: DealRow) {
  const suburb = parseString(deal.suburb);
  const city = parseString(deal.city);
  const state = parseString(deal.state);
  const country = parseString(deal.country);

  if (suburb && state) return `${suburb} ${state} site`;
  if (city && state === "NSW") return `coastal ${state} site`;
  if (city && state) return `${city} ${state} site`;
  if (state && country) return `${state}, ${country} site`;
  if (state) return `${state} site`;
  if (country) return `${country} site`;
  return "apartment development site";
}

function extractFinancialMetrics(
  financials: FinancialRow[],
  siteIntelligence: SiteIntelligenceRow | null,
  dealTerms: DealTermsRow | null,
) {
  const latestFinancial = financials[0] ?? null;
  const financialMetadata = latestFinancial && isRecord(latestFinancial.metadata)
    ? latestFinancial.metadata
    : null;
  const feasibility = financialMetadata && isRecord(financialMetadata.feasibility)
    ? financialMetadata.feasibility
    : null;

  const revenue = parseNumber(feasibility?.revenue ?? feasibility?.revenue_estimate) ??
    parseNumber(latestFinancial?.gdv) ??
    parseNumber(siteIntelligence?.estimated_revenue);
  const profit = parseNumber(feasibility?.profit) ??
    parseNumber(latestFinancial?.amount) ??
    parseNumber(siteIntelligence?.estimated_profit);
  const margin = parseMargin(feasibility?.margin) ??
    (revenue !== null && revenue !== 0 && profit !== null ? profit / revenue : null);
  const preferredReturn = parseNumber(dealTerms?.preferred_return_pct);

  return {
    revenue,
    profit,
    margin,
    preferredReturn,
  };
}

function buildReturnLine(metrics: ReturnType<typeof extractFinancialMetrics>) {
  const marginValue = metrics.margin;
  const preferredReturnValue = metrics.preferredReturn;
  const profitValue = metrics.profit;
  const revenueValue = metrics.revenue;
  const marginLabel = marginValue !== null ? `~${Math.round(marginValue * 100)}% margin` : null;
  const preferredReturnLabel = preferredReturnValue !== null
    ? `~${Math.round(preferredReturnValue)}% pref return`
    : null;
  const profitLabel = formatInvestorCurrency(profitValue, "profit");
  const revenueLabel = formatInvestorCurrency(revenueValue, "GDV");

  if (marginLabel && profitLabel && revenueLabel) {
    return `${marginLabel}, ${profitLabel}, ${revenueLabel}.`;
  }

  if (preferredReturnLabel && profitLabel) {
    return `${preferredReturnLabel}, ${profitLabel}.`;
  }

  if (profitLabel && revenueLabel) {
    return `${profitLabel}, ${revenueLabel}.`;
  }

  if (profitLabel) {
    return `${profitLabel}.`;
  }

  if (marginLabel) {
    return `${marginLabel}.`;
  }

  if (preferredReturnLabel) {
    return `${preferredReturnLabel}.`;
  }

  return "Returns are supported by the latest stored feasibility snapshot.";
}

function buildRiskLine(risks: RiskRow[], siteIntelligence: SiteIntelligenceRow | null) {
  const openRisks = risks.filter(isOpenRisk).sort(compareRiskPriority);
  const topRisk = openRisks[0] ?? null;
  const topRiskTitle = parseString(topRisk?.title);
  const topRiskDescription = parseString(topRisk?.description);
  const topRiskSeverity = parseString(topRisk?.severity);
  const floodRisk = parseString(siteIntelligence?.flood_risk);

  if (topRiskTitle && topRiskSeverity) {
    return `${toTitleCase(topRiskSeverity)} risk flagged: ${topRiskTitle}.`;
  }

  if (topRiskTitle) {
    return `Primary risk to diligence: ${topRiskTitle}.`;
  }

  if (topRiskDescription) {
    return `Primary risk to diligence: ${topRiskDescription}.`;
  }

  if (floodRisk) {
    return `Planning profile currently shows flood risk at ${floodRisk}.`;
  }

  return "Key execution and planning risks still need standard diligence review.";
}

function buildDealLine(
  deal: DealRow,
  siteIntelligence: SiteIntelligenceRow | null,
) {
  const address = describeAddress(deal);
  const location = describeHookLocation(deal);
  const units = parseNumber(siteIntelligence?.estimated_units);
  const zoning = parseString(deal.zoning);
  const siteArea = parseNumber(deal.site_area);
  const dealType = buildHookDealType();

  if (location && units && address) {
    return `${location} ${dealType} at ${address} with an estimated ${units} units.`;
  }

  if (units && address) {
    return `${dealType} at ${address} with an estimated ${units} units.`;
  }

  if (location && siteArea && zoning && address) {
    return `${location} ${dealType} at ${address} on ${siteArea.toLocaleString("en-AU")} sqm with ${zoning} zoning.`;
  }

  if (siteArea && zoning && address) {
    return `${dealType} at ${address} on ${siteArea.toLocaleString("en-AU")} sqm with ${zoning} zoning.`;
  }

  if (address) {
    return `${dealType} at ${address}.`;
  }

  if (location) {
    return `${location} ${dealType}.`;
  }

  return `${buildOpportunityLabel(deal)}.`;
}

function buildHookDealType() {
  return "apartment development";
}

function buildHookMetric(
  deal: DealRow,
  metrics: ReturnType<typeof extractFinancialMetrics>,
) {
  const marginLabel = formatPercentLabel(metrics.margin ?? parseMargin(deal.target_margin));
  if (marginLabel) return `at ${marginLabel} target margin`;

  const revenueLabel = formatCompactCurrency(metrics.revenue);
  if (revenueLabel) return `with ${revenueLabel} GDV`;

  return "with current feasibility";
}

function buildHook(
  deal: DealRow,
  metrics: ReturnType<typeof extractFinancialMetrics>,
) {
  const location = describeHookLocation(deal) ?? buildLocationFallback(deal).replace(/\s+site$/i, "");
  const dealType = buildHookDealType();
  const metric = buildHookMetric(deal, metrics);

  return `Off-market ${location} ${dealType} opportunity ${metric}.`;
}

function normalizePreferencePhrase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildPreferenceSentence(investor: InvestorRow) {
  const preferredStrategies = asStringArray(investor.preferred_strategies);
  const preferredSuburbs = asStringArray(investor.preferred_suburbs);
  const preferredStates = asStringArray(investor.preferred_states);

  let focus = "value-add residential opportunities";

  if (preferredStrategies.length > 0) {
    const strategy = normalizePreferencePhrase(preferredStrategies[0]);
    const suburb = preferredSuburbs[0];
    const state = preferredStates[0];

    if (suburb && state) {
      focus = `${strategy} opportunities in ${suburb} ${state}`;
    } else if (suburb) {
      focus = `${strategy} opportunities in ${suburb}`;
    } else if (state) {
      focus = `${strategy} opportunities in ${state}`;
    } else {
      focus = `${strategy} opportunities`;
    }
  } else if (preferredSuburbs[0] && preferredStates[0]) {
    focus = `${preferredSuburbs[0]} ${preferredStates[0]} residential opportunities`;
  } else if (preferredSuburbs[0]) {
    focus = `${preferredSuburbs[0]} residential opportunities`;
  } else if (preferredStates[0]) {
    focus = `${preferredStates[0]} residential opportunities`;
  }

  return `Given your focus on ${focus}, this looks like a strong fit.`;
}

function formatInvestorCurrency(value: number | null, suffix: string) {
  if (value === null || !Number.isFinite(value)) return null;

  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000) {
    const millions = absoluteValue / 1_000_000;
    return `${sign}~${millions.toFixed(1)}M ${suffix}`;
  }

  if (absoluteValue >= 1_000) {
    const thousands = absoluteValue / 1_000;
    return `${sign}~${thousands.toFixed(0)}k ${suffix}`;
  }

  return `${sign}~${Math.round(absoluteValue)} ${suffix}`;
}

function withFallbackArray<T>(result: ArrayQueryResult<T>, step: FailureStep) {
  if (result.error) {
    logStepError(step, result.error);
    return [] as T[];
  }
  return Array.isArray(result.data) ? result.data : [];
}

function withFallbackRecord<T>(result: RecordQueryResult<T>, step: FailureStep) {
  if (result.error) {
    logStepError(step, result.error);
    return null;
  }
  return result.data ?? null;
}

function buildSubject(
  deal: DealRow,
  metrics: ReturnType<typeof extractFinancialMetrics>,
) {
  const strategy = getStrategyFromDeal(deal);
  const location = describeLocation(deal);
  const dealName = parseString(deal.deal_name);
  const address = describeAddress(deal);
  const marginLabel = formatPercentLabel(metrics.margin);
  const preferredReturnLabel = formatPercentLabel(metrics.preferredReturn);
  const targetMarginLabel = formatPercentLabel(parseMargin(deal.target_margin));
  const returnLabel = marginLabel ??
    (preferredReturnLabel ? `${preferredReturnLabel} pref return` : null) ??
    (targetMarginLabel ? `${targetMarginLabel} target margin` : null);

  return [
    strategy ? toTitleCase(strategy) : (dealName || "Investor outreach"),
    dealName || location || address || buildLocationFallback(deal),
    returnLabel,
  ].filter(Boolean).join(" | ");
}

serve(
  createAgentHandler(
    {
      agentName: AGENT_NAME,
      requiredFields: [
        { name: "deal_id", type: "string", uuid: true },
        { name: "investor_id", type: "string", uuid: true },
      ],
    },
    async (req) => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceKey) {
        logStepError("load_environment", "Supabase environment variables not set");
        return errorResponse("Supabase environment variables not set", "load_environment", 500);
      }

      try {
        let payload: RequestPayload;
        try {
          payload = await req.json() as RequestPayload;
        } catch (error) {
          logStepError("validate_input", error);
          return errorResponse("Invalid JSON body", "validate_input", 400);
        }

        const dealId = parseString(payload.deal_id);
        const investorId = parseString(payload.investor_id);

        if (!dealId || !investorId) {
          logStepError("validate_input", "deal_id and investor_id are required");
          return errorResponse("deal_id and investor_id are required", "validate_input", 400);
        }

        const supabase = createClient(supabaseUrl, serviceKey);

        let dealResult;
        let investorResult;
        let financialsResult;
        let dealTermsResult;
        let risksResult: ArrayQueryResult<RiskRow>;
        let siteIntelligenceResult;

        try {
          [
            dealResult,
            investorResult,
            financialsResult,
            dealTermsResult,
            risksResult,
            siteIntelligenceResult,
          ] = await Promise.all([
            supabase
              .from("deals")
              .select("id, deal_name, address, suburb, city, state, postcode, country, stage, strategy, site_area, zoning, height_limit, target_margin")
              .eq("id", dealId)
              .maybeSingle(),
            supabase
              .from("investors")
              .select(`
                id,
                investor_name,
                investor_type,
                capital_min,
                capital_max,
                preferred_strategies,
                risk_profile,
                preferred_states,
                preferred_suburbs,
                min_target_margin_pct,
                status,
                notes,
                metadata
              `)
              .eq("id", investorId)
              .maybeSingle(),
            supabase
              .from("financial_snapshots")
              .select("category, amount, gdv, tdc, notes, metadata, created_at")
              .eq("deal_id", dealId)
              .order("created_at", { ascending: false })
              .limit(5),
            supabase
              .from("deal_terms")
              .select("preferred_return_pct, sponsor_fee_pct, notes, metadata, updated_at")
              .eq("deal_id", dealId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("risks")
              .select("title, description, severity, status, created_at")
              .eq("deal_id", dealId),
            supabase
              .from("site_intelligence")
              .select(`
                flood_risk,
                estimated_units,
                estimated_revenue,
                estimated_build_cost,
                estimated_profit,
                updated_at
              `)
              .eq("deal_id", dealId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
        } catch (error) {
          logStepError("request_handler", error, { deal_id: dealId, investor_id: investorId });
          return errorResponse("Failed to load investor outreach context", "request_handler");
        }

        if (dealResult.error) {
          logStepError("load_deal", dealResult.error, { deal_id: dealId });
          return errorResponse(
            dealResult.error.message ?? "Failed to load deal",
            "load_deal",
            200,
            { deal_id: dealId, investor_id: investorId },
          );
        }
        if (investorResult.error) {
          logStepError("load_investor", investorResult.error, { investor_id: investorId });
          return errorResponse(
            investorResult.error.message ?? "Failed to load investor",
            "load_investor",
            200,
            { deal_id: dealId, investor_id: investorId },
          );
        }

        if (!dealResult.data) {
          logStepError("load_deal", "Deal not found", { deal_id: dealId });
          return errorResponse("Deal not found", "load_deal", 200, {
            deal_id: dealId,
            investor_id: investorId,
          });
        }

        if (!investorResult.data) {
          logStepError("load_investor", "Investor not found", { investor_id: investorId });
          return errorResponse("Investor not found", "load_investor", 200, {
            deal_id: dealId,
            investor_id: investorId,
          });
        }

        let resolvedRisksResult: ArrayQueryResult<RiskRow> = risksResult;
        if (resolvedRisksResult.error && isMissingColumnError(resolvedRisksResult.error, "status")) {
          logStepError("load_risks", resolvedRisksResult.error, {
            deal_id: dealId,
            retry_without_status: true,
          });
          try {
            resolvedRisksResult = await supabase
              .from("risks")
              .select("title, description, severity, created_at")
              .eq("deal_id", dealId) as ArrayQueryResult<RiskRow>;
          } catch (error) {
            logStepError("load_risks", error, { deal_id: dealId, retry_without_status: true });
            resolvedRisksResult = { data: [], error: { message: getErrorMessage(error) } };
          }
        }

        let subject = "Investor outreach | Deal";
        let message =
          "Hi Investor,\n\nOff-market property opportunity with current feasibility.\nGiven your focus, this looks like a strong fit.\n\nTL;DR\n- Deal: Property opportunity.\n- Returns: Latest feasibility available.\n- Risk: Standard diligence items remain.\n\nHappy to share the full deal pack and walk through assumptions if of interest.";

        try {
          const deal = dealResult.data as DealRow;
          const investor = investorResult.data as InvestorRow;
          const financials = withFallbackArray(financialsResult as ArrayQueryResult<FinancialRow>, "load_financials");
          const dealTerms = withFallbackRecord(dealTermsResult as RecordQueryResult<DealTermsRow>, "load_deal_terms");
          const risks = withFallbackArray(resolvedRisksResult, "load_risks");
          const siteIntelligence = withFallbackRecord(
            siteIntelligenceResult as RecordQueryResult<SiteIntelligenceRow>,
            "load_site_intelligence",
          );
          const metrics = extractFinancialMetrics(financials, siteIntelligence, dealTerms);
          const investorName = parseString(investor.investor_name) ?? "Investor";
          const hook = buildHook(deal, metrics);
          const preferenceSentence = buildPreferenceSentence(investor);
          subject = buildSubject(deal, metrics) || "Investor outreach | Deal";
          const tldr = formatTldrHierarchy("TL;DR", [
            { label: "Deal", value: buildDealLine(deal, siteIntelligence) },
            { label: "Returns", value: buildReturnLine(metrics) },
            { label: "Risk", value: buildRiskLine(risks, siteIntelligence) },
          ]);
          const cta =
            "Happy to share the full deal pack and walk through assumptions if of interest.";
          message = [
            `Hi ${investorName},`,
            "",
            hook,
            preferenceSentence,
            "",
            tldr,
            "",
            cta,
          ].join("\n");
        } catch (error) {
          logStepError("build_outreach", error, { deal_id: dealId, investor_id: investorId });
          return errorResponse(
            "Failed to build outreach draft",
            "build_outreach",
            200,
            { deal_id: dealId, investor_id: investorId },
          );
        }

        try {
          const { error } = await supabase.from("ai_actions").insert({
            deal_id: dealId,
            agent: AGENT_NAME,
            action: "outreach_generated",
            payload: {
              investor_id: investorId,
              subject,
            },
          });
          if (error) {
            logStepError("log_ai_action", error, { deal_id: dealId, investor_id: investorId });
          }
        } catch (error) {
          logStepError("log_ai_action", error, { deal_id: dealId, investor_id: investorId });
        }

        return jsonResponse({
          success: true,
          error: false,
          deal_id: dealId,
          investor_id: investorId,
          subject,
          message,
        });
      } catch (error) {
        logStepError("request_handler", error);
        return errorResponse(getErrorMessage(error), "request_handler");
      }
    },
  ),
);
