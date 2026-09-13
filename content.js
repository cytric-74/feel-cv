// Detects job forms, autofills them, and learns edited fields.

(() => {
  "use strict";

  // scoring also excludes password fields
  const FILLABLE_EXCLUSIONS = ":not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file])";
  const FILLABLE_SELECTOR = `input${FILLABLE_EXCLUSIONS}, textarea, select`;
  const SCORING_INPUT_SELECTOR = `input${FILLABLE_EXCLUSIONS}:not([type=password]), textarea, select`;

  // fallback if field_registry.js fails to load
  const FIELD_REGISTRY = window.FCV_FIELD_REGISTRY || {
    full_name: { patterns: ["full name", "your name", "applicant name"] },
    first_name: { patterns: ["first name", "given name", "forename"] },
    last_name: { patterns: ["last name", "surname", "family name"] },
    email: { patterns: ["email address", "email", "e-mail", "mail"] },
    phone: { patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone"] },
    location: { patterns: ["current location", "where are you based", "city", "location", "address"] },
  };

  const SKIP_LEARNING  = new Set(["notice_period", "cover_letter", "motivation"]);
  // user must generate these per-job, never autofill
  const SKIP_AUTOFILL  = new Set(["cover_letter", "motivation", "notice_period", "salary"]);

  // word boundary so "mail" doesn't match inside "voicemail"; a short/generic
  // pattern also needs a short label, or it's too weak a signal to trust
  function scorePatternMatch(norm, pattern) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\b${escaped}\\b`).test(norm)) return 0;
    if (pattern.length <= 4 && norm.length > 40) return 0;
    return pattern.length;
  }

  function matchFieldKey(labelText) {
    const norm = labelText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    let best = null, bestScore = 0;
    for (const [key, meta] of Object.entries(FIELD_REGISTRY)) {
      for (const pattern of meta.patterns) {
        const score = scorePatternMatch(norm, pattern);
        if (score > bestScore) { bestScore = score; best = key; }
      }
    }
    return best;
  }

  // keep in sync with manifest.json's content_scripts matches — that list
  // decides injection, this one only affects scoring once already running
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

  // checked against the full document, not just the viewport, so an ordinary
  // below-the-fold field isn't flagged — only one parked off-canvas (e.g.
  // left:-9999px) to hide it from harvesting is
  function isVisible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    const absLeft = rect.left + window.scrollX;
    const absTop = rect.top + window.scrollY;
    const OFFSCREEN_MARGIN = 50;
    if (absLeft + rect.width < -OFFSCREEN_MARGIN || absLeft > docW + OFFSCREEN_MARGIN) return false;
    if (absTop + rect.height < -OFFSCREEN_MARGIN || absTop > docH + OFFSCREEN_MARGIN) return false;

    return true;
  }

  // first candidate in reliability order, not the longest — a placeholder is
  // often an example value, not the label, so it's trusted last
  function firstUsable(...candidates) {
    for (const c of candidates) {
      const t = (c || "").trim();
      if (t && t.length <= 120) return t;
    }
    return "";
  }

  function getLabelText(el) {
    let boundLabelText = "";
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) boundLabelText = lbl.innerText || lbl.textContent;
    }

    const wrappingLabel = el.closest("label");
    const wrappingLabelText = wrappingLabel ? (wrappingLabel.innerText || wrappingLabel.textContent) : "";

    let labelledByText = "";
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledByText = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.innerText || ref.textContent || "").trim() : "";
      }).filter(Boolean).join(" ");
    }

    const ariaLabel = el.getAttribute("aria-label") || "";

    // Common builder pattern: <div>Label</div><input> with no <label> element at all
    let siblingText = "";
    const prev = el.previousElementSibling;
    if (prev && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(prev.tagName)) {
      siblingText = prev.innerText || prev.textContent || "";
    }

    let wrapperText = "";
    const wrapper = el.closest('[class*="field"],[class*="form-group"],[class*="input-wrap"],[class*="form-item"],[class*="question"]');
    if (wrapper) {
      for (const child of wrapper.children) {
        if (!["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(child.tagName)) {
          const t = (child.innerText || child.textContent || "").trim();
          if (t) { wrapperText = t; break; }
        }
      }
    }

    const placeholderText = el.placeholder || "";
    const attrText = (el.name || el.id || "").replace(/[_\-]/g, " ");

    return firstUsable(
      boundLabelText,
      wrappingLabelText,
      labelledByText,
      ariaLabel,
      siblingText,
      wrapperText,
      placeholderText,
      attrText
    );
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

    const inputEls = [...document.querySelectorAll(SCORING_INPUT_SELECTOR)].filter(isVisible);

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

  // remembers matched fields by name/id per hostname, so a future visit skips
  // re-guessing; capped so it can't grow forever
  const SITE_CACHE_KEY = "fcv_site_field_cache";
  const SITE_CACHE_MAX_HOSTS = 200;

  let siteFieldCache = {};
  chrome.storage.local.get(SITE_CACHE_KEY, (d) => { siteFieldCache = d[SITE_CACHE_KEY] || {}; });

  function elementCacheKey(el) {
    if (el.name) return "name:" + el.name;
    if (el.id) return "id:" + el.id;
    return null;
  }

  // only trusted while the label that produced it hasn't changed
  function rememberFieldMapping(cacheKey, key, labelSnapshot) {
    if (!cacheKey) return;
    const host = location.hostname;
    const entry = siteFieldCache[host] || { updatedAt: 0, fields: {} };
    entry.fields[cacheKey] = { key, labelSnapshot };
    entry.updatedAt = Date.now();
    siteFieldCache[host] = entry;

    const hosts = Object.keys(siteFieldCache);
    if (hosts.length > SITE_CACHE_MAX_HOSTS) {
      const oldest = hosts.sort((a, b) => (siteFieldCache[a].updatedAt || 0) - (siteFieldCache[b].updatedAt || 0))[0];
      delete siteFieldCache[oldest];
    }
    chrome.storage.local.set({ [SITE_CACHE_KEY]: siteFieldCache });
  }

  function discoverFields() {
    const results = [];
    const seen = new WeakSet();
    const hostEntry = siteFieldCache[location.hostname];
    const cachedFields = hostEntry ? hostEntry.fields : null;

    const inputs = document.querySelectorAll(FILLABLE_SELECTOR);

    for (const el of inputs) {
      if (seen.has(el)) continue;
      if (!isVisible(el)) continue;
      seen.add(el);

      const cacheKey = elementCacheKey(el);
      const cached = cachedFields && cacheKey ? cachedFields[cacheKey] : null;

      const labelText = getLabelText(el);
      if (!labelText) continue;

      if (cached && cached.labelSnapshot === labelText) {
        results.push({ element: el, key: cached.key, labelText });
        continue;
      }

      const key = matchFieldKey(labelText);
      if (key) {
        results.push({ element: el, key, labelText });
        rememberFieldMapping(cacheKey, key, labelText);
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
      // Skip blank placeholder options, which would match any value trivially.
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

  // a select's placeholder option often carries a non-empty value, so that
  // alone doesn't count as "filled"
  function isFieldFilled(el) {
    if (el.tagName.toLowerCase() === "select") return el.selectedIndex > 0 && !!el.value;
    return !!el.value && el.value.trim().length > 0;
  }

  // dry run — no dom writes, so the banner can show a real count first
  function planAutofill(profile) {
    const fields = discoverFields();
    const toFill = [], alreadyFilled = [], skippedByPolicy = [];

    for (const entry of fields) {
      const { element, key } = entry;
      if (SKIP_AUTOFILL.has(key)) { skippedByPolicy.push(key); continue; }
      if (!profile[key]) continue;
      (isFieldFilled(element) ? alreadyFilled : toFill).push(entry);
    }

    return { fields, toFill, alreadyFilled, skippedByPolicy };
  }

  // hit-test at the field's own center — a decoy hidden off-canvas or under
  // an overlay fails this even after being scrolled into view
  function isCoveredOrHidden(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return true;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) return true;

    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return true;
    return !(topEl === el || el.contains(topEl) || topEl.contains(el));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const SPOTLIGHT_DELAY_MS = 180;
  let autofillCancelled = false;

  // walks fields one at a time — scroll into view, hit-test, then fill —
  // instead of writing to all of them at once out of sight. already-filled
  // fields are only touched if the user opted into overwriting them.
  async function applyAutofill(plan, profile, overwrite, onProgress) {
    const targets = overwrite ? [...plan.toFill, ...plan.alreadyFilled] : plan.toFill;
    let filled = 0;
    const blocked = [];

    for (let i = 0; i < targets.length; i++) {
      if (autofillCancelled) break;

      const { element, key } = targets[i];
      const value = profile[key];
      if (!value) continue;

      element.scrollIntoView({ block: "center", inline: "nearest" });
      await wait(SPOTLIGHT_DELAY_MS);
      if (autofillCancelled) break;

      if (isCoveredOrHidden(element)) {
        blocked.push(key);
        continue;
      }

      element.classList.add("fcv-spotlight");
      if (onProgress) onProgress({ index: i, total: targets.length, key });

      if (fillElement(element, value)) filled++;

      await wait(SPOTLIGHT_DELAY_MS);
      element.classList.remove("fcv-spotlight");
      element.style.transition = "box-shadow 0.4s";
      element.style.boxShadow  = "0 0 0 2px #fdb14c";
      setTimeout(() => { element.style.boxShadow = ""; }, 2000);
    }

    return { filled, total: plan.fields.length, blocked };
  }

  // ── Learning from fields the user fills in manually ──────────────────────────
  // a script can set el.value and dispatch a synthetic change/blur as easily
  // as a real keystroke — so a value is only proposed for saving if the event
  // is genuinely trusted AND follows a real focus/pointerdown on that field.

  const watchedFields = new Map(); // element → key
  const trustedInteractionAt = new WeakMap(); // element → timestamp of its last genuine focus/pointerdown
  const TRUSTED_INTERACTION_WINDOW_MS = 60000;

  function markTrustedInteraction(e) {
    if (!e.isTrusted) return;
    trustedInteractionAt.set(e.target, Date.now());
  }

  // several fields "learned" within seconds of each other looks like a script
  // looping over fields, not a person typing — flagged as suspicious rather
  // than dropped, since a fast legitimate multi-field paste is also possible
  const recentLearnTimestamps = [];
  const BURST_WINDOW_MS = 2000;
  const BURST_THRESHOLD = 3;

  function noteLearnEventAndCheckBurst() {
    const now = Date.now();
    recentLearnTimestamps.push(now);
    while (recentLearnTimestamps.length && now - recentLearnTimestamps[0] > BURST_WINDOW_MS) {
      recentLearnTimestamps.shift();
    }
    return recentLearnTimestamps.length >= BURST_THRESHOLD;
  }

  function watchForLearning(fields) {
    for (const { element, key } of fields) {
      if (SKIP_LEARNING.has(key)) continue;
      watchedFields.set(element, key);
      element.addEventListener("focus", markTrustedInteraction);
      element.addEventListener("pointerdown", markTrustedInteraction);
      element.addEventListener("change", onFieldChange);
      element.addEventListener("blur",   onFieldChange);
    }
  }

  async function onFieldChange(e) {
    if (!e.isTrusted) return; // a script dispatched this — it isn't the user typing

    const el  = e.target;
    const key = watchedFields.get(el);
    if (!key || !el.value.trim()) return;

    const lastInteraction = trustedInteractionAt.get(el);
    if (!lastInteraction || (Date.now() - lastInteraction) > TRUSTED_INTERACTION_WINDOW_MS) return;

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
      fieldLabel: FIELD_REGISTRY[key]?.label || key,
      suspicious: noteLearnEventAndCheckBurst(),
    });
  }

  function getProfile() {
    return new Promise(res => chrome.storage.local.get("fcv_profile", d => res(d.fcv_profile || {})));
  }

  // Autofill prompt banner 
  // "Autofill" runs the dry run and turns the button into "Confirm (n)" — the
  // one confirmation surface both the banner and the popup's button share.

  let bannerShown = false;
  let banner = null, textSpan = null, fillBtn = null, overwriteRow = null, overwriteBox = null;
  let pendingPlan = null, pendingProfile = null;

  function resetBannerState() {
    banner = null; textSpan = null; fillBtn = null; overwriteRow = null; overwriteBox = null;
    bannerShown = false; pendingPlan = null; pendingProfile = null;
    // autofillCancelled stays as-is here — re-armed in presentPlan() instead,
    // so a run already in progress still sees it and stops
  }

  function planSummaryText(plan) {
    if (!plan.toFill.length && !plan.alreadyFilled.length) return "No matching fields found on this page.";
    if (!plan.alreadyFilled.length) return `${plan.toFill.length} field${plan.toFill.length === 1 ? "" : "s"} ready to fill`;
    return `${plan.toFill.length} empty field${plan.toFill.length === 1 ? "" : "s"} ready, ${plan.alreadyFilled.length} already filled`;
  }

  function presentPlan(profile) {
    ensureBanner();
    bannerShown = true;
    autofillCancelled = false;

    if (!Object.keys(profile).length) {
      textSpan.textContent = "No profile found. Upload your resume first.";
      return;
    }

    pendingPlan = planAutofill(profile);
    pendingProfile = profile;
    textSpan.textContent = planSummaryText(pendingPlan);

    if (!pendingPlan.toFill.length && !pendingPlan.alreadyFilled.length) {
      pendingPlan = null;
      return;
    }

    fillBtn.textContent = `Confirm (${pendingPlan.toFill.length})`;

    if (pendingPlan.alreadyFilled.length && !overwriteRow) {
      overwriteBox = document.createElement("input");
      overwriteBox.type = "checkbox";
      overwriteBox.id = "fcv-overwrite-box";

      overwriteRow = document.createElement("label");
      overwriteRow.className = "fcv-overwrite-row";
      overwriteRow.htmlFor = "fcv-overwrite-box";
      overwriteRow.appendChild(overwriteBox);
      overwriteRow.appendChild(document.createTextNode(
        ` also overwrite ${pendingPlan.alreadyFilled.length} already-filled field${pendingPlan.alreadyFilled.length === 1 ? "" : "s"}`
      ));
      banner.appendChild(overwriteRow);
    }
  }

  async function commitPlan() {
    const overwrite = !!(overwriteBox && overwriteBox.checked);
    const plan = pendingPlan, profile = pendingProfile;
    fillBtn.disabled = true;

    const result = await applyAutofill(plan, profile, overwrite, ({ key, index, total }) => {
      if (!textSpan) return; // banner was closed mid-walk
      const label = FIELD_REGISTRY[key]?.label || key;
      textSpan.textContent = `Filling ${label}… (${index + 1}/${total})`;
    });

    if (autofillCancelled) return; // banner is already gone; nothing left to update

    watchForLearning(plan.fields);

    textSpan.textContent = result.blocked.length
      ? `Filled ${result.filled} of ${result.total} fields — ${result.blocked.length} skipped (looked hidden or covered)`
      : `Filled ${result.filled} of ${result.total} fields`;
    fillBtn.textContent = "Autofill";
    fillBtn.disabled = false;
    if (overwriteRow) { overwriteRow.remove(); overwriteRow = null; overwriteBox = null; }
    pendingPlan = null;

    chrome.runtime.sendMessage({ type: "AUTOFILL_DONE", filled: result.filled, total: result.total, blocked: result.blocked.length });
    setTimeout(() => { if (banner) banner.remove(); resetBannerState(); }, 3500);
  }

  function onFillButtonClick() {
    if (pendingPlan) { commitPlan(); return; }
    getProfile().then(presentPlan);
  }

  function ensureBanner() {
    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = "fcv-banner";

    const iconSpan = document.createElement("span");
    iconSpan.className = "fcv-icon";
    iconSpan.textContent = "✦";
    banner.appendChild(iconSpan);

    textSpan = document.createElement("span");
    textSpan.className = "fcv-text";
    textSpan.textContent = "FeelCV detected a job form";
    banner.appendChild(textSpan);

    fillBtn = document.createElement("button");
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

    closeBtn.onclick = () => { autofillCancelled = true; banner.remove(); resetBannerState(); };
    fillBtn.onclick = onFillButtonClick;

    return banner;
  }

  function showAutofillBanner() {
    if (bannerShown || document.getElementById("fcv-banner")) return;
    bannerShown = true;
    ensureBanner();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DO_AUTOFILL") {
      presentPlan(message.profile);
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