// field-level store: every value remembers its source and confidence, so a
// new resume/ai/manual write gets compared against what's already there
// instead of blindly overwriting or deferring to it.

"use strict";

const fcvStoreKey = "fcv_profile_store";
const fcvLegacyFlatKey = "fcv_profile";

function fcvEmptyStore() {
  return { resumeVersion: 0, fields: {} };
}

function fcvMigrateLegacyFlat(flat) {
  const store = fcvEmptyStore();
  const now = Date.now();
  for (const [key, value] of Object.entries(flat || {})) {
    if (!value) continue;
    store.fields[key] = { value: String(value), source: "resume", confidence: 0.5, resumeVersion: 0, updatedAt: now };
  }
  return store;
}

function fcvGetFlat(store) {
  const flat = {};
  for (const [key, record] of Object.entries(store.fields || {})) {
    if (record && record.value) flat[key] = record.value;
  }
  return flat;
}

// a manual edit stands until the user changes it again; otherwise the
// higher-confidence value wins, and a tie goes to the newer record
function fcvResolveField(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.source === "manual" && incoming.source !== "manual") return existing;
  if (incoming.confidence > existing.confidence) return incoming;
  if (incoming.confidence === existing.confidence && incoming.updatedAt >= existing.updatedAt) return incoming;
  return existing;
}

function fcvLoadStore() {
  return new Promise((resolve) => {
    chrome.storage.local.get([fcvStoreKey, fcvLegacyFlatKey], (data) => {
      if (data[fcvStoreKey] && data[fcvStoreKey].fields) {
        resolve(data[fcvStoreKey]);
        return;
      }
      if (data[fcvLegacyFlatKey] && Object.keys(data[fcvLegacyFlatKey]).length) {
        resolve(fcvMigrateLegacyFlat(data[fcvLegacyFlatKey]));
        return;
      }
      resolve(fcvEmptyStore());
    });
  });
}

function fcvSaveStore(store) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [fcvStoreKey]: store, [fcvLegacyFlatKey]: fcvGetFlat(store) }, resolve);
  });
}

// incoming: { fieldKey: { value, source, confidence } }. returns the saved
// store plus a list of what changed, for messages like "6 updated, 2 kept".
async function fcvApplyFields(incoming, opts = {}) {
  const store = await fcvLoadStore();
  if (opts.bumpResumeVersion) store.resumeVersion += 1;
  const resumeVersion = store.resumeVersion;
  const now = Date.now();
  const changes = [];

  for (const [key, partial] of Object.entries(incoming || {})) {
    if (!partial) continue;
    const value = typeof partial.value === "string" ? partial.value.trim() : partial.value;
    if (!value) continue;

    const candidate = {
      value,
      source: partial.source || "resume",
      confidence: partial.confidence ?? 0.5,
      resumeVersion,
      updatedAt: now,
    };

    const before = store.fields[key] || null;
    const winner = fcvResolveField(before, candidate);

    if (winner === candidate) {
      if (!before || before.value !== candidate.value) {
        changes.push({ key, from: before ? before.value : "", to: candidate.value, applied: true });
      }
    } else if (before && candidate.value !== before.value) {
      changes.push({ key, from: before.value, to: candidate.value, applied: false });
    }

    store.fields[key] = winner;
  }

  await fcvSaveStore(store);
  return { store, changes };
}

function fcvSetManualField(key, value) {
  return fcvApplyFields({ [key]: { value, source: "manual", confidence: 1 } });
}

async function fcvDeleteField(key) {
  const store = await fcvLoadStore();
  delete store.fields[key];
  await fcvSaveStore(store);
  return store;
}

function fcvClearProfile() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([fcvStoreKey, fcvLegacyFlatKey, "fcv_filename", "fcv_profile_structured"], resolve);
  });
}

window.FCV_profileStore = {
  load: fcvLoadStore,
  save: fcvSaveStore,
  getFlat: fcvGetFlat,
  applyFields: fcvApplyFields,
  setManualField: fcvSetManualField,
  deleteField: fcvDeleteField,
  clearProfile: fcvClearProfile,
  resolveField: fcvResolveField,
};
