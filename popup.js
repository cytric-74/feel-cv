const OPENAI_API_KEY = ""; //using your openAI api key here

async function callOpenAI(prompt, isJobSite = false) {
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
            ? "Check if the given text is from a job application website and respond true or false."
            : "Extract structured resume information in JSON format. Include name, email, skills, experience, and education."
        },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content.trim();
}

document.getElementById('parse-resume').addEventListener('click', async () => {
  const file = document.getElementById('resume-upload').files[0];
  if (!file) return alert('Upload a file first!');

  const ext = file.name.split('.').pop().toLowerCase();
  const output = document.getElementById('output');
  const status = document.getElementById('status');
  output.textContent = '';
  status.textContent = 'Analyzing...';

  const handleAndAnalyze = async (text) => {
    const aiResponse = await callOpenAI(text);
    output.textContent = aiResponse;
    chrome.storage.local.set({ resumeText: text, resumeData: aiResponse });
    status.textContent = 'Resume saved and structured successfully!';
  };

  if (ext === 'txt') {
    const text = await file.text();
    handleAndAnalyze(text);
  } else if (ext === 'pdf') {
    const reader = new FileReader();
    reader.onload = async () => {
      const typedarray = new Uint8Array(reader.result);
      const pdf = await pdfjsLib.getDocument(typedarray).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      handleAndAnalyze(text);
    };
    reader.readAsArrayBuffer(file);
  } else if (ext === 'docx') {
    const reader = new FileReader();
    reader.onload = async () => {
      const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
      handleAndAnalyze(result.value);
    };
    reader.readAsArrayBuffer(file);
  } else {
    output.textContent = 'Unsupported file type!';
  }
});

document.getElementById('delete-resume').addEventListener('click', () => {
  chrome.storage.local.remove(['resumeText', 'resumeData'], () => {
    document.getElementById('output').textContent = 'Resume data deleted.';
    document.getElementById('status').textContent = 'Resume removed from storage.';
  });
});