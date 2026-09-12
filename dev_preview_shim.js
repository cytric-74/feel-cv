// not loaded by the extension — manifest.json and popup.html never
// reference this file. it exists only so someone can open popup.html
// directly in a plain browser tab (outside the extension) to look at the ui
// without wiring up real chrome.storage/chrome.runtime. to use it, add
// <script src="dev_preview_shim.js"></script> to popup.html yourself, above
// the field_registry.js tag, and remove it again before shipping.
//
// it used to live inline at the top of popup.js and activate automatically
// whenever chrome.storage was missing — which meant a real install hitting
// that condition (a chrome bug, a misconfigured manifest) would silently
// show this fabricated "John Doe" profile instead of a visible error. moving
// it here and requiring a deliberate opt-in closes that off.

"use strict";

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
