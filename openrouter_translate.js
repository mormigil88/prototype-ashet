const { validateTranslatedCaptions } = require('./subtitle_helpers.js');

const DEFAULT_MODEL = 'openai/gpt-oss-20b:free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function extractJson(body) {
  // Try direct parse first
  try { return JSON.parse(body); } catch {}
  // Try extracting from ```json block
  const match = body.match(/```json\s*(\{[\s\S]*?\})\s*```/i);
  if (match) {
    try { return JSON.parse(match[1]); } catch {}
  }
  throw new Error('Не удалось извлечь JSON из ответа');
}

async function translateCaptions(captions, { apiKey, model = DEFAULT_MODEL, fetchImpl }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY не задан');
  if (!fetchImpl) throw new Error('fetchImpl обязателен');
  if (!Array.isArray(captions) || captions.length === 0) return [];

  const prompt = `Переведи субтитры на английский. Верни ТОЛЬКО JSON в формате:
{"captions":[{"id":1,"start":0,"end":1,"translated_en":"Hello"}]}

ИСХОДНЫЕ СУБТИТРЫ:
${captions.map(c => `${c.id}. "${c.source_ru}" (${c.start}s – ${c.end}s)`).join('\n')}

ВЕРНИ ТОЛЬКО JSON, БЕЗ КОММЕНТАРИЕВ И ПОЯСНЕНИЙ.`;

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
  } catch (err) {
    throw new Error(`Сетевая ошибка при запросе к OpenRouter: ${err.message}`);
  }

  if (!response.ok) {
    const bodyText = await response.text();
    const safeBody = bodyText.slice(0, 1000);
    throw new Error(`HTTP ${response.status} при запросе к OpenRouter: ${safeBody}`);
  }

  let data;
  try {
    const text = await response.text();
    data = extractJson(text);
  } catch (err) {
    throw new Error(`Невалидный JSON в ответе OpenRouter: ${err.message}`);
  }

  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('Пустой ответ OpenRouter: нет choices');
  }

  const msg = data.choices[0].message;
  if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) {
    throw new Error('Пустой ответ OpenRouter: нет текстового content');
  }

  const translated = msg.content.trim();
  let parsed;
  try {
    parsed = extractJson(translated);
  } catch (err) {
    throw new Error(`Невалидный JSON в content choices: ${err.message}`);
  }

  if (!Array.isArray(parsed.captions)) {
    throw new Error('В ответе отсутствует массив captions');
  }

  const translatedCaps = parsed.captions.map(c => ({
    id: c.id,
    start: c.start,
    end: c.end,
    translated_en: c.translated_en,
  }));

  const errors = validateTranslatedCaptions(captions, translatedCaps);
  if (errors.length > 0) {
    throw new Error(`Ошибки валидации перевода: ${errors.join('; ')}`);
  }

  return translatedCaps;
}

module.exports = { translateCaptions, DEFAULT_MODEL, ENDPOINT };
