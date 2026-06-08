"use strict";

const FIELD_REGISTRY = {
  full_name:        { label: "Full Name",              patterns: ["name","full name","your name","applicant name"] },
  first_name:       { label: "First Name",             patterns: ["first name","given name","forename"] },
  last_name:        { label: "Last Name",              patterns: ["last name","surname","family name"] },
  email:            { label: "Email",                  patterns: ["email","e-mail","mail","email address"] },
  phone:            { label: "Phone",                  patterns: ["phone","mobile","cell","telephone","contact number"] },
  location:         { label: "Location / City",        patterns: ["city","location","address","where are you based","current location"] },
  linkedin:         { label: "LinkedIn URL",           patterns: ["linkedin","linkedin url","linkedin profile"] },
  github:           { label: "GitHub URL",             patterns: ["github","github url","portfolio","website","personal site"] },
  portfolio:        { label: "Portfolio URL",          patterns: ["portfolio","website","personal site","personal url"] },
  summary:          { label: "About / Summary",        patterns: ["summary","about yourself","about you","brief bio","profile summary","professional summary","tell us about yourself","short bio","bio","describe yourself"] },
  headline:         { label: "Professional Headline",  patterns: ["headline","title","job title","current role","current position","designation"] },
  years_experience: { label: "Years of Experience",   patterns: ["years of experience","total experience","how many years","work experience"] },
  current_company:  { label: "Current Employer",      patterns: ["current company","current employer","current organization","employer"] },
  current_role:     { label: "Current Job Title",     patterns: ["current role","current position","current title","current designation"] },
  work_history:     { label: "Work History",           patterns: ["work history","employment history","past experience","previous companies"] },
  degree:           { label: "Degree",                 patterns: ["degree","qualification","education","highest qualification","academic qualification"] },
  university:       { label: "University / College",   patterns: ["university","college","institution","school","alma mater"] },
  graduation_year:  { label: "Graduation Year",        patterns: ["graduation year","year of graduation","passed out","batch"] },
  major:            { label: "Field of Study",         patterns: ["major","field of study","specialization","stream","branch","course"] },
  skills:           { label: "Skills",                 patterns: ["skills","technologies","tech stack","tools","expertise","competencies","technical skills"] },
  languages:        { label: "Programming Languages",  patterns: ["programming languages","languages known","coding languages"] },
  cover_letter:     { label: "Cover Letter",           patterns: ["cover letter","why should we hire","motivation letter","statement of purpose"] },
  motivation:       { label: "Why this role / company",patterns: ["why do you want","why are you interested","why this company","why this role","what attracts you","what interests you","reason for applying"] },
  strengths:        { label: "Key Strengths",          patterns: ["strengths","greatest strengths","what are your strengths","key strengths"] },
  achievements:     { label: "Achievements",           patterns: ["achievements","accomplishments","notable projects","key projects","proud of"] },
  salary:           { label: "Expected Salary",        patterns: ["expected salary","salary expectation","ctc","expected ctc","compensation"] },
  notice_period:    { label: "Notice Period",          patterns: ["notice period","when can you join","availability","how soon"] },
};

const AI_GENERATED_FIELDS = ["cover_letter", "motivation", "strengths", "achievements", "summary"];

const PROVIDERS = {
  groq: {
    name: "Groq",
    recommended: true,
    signup: "https://console.groq.com",
    desc: "Free tier · 30+ req/min · No credit card required",
    keyHint: "Starts with gsk_",
    keyPattern: /^gsk_/,
  },
  openrouter: {
    name: "OpenRouter",
    recommended: false,
    signup: "https://openrouter.ai",
    desc: "Many free models · Free credits on signup",
    keyHint: "Starts with sk-or-",
    keyPattern: /^sk-or-/,
  },
  openai: {
    name: "OpenAI",
    recommended: false,
    signup: "https://platform.openai.com",
    desc: "Paid · Best quality · Pay-as-you-go",
    keyHint: "Starts with sk-",
    keyPattern: /^sk-(?!or-)/,
  },
  custom: {
    name: "Custom",
    recommended: false,
    signup: null,
    desc: "Any OpenAI-compatible endpoint (self-hosted, etc.)",
    keyHint: "Your provider's API key",
    keyPattern: /.+/,
  },
};

const DEFAULT_CONFIG = {
  provider: "groq",
  apiKeys: { groq: "", openrouter: "", openai: "", custom: "" },
  models: {
    groq: "llama-3.1-8b-instant",
    openrouter: "meta-llama/llama-3.1-8b-instruct:free",
    openai: "gpt-3.5-turbo",
    custom: "gpt-3.5-turbo",
  },
  endpoints: {
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    openai: "https://api.openai.com/v1",
    custom: "",
  },
  connectionStatus: {},
};

