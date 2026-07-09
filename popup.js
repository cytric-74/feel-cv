"use strict";

if (typeof chrome === "undefined" || !chrome.storage) {
  window.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const mock = {
            fcv_profile: {
              full_name: "John Doe",
              email: "john.doe@example.com",
              phone: "+1 234 567 890",
              location: "New York, NY",
              skills: "HTML, CSS, JavaScript, React, Node.js",
              current_company: "Acme Corp",
              current_role: "Software Engineer",
              degree: "B.S. in Computer Science"
            },
            fcv_filename: "resume.pdf",
            fcv_provider: {
              provider: "ollama",
              apiKey: "",
              ollamaUrl: "http://localhost:11434",
              ollamaModel: "llama3.2"
            }
          };
          if (typeof keys === "string") {
            cb({ [keys]: mock[keys] });
          } else if (Array.isArray(keys)) {
            cb(Object.fromEntries(keys.map(k => [k, mock[k]])));
          } else {
            cb(mock);
          }
        },
        set: (data, cb) => { if (cb) cb(); },
        remove: (keys, cb) => { if (cb) cb(); },
        clear: (cb) => { if (cb) cb(); }
      }
    },
    runtime: {
      sendMessage: () => { },
      onMessage: {
        addListener: () => { }
      },
      getURL: (path) => path
    }
  };
}

// Use the shared registry loaded by field_registry.js; fall back to a minimal
// inline copy so the popup still works if the script order ever changes.
const FIELD_REGISTRY = window.FCV_FIELD_REGISTRY || {
  full_name:        { label: "Full Name",              patterns: ["full name", "your name", "applicant name", "name"] },
  first_name:       { label: "First Name",             patterns: ["first name", "given name", "forename"] },
  last_name:        { label: "Last Name",              patterns: ["last name", "surname", "family name"] },
  email:            { label: "Email",                  patterns: ["email address", "email", "e-mail", "mail"] },
  phone:            { label: "Phone",                  patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"] },
  location:         { label: "Location / City",        patterns: ["current location", "where are you based", "city", "location", "address"] },
  linkedin:         { label: "LinkedIn URL",           patterns: ["linkedin profile", "linkedin url", "linkedin"] },
  github:           { label: "GitHub URL",             patterns: ["github url", "github", "portfolio", "website", "personal site"] },
  portfolio:        { label: "Portfolio URL",          patterns: ["portfolio url", "portfolio", "website", "personal url"] },
  summary:          { label: "About / Summary",        patterns: ["professional summary", "profile summary", "about yourself", "tell us about yourself", "describe yourself", "summary", "bio"] },
  headline:         { label: "Professional Headline",  patterns: ["current position", "current role", "job title", "designation", "headline"] },
  years_experience: { label: "Years of Experience",   patterns: ["years of experience", "total experience", "how many years"] },
  current_company:  { label: "Current Employer",      patterns: ["current organization", "current employer", "current company", "employer"] },
  current_role:     { label: "Current Job Title",     patterns: ["current designation", "current position", "current title", "current role"] },
  work_history:     { label: "Work History",           patterns: ["employment history", "work history", "past experience"] },
  degree:           { label: "Degree",                 patterns: ["highest qualification", "academic qualification", "qualification", "education", "degree"] },
  university:       { label: "University / College",  patterns: ["university", "college", "institution", "school", "alma mater"] },
  graduation_year:  { label: "Graduation Year",       patterns: ["graduation year", "year of graduation", "passed out", "batch"] },
  major:            { label: "Field of Study",         patterns: ["field of study", "specialization", "stream", "branch", "course", "major"] },
  skills:           { label: "Skills",                 patterns: ["technical skills", "tech stack", "technologies", "competencies", "expertise", "tools", "skills"] },
  languages:        { label: "Programming Languages",  patterns: ["programming languages", "languages known", "coding languages"] },
  cover_letter:     { label: "Cover Letter",           patterns: ["motivation letter", "statement of purpose", "cover letter", "why should we hire"] },
  motivation:       { label: "Why this role / company",patterns: ["reason for applying", "what interests you", "why are you interested", "why this company", "why this role", "why do you want"] },
  strengths:        { label: "Key Strengths",          patterns: ["greatest strengths", "what are your strengths", "key strengths", "strengths"] },
  achievements:     { label: "Achievements",           patterns: ["notable projects", "key projects", "accomplishments", "proud of", "achievements"] },
  salary:           { label: "Expected Salary",        patterns: ["salary expectation", "expected salary", "expected ctc", "compensation", "ctc"] },
  notice_period:    { label: "Notice Period",          patterns: ["when can you join", "notice period", "availability", "how soon"] },
};

const AI_GENERATED_FIELDS = new Set(["cover_letter", "motivation", "strengths", "achievements", "summary"]);

const getProfile = () => new Promise(r => chrome.storage.local.get("fcv_profile", d => r(d.fcv_profile || {})));
const setProfile = (p) => new Promise(r => chrome.storage.local.set({ fcv_profile: p }, r));
const updateProfile = async (patch) => { const cur = await getProfile(); await setProfile({ ...cur, ...patch }); };

const DEFAULT_CONFIG = {
  provider: "ollama",
  apiKey: "",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  fallbackUrl: "https://api.groq.com/openai/v1",
  fallbackModel: "llama-3.1-8b-instant",
};

const getProviderConfig = () => new Promise(r =>
  chrome.storage.local.get("fcv_provider", d =>
    r({ ...DEFAULT_CONFIG, ...(d.fcv_provider || {}) })
  )
);
const setProviderConfig = (cfg) => new Promise(r =>
  chrome.storage.local.set({ fcv_provider: cfg }, r)
);

async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "txt") return file.text();
  if (ext === "pdf") return extractPDF(file);
  if (ext === "docx") return extractDOCX(file);
  throw new Error("Unsupported file type: " + ext);
}

