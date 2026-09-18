/**
 * VisionProvider — интерфейс для анализа изображений и извлечения design-spec.
 * Провайдеры: OpenRouterVisionProvider, KimiVisionProvider.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class VisionProvider {
  constructor() {
    if (this.constructor === VisionProvider) {
      throw new Error('VisionProvider is abstract');
    }
  }

  /**
   * @param {string|Buffer} imagePathOrUrl
   * @param {object} options — fidelity, canvasSize, etc.
   * @returns {Promise<{spec: object, rawResponse: string, costUsd: number}>}
   */
  async analyze(imagePathOrUrl, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} imagePath
   * @returns {Promise<{hash: string, base64: string, mimeType: string}>}
   */
  async _prepareImage(imagePath) {
    let buffer = fs.readFileSync(imagePath);
    const MAX_BASE64 = 25 * 1024 * 1024; // 25 MB base64 ≈ 18.75 MB binary

    // Автосжатие если файл > ~19 MB
    if (buffer.length > MAX_BASE64 / 1.37) {
      const { execSync } = require('child_process');
      const tmpPath = `/tmp/carousel_img_${Date.now()}.jpg`;
      try {
        // sips (macOS) — сжимает до 1920px по длинной стороне, качество 80
        execSync(`sips -z 1920 2880 "${imagePath}" --out "${tmpPath}" 2>/dev/null || convert -resize 1920x2880\\> -quality 80 "${imagePath}" "${tmpPath}"`);
        buffer = fs.readFileSync(tmpPath);
        fs.unlinkSync(tmpPath);
      } catch (e) {
        // Если sips/convert не доступны, попробуем quality 60
        try {
          execSync(`convert -resize 1920x2880\\> -quality 60 "${imagePath}" "${tmpPath}"`);
          buffer = fs.readFileSync(tmpPath);
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    const mimeType = mimeTypes[ext] || 'image/png';
    return { hash, base64: buffer.toString('base64'), mimeType };
  }
}

/**
 * OpenRouterVisionProvider — deepseek-v4-flash-vision-exp через OpenRouter API.
 * Ключ берётся из OPENROUTER_API_KEY env var.
 * Использует two-pass: compact tokens → full spec.
 */
class OpenRouterVisionProvider extends VisionProvider {
  constructor() {
    super();
    this.apiKey = process.env.OPENROUTER_API_KEY;
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY env var is required');
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = 'deepseek/deepseek-v4-flash-vision-exp';
    // Тарифы deepseek-v4-flash-vision-exp (OpenRouter)
    this.pricing = { promptTokens: 0.000000555, completionTokens: 0.00000111 };
  }

  async analyze(imagePath, options = {}) {
    const { fidelity = 'adapt', targetCanvas = { width: 1080, height: 1350 } } = options;
    const { hash, base64, mimeType } = await this._prepareImage(imagePath);
    const imageUrl = `data:${mimeType};base64,${base64}`;

    // Single comprehensive pass with mobile chat UI component list
    const COMPONENT_TYPES = [
      'MobileStatusBar', 'AppHeader', 'IncomingChatBubble', 'OutgoingChatBubble',
      'ChatComposer', 'KeyboardPlaceholder', 'PrimaryActionButton', 'HeroTitle',
      'SolutionCard', 'BulletList', 'GradientOverlay', 'DecorativeBorder',
      'GoldAccentLine', 'EyebrowText', 'SubheadingText', 'Custom'
    ].join('|');

    const compactPrompt = `Analyze this design screenshot. It can be a mobile chat UI, social media carousel, editorial post, or any graphic design.
Return ONLY valid JSON (no markdown fences, no explanation).

Output schema:
{
  "sourceCanvas": {"width":N,"height":N,"aspectRatio":"W:H"},
  "targetCanvas": {"width":${targetCanvas.width},"height":${targetCanvas.height}},
  "adaptationStrategy": "preserve|crop|recompose",
  "palette": {
    "background":{"value":"#RRGGBB","confidence":0.0-1.0},
    "primary":{"value":"#RRGGBB","confidence":0.0-1.0},
    "secondary":{"value":"#RRGGBB","confidence":0.0-1.0},
    "accent":{"value":"#RRGGBB","confidence":0.0-1.0},
    "text":{"value":"#RRGGBB","confidence":0.0-1.0},
    "textSecondary":{"value":"#RRGGBB","confidence":0.0-1.0}
  },
  "typography": {
    "heading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","lineHeight":"1.0-2.0","confidence":0.0-1.0},
    "body":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","lineHeight":"1.0-2.0","confidence":0.0-1.0},
    "caption":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","confidence":0.0-1.0},
    "eyebrow":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","letterSpacing":"Npx","text":"content","confidence":0.0-1.0},
    "subheading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","text":"content","confidence":0.0-1.0}
  },
  "safeArea": {"top":N,"right":N,"bottom":N,"left":N},
  "components": [
    {
      "type": "${COMPONENT_TYPES}",
      "zone": {"x":N,"y":N,"width":N,"height":N},
      "align": "left|center|right",
      "zIndex": N,
      "background": {"value":"#RRGGBB","confidence":0.0-1.0},
      "foreground": {"value":"#RRGGBB","confidence":0.0-1.0},
      "borderRadius": N,
      "boxShadow": "none|blur Npx",
      "border": "none|Npx solid #RRGGBB",
      "opacity": N,
      "tailDirection": "left|right|none",
      "confidence": 0.0-1.0,
      "notes": "free text about what you see",
      "unsupported": false
    }
  ],
  "background": {"type":"solid|gradient|photo","colors":[{"value":"#RRGGBB","confidence":0.0-1.0}],"gradientDirection":"to bottom|...","description":"describe the background visual content"},
  "backgroundDescription": "Describe the main visual content of the background (e.g. marble sculpture in museum, dark office interior, forest landscape). Do NOT copy brand names, faces, or identifiable people.",
  "decorativeElements": [
    {"type":"border|accent_line|frame|rule","color":"#RRGGBB","width":N,"position":"top|bottom|left|right|center","confidence":0.0-1.0}
  ],
  "typographyHierarchy": {
    "eyebrow":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","letterSpacing":"Npx","text":"eyebrow label text"},
    "subheading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","text":"subheading text"},
    "confidence": 0.0-1.0
  },
  "lowConfidenceFields": ["field1","field2"],
  "confidence": 0.0-1.0
}

Rules:
- NEVER copy logos, watermarks, account names, phone numbers, profile pics, or verbatim message text
- Set unsupported:true for component types you cannot render faithfully
- Components with confidence<0.6 must be listed in lowConfidenceFields
- estimate borderRadius in pixels (0=none, 4=light, 12=medium, 20=heavy, 50=pill)
- tailDirection: where the chat bubble triangle points (left=incoming, right=outgoing)
- backgroundDescription: describe the main visual content (museum, architecture, nature, etc.) WITHOUT copying identifiable text or faces
- decorativeElements: note any border frames, accent lines, horizontal rules, ornamental dividers — estimate color and position
- typographyHierarchy: if there is a small eyebrow label above the main headline, or a subheading below it — capture all text levels
- Return ONLY JSON starting with {`;

    const r1 = await this._call([{type:'image_url',image_url:{url:imageUrl}},{type:'text',text:compactPrompt}]);
    const usage1 = r1.usage || {};
    const cost1 = (usage1.prompt_tokens * this.pricing.promptTokens) + (usage1.completion_tokens * this.pricing.completionTokens);

    const rawContent = this._extractContent(r1);
    if (!rawContent) throw new Error('Empty response from vision model');

    let jsonStr = rawContent.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let spec;
    try { spec = JSON.parse(jsonStr); }
    catch (e) {
      spec = this._parsePartialJsonMobile(jsonStr);
      console.error(`[OpenRouterVisionProvider] Partial JSON recovered. Keys: ${Object.keys(spec).join(',')}`);
    }

    // Validate required structure
    if (!spec.sourceCanvas) spec.sourceCanvas = { width: targetCanvas.width, height: targetCanvas.height };
    if (!spec.targetCanvas) spec.targetCanvas = targetCanvas;
    if (!spec.adaptationStrategy) spec.adaptationStrategy = fidelity === 'close' ? 'preserve' : 'recompose';
    if (!spec.components) spec.components = [];
    if (!spec.lowConfidenceFields) spec.lowConfidenceFields = [];

    spec.sourceImageHash = hash;
    spec.analyzedAt = new Date().toISOString();
    spec.modelUsed = this.model;
    spec.visionCostUsd = parseFloat(cost1.toFixed(6));
    spec.originalResponse = rawContent;
    spec.fidelity = fidelity;

    return { spec, rawResponse: rawContent, costUsd: spec.visionCostUsd, usage: usage1 };
  }

  async _call(content) {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ashet-irina.local',
        'X-Title': 'CarouselDesignAnalyzer'
      },
      body: JSON.stringify({ model: this.model, max_tokens: 8000, messages: [{role:'user',content}] })
    });
    if (!response.ok) { const t = await response.text(); throw new Error(`API ${response.status}: ${t}`); }
    return response.json();
  }

  _extractContent(data) {
    return data.choices?.[0]?.message?.content;
  }

  _extractJson(data) {
    const c = this._extractContent(data);
    if (!c) return null;
    const m = c.trim().match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  /**
   * Parse a truncated JSON by extracting valid prefix and filling required fields.
   */
  _parsePartialJsonMobile(partialStr) {
    const defaults = {
      sourceCanvas: { width: 1080, height: 1350 },
      targetCanvas: { width: 1080, height: 1350 },
      adaptationStrategy: 'recompose',
      palette: {
        background: { value: '#FFFFFF', confidence: 0.5 },
        primary: { value: '#F5A623', confidence: 0.5 },
        secondary: { value: '#E5E5E5', confidence: 0.5 },
        accent: { value: '#F5A623', confidence: 0.5 },
        text: { value: '#333333', confidence: 0.5 },
        textSecondary: { value: '#999999', confidence: 0.5 }
      },
      typography: {
        heading: { fontFamily: 'Arial', fontSize: '16px', fontWeight: 'normal', lineHeight: '1.3', confidence: 0.5 },
        body: { fontFamily: 'Arial', fontSize: '14px', fontWeight: 'normal', lineHeight: '1.4', confidence: 0.5 },
        caption: { fontFamily: 'Arial', fontSize: '12px', fontWeight: 'normal', confidence: 0.5 }
      },
      safeArea: { top: 47, right: 0, bottom: 0, left: 0 },
      components: [],
      background: { type: 'solid', colors: [{ value: '#FFFFFF', confidence: 0.5 }] },
      lowConfidenceFields: ['*'],
      confidence: 0.4
    };

    try {
      // Strip trailing incomplete property
      const stripped = partialStr.replace(/,\s*"?[\w]+"?\s*$/, '').replace(/,\s*$/, '');
      const partial = JSON.parse(stripped);
      // Deep merge
      const merged = JSON.parse(JSON.stringify(defaults));
      this._deepMerge(merged, partial);
      return merged;
    } catch {
      return defaults;
    }
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}

/**
 * MiniMaxVisionProvider — Anthropic-compatible API через MiniMax (Bearer token).
 * Быстрый, компактный вывод без reasoning overhead.
 */
class MiniMaxVisionProvider extends VisionProvider {
  constructor() {
    super();
    this.apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!this.apiKey) throw new Error('ANTHROPIC_AUTH_TOKEN env var is required');
    this.baseUrl = 'https://api.minimax.io/anthropic/v1/messages';
    this.model = 'MiniMax-v4-200k';
    // Тарифы (примерные для MiniMax, $0)
    this.pricing = { promptTokens: 0, completionTokens: 0 };
  }

  async analyze(imagePath, options = {}) {
    const { fidelity = 'adapt', targetCanvas = { width: 1080, height: 1350 } } = options;
    const { hash, base64, mimeType } = await this._prepareImage(imagePath);
    const w = targetCanvas.width;
    const h = targetCanvas.height;

    const COMPONENT_TYPES = [
      'MobileStatusBar', 'AppHeader', 'IncomingChatBubble', 'OutgoingChatBubble',
      'ChatComposer', 'KeyboardPlaceholder', 'PrimaryActionButton', 'HeroTitle',
      'SolutionCard', 'BulletList', 'GradientOverlay', 'DecorativeBorder',
      'GoldAccentLine', 'EyebrowText', 'SubheadingText', 'Custom'
    ].join('|');

    const prompt = `Analyze this design screenshot. It can be a mobile chat UI, social media carousel, editorial post, or any graphic design.
Return ONLY valid JSON, no markdown fences.

Allowed component types: ${COMPONENT_TYPES}
Choose the type that best matches each visual element.

Required JSON structure:
{
  "sourceCanvas": {"width":N,"height":N},
  "targetCanvas": {"width":${w},"height":${h}},
  "adaptationStrategy": "preserve|crop|recompose",
  "palette": {
    "background":{"value":"#RRGGBB","confidence":0.0-1.0},
    "primary":{"value":"#RRGGBB","confidence":0.0-1.0},
    "secondary":{"value":"#RRGGBB","confidence":0.0-1.0},
    "accent":{"value":"#RRGGBB","confidence":0.0-1.0},
    "text":{"value":"#RRGGBB","confidence":0.0-1.0},
    "textSecondary":{"value":"#RRGGBB","confidence":0.0-1.0}
  },
  "typography": {
    "heading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","lineHeight":"1.0-2.0","confidence":0.0-1.0},
    "body":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","lineHeight":"1.0-2.0","confidence":0.0-1.0},
    "caption":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","confidence":0.0-1.0},
    "eyebrow":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","letterSpacing":"Npx","text":"content","confidence":0.0-1.0},
    "subheading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","text":"content","confidence":0.0-1.0}
  },
  "safeArea": {"top":N,"right":N,"bottom":N,"left":N},
  "components": [
    {
      "type": "${COMPONENT_TYPES}",
      "zone": {"x":N,"y":N,"width":N,"height":N},
      "align": "left|center|right",
      "zIndex": N,
      "background":{"value":"#RRGGBB","confidence":0.0-1.0},
      "foreground":{"value":"#RRGGBB","confidence":0.0-1.0},
      "borderRadius": N,
      "boxShadow": "none|blur Npx",
      "opacity": N,
      "tailDirection": "left|right|none",
      "confidence": 0.0-1.0,
      "notes": "brief description",
      "unsupported": false
    }
  ],
  "background": {"type":"solid|gradient|photo","colors":[{"value":"#RRGGBB","confidence":0.0-1.0}],"gradientDirection":"...","description":"describe background visual"},
  "backgroundDescription": "Describe the main visual content (e.g. marble sculpture, dark office, forest). Do NOT copy brand names, faces, or identifiable people.",
  "decorativeElements": [
    {"type":"border|accent_line|frame|rule","color":"#RRGGBB","width":N,"position":"top|bottom|left|right|center","confidence":0.0-1.0}
  ],
  "typographyHierarchy": {
    "eyebrow":{"fontFamily":"name","fontSize":"Npx","fontWeight":"bold|normal","letterSpacing":"Npx","text":"eyebrow label"},
    "subheading":{"fontFamily":"name","fontSize":"Npx","fontWeight":"normal","text":"subheading text"},
    "confidence": 0.0-1.0
  },
  "lowConfidenceFields": ["field1"],
  "confidence": 0.0-1.0
}

Rules:
- NEVER copy logos, watermarks, account names, phone numbers, profile photos, or verbatim text
- Set unsupported:true for component types you cannot render faithfully
- borderRadius: 0=none, 4=light, 12=medium, 20=heavy, 50=pill
- tailDirection: left=incoming bubble, right=outgoing bubble
- Components with confidence<0.6 must be listed in lowConfidenceFields
- backgroundDescription: describe the background visual content WITHOUT copying text, faces, or brand names
- decorativeElements: note any border frames, accent lines, horizontal rules, ornamental dividers
- typographyHierarchy: capture all text levels — eyebrow above headline, subheading below headline`;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const baseResp = data.base_resp || {};
    if (baseResp.status_code !== 0) throw new Error(`MiniMax API error: ${baseResp.status_msg}`);

    const usage = data.usage || {};
    const costUsd = 0; // MiniMax включён в подписку

    const rawContent = data.content?.[0]?.text || '';
    if (!rawContent) throw new Error('Empty response from MiniMax vision model');

    let jsonStr = rawContent.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let spec;
    try { spec = JSON.parse(jsonStr); }
    catch (e) { spec = this._parsePartialJsonMobile(jsonStr); }

    if (!spec.sourceCanvas) spec.sourceCanvas = { width: w, height: h };
    if (!spec.targetCanvas) spec.targetCanvas = targetCanvas;
    if (!spec.adaptationStrategy) spec.adaptationStrategy = fidelity === 'close' ? 'preserve' : 'recompose';
    if (!spec.components) spec.components = [];
    if (!spec.lowConfidenceFields) spec.lowConfidenceFields = [];

    spec.sourceImageHash = hash;
    spec.analyzedAt = new Date().toISOString();
    spec.modelUsed = this.model;
    spec.visionCostUsd = 0;
    spec.originalResponse = rawContent;
    spec.fidelity = fidelity;

    return { spec, rawResponse: rawContent, costUsd, usage };
  }
}

