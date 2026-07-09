// resume_parser.js — section-aware resume extraction. Loaded before popup.js
// in popup.html; both are classic scripts sharing one global scope.
// Builds a structured resume object, then derives the flat profile that
// field_registry.js/content.js autofill against.

"use strict";

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

const HEADING_TOKEN = SECTION_HEADINGS
  .map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length) // longest first so "work experience" wins over "experience"
  .join("|");

// A heading line may combine multiple known headings with a connector,
// e.g. "Certifications & Awards" or "Awards and Honors".
const HEADING_LINE_RE = new RegExp(
  `^(?:${HEADING_TOKEN})(?:\\s*(?:&|and|\\/|,)\\s*(?:${HEADING_TOKEN}))*[:\\s]*$`,
  "i"
);

function normalizeResumeText(text) {
  // Collapse 3+ consecutive spaces → single space
  text = text.replace(/ {3,}/g, " ");

  // Fix soft/wrapped hyphenation: "im- prove" → "improve"
  text = text.replace(/-\s+([a-z])/g, "$1");

  // Insert newline before common section headings that may appear mid-line
  // because PDF text extraction collapsed a heading into the previous line.
  // The negative lookahead excludes cases like "AWS Certification, Inc." where
  // the heading word is just ordinary prose immediately followed by a comma —
  // a real section heading is never followed directly by one.
  const MIDLINE_HEADING_RE = new RegExp(
    `(?<=[\\w,;.])\\s+((?:Work\\s+)?Experience|Projects?|(?:Technical\\s+)?Skills|Education|Certifications?|Awards?|Achievements?|Summary|Profile|Objective|Publications?|Volunteer(?:ing)?|Interests?|References?|Languages?|Courses?|Honou?rs?|Activities)(?!\\s*,)`,
    "gi"
  );
  text = text.replace(MIDLINE_HEADING_RE, "\n$1");

  return text.trim();
}

// Returns an array of { heading, lines }; lines before the first heading go under "header".
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

// Not anchored to the start, so combined headings like "Certifications & Awards" still match.
function findSection(sections, re) {
  return sections.find(s => re.test(s.heading));
}

function extractContactInfo(text) {
  const info = {};

  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailM) info.email = emailM[0];

  const phoneM = text.match(/(\+?[\d][\d\s\-().]{6,18}[\d])/);
  if (phoneM) {
    const digits = phoneM[1].replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) info.phone = phoneM[1].trim();
  }

  const liM = text.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  if (liM) info.linkedin = "https://linkedin.com/in/" + liM[1];

  const ghM = text.match(/github\.com\/([a-zA-Z0-9\-_%]+)/i);
  if (ghM) info.github = "https://github.com/" + ghM[1];

  const portM = text.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.)([a-zA-Z0-9\-_.]+\.[a-zA-Z]{2,}[^\s]*)/i);
  if (portM) info.portfolio = portM[0];

  return info;
}

function extractName(lines) {
  const NAME_RE = /^([A-Z][a-zA-Z'-]+)(\s[A-Z][a-zA-Z'-]+){1,4}$/;
  const ALLCAPS_RE = /^([A-Z]{2,})(\s[A-Z]{2,}){1,4}$/;

  for (const line of lines.slice(0, 8)) {
    if (line.includes("@") || line.includes("http") || /^\d/.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    if (/[|•·,;@]/.test(line) && line.split(/[|•·,;@]/).length > 2) continue;
    const words = line.trim().split(/\s+/);
    if (words.length === 1 && words[0] === words[0].toUpperCase()) continue;

    if (NAME_RE.test(line) || ALLCAPS_RE.test(line)) return line.trim();
  }
  return null;
}

function extractSummary(sections) {
  const summarySection = findSection(sections, /summary|profile|objective/);
  if (summarySection && summarySection.lines.length) {
    return summarySection.lines.slice(0, 5).join(" ");
  }
  return null;
}

const DATE_RANGE_RE = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s)?\d{4}\s*[–—\-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:\d{4}|present|current|now|ongoing)/i;
const ROLE_KEYWORDS_RE = /\b(?:engineer|developer|analyst|manager|designer|scientist|architect|lead|consultant|specialist|coordinator|officer|director|associate|intern|researcher|executive|head|vp|cto|ceo|founder|staff|senior|junior|principal|full.?stack|front.?end|back.?end|devops|data|ml|ai|software|product|project|program|qa|sre|cloud|mobile|embedded|platform)\b/i;
const BULLET_LINE_RE = /^[•\-*▪◦‣›»]\s*/;