async function extractPDF(file) {
  const pdfjsLib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) {
    throw new Error("pdf.js library is not loaded. Please ensure pdf.min.js and pdf.worker.min.js exist in the extension folder.");
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");
  } catch (err) {
    console.warn("Could not set PDF worker source URL:", err);
  }

  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // ── Layout-aware reconstruction ──────────────────────────────────────
    // Each item has a transform matrix [scaleX, skewX, skewY, scaleY, tx, ty].
    // ty (transform[5]) is the Y position on the page; tx (transform[4]) is X.
    // Group items into visual lines by quantising Y to ±2 px tolerance,
    // then sort each line by X to restore reading order.

    const Y_TOLERANCE = 2;
    const lineMap = new Map(); // quantised-Y → [{ x, str }]

    for (const item of content.items) {
      if (!item.str) continue;
      const rawY = item.transform[5];
      const x    = item.transform[4];

      // Find an existing bucket whose Y is within tolerance
      let bucketKey = null;
      for (const key of lineMap.keys()) {
        if (Math.abs(key - rawY) <= Y_TOLERANCE) {
          bucketKey = key;
          break;
        }
      }
      if (bucketKey === null) {
        bucketKey = rawY;
        lineMap.set(bucketKey, []);
      }
      lineMap.get(bucketKey).push({ x, str: item.str });
    }

    // Sort Y buckets descending (PDF Y grows upward; top of page = largest Y)
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    const lines = sortedYs.map(y => {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x);
      return items.map(it => it.str).join(" ").trim();
    }).filter(Boolean);

    pageTexts.push(lines.join("\n"));
  }

  return normalizeResumeText(pageTexts.join("\n"));
}

/**
 * Post-extraction text normalisation.
 * Runs on the reconstructed line-based text before parsing.
 */
function normalizeResumeText(text) {
  // Collapse 3+ consecutive spaces → single space
  text = text.replace(/ {3,}/g, " ");

  // Fix soft/wrapped hyphenation: "im- prove" → "improve"
  // Only merge when the suffix is a lowercase word (safe heuristic)
  text = text.replace(/-\s+([a-z])/g, "$1");

  // Insert newline before common section headings that may appear mid-line.
  // Patterns are generic heading words, not content-specific.
  const HEADING_RE = /(?<=[\w,;.])\s+((?:Work\s+)?Experience|Projects?|(?:Technical\s+)?Skills|Education|Certifications?|Awards?|Achievements?|Summary|Profile|Objective|Publications?|Volunteer(?:ing)?|Interests?|References?|Languages?|Courses?|Honours?|Activities)/gi;
  text = text.replace(HEADING_RE, "\n$1");

  return text.trim();
}

async function extractDOCX(file) {
  if (!window.mammoth) throw new Error("mammoth not loaded");
  const ab = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: ab });
  return result.value;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC RESUME PARSER  (section-based, no hardcoded sample values)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Known section heading keywords used to split the resume into named sections.
 * Generic — not tied to any particular resume's content.
 */
const SECTION_HEADINGS = [
  "experience", "work experience", "professional experience", "employment", "employment history",
  "internship", "internships",
  "education", "academic background", "academic qualifications",
  "skills", "technical skills", "core competencies", "competencies", "technologies",
  "projects", "project experience", "personal projects", "academic projects",
  "certifications", "certification", "licenses",
  "awards", "achievements", "honours", "honors",
  "summary", "profile", "objective", "professional summary", "career objective",
  "publications", "research",
  "languages", "programming languages",
  "volunteer", "volunteering", "extra-curricular", "activities", "interests"
];

// Regex that matches a line if it looks like a section heading.
// Heuristic: line is short, starts with a known keyword, has no sentence punctuation.
const HEADING_LINE_RE = new RegExp(
  `^(?:${SECTION_HEADINGS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[:\s]*$`,
  "i"
);

/**
 * Split resume text into named sections.
 * Returns an array of { heading: string, lines: string[] }.
 * A leading section with heading "header" captures lines before the first heading.
 */
function splitResumeSections(text) {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sections = [];
  let current = { heading: "header", lines: [] };

  for (const line of rawLines) {
    if (HEADING_LINE_RE.test(line)) {
      if (current.lines.length > 0 || current.heading !== "header") {
        sections.push(current);
      }
      current = { heading: line.toLowerCase().replace(/:$/, "").trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) sections.push(current);
  return sections;
}

/**
 * Extract contact fields from the full text using robust regexes.
 * These are the most reliable fields and should be set first.
 */
function extractContactInfo(text) {
  const info = {};

  // Email
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailM) info.email = emailM[0];

  // Phone — allows international formats, extensions, separators
  // Requires at least 7 digits and starts with optional + or digit
  const phoneM = text.match(/(\+?[\d][\d\s\-().]{6,18}[\d])/);
  if (phoneM) {
    const digits = phoneM[1].replace(/\D/g, "");
    // Sanity: between 7 and 15 digits
    if (digits.length >= 7 && digits.length <= 15) {
      info.phone = phoneM[1].trim();
    }
  }

  // LinkedIn
  const liM = text.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  if (liM) info.linkedin = "https://linkedin.com/in/" + liM[1];

  // GitHub
  const ghM = text.match(/github\.com\/([a-zA-Z0-9\-_%]+)/i);
  if (ghM) info.github = "https://github.com/" + ghM[1];

  // Portfolio / personal site (not github/linkedin)
  const portM = text.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.)([a-zA-Z0-9\-_.]+\.[a-zA-Z]{2,}[^\s]*)/i);
  if (portM) info.portfolio = portM[0];

  return info;
}

/**
 * Attempt to extract the candidate's name from the top lines of the resume.
 * Strategy: Look at the first 8 non-empty lines for a short line that looks
 * like a proper name (title-cased or ALL-CAPS words, no @ / http / digits at start,
 * no sentence punctuation, 2–5 words).
 */
