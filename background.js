// Service worker: tracks job-page tabs and bridges content <-> popup messages.

const jobPageTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script detected a job page
  if (message.type === "JOB_PAGE_DETECTED") {
    const tabId = sender.tab.id;
    jobPageTabs.add(tabId);
    chrome.action.setPopup({ tabId, popup: "popup.html" });
    chrome.action.setBadgeText({ tabId, text: "✦" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#fdb14c" });
    sendResponse({ success: true });
    return;
  }

  // Popup asks: is the current tab a job page?
  if (message.type === "IS_JOB_PAGE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ isJob: jobPageTabs.has(tabs[0]?.id) });
    });
    return true; // async
  }

  // Popup instructs content script to scan + show overlay
  if (message.type === "TRIGGER_AUTOFILL") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "DO_AUTOFILL", profile: message.profile });
      }
    });
    sendResponse({ success: true });
    return;
  }

  // Content script found new fields after user typed — relay to popup
  if (message.type === "NEW_FIELD_LEARNED") {
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ success: true });
    return;
  }
  
  return false;
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  jobPageTabs.delete(tabId);
});

// Watch tab updates (for SPA pages) to re-trigger form detection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.tabs.sendMessage(tabId, { type: "RE_DETECT" }).catch(() => {});
  }
});