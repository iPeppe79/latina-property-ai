async function analyzeText(prompt, context = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'Sei un analista immobiliare locale. Rispondi in italiano, con cautela quando i dati sono incompleti e segnala sempre elementi da verificare.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `${prompt}\n\nContesto JSON:\n${JSON.stringify(context, null, 2)}`
          }
        ]
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json.output_text || '';
}

module.exports = {
  analyzeText
};