function extractName(lines) {
  // Proper name: 2-5 words, each word capitalised or all-caps, no special chars
  const NAME_RE = /^([A-Z][a-zA-Z'-]+)(\s[A-Z][a-zA-Z'-]+){1,4}$/;
  // All-caps variant
  const ALLCAPS_RE = /^([A-Z]{2,})(\s[A-Z]{2,}){1,4}$/;

  for (const line of lines.slice(0, 8)) {
    if (line.includes("@") || line.includes("http") || /^\d/.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    // Skip lines that look like contact info or URLs
    if (/[|•·,;@]/.test(line) && line.split(/[|•·,;@]/).length > 2) continue;
    // Skip lines that are clearly headings (all-caps single word)
    const words = line.trim().split(/\s+/);
    if (words.length === 1 && words[0] === words[0].toUpperCase()) continue;

    if (NAME_RE.test(line) || ALLCAPS_RE.test(line)) {
      return line.trim();
    }
  }
  return null;
}

/**
 * Parse experience entries from an experience section's lines.
 * Returns { current_company, current_role, work_history, years_experience }.
 *
 * Heuristic rules (generic):
 * - A line that looks like a role title often follows a company name.
 * - Date ranges identify the temporal extent of a role.
 * - The first entry is assumed to be the most recent (current) role.
 */
function extractExperience(sectionLines) {
  // Date range pattern: covers "Jan 2022 – Present", "2020 - 2023", "Mar 2021 — Current", etc.
  const DATE_RANGE_RE = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s)?\d{4}\s*[–—\-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:\d{4}|present|current|now|ongoing)/i;

  // Role/title keywords — generic occupational words
  const ROLE_KEYWORDS_RE = /\b(?:engineer|developer|analyst|manager|designer|scientist|architect|lead|consultant|specialist|coordinator|officer|director|associate|intern|researcher|executive|head|vp|cto|ceo|founder|staff|senior|junior|principal|full.?stack|front.?end|back.?end|devops|data|ml|ai|software|product|project|program|qa|sre|cloud|mobile|embedded|platform)\b/i;

  const entries = [];
  let i = 0;

  while (i < sectionLines.length) {
    const line = sectionLines[i];

    // Lines with a date range anchor an experience entry
    if (DATE_RANGE_RE.test(line)) {
      // Look back up to 2 lines for company / role
      const prev1 = sectionLines[i - 1] || "";
      const prev2 = sectionLines[i - 2] || "";
      const next1 = sectionLines[i + 1] || "";

      let company = "", role = "";

      // Determine which adjacent lines are role vs company:
      // Prefer: line containing role keywords = role, other = company
      const candidates = [prev2, prev1, line, next1].filter(l => l && !DATE_RANGE_RE.test(l) && l.length > 1 && l.length < 80);

      for (const c of candidates) {
        if (!role && ROLE_KEYWORDS_RE.test(c)) { role = c.trim(); }
        else if (!company && c !== role && c.length > 1) { company = c.trim(); }
      }

      // If role and company are still ambiguous, use positional order
      if (!role && !company) {
        if (prev1) company = prev1.trim();
      } else if (!company && prev1 && prev1 !== role) {
        company = prev1.trim();
      } else if (!role && prev1 && prev1 !== company) {
        role = prev1.trim();
      }

      if (company || role) {
        entries.push({ company, role, dateRange: line.match(DATE_RANGE_RE)?.[0] || "" });
      }
    }
    i++;
  }

  if (!entries.length) return {};

  const result = {};
  const first = entries[0];
  if (first.company) result.current_company = first.company;
  if (first.role)    result.current_role    = first.role;

  // Build compact work_history summary
  const historyParts = entries
    .map(e => [e.company, e.role, e.dateRange].filter(Boolean).join(" · "))
    .filter(Boolean);
  if (historyParts.length) result.work_history = historyParts.join(" | ");

  // Years of experience: count from earliest start year to latest (or present)
  const years = [];
  for (const e of entries) {
    const yMatch = e.dateRange.match(/\b(19|20)(\d{2})\b/g);
    if (yMatch) yMatch.forEach(y => years.push(parseInt(y, 10)));
  }
  if (years.length >= 2) {
    const span = new Date().getFullYear() - Math.min(...years);
    if (span > 0 && span < 60) result.years_experience = `${span}+ years`;
  }

  return result;
}

/**
 * Parse education from an education section's lines.
 * Returns { degree, university, graduation_year, major }.
 */
function extractEducation(sectionLines) {
  const result = {};

  // Generic degree-level keywords
  const DEGREE_RE = /\b(?:bachelor|master|doctor|phd|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|b\.?com|mba|diploma|associate|a\.?s\.?|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|llb|llm|md|dds|jd|honours?)\b/i;
  // Generic institution keywords
  const INST_RE = /\b(?:university|college|institute|school|academy|polytechnic|iit|nit|bits|mit|stanford|oxford|cambridge|iisc|iim)\b/i;
  // Major / field of study keywords
  const MAJOR_RE = /\b(?:computer science|information technology|software engineering|electrical|mechanical|civil|chemical|data science|artificial intelligence|machine learning|mathematics|physics|biology|finance|economics|management|business|commerce|law|medicine|nursing|psychology|sociology)\b/i;

  const years = [];

  for (const line of sectionLines) {
    if (!result.degree && DEGREE_RE.test(line) && line.length < 120) {
      result.degree = line.trim();
    }
    if (!result.university && INST_RE.test(line) && line.length < 120) {
      result.university = line.trim();
    }
    if (!result.major && MAJOR_RE.test(line) && line.length < 120) {
      // Try to extract just the field name rather than the full line
      const mMatch = line.match(MAJOR_RE);
      result.major = mMatch ? line.trim() : undefined;
    }
    // Collect all 4-digit years
    const yMatches = line.match(/\b(19|20)\d{2}\b/g);
    if (yMatches) yMatches.forEach(y => years.push(parseInt(y, 10)));
  }

  // Graduation year: latest year found (expected/actual completion)
  if (years.length) {
    result.graduation_year = String(Math.max(...years));
  }

  return result;
}

/**
 * Extract skills from skills/technical-skills/competencies section lines.
 * Returns a comma-separated string of skill tokens.
 */
function extractSkills(sectionLines) {
  const tokens = [];

  for (const line of sectionLines) {
    // Split on common delimiters: comma, pipe, bullet, semicolon, em-dash
    const parts = line.split(/[,|•·;–—]/).map(p => p.trim()).filter(p => p.length > 0 && p.length < 60);
    tokens.push(...parts);
  }

  return [...new Set(tokens)].join(", ");
}

/**
 * Extract programming languages from skills text.
 * Looks for tokens that match a broad list of known language names.
 * Generic heuristic — no specific resume assumed.
 */
