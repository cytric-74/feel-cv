// not loaded by the extension — add <script src="dev_preview_shim.js"></script>
// to popup.html yourself (above field_registry.js) to preview the ui in a
// plain browser tab without real chrome.storage/chrome.runtime. remove before
// shipping. deliberately opt-in so a real install can't silently fall back
// to this fake profile instead of a visible error.

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
