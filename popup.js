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

const AI_GENERATED_FIELDS = new Set(["cover_letter", "motivation", "strengths", "achievements", "summary"]);

// Storage helpers
const getProfile = () => new Promise(r => chrome.storage.local.get("fcv_profile", d => r(d.fcv_profile || {})));
const setProfile = (p) => new Promise(r => chrome.storage.local.set({ fcv_profile: p }, r));
const updateProfile = async (patch) => { const cur = await getProfile(); await setProfile({...cur, ...patch}); };

// Provider config
const DEFAULT_CONFIG = {
  provider:      "ollama",
  apiKey:        "",
  ollamaUrl:     "http://localhost:11434",
  ollamaModel:   "llama3.2",
  fallbackUrl:   "https://api.groq.com/openai/v1",
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

// file extraction
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

// resume parsing
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

  // name
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

  // location
  const locMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/);
  if (locMatch) profile.location = locMatch[0];

  // years of experience
  const yoeMatch = text.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  if (yoeMatch) profile.years_experience = yoeMatch[1] + "+ years";

  // skills
  const skillsIdx = lines.findIndex(l => /^(skills|technical skills|core competencies)/i.test(l));
  if (skillsIdx !== -1) {
    const skillLines = [];
    for (let i = skillsIdx + 1; i < skillsIdx + 8 && i < lines.length; i++) {
      if (/^(experience|education|project|work|employment|summary|objective)/i.test(lines[i])) break;
      skillLines.push(lines[i]);
    }
    if (skillLines.length) profile.skills = skillLines.join(", ");
  }

  // education
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

  // summary
  const summIdx = lines.findIndex(l => /^(summary|profile|objective|about)/i.test(l));
  if (summIdx !== -1) {
    const summLines = [];
    for (let i = summIdx + 1; i < summIdx + 6 && i < lines.length; i++) {
      if (/^(experience|education|skills|project)/i.test(lines[i])) break;
      summLines.push(lines[i]);
    }
    if (summLines.length) profile.summary = summLines.join(" ");
  }

  // current company
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

// AI generation
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

