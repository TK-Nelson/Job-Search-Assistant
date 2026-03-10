import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Anchor,
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Divider,
  Grid,
  Group,
  Loader,
  Menu,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Check,
  CircleCheck,
  CircleHelp,
  DollarSign,
  ExternalLink,
  FileEdit,
  Import,
  Info,
  Lightbulb,
  MoreVertical,
  Pencil,
  MapPin,
  RefreshCw,
  Sigma,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import {
  getComparisonReport,
  getJobPosting,
  getPersonalProfile,
  getResumeDiagnostics,
  getResumes,
  importComparisonChatGptResponse,
  runComparison,
  setComparisonApplicationDecision,
  updateComparisonParsedInfo,
} from "../api";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("saved") || text.includes("applied") || text.includes("loaded") || text.includes("updated")) {
    return "success";
  }
  return "info";
}

function extractCompensation(text) {
  const source = String(text || "");
  const rangeRegex = /(\$?\s?\d{2,3}(?:[\d,])*(?:\.\d+)?\s?(?:k|K)?\s*(?:-|–|to)\s*\$?\s?\d{2,3}(?:[\d,])*(?:\.\d+)?\s?(?:k|K)?(?:\s*\/?\s*(?:year|yr|annually|hour|hr))?)/g;
  const rangeMatches = Array.from(source.matchAll(rangeRegex)).map((item) => item[0].trim());
  if (rangeMatches.length > 0) {
    return rangeMatches.sort((left, right) => right.length - left.length)[0];
  }
  const singleMatch = source.match(/\$\s?\d{2,3}(?:[\d,])*(?:k|K)?(?:\s*\/?\s*(?:year|yr|hour|hr))?/);
  return singleMatch?.[0] || "Unlisted";
}

function extractRoleType(text) {
  const source = String(text || "").toLowerCase();
  if (source.includes("full-time") || source.includes("full time")) return "Full-time";
  if (source.includes("part-time") || source.includes("part time")) return "Part-time";
  if (source.includes("contract")) return "Contract";
  if (source.includes("intern")) return "Internship";
  if (source.includes("temporary") || source.includes("temp")) return "Temporary";
  return "Unlisted";
}

function extractWorkplace(text) {
  const source = String(text || "").toLowerCase();
  if (source.includes("hybrid") && source.includes("remote")) return "Hybrid/Remote";
  if (source.includes("hybrid")) return "Hybrid";
  if (source.includes("remote")) return "Remote";
  if (source.includes("on-site") || source.includes("onsite") || source.includes("on site")) return "On-site";
  return "Unlisted";
}

function extractWorkLevel(title, text) {
  const titleSource = String(title || "").toLowerCase();
  const descriptionSource = String(text || "").toLowerCase();

  if (titleSource.includes("lead") || titleSource.includes("staff") || titleSource.includes("principal")) {
    return { value: "Lead/Staff", source: "parsed" };
  }
  if (titleSource.includes("senior") || titleSource.includes("sr.")) return { value: "Senior", source: "parsed" };
  if (titleSource.includes("mid") || titleSource.includes("intermediate")) return { value: "Mid", source: "parsed" };
  if (titleSource.includes("junior") || titleSource.includes("entry")) return { value: "Junior", source: "parsed" };

  if (/\b(role level|level|title)\s*[:\-]\s*senior\b/i.test(descriptionSource)) return { value: "Senior", source: "parsed" };
  if (/\b(role level|level|title)\s*[:\-]\s*(lead|staff|principal)\b/i.test(descriptionSource)) return { value: "Lead/Staff", source: "parsed" };
  if (/\b(role level|level|title)\s*[:\-]\s*(mid|intermediate)\b/i.test(descriptionSource)) return { value: "Mid", source: "parsed" };
  if (/\b(role level|level|title)\s*[:\-]\s*(junior|entry)\b/i.test(descriptionSource)) return { value: "Junior", source: "parsed" };

  const years = extractYearsExperience(text, { withSuffix: false });
  const numericYears = Number.parseInt(years, 10);
  if (!Number.isNaN(numericYears)) {
    if (numericYears >= 8) return { value: "Lead/Staff", source: "calculated" };
    if (numericYears >= 5) return { value: "Senior", source: "calculated" };
    if (numericYears >= 3) return { value: "Mid", source: "calculated" };
    if (numericYears >= 1) return { value: "Junior", source: "calculated" };
  }
  return { value: "Unlisted", source: "unknown" };
}

function extractYearsExperience(text, options = { withSuffix: true }) {
  const source = String(text || "").toLowerCase();
  const rangeMatch = source.match(/(\d+)\s*(?:\+|-)\s*(\d+)?\s*years?/);
  const singleMatch = source.match(/(\d+)\+?\s*years?/);
  const withSuffix = options.withSuffix !== false;
  if (rangeMatch?.[0]) return withSuffix ? `${rangeMatch[0]} experience` : rangeMatch[0];
  if (singleMatch?.[0]) return withSuffix ? `${singleMatch[0]} experience` : singleMatch[0];
  return "Unlisted";
}