const MONTH_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function toDate(str) {
  if (!str) return null;
  if (/present|current|now|ongoing/i.test(str)) return new Date();
  const m = str.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/i);
  if (m && MONTH_MAP[m[1].toLowerCase()] !== undefined) {
    return new Date(parseInt(m[2], 10), MONTH_MAP[m[1].toLowerCase()], 1);
  }
  const y = str.match(/\b(19|20)\d{2}\b/);
  if (y) return new Date(parseInt(y[0], 10), 0, 1);
  return null;
}

function parseDateRange(rangeStr) {
  if (!rangeStr) return { start_date: "", end_date: "" };
  const m = rangeStr.match(/^(.*?)\s*[–—-]\s*(.*)$/);
  if (!m) return { start_date: rangeStr.trim(), end_date: "" };
  return { start_date: m[1].trim(), end_date: m[2].trim() };
}

function formatDuration(start_date, end_date) {
  const s = toDate(start_date);
  const e = toDate(end_date);
  if (!s || !e) return "";
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (months < 0) return "";
  const yrs = Math.floor(months / 12), mos = months % 12;
  const parts = [];
  if (yrs) parts.push(`${yrs} yr${yrs > 1 ? "s" : ""}`);
  if (mos) parts.push(`${mos} mo${mos > 1 ? "s" : ""}`);
  return parts.join(" ") || "< 1 mo";
}

// Splits a same-line "Company · Domain · Role" remainder (date already
// stripped out) into { company, domain, role }.
function splitExperienceRemainder(remainder) {
  const parts = remainder.split(/\s*[·•|]\s*|\s+[–—]\s+/).map(p => p.trim()).filter(Boolean);
  let company = "", role = "", domain = "";

  if (parts.length === 1) {
    if (ROLE_KEYWORDS_RE.test(parts[0])) role = parts[0]; else company = parts[0];
  } else if (parts.length === 2) {
    const [a, b] = parts;
    if (ROLE_KEYWORDS_RE.test(b) && !ROLE_KEYWORDS_RE.test(a)) { company = a; role = b; }
    else if (ROLE_KEYWORDS_RE.test(a) && !ROLE_KEYWORDS_RE.test(b)) { role = a; company = b; }
    else { company = a; role = b; }
  } else {
    company = parts[0];
    role = parts[parts.length - 1];
    domain = parts.slice(1, -1).join(" · ");
    if (!ROLE_KEYWORDS_RE.test(role) && ROLE_KEYWORDS_RE.test(company)) {
      [company, role] = [role, company];
    }
  }
  return { company, role, domain };
}

