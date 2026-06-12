# FeelCV

An intelligent, secure, and local-first browser extension that automates parsing resumes and autofilling job application forms using AI.

---

## Preview

![FeelCV Preview](preview.gif)

---

## Features

- **Local & Secure Resume Parsing**  
  Upload `.pdf`, `.docx`, or `.txt` resumes. Your profile data is extracted locally and stored on your device using Chrome storage.

- **Dynamic Autofill**  
  Heuristically detects job application forms on any web page. In one click, autofill all 28+ supported professional fields.

- **Interactive AI Studio**  
  Generate customized, job-specific cover letters, motivation letters, summaries, strengths, and achievements using AI.

- **Local or Cloud AI Providers**  
  Supports local LLMs via Ollama (defaulting to Llama 3.2) or any OpenAI-compatible external API endpoint (like Groq, OpenRouter, or Together AI).

- **Modern JetBrains Mono UI**  
  Clean, responsive dark-mode dashboard with real-time status indication, field completion statistics, and safe manual editing.

---

## Folder Structure

```
├── manifest.json            
├── popup.html               
├── popup.js                 
├── popup.css                
├── content.js               
├── overlay.css              
├── background.js            
├── pdf.min.js               
├── pdf.worker.min.js        
├── mammoth.browser.min.js   
└── icons/                   
```

---

## Installation

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/cytric-74/feel-cv.git
   ```

2. Load the extension in Chrome:
   - Navigate to `chrome://extensions/` in your browser.
   - Toggle **Developer mode** in the top-right corner.
   - Click **Load unpacked** in the top-left corner.
   - Select the root folder of this project.

---

## Configuration

FeelCV is designed to be local-first, ensuring complete privacy:

### 1. Local AI (Recommended)
By default, FeelCV connects to a local Ollama instance:
- Install Ollama from [ollama.com](https://ollama.com).
- Serve Ollama on your machine:
  ```bash
  ollama serve
  ```
- Pull your preferred model (e.g. Llama 3.2):
  ```bash
  ollama pull llama3.2
  ```

### 2. External API
If you prefer a cloud provider:
- Toggle the provider to **External API** in the FeelCV Settings tab.
- Enter your Base URL, Model Name, and API Key.
- Your keys are saved securely in your browser's local storage and never sent elsewhere.
