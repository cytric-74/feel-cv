(async () => {
    const bodyText = document.body.innerText;
    const aiVerified = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Check if the following text is from a job application page. Answer only true or false." },
          { role: "user", content: bodyText.slice(0, 4000) }
        ]
      })
    });
    const json = await aiVerified.json();
    const isJob = json.choices?.[0]?.message?.content.toLowerCase().includes("true");
    if (isJob) {
      chrome.runtime.sendMessage({ jobPageDetected: true });
    }
  })();