// Handles both the "3-line" layout (company / role / date on separate lines)
// and the "1-line" layout (company · role · date together), plus bullets.
function extractExperienceEntries(sectionLines) {
  const anchors = [];
  sectionLines.forEach((line, idx) => { if (DATE_RANGE_RE.test(line)) anchors.push(idx); });
  if (!anchors.length) return [];

  const rawEntries = [];

  for (let a = 0; a < anchors.length; a++) {
    const idx = anchors[a];
    const line = sectionLines[idx];
    const dateMatch = line.match(DATE_RANGE_RE)[0];
    const remainder = line
      .replace(dateMatch, "")
      .replace(/^[-–—·|,\s]+/, "")
      .replace(/[-–—·|,\s]+$/, "")
      .trim();

    let company = "", role = "", domain = "";
    const consumed = new Set([idx]);

    if (remainder.length > 1) {
      // 1-line layout: company/role/domain live in the same line as the date.
      ({ company, role, domain } = splitExperienceRemainder(remainder));
    } else {
      // 3-line layout: look at adjacent lines, skipping ones that are
      // themselves date anchors for other entries.
      const candidates = [
        { i: idx - 2, text: sectionLines[idx - 2] || "" },
        { i: idx - 1, text: sectionLines[idx - 1] || "" },
        { i: idx + 1, text: sectionLines[idx + 1] || "" },
      ].filter(c => c.text && !DATE_RANGE_RE.test(c.text) && c.text.length > 1 && c.text.length < 80);

      for (const c of candidates) {
        if (!role && ROLE_KEYWORDS_RE.test(c.text)) { role = c.text.trim(); consumed.add(c.i); }
        else if (!company && c.text.trim() !== role) { company = c.text.trim(); consumed.add(c.i); }
      }
      if (!role && !company && sectionLines[idx - 1]) {
        company = sectionLines[idx - 1].trim();
        consumed.add(idx - 1);
      }
    }

    const nextAnchorIdx = anchors[a + 1] !== undefined ? anchors[a + 1] : sectionLines.length;
    const bulletStart = Math.max(idx, ...consumed) + 1;
    const bullets = [];
    for (let j = bulletStart; j < nextAnchorIdx; j++) {
      const raw = sectionLines[j] || "";
      if (!raw) continue;
      if (BULLET_LINE_RE.test(raw)) {
        bullets.push(raw.replace(BULLET_LINE_RE, "").trim());
      } else if (bullets.length && !/[.!?:]$/.test(bullets[bullets.length - 1])) {
        // Word-wrapped continuation of the previous bullet line.
        bullets[bullets.length - 1] = (bullets[bullets.length - 1] + " " + raw.trim()).trim();
      } else {
        bullets.push(raw.trim());
      }
    }

    if (company || role || bullets.length) {
      rawEntries.push({ company, role, domain, dateRange: dateMatch, bullets });
    }
  }

  return rawEntries.map(e => {
    const { start_date, end_date } = parseDateRange(e.dateRange);
    return {
      company: e.company,
      role: e.role,
      domain: e.domain,
      start_date,
      end_date,
      duration: formatDuration(start_date, end_date),
      bullets: e.bullets,
    };
  });
}

function parseProjectAnchor(raw, bullets) {
  const links = raw.match(/https?:\/\/[^\s)]+|\bgithub\.com\/[^\s)]+/gi) || [];
  const text = raw.replace(/\((?:github|gitlab|demo|live|link)\)/ig, "").trim();

  const parts = text.split(/\s+[–—-]\s+/).map(p => p.trim()).filter(Boolean);
  const name = parts[0] || text;
  let stack = "", description = "";

  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const looksLikeStack = last.split(",").length >= 2 && last.length < 100 && !/[.]\s/.test(last);
    if (looksLikeStack) {
      stack = last;
      description = parts.slice(1, -1).join(" – ");
    } else {
      description = parts.slice(1).join(" – ");
    }
  }

  if (!name) return null;
  return { name, stack, description, bullets, links };
}

const SENTENCE_END_RE = /[.!?:]$/;

/**
 * Parse project entries from a projects section's lines. A bullet-marked
 * line starts a new bullet; a plain line starts a new project UNLESS the
 * previous line didn't end with sentence-terminal punctuation, in which
 * case it's a word-wrapped continuation of that previous line (title or
 * bullet) rather than a new project.
 */
