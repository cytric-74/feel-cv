const OPENAI_API_KEY = ""; //using your openAI api key here

// load the api from the chrome storage
chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  if (!apiKey) {
    alert("Please set your OpenAI API key in the settings.");
  } else {
    OPENAI_API_KEY = apiKey;
  }
});

// added cache related function
async function checkCache(text) {
  const hash = await hashText(text);
  const { resumeData, resumeHash } = await chrome.storage.local.get(['resumeData', 'resumeHash']);
  return (resumeHash === hash) ? resumeData : null;
}

async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// refined callopen AI function
async function callOpenAI(prompt, isJobSite = false) {
  const controller = new AbortController();
  const timeout = 10000; // 10 seconds timeout
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Add delay to prevent rate limiting (min 1 second between requests)
    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: isJobSite
              ? "Check if this is a job application page. Respond only with 'true' or 'false'."
              : "Extract ONLY: name, email, phone, 5 key skills, work experience (company, title, dates), education (degree, institution, year). Return as JSON."
          },
          { 
            role: "user", 
            content: prompt.slice(0, 3000) // Reduced to 3000 chars for token safety
          }
        ],
        temperature: 0.3,
        response_format: isJobSite ? undefined : { type: "json_object" } // Enforce JSON when needed
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to get error details from response
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || 'Unknown error';
      throw new Error(`OpenAI API Error: ${response.status} - ${errorMessage}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    // For non-JobSite responses, verify JSON is valid
    if (!isJobSite) {
      try {
        JSON.parse(content);
      } catch (e) {
        throw new Error("Invalid JSON response from OpenAI");
      }
    }

    return content;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("OpenAI API error:", error);
    
    // Return structured error object
    return { 
      error: true,
      message: error.message,
      isRetryable: isRetryableError(error) 
    };
  }
}

// helper function to determine if an error is retryable
function isRetryableError(error) {
  // Network errors, timeouts, and rate limits are retryable
  if (error.name === 'AbortError') return true; // Timeout
  if (error.message.includes('429')) return true; // Rate limit
  if (error.message.includes('API error')) return true; // API errors
  return false;
}

// wrapper function with retry logic
async function callOpenAIWithRetry(prompt, isJobSite = false, maxRetries = 3) {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    attempt++;
    const result = await callOpenAI(prompt, isJobSite);
  
    if (!result.error) return result;
    
    if (!result.isRetryable) {
      throw new Error(result.message);
    }
    
    // Exponential backoff
    const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000); // Cap at 30s
    console.log(`Retry attempt ${attempt} after ${delayMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

async function isSimilarResume(text, threshold = 0.8) {
  const { resumeText } = await chrome.storage.local.get('resumeText');
  if (!resumeText) return false;
  
  const intersect = [...new Set(text.split(' '))].filter(word => 
    resumeText.includes(word)
  ).length;
  const similarity = intersect / Math.max(text.split(' ').length, 1);
  return similarity >= threshold;
}

// parsing the resume with progress feedback
document.getElementById('parse-resume').addEventListener('click', async () => {
  const file = document.getElementById('resume-upload').files[0];
  if (!file) return alert('Please upload a file first!');

  const ext = file.name.split('.').pop().toLowerCase();
  const output = document.getElementById('output');
  const status = document.getElementById('status');

  output.textContent = '';
  status.textContent = 'Analyzing...';

  const progress = document.createElement('div');
  progress.style.width = '100%';
  progress.style.backgroundColor = '#ddd';
  const progressBar = document.createElement('div');
  progressBar.style.height = '4px';
  progressBar.style.backgroundColor = '#4CAF50';
  progressBar.style.width = '0%';
  progress.appendChild(progressBar);
  status.appendChild(progress);

  try {
    const handleAndAnalyze = async (text) => {
      const cached = await checkCache(text); // checking cache data
      if (cached) {
        output.textContent = cached;
        status.textContent = 'Loaded from cache!';
        progressBar.style.width = '100%';
        return;
      }

      progressBar.style.width = '30%';
// making the text processed 
      const cleanText = text 
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s@.-]/g, '') // removing of the special character 
        .substring(0, 6000); //limiting the size 

      progressBar.style.width = '60%';

      const aiResponse = await callOpenAI(cleanText);

      progressBar.style.width = '90%';

      output.textContent = aiResponse;
      await chrome.storage.local.set({ 
        resumeText: cleanText, 
        resumeData: aiResponse,
        resumeHash: await hashText(cleanText)
      });

      progressBar.style.width = '100%';
      status.textContent = 'Analysis complete!';
    };

    if (ext === 'txt') {
      const text = await file.text();
      await handleAndAnalyze(text);
    } else if (ext === 'pdf') {
      status.textContent = 'Loading PDF...';
      const typedarray = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument(typedarray).promise;

      let text = '';
      status.textContent = 'Extracting text from PDF...';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
        
        // updated progress of multiple pdf pages
        progressBar.style.width = `${Math.min(30 + (i/pdf.numPages)*60, 90)}%`;
      }

      await handleAndAnalyze(text);
    } else if (ext === 'docx') {
      status.textContent = 'Processing Word document...';
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      await handleAndAnalyze(result.value);
    } else {
      output.textContent = 'Unsupported file type! Only PDF, TXT, or DOCX allowed.';
    }
  } catch (error) {
    output.textContent = `Error: ${error.message}`;
    status.textContent = 'Processing failed';
    progressBar.style.backgroundColor = '#f44336';
  } finally {
    setTimeout(() => progress.remove(), 3000);
  }
});

document.getElementById('delete-resume').addEventListener('click', () => {
  chrome.storage.local.remove(['resumeText', 'resumeData'], () => {
    document.getElementById('output').textContent = 'Resume data deleted.';
    document.getElementById('status').textContent = 'Resume removed from storage.';
  });
});