// ── Storage helpers ──

const ENCODE_PREFIX = "fcv_enc:";

function encodeKey(key) {
  if (!key) return "";
  try { return ENCODE_PREFIX + btoa(key); } catch { return key; }
}

function decodeKey(stored) {
  if (!stored) return "";
  if (!stored.startsWith(ENCODE_PREFIX)) return stored;
  try { return atob(stored.slice(ENCODE_PREFIX.length)); } catch { return stored; }
}

const getProfile = () => new Promise(r => chrome.storage.local.get("fcv_profile", d => r(d.fcv_profile || {})));
const setProfile = (p) => new Promise(r => chrome.storage.local.set({ fcv_profile: p }, r));
const updateProfile = async (patch) => { const cur = await getProfile(); await setProfile({ ...cur, ...patch }); };

async function getConfig() {
  const data = await new Promise(r => chrome.storage.local.get("fcv_provider", d => r(d.fcv_provider || {})));
  const cfg = { ...DEFAULT_CONFIG, ...data };

  if (data.apiKey && !data.apiKeys) {
    cfg.apiKeys = { ...DEFAULT_CONFIG.apiKeys };
    let prov = data.provider || "groq";
    if (prov === "openai_compat" || prov === "ollama") prov = "groq";
    if (!["groq","openrouter","openai","custom"].includes(prov)) prov = "groq";
    cfg.apiKeys[prov] = data.apiKey;
    cfg.provider = prov;
  }

  if (cfg.provider === "ollama" || cfg.provider === "openai_compat") {
    cfg.provider = "groq";
  }

  if (!cfg.apiKeys) cfg.apiKeys = { ...DEFAULT_CONFIG.apiKeys };

  const decoded = {};
  for (const [k, v] of Object.entries(cfg.apiKeys)) {
    decoded[k] = decodeKey(v);
  }
  cfg.apiKeys = decoded;

  if (!cfg.models) cfg.models = { ...DEFAULT_CONFIG.models };
  if (!cfg.endpoints) cfg.endpoints = { ...DEFAULT_CONFIG.endpoints };
  if (!cfg.connectionStatus) cfg.connectionStatus = {};

  return cfg;
}

async function setConfig(cfg) {
  const toStore = { ...cfg };
  const encoded = {};
  for (const [k, v] of Object.entries(cfg.apiKeys || {})) {
    encoded[k] = encodeKey(v);
  }
  toStore.apiKeys = encoded;
  return new Promise(r => chrome.storage.local.set({ fcv_provider: toStore }, r));
}

function getActiveApiKey(cfg) {
  return (cfg.apiKeys || {})[cfg.provider] || "";
}

function hasApiKey(cfg) {
  return !!getActiveApiKey(cfg).trim();
}

// ── File extraction ──

async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "txt") return file.text();
  if (ext === "pdf") return extractPDF(file);
  if (ext === "docx") return extractDOCX(file);
  throw new Error("Unsupported file type: " + ext);
}

async function extractPDF(file) {
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  if (!pdfjsLib) throw new Error("pdf.js not loaded");
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s => s.str).join(" ") + "\n";
  }
  return text;
}

async function extractDOCX(file) {
  if (!window.mammoth) throw new Error("mammoth not loaded");
  const ab = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: ab });
  return result.value;
}

// ── Resume parsing ──

