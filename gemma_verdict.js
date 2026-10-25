const OLLAMA_URL = "http://localhost:11434/api/generate";
const GEMMA_MODEL = "gemma3:4b";

const LABELS = { "CLEARED": "GO", "CONDITIONAL": "CAUTION", "NOT CLEARED": "NO-GO" };

// Asks Gemma to explain a decision the planner already made.
async function askGemma(summary) {
  const prompt =
`You are a drone flight-safety assistant for farm surveys.
The planner has already decided: ${summary.status}.
Explain this decision in 2 short sentences for a farmer, using ONLY the data below.
Do not change the decision. Do not invent numbers.

Data:
${JSON.stringify(summary, null, 2)}`;

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.2 }
    })
  });
  if (!res.ok) throw new Error("Ollama returned " + res.status);
  const data = await res.json();
  return data.response.trim();
}

let gemmaCall = 0;
async function showGemmaVerdict(summary, targetId = "gemma-verdict") {
  const el = document.getElementById(targetId);
  if (!el) return;
  const myCall = ++gemmaCall;
  const label = LABELS[summary.status] || summary.status;
  el.textContent = label + " - Gemma is thinking...";
  await new Promise(r => setTimeout(r, 500));   // wait while the slider is moving
  if (myCall !== gemmaCall) return;             // a newer hour was picked
  try {
    const text = await askGemma(summary);
    if (myCall !== gemmaCall) return;
    el.textContent = label + ": " + text;
  } catch (err) {
    console.error(err);
    if (myCall !== gemmaCall) return;
    el.textContent = label + ": " + (summary.reasons || []).join("; ") +
      " (Gemma offline, showing rule-based reasons)";
  }
}