function extractProjects(sectionLines) {
  const rawProjects = [];
  let current = null;
  let prevEndedSentence = true;

  for (const line of sectionLines) {
    if (BULLET_LINE_RE.test(line)) {
      const cleaned = line.replace(BULLET_LINE_RE, "").trim();
      if (current) current.bullets.push(cleaned);
      prevEndedSentence = SENTENCE_END_RE.test(cleaned);
      continue;
    }

    if (current && !prevEndedSentence) {
      // Word-wrapped continuation of the previous bullet or title line.
      if (current.bullets.length) {
        const idx = current.bullets.length - 1;
        current.bullets[idx] = (current.bullets[idx] + " " + line).trim();
      } else {
        current.raw = (current.raw + " " + line).trim();
      }
      prevEndedSentence = SENTENCE_END_RE.test(line);
      continue;
    }

    if (current) rawProjects.push(current);
    current = { raw: line, bullets: [] };
    prevEndedSentence = SENTENCE_END_RE.test(line);
  }
  if (current) rawProjects.push(current);

  return rawProjects.map(p => parseProjectAnchor(p.raw, p.bullets)).filter(Boolean);
}

const SKILL_CATEGORY_PATTERNS = [
  ["languages", /language/i],
  ["ml_ai", /\bml\b|\bai\b|machine learning|artificial intelligence/i],
  ["data", /\bdata\b|database/i],
  ["cloud_tools", /cloud|devops|platform|\btools?\b/i],
  ["frameworks", /framework|librar(?:y|ies)/i],
];

const LANG_NAMES = [
  "python", "javascript", "typescript", "java", "kotlin", "swift", "c", "c++", "c#",
  "go", "golang", "rust", "ruby", "php", "scala", "r", "matlab", "perl", "bash",
  "shell", "sql", "nosql", "html", "css", "dart", "elixir", "haskell", "lua",
  "groovy", "assembly", "cobol", "fortran", "vba", "powershell", "julia"
];

function categorizeSkillLabel(label) {
  for (const [cat, re] of SKILL_CATEGORY_PATTERNS) if (re.test(label)) return cat;
  return "other";
}

/** Split on common delimiters, but not inside parentheses (e.g. "AWS (EC2, S3)" stays one token). */
function splitSkillTokens(str) {
  const parts = [];
  let depth = 0, buf = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,|•·;–—]/.test(ch)) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);
  return parts.map(p => p.trim()).filter(p => p.length > 0 && p.length < 60);
}

// Prefers "Label: items" lines (e.g. "ML/AI: TensorFlow, PyTorch"); falls
// back to a flat token list under "other" when no labeled lines exist.
function extractSkillGroups(sectionLines) {
  const groups = { languages: [], frameworks: [], ml_ai: [], data: [], cloud_tools: [], other: [] };
  const LABEL_RE = /^([A-Za-z][A-Za-z /&+]{1,40}):\s*(.+)$/;
  let labeledCount = 0;

  for (const line of sectionLines) {
    const m = line.match(LABEL_RE);
    if (m) {
      labeledCount++;
      const cat = categorizeSkillLabel(m[1]);
      groups[cat].push(...splitSkillTokens(m[2]));
    }
  }

  if (labeledCount === 0) {
    const flat = [];
    for (const line of sectionLines) flat.push(...splitSkillTokens(line));
    groups.other = [...new Set(flat)];
  } else {
    for (const cat of Object.keys(groups)) groups[cat] = [...new Set(groups[cat])];
  }

  // Always populate languages from known language names even if the
  // skills section wasn't explicitly labeled per-category.
  if (!groups.languages.length) {
    const allTokens = Object.values(groups).flat().join(" ").toLowerCase();
    const found = LANG_NAMES.filter(l => new RegExp(`\\b${l.replace("+", "\\+")}\\b`, "i").test(allTokens));
    if (found.length) groups.languages = found;
  }

  return groups;
}

const DEGREE_RE = /\b(?:bachelor|master|doctor|phd|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|b\.?com|mba|diploma|associate|a\.?s\.?|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|llb|llm|md|dds|jd|honours?)\b/i;
const INST_RE = /\b(?:university|college|institute|school|academy|polytechnic|iit|nit|bits|mit|stanford|oxford|cambridge|iisc|iim)\b/i;
const MAJOR_RE = /\b(?:computer science|information technology|software engineering|electrical|mechanical|civil|chemical|data science|artificial intelligence|machine learning|mathematics|physics|biology|finance|economics|management|business|commerce|law|medicine|nursing|psychology|sociology)\b/i;
const GPA_RE = /\bgpa\b[:\s]*([\d.]+\s*(?:\/\s*[\d.]+)?)/i;
const YEAR_RE = /\b(19|20)\d{2}\b/g;