function parseResumeText(text) {
  const profile = {};
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) profile.email = emailMatch[0];

  const phoneMatch = text.match(/(\+?\d[\d\s\-().]{7,15}\d)/);
  if (phoneMatch) profile.phone = phoneMatch[1].trim();

  const liMatch = text.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  if (liMatch) profile.linkedin = "https://linkedin.com/in/" + liMatch[1];

  const ghMatch = text.match(/github\.com\/([a-zA-Z0-9\-_%]+)/i);
  if (ghMatch) profile.github = "https://github.com/" + ghMatch[1];

  for (const line of lines.slice(0, 6)) {
    if (line.length > 2 && line.length < 55 &&
        !line.includes("@") && !line.includes("http") &&
        !line.match(/^\d/) && /[A-Z]/.test(line[0])) {
      profile.full_name = line;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        profile.first_name = parts[0];
        profile.last_name  = parts[parts.length - 1];
      }
      break;
    }
  }

  const locMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/);
  if (locMatch) profile.location = locMatch[0];

  const yoeMatch = text.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  if (yoeMatch) profile.years_experience = yoeMatch[1] + "+ years";

  const skillsIdx = lines.findIndex(l => /^(skills|technical skills|core competencies)/i.test(l));
  if (skillsIdx !== -1) {
    const skillLines = [];
    for (let i = skillsIdx + 1; i < skillsIdx + 8 && i < lines.length; i++) {
      if (/^(experience|education|project|work|employment|summary|objective)/i.test(lines[i])) break;
      skillLines.push(lines[i]);
    }
    if (skillLines.length) profile.skills = skillLines.join(", ");
  }

  const eduIdx = lines.findIndex(l => /^(education|academic)/i.test(l));
  if (eduIdx !== -1) {
    for (let i = eduIdx + 1; i < eduIdx + 8 && i < lines.length; i++) {
      const l = lines[i];
      if (/bachelor|master|b\.tech|m\.tech|b\.e|m\.e|bsc|msc|phd|diploma/i.test(l) && !profile.degree) profile.degree = l;
      if (/university|college|institute|iit|nit/i.test(l) && !profile.university) profile.university = l;
      if (/\b(19|20)\d{2}\b/.test(l) && !profile.graduation_year) {
        const y = l.match(/\b(19|20)\d{2}\b/g);
        if (y) profile.graduation_year = y[y.length - 1];
      }
    }
  }

  const summIdx = lines.findIndex(l => /^(summary|profile|objective|about)/i.test(l));
  if (summIdx !== -1) {
    const summLines = [];
    for (let i = summIdx + 1; i < summIdx + 6 && i < lines.length; i++) {
      if (/^(experience|education|skills|project)/i.test(lines[i])) break;
      summLines.push(lines[i]);
    }
    if (summLines.length) profile.summary = summLines.join(" ");
  }

  const expIdx = lines.findIndex(l => /^(experience|work experience|employment)/i.test(l));
  if (expIdx !== -1) {
    for (let i = expIdx + 1; i < expIdx + 4 && i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 3 && !l.match(/^\d/) && !profile.current_company) {
        profile.current_company = l; break;
      }
    }
  }

  return profile;
}

// ── AI ──

function buildPrompt(fieldKey, profile, jobTitle, company) {
  const { email, phone, ...safeProfile } = profile;
  const p = JSON.stringify(safeProfile);
  const role = jobTitle || "this role";
  const co   = company  || "this company";
  const prompts = {
    motivation:   `Write a concise, genuine 2-3 sentence answer to "Why do you want to work at ${co} as ${role}?" based on this profile: ${p}. Be specific, avoid clichés. Output only the answer text.`,
    cover_letter: `Write a short professional cover letter (150-200 words) for the role of ${role} at ${co} based on this profile: ${p}. Output only the letter body.`,
    strengths:    `Write 2-3 specific professional strengths in 1-2 sentences based on this profile: ${p}. No bullet points, no preamble.`,
    achievements: `Summarise 2-3 key achievements from this profile in 1-2 sentences: ${p}. Use numbers/metrics where the profile supports it.`,
    summary:      `Write a crisp 2-3 sentence professional summary based on this profile: ${p}. No buzzwords. Output only the summary.`,
  };
  return prompts[fieldKey] || `Generate a short answer for the field "${fieldKey}" from this profile: ${p}. Output only the answer.`;
}

function mapApiError(err, status) {
  const msg = (err?.error?.message || err?.message || "").toLowerCase();
  if (status === 401 || status === 403 || msg.includes("invalid") || msg.includes("unauthorized") || msg.includes("api key")) {
    return "Invalid API key. Check and try again.";
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) {
    return "Rate limit exceeded. Try again in a minute.";
  }
  if (msg.includes("model") && (msg.includes("not found") || msg.includes("not available") || msg.includes("does not exist"))) {
    return "Model not available for your API key.";
  }
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network error. Check your internet connection.";
  }
  return err?.error?.message || err?.message || "API call failed.";
}

