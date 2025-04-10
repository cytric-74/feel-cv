chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.jobPageDetected) {
      chrome.action.setPopup({ tabId: sender.tab.id, popup: 'popup.html' });
    }
  });