/**
 * KimiVisionProvider — проверочный провайдер через OpenRouter + Claude Sonnet vision.
 * Добавляется только если smoke-test показал стабильный JSON.
 */
class KimiVisionProvider extends VisionProvider {
  constructor() {
    super();
    this.apiKey = process.env.OPENROUTER_API_KEY;
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY env var is required');
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = 'anthropic/claude-sonnet-5';
    this.pricing = { promptTokens: 0.000003, completionTokens: 0.000015 }; // approximate
  }

  async analyze(imagePath, options = {}) {
    const { fidelity = 'adapt', canvasSize = { width: 1080, height: 1350 } } = options;
    const { hash, base64, mimeType } = await this._prepareImage(imagePath);
    const imageUrl = `data:${mimeType};base64,${base64}`;

    const schemaPath = path.join(__dirname, 'design-spec.schema.json');
    let schema = {};
    try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')); } catch {}

    const systemPrompt = `You analyze carousel screenshots and return design tokens as JSON matching the provided schema.
Fidelity mode: ${fidelity}. Canvas: ${canvasSize.width}×${canvasSize.height}px.
Return ONLY valid JSON, no markdown fences. Never copy logos/watermarks/account names/photos/verbatim text.
For uncertain values use confidence < 0.7.`;

    const userPrompt = [
      { type: 'text', text: `Analyze this image. Return design tokens as JSON.\nSchema: ${JSON.stringify(schema).slice(0, 500)}...` },
      { type: 'image_url', image_url: { url: imageUrl } }
    ];

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, max_tokens: 2048, messages: [{ role: 'user', content: userPrompt }] })
    });

    if (!response.ok) throw new Error(`Kimi API error ${response.status}`);
    const data = await response.json();
    const usage = data.usage || {};
    const costUsd = (usage.prompt_tokens * this.pricing.promptTokens) + (usage.completion_tokens * this.pricing.completionTokens);

    let rawContent = data.choices?.[0]?.message?.content || '';
    let jsonStr = rawContent.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let spec;
    try { spec = JSON.parse(jsonStr); } catch (e) { throw new Error(`Invalid JSON from Kimi: ${e.message}`); }

    spec.sourceImageHash = hash;
    spec.analyzedAt = new Date().toISOString();
    spec.modelUsed = this.model;
    spec.visionCostUsd = parseFloat(costUsd.toFixed(6));
    spec.originalResponse = rawContent;

    return { spec, rawResponse: rawContent, costUsd, usage };
  }
}