function extractLanguagesFromSkills(skillsText) {
  // Common programming/scripting/query language names (generic list)
  const LANG_NAMES = [
    "python", "javascript", "typescript", "java", "kotlin", "swift", "c", "c++", "c#",
    "go", "golang", "rust", "ruby", "php", "scala", "r", "matlab", "perl", "bash",
    "shell", "sql", "nosql", "html", "css", "dart", "elixir", "haskell", "lua",
    "groovy", "assembly", "cobol", "fortran", "vba", "powershell", "julia"
  ];

  const found = [];
  const lower = skillsText.toLowerCase();

  for (const lang of LANG_NAMES) {
    // Match as a whole word
    const re = new RegExp(`\\b${lang.replace("+", "\\+")}\\b`, "i");
    if (re.test(lower)) {
      // Use the original casing from the skills text where possible
      const match = skillsText.match(re);
      found.push(match ? match[0] : lang);
    }
  }

  return found.join(", ");
}

/**
 * Extract summary / profile text from the header or a summary section.
 */
function extractSummary(sections) {
  const summarySection = sections.find(s =>
    /^(?:summary|profile|objective|professional summary|career objective)/.test(s.heading)
  );
  if (summarySection && summarySection.lines.length) {
    return summarySection.lines.slice(0, 5).join(" ");
  }
  return null;
}

/**
 * Remove empty / whitespace-only fields from the profile object.
 */
function cleanProfile(profile) {
  const clean = {};
  for (const [k, v] of Object.entries(profile)) {
    if (v && String(v).trim().length > 0) {
      clean[k] = String(v).trim();
    }
  }
  return clean;
}

/**
 * Main entry point: parse a plain-text resume into a structured profile.
 * Purely local, no network, no hardcoded sample values.
 * Works generically for any resume layout after layout-aware PDF extraction.
 */
function parseResumeText(text) {
  const profile = {};

  // ── Step 1: Contact fields (highest confidence — regex from full text) ──
  Object.assign(profile, extractContactInfo(text));

  // ── Step 2: Split into sections ─────────────────────────────────────────
  const sections = splitResumeSections(text);
  const headerSection = sections.find(s => s.heading === "header");
  const headerLines   = headerSection ? headerSection.lines : [];

  // ── Step 3: Name (from top of resume) ───────────────────────────────────
  const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const name = extractName(allLines);
  if (name) {
    profile.full_name = name;
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      profile.first_name = parts[0];
      profile.last_name  = parts[parts.length - 1];
    }
  }

  // ── Step 4: Location (from header area) ─────────────────────────────────
  // City, Country or City, State pattern — generic
  if (!profile.location) {
    const locText = headerLines.slice(0, 10).join(" ") + " " + allLines.slice(0, 10).join(" ");
    const locM = locText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\b/);
    if (locM) profile.location = locM[0];
  }

  // ── Step 5: Years of experience (from any section) ───────────────────────
  const yoeM = text.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  if (yoeM) profile.years_experience = yoeM[1] + "+ years";

  // ── Step 6: Summary ──────────────────────────────────────────────────────
  const summary = extractSummary(sections);
  if (summary) profile.summary = summary;

  // ── Step 7: Experience ───────────────────────────────────────────────────
  const expSection = sections.find(s =>
    /^(?:experience|work experience|professional experience|employment(?:\s+history)?|internship)/.test(s.heading)
  );
  if (expSection) {
    Object.assign(profile, extractExperience(expSection.lines));
  }

  // ── Step 8: Education ────────────────────────────────────────────────────
  const eduSection = sections.find(s =>
    /^(?:education|academic background|academic qualifications?)/.test(s.heading)
  );
  if (eduSection) {
    Object.assign(profile, extractEducation(eduSection.lines));
  }

  // ── Step 9: Skills ───────────────────────────────────────────────────────
  const skillsSection = sections.find(s =>
    /^(?:(?:technical\s+)?skills?|competencies|technologies|core competencies)/.test(s.heading)
  );
  if (skillsSection && skillsSection.lines.length) {
    const skillsText = extractSkills(skillsSection.lines);
    if (skillsText) {
      profile.skills = skillsText;
      const langs = extractLanguagesFromSkills(skillsText);
      if (langs) profile.languages = langs;
    }
  }

  // ── Step 10: Achievements / Awards / Projects (compact summary) ──────────
  const achieveSection = sections.find(s =>
    /^(?:achievements?|awards?|honours?|honors?|certifications?)/.test(s.heading)
  );
  if (achieveSection && achieveSection.lines.length) {
    profile.achievements = achieveSection.lines.slice(0, 5).join(" | ");
  }

  return cleanProfile(profile);
}

// ── Debug test harness (callable from browser console) ──────────────────────
// Usage: copy resume text, then call window._fcvDebugParse(text) in DevTools.
window._fcvDebugParse = function (text) {
  const normalized = normalizeResumeText(text);
  const sections   = splitResumeSections(normalized);
  const profile    = parseResumeText(normalized);
  console.group("FeelCV Debug Parse");
  console.log("Sections found:", sections.map(s => `${s.heading} (${s.lines.length} lines)`));
  console.log("Parsed profile:", profile);
  console.log("Field count:", Object.keys(profile).length);
  console.groupEnd();
  return profile;
};

function buildPrompt(fieldKey, profile, jobTitle, company) {
  const { email, phone, ...safeProfile } = profile;
  const p = JSON.stringify(safeProfile);
  const role = jobTitle || "this role";
  const co = company || "this company";
  const prompts = {
    motivation: `Write a concise, genuine 2-3 sentence answer to "Why do you want to work at ${co} as ${role}?" based on this profile: ${p}. Be specific, avoid clichés. Output only the answer text.`,
    cover_letter: `Write a short professional cover letter (150-200 words) for the role of ${role} at ${co} based on this profile: ${p}. Output only the letter body.`,
    strengths: `Write 2-3 specific professional strengths in 1-2 sentences based on this profile: ${p}. No bullet points, no preamble.`,
    achievements: `Summarise 2-3 key achievements from this profile in 1-2 sentences: ${p}. Use numbers/metrics where the profile supports it.`,
    summary: `Write a crisp 2-3 sentence professional summary based on this profile: ${p}. No buzzwords. Output only the summary.`,
  };
  return prompts[fieldKey] || `Generate a short answer for the field "${fieldKey}" from this profile: ${p}. Output only the answer.`;
}

