// Avatar V: v3 group → look ID is used as avatar_id for rendering.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('v3 Avatar Look completed → active with its default voice', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-v3-look-'));
  const saved = {
    HEYGEN_API_KEY: process.env.HEYGEN_API_KEY,
    HEYGEN_REGISTRY_DIR: process.env.HEYGEN_REGISTRY_DIR,
    HEYGEN_AVATAR_GROUP_ID_IRINA: process.env.HEYGEN_AVATAR_GROUP_ID_IRINA,
    HEYGEN_AVATAR_ID_IRINA: process.env.HEYGEN_AVATAR_ID_IRINA,
    HEYGEN_VOICE_ID_IRINA: process.env.HEYGEN_VOICE_ID_IRINA,
  };
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    HEYGEN_API_KEY: 'test-key',
    HEYGEN_REGISTRY_DIR: dir,
    HEYGEN_AVATAR_GROUP_ID_IRINA: 'irina-group',
    HEYGEN_AVATAR_ID_IRINA: 'irina-look',
    HEYGEN_VOICE_ID_IRINA: 'irina-voice',
  });
  global.fetch = async (url) => {
    assert.match(String(url), /\/v3\/avatars\/looks\?group_id=irina-group/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{
        id: 'irina-look', name: 'Ирина Digital Twin', status: 'completed',
        avatar_type: 'digital_twin', default_voice_id: 'irina-voice',
      }] }),
    };
  };
  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const { selectAvatar } = require('../heygen_avatar_registry');

  t.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const result = await selectAvatar({ doPreflight: true });
  assert.deepStrictEqual(
    { avatar_id: result.avatar_id, voice_id: result.voice_id, alias: result.alias },
    { avatar_id: 'irina-look', voice_id: 'irina-voice', alias: 'основной' },
  );
});