/** Strip trailing GPA/date noise from an institution or degree line so it stays a clean name. */
function stripDateAndGpaNoise(line) {
  return line
    .replace(GPA_RE, "")
    .replace(/\bexpected\b/i, "")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,:\-–—]+$/, "")
    .trim();
}

function extractEducationEntries(sectionLines) {
  const entries = [];
  let current = null;

  const startNew = () => {
    current = { institution: "", degree: "", major: "", start_date: "", end_date: "", graduation_year: "", gpa: "" };
    entries.push(current);
  };

  for (const line of sectionLines) {
    if (line.length >= 120) continue;
    const isInst = INST_RE.test(line);
    const isDegree = DEGREE_RE.test(line);

    if (isInst) {
      if (current && current.institution) startNew();
      if (!current) startNew();
      current.institution = stripDateAndGpaNoise(line) || line.trim();
    }
    if (!current) startNew();
    if (isDegree && !current.degree) current.degree = stripDateAndGpaNoise(line) || line.trim();

    const majorM = line.match(MAJOR_RE);
    if (majorM && !current.major) current.major = stripDateAndGpaNoise(line) || line.trim();

    const gpaM = line.match(GPA_RE);
    if (gpaM && !current.gpa) current.gpa = gpaM[1];

    const years = line.match(YEAR_RE);
    if (years && years.length) {
      if (years.length >= 2) {
        current.start_date = current.start_date || years[0];
        current.end_date = years[years.length - 1];
      } else if (!current.end_date) {
        current.end_date = years[0];
      }
      current.graduation_year = current.graduation_year || years[years.length - 1];
    }
  }

  return entries.filter(e => e.institution || e.degree);
}

function extractListItems(sectionLines) {
  return sectionLines.map(l => l.replace(BULLET_LINE_RE, "").trim()).filter(Boolean);
}

const CERT_ITEM_RE = /certifi|certificate|license|credential/i;
const AWARD_ITEM_RE = /\baward|honou?r|runner-?up|winner|medal|scholarship|top\s+\d+(?:st|nd|rd|th)?\s*percentile|\b1st\b|\b2nd\b|\b3rd\b/i;

// Used when "Certifications & Awards" is one combined section, so items get
// classified instead of duplicated into both arrays.
function classifyCertAwardItems(items) {
  const certifications = [], awards = [];
  for (const item of items) {
    if (AWARD_ITEM_RE.test(item) && !CERT_ITEM_RE.test(item)) awards.push(item);
    else certifications.push(item);
  }
  return { certifications, awards };
}

