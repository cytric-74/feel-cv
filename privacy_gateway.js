// the one place that decides what leaves the device. nothing should call a
// cloud ai endpoint directly with a raw prompt — it goes through here first,
// gets its contact details stripped, and (unless the user has already said
// not to bother) gets shown to the user before it actually goes out.

"use strict";

const fcvEmailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const fcvLinkedinRe = /https?:\/\/(www\.)?linkedin\.com\/[^\s)"']+/gi;
const fcvGithubRe = /https?:\/\/(www\.)?github\.com\/[^\s)"']+/gi;
const fcvGenericUrlRe = /https?:\/\/[^\s)"']+/gi;
const fcvPhoneRe = /(\+?[\d][\d\s\-().]{6,18}[\d])/g;

// same fields the profile store already trusts more from local extraction
// than from an ai pass — those are exactly the ones that don't need to make
// the trip to a cloud provider at all.
function fcvRedact(text) {
  if (!text) return { text: text || "", count: 0 };
  let count = 0;
  let out = text;

  out = out.replace(fcvEmailRe, () => { count++; return "[redacted-email]"; });
  out = out.replace(fcvLinkedinRe, () => { count++; return "[redacted-linkedin]"; });
  out = out.replace(fcvGithubRe, () => { count++; return "[redacted-github]"; });
  out = out.replace(fcvGenericUrlRe, () => { count++; return "[redacted-link]"; });
  out = out.replace(fcvPhoneRe, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return m;
    count++;
    return "[redacted-phone]";
  });

  return { text: out, count };
}

// ollama runs on the user's own machine, so a prompt sent there never leaves
// the device — only the openai-compatible path is a real network egress.
function fcvIsCloudProvider(cfg) {
  return !!cfg && cfg.provider === "openai_compat";
}

window.FCV_privacyGateway = {
  redact: fcvRedact,
  isCloudProvider: fcvIsCloudProvider,
};
