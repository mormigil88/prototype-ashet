// Чистое ядро пайплайна субтитров. Не делает сетевых вызовов и не запускает ffmpeg.
function assTime(value) {
  const total = Math.max(0, Math.round(Number(value || 0) * 100));
  const cs = total % 100;
  const seconds = Math.floor(total / 100) % 60;
  const minutes = Math.floor(total / 6000) % 60;
  const hours = Math.floor(total / 360000);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function plainText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function wrapTwoLines(value, maxLineLength = 42) {
  const suppliedLines = String(value || '').split(/\r?\n/).map(plainText).filter(Boolean);
  if (suppliedLines.length > 0 && suppliedLines.length <= 2 && suppliedLines.every((line) => line.length <= maxLineLength)) return suppliedLines.join('\n');
  const text = plainText(suppliedLines.join(' '));
  if (text.length <= maxLineLength) return text;
  const words = text.split(' ');
  let best;
  for (let i = 1; i < words.length; i += 1) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    if (left.length <= maxLineLength && right.length <= maxLineLength) {
      const candidate = { left, right, balance: Math.abs(left.length - right.length) };
      if (!best || candidate.balance < best.balance) best = candidate;
    }
  }
  return best ? `${best.left}\n${best.right}` : text;
}
function subtitleText(value) {
  return wrapTwoLines(value).replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim();
}
function endsSentence(word) { return /[.!?…](?:["»”')\]]*)$/.test(String(word || '').trim()); }

function groupWordsIntoCaptions(words, options = {}) {
  const maxChars = options.maxChars || 76;
  const maxDuration = options.maxDuration || 4.5;
  const pauseSeconds = options.pauseSeconds || 0.45;
  const captions = [];
  let chunk = [];
  const emit = () => {
    if (!chunk.length) return;
    const text = plainText(chunk.map((entry) => entry.word || entry.text).join(' '));
    if (text) captions.push({ id: captions.length + 1, start: Number(chunk[0].start), end: Math.max(Number(chunk[0].start) + 0.1, Number(chunk[chunk.length - 1].end)), source_ru: text });
    chunk = [];
  };
  for (const raw of words || []) {
    const word = plainText(raw.word || raw.text);
    const start = Number(raw.start);
    const end = Number(raw.end);
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const previous = chunk[chunk.length - 1];
    const nextLength = plainText([...chunk.map((entry) => entry.word), word].join(' ')).length;
    const nextDuration = chunk.length ? end - Number(chunk[0].start) : 0;
    if (chunk.length && (start - Number(previous.end) >= pauseSeconds || nextLength > maxChars || nextDuration > maxDuration)) emit();
    chunk.push({ word, start, end });
    if (endsSentence(word)) emit();
  }
  emit();
  return captions;
}

function validateTranslatedCaptions(source, translated) {
  const errors = [];
  if (!Array.isArray(source) || !Array.isArray(translated) || source.length !== translated.length) return ['Количество переведённых субтитров не совпадает с исходным.'];
  let previousEnd = -1;
  for (let i = 0; i < source.length; i += 1) {
    const input = source[i]; const output = translated[i];
    if (!output || input.id !== output.id) errors.push(`Неверный id у субтитра ${i + 1}.`);
    if (!output || input.start !== output.start || input.end !== output.end) errors.push(`Изменены таймкоды у субтитра ${i + 1}.`);
    const text = plainText(output && output.translated_en);
    if (!text) errors.push(`Пустой перевод у субтитра ${i + 1}.`);
    if (text.length > 84) errors.push(`Слишком длинный перевод у субтитра ${i + 1}.`);
    if (wrapTwoLines(text).split('\n').some((line) => line.length > 42)) errors.push(`Перевод не помещается в две строки у субтитра ${i + 1}.`);
    if (/```|^\s*[\[{]/.test(text)) errors.push(`Служебный текст в переводе ${i + 1}.`);
    if (input.start < previousEnd || input.end <= input.start) errors.push(`Некорректные таймкоды у субтитра ${i + 1}.`);
    previousEnd = input.end;
  }
  return errors;
}

function makeAss(captions) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Subtitle,DejaVu Sans,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,30,30,320,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const lines = (captions || []).map((caption) => {
    const text = subtitleText(caption.translated_en || caption.text);
    return text ? `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Subtitle,,0,0,0,,${text}` : '';
  }).filter(Boolean);
  return `${header}${lines.join('\n')}\n`;
}

module.exports = { assTime, groupWordsIntoCaptions, makeAss, validateTranslatedCaptions, wrapTwoLines };