function buildStructuredProfile(text) {
  const profile = {
    full_name: "", first_name: "", last_name: "",
    email: "", phone: "", location: "",
    linkedin: "", github: "", portfolio: "",
    summary: "", headline: "", years_experience: "",
    experience: [], projects: [],
    skills: { languages: [], frameworks: [], ml_ai: [], data: [], cloud_tools: [], other: [] },
    education: [], certifications: [], awards: [], achievements: [],
  };

  Object.assign(profile, extractContactInfo(text));

  const sections = splitResumeSections(text);
  const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const name = extractName(allLines);
  if (name) {
    profile.full_name = name;
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      profile.first_name = parts[0];
      profile.last_name = parts[parts.length - 1];
    }
  }

  const headerSection = sections.find(s => s.heading === "header");
  const headerLines = headerSection ? headerSection.lines : [];
  const locText = headerLines.slice(0, 10).join(" ") + " " + allLines.slice(0, 10).join(" ");
  const locM = locText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\b/);
  if (locM) profile.location = locM[0];

  const summary = extractSummary(sections);
  if (summary) profile.summary = summary;

  const expSection = findSection(sections, /experience|employment|internship/);
  if (expSection) profile.experience = extractExperienceEntries(expSection.lines);

  const projSection = findSection(sections, /projects?/);
  if (projSection) profile.projects = extractProjects(projSection.lines);

  const skillsSection = findSection(sections, /skills?|competencies|technologies/);
  if (skillsSection && skillsSection.lines.length) profile.skills = extractSkillGroups(skillsSection.lines);

  const eduSection = findSection(sections, /education|academic/);
  if (eduSection) profile.education = extractEducationEntries(eduSection.lines);

  const certSection = findSection(sections, /certifications?|certificates?|licenses?/);
  const awardsSection = findSection(sections, /awards?|honou?rs?|achievements?/);

  if (certSection && awardsSection && certSection === awardsSection) {
    const { certifications, awards } = classifyCertAwardItems(extractListItems(certSection.lines));
    profile.certifications = certifications;
    profile.awards = awards;
  } else {
    if (certSection) profile.certifications = extractListItems(certSection.lines);
    if (awardsSection) profile.awards = extractListItems(awardsSection.lines);
  }

  const yoeM = text.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  if (yoeM) profile.years_experience = yoeM[1] + "+ years";

  return profile;
}

const DEGREE_RANK = {
  phd: 6, doctor: 6, md: 6,
  master: 5, mtech: 5, ms: 5, msc: 5, mba: 5, ma: 5,
  bachelor: 4, btech: 4, be: 4, bsc: 4, ba: 4,
  diploma: 2, associate: 1,
};

// Word-boundary match (not plain substring) so short keys like "ma"/"ba"
// don't false-positive on unrelated words such as "Mass Communication".
function rankDegree(entry) {
  const d = (entry.degree || "").toLowerCase().replace(/\./g, "");
  let best = 3;
  for (const [k, v] of Object.entries(DEGREE_RANK)) {
    if (v > best && new RegExp(`\\b${k}\\b`).test(d)) best = v;
  }
  return best;
}

function pickStrongestEducation(education) {
  if (!education || !education.length) return null;
  return [...education].sort((a, b) => {
    const r = rankDegree(b) - rankDegree(a);
    if (r !== 0) return r;
    return (parseInt(b.graduation_year, 10) || 0) - (parseInt(a.graduation_year, 10) || 0);
  })[0];
}

function parseYear(str) {
  if (!str) return null;
  if (/present|current|now|ongoing/i.test(str)) return new Date().getFullYear();
  const m = String(str).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function deriveFlatProfile(structured) {
  const flat = {};
  const passthrough = ["full_name", "first_name", "last_name", "email", "phone", "location", "linkedin", "github", "portfolio", "summary"];
  for (const k of passthrough) if (structured[k]) flat[k] = structured[k];

  const exp = structured.experience || [];
  if (exp.length) {
    if (exp[0].company) flat.current_company = exp[0].company;
    if (exp[0].role) flat.current_role = exp[0].role;

    flat.work_history = exp.map(e => {
      const head = [e.role, e.company, e.domain].filter(Boolean).join(" · ");
      const dates = [e.start_date, e.end_date].filter(Boolean).join(" – ");
      const bulletText = (e.bullets || []).slice(0, 3).join("; ");
      return [head, dates, bulletText].filter(Boolean).join(" — ");
    }).filter(Boolean).join(" | ");
  }

  const proj = structured.projects || [];
  if (proj.length) {
    flat.projects = proj.map(p => {
      const head = [p.name, p.stack ? `(${p.stack})` : ""].filter(Boolean).join(" ");
      return [head, p.description].filter(Boolean).join(" — ");
    }).filter(Boolean).join(" | ");
  }

  const skillGroups = structured.skills || {};
  const allSkills = [...new Set(Object.values(skillGroups).flat())].filter(Boolean);
  if (allSkills.length) flat.skills = allSkills.join(", ");
  if ((skillGroups.languages || []).length) flat.languages = skillGroups.languages.join(", ");

  const best = pickStrongestEducation(structured.education);
  if (best) {
    if (best.degree) flat.degree = best.degree;
    if (best.institution) flat.university = best.institution;
    if (best.major) flat.major = best.major;
    if (best.graduation_year) flat.graduation_year = best.graduation_year;
  }

  if ((structured.certifications || []).length) flat.certifications = structured.certifications.join(", ");
  if ((structured.awards || []).length) flat.awards = structured.awards.join(", ");

  const impactBullets = [];
  for (const e of exp) for (const b of (e.bullets || [])) if (/\d/.test(b)) impactBullets.push(b);
  for (const p of proj) for (const b of (p.bullets || [])) if (/\d/.test(b)) impactBullets.push(b);

  const achievementsList = [...new Set([
    ...(structured.awards || []),
    ...(structured.certifications || []),
    ...impactBullets,
  ])].slice(0, 8);
  if (achievementsList.length) flat.achievements = achievementsList.join(" | ");

  if (exp[0]?.role) flat.headline = exp[0].role;
  else if (structured.summary) flat.headline = structured.summary.split(/(?<=[.!?])\s/)[0];

  const years = [];
  exp.forEach(e => {
    const sy = parseYear(e.start_date);
    const ey = parseYear(e.end_date);
    if (sy) years.push(sy);
    if (ey) years.push(ey);
  });
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span > 0 && span < 60) flat.years_experience = `${span}+ years`;
  } else if (structured.years_experience) {
    flat.years_experience = structured.years_experience;
  }

  return flat;
}