async function callOllama(prompt, cfg) {
  const url = `${cfg.ollamaUrl.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.ollamaModel,
      prompt,
      stream: false,
      options: { num_predict: 400, temperature: 0.7 }
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 404) throw new Error(`Model "${cfg.ollamaModel}" not found. Run: ollama pull ${cfg.ollamaModel}`);
    throw new Error(`Ollama error ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return (data.response || "").trim();
}

async function callOpenAICompat(prompt, cfg) {
  if (!cfg.apiKey) throw new Error("No API key set for fallback provider.");
  const url = `${cfg.fallbackUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.fallbackModel,
      max_tokens: 400,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function generateWithAI(fieldKey, profile, jobTitle = "", company = "") {
  const cfg = await getProviderConfig();
  const prompt = buildPrompt(fieldKey, profile, jobTitle, company);

  if (cfg.provider === "ollama") {
    try {
      return await callOllama(prompt, cfg);
    } catch (err) {
      if (err.message.includes("fetch") || err.message.includes("Failed to fetch")) {
        throw new Error("Ollama is not running. Start it with: ollama serve");
      }
      throw err;
    }
  }

  if (cfg.provider === "openai_compat") {
    return await callOpenAICompat(prompt, cfg);
  }

  throw new Error("Unknown provider.");
}

const $ = id => document.getElementById(id);
const status = (msg, color = "#FFFFFF") => {
  const statusEl = $("status");
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = color;
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 3000);
  }
};

async function updateProfileStats(profile) {
  const keys = Object.keys(profile);
  const filledFields = keys.filter(k => profile[k] && profile[k].trim()).length;
  const totalFields = Object.keys(FIELD_REGISTRY).length;
  const percent = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;

  const percentEl = document.getElementById("hero-percent");
  if (percentEl) {
    percentEl.textContent = `${percent}%`;
  }

  const countEl = document.getElementById("hero-field-count-text");
  if (countEl) {
    countEl.textContent = `${filledFields} / ${totalFields} fields filled`;
  }

  const welcomeScreen = document.getElementById("welcome-screen");
  if (welcomeScreen) {
    const dismissed = await new Promise(r => chrome.storage.local.get("fcv_welcome_dismissed", d => r(d.fcv_welcome_dismissed)));
    if (filledFields === 0 && !dismissed) {
      welcomeScreen.classList.remove("hidden");
    } else {
      welcomeScreen.classList.add("hidden");
    }
  }

  const badgeStatus = document.getElementById("badge-status");
  const filename = await new Promise(r => chrome.storage.local.get("fcv_filename", d => r(d.fcv_filename)));
  if (badgeStatus) {
    if (filename) {
      badgeStatus.textContent = filename.toUpperCase();
      badgeStatus.classList.add("badge-accent");
    } else {
      badgeStatus.textContent = "EMPTY PROFILE";
      badgeStatus.classList.remove("badge-accent");
    }
  }

  const cardHeadline = document.getElementById("card-headline");
  const cardDesc = document.getElementById("card-desc");
  if (cardHeadline && cardDesc) {
    if (filledFields > 0) {
      cardHeadline.textContent = "Profile active and ready.";
      cardDesc.textContent = "Navigate to any job application form and click 'Autofill Form' to fill details in one click.";
    } else {
      cardHeadline.textContent = "Supercharge your job applications.";
      cardDesc.textContent = "Upload your resume to extract 28+ professional fields. All processing happens locally for complete privacy.";
    }
  }

  const deleteBtn = document.getElementById("delete-resume");
  if (deleteBtn) {
    if (filledFields > 0) {
      deleteBtn.classList.remove("hidden");
    } else {
      deleteBtn.classList.add("hidden");
    }
  }

  const cfg = await getProviderConfig();
  const specProvider = document.getElementById("spec-provider");
  const specModel = document.getElementById("spec-model");
  const specApi = document.getElementById("spec-api");
  if (specProvider) {
    specProvider.textContent = cfg.provider === "ollama" ? "OLLAMA (LOCAL)" : "EXTERNAL API";
  }
  if (specModel) {
    specModel.textContent = (cfg.provider === "ollama" ? cfg.ollamaModel : cfg.fallbackModel).toUpperCase();
  }
  if (specApi) {
    specApi.textContent = cfg.provider === "ollama" ? "SECURE (LOCAL)" : (cfg.apiKey ? "SET / SECURE" : "NOT SET");
    if (cfg.provider === "openai_compat" && !cfg.apiKey) {
      specApi.style.color = "#FF4444";
    } else {
      specApi.style.color = "";
    }
  }
}

function renderProfileView(profile) {
  const keys = Object.keys(profile);
  const container = $("profile-content");
  if (!container) return;

  container.textContent = "";

  if (!keys.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No profile yet. Select a file to begin.";
    container.appendChild(emptyState);
    updateProfileStats({});
    return;
  }

  keys.forEach(key => {
    const meta = FIELD_REGISTRY[key];
    const label = meta?.label || key;
    const val = profile[key] || "";

    const row = document.createElement("div");
    row.className = "profile-row";
    row.dataset.key = key;

    const labelSpan = document.createElement("span");
    labelSpan.className = "field-label";
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.className = "field-value";
    valueSpan.title = val;
    valueSpan.textContent = val.length > 60 ? val.slice(0, 57) + "…" : val;

    const btn = document.createElement("button");
    btn.className = "edit-btn";
    btn.dataset.key = key;
    btn.textContent = "[ EDIT ]";
    btn.onclick = () => openEditModal(key, val);

    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    row.appendChild(btn);
    container.appendChild(row);
  });

  updateProfileStats(profile);
}

function openEditModal(key, currentValue) {
  const meta = FIELD_REGISTRY[key];
  $("modal-label").textContent = meta?.label || key;
  $("modal-input").value = currentValue || "";
  $("modal-key").value = key;
  $("modal-overlay").classList.remove("hidden");
  $("modal-input").focus();
}

function closeModal() {
  $("modal-overlay").classList.add("hidden");
}

function showLearnBanner(key, value, fieldLabel) {
  const banner = document.createElement("div");
  banner.className = "learn-banner";

  const titleSpan = document.createElement("span");
  titleSpan.textContent = `💡 Learn "${fieldLabel}"?`;
  banner.appendChild(titleSpan);

  const valDiv = document.createElement("div");
  valDiv.className = "learn-val";
  valDiv.textContent = value.slice(0, 80) + (value.length > 80 ? "…" : "");
  banner.appendChild(valDiv);

  const btnsDiv = document.createElement("div");
  btnsDiv.className = "learn-btns";

  const btnYes = document.createElement("button");
  btnYes.className = "btn-yes";
  btnYes.textContent = "Save";
  btnYes.onclick = async () => {
    await updateProfile({ [key]: value });
    banner.remove();
    status("Learned: " + (FIELD_REGISTRY[key]?.label || key), "#FF8030");
    renderProfileView(await getProfile());
  };

  const btnNo = document.createElement("button");
  btnNo.className = "btn-no";
  btnNo.textContent = "Dismiss";
  btnNo.onclick = () => banner.remove();

  btnsDiv.appendChild(btnYes);
  btnsDiv.appendChild(btnNo);
  banner.appendChild(btnsDiv);

  const queue = $("learn-queue");
  if (queue) queue.prepend(banner);
}

async function renderAIPanel() {
  const profile = await getProfile();
  const container = $("ai-content");
  if (!container) return;

  if (!Object.keys(profile).length) {
    container.textContent = "";
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Upload your resume first.";
    container.appendChild(emptyState);
    return;
  }

  container.textContent = "";

  const aiForm = document.createElement("div");
  aiForm.className = "ai-form";

  const jobTitleInput = document.createElement("input");
  jobTitleInput.id = "ai-job-title";
  jobTitleInput.placeholder = "Job title (e.g. Frontend Engineer)";
  jobTitleInput.className = "ai-input";

  const companyInput = document.createElement("input");
  companyInput.id = "ai-company";
  companyInput.placeholder = "Company name (optional)";
  companyInput.className = "ai-input";

  aiForm.appendChild(jobTitleInput);
  aiForm.appendChild(companyInput);
  container.appendChild(aiForm);

  const fieldBtns = document.createElement("div");
  fieldBtns.className = "ai-field-btns";

  const resultArea = document.createElement("div");
  resultArea.id = "ai-result-area";
  resultArea.className = "ai-result hidden";

  AI_GENERATED_FIELDS.forEach(k => {
    const btn = document.createElement("button");
    btn.className = "ai-gen-btn";
    btn.textContent = (FIELD_REGISTRY[k]?.label || k).toUpperCase();
    btn.onclick = async () => {
      const jobTitle = jobTitleInput.value.trim();
      const company = companyInput.value.trim();

      resultArea.classList.remove("hidden");
      resultArea.textContent = "Generating…";
      btn.disabled = true;
      try {
        const text = await generateWithAI(k, profile, jobTitle, company);
        resultArea.textContent = "";

        const label = document.createElement("div");
        label.className = "result-label";
        label.textContent = FIELD_REGISTRY[k]?.label;

        const textDiv = document.createElement("div");
        textDiv.className = "result-text";
        textDiv.textContent = text;

        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
        };

        resultArea.appendChild(label);
        resultArea.appendChild(textDiv);
        resultArea.appendChild(copyBtn);
      } catch (err) {
        resultArea.textContent = "Error: " + err.message;
      }
      btn.disabled = false;
    };
    fieldBtns.appendChild(btn);
  });

  container.appendChild(fieldBtns);
  container.appendChild(resultArea);
}

async function renderSettings() {
  const cfg = await getProviderConfig();
  const container = $("settings-content");
  if (!container) return;

  container.textContent = "";

  const section1 = document.createElement("div");
  section1.className = "settings-section";

  const title1 = document.createElement("div");
  title1.className = "settings-section-title";
  title1.textContent = "AI Provider";
  section1.appendChild(title1);

  const toggle = document.createElement("div");
  toggle.className = "provider-toggle";

  const btnOllama = document.createElement("button");
  btnOllama.className = "provider-btn" + (cfg.provider === "ollama" ? " active" : "");
  btnOllama.textContent = "Ollama (Local)";

  const btnExt = document.createElement("button");
  btnExt.className = "provider-btn" + (cfg.provider === "openai_compat" ? " active" : "");
  btnExt.textContent = "External API";

  toggle.appendChild(btnOllama);
  toggle.appendChild(btnExt);
  section1.appendChild(toggle);

  const ollamaDiv = document.createElement("div");
  ollamaDiv.className = cfg.provider !== "ollama" ? "hidden" : "";

  const badgePrivacy = document.createElement("div");
  badgePrivacy.className = "privacy-badge";
  badgePrivacy.textContent = "✦ Your data never leaves your device";
  ollamaDiv.appendChild(badgePrivacy);

  const labelUrl = document.createElement("label");
  labelUrl.className = "settings-label";
  labelUrl.textContent = "Ollama URL";
  ollamaDiv.appendChild(labelUrl);

  const inputUrl = document.createElement("input");
  inputUrl.id = "ollama-url";
  inputUrl.className = "ai-input";
  inputUrl.value = cfg.ollamaUrl;
  inputUrl.placeholder = "http://localhost:11434";
  ollamaDiv.appendChild(inputUrl);

  const labelModel = document.createElement("label");
  labelModel.className = "settings-label";
  labelModel.textContent = "Model";
  ollamaDiv.appendChild(labelModel);

  const inputModel = document.createElement("input");
  inputModel.id = "ollama-model";
  inputModel.className = "ai-input";
  inputModel.value = cfg.ollamaModel;
  inputModel.placeholder = "llama3.2";
  ollamaDiv.appendChild(inputModel);

  const hintOllama = document.createElement("div");
  hintOllama.className = "settings-hint";
  hintOllama.textContent = "Install: brew install ollama or ollama.com\nPull model: ollama pull llama3.2\nStart: ollama serve";
  ollamaDiv.appendChild(hintOllama);

  const testBtn = document.createElement("button");
  testBtn.id = "test-ollama-btn";
  testBtn.className = "pill-btn secondary";
  testBtn.style.marginTop = "12px";
  testBtn.style.width = "100%";
  testBtn.textContent = "Test Connection";
  ollamaDiv.appendChild(testBtn);

  const testResult = document.createElement("div");
  testResult.id = "ollama-test-result";
  testResult.style.fontSize = "11px";
  testResult.style.marginTop = "8px";
  testResult.style.fontWeight = "700";
  ollamaDiv.appendChild(testResult);

  section1.appendChild(ollamaDiv);

  const extDiv = document.createElement("div");
  extDiv.className = cfg.provider !== "openai_compat" ? "hidden" : "";

  const badgeWarn = document.createElement("div");
  badgeWarn.className = "privacy-badge warn";
  badgeWarn.textContent = "⚠ Profile data will be sent externally";
  extDiv.appendChild(badgeWarn);

  const labelFallbackUrl = document.createElement("label");
  labelFallbackUrl.className = "settings-label";
  labelFallbackUrl.textContent = "Base URL";
  extDiv.appendChild(labelFallbackUrl);

  const inputFallbackUrl = document.createElement("input");
  inputFallbackUrl.id = "fallback-url";
  inputFallbackUrl.className = "ai-input";
  inputFallbackUrl.value = cfg.fallbackUrl;
  inputFallbackUrl.placeholder = "https://api.groq.com/openai/v1";
  extDiv.appendChild(inputFallbackUrl);

  const labelFallbackModel = document.createElement("label");
  labelFallbackModel.className = "settings-label";
  labelFallbackModel.textContent = "Model";
  extDiv.appendChild(labelFallbackModel);

  const inputFallbackModel = document.createElement("input");
  inputFallbackModel.id = "fallback-model";
  inputFallbackModel.className = "ai-input";
  inputFallbackModel.value = cfg.fallbackModel;
  inputFallbackModel.placeholder = "llama-3.1-8b-instant";
  extDiv.appendChild(inputFallbackModel);

  const labelApiKey = document.createElement("label");
  labelApiKey.className = "settings-label";
  labelApiKey.textContent = "API Key";
  extDiv.appendChild(labelApiKey);

  const inputApiKey = document.createElement("input");
  inputApiKey.id = "ext-api-key";
  inputApiKey.type = "password";
  inputApiKey.className = "ai-input";
  inputApiKey.value = cfg.apiKey;
  inputApiKey.placeholder = "sk-...";
  extDiv.appendChild(inputApiKey);

  const hintExt = document.createElement("div");
  hintExt.className = "settings-hint";
  hintExt.textContent = "Works with: Groq · OpenRouter · Together · OpenAI · any OpenAI-compatible endpoint.";
  extDiv.appendChild(hintExt);

  section1.appendChild(extDiv);

  const saveBtn = document.createElement("button");
  saveBtn.id = "save-provider-btn";
  saveBtn.className = "pill-btn primary";
  saveBtn.style.marginTop = "16px";
  saveBtn.style.width = "100%";
  saveBtn.textContent = "Save Settings";
  section1.appendChild(saveBtn);

  container.appendChild(section1);

  const hr = document.createElement("hr");
  hr.className = "divider";
  container.appendChild(hr);

  const section2 = document.createElement("div");
  section2.className = "settings-section";

  const title2 = document.createElement("div");
  title2.className = "settings-section-title";
  title2.textContent = "Profile Data";
  section2.appendChild(title2);

  const flexDiv = document.createElement("div");
  flexDiv.style.display = "flex";
  flexDiv.style.gap = "10px";

  const exportBtn = document.createElement("button");
  exportBtn.id = "export-profile-btn";
  exportBtn.className = "pill-btn secondary";
  exportBtn.style.flex = "1";
  exportBtn.textContent = "Export JSON";

  const nukeBtn = document.createElement("button");
  nukeBtn.id = "nuke-btn";
  nukeBtn.className = "pill-btn danger";
  nukeBtn.style.flex = "1";
  nukeBtn.textContent = "Delete All";

  flexDiv.appendChild(exportBtn);
  flexDiv.appendChild(nukeBtn);
  section2.appendChild(flexDiv);

  container.appendChild(section2);

  btnOllama.onclick = () => {
    btnOllama.classList.add("active");
    btnExt.classList.remove("active");
    ollamaDiv.classList.remove("hidden");
    extDiv.classList.add("hidden");
  };

  btnExt.onclick = () => {
    btnOllama.classList.remove("active");
    btnExt.classList.add("active");
    ollamaDiv.classList.add("hidden");
    extDiv.classList.remove("hidden");
  };

  testBtn.onclick = async () => {
    const url = inputUrl.value.trim() || "http://localhost:11434";
    testResult.textContent = "Testing…";
    testResult.style.color = "#888888";
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const models = data.models?.map(m => m.name).join(", ") || "none";
        testResult.textContent = `✓ Connected. Models: ${models}`;
        testResult.style.color = "#FF8030";
      } else {
        testResult.textContent = `✗ HTTP ${res.status}`;
        testResult.style.color = "#FF4444";
      }
    } catch {
      testResult.textContent = "✗ Can't reach Ollama. Is it running? (ollama serve)";
      testResult.style.color = "#FF4444";
    }
  };

  saveBtn.onclick = async () => {
    const activeProv = btnOllama.classList.contains("active") ? "ollama" : "openai_compat";
    const newCfg = {
      provider: activeProv,
      ollamaUrl: inputUrl.value.trim() || DEFAULT_CONFIG.ollamaUrl,
      ollamaModel: inputModel.value.trim() || DEFAULT_CONFIG.ollamaModel,
      fallbackUrl: inputFallbackUrl.value.trim() || DEFAULT_CONFIG.fallbackUrl,
      fallbackModel: inputFallbackModel.value.trim() || DEFAULT_CONFIG.fallbackModel,
      apiKey: inputApiKey.value.trim() || "",
    };
    await setProviderConfig(newCfg);
    status("Settings saved.", "#FF8030");
    await updateProfileStats(await getProfile());
    switchTab("tab-profile");
  };

  exportBtn.onclick = async () => {
    const profile = await getProfile();
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "feelcv-profile.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  nukeBtn.onclick = async () => {
    if (!confirm("Delete your entire profile and settings?")) return;
    await chrome.storage.local.clear();
    status("All data deleted.", "#FF4444");
    renderProfileView({});
  };
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    if (b.dataset.tab === tabId) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });
  document.querySelectorAll(".tab-pane").forEach(p => {
    if (p.id === tabId) {
      p.classList.add("active");
    } else {
      p.classList.remove("active");
    }
  });
  if (tabId === "tab-ai") renderAIPanel();
  if (tabId === "tab-settings") renderSettings();
}

async function parseResumeWithAI(resumeText) {
  const cfg = await getProviderConfig();
  const prompt = `You are a professional resume parser. Extract structured details from the following resume text.
Format the output STRICTLY as a JSON object with the following keys. Do NOT wrap the JSON inside markdown code blocks (like \`\`\`json) and do not provide any explanation, preamble, or trailing text. Output ONLY the JSON string.

Expected JSON Keys:
- full_name
- first_name
- last_name
- location
- headline
- years_experience
- current_company
- current_role
- work_history
- degree
- university
- graduation_year
- major
- skills
- languages

Resume text:
${resumeText}`;

  let responseText = "";
  if (cfg.provider === "ollama") {
    responseText = await callOllama(prompt, cfg);
  } else if (cfg.provider === "openai_compat") {
    responseText = await callOpenAICompat(prompt, cfg);
  } else {
    throw new Error("No AI provider configured");
  }

  let jsonText = responseText.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  }
  const startIdx = jsonText.indexOf("{");
  const endIdx = jsonText.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1) {
    jsonText = jsonText.slice(startIdx, endIdx + 1);
  }
  return JSON.parse(jsonText);
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      switchTab(btn.dataset.tab);
    };
  });
}