async function callOllama(prompt, cfg) {
  const url = `${cfg.ollamaUrl.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:  cfg.ollamaModel,
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
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model:      cfg.fallbackModel,
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
  const cfg    = await getProviderConfig();
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

// DOM helpers
const $ = id => document.getElementById(id);
const status = (msg, color = "#38bdf8") => {
  const statusEl = $("status");
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = color;
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 3000);
  }
};

// render profile view
function renderProfileView(profile) {
  const keys = Object.keys(profile);
  const container = $("profile-content");
  if (!container) return;
  
  if (!keys.length) {
    container.innerHTML = `<div class="empty-state">No profile yet. Upload your resume.</div>`;
    return;
  }

  const html = keys.map(key => {
    const meta = FIELD_REGISTRY[key];
    const label = meta?.label || key;
    const val = profile[key];
    return `
      <div class="profile-row" data-key="${key}">
        <span class="field-label">${label}</span>
        <span class="field-value" title="${val}">${val.length > 60 ? val.slice(0,57)+"…" : val}</span>
        <button class="edit-btn" data-key="${key}">✎</button>
      </div>`;
  }).join("");
  container.innerHTML = html;

  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.onclick = () => openEditModal(btn.dataset.key, profile[btn.dataset.key]);
  });
}

function openEditModal(key, currentValue) {
  const meta = FIELD_REGISTRY[key];
  $("modal-label").textContent = meta?.label || key;
  $("modal-input").value = currentValue || "";
  $("modal-key").value = key;
  $("modal-overlay").style.display = "flex";
  $("modal-input").focus();
}

function closeModal() {
  $("modal-overlay").style.display = "none";
}

// learn banner
function showLearnBanner(key, value, fieldLabel) {
  const banner = document.createElement("div");
  banner.className = "learn-banner";
  banner.innerHTML = `
    <span>💡 Learn "<b>${fieldLabel}</b>"?</span>
    <div class="learn-val">${value.slice(0,80)}${value.length > 80 ? "…" : ""}</div>
    <div class="learn-btns">
      <button class="btn-yes" data-key="${key}" data-val="${encodeURIComponent(value)}">Save</button>
      <button class="btn-no">Dismiss</button>
    </div>`;
  const queue = $("learn-queue");
  if (queue) queue.prepend(banner);

  banner.querySelector(".btn-yes").onclick = async (e) => {
    const k = e.target.dataset.key;
    const v = decodeURIComponent(e.target.dataset.val);
    await updateProfile({ [k]: v });
    banner.remove();
    status("Learned: " + (FIELD_REGISTRY[k]?.label || k), "#4ade80");
    renderProfileView(await getProfile());
  };
  banner.querySelector(".btn-no").onclick = () => banner.remove();
}

// AI panel
async function renderAIPanel() {
  const profile = await getProfile();
  const container = $("ai-content");
  if (!container) return;
  
  if (!Object.keys(profile).length) {
    container.innerHTML = `<div class="empty-state">Upload your resume first.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="ai-form">
      <input id="ai-job-title" placeholder="Job title (e.g. Frontend Engineer)" class="ai-input" />
      <input id="ai-company"   placeholder="Company name (optional)" class="ai-input" />
    </div>
    <div class="ai-field-btns">
      ${[...AI_GENERATED_FIELDS].map(k => `
        <button class="ai-gen-btn" data-field="${k}">
          ${FIELD_REGISTRY[k]?.label || k}
        </button>`).join("")}
    </div>
    <div id="ai-result-area" class="ai-result"></div>`;

  container.querySelectorAll(".ai-gen-btn").forEach(btn => {
    btn.onclick = async () => {
      const field    = btn.dataset.field;
      const jobTitle = $("ai-job-title")?.value.trim() || "";
      const company  = $("ai-company")?.value.trim() || "";
      const resultArea = $("ai-result-area");
      if (resultArea) resultArea.textContent = "Generating…";
      btn.disabled = true;
      try {
        const text = await generateWithAI(field, profile, jobTitle, company);
        if (resultArea) {
          resultArea.innerHTML = `
            <div class="result-label">${FIELD_REGISTRY[field]?.label}</div>
            <div class="result-text">${text.replace(/</g, "&lt;")}</div>
            <button id="copy-result" class="copy-btn">Copy</button>`;
          const copyBtn = $("copy-result");
          if (copyBtn) {
            copyBtn.onclick = () => {
              navigator.clipboard.writeText(text);
              copyBtn.textContent = "Copied!";
              setTimeout(() => { if(copyBtn) copyBtn.textContent = "Copy"; }, 1500);
            };
          }
        }
      } catch (err) {
        if (resultArea) resultArea.textContent = "Error: " + err.message;
      }
      btn.disabled = false;
    };
  });
}

// Settings panel
async function renderSettings() {
  const cfg = await getProviderConfig();
  const container = $("settings-content");
  if (!container) return;

  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">AI Provider</div>

      <div class="provider-toggle">
        <button class="provider-btn ${cfg.provider === "ollama" ? "active" : ""}" data-p="ollama">🔒 Ollama (Local)</button>
        <button class="provider-btn ${cfg.provider === "openai_compat" ? "active" : ""}" data-p="openai_compat">☁ External API</button>
      </div>

      <div id="ollama-config" class="${cfg.provider !== "ollama" ? "hidden" : ""}">
        <div class="privacy-badge">✦ Your data never leaves your device</div>
        <label class="settings-label">Ollama URL</label>
        <input id="ollama-url"   class="ai-input" value="${cfg.ollamaUrl}" placeholder="http://localhost:11434" />
        <label class="settings-label">Model</label>
        <input id="ollama-model" class="ai-input" value="${cfg.ollamaModel}" placeholder="llama3.2" />
        <div class="settings-hint">
          Install: <code>brew install ollama</code> or <a href="https://ollama.com" target="_blank">ollama.com</a><br>
          Pull model: <code>ollama pull llama3.2</code><br>
          Start: <code>ollama serve</code>
        </div>
        <button id="test-ollama-btn" class="pill-btn secondary" style="margin-top:8px">Test Connection</button>
        <div id="ollama-test-result" style="font-size:11px;margin-top:6px"></div>
      </div>

      <div id="ext-config" class="${cfg.provider !== "openai_compat" ? "hidden" : ""}">
        <div class="privacy-badge warn">⚠ Profile data will be sent externally</div>
        <label class="settings-label">Base URL</label>
        <input id="fallback-url"   class="ai-input" value="${cfg.fallbackUrl}" placeholder="https://api.groq.com/openai/v1" />
        <label class="settings-label">Model</label>
        <input id="fallback-model" class="ai-input" value="${cfg.fallbackModel}" placeholder="llama-3.1-8b-instant" />
        <label class="settings-label">API Key</label>
        <input id="ext-api-key" type="password" class="ai-input" value="${cfg.apiKey}" placeholder="sk-..." />
        <div class="settings-hint">
          Works with: Groq · OpenRouter · Together · OpenAI · any OpenAI-compatible endpoint.
        </div>
      </div>

      <button id="save-provider-btn" class="pill-btn primary" style="margin-top:10px;width:100%">Save Settings</button>
    </div>

    <hr class="divider">

    <div class="settings-section">
      <div class="settings-section-title">Profile Data</div>
      <div style="display:flex;gap:6px">
        <button id="export-profile-btn" class="pill-btn secondary" style="flex:1">Export JSON</button>
        <button id="nuke-btn"           class="pill-btn danger"    style="flex:1">Delete All</button>
      </div>
    </div>`;

  // Provider toggle
  container.querySelectorAll(".provider-btn").forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll(".provider-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const p = btn.dataset.p;
      const ollamaDiv = document.getElementById("ollama-config");
      const extDiv = document.getElementById("ext-config");
      if (ollamaDiv) ollamaDiv.classList.toggle("hidden", p !== "ollama");
      if (extDiv) extDiv.classList.toggle("hidden", p !== "openai_compat");
    };
  });

  // Test Ollama
  const testBtn = document.getElementById("test-ollama-btn");
  if (testBtn) {
    testBtn.onclick = async () => {
      const url = document.getElementById("ollama-url")?.value.trim() || "http://localhost:11434";
      const el = document.getElementById("ollama-test-result");
      if (el) {
        el.textContent = "Testing…";
        el.style.color = "#888";
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(4000) });
          if (res.ok) {
            const data = await res.json();
            const models = data.models?.map(m => m.name).join(", ") || "none";
            el.textContent = `✓ Connected. Models: ${models}`;
            el.style.color = "#4ade80";
          } else {
            el.textContent = `✗ HTTP ${res.status}`;
            el.style.color = "#f87171";
          }
        } catch {
          el.textContent = "✗ Can't reach Ollama. Is it running? (ollama serve)";
          el.style.color = "#f87171";
        }
      }
    };
  }

  // Save settings
  const saveBtn = document.getElementById("save-provider-btn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const activeProv = container.querySelector(".provider-btn.active")?.dataset.p || "ollama";
      const newCfg = {
        provider:      activeProv,
        ollamaUrl:     document.getElementById("ollama-url")?.value.trim()     || DEFAULT_CONFIG.ollamaUrl,
        ollamaModel:   document.getElementById("ollama-model")?.value.trim()   || DEFAULT_CONFIG.ollamaModel,
        fallbackUrl:   document.getElementById("fallback-url")?.value.trim()   || DEFAULT_CONFIG.fallbackUrl,
        fallbackModel: document.getElementById("fallback-model")?.value.trim() || DEFAULT_CONFIG.fallbackModel,
        apiKey:        document.getElementById("ext-api-key")?.value.trim()    || "",
      };
      await setProviderConfig(newCfg);
      status("Settings saved.", "#4ade80");
    };
  }

  // Export profile
  const exportBtn = document.getElementById("export-profile-btn");
  if (exportBtn) {
    exportBtn.onclick = async () => {
      const profile = await getProfile();
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: "feelcv-profile.json" });
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  // Nuke
  const nukeBtn = document.getElementById("nuke-btn");
  if (nukeBtn) {
    nukeBtn.onclick = async () => {
      if (!confirm("Delete your entire profile and settings?")) return;
      await chrome.storage.local.clear();
      status("All data deleted.", "#f87171");
      renderProfileView({});
    };
  }
}