const STRUCTURED_SCHEMA_DESCRIPTION = `{
  "full_name": "", "first_name": "", "last_name": "",
  "location": "", "summary": "", "headline": "", "years_experience": "",
  "experience": [{ "company": "", "role": "", "domain": "", "start_date": "", "end_date": "", "duration": "", "bullets": [""] }],
  "projects": [{ "name": "", "stack": "", "description": "", "bullets": [""], "links": [""] }],
  "skills": { "languages": [""], "frameworks": [""], "ml_ai": [""], "data": [""], "cloud_tools": [""], "other": [""] },
  "education": [{ "institution": "", "degree": "", "major": "", "start_date": "", "end_date": "", "graduation_year": "", "gpa": "" }],
  "certifications": [""],
  "awards": [""]
}`;

// Prompt is built from section-marked text (not raw collapsed text) so the
// model sees the same section boundaries the deterministic parser uses.
function buildAIPrompt(normalizedText) {
  const sections = splitResumeSections(normalizedText);
  const sectioned = sections.map(s => `## ${s.heading}\n${s.lines.join("\n")}`).join("\n\n");

  return `You are a professional resume parser. Extract structured details from the following resume text.
Format the output STRICTLY as a JSON object matching this exact shape (omit fields you cannot find; use empty strings/arrays, never guess):

${STRUCTURED_SCHEMA_DESCRIPTION}

Do NOT wrap the JSON inside markdown code blocks and do not provide any explanation, preamble, or trailing text. Output ONLY the JSON.

Resume text (organised by section):
${sectioned}`;
}

function cleanStringField(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s || /^(null|n\/a)$/i.test(s)) return "";
  return s;
}

function cleanEntryArray(arr, allowedKeys) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (!item || typeof item !== "object") return null;
    const clean = {};
    for (const k of allowedKeys) {
      if (k === "bullets" || k === "links") {
        clean[k] = Array.isArray(item[k]) ? item[k].map(cleanStringField).filter(Boolean) : [];
      } else {
        const v = cleanStringField(item[k]);
        if (v) clean[k] = v;
      }
    }
    return Object.keys(clean).length ? clean : null;
  }).filter(Boolean);
}

function cleanStringArray(arr) {
  return Array.isArray(arr) ? arr.map(cleanStringField).filter(Boolean) : [];
}