function normalizeTeamDisplayName(value) {
  const text = String(value || "").trim();
  if (!text) return "Team Undefined";
  return text
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      if (/^[A-Z0-9&/-]{2,}$/.test(word)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractTeamGroup(text, title) {
  const source = String(text || "");
  const titleSource = String(title || "");

  const titleSuffixMatch = titleSource.match(/\s[-:|]\s([^|\-:]{3,})$/);
  if (titleSuffixMatch?.[1]) return normalizeTeamDisplayName(titleSuffixMatch[1]);

  const titleCommaMatch = titleSource.match(/,\s*([^,]{4,})$/);
  if (titleCommaMatch?.[1]) return normalizeTeamDisplayName(titleCommaMatch[1]);

  const titleCapsMatch = titleSource.match(/\b([A-Z]{2,}(?:\s+[A-Za-z][A-Za-z]+){1,})\b/);
  if (titleCapsMatch?.[1] && /onboarding|integrations|platform|systems?|product|experience|design/i.test(titleCapsMatch[1])) {
    return normalizeTeamDisplayName(titleCapsMatch[1]);
  }

  const withinOrgMatch = source.match(/within\s+[^\n.]*?'s\s+([^\n.,;]+?)\s+(?:organization|team|group|department)/i);
  if (withinOrgMatch?.[1]) return normalizeTeamDisplayName(withinOrgMatch[1]);

  const labeledMatch = source.match(/(?:team|group|department)\s*[:\-]\s*([^\n.]+)/i);
  if (labeledMatch?.[1]) return normalizeTeamDisplayName(labeledMatch[1]);

  return "Team Undefined";
}

function extractIndustry(text) {
  const source = String(text || "");
  const lowered = source.toLowerCase();

  const labeledMatch = source.match(/industry\s*[:\-]\s*([^\n.]+)/i);
  if (labeledMatch?.[1]) return labeledMatch[1].trim();

  if (/financial\s+industr/i.test(source) || /finance\s+industr/i.test(source)) {
    return "Financial Services";
  }

  const industrySignals = [
    { keywords: ["bank", "banking", "lending", "loan", "mortgage", "credit", "financial", "fintech"], label: "Financial Services" },
    { keywords: ["healthcare", "hospital", "clinical", "medical"], label: "Healthcare" },
    { keywords: ["insurance", "underwriting", "policy"], label: "Insurance" },
    { keywords: ["retail", "ecommerce", "storefront", "merchandising"], label: "Retail" },
    { keywords: ["saas", "software", "platform", "engineering", "developer"], label: "Technology" },
    { keywords: ["manufacturing", "factory", "production", "supply chain"], label: "Manufacturing" },
  ];

  for (const signal of industrySignals) {
    if (signal.keywords.some((keyword) => lowered.includes(keyword))) {
      return signal.label;
    }
  }

  return "Industry Undefined";
}

function extractLocations(text, fallbackLocation) {
  const locationStopwords = [
    "required",
    "preferred",
    "responsibilities",
    "experience",
    "salary",
    "compensation",
    "benefits",
    "skills",
    "requirements",
    "must",
    "should",
    "will",
  ];

  function normalizeToken(value) {
    return value
      .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikeLocation(value) {
    const token = normalizeToken(value);
    if (!token) return false;

    const lowered = token.toLowerCase();
    if (["remote", "hybrid", "on-site", "onsite", "on site"].includes(lowered)) return false;
    if (locationStopwords.some((word) => lowered.includes(word))) return false;
    if (/\d/.test(token)) return false;

    const words = token.split(/\s+/);
    if (words.length > 6) return false;

    if (/^[A-Za-z .'-]+,\s?[A-Z]{2}$/.test(token)) return true;
    if (token.includes(",")) {
      const [left, right] = token.split(",").map((part) => part.trim());
      const normalizedRight = String(right || "").toLowerCase();
      const knownRegions = new Set([
        "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
        "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
        "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri",
        "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
        "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
        "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
        "west virginia", "wisconsin", "wyoming", "usa", "united states", "canada",
      ]);
      if (left && (/^[A-Z]{2}$/.test(right) || knownRegions.has(normalizedRight))) return true;
      return false;
    }
    if (/^[A-Za-z .'-]+\s+\([A-Z]{2}\)$/.test(token)) return true;
    if (/^[A-Za-z .'-]+\s*\/\s*[A-Za-z .'-]+$/.test(token) && words.length <= 4) return true;
    if (words.length <= 3 && words.every((word) => /^[A-Z][a-zA-Z.'-]*$/.test(word) && /[a-z]/.test(word))) return true;

    return false;
  }

  function collectTokens(rawValue, targetSet) {
    if (!rawValue) return;
    rawValue
      .split(/(?:\n|\||;|\band\b|\bor\b|\/|•)/i)
      .flatMap((part) => part.split(/(?<!\w),(?!\d)/))
      .map((part) => normalizeToken(part))
      .filter(Boolean)
      .forEach((token) => {
        const cleaned = token
          .replace(/^(?:to|within|outside|of|these\s+locations?)\s+/i, "")
          .replace(/\b(?:you are expected|please still apply|remote candidates will be considered)\b.*$/i, "")
          .trim();
        if (looksLikeLocation(cleaned)) targetSet.add(cleaned);
      });
  }

  const source = String(text || "");
  const values = new Set();

  const basedInMatch = source.match(/\bbased in\s+([^\.\n]+)/i);
  if (basedInMatch?.[1]) {
    collectTokens(basedInMatch[1], values);
  }

  const workArrangementMatch = source.match(/(?:work arrangement|categorized as)\s*[:\-]?\s*([^\.\n]+)/i);
  if (workArrangementMatch?.[1]) {
    collectTokens(workArrangementMatch[1], values);
  }

  const hybridRemoteToMatch = source.match(/remote\s+or\s+hybrid\s+to\s+([^\.\n]+)/i);
  if (hybridRemoteToMatch?.[1]) {
    collectTokens(hybridRemoteToMatch[1], values);
  }

  const hubLocationMatch = source.match(/hub\s+location\s*\(([^)]+)\)/i);
  if (hubLocationMatch?.[1]) {
    collectTokens(hubLocationMatch[1], values);
  }

  const fallback = String(fallbackLocation || "").trim();
  if (fallback && fallback.toLowerCase() !== "unknown") {
    collectTokens(fallback, values);
  }

  const locationLabelRegex = /(?:location|locations|based in|work location)\s*[:\-]\s*([^\n]+)/gi;
  for (const match of source.matchAll(locationLabelRegex)) {
    collectTokens(match[1], values);
  }

  const cityStateRegex = /([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*,\s?(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*))/g;
  for (const match of source.matchAll(cityStateRegex)) {
    if (match[1] && looksLikeLocation(match[1])) values.add(normalizeToken(match[1]));
  }

  return values.size > 0 ? Array.from(values).join("\n") : "Unlisted";
}

function faviconUrl(url) {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  } catch {
    return null;
  }
}

function logoDevUrl(domain) {
  if (!domain) return null;
  return `https://img.logo.dev/${encodeURIComponent(domain)}?size=128&format=png`;
}

function companyDomainHint(companyName, sourceUrl) {
  const name = String(companyName || "").trim().toLowerCase();
  const source = String(sourceUrl || "").trim();
  const domainOverrides = {
    "general motors": "gm.com",
    "gm": "gm.com",
  };
  if (domainOverrides[name]) return domainOverrides[name];
  if (source) {
    try {
      const host = new URL(source).hostname.replace(/^www\./, "");
      if (!/greenhouse|lever|workday|ashby|smartrecruiters|icims|myworkdayjobs/i.test(host)) {
        return host;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function buildLogoUrl(companyName, sourceUrl) {
  const domain = companyDomainHint(companyName, sourceUrl);
  const logo = logoDevUrl(domain);
  if (logo) return logo;
  return faviconUrl(sourceUrl);
}

async function inferCompanyIndustry(companyName, fallbackText) {
  const name = String(companyName || "").trim();
  if (!name) return extractIndustry(fallbackText);

  const overrides = {
    "general motors": "Automotive",
    gm: "Automotive",
  };
  const lowered = name.toLowerCase();
  if (overrides[lowered]) return overrides[lowered];

  const industryMap = [
    { regex: /automotive|vehicle|mobility|car\s+manufacturer/i, value: "Automotive" },
    { regex: /financial|bank|insurance|lending|fintech/i, value: "Financial Services" },
    { regex: /healthcare|medical|hospital|clinical|biotech/i, value: "Healthcare" },
    { regex: /software|technology|saas|cloud|developer/i, value: "Technology" },
    { regex: /retail|e-?commerce|consumer goods/i, value: "Retail" },
  ];

  const wikiTitle = encodeURIComponent(name.replace(/\s+/g, "_"));
  try {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiTitle}`);
    if (response.ok) {
      const payload = await response.json();
      const text = `${payload?.description || ""} ${payload?.extract || ""}`;
      const found = industryMap.find((item) => item.regex.test(text));
      if (found) return found.value;
    }
  } catch {
    // Fallback to deterministic extraction below.
  }

  return extractIndustry(fallbackText);
}

function tokenizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function estimateYearsFromDateRanges(text) {
  const source = String(text || "");
  const currentYear = new Date().getFullYear();
  const explicitMatches = Array.from(source.matchAll(/(19\d{2}|20\d{2})\s*(?:-|–|to)\s*(present|current|now|19\d{2}|20\d{2})/gi));

  const ranges = explicitMatches
    .map((match) => {
      const start = Number.parseInt(match[1], 10);
      const endRaw = String(match[2] || "").toLowerCase();
      const end = /present|current|now/.test(endRaw) ? currentYear : Number.parseInt(endRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return { start, end };
    })
    .filter(Boolean);

  if (ranges.length === 0) return null;

  const minStart = Math.min(...ranges.map((range) => range.start));
  const maxEnd = Math.max(...ranges.map((range) => range.end));
  return Math.max(0, maxEnd - minStart);
}

function countKeywordHits(text, keywords) {
  const lower = String(text || "").toLowerCase();
  return (keywords || []).reduce((count, keyword) => {
    if (!keyword) return count;
    return lower.includes(String(keyword).toLowerCase()) ? count + 1 : count;
  }, 0);
}

function extractHardSkillRequirements(descriptionText) {
  const source = String(descriptionText || "").toLowerCase();
  const skillPatterns = [
    { label: "Interaction Design", patterns: [/interaction design/] },
    { label: "Graphic Design", patterns: [/graphic design/] },
    { label: "Product Design", patterns: [/product design/] },
    { label: "System Design", patterns: [/system design|design systems?/] },
    { label: "Figma", patterns: [/\bfigma\b/] },
    { label: "Cross-functional Collaboration", patterns: [/cross-functional|cross functional|partners?/] },
    { label: "Set Quality Standards", patterns: [/setting quality standards?|quality standards?|design exemplars?/] },
    { label: "Accessibility (WCAG)", patterns: [/wcag|accessibility|accessible design/] },
  ];

  return skillPatterns
    .filter((item) => item.patterns.some((pattern) => pattern.test(source)))
    .map((item) => item.label);
}

function buildPositioningDiagnostics(currentReport, currentPosting, currentProfile, companyIndustryLabel, resumeText) {
  const descriptionText = String(currentPosting?.description_text || "");
  const evidenceItems = currentReport?.analysis?.evidence || [];
  const resumeEvidenceText = evidenceItems.map((item) => item.resume_snippet || "").join(" ");
  const resumeCorpus = `${resumeEvidenceText}\n${String(resumeText || "")}`;
  const jobDescriptionEvidenceText = evidenceItems.map((item) => item.job_snippet || "").join(" ");

  const authorityKeywords = [
    "ambiguous",
    "undefined",
    "complex",
    "ecosystem",
    "influence without authority",
    "influencing senior",
    "shaping direction",
    "design authority",
    "set quality standards",
    "cross-functional",
  ];

  function matchedTerms(text, terms) {
    const lower = String(text || "").toLowerCase();
    return terms.filter((term) => lower.includes(term.toLowerCase()));
  }

  function uniqueExcerpts(values, max = 3) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, max);
  }

  function evidenceExcerptsByTerms(items, field, terms, max = 3) {
    if (!terms.length) return [];
    const excerpts = (items || [])
      .map((item) => item?.[field])
      .filter((snippet) => {
        const lower = String(snippet || "").toLowerCase();
        return terms.some((term) => lower.includes(term.toLowerCase()));
      });
    return uniqueExcerpts(excerpts, max);
  }

  const requestedAuthorityTerms = matchedTerms(`${descriptionText} ${jobDescriptionEvidenceText}`, authorityKeywords);
  const demonstratedAuthorityTerms = matchedTerms(
    `${resumeCorpus} ${(currentProfile?.experience_signals?.leadership_signals || []).join(" ")}`,
    authorityKeywords
  );

  const leadershipJobExcerpts = evidenceExcerptsByTerms(evidenceItems, "job_snippet", requestedAuthorityTerms, 4);
  const leadershipResumeExcerpts = evidenceExcerptsByTerms(evidenceItems, "resume_snippet", requestedAuthorityTerms, 4);

  const requestedYearsMatch = descriptionText.toLowerCase().match(/(\d+)\s*(?:\+|-|to)?\s*(\d+)?\s*years?/);
  const requestedYears = requestedYearsMatch ? Number.parseInt(requestedYearsMatch[1], 10) : null;

  const explicitYearMentions = [
    ...String(resumeCorpus || "").toLowerCase().matchAll(/(\d+)\s*\+?\s*years?/g),
    ...String((currentProfile?.experience_signals?.scope_patterns || []).join(" ") || "").toLowerCase().matchAll(/(\d+)\s*\+?\s*years?/g),
  ]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value));
  const dateRangeYears = estimateYearsFromDateRanges(resumeCorpus);
  const demonstratedYearsCandidates = [...explicitYearMentions, ...(dateRangeYears !== null ? [dateRangeYears] : [])];
  const demonstratedYears = demonstratedYearsCandidates.length > 0 ? Math.max(...demonstratedYearsCandidates) : null;

  const industries = currentProfile?.experience_signals?.industries || [];
  const requestedIndustry = companyIndustryLabel || "Industry Undefined";
  const matchedIndustries = industries.filter((industry) => {
    const left = String(industry || "").toLowerCase();
    const right = String(requestedIndustry || "").toLowerCase();
    return left.includes(right) || right.includes(left);
  }).slice(0, 3);

  const diagnostics = [];

  const hasSeniorityRequest = requestedYears !== null || requestedAuthorityTerms.length > 0;
  if (!hasSeniorityRequest) {
    diagnostics.push({
      label: "Seniority fit",
      status: "insufficient",
      detail: "No clear seniority requirements were detected in extracted Job Description evidence.",
      jobExcerpts: uniqueExcerpts(evidenceItems.map((item) => item.job_snippet), 2),
      resumeExcerpts: [],
    });
  } else {
    const requestedYearsText = requestedYears !== null ? `${requestedYears}+ years` : "unspecified years";
    const demonstratedYearsText = demonstratedYears !== null ? `${demonstratedYears}+ years shown` : "no explicit years shown";
    const hasYearsData = requestedYears !== null && demonstratedYears !== null;
    const overqualified = hasYearsData && demonstratedYears >= requestedYears + 3;
    const underqualified = hasYearsData && demonstratedYears < requestedYears;
    const missingAuthorityTerms = requestedAuthorityTerms.filter((term) => !demonstratedAuthorityTerms.includes(term));

    const detailParts = [
      `Years requested: ${requestedYearsText}; years demonstrated: ${demonstratedYearsText}.`,
    ];
    if (missingAuthorityTerms.length > 0) {
      detailParts.push(`Authority indicators requested but not clearly shown: ${missingAuthorityTerms.slice(0, 4).join(", ")}.`);
    }

    if (overqualified || underqualified || missingAuthorityTerms.length > 0) {
      diagnostics.push({
        label: "Seniority fit",
        status: "warning",
        detail: `${overqualified ? "Warning: experience appears above requested level." : underqualified ? "Warning: experience appears below requested level." : "Warning: authority/seniority evidence appears incomplete."} ${detailParts.join(" ")}`,
        jobExcerpts: leadershipJobExcerpts,
        resumeExcerpts: leadershipResumeExcerpts,
      });
    } else {
      diagnostics.push({
        label: "Seniority fit",
        status: "aligned",
        detail: `Demonstrated years and authority indicators appear aligned. ${detailParts.join(" ")}`,
        jobExcerpts: leadershipJobExcerpts,
        resumeExcerpts: leadershipResumeExcerpts,
      });
    }
  }

  if ((industries || []).length === 0) {
    diagnostics.push({
      label: "Domain fit",
      status: "insufficient",
      detail: "No personal industry context available in local profile for domain-fit assessment.",
      jobExcerpts: uniqueExcerpts(evidenceItems.map((item) => item.job_snippet), 2),
      resumeExcerpts: [],
    });
  } else if (requestedIndustry === "Industry Undefined") {
    diagnostics.push({
      label: "Domain fit",
      status: "insufficient",
      detail: "The company industry was not confidently detected from Job Description evidence.",
      jobExcerpts: uniqueExcerpts(evidenceItems.map((item) => item.job_snippet), 2),
      resumeExcerpts: [],
    });
  } else if (matchedIndustries.length === 0) {
    diagnostics.push({
      label: "Domain fit",
      status: "warning",
      detail: `Industry-specific context appears requested (${requestedIndustry}) and is not strongly matched in current profile signals.`,
      jobExcerpts: uniqueExcerpts(evidenceItems.map((item) => item.job_snippet), 3),
      resumeExcerpts: uniqueExcerpts(evidenceItems.map((item) => item.resume_snippet), 2),
    });
  } else {
    diagnostics.push({
      label: "Domain fit",
      status: "aligned",
      detail: `Detected overlap between company industry (${requestedIndustry}) and personal domain experience signals.`,
      jobExcerpts: [`Industry lookup from company context: ${requestedIndustry}`],
      resumeExcerpts: [],
    });
  }

  const totalEvidence = tokenizeText(resumeEvidenceText + " " + jobDescriptionEvidenceText).length;
  return {
    diagnostics,
    totalEvidence,
  };
}

export default function ComparisonReportPage() {
  const { comparisonReportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [posting, setPosting] = useState(null);
  const [resume, setResume] = useState(null);
  const [resumeDiagnostics, setResumeDiagnostics] = useState(null);
  const [personalProfile, setPersonalProfile] = useState(null);
  const [companyIndustry, setCompanyIndustry] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [loadErrorText, setLoadErrorText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [isRefreshingEvaluation, setIsRefreshingEvaluation] = useState(false);
  const [isImportingChatGptResponse, setIsImportingChatGptResponse] = useState(false);
  const [chatGptResponseText, setChatGptResponseText] = useState("");
  const [isReimportMode, setIsReimportMode] = useState(false);
  const [isEditingResponse, setIsEditingResponse] = useState(false);
  const [editedResponseText, setEditedResponseText] = useState("");
  const [isEditingDecision, setIsEditingDecision] = useState(false);
  const [expandedEvidenceByLabel, setExpandedEvidenceByLabel] = useState({});
  const [showHardStrongest, setShowHardStrongest] = useState(false);
  const [showSoftStrongest, setShowSoftStrongest] = useState(false);
  const [isEditingParsedInfo, setIsEditingParsedInfo] = useState(false);
  const [isSavingParsedInfo, setIsSavingParsedInfo] = useState(false);
  const [parsedInfoForm, setParsedInfoForm] = useState({ company_name: "", title: "", location: "", salary_range: "", seniority_level: "", workplace_type: "", years_experience: "", commitment_type: "" });

  async function loadReport() {
    setIsLoading(true);
    setLoadErrorText("");
    try {
      const result = await getComparisonReport(comparisonReportId);
      setReport(result);
      if (!result?.chatgpt_response_present) {
        setIsReimportMode(false);
      }

      try {
        const [postingResult, resumesResult, personalProfileResult, resumeDiagnosticsResult] = await Promise.all([
          getJobPosting(result.job_posting_id),
          getResumes(),
          getPersonalProfile(),
          getResumeDiagnostics(result.resume_version_id),
        ]);
        setPosting(postingResult);
        const matchedResume = (resumesResult.items || []).find((item) => item.id === result.resume_version_id) || null;
        setResume(matchedResume);
        setResumeDiagnostics(resumeDiagnosticsResult);
        setPersonalProfile(personalProfileResult);
        const industryLabel = await inferCompanyIndustry(result.company_name, postingResult?.description_text || "");
        setCompanyIndustry(industryLabel);
      } catch {
        setPosting(null);
        setResume(null);
        setResumeDiagnostics(null);
        setPersonalProfile(null);
        setCompanyIndustry(null);
      }
    } catch (err) {
      setReport(null);
      setLoadErrorText(`Failed to load comparison report: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [comparisonReportId]);

  async function onDecision(applied) {
    setIsSavingDecision(true);
    setStatusText(applied ? "Saving application decision..." : "Recording decision...");
    try {
      const result = await setComparisonApplicationDecision(comparisonReportId, applied, applied ? roleContext.compensation : null);
      setStatusText(applied ? "Application decision saved. Role linked to applications log." : "Marked as not applied.");
      setIsEditingDecision(false);
      await loadReport();
      if (applied && result.application_id) {
        setStatusText(`Application logged (ID ${result.application_id}).`);
      }
    } catch (err) {
      setStatusText(`Failed to save decision: ${err.message}`);
    } finally {
      setIsSavingDecision(false);
    }
  }

  async function onRefreshEvaluation() {
    if (!report || !posting?.description_text) {
      setStatusText("Cannot refresh evaluation: report or job description data is unavailable.");
      return;
    }

    const descriptionText = String(posting.description_text || "").trim();
    if (descriptionText.length < 40) {
      setStatusText("Cannot refresh evaluation: job description text is too short for analysis.");
      return;
    }

    setIsRefreshingEvaluation(true);
    setStatusText("Refreshing evaluation...");
    try {
      const refreshed = await runComparison({
        source_company_name: report.source_company_input || report.company_name,
        source_url: report.source_url_input || report.canonical_url,
        title: report.title,
        description_text: descriptionText,
        resume_version_id: report.resume_version_id,
        evaluation_mode: report.evaluation_source === "local_engine" ? "local_engine" : "chatgpt_api",
      });
      setStatusText("Evaluation refreshed.");
      navigate(`/applications/application/${refreshed.comparison_report_id}`);
    } catch (err) {
      setStatusText(`Failed to refresh evaluation: ${err.message}`);
    } finally {
      setIsRefreshingEvaluation(false);
    }
  }

  async function onImportChatGptResponse() {
    const responseText = String(chatGptResponseText || "").trim();
    if (!responseText) {
      setStatusText("Paste the ChatGPT JSON response before importing.");
      return;
    }

    setIsImportingChatGptResponse(true);
    setStatusText("Importing ChatGPT response...");
    try {
      await importComparisonChatGptResponse(comparisonReportId, responseText);
      setChatGptResponseText("");
      setIsReimportMode(false);
      setStatusText("ChatGPT response imported and report updated.");
      await loadReport();
    } catch (err) {
      setStatusText(`Failed to import ChatGPT response: ${err.message}`);
    } finally {
      setIsImportingChatGptResponse(false);
    }
  }

  function onCopyChatGptPrompt() {
    const promptText = String(report?.chatgpt_prompt_text || "").trim();
    if (!promptText) {
      setStatusText("No ChatGPT prompt is available for this report yet.");
      return;
    }
    navigator.clipboard
      .writeText(promptText)
      .then(() => setStatusText("ChatGPT prompt copied to clipboard."))
      .catch(() => setStatusText("Unable to copy prompt automatically. Copy it manually from the field."));
  }

  function onStartEditResponse() {
    const currentJson = report?.chatgpt_response_json;
    setEditedResponseText(currentJson ? JSON.stringify(currentJson, null, 2) : "");
    setIsEditingResponse(true);
    setIsReimportMode(false);
    setIsEditingParsedInfo(false);
  }

  function onStartEditParsedInfo() {
    setParsedInfoForm({
      company_name: report?.company_name || "",
      title: report?.title || "",
      location: posting?.location || "",
      salary_range: posting?.salary_range || roleContext.compensation || "",
      seniority_level: posting?.seniority_level || roleContext.level || "",
      workplace_type: posting?.workplace_type || roleContext.workplace || "",
      years_experience: posting?.years_experience || roleContext.yearsExperience || "",
      commitment_type: posting?.commitment_type || roleContext.roleType || "",
    });
    setIsEditingParsedInfo(true);
    setIsEditingResponse(false);
    setIsReimportMode(false);
  }

  async function onSaveParsedInfo() {
    setIsSavingParsedInfo(true);
    setStatusText("Saving parsed information...");
    try {
      await updateComparisonParsedInfo(comparisonReportId, parsedInfoForm);
      setIsEditingParsedInfo(false);
      setStatusText("Parsed information updated.");
      await loadReport();
    } catch (err) {
      setStatusText(`Failed to update parsed information: ${err.message}`);
    } finally {
      setIsSavingParsedInfo(false);
    }
  }

  async function onSaveEditedResponse() {
    const text = String(editedResponseText || "").trim();
    if (!text) {
      setStatusText("Enter the updated JSON response before saving.");
      return;
    }
    setIsImportingChatGptResponse(true);
    setStatusText("Saving edited response...");
    try {
      await importComparisonChatGptResponse(comparisonReportId, text);
      setEditedResponseText("");
      setIsEditingResponse(false);
      setStatusText("Response updated successfully.");
      await loadReport();
    } catch (err) {
      setStatusText(`Failed to save edited response: ${err.message}`);
    } finally {
      setIsImportingChatGptResponse(false);
    }
  }

  const statusTone = getStatusTone(statusText);
  const isChatGptMode = report?.evaluation_source === "chatgpt_api";
  const hasChatGptResponse = Boolean(report?.chatgpt_response_present);
  const showChatGptImportInputs = isChatGptMode && (!hasChatGptResponse || isReimportMode);
  const showCompatibilityContent = !isChatGptMode || hasChatGptResponse;

  const chatGptResponseJson = report?.chatgpt_response_json || {};
  const strategicEvaluation = chatGptResponseJson?.strategic_evaluation || {};
  const gapAnalysis = chatGptResponseJson?.gap_analysis || {};
  const hardSkillEvaluation = chatGptResponseJson?.hard_skill_evaluation || {};
  const softSkillEvaluation = chatGptResponseJson?.soft_skill_evaluation || {};

  const displayedSoftScore = Number(
    isChatGptMode && hasChatGptResponse
      ? (report?.analysis?.sub_scores?.soft_skills || softSkillEvaluation?.score || 0)
      : (report?.analysis?.sub_scores?.soft_skills || 0)
  );

  const companyInitials = useMemo(() => {
    const name = report?.company_name || "Company";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");
  }, [report?.company_name]);

  const roleContext = useMemo(() => {
    const description = posting?.description_text || "";
    const level = extractWorkLevel(report?.title, description);

    return {
      industry: extractIndustry(description),
      team: extractTeamGroup(description, report?.title),
      locations: extractLocations(description, posting?.location),
      workplace: posting?.workplace_type || extractWorkplace(description),
      compensation: posting?.salary_range || extractCompensation(description),
      roleType: posting?.commitment_type || extractRoleType(description),
      level: posting?.seniority_level || level.value,
      levelSource: posting?.seniority_level ? "parsed" : level.source,
      yearsExperience: posting?.years_experience || extractYearsExperience(description),
    };
  }, [posting?.description_text, posting?.location, posting?.salary_range, posting?.seniority_level, posting?.workplace_type, posting?.years_experience, posting?.commitment_type, report?.title]);

  const hardMatched = report?.analysis?.matched_keywords?.hard || [];
  const hardMissing = report?.analysis?.missing_keywords?.hard || [];
  const softMatched = report?.analysis?.matched_keywords?.soft || [];
  const softMissing = report?.analysis?.missing_keywords?.soft || [];

  const inferredHardSkills = useMemo(() => extractHardSkillRequirements(posting?.description_text || ""), [posting?.description_text]);
  const hardRequiredSkills = useMemo(
    () => Array.from(new Set([...hardMatched, ...hardMissing, ...inferredHardSkills].map((value) => String(value || "").trim()).filter(Boolean))),
    [hardMatched, hardMissing, inferredHardSkills]
  );

  const hardEvidenceBySkill = useMemo(() => {
    const items = report?.analysis?.evidence || [];
    const resumeEvidenceText = `${items.map((item) => item.resume_snippet || "").join(" ")} ${String(resumeDiagnostics?.extracted_text || "")}`.toLowerCase();
    const jobDescriptionText = String(posting?.description_text || "").toLowerCase();
    const actionSignalRegex = /\b(led|built|designed|implemented|improved|developed|delivered|optimized|launched|owned|drove|managed)\b/i;

    const skillAliases = {
      "Interaction Design": ["interaction design", "ux", "user experience"],
      "Graphic Design": ["graphic design", "visual design"],
      "Product Design": ["product design"],
      "System Design": ["system design", "design system"],
      "Set Quality Standards": ["quality standard", "design exemplar", "quality bar"],
      "Cross-functional Collaboration": ["cross-functional", "cross functional", "collaborat"],
      "Accessibility (WCAG)": ["wcag", "accessibility", "accessible"],
      Figma: ["figma"],
    };

    return hardRequiredSkills.map((skill) => {
      const aliases = skillAliases[skill] || [skill.toLowerCase()];
      const related = items.filter((item) =>
        String(item?.keyword || "").toLowerCase() === skill.toLowerCase()
        || aliases.some((alias) => String(item?.job_snippet || "").toLowerCase().includes(alias))
      );
      const resumeSnippets = related.map((item) => item.resume_snippet).filter(Boolean);
      const mentioned = aliases.some((alias) => resumeEvidenceText.includes(alias));
      const required = aliases.some((alias) => jobDescriptionText.includes(alias))
        || hardMissing.map((value) => value.toLowerCase()).includes(skill.toLowerCase())
        || hardMatched.map((value) => value.toLowerCase()).includes(skill.toLowerCase());
      const demonstrated = resumeSnippets.some((snippet) => actionSignalRegex.test(String(snippet || "")))
        || (mentioned && /led|built|designed|implemented|improved|developed|delivered|optimized|launched|owned|drove|managed/i.test(resumeEvidenceText));
      return {
        skill,
        required,
        mentioned,
        demonstrated,
      };
    });
  }, [report?.analysis?.evidence, hardRequiredSkills, hardMatched, hardMissing, posting?.description_text, resumeDiagnostics?.extracted_text]);

  const requiredHardSkills = hardEvidenceBySkill.filter((row) => row.required);
  const matchedRequiredHardSkills = requiredHardSkills.filter((row) => row.mentioned);
  const hardCoverage = requiredHardSkills.length > 0
    ? Math.round((matchedRequiredHardSkills.length / requiredHardSkills.length) * 100)
    : 0;
  const displayedHardScore = Number(
    isChatGptMode && hasChatGptResponse
      ? (report?.analysis?.sub_scores?.hard_skills || hardSkillEvaluation?.score || 0)
      : hardCoverage
  );
  const roleCompatibilityScore = Number(((displayedHardScore + displayedSoftScore) / 2).toFixed(2));
  const scoreColor = roleCompatibilityScore >= 80 ? "teal" : roleCompatibilityScore >= 65 ? "yellow" : "red";

  const hardSkillRows = [
    ...hardMatched.map((value) => ({ skill: value, inResume: true })),
    ...hardMissing.map((value) => ({ skill: value, inResume: false })),
  ];
  const softSkillRows = [
    ...softMatched.map((value) => ({ skill: value, inResume: true })),
    ...softMissing.map((value) => ({ skill: value, inResume: false })),
  ];

  const strategicRows = [
    {
      key: "seniority_fit",
      label: "Seniority fit",
      rating: strategicEvaluation?.seniority_fit?.rating || "Unspecified",
      reasoning: strategicEvaluation?.seniority_fit?.reasoning || "No reasoning provided.",
    },
    {
      key: "positioning_fit",
      label: "Positioning fit",
      rating: strategicEvaluation?.positioning_fit?.rating || "Unspecified",
      reasoning: strategicEvaluation?.positioning_fit?.reasoning || "No reasoning provided.",
    },
    {
      key: "domain_fit",
      label: "Domain fit",
      rating: strategicEvaluation?.domain_fit?.rating || "Unspecified",
      reasoning: strategicEvaluation?.domain_fit?.reasoning || "No reasoning provided.",
    },
  ];

  const gapRequirements = Array.isArray(gapAnalysis?.requirements)
    ? gapAnalysis.requirements
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        job_requirement: String(item.job_requirement || ""),
        present_in_resume: Boolean(item.present_in_resume),
        strength_level: String(item.strength_level || "Unspecified"),
        notes: String(item.notes || ""),
      }))
    : [];

  const hasDecision = report?.applied_decision === "yes" || report?.applied_decision === "no";
  const logoUrl = buildLogoUrl(report?.company_name, report?.source_url_input || report?.canonical_url);
  const positioning = useMemo(
    () => buildPositioningDiagnostics(report, posting, personalProfile, companyIndustry, resumeDiagnostics?.extracted_text),
    [report, posting, personalProfile, companyIndustry, resumeDiagnostics?.extracted_text]
  );

  function toggleEvidence(label) {
    setExpandedEvidenceByLabel((current) => ({ ...current, [label]: !current[label] }));
  }

  function strategicRatingColor(rating) {
    if (rating === "Strong Fit") return "teal";
    if (rating === "Partial Fit") return "yellow";
    if (rating === "No Fit") return "red";
    return "gray";
  }

  return (
    <div>
      <Stack gap="md">
        <Breadcrumbs>
          <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
          <Anchor component={Link} to="/applications">Applications</Anchor>
          <Text size="sm">Comparison Report</Text>
        </Breadcrumbs>

        {statusText && (
          <Alert
            color={statusTone === "error" ? "red" : statusTone === "success" ? "teal" : "blue"}
            icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
            variant="light"
          >
            {statusText}
          </Alert>
        )}

        {isLoading && (
          <Paper withBorder p="lg">
            <Group gap="sm">
              <Loader size="sm" />
              <Text>Loading comparison report...</Text>
            </Group>
          </Paper>
        )}

        {!isLoading && loadErrorText && (
          <Alert color="red" icon={<AlertCircle size={16} />} variant="light" title="Could not load report">
            <Stack gap="sm">
              <Text>{loadErrorText}</Text>
              <Group>
                <Button onClick={loadReport}>Retry</Button>
                <Button variant="default" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {!isLoading && !loadErrorText && !report && (
          <Alert color="blue" icon={<Info size={16} />} variant="light" title="No report data">
            The requested comparison report could not be found.
          </Alert>
        )}

        {!isLoading && report && (
          <>
            <Paper withBorder p="lg" radius="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group gap="sm" align="center">
                    <Avatar src={logoUrl} radius="xl" color="blue" variant="light">{companyInitials}</Avatar>
                    <Text size="sm" c="dimmed">{report.company_name} · {companyIndustry || roleContext.industry}</Text>
                  </Group>
                  <Title order={2}>{report.title}</Title>
                  <Text size="sm" c="dimmed">Team: {roleContext.team}</Text>

                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs" mt="xs">
                    <Group gap={6}><ThemeIcon variant="light" size="sm"><MapPin size={14} /></ThemeIcon><Text size="sm" style={{ whiteSpace: "pre-line" }}>{roleContext.locations}</Text></Group>
                    <Group gap={6}><ThemeIcon variant="light" size="sm"><Briefcase size={14} /></ThemeIcon><Text size="sm">{roleContext.workplace}</Text></Group>
                    <Group gap={6}><ThemeIcon variant="light" size="sm"><DollarSign size={14} /></ThemeIcon><Text size="sm">{roleContext.compensation}</Text></Group>
                    <Group gap={6}><ThemeIcon variant="light" size="sm"><UserRound size={14} /></ThemeIcon><Text size="sm">{roleContext.roleType}</Text></Group>
                    <Group gap={6}>
                      <ThemeIcon variant="light" size="sm"><Sigma size={14} /></ThemeIcon>
                      <Group gap={6}>
                        <Text size="sm">{roleContext.level}</Text>
                        <Badge size="xs" variant="light" color={roleContext.levelSource === "parsed" ? "teal" : roleContext.levelSource === "calculated" ? "yellow" : "gray"}>
                          {roleContext.levelSource === "parsed" ? "Parsed" : roleContext.levelSource === "calculated" ? "Calculated" : "Unspecified"}
                        </Badge>
                      </Group>
                    </Group>
                    <Group gap={6}><ThemeIcon variant="light" size="sm"><CalendarClock size={14} /></ThemeIcon><Text size="sm">{roleContext.yearsExperience}</Text></Group>
                  </SimpleGrid>
                </Stack>

                <Stack gap="xs" align="flex-end" w={250}>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      variant="light"
                      component="a"
                      href={report.source_url_input || report.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      rightSection={<ExternalLink size={16} />}
                    >
                      Application Page
                    </Button>
                    <Menu shadow="md" width={200} position="bottom-end" withArrow>
                      <Menu.Target>
                        <Button variant="default" px={8} aria-label="Report actions">
                          <MoreVertical size={16} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<RefreshCw size={14} />}
                          disabled={isRefreshingEvaluation}
                          onClick={onRefreshEvaluation}
                        >
                          Refresh Evaluation
                        </Menu.Item>
                        {isChatGptMode && hasChatGptResponse && (
                          <Menu.Item
                            leftSection={<Import size={14} />}
                            onClick={() => { setIsReimportMode((c) => !c); setIsEditingResponse(false); setIsEditingParsedInfo(false); }}
                          >
                            {isReimportMode ? "Cancel Re-import" : "Re-import Response"}
                          </Menu.Item>
                        )}
                        {isChatGptMode && hasChatGptResponse && (
                          <Menu.Item
                            leftSection={<Pencil size={14} />}
                            onClick={() => { onStartEditResponse(); }}
                          >
                            Edit Response
                          </Menu.Item>
                        )}
                        <Menu.Item
                          leftSection={<FileEdit size={14} />}
                          onClick={onStartEditParsedInfo}
                        >
                          Edit Parsed Information
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>

                  {(!hasDecision || isEditingDecision) && (
                    <>
                      <Text size="sm" c="dimmed">Did you apply to this job?</Text>
                      <Group>
                        <Button leftSection={<Check size={14} />} disabled={isSavingDecision} onClick={() => onDecision(true)}>
                          {isSavingDecision ? "Saving..." : "Yes"}
                        </Button>
                        <Button variant="default" disabled={isSavingDecision} onClick={() => onDecision(false)}>
                          No
                        </Button>
                      </Group>
                    </>
                  )}

                  {hasDecision && !isEditingDecision && (
                    <Stack gap={6} align="flex-end">
                      <Text size="sm" c="dimmed">Applied Decision</Text>
                      <Group gap={8} align="center">
                        <Badge size="lg" color={report.applied_decision === "yes" ? "teal" : "gray"}>
                          {report.applied_decision}
                        </Badge>
                        <Button variant="subtle" px={8} onClick={() => setIsEditingDecision(true)} aria-label="Edit decision">
                          <Pencil size={16} />
                        </Button>
                      </Group>
                    </Stack>
                  )}

                  <Text size="xs" c="dimmed" ta="right" mt="xs">
                    Evaluation: {report?.evaluation_source === "chatgpt_api" ? "Chat GPT" : "Local Engine"}
                  </Text>
                  {isChatGptMode && hasChatGptResponse && !isReimportMode && (
                    <Text size="xs" c="teal" ta="right">
                      Response Imported
                    </Text>
                  )}
                </Stack>
              </Group>
            </Paper>

            <Tabs defaultValue="overview" variant="outline">
              <Tabs.List>
                <Tabs.Tab value="overview">Overview</Tabs.Tab>
                <Tabs.Tab value="evidence">Evidence</Tabs.Tab>
                <Tabs.Tab value="job-description">Job Description</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="overview" pt="md">
                {report.evaluation_source === "chatgpt_api" && showChatGptImportInputs && (
                  <Paper withBorder radius="md" p="lg" mb="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Title order={4}>Manual ChatGPT Evaluation</Title>
                        <Badge color={report.chatgpt_response_present ? "teal" : "yellow"} variant="light">
                          {report.chatgpt_response_present ? "Response Imported" : "Response Needed"}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        Copy this prompt into ChatGPT, ask for a JSON-only response, then paste that full JSON below to update this report.
                      </Text>
                      <Group justify="flex-end">
                        <Button variant="default" onClick={onCopyChatGptPrompt}>Copy Prompt</Button>
                      </Group>
                      <Textarea
                        label="Prompt for ChatGPT"
                        value={report.chatgpt_prompt_text || ""}
                        rows={4}
                        readOnly
                        styles={{ input: { resize: "vertical", minHeight: 90 } }}
                      />

                      <Textarea
                        label="Paste ChatGPT JSON response"
                        placeholder='{"overall_fit_score": 78, ...}'
                        value={chatGptResponseText}
                        onChange={(event) => setChatGptResponseText(event.currentTarget.value)}
                        rows={5}
                        styles={{ input: { resize: "vertical", minHeight: 110 } }}
                      />
                      <Group justify="flex-end">
                        <Button variant="default" onClick={() => setIsReimportMode(false)}>Cancel</Button>
                        <Button
                          onClick={onImportChatGptResponse}
                          loading={isImportingChatGptResponse}
                          disabled={isImportingChatGptResponse}
                        >
                          Import Response
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                )}
                {isChatGptMode && isEditingResponse && (
                  <Paper withBorder radius="md" p="lg" mb="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Title order={4}>Edit Response</Title>
                        <Badge color="blue" variant="light">Editing</Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        Modify the JSON response data below and save to update this report.
                      </Text>
                      <Textarea
                        label="ChatGPT JSON response"
                        value={editedResponseText}
                        onChange={(event) => setEditedResponseText(event.currentTarget.value)}
                        rows={10}
                        styles={{ input: { resize: "vertical", minHeight: 200, fontFamily: "monospace", fontSize: 13 } }}
                      />
                      <Group justify="flex-end">
                        <Button variant="default" onClick={() => setIsEditingResponse(false)}>Cancel</Button>
                        <Button
                          onClick={onSaveEditedResponse}
                          loading={isImportingChatGptResponse}
                          disabled={isImportingChatGptResponse}
                        >
                          Save Changes
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                )}
                {isEditingParsedInfo && (
                  <Paper withBorder radius="md" p="lg" mb="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Title order={4}>Edit Parsed Information</Title>
                        <Badge color="blue" variant="light">Editing</Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        Update the parsed role details for this comparison report.
                      </Text>
                      <TextInput
                        label="Company Name"
                        value={parsedInfoForm.company_name}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, company_name: v })); }}
                      />
                      <TextInput
                        label="Title"
                        value={parsedInfoForm.title}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, title: v })); }}
                      />
                      <TextInput
                        label="Location"
                        value={parsedInfoForm.location}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, location: v })); }}
                      />
                      <TextInput
                        label="Salary Range"
                        value={parsedInfoForm.salary_range}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, salary_range: v })); }}
                      />
                      <TextInput
                        label="Seniority Level"
                        value={parsedInfoForm.seniority_level}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, seniority_level: v })); }}
                      />
                      <TextInput
                        label="Workplace Type"
                        placeholder="e.g. Remote, Hybrid, On-site"
                        value={parsedInfoForm.workplace_type}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, workplace_type: v })); }}
                      />
                      <TextInput
                        label="Years Experience"
                        value={parsedInfoForm.years_experience}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, years_experience: v })); }}
                      />
                      <TextInput
                        label="Time Commitment"
                        placeholder="e.g. Full-time, Part-time, Contract"
                        value={parsedInfoForm.commitment_type}
                        onChange={(e) => { const v = e.currentTarget.value; setParsedInfoForm((f) => ({ ...f, commitment_type: v })); }}
                      />
                      <Group justify="flex-end">
                        <Button variant="default" onClick={() => setIsEditingParsedInfo(false)}>Cancel</Button>
                        <Button
                          onClick={onSaveParsedInfo}
                          loading={isSavingParsedInfo}
                          disabled={isSavingParsedInfo}
                        >
                          Save Changes
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                )}
                {!showCompatibilityContent && (
                  <Alert color="blue" variant="light" icon={<Info size={16} />} mb="md">
                    Import a ChatGPT JSON response to unlock the role compatibility analysis sections.
                  </Alert>
                )}
                {showCompatibilityContent && (
                <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Paper withBorder radius="md" p="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="end">
                      <Title order={3}>{roleCompatibilityScore}%</Title>
                      <Text size="sm" c="dimmed">Role compatibility</Text>
                    </Group>
                    <Progress value={roleCompatibilityScore} color={scoreColor} size="lg" radius="xl" />
                    <Text size="sm" c="dimmed">
                      Overall score combines hard skills and soft skills with weighted impact to estimate role fit.
                    </Text>

                    <Divider />

                    <Title order={5}>Score Breakdown</Title>
                    <Stack gap="sm">
                      <div>
                        <Group justify="space-between">
                          <Tooltip label="Compares required technical skill keywords and tooling between resume and job description." withArrow>
                            <Text size="sm" style={{ cursor: "help" }}>Hard Skills</Text>
                          </Tooltip>
                          <Text fw={600}>{displayedHardScore}%</Text>
                        </Group>
                        <Progress value={displayedHardScore} color="violet" />
                        {isChatGptMode && hasChatGptResponse && (
                          <Stack gap="xs" mt="sm">
                            <Text size="sm" c="dimmed">
                              {hardSkillEvaluation?.explanation || ""}
                            </Text>
                            {(hardMissing || []).length > 0 && (
                              <Paper withBorder radius="sm" p="sm" bg="gray.0">
                                <Text fw={600} size="sm" mb="xs">Missing or Underrepresented</Text>
                                <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 16 }}>
                                  {hardMissing.map((item, idx) => (
                                    <li key={`hard-missing-left-${idx}`}><Text size="sm">{item}</Text></li>
                                  ))}
                                </ul>
                              </Paper>
                            )}
                            {(hardMatched || []).length > 0 && (
                              <>
                                <Button
                                  variant="subtle"
                                  size="compact-sm"
                                  onClick={() => setShowHardStrongest((v) => !v)}
                                  px={0}
                                >
                                  {showHardStrongest ? "Read Less" : "Read More"}
                                </Button>
                                {showHardStrongest && (
                                  <Paper withBorder radius="sm" p="sm" bg="gray.0">
                                    <Text fw={600} size="sm" mb="xs">Strongest Matches</Text>
                                    <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 16 }}>
                                      {hardMatched.map((item, idx) => (
                                        <li key={`hard-strong-left-${idx}`}><Text size="sm">{item}</Text></li>
                                      ))}
                                    </ul>
                                  </Paper>
                                )}
                              </>
                            )}
                          </Stack>
                        )}
                      </div>
                      <div>
                        <Group justify="space-between">
                          <Tooltip label="Checks language signals for collaboration, communication, leadership, and behavioral fit." withArrow>
                            <Text size="sm" style={{ cursor: "help" }}>Soft Skills</Text>
                          </Tooltip>
                          <Text fw={600}>{report.analysis.sub_scores.soft_skills}%</Text>
                        </Group>
                        <Progress value={report.analysis.sub_scores.soft_skills} color="cyan" />
                        {isChatGptMode && hasChatGptResponse && (
                          <Stack gap="xs" mt="sm">
                            <Text size="sm" c="dimmed">
                              {softSkillEvaluation?.explanation || ""}
                            </Text>
                            {(softMissing || []).length > 0 && (
                              <Paper withBorder radius="sm" p="sm" bg="gray.0">
                                <Text fw={600} size="sm" mb="xs">Missing or Unclear</Text>
                                <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 16 }}>
                                  {softMissing.map((item, idx) => (
                                    <li key={`soft-missing-left-${idx}`}><Text size="sm">{item}</Text></li>
                                  ))}
                                </ul>
                              </Paper>
                            )}
                            {(softMatched || []).length > 0 && (
                              <>
                                <Button
                                  variant="subtle"
                                  size="compact-sm"
                                  onClick={() => setShowSoftStrongest((v) => !v)}
                                  px={0}
                                >
                                  {showSoftStrongest ? "Read Less" : "Read More"}
                                </Button>
                                {showSoftStrongest && (
                                  <Paper withBorder radius="sm" p="sm" bg="gray.0">
                                    <Text fw={600} size="sm" mb="xs">Strongest Indicators</Text>
                                    <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 16 }}>
                                      {softMatched.map((item, idx) => (
                                        <li key={`soft-strong-left-${idx}`}><Text size="sm">{item}</Text></li>
                                      ))}
                                    </ul>
                                  </Paper>
                                )}
                              </>
                            )}
                          </Stack>
                        )}
                      </div>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 8 }}>
                <Stack gap="md">
                  {isChatGptMode && hasChatGptResponse ? (
                    <>
                      <Paper withBorder radius="md" p="lg">
                        <Group justify="space-between" mb="sm">
                          <Title order={4}>Strategic Evaluation</Title>
                          <ThemeIcon variant="light" color="indigo" size="sm">
                            <CircleHelp size={14} />
                          </ThemeIcon>
                        </Group>
                        <Stack gap="sm">
                          {strategicRows.map((item) => (
                            <Paper key={item.key} withBorder radius="sm" p="sm" bg="gray.0">
                              <Group justify="space-between" align="center" mb={4}>
                                <Text fw={600}>{item.label}</Text>
                                <Badge color={strategicRatingColor(item.rating)} variant="light">{item.rating}</Badge>
                              </Group>
                              <Text size="sm" c="dimmed">{item.reasoning}</Text>
                            </Paper>
                          ))}
                        </Stack>

                        <Divider my="sm" />
                        <Title order={5} mb="xs">Gap Analysis</Title>
                        {gapAnalysis?.summary && (
                          <Text size="sm" c="dimmed" mb="sm">{String(gapAnalysis.summary)}</Text>
                        )}
                        <Table striped withTableBorder withColumnBorders>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Requirement</Table.Th>
                              <Table.Th>Strength</Table.Th>
                              <Table.Th>Notes</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {gapRequirements.length > 0 ? (
                              gapRequirements.map((row, idx) => (
                                <Table.Tr key={`${row.job_requirement}-${idx}`}>
                                  <Table.Td>{row.job_requirement}</Table.Td>
                                  <Table.Td>{row.strength_level}</Table.Td>
                                  <Table.Td>{row.notes || "—"}</Table.Td>
                                </Table.Tr>
                              ))
                            ) : (
                              <Table.Tr>
                                <Table.Td colSpan={3}>No gap analysis items available in the imported response.</Table.Td>
                              </Table.Tr>
                            )}
                          </Table.Tbody>
                        </Table>
                      </Paper>
                    </>
                  ) : (
                    <>
                      <Paper withBorder radius="md" p="lg">
                        <Group justify="space-between" mb="sm">
                          <Title order={4}>Positioning Guidance</Title>
                          <ThemeIcon variant="light" color="indigo" size="sm">
                            <CircleHelp size={14} />
                          </ThemeIcon>
                        </Group>
                        <Text size="sm" c="dimmed" mb="sm">
                          Interpretations are shown only when supported by extracted resume/Job Description evidence and local profile context.
                        </Text>
                        <Stack gap="xs">
                          {positioning.diagnostics.map((item) => (
                            <div key={item.label}>
                              <Group justify="space-between" align="start" wrap="nowrap">
                                <Group gap={8} align="start" wrap="nowrap" style={{ maxWidth: "80%" }}>
                                  <ThemeIcon
                                    size="sm"
                                    variant="light"
                                    color={item.status === "aligned" ? "teal" : item.status === "warning" ? "yellow" : "gray"}
                                  >
                                    {item.status === "aligned" ? <CircleCheck size={13} /> : item.status === "warning" ? <TriangleAlert size={13} /> : <CircleHelp size={13} />}
                                  </ThemeIcon>
                                  <div>
                                    <Text fw={600}>{item.label}</Text>
                                    <Text size="sm" c="dimmed">{item.detail}</Text>
                                  </div>
                                </Group>

                                {(item.jobExcerpts?.length > 0 || item.resumeExcerpts?.length > 0) && (
                                  <Button
                                    variant="subtle"
                                    size="compact-sm"
                                    onClick={() => toggleEvidence(item.label)}
                                    rightSection={expandedEvidenceByLabel[item.label] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  >
                                    Excerpts
                                  </Button>
                                )}
                              </Group>

                              {expandedEvidenceByLabel[item.label] && (
                                <Paper withBorder radius="sm" p="sm" mt="xs" bg="gray.0">
                                  {item.jobExcerpts?.length > 0 && (
                                    <>
                                      <Text size="xs" fw={700} c="dimmed">Job Description excerpts</Text>
                                      <ul style={{ marginTop: 6, marginBottom: 8 }}>
                                        {item.jobExcerpts.map((excerpt, index) => (
                                          <li key={`${item.label}-job-${index}`}><Text size="xs">{excerpt}</Text></li>
                                        ))}
                                      </ul>
                                    </>
                                  )}

                                  {item.resumeExcerpts?.length > 0 && (
                                    <>
                                      <Text size="xs" fw={700} c="dimmed">Resume evidence excerpts</Text>
                                      <ul style={{ marginTop: 6, marginBottom: 0 }}>
                                        {item.resumeExcerpts.map((excerpt, index) => (
                                          <li key={`${item.label}-resume-${index}`}><Text size="xs">{excerpt}</Text></li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </Paper>
                              )}
                            </div>
                          ))}
                        </Stack>
                        <Divider my="sm" />
                        <Text size="xs" c="dimmed">
                          Evidence tokens scanned: {positioning.totalEvidence}
                        </Text>
                      </Paper>

                      <Paper withBorder radius="md" p="lg">
                        <Group justify="space-between" mb="sm">
                          <Title order={4}>Hard Skills</Title>
                          <Badge color="violet" variant="light">High score impact</Badge>
                        </Group>
                        <Text size="sm" c="dimmed" mb="sm">
                          Skill match with required-skill coverage and checks for demonstrated application in summary/experience evidence.
                        </Text>
                        <Group justify="space-between" mb="sm">
                          <Text size="sm" fw={600}>Required skill coverage</Text>
                          <Text size="sm" fw={700}>{hardCoverage}% ({matchedRequiredHardSkills.length}/{requiredHardSkills.length || 0})</Text>
                        </Group>
                        <Table striped withTableBorder withColumnBorders>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Skill</Table.Th>
                              <Table.Th>Required</Table.Th>
                              <Table.Th>Mentioned</Table.Th>
                              <Table.Th>Demonstrated Use</Table.Th>
                              <Table.Th>Status</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {hardEvidenceBySkill.length > 0 ? (
                              hardEvidenceBySkill.map((row, idx) => (
                                <Table.Tr key={`${row.skill}-${idx}`}>
                                  <Table.Td>{row.skill}</Table.Td>
                                  <Table.Td>{row.required ? "Yes" : "No"}</Table.Td>
                                  <Table.Td>{row.mentioned ? "Yes" : "No"}</Table.Td>
                                  <Table.Td>{row.mentioned ? (row.demonstrated ? "Yes" : "Unclear") : "No"}</Table.Td>
                                  <Table.Td>
                                    {row.mentioned
                                      ? row.demonstrated
                                        ? "Matched + Applied"
                                        : "Matched (application unclear)"
                                      : "Missing"}
                                  </Table.Td>
                                </Table.Tr>
                              ))
                            ) : (
                              <Table.Tr>
                                <Table.Td colSpan={5}>No hard-skill comparison items available.</Table.Td>
                              </Table.Tr>
                            )}
                          </Table.Tbody>
                        </Table>
                      </Paper>

                      <Paper withBorder radius="md" p="lg">
                        <Group justify="space-between" mb="sm">
                          <Title order={4}>Soft Skills</Title>
                          <Badge color="cyan" variant="light">Low score impact</Badge>
                        </Group>
                        <Text size="sm" c="dimmed" mb="sm">
                          Adjective and behavioral-signal comparison to evaluate soft-skill alignment.
                        </Text>
                        <Table striped withTableBorder withColumnBorders>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Skill</Table.Th>
                              <Table.Th>In Resume</Table.Th>
                              <Table.Th>In Job Description</Table.Th>
                              <Table.Th>Status</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {softSkillRows.length > 0 ? (
                              softSkillRows.map((row, idx) => (
                                <Table.Tr key={`${row.skill}-${idx}`}>
                                  <Table.Td>{row.skill}</Table.Td>
                                  <Table.Td>{row.inResume ? "Yes" : "No"}</Table.Td>
                                  <Table.Td>Yes</Table.Td>
                                  <Table.Td>{row.inResume ? "Matched" : "Missing"}</Table.Td>
                                </Table.Tr>
                              ))
                            ) : (
                              <Table.Tr>
                                <Table.Td colSpan={4}>No soft-skill comparison items available.</Table.Td>
                              </Table.Tr>
                            )}
                          </Table.Tbody>
                        </Table>
                      </Paper>
                    </>
                  )}

                  {isChatGptMode && hasChatGptResponse && Array.isArray(chatGptResponseJson?.suggested_updates) && chatGptResponseJson.suggested_updates.length > 0 && (
                    <Paper withBorder radius="md" p="lg">
                      <Group justify="space-between" mb="sm">
                        <Title order={4}>Suggested Updates</Title>
                        <ThemeIcon variant="light" color="yellow" size="sm">
                          <Lightbulb size={14} />
                        </ThemeIcon>
                      </Group>
                      <Text size="sm" c="dimmed" mb="md">
                        Actionable resume improvements to increase alignment with this role.
                      </Text>
                      <Stack gap="md">
                        {Object.entries(
                          chatGptResponseJson.suggested_updates.reduce((groups, item) => {
                            const key = item.section || "General";
                            if (!groups[key]) groups[key] = [];
                            groups[key].push(item);
                            return groups;
                          }, {})
                        ).map(([section, items]) => (
                          <div key={section}>
                            <Text fw={600} size="sm" mb="xs">{section}</Text>
                            <Stack gap="xs">
                              {items.map((item, idx) => (
                                <Paper key={`${section}-${idx}`} withBorder p="sm" radius="sm" bg="gray.0">
                                  <Text size="sm">{item.suggestion || ""}</Text>
                                  <Text size="sm" c="dimmed">{item.rationale || ""}</Text>
                                </Paper>
                              ))}
                            </Stack>
                          </div>
                        ))}
                      </Stack>
                    </Paper>
                  )}

                </Stack>
              </Grid.Col>
                </Grid>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="evidence" pt="md">
                <Paper withBorder radius="md" p="lg">
                  <Title order={4} mb="sm">Evidence</Title>
                  {report.analysis.evidence.length > 0 ? (
                    <Stack gap="sm">
                      {report.analysis.evidence.map((item, idx) => (
                        <Paper key={`${item.keyword}-${idx}`} withBorder p="sm" radius="sm">
                          <Text size="sm" fw={700}>{item.category} · {item.keyword}</Text>
                          <Text size="sm" c="dimmed">{item.resume_snippet}</Text>
                          <Text size="sm" c="dimmed">{item.job_snippet}</Text>
                        </Paper>
                      ))}
                    </Stack>
                  ) : (
                    <Text c="dimmed">No evidence items available for this report.</Text>
                  )}
                </Paper>
              </Tabs.Panel>

              <Tabs.Panel value="job-description" pt="md">
                <Paper withBorder radius="md" p="lg">
                  <Title order={4} mb="sm">Job Description (as provided)</Title>
                  <Text size="sm" c="dimmed" mb="sm">
                    This is the job description text currently stored for this report.
                  </Text>
                  <Paper withBorder p="md" radius="sm" bg="gray.0">
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {posting?.description_text || "No job description text available."}
                    </Text>
                  </Paper>
                </Paper>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </Stack>
    </div>
  );
}