async function init() {
  initTabs();

  const profile = await getProfile();
  renderProfileView(profile);

  const fileInput = document.getElementById("resume-upload");
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      status("Reading file…");
      try {
        const text = await extractTextFromFile(file);
        
        // Phase 1: Instant regex parsing for basic/contact info
        const parsedRegex = parseResumeText(text);
        let merged = { ...parsedRegex };
        
        // Save initial regex parsing immediately so the UI updates fast
        const current = await getProfile();
        merged = { ...merged, ...Object.fromEntries(Object.entries(current).filter(([, v]) => v)) };
        await setProfile(merged);
        await chrome.storage.local.set({ fcv_filename: file.name });
        await renderProfileView(merged);
        status("Basic profile extracted locally. Connect AI for deeper enrichment.", "#FF8030");

        // Phase 2: Asynchronous AI Enrichment (optional)
        try {
          const cfg = await getProviderConfig();
          const isOllama = cfg.provider === "ollama";
          const hasApiKey = cfg.provider === "openai_compat" && cfg.apiKey;
          
          if (isOllama || hasApiKey) {
            status("Enriching profile with AI…");
            const parsedAI = await parseResumeWithAI(text);

            // ── Validate AI output against FIELD_REGISTRY ─────────────────
            // Accept only known keys, non-empty string values, skip nulls/objects.
            const cleanedAI = {};
            if (parsedAI && typeof parsedAI === "object") {
              for (const key of Object.keys(parsedAI)) {
                if (!FIELD_REGISTRY[key]) continue; // unknown field — ignore
                const val = parsedAI[key];
                if (!val || typeof val !== "string" && typeof val !== "number") continue;
                const strVal = String(val).trim();
                if (strVal.length === 0 || strVal.toLowerCase() === "null" || strVal.toLowerCase() === "n/a") continue;
                cleanedAI[key] = strVal;
              }
            }

            // ── Merge: never overwrite reliable contact fields ────────────
            const currentProfile = await getProfile();
            const PROTECTED_KEYS = new Set(["email", "phone", "linkedin", "github", "portfolio"]);
            const finalProfile = { ...currentProfile };

            for (const key of Object.keys(cleanedAI)) {
              // Only write AI value if the field is not protected, or if we
              // don't already have a value for it.
              if (!PROTECTED_KEYS.has(key) || !finalProfile[key]) {
                finalProfile[key] = cleanedAI[key];
              }
            }

            await setProfile(finalProfile);
            await renderProfileView(finalProfile);
            status("Profile fully enriched with AI!", "#FF8030");
          } else {
            status("Basic profile extracted locally. Connect AI for deeper enrichment.", "#FFCC00");
          }
        } catch (aiErr) {
          console.error("AI enrichment failed:", aiErr);
          status("Basic profile extracted locally. Connect AI for deeper enrichment.", "#FF8030");
        }

        fileInput.value = "";
      } catch (err) {
        status("Parse error: " + err.message, "#FF4444");
        fileInput.value = "";
      }
    };
  }

  const autofillBtn = document.getElementById("autofill-btn");
  if (autofillBtn) {
    autofillBtn.onclick = async () => {
      const profileData = await getProfile();
      if (!Object.keys(profileData).length) {
        status("No profile. Upload resume first.", "#FF4444");
        return;
      }
      chrome.runtime.sendMessage({ type: "TRIGGER_AUTOFILL", profile: profileData });
      status("Autofilling…");
    };
  }

  const deleteBtn = document.getElementById("delete-resume");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm("Delete your profile?")) return;
      await chrome.storage.local.remove(["fcv_profile", "fcv_filename"]);
      renderProfileView({});
      status("Profile deleted.", "#FF4444");
    };
  }

  const modalSave = document.getElementById("modal-save");
  const modalClose = document.getElementById("modal-close");
  const modalOverlay = document.getElementById("modal-overlay");

  if (modalSave) {
    modalSave.onclick = async () => {
      const key = document.getElementById("modal-key")?.value;
      const val = document.getElementById("modal-input")?.value.trim() || "";
      if (!key) return;
      await updateProfile({ [key]: val });
      closeModal();
      renderProfileView(await getProfile());
      status("Updated.", "#FF8030");
    };
  }

  if (modalClose) modalClose.onclick = closeModal;
  if (modalOverlay) {
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
  }

  const welcomeStartBtn = document.getElementById("welcome-start-btn");
  if (welcomeStartBtn) {
    welcomeStartBtn.onclick = async () => {
      const welcomeScreen = document.getElementById("welcome-screen");
      if (welcomeScreen) welcomeScreen.classList.add("hidden");
      await chrome.storage.local.set({ fcv_welcome_dismissed: true });
    };
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_FIELD_LEARNED") {
      showLearnBanner(msg.key, msg.value, msg.fieldLabel);
    }
    if (msg.type === "AUTOFILL_DONE") {
      status(`Filled ${msg.filled}/${msg.total} fields.`, "#FF8030");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);