/**
 * Manual validation against mobile-chat design-spec schema (no ajv dependency).
 * @param {object} spec
 * @throws Error with clear message
 */
function validateSpec(spec) {
  const errors = [];

  if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');

  // Required top-level fields
  for (const field of ['sourceCanvas', 'targetCanvas', 'palette', 'components']) {
    if (spec[field] === undefined) errors.push(`missing required field: ${field}`);
  }

  // sourceCanvas / targetCanvas
  for (const c of ['sourceCanvas', 'targetCanvas']) {
    if (spec[c]) {
      if (typeof spec[c].width !== 'number') errors.push(`${c}.width must be number`);
      if (typeof spec[c].height !== 'number') errors.push(`${c}.height must be number`);
    }
  }

  // palette: background, primary, text required
  if (spec.palette) {
    for (const colorField of ['background', 'primary', 'text']) {
      const c = spec.palette[colorField];
      if (!c) { errors.push(`palette.${colorField} is required`); continue; }
      if (typeof c.value !== 'string' || !/^#[0-9A-Fa-f]{6}/.test(c.value)) {
        errors.push(`palette.${colorField}.value must be #RRGGBB`);
      }
      if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) {
        errors.push(`palette.${colorField}.confidence must be 0-1`);
      }
    }
  } else if (!errors.includes('missing required field: palette')) {
    errors.push('missing required field: palette');
  }

  // components array of objects
  if (spec.components) {
    if (!Array.isArray(spec.components)) errors.push('components must be array');
    spec.components.forEach((comp, i) => {
      if (!comp.type) errors.push(`components[${i}].type is required`);
      if (comp.confidence !== undefined && (typeof comp.confidence !== 'number' || comp.confidence < 0 || comp.confidence > 1)) {
        errors.push(`components[${i}].confidence must be 0-1`);
      }
    });
  }

  // adaptationStrategy
  if (spec.adaptationStrategy && !['preserve', 'crop', 'recompose'].includes(spec.adaptationStrategy)) {
    errors.push('adaptationStrategy must be preserve|crop|recompose');
  }

  // lowConfidenceFields
  if (spec.lowConfidenceFields && !Array.isArray(spec.lowConfidenceFields)) {
    errors.push('lowConfidenceFields must be array');
  }

  if (errors.length > 0) {
    throw new Error('design-spec validation failed:\n  - ' + errors.join('\n  - '));
  }
  return true;
}

module.exports = { VisionProvider, OpenRouterVisionProvider, MiniMaxVisionProvider, KimiVisionProvider, validateSpec };