async function callAI(prompt, cfg) {
  const provider = cfg.provider;
  const endpoint = (cfg.endpoints[provider] || "").replace(/\/$/, "");
  const model = cfg.models[provider];
  const apiKey = getActiveApiKey(cfg);

  if (!apiKey) throw new Error("No API key configured.");
  if (!endpoint) throw new Error("No API endpoint configured.");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://feelcv.extension";
    headers["X-Title"] = "FeelCV";
  }

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(mapApiError(error, response.status));
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function testConnection(cfg, provider, apiKey, endpoint, model) {
  const ep = (endpoint || cfg.endpoints[provider] || "").replace(/\/$/, "");
  const mdl = model || cfg.models[provider];
  const key = apiKey || getActiveApiKey(cfg);

  if (!key) return { ok: false, message: "No API key entered." };
  if (!ep) return { ok: false, message: "No endpoint configured." };

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://feelcv.extension";
    headers["X-Title"] = "FeelCV";
  }

  try {
    const res = await fetch(`${ep}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: mdl,
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 5,
      }),
    });

    if (res.ok) return { ok: true, message: "Connected successfully." };

    const err = await res.json().catch(() => ({}));
    return { ok: false, message: mapApiError(err, res.status) };
  } catch (e) {
    if (e.name === "TimeoutError") return { ok: false, message: "Connection timed out." };
    return { ok: false, message: "Network error. Check your internet connection." };
  }
}

async function generateWithAI(fieldKey, profile, jobTitle = "", company = "") {
  const cfg = await getConfig();
  if (!hasApiKey(cfg)) {
    showApiKeyModal();
    throw new Error("API key required.");
  }
  const prompt = buildPrompt(fieldKey, profile, jobTitle, company);
  return callAI(prompt, cfg);
}

// ── DOM helpers ──

const $ = id => document.getElementById(id);

function status(msg, type = "info") {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status-msg " + type;
  if (msg) {
    setTimeout(() => {
      if (el.textContent === msg) {
        el.textContent = "";
        el.className = "status-msg";
      }
    }, 4000);
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
  if (tabId === "tab-ai") renderAIPanel();
  if (tabId === "tab-settings") renderSettings();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Hero & stats ──

const PROFILE_FIELD_TARGET = 12;

function setRingPercent(percent) {
  const ring = $("hero-ring-progress");
  const label = $("hero-percent");
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (percent / 100) * circumference;
  if (ring) ring.style.strokeDashoffset = offset;
  if (label) label.textContent = Math.round(percent) + "%";
}

function updateHeroStats(profile, cfg) {
  const keys = Object.keys(profile);
  const count = keys.length;
  const percent = Math.min(100, Math.round((count / PROFILE_FIELD_TARGET) * 100));

  const countEl = $("hero-field-count");
  if (countEl) countEl.textContent = count;

  setRingPercent(percent);

  const statusEl = $("hero-status-text");
  if (statusEl) {
    if (!count) statusEl.textContent = "Upload your resume to begin";
    else if (percent >= 100) statusEl.textContent = "Profile complete — ready to autofill";
    else statusEl.textContent = `Extracting data… ${percent}% complete`;
  }

  const apiVal = $("stat-api-value");
  const provVal = $("stat-provider-value");
  if (cfg) {
    const key = hasApiKey(cfg);
    const st = cfg.connectionStatus?.[cfg.provider];
    if (apiVal) {
      apiVal.textContent = !key ? "Not set" : st === "connected" ? "Connected" : st === "invalid" ? "Invalid" : "Set";
      apiVal.className = "stat-value" + (st === "connected" ? " connected" : !key ? " warning" : "");
    }
    if (provVal) {
      provVal.textContent = key ? (PROVIDERS[cfg.provider]?.name || cfg.provider) : "—";
    }
  }

  const deleteBtn = $("delete-resume");
  if (deleteBtn) deleteBtn.classList.toggle("hidden", !count);
}

// ── Welcome & banners ──

async function updateOnboardingState() {
  const profile = await getProfile();
  const cfg = await getConfig();
  const hasProfile = Object.keys(profile).length > 0;
  const hasKey = hasApiKey(cfg);

  updateHeroStats(profile, cfg);

  const welcome = $("welcome-screen");
  const dismissed = localStorage.getItem("fcv_welcome_dismissed");
  if (welcome) {
    welcome.classList.toggle("hidden", (hasProfile && hasKey) || dismissed === "1");
  }

  const step1 = $("welcome-step-1");
  const step2 = $("welcome-step-2");
  if (step1) step1.classList.toggle("done", hasProfile);
  if (step2) step2.classList.toggle("done", hasKey);

  const banner = $("api-key-banner");
  if (banner) banner.classList.toggle("hidden", hasKey);
}

// ── Profile view ──

function renderProfileView(profile) {
  const container = $("profile-content");
  if (!container) return;

  const keys = Object.keys(profile);
  if (!keys.length) {
    container.innerHTML = `<div class="empty-state"><p>No profile yet</p></div>`;
    return;
  }

  container.innerHTML = keys.map(key => {
    const meta = FIELD_REGISTRY[key];
    const label = meta?.label || key;
    const val = profile[key];
    const display = val.length > 40 ? val.slice(0, 37) + "…" : val;
    return `
      <div class="list-row clickable edit-btn" data-key="${key}">
        <div class="list-row-content">
          <span class="list-row-label">${escapeHtml(label)}</span>
          <span class="list-row-value" title="${escapeHtml(val)}">${escapeHtml(display)}</span>
        </div>
        <span class="list-row-action ai-gen-arrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </div>`;
  }).join("");

  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.onclick = () => openEditModal(btn.dataset.key, profile[btn.dataset.key]);
  });

  getConfig().then(c => updateHeroStats(profile, c));
}

