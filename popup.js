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

// Fallback if field_registry.js fails to load — just enough to not crash.
const FIELD_REGISTRY = window.FCV_FIELD_REGISTRY || {
  full_name: { label: "Full Name", patterns: ["full name", "your name", "applicant name"] },
  first_name: { label: "First Name", patterns: ["first name", "given name", "forename"] },
  last_name: { label: "Last Name", patterns: ["last name", "surname", "family name"] },
  email: { label: "Email", patterns: ["email address", "email", "e-mail", "mail"] },
  phone: { label: "Phone", patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"] },
  location: { label: "Location / City", patterns: ["current location", "where are you based", "city", "location", "address"] },
};

const AI_GENERATED_FIELDS = new Set(["cover_letter", "motivation", "strengths", "achievements", "summary"]);

const getProfile = () => storageGet("fcv_profile").then(p => p || {});
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

// Text parsing lives in resume_parser.js, loaded before this script.
async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") return extractPDF(file); // normalizes internally
  let raw;
  if (ext === "txt") raw = await file.text();
  else if (ext === "docx") raw = await extractDOCX(file);
  else throw new Error("Unsupported file type: " + ext);
  return normalizeResumeText(raw);
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

    // PDF.js gives text in stream order, not reading order. Group into lines
    // by Y position (with tolerance for jitter), then sort each line by X.
    const Y_TOLERANCE = 2;
    const lineMap = new Map(); // quantised-Y → [{ x, str }]

    for (const item of content.items) {
      if (!item.str) continue;
      const rawY = item.transform[5];
      const x    = item.transform[4];

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

    // PDF Y grows upward, so sort descending to get top-to-bottom order.
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    const lines = sortedYs.map(y => {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x);
      return items.map(it => it.str).join(" ").trim();
    }).filter(Boolean);

    pageTexts.push(lines.join("\n"));
  }

  return normalizeResumeText(pageTexts.join("\n"));
}

async function extractDOCX(file) {
  if (!window.mammoth) throw new Error("mammoth not loaded");
  const ab = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: ab });
  return result.value;
}

