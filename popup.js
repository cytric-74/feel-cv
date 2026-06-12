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

const FIELD_REGISTRY = {
  full_name: { label: "Full Name", patterns: ["name", "full name", "your name", "applicant name"] },
  first_name: { label: "First Name", patterns: ["first name", "given name", "forename"] },
  last_name: { label: "Last Name", patterns: ["last name", "surname", "family name"] },
  email: { label: "Email", patterns: ["email", "e-mail", "mail", "email address"] },
  phone: { label: "Phone", patterns: ["phone", "mobile", "cell", "telephone", "contact number"] },
  location: { label: "Location / City", patterns: ["city", "location", "address", "where are you based", "current location"] },
  linkedin: { label: "LinkedIn URL", patterns: ["linkedin", "linkedin url", "linkedin profile"] },
  github: { label: "GitHub URL", patterns: ["github", "github url", "portfolio", "website", "personal site"] },
  portfolio: { label: "Portfolio URL", patterns: ["portfolio", "website", "personal site", "personal url"] },
  summary: { label: "About / Summary", patterns: ["summary", "about yourself", "about you", "brief bio", "profile summary", "professional summary", "tell us about yourself", "short bio", "bio", "describe yourself"] },
  headline: { label: "Professional Headline", patterns: ["headline", "title", "job title", "current role", "current position", "designation"] },
  years_experience: { label: "Years of Experience", patterns: ["years of experience", "total experience", "how many years", "work experience"] },
  current_company: { label: "Current Employer", patterns: ["current company", "current employer", "current organization", "employer"] },
  current_role: { label: "Current Job Title", patterns: ["current role", "current position", "current title", "current designation"] },
  work_history: { label: "Work History", patterns: ["work history", "employment history", "past experience", "previous companies"] },
  degree: { label: "Degree", patterns: ["degree", "qualification", "education", "highest qualification", "academic qualification"] },
  university: { label: "University / College", patterns: ["university", "college", "institution", "school", "alma mater"] },
  graduation_year: { label: "Graduation Year", patterns: ["graduation year", "year of graduation", "passed out", "batch"] },
  major: { label: "Field of Study", patterns: ["major", "field of study", "specialization", "stream", "branch", "course"] },
  skills: { label: "Skills", patterns: ["skills", "technologies", "tech stack", "tools", "expertise", "competencies", "technical skills"] },
  languages: { label: "Programming Languages", patterns: ["programming languages", "languages known", "coding languages"] },
  cover_letter: { label: "Cover Letter", patterns: ["cover letter", "why should we hire", "motivation letter", "statement of purpose"] },
  motivation: { label: "Why this role / company", patterns: ["why do you want", "why are you interested", "why this company", "why this role", "what attracts you", "what interests you", "reason for applying"] },
  strengths: { label: "Key Strengths", patterns: ["strengths", "greatest strengths", "what are your strengths", "key strengths"] },
  achievements: { label: "Achievements", patterns: ["achievements", "accomplishments", "notable projects", "key projects", "proud of"] },
  salary: { label: "Expected Salary", patterns: ["expected salary", "salary expectation", "ctc", "expected ctc", "compensation"] },
  notice_period: { label: "Notice Period", patterns: ["notice period", "when can you join", "availability", "how soon"] },
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
        profile.last_name = parts[parts.length - 1];
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
    if (filledFields === 0) {
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
    updateProfileStats(await getProfile());
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

async function init() {
  initTabs();

  const profile = await getProfile();
  renderProfileView(profile);

  const fileInput = document.getElementById("resume-upload");
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      status("Parsing…");
      try {
        const text = await extractTextFromFile(file);
        const parsed = parseResumeText(text);
        const current = await getProfile();
        const merged = { ...parsed, ...Object.fromEntries(Object.entries(current).filter(([, v]) => v)) };
        await setProfile(merged);
        await chrome.storage.local.set({ fcv_filename: file.name });
        renderProfileView(merged);
        status(`Profile updated (${Object.keys(parsed).length} fields found).`, "#FF8030");
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
    welcomeStartBtn.onclick = () => {
      const welcomeScreen = document.getElementById("welcome-screen");
      if (welcomeScreen) welcomeScreen.classList.add("hidden");
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