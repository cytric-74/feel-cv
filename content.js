// content.js — Injected into every page
// Responsibilities:
//   1. Detect if the page is a job application form (heuristic, no API)
//   2. On autofill command: find form fields, match to profile, fill them
//   3. Watch fields the user manually fills → learn new profile data
//   4. Show an unobtrusive autofill prompt when a job page is detected

(() => {
  "use strict";

  const FIELD_REGISTRY = {
    full_name:        { patterns: ["name","full name","your name","applicant name"] },
    first_name:       { patterns: ["first name","given name","forename"] },
    last_name:        { patterns: ["last name","surname","family name"] },
    email:            { patterns: ["email","e-mail","mail","email address"] },
    phone:            { patterns: ["phone","mobile","cell","telephone","contact number"] },
    location:         { patterns: ["city","location","address","where are you based","current location"] },
    linkedin:         { patterns: ["linkedin","linkedin url","linkedin profile"] },
    github:           { patterns: ["github","github url","portfolio","website","personal site"] },
    portfolio:        { patterns: ["portfolio","website","personal site","personal url"] },
    summary:          { patterns: ["summary","about yourself","about you","brief bio","profile summary","professional summary","tell us about yourself","short bio","bio","describe yourself"] },
    headline:         { patterns: ["headline","title","job title","current role","current position","designation"] },
    years_experience: { patterns: ["years of experience","total experience","how many years","work experience"] },
    current_company:  { patterns: ["current company","current employer","current organization","employer"] },
    current_role:     { patterns: ["current role","current position","current title","current designation"] },
    work_history:     { patterns: ["work history","employment history","past experience","previous companies"] },
    degree:           { patterns: ["degree","qualification","education","highest qualification","academic qualification"] },
    university:       { patterns: ["university","college","institution","school","alma mater"] },
    graduation_year:  { patterns: ["graduation year","year of graduation","passed out","batch"] },
    major:            { patterns: ["major","field of study","specialization","stream","branch","course"] },
    skills:           { patterns: ["skills","technologies","tech stack","tools","expertise","competencies","technical skills"] },
    languages:        { patterns: ["programming languages","languages known","coding languages"] },
    cover_letter:     { patterns: ["cover letter","why should we hire","motivation letter","statement of purpose"] },
    motivation:       { patterns: ["why do you want","why are you interested","why this company","why this role","what attracts you","what interests you","reason for applying"] },
    strengths:        { patterns: ["strengths","greatest strengths","what are your strengths","key strengths"] },
    achievements:     { patterns: ["achievements","accomplishments","notable projects","key projects","proud of"] },
    salary:           { patterns: ["expected salary","salary expectation","ctc","expected ctc","compensation"] },
    notice_period:    { patterns: ["notice period","when can you join","availability","how soon"] },
  };

  const SKIP_LEARNING = new Set(["notice_period", "cover_letter", "motivation"]);
  // Never autofill these (user must generate them per-job)
  const SKIP_AUTOFILL = new Set(["cover_letter", "motivation", "notice_period", "salary"]);

  function matchFieldKey(labelText) {
    const norm = labelText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    let best = null, bestScore = 0;
    for (const [key, meta] of Object.entries(FIELD_REGISTRY)) {
      for (const pattern of meta.patterns) {
        if (norm.includes(pattern)) {
          const score = pattern.length;
          if (score > bestScore) { bestScore = score; best = key; }
        }
      }
    }
    return best;
  }

  // job page detection (heuristic, local)

  function hasJobContext() {
    const url = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const body = document.body.innerText.toLowerCase().slice(0, 3000);

    const urlSignals = [
      "apply","application","careers","jobs","job","hiring",
      "recruit","talent","workday","greenhouse","lever","ashby","bamboo"
    ].some(s => url.includes(s));

    const contentSignals = [
      "apply for","job application","upload resume","upload cv",
      "cover letter","work authorization","resume","linkedin"
    ].filter(s => body.includes(s)).length;

    const formSignals = (() => {
      const labels = [...document.querySelectorAll("label")].map(l => l.innerText.toLowerCase());
      const jobLabels = ["resume","cv","cover letter","linkedin","work experience","skills"];
      return jobLabels.filter(j => labels.some(l => l.includes(j))).length;
    })();

    return urlSignals || contentSignals >= 2 || formSignals >= 2;
  }

  function hasJobForm() {
    const fields = discoverFields();
    const hasFileInput = document.querySelector("input[type=file]") !== null;
    return fields.length >= 2 || (fields.length >= 1 && hasFileInput);
  }

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
      seen.add(el);

      const candidates = [];

      // 1. <label for="id">
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) candidates.push(lbl.innerText);
      }
      // 2. aria-label
      if (el.getAttribute("aria-label")) candidates.push(el.getAttribute("aria-label"));
      // 3. placeholder
      if (el.placeholder) candidates.push(el.placeholder);
      // 4. name/id attribute
      if (el.name) candidates.push(el.name.replace(/[_\-]/g, " "));
      if (el.id)   candidates.push(el.id.replace(/[_\-]/g, " "));
      // 5. Nearest preceding text node / parent label
      const parentLabel = el.closest("label");
      if (parentLabel) candidates.push(parentLabel.innerText);
      // 6. Previous sibling text
      const prev = el.previousElementSibling;
      if (prev && prev.tagName !== "INPUT") candidates.push(prev.innerText || prev.textContent);

      const matched = candidates.map(matchFieldKey).find(Boolean);
      if (matched) {
        results.push({ element: el, key: matched, labelText: candidates[0] || matched });
      }
    }

    return results;
  }

  // filing up a single element

  function fillElement(el, value) {
    if (!value) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      // trying to match value to an option
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
    // input / textarea — use native input setter to trigger React/Vue listeners
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

  // AUTOFILL 

  function doAutofill(profile) {
    const fields = discoverFields();
    let filled = 0, skipped = [];

    for (const { element, key, labelText } of fields) {
      if (SKIP_AUTOFILL.has(key)) {
        skipped.push(key);
        continue;
      }
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

  // LEARNING FROM USER INPUT
  // function to watch fields the user manually fills after autofill runs

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

    // get current profile, compare
    const stored = await getProfile();
    const newVal = el.value.trim();

    // Skip if same as what we filled
    if (stored[key] === newVal) return;

    // Skip numeric-only values for text fields (likely dates/IDs)
    if (/^\d+$/.test(newVal) && !["phone","graduation_year","years_experience"].includes(key)) return;

    // Skip very short values (likely not meaningful)
    if (newVal.length < 2) return;

    // Emit to background → popup will ask user to confirm
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

  //  AUTOFILL PROMPT BANNER

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

  // MESSAGE LISTENER

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DO_AUTOFILL") {
      const result = doAutofill(message.profile);
      const fields = discoverFields();
      watchForLearning(fields);
      // Report back count
      chrome.runtime.sendMessage({ type: "AUTOFILL_DONE", ...result });
    }
    if (message.type === "RE_DETECT") {
      bannerShown = false;
      initDetection();
    }
  });


  let detectionObserver = null;

  function tryDetectAndShowBanner() {
    if (bannerShown) return;

    // Sleek check: matches if URL/text signals look like job context AND there is a form,
    // OR if we strongly detect a form with standard inputs and a file input (resume upload).
    const hasStrongForm = hasJobForm() && (document.querySelector("input[type=file]") !== null || document.querySelector("textarea") !== null);
    if ((hasJobContext() && hasJobForm()) || hasStrongForm) {
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

    // Check immediately
    tryDetectAndShowBanner();

    if (bannerShown) return;

    // Set up MutationObserver to detect dynamically loaded forms
    let timeout = null;
    detectionObserver = new MutationObserver(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        tryDetectAndShowBanner();
      }, 500);
    });

    detectionObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Cleanup observer after 30 seconds to release resources
    setTimeout(() => {
      if (detectionObserver) {
        detectionObserver.disconnect();
        detectionObserver = null;
      }
    }, 30000);
  }

  initDetection();

})();