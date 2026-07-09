// content.js — Injected into every page
// Responsibilities:
//   1. Score-based detection: only show banner on real job application pages
//   2. On autofill command: find form fields, match to profile, fill them
//   3. Watch fields the user manually fills → learn new profile data
//   4. Show an unobtrusive autofill prompt when a job form is confidently detected

(() => {
  "use strict";

  // ── Field registry ────────────────────────────────────────────────────────
  // Loaded from field_registry.js (injected before this script by manifest).
  // Fall back to a minimal inline copy if the load order ever breaks.
  const FIELD_REGISTRY = window.FCV_FIELD_REGISTRY || {
    full_name:        { patterns: ["full name", "your name", "applicant name", "name"] },
    first_name:       { patterns: ["first name", "given name", "forename"] },
    last_name:        { patterns: ["last name", "surname", "family name"] },
    email:            { patterns: ["email address", "email", "e-mail", "mail"] },
    phone:            { patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"] },
    location:         { patterns: ["current location", "where are you based", "city", "location", "address"] },
    linkedin:         { patterns: ["linkedin profile", "linkedin url", "linkedin"] },
    github:           { patterns: ["github url", "github", "portfolio", "website", "personal site"] },
    portfolio:        { patterns: ["portfolio url", "portfolio", "website", "personal url"] },
    summary:          { patterns: ["professional summary", "profile summary", "about yourself", "tell us about yourself", "describe yourself", "summary", "bio"] },
    headline:         { patterns: ["current position", "current role", "job title", "designation", "headline"] },
    years_experience: { patterns: ["years of experience", "total experience", "how many years"] },
    current_company:  { patterns: ["current organization", "current employer", "current company", "employer"] },
    current_role:     { patterns: ["current designation", "current position", "current title", "current role"] },
    work_history:     { patterns: ["employment history", "work history", "past experience"] },
    degree:           { patterns: ["highest qualification", "academic qualification", "qualification", "education", "degree"] },
    university:       { patterns: ["university", "college", "institution", "school", "alma mater"] },
    graduation_year:  { patterns: ["graduation year", "year of graduation", "passed out", "batch"] },
    major:            { patterns: ["field of study", "specialization", "stream", "branch", "course", "major"] },
    skills:           { patterns: ["technical skills", "tech stack", "technologies", "competencies", "expertise", "tools", "skills"] },
    languages:        { patterns: ["programming languages", "languages known", "coding languages"] },
    cover_letter:     { patterns: ["motivation letter", "statement of purpose", "cover letter", "why should we hire"] },
    motivation:       { patterns: ["reason for applying", "what interests you", "why are you interested", "why this company", "why this role", "why do you want"] },
    strengths:        { patterns: ["greatest strengths", "what are your strengths", "key strengths", "strengths"] },
    achievements:     { patterns: ["notable projects", "key projects", "accomplishments", "proud of", "achievements"] },
    salary:           { patterns: ["salary expectation", "expected salary", "expected ctc", "compensation", "ctc"] },
    notice_period:    { patterns: ["when can you join", "notice period", "availability", "how soon"] },
  };

  const SKIP_LEARNING  = new Set(["notice_period", "cover_letter", "motivation"]);
  // Never autofill these (user must generate them per-job)
  const SKIP_AUTOFILL  = new Set(["cover_letter", "motivation", "notice_period", "salary"]);

  // ── Shared label matcher (used by discoverFields + score detector) ────────
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

  // ════════════════════════════════════════════════════════════════════════════
  // SCORE-BASED JOB APPLICATION PAGE DETECTOR
  // Only shows the banner when there is confident evidence of:
  //   a) a job/career page context, AND
  //   b) actual fillable application fields (not login / search / newsletter)
  // ════════════════════════════════════════════════════════════════════════════

  // ATS domains and career-path URL fragments (generic, not site-specific content)
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
  // URL paths that indicate browsing / searching — NOT application forms
  const EXCLUDE_PATH_SIGNALS = [
    "/search", "/browse", "/explore", "/jobs/list", "/jobs/search",
    "/job-listings", "/login", "/signin", "/sign-in", "/signup", "/register"
  ];

  // Personal / application field labels to look for in the DOM
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

  /**
   * Returns true if the element is visible and interactable.
   * Checks display, visibility, opacity, dimensions, and disabled state.
   */
  function isVisible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Collect the best label text for a form element from multiple sources.
   * Returns the longest / most informative string found.
   */
  function getLabelText(el) {
    const candidates = [];

    // 1. <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) candidates.push(lbl.innerText || lbl.textContent);
    }
    // 2. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) candidates.push(ariaLabel);
    // 3. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const refText = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.innerText || ref.textContent || "").trim() : "";
      }).filter(Boolean).join(" ");
      if (refText) candidates.push(refText);
    }
    // 4. placeholder
    if (el.placeholder) candidates.push(el.placeholder);
    // 5. name / id attribute (humanized)
    if (el.name) candidates.push(el.name.replace(/[_\-]/g, " "));
    if (el.id)   candidates.push(el.id.replace(/[_\-]/g, " "));
    // 6. Nearest enclosing <label>
    const parentLabel = el.closest("label");
    if (parentLabel) candidates.push(parentLabel.innerText || parentLabel.textContent);
    // 7. Previous sibling text (common pattern: <div>Label</div><input>)
    const prev = el.previousElementSibling;
    if (prev && !["INPUT","SELECT","TEXTAREA","BUTTON"].includes(prev.tagName)) {
      const t = (prev.innerText || prev.textContent || "").trim();
      if (t) candidates.push(t);
    }
    // 8. Parent / container element with a field-wrapper class
    const wrapper = el.closest('[class*="field"],[class*="form-group"],[class*="input-wrap"],[class*="form-item"],[class*="question"]');
    if (wrapper) {
      // Find the first text-only child (likely the label)
      for (const child of wrapper.children) {
        if (!["INPUT","SELECT","TEXTAREA","BUTTON"].includes(child.tagName)) {
          const t = (child.innerText || child.textContent || "").trim();
          if (t && t.length < 100) { candidates.push(t); break; }
        }
      }
    }

    // Return the longest candidate (most informative)
    return candidates
      .map(c => (c || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  /**
   * Compute page context score and form quality score.
   * Returns { pageScore, formScore, hasResumeUpload }.
   */
  function scoreJobPage() {
    const url   = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    let pageScore = 0;
    let formScore = 0;

    // ── Exclusions: bail early on obviously non-application pages ──────────
    if (EXCLUDE_PATH_SIGNALS.some(p => url.includes(p))) return { pageScore: 0, formScore: 0, hasResumeUpload: false };
    // Login form with no resume upload → exclude
    const hasPassword = document.querySelector("input[type=password]");
    const hasResumeUploadEl = [...document.querySelectorAll("input[type=file]")].find(el => {
      if (!isVisible(el)) return false;
      const lbl = getLabelText(el).toLowerCase();
      return /resume|cv|curriculum/.test(lbl);
    });
    if (hasPassword && !hasResumeUploadEl) return { pageScore: 0, formScore: 0, hasResumeUpload: false };

    // ── Page context score ──────────────────────────────────────────────────
    // Known ATS domain
    if (ATS_URL_SIGNALS.some(d => url.includes(d))) pageScore += 3;
    // Career-related URL path
    if (CAREER_PATH_SIGNALS.some(p => url.includes(p))) pageScore += 2;
    // Title contains application-specific phrase
    if (/apply|application|candidate|job\s*form/.test(title)) pageScore += 1;

    // Body text signals (only scan first 4000 chars for speed)
    const bodySnippet = (document.body?.innerText || "").toLowerCase().slice(0, 4000);
    const phraseMatches = APPLICATION_PHRASES.filter(p => bodySnippet.includes(p)).length;
    if (phraseMatches >= 2) pageScore += 1;
    if (phraseMatches >= 4) pageScore += 1;

    // ── Form quality score ──────────────────────────────────────────────────
    const hasResumeUpload = !!hasResumeUploadEl;
    if (hasResumeUpload) formScore += 3;

    // Collect visible, enabled, non-excluded inputs
    const inputEls = [...document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=password]):not([type=file]), textarea, select"
    )].filter(isVisible);

    // Count personal fields
    let personalMatches = 0;
    let applicationMatches = 0;
    const seen = new WeakSet();

    for (const el of inputEls) {
      if (seen.has(el)) continue;
      seen.add(el);
      const lbl = getLabelText(el).toLowerCase();
      if (!lbl) continue;

      // Skip search-only inputs
      if (el.type === "search" || /^search$/.test(el.getAttribute("role") || "")) continue;
      // Skip single-line inputs that are clearly search boxes by name/id
      if (/\bsearch\b/.test(el.name || "") || /\bsearch\b/.test(el.id || "")) continue;

      const isPersonal     = PERSONAL_FIELD_PATTERNS.some(p => lbl.includes(p));
      const isApplicationF = APPLICATION_FIELD_PATTERNS.some(p => lbl.includes(p));

      if (isPersonal)     personalMatches++;
      if (isApplicationF) applicationMatches++;
    }

    // Score personal fields (up to +4)
    formScore += Math.min(personalMatches, 4);
    // Score application-specific fields (up to +4)
    formScore += Math.min(applicationMatches * 2, 4);
    // Bonus if 3+ matched application fields
    if (personalMatches + applicationMatches >= 3) formScore += 1;

    return { pageScore, formScore, hasResumeUpload };
  }

  /**
   * Returns true if the FeelCV banner should be shown on this page.
   * Requires confident evidence of both a job context AND a real application form.
   */
  function shouldShowBanner() {
    const { pageScore, formScore, hasResumeUpload } = scoreJobPage();

    // Strong ATS page with at least a couple of application fields
    if (pageScore >= 3 && formScore >= 2) return true;
    // Has page context AND decent form signals
    if (pageScore >= 2 && formScore >= 3) return true;
    // Has resume upload and some application fields (even without strong URL signals)
    if (hasResumeUpload && formScore >= 3) return true;

    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FIELD DISCOVERY (for autofill)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Returns an array of { element, key, labelText } for all matchable fields.
   */
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

  // ════════════════════════════════════════════════════════════════════════════
  // FILL A SINGLE ELEMENT
  // ════════════════════════════════════════════════════════════════════════════

  function fillElement(el, value) {
    if (!value) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const opts = [...el.options];
      const norm = value.toLowerCase();
      const match = opts.find(o => o.text.toLowerCase().includes(norm) || norm.includes(o.text.toLowerCase()));
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }
    // input / textarea — use native value setter to trigger React/Vue listeners
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

  // ════════════════════════════════════════════════════════════════════════════
  // AUTOFILL
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // LEARNING FROM USER INPUT
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // AUTOFILL PROMPT BANNER
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // DETECTION INIT (with debounce, cache, and hard timeout)
  // ════════════════════════════════════════════════════════════════════════════

  let detectionObserver = null;
  let detectionCache    = null; // { result: bool, ts: number }
  const CACHE_TTL_MS   = 5000;  // cache scan result for 5 seconds
  const DEBOUNCE_MS    = 600;
  const OBSERVER_TIMEOUT_MS = 20000;

  function tryDetectAndShowBanner() {
    if (bannerShown) return;

    // Return cached result if fresh
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

    // Immediate check
    tryDetectAndShowBanner();
    if (bannerShown) return;

    // Watch for dynamically loaded forms (SPAs)
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