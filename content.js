// content.js — injected into every page: detects job application forms,
// autofills them from the stored profile, and learns fields the user edits.

(() => {
  "use strict";

  // Falls back to an inline copy if field_registry.js fails to load first.
  const FIELD_REGISTRY = window.FCV_FIELD_REGISTRY || {
    full_name:        { patterns: ["full name", "your name", "applicant name"] },
    first_name:       { patterns: ["first name", "given name", "forename"] },
    last_name:        { patterns: ["last name", "surname", "family name"] },
    email:            { patterns: ["email address", "email", "e-mail", "mail"] },
    phone:            { patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"] },
    location:         { patterns: ["current location", "where are you based", "city", "location", "address"] },
    linkedin:         { patterns: ["linkedin profile", "linkedin url", "linkedin"] },
    github:           { patterns: ["github url", "github profile", "github"] },
    portfolio:        { patterns: ["portfolio url", "portfolio", "website", "personal url", "personal site"] },
    summary:          { patterns: ["professional summary", "profile summary", "about yourself", "tell us about yourself", "describe yourself", "summary", "bio"] },
    headline:         { patterns: ["current position", "current role", "job title", "designation", "headline"] },
    years_experience: { patterns: ["years of experience", "total experience", "how many years"] },
    current_company:  { patterns: ["current organization", "current employer", "current company", "employer"] },
    current_role:     { patterns: ["current designation", "current position", "current title", "current role"] },
    work_history:     { patterns: ["employment history", "work history", "past experience"] },
    projects:         { patterns: ["notable projects", "key projects", "personal projects", "project experience", "projects"] },
    degree:           { patterns: ["highest qualification", "academic qualification", "qualification", "education", "degree"] },
    university:       { patterns: ["university", "college", "institution", "school", "alma mater"] },
    graduation_year:  { patterns: ["graduation year", "year of graduation", "passed out", "batch"] },
    major:            { patterns: ["field of study", "specialization", "stream", "branch", "course", "major"] },
    skills:           { patterns: ["technical skills", "tech stack", "technologies", "competencies", "expertise", "tools", "skills"] },
    languages:        { patterns: ["programming languages", "languages known", "coding languages"] },
    cover_letter:     { patterns: ["motivation letter", "statement of purpose", "cover letter", "why should we hire"] },
    motivation:       { patterns: ["reason for applying", "what interests you", "why are you interested", "why this company", "why this role", "why do you want"] },
    strengths:        { patterns: ["greatest strengths", "what are your strengths", "key strengths", "strengths"] },
    achievements:     { patterns: ["accomplishments", "proud of", "achievements"] },
    certifications:   { patterns: ["certifications", "certificates", "licenses", "credentials"] },
    awards:           { patterns: ["awards", "honors", "honours", "recognitions"] },
    salary:           { patterns: ["salary expectation", "expected salary", "expected ctc", "compensation", "ctc"] },
    notice_period:    { patterns: ["when can you join", "notice period", "availability", "how soon"] },
  };

  const SKIP_LEARNING  = new Set(["notice_period", "cover_letter", "motivation"]);
  // Never autofill these (user must generate them per-job)
  const SKIP_AUTOFILL  = new Set(["cover_letter", "motivation", "notice_period", "salary"]);

  function matchFieldKey(labelText) {
    const norm = labelText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    let best = null, bestScore = 0;
    for (const [key, meta] of Object.entries(FIELD_REGISTRY)) {
      for (const pattern of meta.patterns) {
        if (norm.includes(pattern)) {
          const score = pattern.length; // longer pattern = more specific = preferred
          if (score > bestScore) { bestScore = score; best = key; }
        }
      }
    }
    return best;
  }

  // ── Job application page detector ──────────────────────────────────────────
  // Only shows the banner with confident evidence of both a job/career page
  // AND real fillable application fields (not a login/search/newsletter form).

  const ATS_URL_SIGNALS = [
    "greenhouse.io", "lever.co", "ashby.io", "ashbyhq.com",
    "workday.com", "bamboohr.com", "smartrecruiters.com", "jobvite.com",
    "icims.com", "taleo.net", "successfactors.com", "recruitee.com",
    "workable.com", "breezy.hr", "pinpoint.one", "dover.io", "rippling.com"
  ];
  const CAREER_PATH_SIGNALS = [
    "/apply", "/application", "/careers", "/jobs/", "/job/", "/hiring",
    "/recruit", "/talent", "/candidate"
  ];
  // Phrases that strongly suggest an application form (not a job listing)
  const APPLICATION_PHRASES = [
    "apply for this job", "submit application", "submit your application",
    "job application", "apply now", "upload resume", "upload cv",
    "upload your resume", "work authorization", "cover letter",
    "equal opportunity", "candidate information"
  ];
  // Paths that indicate browsing/searching/auth rather than an application form
  const EXCLUDE_PATH_SIGNALS = [
    "/search", "/browse", "/explore", "/jobs/list", "/jobs/search",
    "/job-listings", "/login", "/signin", "/sign-in", "/signup", "/register"
  ];

  const PERSONAL_FIELD_PATTERNS = [
    "first name", "last name", "full name", "email", "phone", "mobile",
    "linkedin", "address", "city", "location"
  ];
  const APPLICATION_FIELD_PATTERNS = [
    "resume", "cv", "cover letter", "why do you want", "why are you",
    "work authorization", "authorized to work", "years of experience",
    "current salary", "expected salary", "notice period", "start date",
    "how did you hear", "linkedin", "github", "portfolio"
  ];

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Tries every common way a form field gets labeled and picks the longest
  // (most informative) match, since no single source is reliable across sites.
  function getLabelText(el) {
    const candidates = [];

    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) candidates.push(lbl.innerText || lbl.textContent);
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) candidates.push(ariaLabel);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const refText = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.innerText || ref.textContent || "").trim() : "";
      }).filter(Boolean).join(" ");
      if (refText) candidates.push(refText);
    }
    if (el.placeholder) candidates.push(el.placeholder);
    if (el.name) candidates.push(el.name.replace(/[_\-]/g, " "));
    if (el.id)   candidates.push(el.id.replace(/[_\-]/g, " "));
    const parentLabel = el.closest("label");
    if (parentLabel) candidates.push(parentLabel.innerText || parentLabel.textContent);
    // Common builder pattern: <div>Label</div><input> with no <label> element at all
    const prev = el.previousElementSibling;
    if (prev && !["INPUT","SELECT","TEXTAREA","BUTTON"].includes(prev.tagName)) {
      const t = (prev.innerText || prev.textContent || "").trim();
      if (t) candidates.push(t);
    }
    const wrapper = el.closest('[class*="field"],[class*="form-group"],[class*="input-wrap"],[class*="form-item"],[class*="question"]');
    if (wrapper) {
      for (const child of wrapper.children) {
        if (!["INPUT","SELECT","TEXTAREA","BUTTON"].includes(child.tagName)) {
          const t = (child.innerText || child.textContent || "").trim();
          if (t && t.length < 100) { candidates.push(t); break; }
        }
      }
    }

    return candidates
      .map(c => (c || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function scoreJobPage() {
    const url   = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    let pageScore = 0;
    let formScore = 0;

    if (EXCLUDE_PATH_SIGNALS.some(p => url.includes(p))) return { pageScore: 0, formScore: 0, hasResumeUpload: false };

    // A login form without a resume upload is not an application form.
    const hasPassword = document.querySelector("input[type=password]");
    const hasResumeUploadEl = [...document.querySelectorAll("input[type=file]")].find(el => {
      if (!isVisible(el)) return false;
      const lbl = getLabelText(el).toLowerCase();
      return /resume|cv|curriculum/.test(lbl);
    });
    if (hasPassword && !hasResumeUploadEl) return { pageScore: 0, formScore: 0, hasResumeUpload: false };

    if (ATS_URL_SIGNALS.some(d => url.includes(d))) pageScore += 3;
    if (CAREER_PATH_SIGNALS.some(p => url.includes(p))) pageScore += 2;
    if (/apply|application|candidate|job\s*form/.test(title)) pageScore += 1;

    // Only scan the first 4000 chars of body text — enough signal, keeps this cheap.
    const bodySnippet = (document.body?.innerText || "").toLowerCase().slice(0, 4000);
    const phraseMatches = APPLICATION_PHRASES.filter(p => bodySnippet.includes(p)).length;
    if (phraseMatches >= 2) pageScore += 1;
    if (phraseMatches >= 4) pageScore += 1;

    const hasResumeUpload = !!hasResumeUploadEl;
    if (hasResumeUpload) formScore += 3;

    const inputEls = [...document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=password]):not([type=file]), textarea, select"
    )].filter(isVisible);

    let personalMatches = 0;
    let applicationMatches = 0;
    const seen = new WeakSet();

    for (const el of inputEls) {
      if (seen.has(el)) continue;
      seen.add(el);
      const lbl = getLabelText(el).toLowerCase();
      if (!lbl) continue;

      if (el.type === "search" || /^search$/.test(el.getAttribute("role") || "")) continue;
      if (/\bsearch\b/.test(el.name || "") || /\bsearch\b/.test(el.id || "")) continue;

      if (PERSONAL_FIELD_PATTERNS.some(p => lbl.includes(p))) personalMatches++;
      if (APPLICATION_FIELD_PATTERNS.some(p => lbl.includes(p))) applicationMatches++;
    }

    formScore += Math.min(personalMatches, 4);
    formScore += Math.min(applicationMatches * 2, 4);
    if (personalMatches + applicationMatches >= 3) formScore += 1;

    return { pageScore, formScore, hasResumeUpload };
  }

  function shouldShowBanner() {
    const { pageScore, formScore, hasResumeUpload } = scoreJobPage();

    if (pageScore >= 3 && formScore >= 2) return true;
    if (pageScore >= 2 && formScore >= 3) return true;
    if (hasResumeUpload && formScore >= 3) return true;

    return false;
  }

  // ── Field discovery + autofill ───────────────────────────────────────────────

  function discoverFields() {
    const results = [];
    const seen = new WeakSet();

    const inputs = document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select"
    );

    for (const el of inputs) {
      if (seen.has(el)) continue;
      if (!isVisible(el)) continue;
      seen.add(el);

      const labelText = getLabelText(el);
      if (!labelText) continue;

      const key = matchFieldKey(labelText);
      if (key) {
        results.push({ element: el, key, labelText });
      }
    }

    return results;
  }

  function fillElement(el, value) {
    if (!value) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const norm = value.toLowerCase().trim();
      if (!norm) return false;
      // Empty-text options (e.g. a blank "-- Select --" placeholder) would
      // otherwise trivially satisfy norm.includes(""), matching first.
      const opts = [...el.options].filter(o => o.text && o.text.trim());
      const exact = opts.find(o => o.text.toLowerCase().trim() === norm);
      const match = exact || opts
        .filter(o => o.text.toLowerCase().includes(norm) || norm.includes(o.text.toLowerCase()))
        .sort((a, b) => b.text.length - a.text.length)[0];
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }
    // Native setter needed so React/Vue's tracked value updates and their listeners fire.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
    return true;
  }

  function doAutofill(profile) {
    const fields = discoverFields();
    let filled = 0, skipped = [];

    for (const { element, key } of fields) {
      if (SKIP_AUTOFILL.has(key)) { skipped.push(key); continue; }
      const value = profile[key];
      if (value && fillElement(element, value)) {
        element.style.transition = "box-shadow 0.4s";
        element.style.boxShadow  = "0 0 0 2px #fdb14c";
        setTimeout(() => { element.style.boxShadow = ""; }, 2000);
        filled++;
      }
    }

    return { filled, skipped, total: fields.length };
  }

  // ── Learning from fields the user fills in manually ──────────────────────────

  const watchedFields = new Map(); // element → key

  function watchForLearning(fields) {
    for (const { element, key } of fields) {
      if (SKIP_LEARNING.has(key)) continue;
      watchedFields.set(element, key);
      element.addEventListener("change", onFieldChange);
      element.addEventListener("blur",   onFieldChange);
    }
  }

  async function onFieldChange(e) {
    const el  = e.target;
    const key = watchedFields.get(el);
    if (!key || !el.value.trim()) return;

    const stored = await getProfile();
    const newVal = el.value.trim();
    if (stored[key] === newVal) return;
    // Bare digits are usually noise from rating widgets/counters, not real field data.
    if (/^\d+$/.test(newVal) && !["phone", "graduation_year", "years_experience"].includes(key)) return;
    if (newVal.length < 2) return;

    chrome.runtime.sendMessage({
      type: "NEW_FIELD_LEARNED",
      key,
      value: newVal,
      fieldLabel: FIELD_REGISTRY[key]?.label || key
    });
  }

  function getProfile() {
    return new Promise(res => chrome.storage.local.get("fcv_profile", d => res(d.fcv_profile || {})));
  }

  // ── Autofill prompt banner ────────────────────────────────────────────────────

  let bannerShown = false;

  function showAutofillBanner() {
    if (bannerShown || document.getElementById("fcv-banner")) return;
    bannerShown = true;

    const banner = document.createElement("div");
    banner.id = "fcv-banner";

    const iconSpan = document.createElement("span");
    iconSpan.className = "fcv-icon";
    iconSpan.textContent = "✦";
    banner.appendChild(iconSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "fcv-text";
    textSpan.textContent = "FeelCV detected a job form";
    banner.appendChild(textSpan);

    const fillBtn = document.createElement("button");
    fillBtn.className = "fcv-btn";
    fillBtn.id = "fcv-fill-btn";
    fillBtn.textContent = "Autofill";
    banner.appendChild(fillBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "fcv-close";
    closeBtn.id = "fcv-close-btn";
    closeBtn.textContent = "✕";
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);

    closeBtn.onclick = () => banner.remove();
    fillBtn.onclick = async () => {
      const profile = await getProfile();
      if (!Object.keys(profile).length) {
        textSpan.textContent = "No profile found. Upload your resume first.";
        return;
      }
      const result = doAutofill(profile);
      const fields = discoverFields();
      watchForLearning(fields);
      textSpan.textContent = `Filled ${result.filled} of ${result.total} fields`;
      setTimeout(() => banner.remove(), 3000);
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DO_AUTOFILL") {
      const result = doAutofill(message.profile);
      const fields = discoverFields();
      watchForLearning(fields);
      chrome.runtime.sendMessage({ type: "AUTOFILL_DONE", ...result });
    }
    if (message.type === "RE_DETECT") {
      bannerShown = false;
      detectionCache = null;
      initDetection();
    }
  });

  let detectionObserver = null;
  let detectionCache    = null; // { result: bool, ts: number }
  const CACHE_TTL_MS   = 5000;
  const DEBOUNCE_MS    = 600;
  const OBSERVER_TIMEOUT_MS = 20000;

  function tryDetectAndShowBanner() {
    if (bannerShown) return;

    if (detectionCache && (Date.now() - detectionCache.ts) < CACHE_TTL_MS) {
      if (detectionCache.result) showAutofillBanner();
      return;
    }

    const result = shouldShowBanner();
    detectionCache = { result, ts: Date.now() };

    if (result) {
      bannerShown = true;
      if (detectionObserver) {
        detectionObserver.disconnect();
        detectionObserver = null;
      }
      chrome.runtime.sendMessage({ type: "JOB_PAGE_DETECTED" });
      setTimeout(showAutofillBanner, 500);
    }
  }

  function initDetection() {
    if (detectionObserver) {
      detectionObserver.disconnect();
      detectionObserver = null;
    }

    tryDetectAndShowBanner();
    if (bannerShown) return;

    // SPAs render the form after initial load, so keep watching until it appears.
    let debounceTimer = null;
    detectionObserver = new MutationObserver(() => {
      if (bannerShown) {
        detectionObserver.disconnect();
        detectionObserver = null;
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        tryDetectAndShowBanner();
      }, DEBOUNCE_MS);
    });

    detectionObserver.observe(document.body, { childList: true, subtree: true });

    // Hard stop — release resources after timeout
    setTimeout(() => {
      if (detectionObserver) {
        detectionObserver.disconnect();
        detectionObserver = null;
      }
    }, OBSERVER_TIMEOUT_MS);
  }

  initDetection();

})();