// Structured parsing and AI prompt/merge logic live in resume_parser.js.
function buildPrompt(fieldKey, profile, jobTitle, company, structured) {
  const { email, phone, ...safeProfile } = profile;
  let context = safeProfile;
  if (structured && Object.keys(structured).length) {
    const { email: _e, phone: _p, ...safeStructured } = structured;
    context = safeStructured;
  }
  const p = JSON.stringify(context);
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
  const structured = await storageGet("fcv_profile_structured");
  const prompt = buildPrompt(fieldKey, profile, jobTitle, company, structured);

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

// Builds an element in one call instead of create/assign/appendChild per line.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style" || k === "dataset") Object.assign(node[k], v);
    else node[k] = v;
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const storageGet = (key) => new Promise(r => chrome.storage.local.get(key, d => r(d[key])));

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

// Generated per-job, not extracted from a resume, so excluded from completeness.
const NON_RESUME_FIELDS = new Set(["salary", "notice_period", "cover_letter", "motivation"]);

async function updateProfileStats(profile) {
  const coreKeys = Object.keys(FIELD_REGISTRY).filter(k => !NON_RESUME_FIELDS.has(k));
  const filledFields = coreKeys.filter(k => profile[k] && String(profile[k]).trim()).length;
  const totalFields = coreKeys.length;

  const percentEl = document.getElementById("hero-percent");
  if (percentEl) {
    percentEl.textContent = `${filledFields}`;
  }

  const countEl = document.getElementById("hero-field-count-text");
  if (countEl) {
    countEl.textContent = `${filledFields} / ${totalFields} core fields filled`;
  }

  const structured = await storageGet("fcv_profile_structured");
  const sectionsEl = document.getElementById("stat-sections");
  if (sectionsEl) {
    const arrays = structured ? [structured.experience, structured.projects, structured.education, structured.certifications, structured.awards] : [];
    const detected = arrays.filter(a => Array.isArray(a) && a.length > 0).length;
    sectionsEl.textContent = `${detected} / 5`;
  }

  const missingEl = document.getElementById("stat-optional-missing");
  if (missingEl) {
    missingEl.textContent = `${totalFields - filledFields}`;
  }

  const welcomeScreen = document.getElementById("welcome-screen");
  if (welcomeScreen) {
    const dismissed = await storageGet("fcv_welcome_dismissed");
    if (filledFields === 0 && !dismissed) {
      welcomeScreen.classList.remove("hidden");
    } else {
      welcomeScreen.classList.add("hidden");
    }
  }

  const badgeStatus = document.getElementById("badge-status");
  const filename = await storageGet("fcv_filename");
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
    container.appendChild(el("div", { className: "empty-state", textContent: "No profile yet. Select a file to begin." }));
    updateProfileStats({});
    return;
  }

  keys.forEach(key => {
    const meta = FIELD_REGISTRY[key];
    const label = meta?.label || key;
    const val = profile[key] || "";

    container.appendChild(el("div", { className: "profile-row", dataset: { key } }, [
      el("span", { className: "field-label", textContent: label }),
      el("span", { className: "field-value", title: val, textContent: val.length > 60 ? val.slice(0, 57) + "…" : val }),
      el("button", { className: "edit-btn", dataset: { key }, textContent: "[ EDIT ]", onclick: () => openEditModal(key, val) }),
    ]));
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
  const banner = el("div", { className: "learn-banner" }, [
    el("span", { textContent: `💡 Learn "${fieldLabel}"?` }),
    el("div", { className: "learn-val", textContent: value.slice(0, 80) + (value.length > 80 ? "…" : "") }),
    el("div", { className: "learn-btns" }, [
      el("button", { className: "btn-yes", textContent: "Save", onclick: async () => {
        await updateProfile({ [key]: value });
        banner.remove();
        status("Learned: " + (FIELD_REGISTRY[key]?.label || key), "#FF8030");
        renderProfileView(await getProfile());
      } }),
      el("button", { className: "btn-no", textContent: "Dismiss", onclick: () => banner.remove() }),
    ]),
  ]);

  const queue = $("learn-queue");
  if (queue) queue.prepend(banner);
}

async function renderAIPanel() {
  const profile = await getProfile();
  const container = $("ai-content");
  if (!container) return;

  if (!Object.keys(profile).length) {
    container.textContent = "";
    container.appendChild(el("div", { className: "empty-state", textContent: "Upload your resume first." }));
    return;
  }

  container.textContent = "";

  const jobTitleInput = el("input", { id: "ai-job-title", placeholder: "Job title (e.g. Frontend Engineer)", className: "ai-input" });
  const companyInput = el("input", { id: "ai-company", placeholder: "Company name (optional)", className: "ai-input" });
  container.appendChild(el("div", { className: "ai-form" }, [jobTitleInput, companyInput]));

  const resultArea = el("div", { id: "ai-result-area", className: "ai-result hidden" });

  const fieldBtns = el("div", { className: "ai-field-btns" },
    [...AI_GENERATED_FIELDS].map(k => {
      const btn = el("button", { className: "ai-gen-btn", textContent: (FIELD_REGISTRY[k]?.label || k).toUpperCase() });
      btn.onclick = async () => {
        const jobTitle = jobTitleInput.value.trim();
        const company = companyInput.value.trim();

        resultArea.classList.remove("hidden");
        resultArea.textContent = "Generating…";
        btn.disabled = true;
        try {
          const text = await generateWithAI(k, profile, jobTitle, company);
          resultArea.textContent = "";

          const copyBtn = el("button", { className: "copy-btn", textContent: "Copy" });
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(text);
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
          };

          resultArea.appendChild(el("div", { className: "result-label", textContent: FIELD_REGISTRY[k]?.label }));
          resultArea.appendChild(el("div", { className: "result-text", textContent: text }));
          resultArea.appendChild(copyBtn);
        } catch (err) {
          resultArea.textContent = "Error: " + err.message;
        }
        btn.disabled = false;
      };
      return btn;
    })
  );

  container.appendChild(fieldBtns);
  container.appendChild(resultArea);
}

async function renderSettings() {
  const cfg = await getProviderConfig();
  const container = $("settings-content");
  if (!container) return;

  container.textContent = "";

  const btnOllama = el("button", { className: "provider-btn" + (cfg.provider === "ollama" ? " active" : ""), textContent: "Ollama (Local)" });
  const btnExt = el("button", { className: "provider-btn" + (cfg.provider === "openai_compat" ? " active" : ""), textContent: "External API" });

  const inputUrl = el("input", { id: "ollama-url", className: "ai-input", value: cfg.ollamaUrl, placeholder: "http://localhost:11434" });
  const inputModel = el("input", { id: "ollama-model", className: "ai-input", value: cfg.ollamaModel, placeholder: "llama3.2" });
  const testBtn = el("button", { id: "test-ollama-btn", className: "pill-btn secondary", textContent: "Test Connection", style: { marginTop: "12px", width: "100%" } });
  const testResult = el("div", { id: "ollama-test-result", style: { fontSize: "11px", marginTop: "8px", fontWeight: "700" } });

  const ollamaDiv = el("div", { className: cfg.provider !== "ollama" ? "hidden" : "" }, [
    el("div", { className: "privacy-badge", textContent: "✦ Your data never leaves your device" }),
    el("label", { className: "settings-label", textContent: "Ollama URL" }),
    inputUrl,
    el("label", { className: "settings-label", textContent: "Model" }),
    inputModel,
    el("div", { className: "settings-hint", textContent: "Install: brew install ollama or ollama.com\nPull model: ollama pull llama3.2\nStart: ollama serve" }),
    testBtn,
    testResult,
  ]);

  const inputFallbackUrl = el("input", { id: "fallback-url", className: "ai-input", value: cfg.fallbackUrl, placeholder: "https://api.groq.com/openai/v1" });
  const inputFallbackModel = el("input", { id: "fallback-model", className: "ai-input", value: cfg.fallbackModel, placeholder: "llama-3.1-8b-instant" });
  const inputApiKey = el("input", { id: "ext-api-key", type: "password", className: "ai-input", value: cfg.apiKey, placeholder: "sk-..." });

  const extDiv = el("div", { className: cfg.provider !== "openai_compat" ? "hidden" : "" }, [
    el("div", { className: "privacy-badge warn", textContent: "⚠ Profile data will be sent externally" }),
    el("label", { className: "settings-label", textContent: "Base URL" }),
    inputFallbackUrl,
    el("label", { className: "settings-label", textContent: "Model" }),
    inputFallbackModel,
    el("label", { className: "settings-label", textContent: "API Key" }),
    inputApiKey,
    el("div", { className: "settings-hint", textContent: "Works with: Groq · OpenRouter · Together · OpenAI · any OpenAI-compatible endpoint." }),
  ]);

  const saveBtn = el("button", { id: "save-provider-btn", className: "pill-btn primary", textContent: "Save Settings", style: { marginTop: "16px", width: "100%" } });

  const section1 = el("div", { className: "settings-section" }, [
    el("div", { className: "settings-section-title", textContent: "AI Provider" }),
    el("div", { className: "provider-toggle" }, [btnOllama, btnExt]),
    ollamaDiv,
    extDiv,
    saveBtn,
  ]);
  container.appendChild(section1);
  container.appendChild(el("hr", { className: "divider" }));

  const exportBtn = el("button", { id: "export-profile-btn", className: "pill-btn secondary", textContent: "Export JSON", style: { flex: "1" } });
  const nukeBtn = el("button", { id: "nuke-btn", className: "pill-btn danger", textContent: "Delete All", style: { flex: "1" } });

  container.appendChild(el("div", { className: "settings-section" }, [
    el("div", { className: "settings-section-title", textContent: "Profile Data" }),
    el("div", { style: { display: "flex", gap: "10px" } }, [exportBtn, nukeBtn]),
  ]));

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

// Sends the resume to the AI and returns its raw parsed JSON response.
async function parseResumeWithAI(resumeText) {
  const cfg = await getProviderConfig();
  const prompt = FCV_buildAIPrompt(resumeText);

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

        // Instant local parse first, no AI required.
        const structured = FCV_buildStructuredProfile(text);
        let flat = FCV_deriveFlatProfile(structured);

        // Save right away so the UI updates fast, keeping existing values.
        const current = await getProfile();
        flat = { ...flat, ...Object.fromEntries(Object.entries(current).filter(([, v]) => v)) };
        await setProfile(flat);
        await chrome.storage.local.set({ fcv_filename: file.name, fcv_profile_structured: structured });
        await renderProfileView(flat);
        status("Basic profile extracted locally. Connect AI for deeper enrichment.", "#FF8030");

        // Then enrich with AI in the background, if configured.
        try {
          const cfg = await getProviderConfig();
          const isOllama = cfg.provider === "ollama";
          const hasApiKey = cfg.provider === "openai_compat" && cfg.apiKey;

          if (isOllama || hasApiKey) {
            status("Enriching profile with AI…");
            const parsedAI = await parseResumeWithAI(text);

            const structuredNow = (await storageGet("fcv_profile_structured")) || structured;
            const mergedStructured = FCV_mergeAIIntoStructured(structuredNow, parsedAI);
            const mergedFlat = FCV_deriveFlatProfile(mergedStructured);

            // Never overwrite already-trusted contact fields with AI values.
            const currentProfile = await getProfile();
            const PROTECTED_KEYS = new Set(["email", "phone", "linkedin", "github", "portfolio"]);
            const finalProfile = { ...currentProfile };
            for (const key of Object.keys(mergedFlat)) {
              if (!PROTECTED_KEYS.has(key) || !finalProfile[key]) {
                finalProfile[key] = mergedFlat[key];
              }
            }

            await setProfile(finalProfile);
            await chrome.storage.local.set({ fcv_profile_structured: mergedStructured });
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
      await chrome.storage.local.remove(["fcv_profile", "fcv_filename", "fcv_profile_structured"]);
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