// Tab navigation
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const tabPane = document.getElementById(btn.dataset.tab);
      if (tabPane) tabPane.classList.add("active");
      if (btn.dataset.tab === "tab-ai") renderAIPanel();
      if (btn.dataset.tab === "tab-settings") renderSettings();
    };
  });
}

// Initialize
async function init() {
  initTabs();

  const profile = await getProfile();
  renderProfileView(profile);

  // Upload button
  const parseBtn = document.getElementById("parse-resume");
  if (parseBtn) {
    parseBtn.onclick = async () => {
      const fileInput = document.getElementById("resume-upload");
      const file = fileInput?.files[0];
      if (!file) { status("Choose a file first.", "#f87171"); return; }
      status("Parsing…");
      try {
        const text = await extractTextFromFile(file);
        const parsed = parseResumeText(text);
        const current = await getProfile();
        const merged = { ...parsed, ...Object.fromEntries(Object.entries(current).filter(([,v]) => v)) };
        await setProfile(merged);
        renderProfileView(merged);
        status(`Profile updated (${Object.keys(parsed).length} fields found).`, "#4ade80");
      } catch (err) {
        status("Parse error: " + err.message, "#f87171");
      }
    };
  }

  // Autofill button
  const autofillBtn = document.getElementById("autofill-btn");
  if (autofillBtn) {
    autofillBtn.onclick = async () => {
      const profileData = await getProfile();
      if (!Object.keys(profileData).length) {
        status("No profile. Upload resume first.", "#f87171");
        return;
      }
      chrome.runtime.sendMessage({ type: "TRIGGER_AUTOFILL", profile: profileData });
      status("Autofilling…");
    };
  }

  // Delete button
  const deleteBtn = document.getElementById("delete-resume");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm("Delete your profile?")) return;
      await chrome.storage.local.remove("fcv_profile");
      renderProfileView({});
      status("Profile deleted.", "#f87171");
    };
  }

  // Modal handlers
  const modalSave = document.getElementById("modal-save");
  const modalCancel = document.getElementById("modal-cancel");
  const modalOverlay = document.getElementById("modal-overlay");
  
  if (modalSave) {
    modalSave.onclick = async () => {
      const key = document.getElementById("modal-key")?.value;
      const val = document.getElementById("modal-input")?.value.trim();
      if (!key || !val) return;
      await updateProfile({ [key]: val });
      closeModal();
      renderProfileView(await getProfile());
      status("Updated.", "#4ade80");
    };
  }
  
  if (modalCancel) modalCancel.onclick = closeModal;
  if (modalOverlay) {
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_FIELD_LEARNED") {
      showLearnBanner(msg.key, msg.value, msg.fieldLabel);
    }
    if (msg.type === "AUTOFILL_DONE") {
      status(`Filled ${msg.filled}/${msg.total} fields.`, "#4ade80");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);