/** Validate and sanitize a raw AI JSON response against the structured schema. */
function validateAIStructured(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};

  for (const k of ["full_name", "first_name", "last_name", "location", "summary", "headline", "years_experience", "email", "phone", "linkedin", "github", "portfolio"]) {
    const v = cleanStringField(raw[k]);
    if (v) out[k] = v;
  }

  out.experience = cleanEntryArray(raw.experience, ["company", "role", "domain", "start_date", "end_date", "duration", "bullets"]);
  out.projects = cleanEntryArray(raw.projects, ["name", "stack", "description", "bullets", "links"]);
  out.education = cleanEntryArray(raw.education, ["institution", "degree", "major", "start_date", "end_date", "graduation_year", "gpa"]);
  out.certifications = cleanStringArray(raw.certifications);
  out.awards = cleanStringArray(raw.awards);

  if (raw.skills && typeof raw.skills === "object") {
    out.skills = {};
    for (const cat of ["languages", "frameworks", "ml_ai", "data", "cloud_tools", "other"]) {
      out.skills[cat] = cleanStringArray(raw.skills[cat]);
    }
  }

  return out;
}

function fuzzyEq(a, b) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Appends AI entries that don't already fuzzy-match an existing entry on keyFields.
function mergeArraySection(existing, incoming, keyFields) {
  const base = existing || [];
  if (!base.length) return incoming || [];
  const merged = [...base];
  for (const item of (incoming || [])) {
    const isDup = merged.some(e => keyFields.some(k => item[k] && fuzzyEq(e[k], item[k])));
    if (!isDup) merged.push(item);
  }
  return merged;
}

// Contact fields/scalars fill gaps only (never overwrite what regex already
// found); array sections keep deterministic entries and only gain new ones.
function mergeAIIntoStructured(structured, aiRaw) {
  const ai = validateAIStructured(aiRaw);
  const merged = { ...structured };

  for (const k of ["full_name", "first_name", "last_name", "location", "summary", "headline", "years_experience", "email", "phone", "linkedin", "github", "portfolio"]) {
    if (!merged[k] && ai[k]) merged[k] = ai[k];
  }

  merged.experience = mergeArraySection(structured.experience, ai.experience, ["company", "role"]);
  merged.projects = mergeArraySection(structured.projects, ai.projects, ["name"]);
  merged.education = mergeArraySection(structured.education, ai.education, ["institution", "degree"]);
  merged.certifications = [...new Set([...(structured.certifications || []), ...(ai.certifications || [])])];
  merged.awards = [...new Set([...(structured.awards || []), ...(ai.awards || [])])];

  if (ai.skills) {
    merged.skills = { ...(structured.skills || {}) };
    for (const cat of Object.keys(ai.skills)) {
      merged.skills[cat] = [...new Set([...(structured.skills?.[cat] || []), ...ai.skills[cat]])];
    }
  }

  return merged;
}

window.FCV_buildStructuredProfile = buildStructuredProfile;
window.FCV_deriveFlatProfile = deriveFlatProfile;
window.FCV_buildAIPrompt = buildAIPrompt;
window.FCV_mergeAIIntoStructured = mergeAIIntoStructured;

// DevTools: window._fcvDebugParse(pastedText) — no fixture text embedded here.
window._fcvDebugParse = function (text) {
  const normalized = normalizeResumeText(text);
  const sections = splitResumeSections(normalized);
  const structured = buildStructuredProfile(normalized);
  const flat = deriveFlatProfile(structured);

  const excluded = new Set(["salary", "notice_period", "cover_letter", "motivation"]);
  const registry = window.FCV_FIELD_REGISTRY || {};
  const coreKeys = Object.keys(registry).filter(k => !excluded.has(k));
  const report = coreKeys.map(k => ({ field: k, extracted: !!flat[k], value: flat[k] ? String(flat[k]).slice(0, 60) : "" }));

  console.group("FeelCV Debug Parse");
  console.log("Sections found:", sections.map(s => `${s.heading} (${s.lines.length} lines)`));
  console.log("Structured profile:", structured);
  console.log("Derived flat profile:", flat);
  console.table(report);
  console.groupEnd();

  return { structured, flat };
};