// ── Modals ──

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

function showApiKeyModal() {
  $("api-modal-overlay").classList.remove("hidden");
}

function closeApiKeyModal() {
  $("api-modal-overlay").classList.add("hidden");
}

// ── Learn banner ──

function showLearnBanner(key, value, fieldLabel) {
  const banner = document.createElement("div");
  banner.className = "learn-banner";
  banner.innerHTML = `
    <span>Learn "<b>${escapeHtml(fieldLabel)}</b>"?</span>
    <div class="learn-val">${escapeHtml(value.slice(0, 80))}${value.length > 80 ? "…" : ""}</div>
    <div class="learn-btns">
      <button class="btn-pill-sm btn-yes" data-key="${key}" data-val="${encodeURIComponent(value)}">Save</button>
      <button class="btn-secondary btn-no" style="padding:6px 14px;font-size:11px;border-radius:100px">Dismiss</button>
    </div>`;
  const queue = $("learn-queue");
  if (queue) queue.prepend(banner);

  banner.querySelector(".btn-yes").onclick = async (e) => {
    const k = e.target.dataset.key;
    const v = decodeURIComponent(e.target.dataset.val);
    await updateProfile({ [k]: v });
    banner.remove();
    status("Learned: " + (FIELD_REGISTRY[k]?.label || k), "success");
    renderProfileView(await getProfile());
    updateOnboardingState();
  };
  banner.querySelector(".btn-no").onclick = () => banner.remove();
}

// ── AI Studio ──

async function renderAIPanel() {
  const profile = await getProfile();
  const cfg = await getConfig();
  const container = $("ai-content");
  if (!container) return;

  if (!Object.keys(profile).length) {
    container.innerHTML = `<div class="empty-state"><p>Upload your resume first</p></div>`;
    return;
  }

  if (!hasApiKey(cfg)) {
    container.innerHTML = `
      <div class="empty-state ai-prompt">
        <strong>Setup API key</strong>
        <p style="margin-top:6px">2 min · Free with Groq</p>
        <button id="ai-setup-btn" class="btn-primary btn-pill" style="margin-top:16px">Setup →</button>
      </div>`;
    $("ai-setup-btn").onclick = () => switchTab("tab-settings");
    return;
  }

  container.innerHTML = `
    <div class="ai-hero">
      <div class="ai-hero-title">Job Context</div>
      <div class="ai-inputs">
        <input id="ai-job-title" class="input" placeholder="Job title" />
        <input id="ai-company" class="input" placeholder="Company name" />
      </div>
    </div>
    <div class="section-label">Generate</div>
    <div class="ai-gen-list">
      ${AI_GENERATED_FIELDS.map(k => `
        <div class="ai-gen-row ai-gen-btn" data-field="${k}">
          <div class="list-row-content">
            <span class="list-row-label">${escapeHtml(FIELD_REGISTRY[k]?.label || k)}</span>
            <span class="list-row-meta">Tap to generate</span>
          </div>
          <span class="ai-gen-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>`).join("")}
    </div>
    <div id="ai-result-area" class="ai-result-card">
      <span style="color:var(--muted);font-size:12px">Select a type to generate</span>
    </div>`;

  container.querySelectorAll(".ai-gen-btn").forEach(btn => {
    btn.onclick = async () => {
      const field = btn.dataset.field;
      const jobTitle = $("ai-job-title")?.value.trim() || "";
      const company  = $("ai-company")?.value.trim() || "";
      const resultArea = $("ai-result-area");

      container.querySelectorAll(".ai-gen-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      resultArea.innerHTML = `<div class="result-loading"><div class="spinner"></div>Generating…</div>`;

      try {
        const text = await generateWithAI(field, profile, jobTitle, company);
        resultArea.innerHTML = `
          <div class="result-header">
            <span class="result-label">${escapeHtml(FIELD_REGISTRY[field]?.label || field)}</span>
            <button id="copy-result" class="btn-pill-sm" style="background:transparent;border:1px solid var(--border);color:var(--text)">Copy</button>
          </div>
          <div class="result-text">${escapeHtml(text)}</div>`;
        $("copy-result").onclick = (e) => {
          navigator.clipboard.writeText(text);
          const b = e.target;
          b.textContent = "Copied!";
          setTimeout(() => { b.textContent = "Copy"; }, 1500);
        };
      } catch (err) {
        if (err.message !== "API key required.") {
          resultArea.innerHTML = `<span style="color:var(--danger);font-size:12px">${escapeHtml(err.message)}</span>`;
        }
      }
    };
  });
}

// ── Settings ──

function getConnectionStatusHtml(cfg) {
  const st = cfg.connectionStatus?.[cfg.provider];
  if (!getActiveApiKey(cfg)) {
    return `<div class="connection-status unset">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Not set — add your API key
    </div>`;
  }
  if (st === "connected") {
    return `<div class="connection-status connected">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Connected
    </div>`;
  }
  if (st === "invalid") {
    return `<div class="connection-status invalid">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      Invalid key
    </div>`;
  }
  return "";
}

function validateKeyFormat(provider, key) {
  if (!key) return { valid: false, hint: PROVIDERS[provider]?.keyHint || "" };
  const pat = PROVIDERS[provider]?.keyPattern;
  if (pat && !pat.test(key)) {
    return { valid: false, hint: `Expected format: ${PROVIDERS[provider].keyHint}` };
  }
  return { valid: true, hint: "Format looks good" };
}

async function renderSettings() {
  const cfg = await getConfig();
  const container = $("settings-content");
  if (!container) return;

  const prov = cfg.provider;
  const provInfo = PROVIDERS[prov];
  const apiKey = (cfg.apiKeys || {})[prov] || "";

  container.innerHTML = `
    <div class="settings-hero">
      <div class="settings-hero-title">API Provider</div>
      <p class="settings-hero-desc" id="provider-desc">
        ${provInfo.desc}
        ${provInfo.signup ? `<br><a href="${provInfo.signup}" target="_blank">Get free key →</a>` : ""}
      </p>

      <div class="provider-list">
        ${Object.entries(PROVIDERS).map(([id, p]) => `
          <div class="provider-row ${id === prov ? "active" : ""}" data-provider="${id}">
            <div>
              <span class="provider-row-name">${p.name}${p.recommended ? '<span class="provider-row-badge">Free</span>' : ""}</span>
              <div class="provider-row-desc">${p.desc}</div>
            </div>
            <button class="pill-toggle ${id === prov ? "on" : ""}" data-provider="${id}" type="button" aria-label="Select ${p.name}"></button>
          </div>`).join("")}
      </div>

      <label class="settings-label">API Key</label>
      <div class="input-wrapper">
        <input id="settings-api-key" type="password" class="input mono" value="${escapeHtml(apiKey)}" placeholder="${provInfo.keyHint}" autocomplete="off" />
        <button id="toggle-key-vis" class="toggle-visibility" type="button" title="Show/hide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <div id="key-hint" class="input-hint">${provInfo.keyHint}</div>

      <div id="custom-fields" class="${prov === "custom" ? "" : "hidden"}">
        <label class="settings-label">Base URL</label>
        <input id="settings-endpoint" class="input mono" value="${escapeHtml(cfg.endpoints.custom || "")}" placeholder="https://your-api.com/v1" />
      </div>

      <label class="settings-label">Model</label>
      <input id="settings-model" class="input mono" value="${escapeHtml(cfg.models[prov] || "")}" placeholder="Model name" />

      <div id="connection-status-area">${getConnectionStatusHtml(cfg)}</div>

      <div class="settings-actions">
        <button id="test-connection-btn" class="btn-secondary btn-pill">Test</button>
        <button id="save-settings-btn" class="btn-primary btn-pill">Save</button>
      </div>
      <button id="delete-key-btn" class="text-btn danger-text" style="margin-top:12px">Delete key</button>
    </div>

    <div class="section-label">Data</div>
    <div class="data-list">
      <div class="data-row" id="export-profile-btn">Export Profile</div>
      <div class="data-row" id="reset-settings-btn">Reset Settings</div>
      <div class="data-row danger" id="nuke-btn">Delete All Data</div>
    </div>`;

  let selectedProvider = prov;

  function selectProvider(id) {
    selectedProvider = id;
    container.querySelectorAll(".provider-row").forEach(r => {
      const active = r.dataset.provider === id;
      r.classList.toggle("active", active);
      r.querySelector(".pill-toggle")?.classList.toggle("on", active);
    });
    const info = PROVIDERS[id];
    $("provider-desc").innerHTML = `
      ${info.desc}
      ${info.signup ? `<br><a href="${info.signup}" target="_blank">Get free key →</a>` : ""}`;
    const keyInput = $("settings-api-key");
    keyInput.value = cfg.apiKeys[id] || "";
    keyInput.placeholder = info.keyHint;
    $("key-hint").textContent = info.keyHint;
    $("key-hint").className = "input-hint";
    $("settings-model").value = cfg.models[id] || "";
    $("custom-fields").classList.toggle("hidden", id !== "custom");
    $("connection-status-area").innerHTML = "";
  }

  container.querySelectorAll(".provider-row, .pill-toggle").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      selectProvider(el.dataset.provider);
    };
  });

  // Toggle visibility
  $("toggle-key-vis").onclick = () => {
    const inp = $("settings-api-key");
    inp.type = inp.type === "password" ? "text" : "password";
  };

  // Real-time key validation
  $("settings-api-key").addEventListener("input", (e) => {
    const v = validateKeyFormat(selectedProvider, e.target.value.trim());
    const hint = $("key-hint");
    hint.textContent = v.hint;
    hint.className = "input-hint" + (e.target.value ? (v.valid ? " valid" : " invalid") : "");
  });

  // Ctrl/Cmd+Enter to save
  $("settings-api-key").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      $("save-settings-btn").click();
    }
  });

  // Test connection
  $("test-connection-btn").onclick = async () => {
    const btn = $("test-connection-btn");
    const key = $("settings-api-key").value.trim();
    const model = $("settings-model").value.trim();
    const endpoint = selectedProvider === "custom"
      ? $("settings-endpoint")?.value.trim()
      : cfg.endpoints[selectedProvider];

    btn.classList.add("btn-loading");
    btn.disabled = true;

    const result = await testConnection(cfg, selectedProvider, key, endpoint, model);

    btn.classList.remove("btn-loading");
    btn.disabled = false;

    const statusArea = $("connection-status-area");
    if (result.ok) {
      statusArea.innerHTML = `<div class="connection-status connected">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        ${result.message}
      </div>`;
    } else {
      statusArea.innerHTML = `<div class="connection-status invalid">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        ${escapeHtml(result.message)}
      </div>`;
    }
  };

  // Save settings
  $("save-settings-btn").onclick = async () => {
    const key = $("settings-api-key").value.trim();
    const model = $("settings-model").value.trim();
    const cur = await getConfig();

    cur.provider = selectedProvider;
    cur.apiKeys[selectedProvider] = key;
    if (model) cur.models[selectedProvider] = model;
    if (selectedProvider === "custom") {
      cur.endpoints.custom = $("settings-endpoint")?.value.trim() || "";
    }

    if (key) {
      const testResult = await testConnection(cur, selectedProvider, key,
        selectedProvider === "custom" ? cur.endpoints.custom : cur.endpoints[selectedProvider],
        cur.models[selectedProvider]);
      cur.connectionStatus[selectedProvider] = testResult.ok ? "connected" : "invalid";
    } else {
      cur.connectionStatus[selectedProvider] = undefined;
    }

    await setConfig(cur);
    status("Settings saved.", "success");
    updateOnboardingState();
    renderSettings();
  };

  // Delete key
  $("delete-key-btn").onclick = async () => {
    if (!confirm("Delete API key for " + PROVIDERS[selectedProvider].name + "?")) return;
    const cur = await getConfig();
    cur.apiKeys[selectedProvider] = "";
    delete cur.connectionStatus[selectedProvider];
    await setConfig(cur);
    status("API key deleted.", "success");
    updateOnboardingState();
    renderSettings();
  };

  // Export
  $("export-profile-btn").onclick = async () => {
    const profile = await getProfile();
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "feelcv-profile.json" });
    a.click();
    URL.revokeObjectURL(url);
    status("Profile exported.", "success");
  };

  // Reset settings
  $("reset-settings-btn").onclick = async () => {
    if (!confirm("Reset all settings to defaults? Your profile will be kept.")) return;
    const profile = await getProfile();
    await chrome.storage.local.clear();
    if (Object.keys(profile).length) await setProfile(profile);
    status("Settings reset.", "success");
    updateOnboardingState();
    renderSettings();
  };

  // Delete all
  $("nuke-btn").onclick = async () => {
    if (!confirm("Delete your entire profile and all settings? This cannot be undone.")) return;
    await chrome.storage.local.clear();
    localStorage.removeItem("fcv_welcome_dismissed");
    status("All data deleted.", "error");
    renderProfileView({});
    updateOnboardingState();
  };
}

// ── Tabs ──

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

// ── Upload / drag-drop ──

function setFileLabel(name) {
  const fileName = $("file-name");
  if (!fileName) return;
  if (name) {
    fileName.textContent = name;
    fileName.classList.add("has-file");
  } else {
    fileName.textContent = "Drop or click to upload";
    fileName.classList.remove("has-file");
  }
}

function initUpload() {
  const dropZone = $("upload-drop-zone");
  const fileInput = $("resume-upload");

  if (fileInput) {
    fileInput.onchange = () => {
      if (fileInput.files[0]) setFileLabel(fileInput.files[0].name);
    };
  }

  if (dropZone) {
    ["dragenter", "dragover"].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
      });
    });
    dropZone.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file && fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        setFileLabel(file.name);
      }
    });
  }
}

function initMenu() {
  const menuBtn = $("menu-btn");
  const dropdown = $("menu-dropdown");
  if (!menuBtn || !dropdown) return;

  menuBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  };
  document.addEventListener("click", () => dropdown.classList.add("hidden"));
  dropdown.onclick = (e) => e.stopPropagation();
}

// ── Init ──

async function init() {
  initTabs();
  initUpload();
  initMenu();

  const profile = await getProfile();
  renderProfileView(profile);
  await updateOnboardingState();

  // Welcome
  $("welcome-start-btn")?.addEventListener("click", () => {
    $("welcome-screen").classList.add("hidden");
    localStorage.setItem("fcv_welcome_dismissed", "1");
  });

  // Banner setup
  $("banner-setup-btn")?.addEventListener("click", () => switchTab("tab-settings"));

  // API modal
  $("api-modal-setup")?.addEventListener("click", () => {
    closeApiKeyModal();
    switchTab("tab-settings");
  });
  $("api-modal-close")?.addEventListener("click", closeApiKeyModal);
  $("api-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === $("api-modal-overlay")) closeApiKeyModal();
  });

  // Parse resume (circle upload button)
  $("parse-resume")?.addEventListener("click", async () => {
    const fileInput = $("resume-upload");
    const file = fileInput?.files[0];
    if (!file) { fileInput?.click(); return; }
    status("Parsing…", "info");
    try {
      const text = await extractTextFromFile(file);
      const parsed = parseResumeText(text);
      const current = await getProfile();
      const merged = { ...parsed, ...Object.fromEntries(Object.entries(current).filter(([, v]) => v)) };
      await setProfile(merged);
      renderProfileView(merged);
      status(`${Object.keys(parsed).length} fields extracted`, "success");
      updateOnboardingState();
    } catch (err) {
      status("Parse error: " + err.message, "error");
    }
  });

  // Autofill
  $("autofill-btn")?.addEventListener("click", async () => {
    const profileData = await getProfile();
    if (!Object.keys(profileData).length) {
      status("No profile. Upload resume first.", "error");
      return;
    }
    chrome.runtime.sendMessage({ type: "TRIGGER_AUTOFILL", profile: profileData });
    status("Autofilling…", "info");
  });

  // Delete profile
  $("delete-resume")?.addEventListener("click", async () => {
    if (!confirm("Delete your profile?")) return;
    await chrome.storage.local.remove("fcv_profile");
    $("resume-upload").value = "";
    setFileLabel(null);
    renderProfileView({});
    status("Profile deleted.", "error");
    updateOnboardingState();
  });

  // Edit modal
  $("modal-save")?.addEventListener("click", async () => {
    const key = $("modal-key")?.value;
    const val = $("modal-input")?.value.trim();
    if (!key || !val) return;
    await updateProfile({ [key]: val });
    closeModal();
    renderProfileView(await getProfile());
    status("Updated.", "success");
  });

  $("modal-close")?.addEventListener("click", closeModal);
  $("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === $("modal-overlay")) closeModal();
  });

  // Escape to close modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeApiKeyModal();
    }
  });

  // Messages from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_FIELD_LEARNED") {
      showLearnBanner(msg.key, msg.value, msg.fieldLabel);
    }
    if (msg.type === "AUTOFILL_DONE") {
      status(`Filled ${msg.filled}/${msg.total} fields.`, "success");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
