(function (root) {
  'use strict';
  const TAGS = ['annoyed','sighs','sigh','happy','sad','angry','excited','surprised','curious','crying','laughs','laughing','chuckles','whispers','whispering','shouts','shouting','sarcastic','mischievously','clears throat','exhales','short pause','long pause','thoughtful'];
  const cuePattern = String.raw`\[[^\]\r\n]*\]`;
  const emotion = new RegExp(cuePattern+'[ \t]*','gi');
  const supportedMode = mode => ['game','roleplay','conversation'].includes(mode);
  const wrapper = /<\/?audio_(?:character|persona)\b[^>]*>/gi;
  function speechText(text){
    let value=String(text||'').trim().replace(/^(?:\*\*|__)([\s\S]*)(?:\*\*|__)$/,'$1').trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith('“')&&value.endsWith('”')))value=value.slice(1,-1).trim();
    return value;
  }
  function display(text) { return String(text || '').replace(wrapper, '').replace(emotion, ''); }
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function idPatterns(ids) {
    const result=[];let batch=[];
    for(const id of [...new Set(ids)].filter(id=>/^[A-Za-z0-9_-]{1,200}$/.test(id)).sort()) {
      if(batch.join('|').length+id.length>850){result.push('</?(?:'+batch.join('|')+')\\s*>');batch=[];}
      batch.push(escapeRe(id));
    }
    if(batch.length)result.push('</?(?:'+batch.join('|')+')\\s*>');
    return result;
  }
  function parse(text, participants=[]) {
    text = String(text || '');
    // Code examples are reference text, never payable speech.
    const masked = text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, m => ' '.repeat(m.length));
    const re = /<audio_(character|persona)\s+id\s*=\s*(?:\*\*|__)?(?:"([A-Za-z0-9_-]{1,200})"|'([A-Za-z0-9_-]{1,200})'|([A-Za-z0-9_-]{1,200}))(?:\*\*|__)?\s*>([\s\S]*?)<\/audio_\1\s*>/gi;
    const result = [];
    for (const m of masked.matchAll(re)) {
      if (/<\/?audio_|<[^>]*>/i.test(m[5]) || !display(m[5]).trim()) continue;
      result.push({ kind:m[1].toLowerCase(), id:m[2]||m[3]||m[4], raw:speechText(m[5]), start:m.index, end:m.index+m[0].length });
    }
    // Recover the observed <CharacterID> form only for a known, unambiguous speaker.
    for(const m of masked.matchAll(/<([A-Za-z0-9_-]{1,200})\s*>([\s\S]*?)<\/\1\s*>/g)) {
      const matches=participants.filter(p=>p.id===m[1]);
      if(matches.length!==1||/<[^>]*>/.test(m[2])||!display(m[2]).trim())continue;
      if(result.some(r=>m.index>=r.start&&m.index<r.end))continue;
      result.push({kind:matches[0].kind,id:m[1],raw:speechText(m[2]),start:m.index,end:m.index+m[0].length,recovered:true});
    }
    result.sort((a,b)=>a.start-b.start);result.forEach((r,i)=>r.index=i);
    return result;
  }
  function voice(line, config, settings, participants) {
    if (!participants.some(p => p.kind === line.kind && p.id === line.id)) throw new Error('등록된 참여자의 화자 ID가 아닙니다.');
    const rows = line.kind === 'character' ? config.voiceAssignments : settings.personaVoiceAssignments;
    const row = (Array.isArray(rows)?rows:[]).find(r => String(line.kind === 'character' ? r.characterId : r.personaId).trim() === line.id);
    const selected = typeof row?.voice==='string'?row.voice.trim():'';
    if (!selected) throw new Error(line.kind==='persona'?'Persona 연결 보이스를 찾지 못했습니다. 대사 옆 설정 버튼에서 이 Persona ID의 보이스를 지정하세요.':'이 캐릭터의 ElevenLabs 보이스를 ME TTS 설정에서 지정하세요.');
    return selected;
  }
  function hash(text) { let h=2166136261; for(const c of String(text)) { h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return (h>>>0).toString(36); }
  function key(message, line, selected, config) {
    return 'dialogue-v410:' + JSON.stringify([message.chatId,message.id,message.activeSwipeIndex||0,line.index,line.kind,line.id,line.raw,selected,config.source,config.baseUrl,config.audioConnectionId,config.model,config.speed,config.elevenLabsStability,config.elevenLabsLanguageCode]);
  }
  function instruction(mode, participants, rpMode='tagged') {
    if(!supportedMode(mode))return '';
    const cast=participants.map(p=>({kind:p.kind,id:p.id,name:p.name}));
    const shared='[ElevenLabs TTS output instructions]\nSpeech uses ElevenLabs v4. Add context-appropriate inline audio delivery cues in square brackets to spoken dialogue only. Examples include [annoyed], [sigh], [short pause], [chuckles], [thoughtful], [whispering], These examples are not a whitelist: use other suitable expressive delivery, emotion, vocalization and pacing tags supported by the model. Keep cues in English, brief and relevant, without changing the meaning of the dialogue. Do not use tags in narration or speaker/command fields.\n';
    const tagged=mode==='roleplay'&&rpMode==='tagged';
    return shared+(tagged?
      'Wrap each spoken line in <audio_character id="ACTUAL_ID">"dialogue"</audio_character> or <audio_persona id="ACTUAL_ID">"dialogue"</audio_persona>. Enclose the entire dialogue body, including audio cues, in one pair of ASCII double quotes. Use the exact participant ID listed below. Attribute quotes are separate from dialogue quotes. Do not nest wrappers, add HTML/Markdown inside them, or style tag names or id attributes. Narration stays outside wrappers. Write Persona dialogue only when the existing RP rules allow it. Never use an ID or character name as a tag name. Check opening/closing tag names, IDs and dialogue quotes before returning your answer.\n':
      'Preserve the native mode format and speaker/command fields. Do not introduce audio_character/audio_persona wrappers or ID-named tags. In standard RP, enclose spoken lines in double quotes and place cues inside those quotes. In GAME, cues belong in spoken text, never speaker or expression fields.\n')+
      'Participants: '+JSON.stringify(cast)+(tagged?'\nExact syntax examples for the active participants:\n'+cast.map(p=>'<audio_'+p.kind+' id="'+p.id+'">"[annoyed] Example dialogue."</audio_'+p.kind+'>').join('\n'):'');
  }
  const api = { TAGS, cuePattern, supportedMode, display, parse, voice, hash, key, instruction, speechText, idPatterns, wrapperPattern:wrapper.source };
  root.__marinaraDialogueCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);


(function () {
  'use strict';

  const EXT_ID = 'marinara-elevenlabs-multilingual-override';
  const VERSION = 'v4.3.6';

  const SETTINGS_KEY = 'marinara.elevenlabs.multilingual.override.v1';
  const RUNTIME_CACHE_KEY = `${EXT_ID}.runtimeCache`;
  const PANEL_ID = `${EXT_ID}-panel`;
  const STYLE_ID = `${EXT_ID}-style`;

  const DEFAULT_SETTINGS = {
    enabled: true,
    similarityBoost: 0.75,
    style: 0.0,
    speakerBoost: true,
    autoplayScope: 'characters',
    personaVoiceAssignments: [],
  };

  const DEFAULT_RUNTIME = {
    enabled: false,
    source: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'tts-1',
    voice: '',
    speed: 1.0,
    elevenLabsStability: 0.5,
    elevenLabsLanguageCode: '',
    apiKey: '',
  };

  const previous = globalThis.__marinaraElevenlabsOverride;
  if (previous && typeof previous.dispose === 'function') {
    try {
      previous.dispose();
    } catch {
      // ignore
    }
  }

  const state = (globalThis.__marinaraElevenlabsOverride = {
    disposed: false,
    observer: null,
    ticker: null,
    originalFetch: null,
    settings: loadSettings(),
    runtime: loadRuntime(),
    syncStatus: '',
    syncError: '',
    syncTimer: null,
    syncInFlight: false,
    queuedSyncReason: '',
    lastSyncHash: '',
    lastSyncAt: 0,
    personas: [],
    voiceOptions: [],
    personaDataLoading: false,
    personaDataError: '',
    dispose,
  });

  if (typeof marinara !== 'undefined') marinara.onCleanup(dispose);

  function dispose() {
    state.disposed = true;

    if (state.observer) state.observer.disconnect();
    if (state.ticker) clearInterval(state.ticker);
    if (state.syncTimer) clearTimeout(state.syncTimer);

    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    if (typeof state.originalFetch === 'function') {
      if (window.fetch === state.fetchObserver) window.fetch = state.originalFetch;
      state.originalFetch = null;
    }
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return Math.round(n * 100) / 100;
  }

  function clampSpeed(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (n < 0.25) return 0.25;
    if (n > 4.0) return 4.0;
    return Math.round(n * 100) / 100;
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function likelyMaskedApiKey(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.length <= 16 && !/[a-zA-Z0-9]/.test(text)) return true;
    if (/^[*?\u2022\u25CF\u25A0]+$/.test(text)) return true;
    return false;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        enabled: parsed.enabled !== false,
        similarityBoost: clamp01(parsed.similarityBoost ?? DEFAULT_SETTINGS.similarityBoost),
        style: clamp01(parsed.style ?? DEFAULT_SETTINGS.style),
        speakerBoost: parsed.speakerBoost !== false,
        autoplayScope: parsed.autoplayScope === 'characters-and-persona' ? 'characters-and-persona' : 'characters',
        personaVoiceAssignments: Array.isArray(parsed.personaVoiceAssignments)
          ? parsed.personaVoiceAssignments
              .filter((entry) => entry && typeof entry === 'object' && typeof entry.personaId === 'string')
              .map((entry) => ({
                personaId: entry.personaId,
                personaName: typeof entry.personaName === 'string' ? entry.personaName : '',
                voice: typeof entry.voice === 'string' ? entry.voice : '',
              }))
          : [],
      };
    } catch {
      return { ...DEFAULT_SETTINGS, personaVoiceAssignments: [] };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }
  state.setPersonaVoice=(id,voice,name)=>{
    let row=state.settings.personaVoiceAssignments.find(p=>p.personaId===id);
    if(!row){row={personaId:id,personaName:name||id,voice:''};state.settings.personaVoiceAssignments.push(row);}
    row.voice=voice.trim();saveSettings();state.refreshPersonaAssignments?.();
  };

  function loadRuntime() {
    try {
      const raw = localStorage.getItem(RUNTIME_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        enabled: parsed.enabled === true,
        source: typeof parsed.source === 'string' ? parsed.source : DEFAULT_RUNTIME.source,
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_RUNTIME.baseUrl,
        model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_RUNTIME.model,
        voice: typeof parsed.voice === 'string' ? parsed.voice : DEFAULT_RUNTIME.voice,
        speed: clampSpeed(parsed.speed ?? DEFAULT_RUNTIME.speed),
        elevenLabsStability: clamp01(parsed.elevenLabsStability ?? DEFAULT_RUNTIME.elevenLabsStability),
        elevenLabsLanguageCode:
          typeof parsed.elevenLabsLanguageCode === 'string'
            ? parsed.elevenLabsLanguageCode
            : DEFAULT_RUNTIME.elevenLabsLanguageCode,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULT_RUNTIME.apiKey,
      };
    } catch {
      return { ...DEFAULT_RUNTIME };
    }
  }

  function saveRuntime() {
    localStorage.setItem(RUNTIME_CACHE_KEY, JSON.stringify(state.runtime));
  }

  function upsertRuntimeFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (typeof payload.enabled === "boolean") state.runtime.enabled = payload.enabled;
    state.runtime.source = typeof payload.source === 'string' ? payload.source : state.runtime.source;
    state.runtime.baseUrl =
      typeof payload.baseUrl === 'string' && payload.baseUrl.trim() ? payload.baseUrl.trim() : state.runtime.baseUrl;
    state.runtime.model = typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : state.runtime.model;
    state.runtime.voice = typeof payload.voice === 'string' ? payload.voice : state.runtime.voice;
    state.runtime.speed = clampSpeed(payload.speed ?? state.runtime.speed);
    state.runtime.elevenLabsStability = clamp01(payload.elevenLabsStability ?? state.runtime.elevenLabsStability);
    state.runtime.elevenLabsLanguageCode =
      typeof payload.elevenLabsLanguageCode === 'string'
        ? payload.elevenLabsLanguageCode.trim()
        : state.runtime.elevenLabsLanguageCode;

    const key = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    if (key && !likelyMaskedApiKey(key)) {
      state.runtime.apiKey = key;
    }

    saveRuntime();
  }

  function normalizeModel(value) {
    return String(value || '').trim().toLowerCase();
  }

  function findSourceSelect() {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const select of selects) {
      const values = Array.from(select.options || []).map((o) => o.value);
      if (values.includes('openai') && values.includes('elevenlabs') && values.includes('pockettts')) {
        return select;
      }
    }
    return null;
  }

  function currentSource() {
    return findSourceSelect()?.value || state.runtime.source || 'openai';
  }

  function findTtsRoot() {
    const source = findSourceSelect();
    if (!source) return null;
    // The provider field belongs to the expanded TTS card body. Do not
    // require sliders: a disabled connection can still be configured.
    const field = source.parentElement;
    return source.closest('[data-component="TTSConfigCard"]') || field?.parentElement || null;
  }

  function stockRanges(root) {
    return Array.from(root.querySelectorAll('input[type="range"]'))
      .filter((slider) => !slider.closest(`#${PANEL_ID}`));
  }

  function findStabilitySlider() {
    const root = findTtsRoot();
    if (root) {
      const match = stockRanges(root).find(
        (slider) => Number(slider.min) === 0 && Number(slider.max) === 1,
      );
      if (match) return match;
    }
    return findSliderByKeyword('stability');
  }

  function findSpeedSlider() {
    const root = findTtsRoot();
    if (root) {
      const match = stockRanges(root).find(
        (slider) => Number(slider.max) > 1 && Number(slider.min) > 0 && Number(slider.min) < 1,
      );
      if (match) return match;
    }
    return findSliderByKeyword('speed');
  }

  function findFieldRowByLabelKeyword(keyword) {
    const labels = Array.from(document.querySelectorAll('span.text-xs.font-medium'));
    const target = keyword.toLowerCase();

    for (const label of labels) {
      const text = String(label.textContent || '').toLowerCase();
      if (!text.includes(target)) continue;
      const row = label.closest('div.space-y-1\\.5');
      if (row) return row;
    }
    return null;
  }

  function currentModel() {
    const modelInput = document.querySelector('input[list="elevenlabs-tts-models"]');
    if (modelInput && typeof modelInput.value === 'string' && modelInput.value.trim()) {
      return modelInput.value.trim();
    }

    const modelRow = findFieldRowByLabelKeyword('model');
    const textInput = modelRow ? modelRow.querySelector('input') : null;
    if (textInput && typeof textInput.value === 'string' && textInput.value.trim()) {
      return textInput.value.trim();
    }

    return state.runtime.model || '';
  }

  function isElevenLabsActive() {
    return currentSource() === 'elevenlabs';
  }

  function findSliderByKeyword(keyword) {
    const row = findFieldRowByLabelKeyword(keyword);
    if (!row) return null;
    return row.querySelector('input[type="range"]');
  }

  function readStability() {
    const slider = findStabilitySlider();
    if (slider) {
      const n = Number(slider.value);
      if (Number.isFinite(n)) return clamp01(n);
    }
    return clamp01(state.runtime.elevenLabsStability);
  }

  function readSpeed() {
    const slider = findSpeedSlider();
    if (slider) {
      const n = Number(slider.value);
      if (Number.isFinite(n)) return clampSpeed(n);
    }
    return clampSpeed(state.runtime.speed);
  }

  function forceFineSliderSteps() {
    const stability = findStabilitySlider();
    const speed = findSpeedSlider();

    if (stability && stability.step !== '0.01') stability.step = '0.01';
    if (speed && speed.step !== '0.01') speed.step = '0.01';
  }

  function ensureStockSliderSyncBindings() {
    const bind = (slider, tag) => {
      if (!slider) return;
      const key = `mariSyncBound_${tag}`;
      if (slider[key]) return;

      slider.addEventListener('input', () => queueAutoSync(`stock-${tag}`));
      slider.addEventListener('change', () => queueAutoSync(`stock-${tag}`));
      slider[key] = true;
    };

    bind(findStabilitySlider(), 'stability');
    bind(findSpeedSlider(), 'speed');
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      `#${PANEL_ID} .m-card{border:1px solid var(--border);border-radius:0.75rem;background:color-mix(in oklab,var(--secondary),black 6%);padding:0.65rem;display:grid;gap:0.55rem;}`,
      `#${PANEL_ID} .m-title{font-size:0.75rem;font-weight:600;color:var(--foreground);}`,
      `#${PANEL_ID} .m-sub{font-size:0.625rem;line-height:1.35;color:var(--muted-foreground);}`,
      `#${PANEL_ID} .m-row{display:grid;gap:0.35rem;}`,
      `#${PANEL_ID} .m-inline-between{display:flex;align-items:center;justify-content:space-between;gap:0.6rem;}`,
      `#${PANEL_ID} .m-inline{display:flex;align-items:center;gap:0.45rem;}`,
      `#${PANEL_ID} input[type="range"]{width:100%;accent-color:#fb7185;}`,
      `#${PANEL_ID} .m-status{font-size:0.625rem;line-height:1.3;color:var(--muted-foreground);}`,
      `#${PANEL_ID} .m-status.warn{color:#fbbf24;}`,
      `#${PANEL_ID} .m-status.ok{color:#86efac;}`,
      `#${PANEL_ID} .m-section{border-top:1px solid var(--border);padding-top:0.6rem;display:grid;gap:0.5rem;}`,
      `#${PANEL_ID} .m-assignment{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:0.4rem;align-items:center;}`,
      `#${PANEL_ID} select,#${PANEL_ID} button,#${PANEL_ID} input[type=password],#${PANEL_ID} input[type=text]{border:1px solid var(--border);border-radius:0.5rem;background:var(--background);color:var(--foreground);font-size:0.6875rem;min-height:2rem;padding:0.35rem 0.5rem;}`,
      `#${PANEL_ID} button{cursor:pointer;}`,
      `#${PANEL_ID} button:disabled{cursor:not-allowed;opacity:0.5;}`,
      `@media(max-width:640px){#${PANEL_ID} .m-assignment{grid-template-columns:1fr;}#${PANEL_ID} .m-assignment button{justify-self:end;}}`,
    ].join('\n')+"#marinara-elevenlabs-multilingual-override-panel .m-card{padding:18px;border-radius:16px;gap:14px;background:var(--card,#20212b)}\n#marinara-elevenlabs-multilingual-override-panel .m-title{font-size:13px;font-weight:650}\n#marinara-elevenlabs-multilingual-override-panel .m-sub,#marinara-elevenlabs-multilingual-override-panel .m-status{font-size:11px;line-height:1.65}\n#marinara-elevenlabs-multilingual-override-panel .m-section{padding-top:14px;gap:10px}\n#marinara-elevenlabs-multilingual-override-panel .m-row{gap:7px}\n#marinara-elevenlabs-multilingual-override-panel select,#marinara-elevenlabs-multilingual-override-panel button,#marinara-elevenlabs-multilingual-override-panel input[type=password],#marinara-elevenlabs-multilingual-override-panel input[type=text]{font-size:12px;min-height:36px;border-radius:9px;padding:7px 10px;max-width:100%;min-width:0}\n#marinara-elevenlabs-multilingual-override-panel input[type=range]{accent-color:#a79afa}\n#marinara-elevenlabs-multilingual-override-panel .m-assignment{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto}\n@media(max-width:640px){#marinara-elevenlabs-multilingual-override-panel .m-assignment{grid-template-columns:1fr}}";

    document.head.appendChild(style);
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    panel.innerHTML = [
      '<div class="m-card">',
      '  <div class="m-inline-between">',
      `    <span class="m-title">ElevenLabs 확장 설정 (${VERSION})</span>`,
      '    <label class="m-sub m-inline"><input id="m-enabled" type="checkbox">활성화</label>',
      '  </div>',
      '  <div class="m-sub">v4 대사 기능이 켜져 있으면 ElevenLabs v4를 사용합니다. 유사성은 ElevenLabs 보이스 설정 API에 동기화되며 음성 생성 요청을 추가하지 않습니다.</div>',
      '  <div class="m-row"><label class="m-sub" for="m-api-key">Similarity 동기화용 ElevenLabs API 키</label><input id="m-api-key" type="password" autocomplete="new-password" placeholder="실제 키 입력 (Persona 보이스 지정에는 필요 없음)"><div class="m-inline"><button id="m-key-save" type="button">키 저장</button><button id="m-key-clear" type="button">키 삭제</button><span id="m-key-state" class="m-sub"></span></div></div>',
      '  <div class="m-row">',
      '    <div class="m-sub" id="m-sim-label">Similarity Boost</div>',
      '    <input id="m-sim" type="range" min="0" max="1" step="0.01">',
      '  </div>',
      '  <div class="m-row">',
      '    <div class="m-sub" id="m-style-label">Style Exaggeration</div>',
      '    <input id="m-style" type="range" min="0" max="1" step="0.01">',
      '  </div>',
      '  <div class="m-row">',
      '    <label class="m-sub m-inline"><input id="m-speaker" type="checkbox">Speaker Boost</label>',
      '  </div>',
      '  <div class="m-section">',
      '    <div class="m-title">Conversation 자동 음성 생성 범위</div>',
      '    <select id="m-autoplay-scope">',
      '      <option value="characters">Character만</option>',
      '      <option value="characters-and-persona">Character + Persona</option>',
      '    </select>',
      '    <div class="m-sub">Character 자동 생성은 순정 “Conversation Messages” 설정을 따릅니다. Persona 자동 생성은 같은 설정이 켜져 있을 때 새로 보낸 Persona 메시지에만 적용됩니다.</div>',
      '  </div>',
      '  <div class="m-section">',
      '    <div class="m-inline-between"><span class="m-title">Persona 보이스</span><button id="m-persona-refresh" type="button">목록 새로고침</button></div>',
      '    <div class="m-sub">과거 메시지는 전송 당시 Persona를 기준으로 보이스를 선택합니다. 지정하지 않은 Persona는 기본 TTS 보이스를 사용합니다.</div>',
      '    <div id="m-persona-assignments" class="m-row"></div>',
      '    <button id="m-persona-add" type="button">Persona 보이스 추가</button>',
      '    <div id="m-persona-data-status" class="m-status"></div>',
      '  </div>',
      '  <div class="m-row">',
      '    <div id="m-status" class="m-status"></div>',
      '  </div>',
      '</div>',
    ].join('');

    const refs = {
      apiKey: panel.querySelector('#m-api-key'),
      keySave: panel.querySelector('#m-key-save'),
      keyClear: panel.querySelector('#m-key-clear'),
      keyState: panel.querySelector('#m-key-state'),
      enabled: panel.querySelector('#m-enabled'),
      sim: panel.querySelector('#m-sim'),
      style: panel.querySelector('#m-style'),
      speaker: panel.querySelector('#m-speaker'),
      status: panel.querySelector('#m-status'),
      simLabel: panel.querySelector('#m-sim-label'),
      styleLabel: panel.querySelector('#m-style-label'),
      autoplayScope: panel.querySelector('#m-autoplay-scope'),
      personaAssignments: panel.querySelector('#m-persona-assignments'),
      personaAdd: panel.querySelector('#m-persona-add'),
      personaRefresh: panel.querySelector('#m-persona-refresh'),
      personaDataStatus: panel.querySelector('#m-persona-data-status'),
    };

    function renderPersonaAssignments() {
      refs.personaAssignments.replaceChildren();
      const assignments = state.settings.personaVoiceAssignments;
      if (assignments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'm-sub';
        empty.textContent = '지정된 Persona 보이스가 없습니다.';
        refs.personaAssignments.appendChild(empty);
      }

      assignments.forEach((assignment, index) => {
        const row = document.createElement('div');
        row.className = 'm-assignment';

        const personaSelect = document.createElement('select');
        personaSelect.setAttribute('aria-label', 'Persona');
        const savedPersonaMissing = assignment.personaId && !state.personas.some((persona) => persona.id === assignment.personaId);
        const personaOptions = [
          ...(savedPersonaMissing ? [{ id: assignment.personaId, name: assignment.personaName || assignment.personaId }] : []),
          ...state.personas,
        ];
        for (const persona of personaOptions) {
          const option = document.createElement('option');
          option.value = persona.id;
          option.textContent = persona.name || persona.id;
          personaSelect.appendChild(option);
        }
        personaSelect.value = assignment.personaId;
        personaSelect.addEventListener('change', () => {
          const persona = state.personas.find((entry) => entry.id === personaSelect.value);
          assignment.personaId = personaSelect.value;
          assignment.personaName = persona?.name || assignment.personaName || personaSelect.value;
          saveSettings();
        });

        const voiceSelect = document.createElement('select');
        voiceSelect.setAttribute('aria-label', `${assignment.personaName || 'Persona'} voice`);
        const savedVoiceMissing = assignment.voice && !state.voiceOptions.some((voice) => voice.id === assignment.voice);
        const voiceOptions = [
          { id: '', name: '기본 TTS 보이스' },
          ...(savedVoiceMissing ? [{ id: assignment.voice, name: `${assignment.voice} (saved)` }] : []),
          ...state.voiceOptions,
        ];
        for (const voice of voiceOptions) {
          const option = document.createElement('option');
          option.value = voice.id;
          option.textContent = voice.name === voice.id ? voice.id : `${voice.name}${voice.id ? ` (${voice.id})` : ''}`;
          voiceSelect.appendChild(option);
        }
        voiceSelect.value = assignment.voice;
        voiceSelect.addEventListener('change', () => {
          assignment.voice = voiceSelect.value;
          voiceInput.value = assignment.voice;
          saveSettings();
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '삭제';
        remove.addEventListener('click', () => {
          state.settings.personaVoiceAssignments.splice(index, 1);
          saveSettings();
          renderPersonaAssignments();
        });

        const voiceInput = document.createElement('input');
        voiceInput.type = 'text';
        voiceInput.placeholder = '보이스 ID 직접 입력';
        voiceInput.setAttribute('aria-label', `${assignment.personaName || 'Persona'} voice ID`);
        voiceInput.value = assignment.voice;
        voiceInput.addEventListener('change', () => {
          assignment.voice = voiceInput.value.trim();
          saveSettings();
          if (assignment.voice && !Array.from(voiceSelect.options).some((option) => option.value === assignment.voice)) {
            const option = document.createElement('option'); option.value = assignment.voice; option.textContent = assignment.voice; voiceSelect.appendChild(option);
          }
          voiceSelect.value = assignment.voice;
        });
        row.append(personaSelect, voiceSelect, voiceInput, remove);
        refs.personaAssignments.appendChild(row);
      });

      const assignedPersonaIds = new Set(assignments.map((entry) => entry.personaId).filter(Boolean));
      refs.personaAdd.disabled = state.personas.length === 0 || assignedPersonaIds.size >= state.personas.length;
      refs.personaRefresh.disabled = state.personaDataLoading;
      refs.personaDataStatus.textContent = state.personaDataLoading
        ? 'Persona와 보이스 목록을 불러오는 중…'
        : state.personaDataError || `${state.personas.length}개 Persona · ${state.voiceOptions.length}개 보이스`;
      refs.personaDataStatus.classList.toggle('warn', !!state.personaDataError);
    }

    function setStatus(message, type) {
      if (refs.status.textContent !== (message || '')) refs.status.textContent = message || ''; 
      refs.status.classList.remove('warn', 'ok');
      if (type === 'warn') refs.status.classList.add('warn');
      if (type === 'ok') refs.status.classList.add('ok');
    }

    function updateStatus() {
      const keyState = state.runtime.apiKey ? '키 저장됨' : '키 미설정';
      if (refs.keyState.textContent !== keyState) refs.keyState.textContent = keyState;
      if (state.runtime.enabled !== true) setStatus('TTS 연결 OFF · 설정 저장 가능, API 적용은 연결 ON 이후 진행됩니다.', 'warn');
      else if (!state.settings.enabled) setStatus('확장 설정이 비활성화되어 있습니다.', 'warn');
      else if (state.syncError) setStatus(state.syncError, 'warn');
      else if (!state.runtime.apiKey) setStatus('Similarity 동기화용 키를 위에서 저장하세요. Persona 보이스 지정과 음성 생성은 순정 서버 연결로 독립 작동합니다.', 'warn');
      else setStatus(state.syncStatus || '설정 변경 시 모든 보이스에 자동 적용됩니다.', 'ok');
    }
    panel.updateStatus = updateStatus;

    function repaint() {
      refs.enabled.checked = !!state.settings.enabled;
      refs.sim.value = String(state.settings.similarityBoost);
      refs.style.value = String(state.settings.style);
      refs.speaker.checked = !!state.settings.speakerBoost;
      refs.autoplayScope.value = state.settings.autoplayScope;

      refs.simLabel.textContent = `Similarity Boost (${Math.round(state.settings.similarityBoost * 100)}%)`;
      refs.styleLabel.textContent = `Style Exaggeration (${Math.round(state.settings.style * 100)}%)`;

      updateStatus();
      renderPersonaAssignments();
    }

    refs.keySave.addEventListener('click', () => {
      const key = refs.apiKey.value.trim();
      if (!key || likelyMaskedApiKey(key)) { setStatus('마스킹된 값이 아닌 실제 API 키를 입력하세요.', 'warn'); return; }
      state.runtime.apiKey = key;
      refs.apiKey.value = '';
      state.syncError = '';
      state.lastSyncHash = '';
      saveRuntime();
      queueAutoSync('key-save');
      updateStatus();
    });
    refs.keyClear.addEventListener('click', () => { discardRejectedApiKey(); refs.apiKey.value = ''; state.syncError = ''; updateStatus(); });

    refs.enabled.addEventListener('change', function () {
      state.settings.enabled = !!refs.enabled.checked;
      saveSettings();
      queueAutoSync('enabled');
      repaint();
    });

    refs.sim.addEventListener('input', function () {
      state.settings.similarityBoost = clamp01(refs.sim.value);
      saveSettings();
      queueAutoSync('sim');
      repaint();
    });

    refs.style.addEventListener('input', function () {
      state.settings.style = clamp01(refs.style.value);
      saveSettings();
      queueAutoSync('style');
      repaint();
    });

    refs.speaker.addEventListener('change', function () {
      state.settings.speakerBoost = !!refs.speaker.checked;
      saveSettings();
      queueAutoSync('speaker');
      repaint();
    });

    refs.autoplayScope.addEventListener('change', function () {
      state.settings.autoplayScope = refs.autoplayScope.value === 'characters-and-persona'
        ? 'characters-and-persona'
        : 'characters';
      saveSettings();
    });

    refs.personaAdd.addEventListener('click', function () {
      const assigned = new Set(state.settings.personaVoiceAssignments.map((entry) => entry.personaId));
      const persona = state.personas.find((entry) => !assigned.has(entry.id)) || state.personas[0];
      if (!persona) return;
      state.settings.personaVoiceAssignments.push({
        personaId: persona.id,
        personaName: persona.name,
        voice: state.voiceOptions[0]?.id || state.runtime.voice || '',
      });
      saveSettings();
      renderPersonaAssignments();
    });

    refs.personaRefresh.addEventListener('click', function () {
      void loadPersonaVoiceData(true).then(renderPersonaAssignments);
      renderPersonaAssignments();
    });

    repaint();
    void loadPersonaVoiceData(false).then(repaint);
    state.refreshPersonaAssignments=renderPersonaAssignments;
    return panel;
  }

  async function loadPersonaVoiceData(force) {
    if (state.personaDataLoading) return;
    if (!force && state.personas.length > 0 && state.voiceOptions.length > 0) return;
    state.personaDataLoading = true;
    state.personaDataError = '';
    try {
      const fetchImpl = typeof state.originalFetch === 'function' ? state.originalFetch : window.fetch.bind(window);
      const headers = {};
      const secret = localStorage.getItem('marinara_admin_secret');
      if (secret) headers['X-Admin-Secret'] = secret;
      const personaResponse = await fetchImpl('/api/characters/personas/list', { cache: 'no-store', headers });
      if (!personaResponse.ok) throw new Error(`Persona 목록 조회 실패 (${personaResponse.status})`);
      const personas = await personaResponse.json();
      const characterResponse=await fetchImpl('/api/characters?includeBuiltIn=true',{cache:'no-store',headers});
      if(!characterResponse.ok)throw new Error(`캐릭터 Persona 목록 조회 실패 (${characterResponse.status})`);
      const characters=await characterResponse.json();
      const asPersona=(entry)=>{let data=entry.data;try{if(typeof data==='string')data=JSON.parse(data);}catch{data={};}return {id:entry.id,name:(entry.name||data?.name||entry.id)+' (캐릭터 Persona)'};};
      state.personas = [...(Array.isArray(personas) ? personas : []),...(Array.isArray(characters)?characters.map(asPersona):[])]
        .filter((entry) => entry && typeof entry.id === 'string')
        .map((entry) => ({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

      await assertNativeTtsEnabled();
      let voices = null;
      const voiceResponse = await fetchImpl('/api/tts/voices', { cache: 'no-store', headers }).catch(() => null);
      if (voiceResponse?.ok) voices = await voiceResponse.json();
      if (!voices && isElevenLabsActive() && state.runtime.apiKey) {
        await assertNativeTtsEnabled();
        const apiRoot = elevenApiRoot(state.runtime.baseUrl || 'https://api.elevenlabs.io');
        const directResponse = await fetchImpl(`${apiRoot}/v2/voices?page_size=100`, {
          headers: { 'xi-api-key': state.runtime.apiKey },
        });
        if (directResponse.ok) {
          const direct = await directResponse.json();
          voices = {
            voiceOptions: (Array.isArray(direct?.voices) ? direct.voices : []).map((entry) => ({
              id: entry?.voice_id || entry?.voiceId || '',
              name: entry?.name || entry?.voice_id || entry?.voiceId || '',
            })),
          };
        }
      }
      if (!voices) throw new Error(`보이스 목록 조회 실패${voiceResponse ? ` (${voiceResponse.status})` : ''}`);
      const rawVoices = Array.isArray(voices?.voiceOptions)
        ? voices.voiceOptions
        : (Array.isArray(voices?.voices) ? voices.voices.map((id) => ({ id, name: id })) : []);
      state.voiceOptions = rawVoices
        .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
        .map((entry) => ({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id }));
    } catch (error) {
      state.personaDataError = error instanceof Error ? error.message : 'Persona/보이스 목록 조회 실패';
    } finally {
      state.personaDataLoading = false;
    }
  }

  function ensurePanelMounted() {
    const existing = document.getElementById(PANEL_ID);

    if (!isElevenLabsActive()) {
      if (existing) existing.remove();
      return;
    }

    ensureStyle();

    const root = findTtsRoot();
    if (!root) return;
    const slider = findStabilitySlider();
    const stabilityRow = slider?.parentElement;

    const panel = existing || buildPanel();
    if (stabilityRow && root.contains(stabilityRow)) {
      if (panel.previousElementSibling !== stabilityRow) stabilityRow.insertAdjacentElement('afterend', panel);
    } else if (panel.parentElement !== root) root.appendChild(panel);
    panel.updateStatus?.();
  }

  function ttsConfigUrl(url) {
    return /\/api\/tts\/config(?:\?|$)/i.test(url);
  }

  function connectionSaveUrl(url) {
    return /\/api\/connections(?:\/[^/?]+)?(?:\?|$)/i.test(url);
  }

  function upsertRuntimeFromConnectionPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.provider !== 'audio' || payload.audioSource !== 'elevenlabs') return false;
    state.runtime.source = 'elevenlabs';
    if (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) state.runtime.baseUrl = payload.baseUrl.trim();
    if (typeof payload.model === 'string' && payload.model.trim()) state.runtime.model = payload.model.trim();
    if (typeof payload.audioVoice === 'string') state.runtime.voice = payload.audioVoice;
    const key = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    if (key && !likelyMaskedApiKey(key)) state.runtime.apiKey = key;
    saveRuntime();
    return !!key && !likelyMaskedApiKey(key);
  }

  function discardRejectedApiKey() {
    state.runtime.apiKey = '';
    saveRuntime();
    state.lastSyncHash = '';
  }

  function resolveUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    return String(input?.url || '');
  }

  function resolveMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input instanceof Request) return String(input.method || 'GET').toUpperCase();
    return 'GET';
  }

  async function readJsonBodyFromFetch(input, init) {
    if (init && 'body' in init) {
      const body = init.body;
      if (typeof body === 'string') return parseJsonSafe(body);
      return null;
    }

    if (input instanceof Request) {
      const method = resolveMethod(input, init);
      if (method === 'GET' || method === 'HEAD') return null;
      try {
        const text = await input.clone().text();
        return text ? parseJsonSafe(text) : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  function installFetchObserver() {
    if (typeof state.originalFetch === 'function') return;
    const originalFetch = window.fetch.bind(window);
    state.originalFetch = originalFetch;

    const fetchObserver = async function (input, init) {
      if (state.disposed) return originalFetch(input, init);
      const url = resolveUrl(input);
      const isTtsConfig = ttsConfigUrl(url);
      const isConnectionSave = connectionSaveUrl(url);
      if (!isTtsConfig && !isConnectionSave) {
        return originalFetch(input, init);
      }

      const method = resolveMethod(input, init);

      if (isTtsConfig && method === 'PUT') {
        try {
          const payload = await readJsonBodyFromFetch(input, init);
          upsertRuntimeFromPayload(payload);
          queueAutoSync('config-put');
        } catch {
          // ignore
        }
      }

      if (isConnectionSave && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        try {
          const payload = await readJsonBodyFromFetch(input, init);
          if (upsertRuntimeFromConnectionPayload(payload)) queueAutoSync('connection-save');
        } catch {
          // ignore
        }
      }

      const response = await originalFetch(input, init);

      if (isTtsConfig && method === 'GET' && response && response.ok) {
        try {
          const clone = response.clone();
          const contentType = String(clone.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const payload = await clone.json();
            upsertRuntimeFromPayload(payload);
            queueAutoSync('config-get');
          }
        } catch {
          // ignore
        }
      }

      return response;
    };
    state.fetchObserver = fetchObserver;
    window.fetch = fetchObserver;
  }

  function syncFingerprint() {
    return [
      state.settings.enabled,
      state.settings.similarityBoost,
      state.settings.style,
      state.settings.speakerBoost,
      readStability(),
      readSpeed(),
      state.runtime.baseUrl,
      state.runtime.apiKey,
      currentSource(),
      normalizeModel(currentModel()),
    ].join('|');
  }

  function queueAutoSync(reason) {
    state.queuedSyncReason = reason || '';

    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      void runAutoSync();
    }, 420);
  }

  async function runAutoSync() {
    if (state.disposed) return;
    if (state.syncInFlight) return;

    if (state.runtime.enabled !== true) {
      state.syncStatus = 'TTS 연결 OFF';
      state.syncError = '';
      return;
    }

    if (!state.settings.enabled) {
      state.syncStatus = '확장 비활성 상태';
      state.syncError = '';
      return;
    }

    if (!isElevenLabsActive()) {
      state.syncStatus = '모델 조건 미충족';
      state.syncError = '';
      return;
    }

    const apiKey = String(state.runtime.apiKey || '').trim();
    if (!apiKey) {
      state.syncStatus = '';
      state.syncError = '';
      state.syncStatus = 'Similarity 동기화용 키 미설정 · Persona 기능은 독립 작동합니다.';
      return;
    }

    const fingerprint = syncFingerprint();
    const now = Date.now();
    // A config read is not a settings change. Do not reapply every voice
    // each time native/extension TTS verifies the connection.
    if (fingerprint === state.lastSyncHash) {
      return;
    }
    if (fingerprint === state.lastFailedSyncHash && now - (state.lastFailedSyncAt || 0) < 30000) return;

    state.syncInFlight = true;
    state.syncError = '';

    try {
      const appliedCount = await syncAllVoices(apiKey);
      state.lastSyncHash = fingerprint;
      state.lastSyncAt = Date.now();
      state.lastFailedSyncHash = '';
      state.syncStatus = `전체 보이스 ${appliedCount}개 자동 적용 완료`;
      state.syncError = '';
    } catch (err) {
      state.lastFailedSyncHash = fingerprint;
      state.lastFailedSyncAt = Date.now();
      state.syncStatus = '';
      state.syncError = err instanceof Error ? err.message : '자동 적용 실패';
    } finally {
      state.syncInFlight = false;
      document.getElementById(PANEL_ID)?.updateStatus?.();
    }
  }

  function elevenApiRoot(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v\d+$/, '');
  }

  async function assertNativeTtsEnabled() {
    if (state.disposed) throw new Error('확장이 비활성화되었습니다.');
    const fetchImpl = typeof state.originalFetch === 'function' ? state.originalFetch : window.fetch.bind(window);
    const headers = {};
    const secret = localStorage.getItem('marinara_admin_secret');
    if (secret) headers['X-Admin-Secret'] = secret;
    const response = await fetchImpl('/api/tts/config', { cache: 'no-store', headers });
    if (!response.ok) throw new Error('TTS 연결 상태를 확인하지 못해 API 요청을 중단했습니다.');
    const config = await response.json();
    upsertRuntimeFromPayload(config);
    if (config.enabled !== true) throw new Error('TTS 연결 OFF · 보이스 목록 조회는 연결 ON 후 새로고침하세요.');
  }

  async function fetchAllVoiceIds(apiRoot, apiKey) {
    await assertNativeTtsEnabled();
    if (!state.settings.enabled || state.runtime.source !== 'elevenlabs') throw new Error('ElevenLabs 설정 적용이 비활성화되었습니다.');
    const url = `${apiRoot}/v1/voices`;
    const fetchImpl = typeof state.originalFetch === 'function' ? state.originalFetch : window.fetch.bind(window);
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 401) {
        discardRejectedApiKey();
        throw new Error('저장된 확장용 ElevenLabs 키가 유효하지 않습니다. Similarity 동기화용 API 키 칸에 실제 키를 다시 입력하고 저장해 주세요.');
      }
      throw new Error(`보이스 목록 조회 실패 (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }

    const data = await res.json();
    const list = Array.isArray(data?.voices) ? data.voices : [];

    const ids = [];
    for (const item of list) {
      const id = typeof item?.voice_id === 'string' ? item.voice_id : typeof item?.voiceId === 'string' ? item.voiceId : '';
      if (id) ids.push(id);
    }

    return ids;
  }

  async function applySettingsToVoice(apiRoot, apiKey, voiceId, body) {
    // fetchAllVoiceIds verified the live connection once for this batch.
    // Observed OFF changes stop subsequent work without a GET per voice.
    if (state.disposed || state.runtime.enabled !== true) throw new Error('TTS 연결 OFF · 설정 적용을 중단했습니다.');
    if (!state.settings.enabled || state.runtime.source !== 'elevenlabs') throw new Error('ElevenLabs 설정 적용이 비활성화되었습니다.');
    const url = `${apiRoot}/v1/voices/${encodeURIComponent(voiceId)}/settings/edit`;

    const fetchImpl = typeof state.originalFetch === 'function' ? state.originalFetch : window.fetch.bind(window);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 401) {
        discardRejectedApiKey();
        throw new Error('저장된 확장용 ElevenLabs 키가 유효하지 않습니다. Similarity 동기화용 API 키 칸에 실제 키를 다시 입력하고 저장해 주세요.');
      }
      throw new Error(`보이스(${voiceId}) 적용 실패 (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
  }

  async function syncAllVoices(apiKey) {
    const apiRoot = elevenApiRoot(state.runtime.baseUrl || 'https://api.elevenlabs.io');
    const voiceIds = await fetchAllVoiceIds(apiRoot, apiKey);

    if (voiceIds.length === 0) {
      throw new Error('적용 가능한 보이스를 찾지 못했습니다.');
    }

    const body = {
      stability: readStability(),
      similarity_boost: clamp01(state.settings.similarityBoost),
      style: clamp01(state.settings.style),
      use_speaker_boost: !!state.settings.speakerBoost,
      speed: readSpeed(),
    };

    const concurrency = 4;
    let cursor = 0;

    async function worker() {
      while (cursor < voiceIds.length) {
        const idx = cursor;
        cursor += 1;
        const id = voiceIds[idx];
        await applySettingsToVoice(apiRoot, apiKey, id, body);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, voiceIds.length); i += 1) {
      workers.push(worker());
    }

    await Promise.all(workers);
    return voiceIds.length;
  }

  function renderTick() {
    if (state.disposed) return;

    forceFineSliderSteps();
    ensureStockSliderSyncBindings();
    ensurePanelMounted();
  }

  function boot() {
    installFetchObserver();
    const headers = {};
    const secret = localStorage.getItem('marinara_admin_secret');
    if (secret) headers['X-Admin-Secret'] = secret;
    void state.originalFetch('/api/tts/config', { cache: 'no-store', headers })
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        if (state.disposed || !config) return;
        upsertRuntimeFromPayload(config);
        renderTick();
        queueAutoSync('initial-config');
      }).catch(() => {});

    state.observer = new MutationObserver(renderTick);
    state.observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });

    state.ticker = setInterval(renderTick, 900);

    renderTick();
    queueAutoSync('boot');
    setTimeout(() => queueAutoSync('boot-late'), 2200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();


/*
 * Marinara Unified TTS Controls
 *
 * Third-party extension script. Import this file directly from
 * Settings > Extensions.
 */
(function () {
  "use strict";

  const EXT = "mari-ext-tts";
  const DB_NAME = "marinara-unified-tts-extension";
  const DB_VERSION = 1;
  const STORE = "clips";
  const MAX_CHARS_PER_TTS_REQUEST = 2800;
  const MAX_BYTES_PER_TTS_REQUEST = 4500;
  const TTS_REQUEST_TIMEOUT_MS = 90000;
  const CSRF_HEADER = "x-marinara-csrf";
  const CSRF_HEADER_VALUE = "1";
  const VERIFIED_TTS_CONFIG = Symbol("verified-tts-config");
  let ttsConfigInFlight = null;
  let ttsConfigRetryAt = 0;
  const TEXT_TOOLS_VERSION = 3;
  const EXTENSION_SETTINGS_KEY = "marinara.elevenlabs.multilingual.override.v1";
  const GAME_TTS_BLOCKED_REQUESTS_KEY = "mari-ext-tts-blocked-requests";
  const GAME_TTS_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;
  const GAME_TTS_BLOCK_FALLBACK_MESSAGE =
    "This Game voice-over text previously failed the provider safety check, so the extension skipped a duplicate retry.";

  const globalState = (globalThis.__marinaraUnifiedTtsExtension ??= {});
  if (globalState.dispose) {
    try {
      globalState.dispose();
    } catch {
      // Ignore stale extension cleanup errors.
    }
  }
  const icons = {
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12"/></svg>',
    volume:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    loader:
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="mari-ext-tts-spin"><path d="M21 12a9 9 0 0 1-9 9"/></svg>',
  };

  const gameArchiveMetadata = new Map();
  let gameArchiveIndexLoad = null;
  let gameArchiveIndexLoaded = false;
  let dbPromise = null;
  let nativeDbPromise = null;
  let activeAudio = null;
  let activeObjectUrls = [];
  let activePlaybackKey = null;
  let playbackEpoch = 0;
  let pendingReplayKey = null;
  let settleStoppedPlayback = null;
  let lastGameSegmentKey = "";
  let primedPlaybackAudio = null;
  let playbackAudioContext = null;
  let silentAudioUrl = null;
  let nativeTtsCapture = null;
  let nativeTtsCaptureUntil = 0;
  let lastMode = "unknown";
  let lastChatSignature = "";
  let disposed = false;
  const cleanupFns = [];
  const knownReadyKeys = new Set();
  const missingKeys = new Set();
  const pendingKeyChecks = new Set();
  const generationInFlight = new Set();
  const ttsTransportInFlight = new Map();
  const originalMessageTextByKey = new Map();
  const originalMessageMetaByKey = new Map();
  const seenConversationMessageKeys = new Set();
  const trackedChatAudio = new Set();
  const originalFetch = window.fetch.bind(window);
  const originalMediaPlay = HTMLMediaElement.prototype.play;
  let toastId = 0;
  let scanScheduled = false;
  let ttsBackoffUntil = 0;
  let ttsBackoffMessage = "";
  let lastTtsBackoffNoticeAt = 0;
  let personaAutoSuppressedUntil = Date.now() + 4000;
  let personaAutoChatSignature = "";

  function addCleanup(fn) {
    cleanupFns.push(fn);
  }

  function cleanupExtensionDom() {
    document
      .querySelectorAll(
        [
          `.${EXT}-generate`,
          `.${EXT}-header-replay`,
          `.${EXT}-inline-replay-slot`,
          `.${EXT}-toast-region`,
          `.${EXT}-game-controls`,
        ].join(","),
      )
      .forEach((el) => el.remove());
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  function stopPropagation(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function stopButtonPointer(event) {
    event.stopPropagation();
    if (!activePlaybackKey && !pendingReplayKey) primePlaybackOnGesture();
  }

  function showToast(message, type = "error") {
    const text = String(message || "TTS request failed").trim();
    if (!text) return;

    let region = document.querySelector(`.${EXT}-toast-region`);
    if (!region) {
      region = document.createElement("div");
      region.className = `${EXT}-toast-region`;
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }

    const toast = document.createElement("div");
    toast.className = `${EXT}-toast ${EXT}-toast-${type}`;
    toast.dataset.toastId = String(++toastId);
    toast.innerHTML = `<span class="${EXT}-toast-dot" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`;
    region.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add(`${EXT}-toast-out`);
      window.setTimeout(() => toast.remove(), 220);
    }, 6200);
  }

  function showTtsError(message, err) {
    const detail = err instanceof Error ? err.message : String(err || "");
    showToast([message, detail].filter(Boolean).join(": "), "error");
  }

  function playbackError(err) {
    if (err instanceof Error) return err;
    return new Error("Browser blocked audio playback");
  }

  function getSilentAudioUrl() {
    if (silentAudioUrl) return silentAudioUrl;
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
      0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
      0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    silentAudioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    return silentAudioUrl;
  }

  function primePlaybackOnGesture() {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioContextCtor) {
        playbackAudioContext ||= new AudioContextCtor();
        void playbackAudioContext.resume?.();
      }
    } catch {
      // Audio unlock is opportunistic.
    }

    try {
      const audio = primedPlaybackAudio || new Audio();
      primedPlaybackAudio = audio;
      audio.muted = true;
      audio.preload = "auto";
      audio.src = getSilentAudioUrl();
      const started = audio.play();
      if (started?.then) {
        started
          .then(() => {
            if (primedPlaybackAudio !== audio) return;
            audio.pause();
            try {
              audio.currentTime = 0;
            } catch {
              // Ignore browsers that reject seeking this tiny primer clip.
            }
            audio.muted = false;
          })
          .catch(() => {
            if (primedPlaybackAudio === audio) audio.muted = false;
          });
      }
    } catch {
      // Some browsers reject even silent primers; normal playback still gets attempted.
    }
  }

  function takePlaybackAudio(url) {
    const audio = primedPlaybackAudio || new Audio();
    primedPlaybackAudio = null;
    try {
      audio.pause();
    } catch {
      // Ignore detached media state.
    }
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    audio.muted = false;
    audio.preload = "auto";
    audio.src = url;
    return audio;
  }

  addCleanup(() => {
    if (primedPlaybackAudio) {
      try {
        primedPlaybackAudio.pause();
        primedPlaybackAudio.removeAttribute("src");
      } catch {
        // Best-effort cleanup only.
      }
      primedPlaybackAudio = null;
    }
    if (silentAudioUrl) {
      URL.revokeObjectURL(silentAudioUrl);
      silentAudioUrl = null;
    }
    void playbackAudioContext?.close?.();
    playbackAudioContext = null;
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function readErrorResponse(res, fallback) {
    const raw = await res
      .clone()
      .text()
      .catch(() => "");
    if (!raw.trim()) return fallback;
    try {
      const payload = JSON.parse(raw);
      return [payload.error || payload.message || fallback, payload.detail].filter(Boolean).join(": ");
    } catch {
      return `${fallback}: ${raw.slice(0, 500)}`;
    }
  }

  function getTtsRetryAfterMs(res) {
    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
    }

    const resetAt = Number(res.headers.get("RateLimit-Reset"));
    if (Number.isFinite(resetAt) && resetAt > 0) {
      return Math.max(0, resetAt * 1000 - Date.now());
    }

    return 15000;
  }

  function rememberTtsBackoff(res, message) {
    const remainingHeader = res.headers.get("RateLimit-Remaining");
    const remaining = remainingHeader?.trim() ? Number(remainingHeader) : NaN;
    const shouldBackOff = res.status === 429 || (Number.isFinite(remaining) && remaining <= 0);
    if (!shouldBackOff) return;
    const retryAfterMs = Math.max(1000, Math.min(getTtsRetryAfterMs(res), 120000));
    ttsBackoffUntil = Math.max(ttsBackoffUntil, Date.now() + retryAfterMs);
    ttsBackoffMessage =
      message ||
      (res.status === 429
        ? "Too many TTS requests. Please wait before trying again."
        : "TTS request limit reached. Please wait before trying again.");
  }

  function getActiveTtsBackoffMessage() {
    if (Date.now() >= ttsBackoffUntil) return "";
    const remainingSeconds = Math.max(1, Math.ceil((ttsBackoffUntil - Date.now()) / 1000));
    return `${ttsBackoffMessage || "Too many TTS requests."} Try again in ${remainingSeconds}s.`;
  }

  function notifyTtsBackoff(message) {
    const now = Date.now();
    if (now - lastTtsBackoffNoticeAt < 5000) return;
    lastTtsBackoffNoticeAt = now;
    console.warn("[Unified TTS] Suppressed TTS request during browser-side rate-limit backoff:", message);
    showToast(message, "warning");
  }

  function ttsBackoffResponse(message) {
    return new Response(JSON.stringify({ error: message }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-Marinara-Extension-TTS-Suppressed": "1",
      },
    });
  }

  async function fetchWithTimeout(input, init, timeoutMs = TTS_REQUEST_TIMEOUT_MS) {
    if (isTtsSpeakRequest(input, init)) {
      const backoffMessage = getActiveTtsBackoffMessage();
      if (backoffMessage) {
        notifyTtsBackoff(backoffMessage);
        return ttsBackoffResponse(backoffMessage);
      }
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init?.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const fetchImpl = isTtsSpeakRequest(input, init) ? window.fetch : originalFetch;
      const headers = new Headers(init?.headers);
      const secret = localStorage.getItem("marinara_admin_secret");
      if (secret) headers.set("X-Admin-Secret", secret);
      const response = await fetchImpl(input, { ...init, headers, signal: controller.signal });
      if (isTtsSpeakRequest(input, init)) {
        if (response.ok) {
          rememberTtsBackoff(response);
        } else {
          void readErrorResponse(response, `TTS request failed (${response.status})`).then((message) => {
            rememberTtsBackoff(response, message);
          });
        }
      }
      return response;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("TTS request timed out or was cancelled");
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  function asUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new URL(raw, window.location.origin);
    } catch {
      return null;
    }
  }

  function isTtsSpeakRequest(input, init) {
    const url = asUrl(input);
    if (!url || url.origin !== window.location.origin || url.pathname !== "/api/tts/speak") return false;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    return method === "POST";
  }

  function isChatMessagesListRequest(input, init) {
    const url = asUrl(input);
    if (!url || url.origin !== window.location.origin) return false;
    if (!/^\/api\/chats\/[^/]+\/messages$/.test(url.pathname)) return false;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    return method === "GET";
  }

  function rememberOriginalMessages(response) {
    void response
      .clone()
      .json()
      .then((messages) => {
        if (!Array.isArray(messages)) return;
        for (const message of messages) {
          if (!message || typeof message.id !== "string" || typeof message.content !== "string") continue;
          const key = `message:${message.id}`;
          let extra = message.extra;
          if (typeof extra === "string") {
            try {
              extra = JSON.parse(extra);
            } catch {
              extra = null;
            }
          }
          originalMessageTextByKey.set(key, message.content);
          originalMessageMetaByKey.set(key, {
            role: typeof message.role === "string" ? message.role : "",
            characterId: typeof message.characterId === "string" ? message.characterId : "",
            personaSnapshot: extra?.personaSnapshot && typeof extra.personaSnapshot === "object" ? extra.personaSnapshot : null,
            createdAt: typeof message.createdAt === "string" ? message.createdAt : "",
          });
        }
      })
      .catch(() => {});
  }

  async function readTtsRequestPayload(input, init) {
    if (!isTtsSpeakRequest(input, init)) return null;
    try {
      const body = init?.body;
      if (typeof body === "string") return JSON.parse(body);
      if (body instanceof Blob) return JSON.parse(await body.text());
      if (input instanceof Request) return await input.clone().json();
    } catch {
      return null;
    }
    return null;
  }

  function hashString(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function isProviderSafetyError(message) {
    return /usage guidelines|vertex ai|safety filter|responsible ai|blocked by.*safety|could not generate audio/i.test(
      String(message || ""),
    );
  }

  function getGameTtsBlockedRequests() {
    try {
      const raw = localStorage.getItem(GAME_TTS_BLOCKED_REQUESTS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function setGameTtsBlockedRequests(records) {
    try {
      localStorage.setItem(GAME_TTS_BLOCKED_REQUESTS_KEY, JSON.stringify(records));
    } catch {
      // Best-effort duplicate suppression only.
    }
  }

  function getGameTtsBlockedRequestKey(payload) {
    const text = cleanText(typeof payload?.text === "string" ? payload.text : "");
    if (!text) return "";
    const speaker = normalizeName(typeof payload?.speaker === "string" ? payload.speaker : "");
    const tone = normalizeName(typeof payload?.tone === "string" ? payload.tone : "");
    const voice = typeof payload?.voice === "string" ? payload.voice.trim() : "";
    return hashString([text, speaker, tone, voice].join("\n"));
  }

  function pruneGameTtsBlockedRequests(records) {
    const now = Date.now();
    let changed = false;
    for (const [key, record] of Object.entries(records)) {
      const createdAt = Number(record?.createdAt || 0);
      if (!createdAt || now - createdAt > GAME_TTS_BLOCK_TTL_MS) {
        delete records[key];
        changed = true;
      }
    }

    const entries = Object.entries(records);
    if (entries.length > 120) {
      entries
        .sort((left, right) => Number(left[1]?.createdAt || 0) - Number(right[1]?.createdAt || 0))
        .slice(0, entries.length - 120)
        .forEach(([key]) => {
          delete records[key];
          changed = true;
        });
    }

    if (changed) setGameTtsBlockedRequests(records);
    return records;
  }

  function getKnownBlockedGameTtsMessage(payload) {
    if (getMode() !== "game") return "";
    const key = getGameTtsBlockedRequestKey(payload);
    if (!key) return "";
    const records = pruneGameTtsBlockedRequests(getGameTtsBlockedRequests());
    const message = records[key]?.message;
    return typeof message === "string" && message.trim() ? message : "";
  }

  function rememberBlockedGameTtsRequest(payload, message) {
    if (getMode() !== "game" || !isProviderSafetyError(message)) return;
    const key = getGameTtsBlockedRequestKey(payload);
    if (!key) return;
    const records = pruneGameTtsBlockedRequests(getGameTtsBlockedRequests());
    records[key] = {
      createdAt: Date.now(),
      message: String(message || GAME_TTS_BLOCK_FALLBACK_MESSAGE).slice(0, 500),
    };
    setGameTtsBlockedRequests(records);
  }

  function blockedGameTtsResponse(message) {
    return new Response(JSON.stringify({ error: message || GAME_TTS_BLOCK_FALLBACK_MESSAGE }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "X-Marinara-Extension-TTS-Blocked": "1",
      },
    });
  }

  function uniq(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function openDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  function openNativeTtsDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (nativeDbPromise) return nativeDbPromise;
    nativeDbPromise = new Promise((resolve) => {
      const request = indexedDB.open("marinara-tts-audio-cache");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return nativeDbPromise;
  }

  async function getNativeMessageBlobs(messageId) {
    const db = await openNativeTtsDb();
    if (!db || !db.objectStoreNames.contains("voiceLines")) return [];
    try {
      const tx = db.transaction("voiceLines", "readonly");
      const records = await requestToPromise(tx.objectStore("voiceLines").getAll());
      const prefix = `chat-voice-line-v2:${messageId}:`;
      return records
        .filter((record) => typeof record?.key === "string" && record.key.startsWith(prefix) && record.blob instanceof Blob)
        .sort((left, right) => {
          const leftIndex = Number(left.key.slice(prefix.length).split(":", 1)[0]);
          const rightIndex = Number(right.key.slice(prefix.length).split(":", 1)[0]);
          return leftIndex - rightIndex;
        })
        .map((record) => record.blob);
    } catch {
      return [];
    }
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the legacy path.
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function getClip(key) {
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(STORE, "readonly");
      return (await requestToPromise(tx.objectStore(STORE).get(key))) ?? null;
    } catch {
      return null;
    }
  }

  async function putClip(record) {
    const db = await openDb();
    if (!db) return false;
    const next = { ...record, ...(record.kind === 'game-segment' ? { gameRoute: record.gameRoute || location.pathname } : {}), updatedAt: Date.now() };
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(next);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      });
      if (['game-segment', 'game-request'].includes(next.kind) && next.gameRoute) {
        gameArchiveMetadata.set(next.key, { key: next.key, gameRoute: next.gameRoute,
          sourceText: next.sourceText, speaker: next.speaker, updatedAt: next.updatedAt });
      }
      knownReadyKeys.add(record.key);
      missingKeys.delete(record.key);
      return true;
    } catch {
      // Runtime playback still works even when persistence is unavailable.
      return false;
    }
  }

  async function hasClip(key) {
    if (knownReadyKeys.has(key)) return true;
    if (missingKeys.has(key)) return false;
    const record = await getClip(key);
    if (record?.blobs?.length) {
      knownReadyKeys.add(key);
      return true;
    }
    missingKeys.add(key);
    return false;
  }

  async function hasSavedVoice(key, messageId) {
    if (await hasClip(key)) return true;
    return (await getNativeMessageBlobs(messageId)).length > 0;
  }

  async function playSavedVoice(key, messageId) {
    const clip = await getClip(key);
    if (clip?.blobs?.length) return playBlobs(clip.blobs, key);
    const nativeBlobs = await getNativeMessageBlobs(messageId);
    if (!nativeBlobs.length) throw new Error("저장된 음성을 찾지 못했습니다.");
    return playBlobs(nativeBlobs, key);
  }

  function cleanText(value) {
    return (value || "")
      .replace(/\{(?:shake|shout|whisper|glow|pulse|wave|flicker|drip|bounce|tremble|glitch|expand):([^}]+)\}/gi, "$1")
      .replace(/\[[a-z_]+:[^\]]*\]/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\bnumber\s+\d+\b/gi, " ")
      .replace(/\bmessage\s+(?:number\s+)?\d+\b/gi, " ")
      .replace(/(^|\s)#\d+\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanExtractedText(value) {
    return (value || "")
      .replace(/\{(?:shake|shout|whisper|glow|pulse|wave|flicker|drip|bounce|tremble|glitch|expand):([^}]+)\}/gi, "$1")
      .replace(/\[[a-z_]+:[^\]]*\]/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\bnumber\s+\d+\b/gi, " ")
      .replace(/\bmessage\s+(?:number\s+)?\d+\b/gi, " ")
      .replace(/(^|[\s\n])#\d+\b/g, "$1")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function ttsByteLength(value) {
    return new TextEncoder().encode(value).length;
  }

  function fitsTtsRequestLimit(value) {
    return value.length <= MAX_CHARS_PER_TTS_REQUEST && ttsByteLength(value) <= MAX_BYTES_PER_TTS_REQUEST;
  }

  function splitOversizedText(value) {
    const chunks = [];
    let current = "";
    for (const char of value.match(/\[[^\]\r\n]{1,80}\]|[\s\S]/gu) || []) {
      const next = current + char;
      if (!fitsTtsRequestLimit(next)) {
        if (current) chunks.push(current.trim());
        current = char;
      } else {
        current = next;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function stripDialogueQuotes(value) {
    return value.replace(/^["']+|["']+$/g, "").trim();
  }

  function extractDialogueOnly(text) {
    const chunks = [];
    const speakerTagRe = /<speaker="[^"]*">([\s\S]*?)<\/speaker>/gi;
    let match = null;
    while ((match = speakerTagRe.exec(text))) {
      const cleaned = cleanText(match[1] ?? "");
      if (cleaned) chunks.push(cleaned);
    }

    const vnLineRe = /^\s*(?:Dialogue\s*)?\[[^\]]+\]\s*(?:\[[^\]]+\])?\s*(?:\[[^\]]+\])?\s*:\s*(.+)$/i;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      const lineMatch = line.match(vnLineRe);
      if (!lineMatch) continue;
      const cleaned = cleanText(stripDialogueQuotes(lineMatch[1] ?? ""));
      if (cleaned) chunks.push(cleaned);
    }

    if (chunks.length) return uniq(chunks).join("\n");

    const quoteRe = /"([^"]{1,1000})"|'([^']{1,1000})'/g;
    while ((match = quoteRe.exec(text))) {
      const cleaned = cleanText(match.slice(1).find(Boolean) ?? "");
      if (cleaned) chunks.push(cleaned);
    }
    return uniq(chunks).join("\n");
  }

  function splitText(text, exact = false) {
    const cleaned = exact ? String(text || '').trim() : cleanText(text);
    if (fitsTtsRequestLimit(cleaned)) return cleaned ? [cleaned] : [];
    const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
    const chunks = [];
    let current = "";
    for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
      const next = current ? `${current} ${part}` : part;
      if (fitsTtsRequestLimit(next)) {
        current = next;
        continue;
      }
      if (current) chunks.push(current);
      if (fitsTtsRequestLimit(part)) {
        current = part;
      } else {
        chunks.push(...splitOversizedText(part));
        current = "";
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  async function getTtsConfig() {
    if (Date.now() < ttsConfigRetryAt) {
      throw new Error(`TTS 설정 조회 요청 제한 · ${Math.ceil((ttsConfigRetryAt - Date.now()) / 1000)}초 후 다시 시도하세요.`);
    }
    if (ttsConfigInFlight) return ttsConfigInFlight;
    const request = (async () => {
      const headers = {};
      const secret = localStorage.getItem("marinara_admin_secret");
      if (secret) headers["X-Admin-Secret"] = secret;
      const res = await fetchWithTimeout("/api/tts/config", { cache: "no-store", headers }, 20000);
      if (!res.ok) {
        if (res.status === 429) {
          const retry = res.headers.get("retry-after");
          const seconds = Number(retry);
          const until = retry && !Number.isFinite(seconds) ? Date.parse(retry) : Date.now() + (retry && Number.isFinite(seconds) ? Math.max(1, seconds) : 10) * 1000;
          ttsConfigRetryAt = Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 10000;
          throw new Error(`TTS 설정 조회 요청 제한 (HTTP 429) · ${Math.ceil((ttsConfigRetryAt - Date.now()) / 1000)}초 후 다시 시도하세요.`);
        }
        throw new Error(`TTS 설정 조회 실패 (HTTP ${res.status}) · 음성 요청을 중단했습니다.`);
      }
      const config = await res.json();
      if (!config || typeof config.enabled !== "boolean") throw new Error("TTS 설정 응답이 올바르지 않아 음성 요청을 중단했습니다.");
      return config;
    })();
    ttsConfigInFlight = request;
    try { return await request; }
    finally { if (ttsConfigInFlight === request) ttsConfigInFlight = null; }
  }

  function normalizeName(value) {
    return (value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function resolveVoice(config, speaker) {
    const fallback = config?.voice || "";
    if (config?.voiceMode !== "per-character") return fallback;
    const normalizedSpeaker = normalizeName(speaker);
    const assignments = Array.isArray(config.voiceAssignments) ? config.voiceAssignments : [];
    const assignment = assignments.find((entry) => entry?.voice && normalizeName(entry.characterName) === normalizedSpeaker);
    return assignment?.voice || fallback;
  }

  function loadExtensionSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXTENSION_SETTINGS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function personaIdentityForMessage(messageEl) {
    if ((messageEl.dataset.messageRole || "") !== "user") return null;
    const meta = originalMessageMetaByKey.get(getMessageKey(messageEl));
    const snapshot = meta?.personaSnapshot;
    return {
      id: typeof snapshot?.personaId === "string" ? snapshot.personaId : "",
      name: typeof snapshot?.name === "string" && snapshot.name.trim() ? snapshot.name.trim() : getSpeaker(messageEl),
    };
  }

  function resolvePersonaVoice(messageEl) {
    const identity = personaIdentityForMessage(messageEl);
    if (!identity) return "";
    const assignments = loadExtensionSettings().personaVoiceAssignments;
    if (!Array.isArray(assignments)) return "";
    const normalizedName = normalizeName(identity.name);
    const assignment = assignments.find(
      (entry) =>
        entry &&
        typeof entry.voice === "string" &&
        entry.voice.trim() &&
        ((identity.id && entry.personaId === identity.id) ||
          (!identity.id && normalizedName && normalizeName(entry.personaName) === normalizedName)),
    );
    return assignment?.voice?.trim() || "";
  }

  async function requestTtsBlob(text, speaker, voiceOverride, isCurrent, exact = false) {
    const config = await getTtsConfig();
    if (config?.enabled !== true) throw new Error("TTS is not enabled");
    if (isCurrent && !isCurrent()) throw new Error("Game segment changed");
    const voice = voiceOverride || (!speaker && getMode() === "game" && config.narratorVoiceEnabled && config.narratorVoice) || resolveVoice(config, speaker);
    const body = {
      text: exact ? text : config.dialogueOnly ? extractDialogueOnly(text) || cleanText(text) : cleanText(text),
      ...(speaker ? { speaker } : {}),
      ...(voice ? { voice } : {}),
    };
    if (!body.text) throw new Error("No speakable text found");

    const res = await fetchWithTimeout("/api/tts/speak", {
      [VERIFIED_TTS_CONFIG]: true,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
        ...(exact ? { 'X-Marinara-TTS-Line': '1' } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const message = await readErrorResponse(res, `TTS request failed (${res.status})`);
      throw new Error(message);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error("TTS response did not include audio");
    return blob;
  }

  async function generateClip(key, text, options = {}) {
    const chunks = splitText(text, options.exact);
    if (!chunks.length) throw new Error("No speakable text found");
    const blobs = [];
    for (const chunk of chunks) {
      if (options.isCurrent && !options.isCurrent()) throw new Error("Game segment changed");
      blobs.push(await requestTtsBlob(chunk, options.speaker, options.voice, options.isCurrent, options.exact));
    }
    const persisted = await putClip({
      key,
      kind: options.kind || "message",
      sourceTextHash: hashString(cleanText(text)),
      speaker: options.speaker || "",
      sourceText: text,
      blobs,
    });
    return { key, blobs, persisted };
  }

  function updateReplayButtons() {
    for (const button of document.querySelectorAll(`[data-mari-tts-replay-key]`)) {
      const playing = button.dataset.mariTtsReplayKey === (activePlaybackKey || pendingReplayKey);
      const title = playing ? "Stop playback" : (button.dataset.replayTitle || "Replay saved voice");
      if (button.title !== title) {
        button.title = title;
        button.setAttribute("aria-label", title);
        button.innerHTML = playing ? icons.stop : icons.volume;
      }
      button.setAttribute("aria-pressed", String(playing));
    }
  }

  function stopAudio() {
    playbackEpoch += 1;
    pendingReplayKey = null;
    const settle = settleStoppedPlayback;
    settleStoppedPlayback = null;
    if (activeAudio) {
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio.onplaying = null;
      activeAudio.pause();
      activeAudio = null;
    }
    for (const url of activeObjectUrls) URL.revokeObjectURL(url);
    activeObjectUrls = [];
    activePlaybackKey = null;
    settle?.(false);
    updateReplayButtons();
  }

  function pauseOtherTtsAudio(except) {
    for (const audio of Array.from(trackedChatAudio)) {
      if (audio === except) continue;
      audio.pause();
      trackedChatAudio.delete(audio);
    }
  }

  async function toggleSavedVoice(key, messageId = "") {
    if (activePlaybackKey === key || pendingReplayKey === key) {
      stopAudio();
      pauseOtherTtsAudio();
      return false;
    }
    stopAudio();
    pauseOtherTtsAudio();
    pendingReplayKey = key;
    const epoch = playbackEpoch;
    updateReplayButtons();
    try {
      const record = await getClip(key);
      const blobs = record?.blobs?.length ? record.blobs : await getNativeMessageBlobs(messageId);
      if (disposed || epoch !== playbackEpoch || pendingReplayKey !== key) return false;
      if (!blobs.length) throw new Error("저장된 음성을 찾지 못했습니다.");
      return playBlobs(blobs, key);
    } finally {
      if (epoch === playbackEpoch && pendingReplayKey === key) {
        pendingReplayKey = null;
        updateReplayButtons();
      }
    }
  }

  function stopTrackedChatAudio() {
    stopAudio();
    for (const audio of Array.from(trackedChatAudio)) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // Best-effort stop for vanilla TTS audio.
      }
      trackedChatAudio.delete(audio);
    }
    for (const button of document.querySelectorAll("button")) {
      const label = `${button.getAttribute("title") || ""} ${button.getAttribute("aria-label") || ""}`.trim();
      if (!/Stop speaking/i.test(label)) continue;
      try {
        button.click();
      } catch {
        // Ignore detached controls.
      }
    }
  }

  async function playClip(key) {
    const record = await getClip(key);
    if (!record?.blobs?.length) return false;
    return playBlobs(record.blobs, key);
  }

  function playBlobs(blobs, key = "") {
    if (!blobs?.length) return Promise.resolve(false);
    stopAudio();
    pauseOtherTtsAudio();
    const epoch = playbackEpoch;
    activePlaybackKey = key;
    updateReplayButtons();
    activeObjectUrls = blobs.map((blob) => URL.createObjectURL(blob));
    let index = 0;
    return new Promise((resolve, reject) => {
      let settled = false;
      settleStoppedPlayback = (value) => { if (!settled) { settled = true; resolve(value); } };
      const started = () => {
        if (settled) return;
        settled = true;
        resolve(true);
      };
      const failed = (err) => {
        const error = playbackError(err);
        const isCurrentPlayback = epoch === playbackEpoch && activePlaybackKey === key;
        if (!isCurrentPlayback) {
          if (!settled) {
            settled = true;
            resolve(false);
          }
          return;
        }
        stopAudio();
        if (!settled) {
          settled = true;
          reject(error);
        } else if (isCurrentPlayback) {
          showTtsError("TTS playback failed", error);
        }
      };
      const playNext = () => {
        if (epoch !== playbackEpoch || activePlaybackKey !== key) return;
        const url = activeObjectUrls[index];
        if (!url) {
          if (!settled) { settled = true; resolve(true); }
          stopAudio();
          return;
        }
        const audio = takePlaybackAudio(url);
        audio.dataset.mariExtTts = "true";
        activeAudio = audio;
        audio.onplaying = started;
        audio.onended = () => {
          if (epoch !== playbackEpoch) return;
          index += 1;
          playNext();
        };
        audio.onerror = () => failed(new Error("Audio playback failed"));
        try {
          const playPromise = audio.play();
          if (playPromise?.then) {
            void playPromise.then(started).catch(failed);
          } else {
            window.setTimeout(started, 0);
          }
        } catch (err) {
          failed(err);
        }
      };
      playNext();
    });
  }

  async function playGeneratedClip(clip) {
    if (clip.blobs?.length) return playBlobs(clip.blobs, clip.key);
    if (clip.persisted) return playClip(clip.key);
    return false;
  }

  function createButton(className, title, icon, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = icon;
    button.addEventListener("pointerdown", stopButtonPointer, true);
    button.addEventListener("pointerup", stopButtonPointer, true);
    button.addEventListener("touchstart", stopButtonPointer, true);
    button.addEventListener("click", (event) => {
      stopPropagation(event);
      if (!activePlaybackKey && !pendingReplayKey) primePlaybackOnGesture();
      void Promise.resolve(onClick(button, event)).catch((err) => {
        console.warn("[Unified TTS] Button action failed:", err);
        showTtsError("TTS action failed", err);
      });
    });
    return button;
  }

  function setButtonState(button, state, title) {
    if (button.dataset.state === state && button.title === title) return;
    button.dataset.state = state;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.toggleAttribute("aria-busy", state === "loading");
    if (state === "loading") button.innerHTML = icons.loader;
    else if (state === "ready") button.innerHTML = icons.refresh;
    else button.innerHTML = icons.volume;
  }

  function getMode() {
    if (document.querySelector('[data-component="ChatArea.Roleplay"]')) return "roleplay";
    if (document.querySelector('[data-component="ChatArea.Conversation"]')) return "conversation";
    if (document.querySelector('[data-tour="game-dialogue"]')) return "game";
    return "unknown";
  }

  function getMessageKey(messageEl) {
    return `message:${getCanonicalMessageId(messageEl)}`;
  }

  function getMessageId(messageEl) {
    return messageEl.dataset.messageId || "";
  }

  function getCanonicalMessageId(messageEl) {
    return getMessageId(messageEl).replace(/__(?:block|line)\d+$/, "");
  }

  function byDocumentOrder(a, b) {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  }

  function escapeAttributeValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getMessageElements(messageEl) {
    const rawId = getMessageId(messageEl);
    const id = getCanonicalMessageId(messageEl);
    if (!id) return [messageEl];

    const exact = escapeAttributeValue(id);
    const raw = escapeAttributeValue(rawId);
    const scope =
      messageEl.closest(".mari-messages-scroll") ||
      messageEl.closest('[data-component="ChatArea.Conversation"], [data-component="ChatArea.Roleplay"]') ||
      messageEl.closest("main") ||
      document;
    const selector = [
      `[data-message-id="${exact}"][data-message-role]`,
      `[data-message-id="${raw}"][data-message-role]`,
      `[data-message-id^="${exact}__block"][data-message-role]`,
      `[data-message-id^="${exact}__line"][data-message-role]`,
    ].join(",");

    const matches = Array.from(scope.querySelectorAll(selector)).filter(
      (el) => el instanceof HTMLElement && isVisible(el),
    );
    const unique = uniq(matches);
    return (unique.length ? unique : [messageEl]).sort(byDocumentOrder);
  }

  function getMessageElementByKey(key) {
    const id = key.replace(/^message:/, "");
    if (!id) return null;
    const escaped = escapeAttributeValue(id);
    return document.querySelector(`[data-message-id="${escaped}"][data-message-role]`);
  }

  function findEventMessageElement(event, button) {
    const direct = button.closest("[data-message-id][data-message-role]");
    if (direct instanceof HTMLElement) return direct;

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const candidate = node.matches("[data-message-id][data-message-role]")
        ? node
        : node.closest("[data-message-id][data-message-role]");
      if (candidate instanceof HTMLElement) return candidate;
    }
    return null;
  }

  function getSpeaker(messageEl) {
    return (
      messageEl.querySelector(".mari-message-name")?.textContent?.trim() ||
      messageEl.querySelector("[class*='rpg-char-name']")?.textContent?.trim() ||
      ""
    );
  }

  function scoreTextMatch(messageText, spokenText) {
    const message = cleanText(messageText);
    const spoken = cleanText(spokenText);
    if (!message || !spoken) return 0;
    if (message === spoken) return 12000;
    if (message.includes(spoken)) return 7000 + Math.min(spoken.length, 2500);
    if (spoken.includes(message)) return 5000 + Math.min(message.length, 2000);

    const messageDialogue = cleanText(extractDialogueOnly(message) || message);
    const spokenDialogue = cleanText(extractDialogueOnly(spoken) || spoken);
    if (messageDialogue && spokenDialogue) {
      if (messageDialogue === spokenDialogue) return 11000;
      if (messageDialogue.includes(spokenDialogue)) return 6500 + Math.min(spokenDialogue.length, 2200);
      if (spokenDialogue.includes(messageDialogue)) return 4500 + Math.min(messageDialogue.length, 1800);
    }

    const shorter = message.length < spoken.length ? message : spoken;
    const longer = message.length < spoken.length ? spoken : message;
    if (shorter.length >= 24 && longer.includes(shorter.slice(0, Math.min(shorter.length, 160)))) {
      return 2200 + Math.min(shorter.length, 900);
    }
    return 0;
  }

  function findMessageForTtsPayload(payload) {
    const spoken = cleanText(typeof payload?.text === "string" ? payload.text : "");
    if (!spoken) return null;
    const requestedSpeaker = normalizeName(typeof payload?.speaker === "string" ? payload.speaker : "");
    let best = null;
    let bestScore = 0;
    const mode = getMode();
    const messages = Array.from(document.querySelectorAll("[data-message-id][data-message-role]")).filter(
      (el) => el instanceof HTMLElement && isVisible(el),
    );

    for (const [index, messageEl] of messages.entries()) {
      const role = messageEl.dataset.messageRole || "";
      if (role === "system") continue;
      const messageText = cleanText(extractMessageText(messageEl));
      if (!messageText) continue;

      let score = scoreTextMatch(messageText, spoken);
      if (!score) continue;

      const speaker = normalizeName(getSpeaker(messageEl));
      if (requestedSpeaker && speaker && requestedSpeaker === speaker) score += 500;
      if (mode === "conversation" && role === "assistant") score += 120;
      if (mode === "roleplay" && role === "assistant") score += 80;
      score += index;
      if (score > bestScore) {
        bestScore = score;
        best = messageEl;
      }
    }

    if (!best) return null;
    return {
      key: getMessageKey(best),
      messageEl: best,
      speaker: getSpeaker(best) || (typeof payload?.speaker === "string" ? payload.speaker : ""),
      sourceTextHash: hashString(spoken),
    };
  }

  function isTranslationBlock(el) {
    if (!(el instanceof HTMLElement)) return false;
    const className = el.getAttribute("class") || "";
    if (!className.includes("border-t") || !className.includes("pt-")) return false;
    const previous = el.previousElementSibling;
    return previous?.classList?.contains("mari-message-content") || !!el.querySelector(".whitespace-pre-wrap");
  }

  function pruneMessageClone(clone) {
    Array.from(clone.querySelectorAll("*")).forEach((el) => {
      if (isTranslationBlock(el)) el.remove();
    });
    clone.querySelectorAll(
      [
        `.${EXT}-header-replay`,
        `.${EXT}-inline-replay-slot`,
        `.${EXT}-generate`,
        ".mari-message-actions",
        ".mari-message-meta",
        ".mari-message-name",
        ".mari-message-timestamp",
        ".mari-message-typing",
        ".mari-message-avatar",
        ".mari-tts-line-controls",
        ".mari-tts-cue",
        "[data-mari-tts-source-view]",
        "[data-mari-ext-tts-hidden-translation='true']",
        "[data-roleplay-inline-preview]",
        "[role='checkbox']",
        ".select-none",
        "button",
        "svg",
        "img",
        "input",
        "textarea",
        "select",
      ].join(","),
    ).forEach((el) => el.remove());
  }

  function extractTextFromNode(node) {
    const clone = node.cloneNode(true);
    pruneMessageClone(clone);
    return cleanExtractedText(clone.textContent || "");
  }

  function extractSingleMessageText(messageEl) {
    const contentNodes = Array.from(messageEl.querySelectorAll(".mari-message-content")).filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest("[data-mari-ext-tts-hidden-translation='true']")) return false;
      if (isTranslationBlock(node)) return false;
      return isVisible(node);
    });
    const chunks = contentNodes.map(extractTextFromNode).filter(Boolean);
    if (chunks.length) return chunks.join("\n");

    const body = messageEl.querySelector(".mari-message-body, .mari-message-bubble");
    return extractTextFromNode(body || messageEl);
  }

  function extractMessageText(messageEl) {
    const elements = getMessageElements(messageEl);
    const chunks = elements.map(extractSingleMessageText).filter(Boolean);
    if (chunks.length) return uniq(chunks).join("\n");

    return extractSingleMessageText(messageEl);
  }

  function getTranslationBlock(messageEl) {
    const content = messageEl.querySelector(".mari-message-content");
    let sibling = content?.nextElementSibling;
    while(sibling?.hasAttribute('data-mari-tts-copy'))sibling=sibling.nextElementSibling;
    if (!(sibling instanceof HTMLElement)) return null;
    if (sibling.classList.contains("mari-message-actions")) return null;
    if (sibling.matches("button, input, textarea, select")) return null;
    const className = sibling.getAttribute("class") || "";
    if (!className.includes("border-t") || !className.includes("pt-")) return null;
    return sibling;
  }

  function markTranslationBlocks() {
    for (const messageEl of document.querySelectorAll("[data-message-id][data-message-role]")) {
      if (!(messageEl instanceof HTMLElement)) continue;
      const block = getTranslationBlock(messageEl);
      if (block) block.setAttribute("data-mari-ext-tts-hidden-translation", "true");
    }
  }

  function findHeaderTarget(messageEl) {
    const explicitMeta = messageEl.querySelector(".mari-message-meta");
    if (explicitMeta) return explicitMeta;
    const name = messageEl.querySelector(".mari-message-name");
    if (name?.parentElement) return name.parentElement;
    const bubble = messageEl.querySelector(".mari-message-bubble");
    return bubble instanceof HTMLElement ? bubble : null;
  }

  async function ensureHeaderReplay(messageEl) {
    if(getMode()==='roleplay'){
      messageEl.querySelectorAll(`.${EXT}-header-replay,.${EXT}-inline-replay-slot`).forEach(e=>e.remove());
      return;
    }
    const key = getMessageKey(messageEl);
    if (key.endsWith(":")) return;
    const group = getMessageElements(messageEl);
    const firstMessageEl = group[0] || messageEl;
    if (firstMessageEl !== messageEl) {
      messageEl.querySelector(`.${EXT}-header-replay`)?.remove();
      messageEl.querySelector(`.${EXT}-inline-replay-slot`)?.remove();
      return;
    }
    const target = firstMessageEl.querySelector(".mari-message-actions") || findHeaderTarget(messageEl);
    if (!target) return;

    const existing = target.querySelector(`.${EXT}-header-replay`);
    const messageId = getCanonicalMessageId(messageEl);
    if (!(await hasSavedVoice(key, messageId))) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const button = createButton(
      `${EXT}-header-replay`,
      "Replay saved voice",
      icons.volume,
      async () => {
        await toggleSavedVoice(key, messageId);
      },
    );
    if (!target.classList.contains("mari-message-actions") && target.classList.contains("mari-message-bubble")) {
      button.classList.add(`${EXT}-header-replay-overlay`);
    }
    button.dataset.mariTtsReplayKey = key;
    target.appendChild(button);
    updateReplayButtons();
  }

  async function refreshMessageButtonState(messageEl, button) {
    const key = getMessageKey(messageEl);
    if (await hasSavedVoice(key, getCanonicalMessageId(messageEl))) setButtonState(button, "ready", "Regenerate voice");
    else setButtonState(button, "idle", "Generate voice");
  }

  function attachConversationGenerateButton(messageEl) {
    const actionBar = messageEl.querySelector(".mari-message-actions") || findHeaderTarget(messageEl);
    if (!actionBar || actionBar.querySelector(`.${EXT}-generate`)) return;

    const key = getMessageKey(messageEl);
    const button = createButton(
      `${EXT}-generate`,
      "Generate voice",
      icons.volume,
      async (btn) => {
        if (generationInFlight.has(key)) return;
        if (
          (await hasSavedVoice(key, getCanonicalMessageId(messageEl))) &&
          !window.confirm("이 메시지의 음성을 다시 생성할까요? ElevenLabs API 사용량이 발생합니다.")
        ) {
          return;
        }
        markTranslationBlocks();
        const existingClip = await getClip(key);
        const text = originalMessageText(messageEl) || existingClip?.sourceText || extractMessageText(messageEl);
        const speaker = getSpeaker(messageEl);
        const voice = resolvePersonaVoice(messageEl);
        if (!text) return;
        generationInFlight.add(key);
        setButtonState(btn, "loading", "Generating voice");
        try {
          const clip = await generateClip(key, text, { speaker, voice, kind: "message" });
          try {
            const played = await playGeneratedClip(clip);
            if (!played) showToast("Voice generated. Tap Replay to play it.", "warning");
          } catch (playErr) {
            console.warn("[Unified TTS] Generated voice playback failed:", playErr);
            showTtsError("Voice generated, but playback failed", playErr);
          }
          if (!clip.persisted) showToast("Voice generated, but it could not be saved for replay.", "warning");
          await ensureHeaderReplay(messageEl);
          setButtonState(btn, "ready", "Regenerate voice");
        } catch (err) {
          console.warn("[Unified TTS] Message generation failed:", err);
          showTtsError("TTS generation failed", err);
          setButtonState(btn, "idle", err instanceof Error ? err.message : "TTS generation failed");
          window.setTimeout(() => void refreshMessageButtonState(messageEl, btn), 1800);
        } finally {
          generationInFlight.delete(key);
        }
      },
    );

    if (!actionBar.classList.contains("mari-message-actions") && actionBar.classList.contains("mari-message-bubble")) {
      button.classList.add(`${EXT}-generate-overlay`);
    }

    const deleteButton = Array.from(actionBar.querySelectorAll("button")).find((el) => /delete/i.test(el.title || ""));
    if (deleteButton) actionBar.insertBefore(button, deleteButton);
    else actionBar.appendChild(button);
    void refreshMessageButtonState(messageEl, button);
  }

  function shouldAutogeneratePersona(messageEl) {
    if (getMode() !== "conversation" || (messageEl.dataset.messageRole || "") !== "user") return false;
    if (Date.now() < personaAutoSuppressedUntil) return false;
    const settings = loadExtensionSettings();
    if (settings.enabled === false || settings.autoplayScope !== "characters-and-persona") return false;
    return true;
  }

  async function autogeneratePersonaMessage(messageEl) {
    const key = getMessageKey(messageEl);
    if (!key || key.endsWith(":")) return;
    if (generationInFlight.has(key) || (await hasSavedVoice(key, getCanonicalMessageId(messageEl)))) return;

    const config = await getTtsConfig().catch(() => null);
    if (!config?.enabled || !config.autoplayConvo) return;

    markTranslationBlocks();
    const text = originalMessageText(messageEl) || extractMessageText(messageEl);
    if (!text) return;
    const speaker = getSpeaker(messageEl);
    const voice = resolvePersonaVoice(messageEl);
    generationInFlight.add(key);
    try {
      const clip = await generateClip(key, text, { speaker, voice, kind: "message" });
      await playGeneratedClip(clip);
      await ensureHeaderReplay(messageEl);
      const button = messageEl.querySelector(`.${EXT}-generate`);
      if (button instanceof HTMLButtonElement) setButtonState(button, "ready", "Regenerate voice");
    } catch (error) {
      console.warn("[Unified TTS] Persona autoplay failed:", error);
      showTtsError("Persona TTS generation failed", error);
    } finally {
      generationInFlight.delete(key);
    }
  }


  function scanMessages() {
    const mode = getMode();
    for (const messageEl of document.querySelectorAll("[data-message-id][data-message-role]")) {
      if (!(messageEl instanceof HTMLElement) || !isVisible(messageEl)) continue;
      const role = messageEl.dataset.messageRole || "";
      if (role === "system") continue;

      if (mode === "conversation") attachConversationGenerateButton(messageEl);

      const messageKey = getMessageKey(messageEl);
      const isNewMessage = !seenConversationMessageKeys.has(messageKey);
      seenConversationMessageKeys.add(messageKey);
      if (isNewMessage && shouldAutogeneratePersona(messageEl)) {
        void autogeneratePersonaMessage(messageEl);
      }

      const key = messageKey;
      if (!pendingKeyChecks.has(key)) {
        pendingKeyChecks.add(key);
        void ensureHeaderReplay(messageEl).finally(() => pendingKeyChecks.delete(key));
      }
    }
  }

  function getChatSignature() {
    const route = `${window.location.pathname}${window.location.search}`;
    const messages = Array.from(document.querySelectorAll("[data-message-id][data-message-role]")).filter(
      (el) => el instanceof HTMLElement,
    );
    const first = messages[0] ? getCanonicalMessageId(messages[0]) : "none";
    return `route:${route}|first:${first}`;
  }

  function captureNativeTtsClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.classList.contains(`${EXT}-generate`) || button.classList.contains(`${EXT}-header-replay`)) return;
    const label = `${button.getAttribute("title") || ""} ${button.getAttribute("aria-label") || ""}`.trim();
    if (!/(^|\s)(Speak|Stop speaking|Loading)(\s|$)/i.test(label)) return;
    const messageEl = findEventMessageElement(event, button);
    if (!(messageEl instanceof HTMLElement)) return;
    if (!["conversation", "roleplay"].includes(getMode())) return;
    const text = extractMessageText(messageEl);
    if (!text) return;
    nativeTtsCapture = {
      key: getMessageKey(messageEl),
      messageEl,
      speaker: getSpeaker(messageEl),
      sourceTextHash: hashString(text),
    };
    nativeTtsCaptureUntil = Date.now() + 12000;
  }

  function preventHeaderActionToggle(event) {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("button, a, textarea, input, select")) return;
    const messageEl = target.closest("[data-message-id][data-message-role]");
    if (!(messageEl instanceof HTMLElement)) return;
    const header = target.closest(".mari-message-meta, .mari-message-name, .mari-message-timestamp");
    if (!header || !messageEl.contains(header)) return;
    event.stopPropagation();
  }

  HTMLMediaElement.prototype.play = function (...args) {
    const mode = getMode();
    const source = this.currentSrc || this.src || "";
    if (!disposed && ["conversation", "roleplay", "game"].includes(mode) && source.startsWith("blob:") && !this.loop && (mode !== "game" || this.preload === "auto")) {
      if (this !== primedPlaybackAudio) {
        if (this !== activeAudio && activePlaybackKey) stopAudio();
        pauseOtherTtsAudio(this);
      }
      trackedChatAudio.add(this);
      this.addEventListener("ended", () => trackedChatAudio.delete(this), { once: true });
      this.addEventListener("error", () => trackedChatAudio.delete(this), { once: true });
    }
    return originalMediaPlay.apply(this, args);
  };
  addCleanup(() => {
    HTMLMediaElement.prototype.play = originalMediaPlay;
  });

  const wrappedFetch = async (input, init) => {
    if (disposed || !globalThis.__marinaraDialogueCore.supportedMode(getMode())) return originalFetch(input, init);
    const ttsPayload = await readTtsRequestPayload(input, init);
    const gameRequestRoute = ttsPayload && getMode() === 'game' ? location.pathname : '';
    const gameRequestSegment = gameRequestRoute ? getActiveGameSegment() : null;
    if (ttsPayload) {
      try {
        const config = init?.[VERIFIED_TTS_CONFIG] ? { enabled: true } : await getTtsConfig();
        if (config.enabled !== true) return new Response(JSON.stringify({error:"TTS is disabled; voice request was not sent."}), {status:409,headers:{"content-type":"application/json","X-Marinara-Extension-TTS-Suppressed":"1"}});
      } catch {
        return new Response(JSON.stringify({error:"Could not verify TTS status; voice request was not sent."}), {status:503,headers:{"content-type":"application/json"}});
      }
      const backoffMessage = getActiveTtsBackoffMessage();
      if (backoffMessage) {
        notifyTtsBackoff(backoffMessage);
        return ttsBackoffResponse(backoffMessage);
      }
    }

    const knownBlockedGameTtsMessage = ttsPayload ? getKnownBlockedGameTtsMessage(ttsPayload) : "";
    if (knownBlockedGameTtsMessage) {
      return blockedGameTtsResponse(knownBlockedGameTtsMessage);
    }

    let response;
    try {
      if (ttsPayload) {
        const transportKey = hashString(JSON.stringify(ttsPayload));
        let transport = ttsTransportInFlight.get(transportKey);
        let ownsTransport = false;
        if (!transport) {
          ownsTransport = true;
          transport = originalFetch(input, init);
          ttsTransportInFlight.set(transportKey, transport);
        }
        try {
          response = (await transport).clone();
        } finally {
          if (ownsTransport && ttsTransportInFlight.get(transportKey) === transport) {
            ttsTransportInFlight.delete(transportKey);
          }
        }
      } else {
        response = await originalFetch(input, init);
      }
    } catch (err) {
      if (!disposed && ttsPayload) showTtsError("TTS request was not received", err);
      throw err;
    }

    if (!disposed && ttsPayload && response.ok) {
      rememberTtsBackoff(response);
    }

    if (!disposed && ttsPayload && !response.ok) {
      void readErrorResponse(response, `TTS request failed (${response.status})`).then((message) => {
        rememberTtsBackoff(response, message);
        rememberBlockedGameTtsRequest(ttsPayload, message);
        if (!isProviderSafetyError(message) || nativeTtsCapture) showToast(message, "error");
      });
      return response;
    }

    if (!disposed && response.ok && ttsPayload && gameRequestRoute) {
      // Preserve native/preloaded responses even when their turn is no longer
      // active by the time the network response arrives.
      const requestText = cleanText(ttsPayload.text);
      if (requestText) void response.clone().blob().then((blob) => blob.size && putClip({
        key: `game:request:${hashString(JSON.stringify([gameRequestRoute, ttsPayload.speaker || '', requestText, ttsPayload.voice || '', ttsPayload.tone || '']))}`,
        kind: 'game-request', gameRoute: gameRequestRoute, sourceText: requestText,
        speaker: ttsPayload.speaker || '', voice: ttsPayload.voice || '', blobs: [blob],
      })).then(() => { if (!disposed) scan(); }).catch(() => {});
      const segment = gameRequestSegment;
      if (segment?.ready && cleanText(ttsPayload.text) === segment.text &&
          (!ttsPayload.speaker || normalizeName(ttsPayload.speaker) === normalizeName(segment.speaker))) {
        void response.clone().blob().then((blob) => blob.size && putClip({
          key: segment.key, kind: "game-segment", sourceText: segment.text,
          sourceTextHash: hashString(segment.text), speaker: segment.speaker, gameRoute: gameRequestRoute, blobs: [blob],
        })).then(() => scanGameControls()).catch(() => {});
      }
    }
    if (!disposed && response.ok && ttsPayload && getMode() !== "game") {
      const capture =
        nativeTtsCapture && Date.now() < nativeTtsCaptureUntil
          ? nativeTtsCapture
          : findMessageForTtsPayload(ttsPayload);
      if (!capture) return response;
      nativeTtsCapture = null;
      const sourceText = typeof ttsPayload.text === "string" ? ttsPayload.text : "";
      if (sourceText && !originalMessageTextByKey.has(capture.key)) originalMessageTextByKey.set(capture.key, sourceText);
      void response
        .clone()
        .blob()
        .then((blob) => {
          if (!blob.size) throw new Error("TTS response did not include audio");
          return putClip({
            key: capture.key,
            kind: "message",
            sourceTextHash: capture.sourceTextHash,
            sourceText,
            speaker: capture.speaker,
            blobs: [blob],
          });
        })
        .then(() => {
          const target = document.contains(capture.messageEl) ? capture.messageEl : getMessageElementByKey(capture.key);
          if (target instanceof HTMLElement) void ensureHeaderReplay(target);
          window.requestAnimationFrame(scanMessages);
        })
        .catch((err) => {
          console.warn("[Unified TTS] Failed to cache native voice:", err);
          showTtsError("TTS audio was not saved", err);
        });
    }
    if (!disposed && response.ok && isChatMessagesListRequest(input, init)) {
      rememberOriginalMessages(response);
    }
    return response;
  };
  window.fetch = wrappedFetch;
  addCleanup(() => {
    if (window.fetch === wrappedFetch) window.fetch = originalFetch;
  });

  // Read committed application state. Rendered text may contain only a translation.
  // No DOM-text fallback is allowed for Game synthesis.
  function reactOwnerChain(element) {
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null;
    if (!fiber) return [];
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current && root.stateNode.current !== root && fiber.alternate) fiber = fiber.alternate;
    const owners = [];
    for (let count = 0; fiber && count < 40; count += 1, fiber = fiber.return) owners.push(fiber);
    return owners;
  }

  let gameStateCache = new WeakMap();
  let gameStateCacheScheduled = false;
  function gameSourceState(element) {
    const owners = reactOwnerChain(element);
    const cacheOwner = owners.find((owner) => owner.memoizedState?.next && !owner.memoizedProps?.line);
    const cached = cacheOwner && gameStateCache.get(cacheOwner);
    if (cached && cached.head === cacheOwner.memoizedState) return cached.state;
    const segments = [], sideLists = [], maps = [], anchors = [], previous = [];
    const seen = new WeakSet();
    function collect(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return;
      seen.add(value);
      if (value instanceof Map) { maps.push(value); for (const entry of value.values()) collect(entry, depth + 1); return; }
      if (Array.isArray(value)) {
        if (value.some((line) => line && typeof line.character === 'string' && typeof line.content === 'string')) sideLists.push(value);
        for (const entry of value) collect(entry, depth + 1);
        return;
      }
      if (typeof value.id === 'string' && typeof value.content === 'string' && typeof value.type === 'string') segments.push(value);
      if (Number.isInteger(value.index) && typeof value.key === 'string' && 'sourceMessageId' in value) anchors.push(value);
      if (Number.isInteger(value.index) && typeof value.content === 'string') previous.push(value);
      if (value.segments) collect(value.segments, depth + 1);
    }
    for (const owner of owners) {
      let hook = owner.memoizedState;
      for (let count = 0; hook && count < 600; count += 1, hook = hook.next) {
        const value = hook.memoizedState;
        if (value && Object.prototype.hasOwnProperty.call(value, 'current')) collect(value.current);
        if (Array.isArray(value)) collect(value[0]);
      }
    }
    const anchorKey = (segment) => segment.sourceMessageId && segment.sourceSegmentIndex != null
      ? `${segment.sourceMessageId}:${segment.sourceSegmentIndex}`
      : segment.sourceMessageId ? `${segment.sourceMessageId}:${segment.id}` : segment.id;
    let active = null, activeIndex = null;
    for (const anchor of anchors) {
      active = segments.find((segment) => anchorKey(segment) === anchor.key);
      if (active) { activeIndex = anchor.index; break; }
    }
    if (!active) for (const ref of previous) {
      active = segments.find((segment) => segment.content === ref.content);
      if (active) { activeIndex = ref.index; break; }
    }
    const state = { segments, sideLists, maps, active, activeIndex, anchorKey };
    if (cacheOwner) {
      gameStateCache.set(cacheOwner, { head: cacheOwner.memoizedState, state });
      // Refs can change after a React commit without a new hook head.
      // Share reads only within this synchronous scan, never across turns.
      if (!gameStateCacheScheduled) {
        gameStateCacheScheduled = true;
        queueMicrotask(() => { gameStateCacheScheduled = false; gameStateCache = new WeakMap(); });
      }
    }
    return state;
  }

  function originalGameSegment(panel) { return gameSourceState(panel).active; }

  function resolveGamePersonaVoice(segment) {
    const assignments = loadExtensionSettings().personaVoiceAssignments;
    if (!Array.isArray(assignments)) return '';
    const source = segment.source;
    const snapshot = source?.sourceRole === 'user' ? originalMessageMetaByKey.get(`message:${source.sourceMessageId}`)?.personaSnapshot : null;
    const identity = snapshot?.personaId;
    const name = normalizeName(snapshot?.name || segment.speaker);
    return assignments.find((entry) => entry?.voice && ((identity && entry.personaId === identity) || (!identity && name && normalizeName(entry.personaName) === name)))?.voice || '';
  }

  function gameSnapshot(target, source, extra = '') {
    if (!target?.isConnected || !source || !isVisible(target)) return null;
    const text = cleanText(source.content || '');
    const speaker = String(source.speaker || source.character || '').trim();
    const sourceReady = !!text;
    const editing = target.matches('[data-component="GameNarration.ActivePanel"]') ? target.querySelector('.game-narration-prose textarea') : target.querySelector('textarea');
    const ready = sourceReady && !editing && !target.querySelector('[class*="after:animate-pulse"]');
    const route = location.pathname;
    const messageId = source.voiceSourceMessageId || source.sourceMessageId || '';
    const index = source.voiceSourceSegmentIndex ?? source.sourceSegmentIndex;
    return { panel: target, text, speaker, sourceReady, ready, source, extra,
      key: `game:original:${hashString(JSON.stringify([route, messageId || source.id || '', index ?? '', speaker, text, ...(extra ? [extra] : [])]))}` };
  }

  function getLogGameSegment(row) {
    if (!row?.isConnected || !isVisible(row)) return null;
    const state = gameSourceState(row), anchor = row.dataset.logAnchorKey;
    const keys = reactOwnerChain(row).map((owner) => owner.key).filter((key) => typeof key === 'string');
    const source = state.segments.find((segment) => (anchor && state.anchorKey(segment) === anchor) || keys.includes(segment.id));
    return gameSnapshot(row, source);
  }

  function getSideGameSegment(row) {
    if (!row?.isConnected || !isVisible(row)) return null;
    const state = gameSourceState(row);
    const key = reactOwnerChain(row).map((owner) => owner.key).find((key) => typeof key === 'string' && /-side-\d+$/.test(key));
    if (!key) return null;
    const index = Number(key.match(/-side-(\d+)$/)[1]);
    const character = key.replace(/-side-\d+$/, '');
    const mapped = state.maps.map((map) => map.get(state.activeIndex)).filter(Array.isArray);
    const lists = [...mapped, ...state.sideLists];
    const line = lists.map((list) => list[index]).find((line) => line?.character === character && typeof line.content === 'string');
    if (!line) return null;
    const source = { ...line, id: `${state.active?.id || 'side'}:${index}:${character}`,
      sourceMessageId: line.voiceSourceMessageId || state.active?.sourceMessageId,
      sourceSegmentIndex: line.voiceSourceSegmentIndex ?? state.active?.sourceSegmentIndex };
    return gameSnapshot(row, source, line.voiceSourceSegmentIndex == null ? `side:${index}:${character}` : '');
  }

  async function nativeGameVoice(segment) {
    const source = segment.source;
    const id = source.voiceSourceMessageId || source.sourceMessageId;
    const index = source.voiceSourceSegmentIndex ?? source.sourceSegmentIndex;
    if (!id || index == null) return [];
    const sideIndex = segment.extra?.match(/^side:(\d+):/)?.[1];
    const prefix = `${id}:${index}${sideIndex != null ? `:side:${sideIndex}` : ''}:`;
    for (const map of gameSourceState(segment.panel).maps) {
      for (const [key, entry] of map) {
        if (typeof key !== 'string' || !key.startsWith(prefix) || key.slice(prefix.length).includes(':') ||
            entry?.status !== 'ready' || !entry.urls?.length || !entry.urls.every((url) => typeof url === 'string' && url.startsWith('blob:'))) continue;
        if (entry.speaker && normalizeName(entry.speaker) !== normalizeName(segment.speaker)) continue;
        // Native voice keys include source identity, while edited source must also match.
        if (Array.isArray(entry.chunks) && cleanText(entry.chunks.join(' ')) !== segment.text) continue;
        const blobs = await Promise.all(entry.urls.map((url) => originalFetch(url).then((response) => response.blob()))).catch(() => []);
        if (blobs.length && blobs.every((blob) => blob.size)) return blobs;
      }
    }
    return [];
  }

  function originalMessageText(messageEl) {
    const id = getCanonicalMessageId(messageEl);
    for (const owner of reactOwnerChain(messageEl)) {
      const message = owner.memoizedProps?.message;
      if (message?.id === id && typeof message.content === 'string') return message.content;
    }
    return originalMessageTextByKey.get(getMessageKey(messageEl)) || '';
  }

  function getActiveGameSegment() {
    if (getMode() !== 'game') return null;
    const panel = Array.from(document.querySelectorAll('[data-tour="game-dialogue"] [data-component="GameNarration.ActivePanel"]')).find(isVisible);
    if (!panel) return null;
    const source = originalGameSegment(panel);
    return gameSnapshot(panel, source) || { panel, text: '', speaker: '', ready: false, sourceReady: false, key: '' };
  }

  const pendingGameArchives = new Set();
  async function recoverArchivedGameVoice(segment) {
    const db = await openDb();
    if (!db) return null;
    if (!gameArchiveIndexLoaded) {
      if (!gameArchiveIndexLoad) gameArchiveIndexLoad = new Promise((resolve) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { gameArchiveIndexLoaded = true; resolve(); return; }
          const record = cursor.value;
          if (['game-segment', 'game-request'].includes(record.kind) && record.gameRoute && record.blobs?.length) {
            const previous = gameArchiveMetadata.get(record.key);
            if (!previous || previous.updatedAt <= record.updatedAt) gameArchiveMetadata.set(record.key, {
              key: record.key, gameRoute: record.gameRoute, sourceText: record.sourceText,
              speaker: record.speaker, updatedAt: record.updatedAt,
            });
          }
          cursor.continue();
        };
        request.onerror = () => resolve();
      }).finally(() => { gameArchiveIndexLoad = null; });
      await gameArchiveIndexLoad;
    }
    // Keep only metadata in memory, loading one chosen clip's blobs.
    const match = Array.from(gameArchiveMetadata.values()).filter((record) =>
      record.gameRoute === location.pathname && record.sourceText === segment.text && record.speaker === segment.speaker)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    return match ? getClip(match.key) : null;
  }

  function archiveNativeGameVoices() {
    const panel = document.querySelector('[data-component="GameNarration.ActivePanel"]');
    if (!panel || !isVisible(panel)) return;
    for (const source of gameSourceState(panel).segments) {
      const segment = gameSnapshot(panel, source);
      if (!segment?.sourceReady || knownReadyKeys.has(segment.key) || pendingGameArchives.has(segment.key)) continue;
      pendingGameArchives.add(segment.key);
      const archiveRoute = location.pathname;
      void hasClip(segment.key).then((saved) => saved ? [] : nativeGameVoice(segment)).then((blobs) => blobs.length && putClip({
        key: segment.key, kind: 'game-segment', sourceText: segment.text,
        speaker: segment.speaker, gameRoute: archiveRoute, blobs,
      })).catch(() => {}).finally(() => pendingGameArchives.delete(segment.key));
    }
  }

  async function hasGameClip(segment) {
    if (!segment.sourceReady) return false;
    if (await hasClip(segment.key)) return true;
    const archived = await recoverArchivedGameVoice(segment);
    if (archived) return putClip({ ...archived, key: segment.key, kind: 'game-segment' });
    // Migrate an existing 4.0.5–4.0.7 record with the current URL query.
    const oldRoute = `${location.pathname}${location.search}`;
    const source = segment.source;
    const oldKey = `game:original:${hashString(JSON.stringify([oldRoute,
      source.voiceSourceMessageId || source.sourceMessageId || source.id || '',
      source.voiceSourceSegmentIndex ?? source.sourceSegmentIndex ?? '',
      segment.speaker, segment.text, ...(segment.extra ? [segment.extra] : [])]))}`;
    const oldClip = oldKey !== segment.key ? await getClip(oldKey) : null;
    if (oldClip?.kind === 'game-segment' && oldClip.sourceText === segment.text && oldClip.speaker === segment.speaker && oldClip.blobs?.length)
      return putClip({ ...oldClip, key: segment.key, gameRoute: location.pathname });
    const native = await nativeGameVoice(segment);
    if (native.length) return putClip({ key: segment.key, kind: 'game-segment', sourceText: segment.text, speaker: segment.speaker, blobs: native });
    // Keep valid 4.0.4 source recordings; never migrate translated recordings.
    const route = `${location.pathname}${location.search}`;
    const legacyKey = `game:${hashString(JSON.stringify([route, segment.speaker, segment.text]))}`;
    const legacy = await getClip(legacyKey);
    if (legacy?.kind !== 'game-segment' || !legacy.blobs?.length ||
        typeof legacy.sourceText !== 'string' || cleanText(legacy.sourceText) !== segment.text) return false;
    return putClip({ ...legacy, key: segment.key });
  }

  function scanGameControls(target = null, resolveSegment = getActiveGameSegment, scope = 'active') {
    const segment = resolveSegment(target);
    const nextKey = segment?.ready ? segment.key : "";
    if (scope === 'active') {
      if (lastGameSegmentKey && nextKey !== lastGameSegmentKey && (activePlaybackKey === lastGameSegmentKey || pendingReplayKey === lastGameSegmentKey)) stopAudio();
      lastGameSegmentKey = nextKey;
    }
    for (const old of scope === 'active' ? document.querySelectorAll(`.${EXT}-game-controls[data-scope=active]`) : []) {
      if (!segment || old.parentElement !== segment.panel) old.remove();
    }
    if (!segment) return;
    let controls = segment.panel.querySelector(`.${EXT}-game-controls`);
    if (!controls) {
      controls = document.createElement('div');
      controls.className = `${EXT}-game-controls`;
      controls.dataset.scope = scope;
      controls.dataset.gameSkipBgNav = 'true';
      const generate = createButton(`${EXT}-generate`, "Generate current segment voice", icons.volume, async () => {
        const current = resolveSegment(target);
        if (!current?.ready || generationInFlight.has(current.key)) return;
        generationInFlight.add(current.key);
        scanGameControls(target, resolveSegment, scope);
        try {
          if (await hasGameClip(current)) {
            if (!confirm('현재 대사의 음성을 다시 생성할까요? API 사용량이 발생합니다.')) return;
          }
          // Re-read after the async cache check and confirmation.
          if (resolveSegment(target)?.key !== current.key) return;
          stopAudio();
          pauseOtherTtsAudio();
          const clip = await generateClip(current.key, current.text, { speaker: current.speaker, voice: resolveGamePersonaVoice(current), kind: 'game-segment', isCurrent: () => !disposed && resolveSegment(target)?.key === current.key });
          // Save completed audio, but never play an old segment after navigation.
          if (!disposed && resolveSegment(target)?.key === current.key) await playGeneratedClip(clip);
        } catch (error) {
          if (!disposed && resolveSegment(target)?.key === current.key) showTtsError('Game TTS generation failed', error);
        } finally {
          generationInFlight.delete(current.key);
          if (!disposed) scanGameControls(target, resolveSegment, scope);
        }
      });
      const replay = createButton(`${EXT}-header-replay`, "Replay current segment voice", icons.volume, async () => {
        const current = resolveSegment(target);
        if (current?.ready) await toggleSavedVoice(current.key);
      });
      replay.dataset.replayTitle = 'Replay current segment voice';
      controls.append(generate, replay);
      segment.panel.appendChild(controls);
    }
    const generate = controls.querySelector(`.${EXT}-generate`);
    const replay = controls.querySelector(`.${EXT}-header-replay`);
    const busy = generationInFlight.has(segment.key);
    generate.disabled = !segment.ready || busy;
    const saved = knownReadyKeys.has(segment.key);
    setButtonState(generate, busy ? 'loading' : saved ? 'ready' : 'idle', !segment.sourceReady ? '현재 대사의 원문을 확인하지 못해 생성을 중단했습니다' : !segment.ready ? '대사 출력 완료 후 생성할 수 있습니다' : saved ? 'Regenerate current segment voice' : 'Generate current segment voice');
    replay.dataset.mariTtsReplayKey = segment.key;
    if (controls.dataset.segmentKey !== segment.key) {
      controls.dataset.segmentKey = segment.key;
      replay.disabled = true;
    }
    if (!controls.checkingVoice) {
      controls.checkingVoice = true;
      void hasGameClip(segment).then((saved) => {
        if (!controls.isConnected || resolveSegment(target)?.key !== segment.key) return;
        replay.disabled = !segment.ready || !saved;
        if (saved && !generationInFlight.has(segment.key) && generate.dataset.state !== 'ready') setButtonState(generate, 'ready', 'Regenerate current segment voice');
        updateReplayButtons();
      }).finally(() => { controls.checkingVoice = false; });
    }
    updateReplayButtons();
  }

  function scan() {
    if (disposed) return;
    gameStateCache = new WeakMap();
    const mode = getMode();
    if (mode === 'game') archiveNativeGameVoices();
    const isChatMode = ["conversation", "roleplay"].includes(mode);
    const wasChatMode = ["conversation", "roleplay"].includes(lastMode);
    const chatSignature = isChatMode ? getChatSignature() : "";
    const personaChatRoute = mode === "conversation" ? `${window.location.pathname}${window.location.search}` : "";
    if (mode === "conversation" && personaChatRoute !== personaAutoChatSignature) {
      personaAutoChatSignature = personaChatRoute;
      personaAutoSuppressedUntil = Date.now() + 2200;
      seenConversationMessageKeys.clear();
      for (const messageEl of document.querySelectorAll("[data-message-id][data-message-role]")) {
        if (messageEl instanceof HTMLElement) seenConversationMessageKeys.add(getMessageKey(messageEl));
      }
    }
    if (
      (wasChatMode || lastMode === "game") &&
      (mode !== lastMode || (isChatMode && lastChatSignature && chatSignature !== lastChatSignature))
    ) {
      stopTrackedChatAudio();
    }
    lastMode = mode;
    lastChatSignature = isChatMode ? chatSignature : "";
    if (!globalThis.__marinaraDialogueCore.supportedMode(mode)) return;
    scanMessages();
    markTranslationBlocks();
    scanGameControls();
    const rows = document.querySelectorAll('[data-log-anchor-key], [class*="group/logseg"]');
    for (const row of rows) if (isVisible(row)) scanGameControls(row, getLogGameSegment, 'log');
    for (const row of document.querySelectorAll('[data-tour="game-dialogue"] .animate-party-slide-in'))
      if (isVisible(row)) scanGameControls(row, getSideGameSegment, 'side');
    const playingControl = Array.from(document.querySelectorAll(`.${EXT}-game-controls`)).find((el) => el.dataset.segmentKey === activePlaybackKey);
    if (activePlaybackKey?.startsWith('game:') && !playingControl) stopAudio();
    updateReplayButtons();
  }

  globalThis.__marinaraMessageTextTools = {
    version: TEXT_TOOLS_VERSION,
    cleanText,
    cleanExtractedText,
    extractMessageText,
    getMessageElements,
    getCanonicalMessageId,
    originalMessageText,
    generateClip,
    getClip,
    playBlobs,
    stopAudio,
    getPlaybackKey: () => activePlaybackKey || pendingReplayKey,
    getMode,
    resolveGameSegment: target => target?.matches('[data-component="GameNarration.ActivePanel"]') ? gameSnapshot(target, originalGameSegment(target)) : getLogGameSegment(target) || getSideGameSegment(target),
    originalMessages: originalMessageTextByKey,
  };
  addCleanup(() => {
    if (globalThis.__marinaraMessageTextTools?.version === TEXT_TOOLS_VERSION) {
      delete globalThis.__marinaraMessageTextTools;
    }
  });

  cleanupExtensionDom();
  addCleanup(cleanupExtensionDom);

  const style = document.createElement("style");
  style.textContent = `
    .${EXT}-game-controls {display:flex;justify-content:flex-end;gap:0.35rem;padding-top:0.25rem;}
    .${EXT}-game-controls button {width:1.65rem;height:1.65rem;min-height:0;padding:0.25rem;}
    .${EXT}-game-controls button:disabled {opacity:0.4;cursor:default;}
    .${EXT}-generate,
    .${EXT}-header-replay,
    .${EXT}-inline-replay-slot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      transition: color 150ms ease, background-color 150ms ease, opacity 150ms ease, transform 120ms ease;
    }
    .${EXT}-generate {
      border-radius: 0.25rem;
      padding: 0.25rem;
      color: color-mix(in srgb, currentColor 72%, transparent);
    }
    .${EXT}-generate:hover {
      background: color-mix(in srgb, currentColor 18%, transparent);
      color: var(--primary);
    }
    .${EXT}-header-replay {
      width: 1.25rem;
      height: 1.25rem;
      margin-left: 0.125rem;
      border-radius: 9999px;
      color: var(--primary);
      opacity: 0.78;
      vertical-align: middle;
      position: relative;
      z-index: 20;
      flex: 0 0 auto;
    }
    .${EXT}-header-replay:hover {
      background: color-mix(in srgb, var(--primary) 18%, transparent);
      opacity: 1;
    }
    .${EXT}-header-replay-overlay {
      position: absolute;
      top: 0.375rem;
      right: 0.375rem;
      margin-left: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--background) 78%, transparent);
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
    }
    .${EXT}-generate svg,
    .${EXT}-header-replay svg {
      width: 0.85rem;
      height: 0.85rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .${EXT}-header-replay svg {
      width: 0.72rem;
      height: 0.72rem;
    }
    .${EXT}-generate[data-state="loading"] {
      cursor: wait;
      color: var(--primary);
      opacity: 0.95;
    }
    .${EXT}-generate[data-state="ready"] {
      color: var(--primary);
    }
    .${EXT}-generate-overlay {
      position: absolute;
      right: 0.375rem;
      bottom: 0.375rem;
      z-index: 2;
      background: color-mix(in srgb, var(--background) 78%, transparent);
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
    }
    @keyframes mari-ext-tts-spin {
      to { transform: rotate(360deg); }
    }
    .mari-ext-tts-spin {
      animation: mari-ext-tts-spin 0.9s linear infinite;
      transform-origin: center;
    }
    .${EXT}-toast-region {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      z-index: 2147483647;
      display: flex;
      width: min(24rem, calc(100vw - 2rem));
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
    }
    .${EXT}-toast {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      background: var(--card);
      color: var(--foreground);
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.28);
      padding: 0.75rem 0.875rem;
      font-size: 0.8125rem;
      line-height: 1.35;
      user-select: text;
      pointer-events: auto;
      animation: mari-ext-tts-toast-in 160ms ease-out;
    }
    .${EXT}-toast-dot {
      width: 0.5rem;
      height: 0.5rem;
      margin-top: 0.25rem;
      border-radius: 9999px;
      background: var(--destructive, #ff6b9d);
      flex: 0 0 auto;
    }
    .${EXT}-toast-warning .${EXT}-toast-dot {
      background: rgb(245 158 11);
    }
    .${EXT}-toast-success .${EXT}-toast-dot {
      background: rgb(16 185 129);
    }
    .${EXT}-toast-out {
      animation: mari-ext-tts-toast-out 180ms ease-in forwards;
    }
    @keyframes mari-ext-tts-toast-in {
      from { opacity: 0; transform: translateY(0.5rem); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes mari-ext-tts-toast-out {
      to { opacity: 0; transform: translateY(0.35rem); }
    }
    @media (max-width: 640px) {
      .${EXT}-toast-region {
        right: 0.75rem;
        bottom: calc(0.75rem + env(safe-area-inset-bottom));
        width: min(22rem, calc(100vw - 1.5rem));
      }
    }
  `;
  document.head.appendChild(style);
  addCleanup(() => style.remove());

  document.addEventListener("click", captureNativeTtsClick, true);
  addCleanup(() => document.removeEventListener("click", captureNativeTtsClick, true));

  document.addEventListener("click", preventHeaderActionToggle, true);
  addCleanup(() => document.removeEventListener("click", preventHeaderActionToggle, true));

  const observer = new MutationObserver(() => {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  addCleanup(() => observer.disconnect());

  const interval = window.setInterval(scan, 2500);
  addCleanup(() => window.clearInterval(interval));

  globalState.dispose = () => {
    disposed = true;
    stopAudio();
    while (cleanupFns.length) {
      const fn = cleanupFns.pop();
      try {
        fn?.();
      } catch {
        // Best-effort cleanup only.
      }
    }
  };

  if (typeof marinara !== 'undefined') marinara.onCleanup(globalState.dispose);

  scan();
})();


(function () {
  'use strict';
  const C = globalThis.__marinaraDialogueCore;
  const T = globalThis.__marinaraMessageTextTools;
  if (!C || !T) throw new Error('TTS 구성 파일을 순서대로 불러오세요.');
  globalThis.__marinaraDialogueUpgrade?.dispose?.({keepRules:true});
  const baseFetch = window.fetch.bind(window);
  const PREFIX = 'ElevenLabs TTS 4.1 / ';
  const LS = 'marinara.tts.dialogue.v410';
  const settingsKey = 'marinara.elevenlabs.multilingual.override.v1';
  let stopped = false, scheduled = false, applying = null, rulesReady = false, lastEnabled;
  let providerPromise = null, providerAt = 0;
  const messages = new Map(), contexts = new Map(), contextRequests = new Map(), pending = new Set(), ownedRules = new Set();
  const mounted = new Map(), hidden = new Set(), personaSnapshots = new Map(), fallbackRows=new Set(), contextRetryAt=new Map();
  const opts = (() => { try { return {enabled:true,rpMode:'tagged',...JSON.parse(localStorage.getItem(LS)||'{}')}; } catch { return {enabled:true,rpMode:'tagged'}; } })();
  const ROOM_LS='marinara.tts.rooms.v430';
  let roomOptions;try{roomOptions=JSON.parse(localStorage.getItem(ROOM_LS)||'{}');}catch{roomOptions={};}
  const views=new Map(),viewerSources=new WeakMap();let uiRoom=null;
  let instructionState=null;
  const master={enabled:null,busy:false,refresh:null,client:null,unsubscribe:null,reloadTimer:null};
  function roomSettings(id=activeChatId()){return {...opts,...(id&&roomOptions[id]||{})};}
  function saveRoom(patch,id=activeChatId()){if(!id){notice(new Error('방을 연 다음 음성 설정을 변경하세요.'));return false;}try{roomOptions=JSON.parse(localStorage.getItem(ROOM_LS)||'{}');}catch{}roomOptions[id]={...(roomOptions[id]||{}),...patch};localStorage.setItem(ROOM_LS,JSON.stringify(roomOptions));return true;}
  lastEnabled = enabled();
  let status = '초기화 중', statusError = '';
  const style = document.createElement('style');
  style.textContent = '.mari-tts-cue{display:none!important}.mari-tts-line-controls{display:inline-flex;gap:3px;margin-left:5px;vertical-align:middle}.mari-tts-line-controls button{line-height:1.5;border:1px solid var(--border,#888);border-radius:5px;padding:1px 5px;background:var(--card,#222);color:var(--foreground,#eee);cursor:pointer}.mari-tts-line-controls button:disabled{opacity:.45;cursor:default}.mari-tts-upgrade-panel{font:inherit;padding:8px;border-top:1px solid var(--border,#888)}';
  document.head.append(style);
  style.textContent+='.mari-tts-rp-toolbar{position:relative;display:inline-flex!important;padding:0!important;font:inherit}.mari-tts-rp-corner{position:absolute;top:6px;right:6px;z-index:20}.mari-tts-rp-popover{position:absolute;top:100%;right:0;max-width:min(280px,85vw);padding:10px;background:var(--card,#222);border:1px solid var(--border,#888);border-radius:8px;box-shadow:0 4px 12px #0005;z-index:30}.mari-tts-rp-popover[hidden]{display:none!important}.mari-tts-rp-popover select{display:block;max-width:100%;margin-top:8px}.mari-tts-fallback-row{display:block;margin:6px 0;padding:5px 7px;border:1px dashed var(--border,#888);border-radius:5px}';
  style.textContent+='.mari-tts-fallback-row,.mari-tts-line-error,.mari-tts-voice-editor{font:inherit}.mari-tts-line-controls{font:inherit}.mari-tts-line-controls button{font-family:inherit;font-size:.8em}.mari-tts-rp-toolbar{display:flex;gap:6px;align-items:center;padding:5px 8px;font:inherit}.mari-tts-rp-toolbar select,.mari-tts-voice-editor input{font:inherit}.mari-tts-line-error{display:block;color:var(--destructive,#d77)}';
  function notice(error) { statusError=String(error?.message||error); paintPanel(); console.warn('[TTS 4.1]',statusError); }
  function extensionSettings() { const override=globalThis.__marinaraElevenlabsOverride;if(override&&!override.disposed)return override.settings;try { return JSON.parse(localStorage.getItem(settingsKey)||'{}'); } catch { return {}; } }
  function taggedRp(id){return roomSettings(id).rpMode==='tagged';}
  function enabled(id) { return roomSettings(id).enabled && extensionSettings().enabled !== false; }
  function headers(original) {
    const h=new Headers(original); h.set('x-marinara-csrf','1');
    const secret=localStorage.getItem('marinara_admin_secret'); if(secret)h.set('X-Admin-Secret',secret);
    return h;
  }
  async function api(path, method='GET', body) {
    const h=headers(); if(body!==undefined)h.set('Content-Type','application/json');
    const r=await baseFetch('/api'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error(method+' /api'+path+' 요청 실패 ('+r.status+'): '+(await r.text()).slice(0,200));
    return r.status===204?null:r.json();
  }
  const list = v => Array.isArray(v)?v:(()=>{try{return JSON.parse(v||'[]');}catch{return [];}})();
  const yes = v => v===true||v==='true';
  function remember(rows) {
    for(const m of Array.isArray(rows)?rows:[rows]) if(m?.id && typeof m.content==='string') {
      messages.set(m.id,m); T.originalMessages.set('message:'+m.id,m.content);
    }
    while(messages.size>1000)messages.delete(messages.keys().next().value);
    queueScan();
  }
  async function context(chatId, refresh=false) {
    if(contextRequests.has(chatId))return contextRequests.get(chatId);
    if(!refresh && contexts.has(chatId))return contexts.get(chatId);
    const request=(async()=>{
    const [chat, chars, personas]=await Promise.all([api('/chats/'+encodeURIComponent(chatId)),api('/characters?includeBuiltIn=true'),api('/characters/personas/list')]);
    const ids=list(chat.characterIds), participants=[];
    const characterName=ch=>{let data=ch.data;try{if(typeof data==='string')data=JSON.parse(data);}catch{}return ch.name||data?.name||ch.id;};
    for(const ch of list(chars)) if(ids.includes(ch.id)&&ch.id!==chat.personaCharacterId) participants.push({kind:'character',id:ch.id,name:characterName(ch)});
    if(chat.personaCharacterId) {
      const p=list(chars).find(p=>p.id===chat.personaCharacterId);
      if(p)participants.push({kind:'persona',id:p.id,name:characterName(p)});
    } else if(chat.personaId) {
      const p=list(personas).find(p=>p.id===chat.personaId);
      if(p)participants.push({kind:'persona',id:p.id,name:p.name});
    }
    const ctx={chat,participants,allCharacterIds:list(chars).map(c=>c.id),allSpeakerIds:[...list(chars),...list(personas)].map(c=>c.id)};
    contexts.set(chatId,ctx); return ctx;
    })();contextRequests.set(chatId,request);
    try{return await request;}finally{contextRequests.delete(chatId);}
  }
  async function filters() {
    // Persisted regex rules have no mode/agent scope. Migrate old global rules
    // away; display-only handling below leaves input and stored text untouched.
    if(stopped||rulesReady)return;
    if(applying)return applying;
    applying=removeFilters().then(()=>{rulesReady=true;status='지원 모드의 AI 출력만 표시 필터 적용';});
    try {await applying;} finally {applying=null;}
  }
  async function removeFilters() {
    const rows=await api('/regex-scripts');
    for(const row of rows.filter(r=>r.name.startsWith(PREFIX)))await api('/regex-scripts/'+encodeURIComponent(row.id),'DELETE');
    ownedRules.clear(); rulesReady=false;
  }
  async function provider(force=false) {
    if(!force&&providerPromise&&Date.now()-providerAt<5000)return providerPromise;
    providerAt=Date.now();
    providerPromise=(async()=>{
      const [cfg,rows]=await Promise.all([api('/tts/config'),api('/connections')]);
      if(!cfg.enabled)throw new Error('ME의 TTS를 먼저 켜세요.');
      const audio=list(rows).filter(r=>r.provider==='audio'&&!yes(r.profileImportReviewRequired));
      const row=audio.find(r=>yes(r.defaultForAgents))||audio.find(r=>yes(r.fallbackForAgents));
      const source=row?.audioSource||cfg.source;
      if(source!=='elevenlabs')throw new Error('기본 Audio 연결을 ElevenLabs로 선택하세요.');
      if(row && row.model!=='eleven_v4')await api('/connections/'+encodeURIComponent(row.id),'PATCH',{model:'eleven_v4'});
      if(!row && cfg.model!=='eleven_v4')await api('/tts/config','PUT',{...cfg,model:'eleven_v4'});
      if(cfg.skipBracketedText)await api('/tts/config','PUT',{...cfg,model:row?cfg.model:'eleven_v4',skipBracketedText:false});
      const profile=cfg.source==='elevenlabs'?cfg:(cfg.sourceProfiles?.elevenlabs||{});
      return {...cfg,...profile,enabled:cfg.enabled,source:'elevenlabs',model:'eleven_v4',baseUrl:row?.baseUrl||profile.baseUrl||'https://api.elevenlabs.io',audioConnectionId:row?.id||''};
    })();
    try{return await providerPromise;}catch(e){providerPromise=null;throw e;}
  }
  async function prepareGeneration(body) {
    if(extensionSettings().enabled===false||!body?.chatId||agentRequest(body))return body;
    const ctx=await context(body.chatId,true);
    if(!C.supportedMode(ctx.chat.mode))return body;
    // The request chat is authoritative, independent of launcher visibility
    // or a stale active-chat localStorage value. Display migrations run at boot.
    // Native TTS OFF means no speech instructions.
    const cfg=await api('/tts/config');
    instructionState={chatId:body.chatId,mode:ctx.chat.mode,enabled:!!cfg.enabled};updateMaster(cfg);
    if(!cfg.enabled)return body;
    // Speech connection validation/model changes belong to the later TTS request.
    const guide=C.instruction(ctx.chat.mode,ctx.participants,roomSettings(body.chatId).rpMode);
    const meta=typeof ctx.chat.metadata==='string'?JSON.parse(ctx.chat.metadata||'{}'):(ctx.chat.metadata||{});
    const preserveSmart=ctx.chat.mode==='roleplay'&&!body.generationGuide?.trim()&&meta.groupResponseOrder==='smart';
    if(String(body.generationGuide||'').includes('[ElevenLabs TTS output instructions]'))return body;
    return {...body,...(preserveSmart?{smartResponse:true}:{}),generationGuide:[body.generationGuide,guide].filter(Boolean).join('\n\n')};
  }
  function normal(text) {
    return C.display(text).replace(/<[^>]+>/g,' ').replace(/^\s*(?:Dialogue\s*)?\[[^\]]+\](?:\s*\[[^\]]+\])*\s*:\s*/gm,'').replace(/[*_`"“”‘’]/g,'').replace(/\s+/g,' ').trim();
  }
  function participantsFor(m){
    const ctx=contexts.get(m.chatId),value=m.extra;
    let extra={};try{extra=typeof value==='string'?JSON.parse(value||'{}'):(value||{});}catch{}
    const snapshot=personaSnapshots.get(m.id+':'+(m.activeSwipeIndex||0))||extra.ttsDialoguePersona;
    return snapshot?[...(ctx?.participants||[]).filter(p=>p.kind!=='persona'),snapshot]:(ctx?.participants||[]);
  }
  const parseMessage=m=>C.parse(m.content,participantsFor(m));
  function quoted(text){
    const masked=String(text||'').replace(/<[^>]*>/g,m=>' '.repeat(m.length)).replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g,m=>' '.repeat(m.length));
    return [...masked.matchAll(/"([^"\n]*(?:\n[^"\n]*)*)"|“([^”]*)”|「([^」]*)」/g)].map(m=>({start:m.index,end:m.index+m[0].length,raw:C.speechText(m[0])}));
  }
  function dialogueLines(m){
    if(taggedRp(m.chatId)){const tagged=parseMessage(m);if(tagged.length)return tagged;}
    // Standard RP keeps per-dialogue controls while all lines use the native message speaker.
    return quoted(m.content).map((l,index)=>({...l,index,native:true,kind:'character',id:m.characterId||''}));
  }
  function agentRequest(body) {
    return !!(body.agentId||body.agentIds?.length||body.agent||body.agentType||body.agentName||body.isAgent||body.agentRunId);
  }
  function translationOutput(body) {
    if(agentRequest(body)||!C.supportedMode(T.getMode()))return false;
    // Never tokenize structured agent payloads, even in an open chat room.
    try {const data=JSON.parse(body.text);if(data&&typeof data==='object')return false;}catch{}
    const text=String(body.text||'').trim(), room=activeChatId();
    const rows=[...messages.values()];
    for(const el of document.querySelectorAll('[data-message-id][data-message-role]')){const m=reactMessage(el);if(m)rows.push(m);}
    const same=m=>m?.chatId===room&&typeof m.content==='string'&&m.content.trim()===text;
    // An input translation must not inherit protection from identical AI text.
    if(rows.some(m=>m.role==='user'&&same(m)))return false;
    if(rows.some(m=>m.role==='assistant'&&same(m)))return true;
    if(T.getMode()==='game'&&text)for(const target of document.querySelectorAll('[data-component="GameNarration.ActivePanel"],[data-log-anchor-key],[class*="group/logseg"],[data-tour="game-dialogue"] .animate-party-slide-in'))if(T.resolveGameSegment?.(target)?.text?.trim()===text)return true;
    return false;
  }
  function protectTranslation(body){
    const tokens=[],text=String(body.text||'');
    const protectedText=text.replace(new RegExp(C.wrapperPattern+'|'+C.cuePattern,'gi'),value=>{const token='ZXMETTS'+tokens.length+'XZ';tokens.push({token,value});return token;});
    return {body:{...body,text:protectedText,systemPrompt:[body.systemPrompt,'Preserve every ZXMETTS<number>XZ token exactly and in its original order. Translate all surrounding prose and dialogue. Tokens represent protected formatting and audio cues; do not explain, omit or translate them.'].filter(Boolean).join('\n\n')},tokens};
  }
  function restoreSpeech(payload) {
    const needle=normal(payload.text), candidates=[];
    if(!needle)return payload;
    const mode=T.getMode();
    if(mode==='game'&&T.resolveGameSegment){
      for(const target of document.querySelectorAll('[data-component="GameNarration.ActivePanel"],[data-log-anchor-key],[class*="group/logseg"],[data-tour="game-dialogue"] .animate-party-slide-in')){
        const segment=T.resolveGameSegment(target);
        if(segment?.text&&normal(segment.text)===needle)candidates.push(segment.text);
      }
    }
    for(const m of messages.values()) {
      if(m.chatId && activeChatId() && m.chatId!==activeChatId())continue;
      const tagged=mode==='roleplay'?parseMessage(m):[];
      if(mode==='roleplay'&&taggedRp()&&tagged.length && (normal(m.content)===needle||tagged.some(l=>normal(l.raw)===needle))) {
        throw new Error('태그 대사는 옆의 대사별 생성·재생 버튼을 사용하세요.');
      }
      const rawCandidates=[m.content,...m.content.split(/\r?\n/).map(line=>line.replace(/^\s*(?:Dialogue\s*)?\[[^\]]+\](?:\s*\[[^\]]+\])*\s*:\s*/,'').replace(/^\s*["“]|["”]\s*$/g,''))];
      for(const text of rawCandidates) if(normal(text)===needle)candidates.push(text.replace(/<[^>]+>/g,'').trim());
    }
    const unique=[...new Set(candidates)];
    if(unique.length>1&&unique.some(t=>t!==payload.text))throw new Error('같은 대사에 서로 다른 감정 지시가 있습니다. 해당 메시지의 생성 버튼을 사용하세요.');
    return unique.length===1?{...payload,text:unique[0]}:payload;
  }
  function activeChatId() {
    // Prefer the actual chat's React data to a stale cross-extension storage key.
    for(const el of document.querySelectorAll('[data-component="ChatArea.Roleplay"] [data-message-id],[data-component="ChatArea.Conversation"] [data-message-id]')) {
      const m=reactMessage(el)||messages.get(T.getCanonicalMessageId(el)); if(m?.chatId)return m.chatId;
    }
    return localStorage.getItem('marinara-active-chat-id')||null;
  }
  function reactMessage(el) {
    const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$')); let f=k?el[k]:null;
    let root=f;while(root?.return)root=root.return;if(root?.stateNode?.current&&root.stateNode.current!==root&&f?.alternate)f=f.alternate;
    for(let i=0;f&&i<80;i++,f=f.return)if(f.memoizedProps?.message)return f.memoizedProps.message;
    return null;
  }
  async function observeStream(response, generationContext) {
    const reader=response.clone().body?.getReader(); if(!reader)return;
    const decoder=new TextDecoder();let buffer='';
    try { while(!stopped) {
      const r=await reader.read();if(r.done)break;
      buffer+=decoder.decode(r.value,{stream:true});const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop();
      for(const frame of frames) {
        const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
        try {
          const event=JSON.parse(data),m=event.data?.message||event.data;
          if(m?.id&&typeof m.content==='string') {
            const persona=generationContext?.participants.find(p=>p.kind==='persona');
            if(generationContext?.chat.mode==='roleplay'&&persona&&C.parse(m.content,generationContext.participants).some(l=>l.kind==='persona')) {
              const extra=typeof m.extra==='string'?JSON.parse(m.extra||'{}'):(m.extra||{});
              m.extra={...extra,ttsDialoguePersona:persona};
              personaSnapshots.set(m.id+':'+(m.activeSwipeIndex||0),persona);
              while(personaSnapshots.size>1000)personaSnapshots.delete(personaSnapshots.keys().next().value);
              if(event.type==='message_saved')void api('/chats/'+encodeURIComponent(m.chatId||generationContext.chat.id)+'/messages/'+encodeURIComponent(m.id)+'/extra?swipeIndex='+(m.activeSwipeIndex||0),'PATCH',{ttsDialoguePersona:persona}).catch(notice);
            }
            remember(m);
          }
        }catch{}
      }
      if(buffer.length>1000000)buffer='';
    }} finally {await reader.cancel().catch(()=>{});}
  }
  const fetchWrapper=async(input,init)=>{
    if(stopped||extensionSettings().enabled===false)return baseFetch(input,init);
    const url=new URL(typeof input==='string'?input:(input instanceof URL?input.href:input.url),location.href);
    const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin!==location.origin)return baseFetch(input,init);
    if(method==='POST'&&(url.pathname==='/api/generate'||url.pathname==='/api/generate/')) {
      let changed,body;
      try {
        body=JSON.parse(typeof init?.body==='string'?init.body:await input.clone().text());
        changed=await prepareGeneration(body);
      }catch(e){
        notice(new Error('TTS 대사 지침을 적용하지 못했습니다. 텍스트 생성은 계속합니다. '+e.message));
      }
      if(init?.signal?.aborted)throw new DOMException('요청 취소','AbortError');
      // Forward exactly once; preparation failure must never block main AI generation.
      // Network/model failures after dispatch are not retried here.
      const r=await baseFetch(input,changed&&changed!==body?{...init,method,headers:headers(init?.headers||(input instanceof Request?input.headers:undefined)),body:JSON.stringify(changed)}:init);
      if(changed&&changed!==body&&r.headers.get('content-type')?.includes('text/event-stream'))void observeStream(r,contexts.get(body.chatId)).catch(notice);
      return r;
    }
    if(!C.supportedMode(T.getMode()))return baseFetch(input,init);
    if(method==='POST'&&url.pathname==='/api/tts/speak') {
      if(!enabled())return baseFetch(input,init);
      try {
        const payload=JSON.parse(typeof init?.body==='string'?init.body:await input.clone().text());
        const cfg=await provider();
        const own=new Headers(init?.headers||(input instanceof Request?input.headers:undefined)).get('X-Marinara-TTS-Line')==='1';
        const changed=own?payload:restoreSpeech(payload);
        return baseFetch(input,{...init,method,headers:headers(init?.headers||(input instanceof Request?input.headers:undefined)),body:JSON.stringify({...changed,audioConnectionId:cfg.audioConnectionId})});
      }catch(e){notice(e);return new Response(JSON.stringify({error:e.message}),{status:409,headers:{'Content-Type':'application/json'}});}
    }
    if(method==='POST'&&url.pathname==='/api/translate'&&extensionSettings().enabled!==false){
      const body=JSON.parse(typeof init?.body==='string'?init.body:await input.clone().text());
      if(body&&typeof body.text==='string'){
        if(!translationOutput(body))return baseFetch(input,init);
        const protectedData=protectTranslation(body);
        if(!protectedData.tokens.length)return baseFetch(input,init);
        const response=await baseFetch(input,{...init,method,headers:headers(init?.headers||(input instanceof Request?input.headers:undefined)),body:JSON.stringify(protectedData.body)});
        if(!response.ok)return response;
        const result=await response.clone().json();
        if(typeof result.translatedText==='string'){
          let translated=result.translatedText,previous=-1;
          for(const {token} of protectedData.tokens){const offset=translated.indexOf(token);if(translated.split(token).length!==2||offset<=previous){notice(new Error('번역 모델이 음성 대사 구분자를 변경했습니다. 다시 번역하세요.'));return new Response(JSON.stringify({error:'Translation changed protected dialogue markers; retry translation.'}),{status:422,headers:{'Content-Type':'application/json'}});}previous=offset;}
          for(const {token,value} of protectedData.tokens)translated=translated.replace(token,()=>value);
          return new Response(JSON.stringify({...result,translatedText:translated}),{status:response.status,headers:response.headers});
        }
        return response;
      }
    }
    const response=await baseFetch(input,init);
    if(method==='GET'&&url.pathname==='/api/tts/config'&&response.ok){
      const cfg=await response.clone().json();if(!master.busy&&typeof cfg?.enabled==='boolean')updateMaster(cfg);
      // The native chunker accepts this runtime option; it is not a persisted TTS schema field.
      return new Response(JSON.stringify({...cfg,skipBracketedText:false,preserveEmotionIndicators:true}),{status:response.status,headers:response.headers});
    }
    if(method==='GET'&&/^\/api\/chats\/[^/]+\/messages$/.test(url.pathname)&&response.ok)void response.clone().json().then(remember).catch(()=>{});
    if(['POST','PATCH','PUT'].includes(method)&&/^\/api\/(?:connections|tts\/config)/.test(url.pathname)){providerPromise=null;if(url.pathname==='/api/tts/config'&&response.ok&&!master.busy)void refreshMaster();}
    return response;
  };
  window.fetch=fetchWrapper;
  style.textContent+='.mari-tts-mode-help{margin:6px 0 10px;font:inherit;line-height:1.5}.mari-tts-rp-popover label{display:block;margin-top:10px}.mari-tts-rp-popover select{font:inherit}.mari-tts-config-error{color:var(--destructive,#d77)}[data-mari-tts-source-view]{display:none!important}.mari-tts-rp-toolbar>button{touch-action:none;user-select:none}';
  function presentation(root,m){
    // The viewer owns these disposable display bubbles, not React. Annotate
    // them directly and keep its source -> split-display sibling contract.
    if(root.closest('.mari-convo-viewer-split-display'))return root;
    let state=views.get(root);
    const ownDisplay=state&&root.style.getPropertyValue('display')==='none'&&root.style.getPropertyPriority('display')==='important';
    const display=ownDisplay?state.display:root.style.getPropertyValue('display'),priority=ownDisplay?state.priority:root.style.getPropertyPriority('display');
    const styleKey=Array.from({length:root.style.length},(_,i)=>root.style.item(i)).filter(p=>p!=='display').map(p=>p+':'+root.style.getPropertyValue(p)+'!'+root.style.getPropertyPriority(p)).join(';');
    const signature=[m?.id,m?.content,m?.activeSwipeIndex,root.innerHTML,root.className,styleKey,display,priority].join('\u0000');
    if(state&&state.signature===signature&&state.copy.isConnected)return state.copy;
    if(state)state.copy.remove();
    const copy=root.cloneNode(true);copy.removeAttribute('data-mari-tts-source-view');copy.setAttribute('data-mari-tts-copy','1');
    if(display)copy.style.setProperty('display',display,priority);else copy.style.removeProperty('display');
    // The unchanged viewer explicitly excludes this class from splitting.
    // Guard only our copies; native bubbles must remain eligible for splitting.
    if(root.closest('[data-chat-mode="conversation"]')){
      for(const bubble of [copy,...copy.querySelectorAll('.mari-message-bubble')])if(bubble.matches('.mari-message-bubble'))bubble.classList.add('mari-convo-viewer-split-bubble');
    }
    // Forward ordinary link/image interactions to their untouched native elements.
    const peers=new WeakMap(),originals=[root,...root.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
    clones.forEach((node,i)=>peers.set(node,originals[i]));
    copy.addEventListener('click',event=>{if(event.target.closest('.mari-tts-line-controls'))return;const original=peers.get(event.target);if(original){event.preventDefault();event.stopPropagation();original.click();}});
    root.setAttribute('data-mari-tts-source-view','1');root.style.setProperty('display','none','important');root.after(copy);state={signature,copy,display,priority};views.set(root,state);return copy;
  }
  function releaseView(source,state){
    source.removeAttribute('data-mari-tts-source-view');
    const restore=node=>{if(node.style.getPropertyValue('display')==='none'&&node.style.getPropertyPriority('display')==='important'){if(state.display)node.style.setProperty('display',state.display,state.priority);else node.style.removeProperty('display');}};
    // A viewer loaded after TTS copies the native inline style into its split
    // bubbles. Remove our temporary hiding there as well before handing over.
    if(source.hasAttribute('data-mari-convo-viewer-split-source')&&source.nextElementSibling?.classList.contains('mari-convo-viewer-split-display'))for(const bubble of source.nextElementSibling.children)restore(bubble);
    restore(source);state.copy.remove();views.delete(source);
  }
  function clearViews(){for(const [source,state] of views)releaseView(source,state);}
  function textNodes(root) {
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('button,pre,code,textarea,.mari-tts-cue,.mari-tts-line-controls')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
    const nodes=[];while(w.nextNode())nodes.push(w.currentNode);return nodes;
  }
  function hideCues(root,participants=[],speakerMarkup=false,audioText=false,cueSource='') {
    const nodes=textNodes(root),text=nodes.map(n=>n.nodeValue).join('');
    const sources=[...(speakerMarkup?[C.wrapperPattern,...C.idPatterns(participants.map(p=>p.id))]:[]),C.cuePattern+'[ \t]*'];
    const locate=offset=>{for(const n of nodes){if(offset<=n.nodeValue.length)return [n,offset];offset-=n.nodeValue.length;}return null;};
    const matches=[...text.matchAll(new RegExp(sources.join('|'),'gi'))].map(m=>({start:locate(m.index),end:locate(m.index+m[0].length)}));
    // Quotes in an attribute may be styled in separate DOM nodes. Hide the complete range.
    for(const m of matches.reverse()){
      if(!m.start||!m.end)continue;
      const range=document.createRange();range.setStart(...m.start);range.setEnd(...m.end);
      const span=document.createElement('span');span.className='mari-tts-cue';span.append(range.extractContents());range.insertNode(span);hidden.add(span);
    }
  }
  function mountLine(root,m,line) {
    const marker=m.id+':'+(m.activeSwipeIndex||0)+':'+line.index+':'+C.hash(m.content);
    if([...root.querySelectorAll('.mari-tts-line-controls')].some(e=>e.dataset.lineKey===marker))return;
    const nodes=textNodes(root), points=[];let text='';
    // Map normalized visible text back to DOM positions; HTML/Markdown split text and spaces.
    for(const node of nodes)for(let i=0;i<node.nodeValue.length;i++){
      const ch=node.nodeValue[i];
      if(/\s/.test(ch)&&text.endsWith(' ')){points[points.length-1]=[node,i+1];continue;}
      text+=/\s/.test(ch)?' ':ch;points.push([node,i+1]);
    }
    const visible=s=>C.display(s).replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
    const wanted=visible(line.raw);
    // Count repeated identical dialogue lines without reading hidden audio cues.
    const preceding=dialogueLines(m).slice(0,line.index).filter(l=>visible(l.raw)===wanted).length;
    let start=-1,from=0;for(let i=0;i<=preceding;i++){start=text.indexOf(wanted,from);if(start<0)break;from=start+wanted.length;}
    let end=start<0?-1:start+wanted.length;
    // Translation changes the words; pair quoted dialogue by order only when counts agree.
    const quotes=quoted(text),source=dialogueLines(m);
    const sourceQuotes=quoted(m.content);
    const qIndex=sourceQuotes.findIndex(q=>q.start>=line.start&&q.end<=line.end);
    const ordinal=qIndex>=0?qIndex:line.index;
    const containing=end<0?null:quotes.find(q=>start>=q.start&&end<=q.end);
    if(containing)end=containing.end;
    else if(end<0&&quotes.length===(sourceQuotes.length||source.length)&&quotes[ordinal])end=quotes[ordinal].end;
    const point=end>0?points[end-1]:null;
    // Never append source-language dialogue into a translation-only view.
    if(!point)return;
    const controls=document.createElement('span');controls.className='mari-tts-line-controls';controls.dataset.lineKey=marker;
    const generate=document.createElement('button'),replay=document.createElement('button'),stop=document.createElement('button');
    generate.type=replay.type=stop.type='button';generate.textContent='＋';replay.textContent='▷';stop.textContent='□';replay.disabled=stop.disabled=true;
    const speakerName=participantsFor(m).find(p=>p.kind===line.kind&&p.id===line.id)?.name||line.id;
    generate.setAttribute('aria-label',speakerName+' 대사 '+(line.index+1)+' 음성 생성 또는 재생성');
    replay.setAttribute('aria-label',speakerName+' 대사 '+(line.index+1)+' 저장 음성 재생');
    stop.setAttribute('aria-label',speakerName+' 대사 '+(line.index+1)+' 재생 정지');
    generate.title='이 대사 음성 생성';replay.title='저장 음성 재생';stop.title='재생 정지';
    controls.append(generate,replay,stop);
    {
      const range=document.createRange();range.setStart(...point);range.collapse(true);
      // Put controls outside the closing quote and its bold/italic formatting element.
      let anchor=point[0];
      const trailingInvisible=n=>{for(let s=n.nextSibling;s;s=s.nextSibling){if(s.nodeType===3&&!s.textContent.trim())continue;if(s.nodeType===1&&s.matches('.mari-tts-cue'))continue;return false;}return true;};
      if(point[1]===point[0].nodeValue.length)while(anchor.parentElement&&anchor.parentElement!==root&&/^(STRONG|B|EM|I|SPAN)$/.test(anchor.parentElement.tagName)&&trailingInvisible(anchor))anchor=anchor.parentElement;
      if(anchor!==point[0])range.setStartAfter(anchor);
      range.insertNode(controls);
    }
    mounted.set(controls,{m,line});
    let savedKey=null,busy=false,playing=false,errorNode;
    const syncStop=()=>{stop.disabled=!savedKey||(T.getPlaybackKey?T.getPlaybackKey()!==savedKey:!playing);};
    const lineError=e=>{if(!errorNode){errorNode=document.createElement('span');errorNode.className='mari-tts-line-error';controls.append(errorNode);}errorNode.textContent=e?.message||String(e);};
    const valid=()=>!stopped&&controls.isConnected&&(reactMessage(root.closest('[data-message-id]'))?.content||messages.get(m.id)?.content||m.content)===m.content;
    const resolve=async(force=false)=>{
      const [ctx,cfg]=await Promise.all([context(m.chatId,force),provider(force)]);
      const value=messages.get(m.id)?.extra||m.extra;
      const extra=typeof value==='string'?JSON.parse(value||'{}'):(value||{});
      const snapshot=personaSnapshots.get(m.id+':'+(m.activeSwipeIndex||0))||extra.ttsDialoguePersona;
      const participants=snapshot?[...ctx.participants.filter(p=>p.kind!=='persona'),snapshot]:ctx.participants;
      const assigned=(cfg.voiceAssignments||[]).find(r=>r.characterId===m.characterId);
      const v=line.native?(cfg.voiceMode==='per-character'?(assigned?.voice||cfg.voice):cfg.voice):C.voice(line,cfg,extensionSettings(),participants);
      if(!v)throw new Error('메시지 화자의 ElevenLabs 보이스를 ME TTS 설정에서 지정하세요.');return {cfg,voice:v,key:C.key(m,line,v,cfg)};
    };
    async function refresh(){try{const r=await resolve();if(!valid())return;const clip=await T.getClip(r.key);if(clip?.blobs?.length){savedKey=r.key;generate.textContent='↻';generate.title='이 대사 음성 재생성';replay.disabled=false;}}catch(e){generate.title=e.message;lineError(e);}}
    generate.onclick=async event=>{
      event.preventDefault();event.stopPropagation();if(busy||!valid())return;
      busy=true;generate.disabled=true;generate.textContent='…';if(errorNode)errorNode.textContent='';
      try {
        const r=await resolve(true);const previous=await T.getClip(r.key);
        if(previous?.blobs?.length&&!window.confirm('이 대사만 재생성합니다. ElevenLabs 사용량이 발생합니다.'))return;
        const clip=await T.generateClip(r.key,line.raw,{voice:r.voice,exact:true,kind:'dialogue',isCurrent:valid});
        if(!valid())return;savedKey=r.key;replay.disabled=false;playing=true;stop.disabled=false;const playback=T.playBlobs(clip.blobs,r.key);syncStop();await playback;
      }catch(e){notice(e);generate.title=e.message;lineError(e);}finally{playing=false;syncStop();busy=false;generate.disabled=false;generate.textContent=savedKey?'↻':'＋';generate.title=savedKey?'이 대사 음성 재생성':'이 대사 음성 생성';}
    };
    replay.onclick=async event=>{
      event.preventDefault();event.stopPropagation();if(!valid()||!savedKey)return;
      try{const r=await resolve(true);if(r.key!==savedKey)throw new Error('화자/음성 설정이 바뀌었습니다. 새 음성을 생성하세요.');const clip=await T.getClip(savedKey);if(!clip?.blobs?.length)throw new Error('저장 음성이 없습니다.');playing=true;stop.disabled=false;const playback=T.playBlobs(clip.blobs,savedKey);syncStop();await playback;}catch(e){notice(e);lineError(e);}finally{playing=false;syncStop();}
    };
    stop.onclick=event=>{event.preventDefault();event.stopPropagation();if((T.getPlaybackKey&&T.getPlaybackKey()===savedKey)||(!T.getPlaybackKey&&playing)){T.stopAudio();playing=false;syncStop();}};
    controls.syncPlayback=syncStop;
    if(line.kind==='persona'){
      const adjust=document.createElement('button');adjust.type='button';adjust.textContent='⋮';adjust.title='이 Persona의 연결 보이스';adjust.setAttribute('aria-label',speakerName+' Persona 보이스 설정');
      adjust.onclick=event=>{event.preventDefault();event.stopPropagation();let editor=controls.querySelector('.mari-tts-voice-editor');if(editor){editor.remove();return;}editor=document.createElement('span');editor.className='mari-tts-voice-editor';const input=document.createElement('input'),save=document.createElement('button');input.type='text';input.placeholder='Persona 보이스 ID';input.setAttribute('aria-label',speakerName+' Persona 보이스 ID');input.value=extensionSettings().personaVoiceAssignments?.find(p=>p.personaId===line.id)?.voice||'';save.type='button';save.textContent='✓';save.title='Persona 연결 보이스 저장';save.onclick=event=>{event.preventDefault();event.stopPropagation();const override=globalThis.__marinaraElevenlabsOverride;if(override?.setPersonaVoice)override.setPersonaVoice(line.id,input.value,speakerName);else{const settings=extensionSettings();settings.personaVoiceAssignments=(settings.personaVoiceAssignments||[]).filter(p=>p.personaId!==line.id);settings.personaVoiceAssignments.push({personaId:line.id,personaName:speakerName,voice:input.value.trim()});localStorage.setItem(settingsKey,JSON.stringify(settings));}editor.remove();if(errorNode)errorNode.textContent='';savedKey=null;replay.disabled=true;generate.textContent='＋';void refresh();};editor.append(input,save);controls.append(editor);};
      controls.append(adjust);
    }
    void refresh();
  }
  function scan() {
    scheduled=false;if(stopped)return;
    if(!C.supportedMode(T.getMode())){restoreDom();document.querySelectorAll('.mari-tts-rp-toolbar,#mari-tts-room-panel').forEach(e=>e.remove());return;}
    const isEnabled=enabled();
    const room=activeChatId();if(room!==uiRoom){uiRoom=room;if(T.getPlaybackKey?.()?.startsWith('dialogue-'))T.stopAudio();restoreDom();closeRoomPanel();}
    if(isEnabled!==lastEnabled){lastEnabled=isEnabled;if(!isEnabled)restoreDom();else void filters().catch(notice);}
    for(const [source,state] of views)if(!source.isConnected)releaseView(source,state);
    mountToolbar();
    if(extensionSettings().enabled===false){paintPanel();return;}
    for(const [el] of mounted)if(!el.isConnected)mounted.delete(el);
    for(const el of hidden)if(!el.isConnected)hidden.delete(el);
    for(const el of fallbackRows)if(!el.isConnected)fallbackRows.delete(el);
    for(const el of document.querySelectorAll('[data-message-id][data-message-role]')) {
      if(el.dataset.messageRole!=='assistant')continue;
      const m=reactMessage(el)||messages.get(T.getCanonicalMessageId(el));
      if(m?.role&&m.role!=='assistant')continue;
      if(m?.id&&typeof m.content==='string'){
        messages.set(m.id,m);
        if(m.chatId&&!contexts.has(m.chatId)&&!contextRequests.has(m.chatId)&&Date.now()>(contextRetryAt.get(m.chatId)||0))void context(m.chatId).then(ctx=>{void filters(ctx.allCharacterIds,ctx.allSpeakerIds).catch(notice);queueScan();}).catch(e=>{contextRetryAt.set(m.chatId,Date.now()+30000);notice(e);});
      }
      for(const controls of el.querySelectorAll('.mari-tts-line-controls')) {
        const old=mounted.get(controls);if(old&&m&&old.m.content!==m.content){controls.closest('.mari-tts-fallback-row')?.remove();controls.remove();mounted.delete(controls);}
      }
      const convo=T.getMode()==='conversation';
      const rootSelector=convo?'.mari-message-bubble,.mari-message-content,.translation-text':'.mari-message-content,.translation-text';
      // The viewer observes child lists but retains an existing split display
      // when React updates the native text. Invalidate only that disposable
      // sibling so its own observer rebuilds it from the latest native source.
      if(convo)for(const source of el.querySelectorAll('[data-mari-convo-viewer-split-source]')){
        if(source.closest('[data-mari-tts-copy]'))continue;
        const display=source.nextElementSibling;if(!display?.classList.contains('mari-convo-viewer-split-display'))continue;
        const text=source.innerHTML,old=viewerSources.get(source);
        if(old?.display===display&&old.text!==text){display.remove();source.removeAttribute('data-mari-convo-viewer-split-source');viewerSources.delete(source);}
        else viewerSources.set(source,{display,text});
      }
      // Once the viewer splits a source, discard its old TTS presentation. Never
      // clone the hidden source or its generated sibling as another whole view.
      for(const [source,state] of views)if(source.closest('[data-mari-convo-viewer-split-source]')||source.querySelector('.mari-convo-viewer-split-display'))releaseView(source,state);
      const roots=[...el.querySelectorAll(rootSelector)].filter(root=>!root.closest('[data-mari-tts-copy]')&&!root.closest('[data-mari-convo-viewer-split-source]')&&!root.querySelector('.mari-convo-viewer-split-display')&&!root.parentElement.closest(rootSelector));
      const rp=(contexts.get(m?.chatId)?.chat.mode||T.getMode())==='roleplay';
      for(const sourceRoot of roots){const root=presentation(sourceRoot,m);hideCues(root,m?participantsFor(m):[],rp,T.getMode()==='conversation',rp?dialogueLines(m||{content:''}).map(l=>l.raw).join('\n'):'');if(isEnabled&&rp&&m&&m.role!=='user'&&!el.querySelector('textarea,.mari-message-typing,[class*="after:animate-pulse"],.animate-pulse'))for(const line of dialogueLines(m))mountLine(root,m,line);}
      if(rp)el.querySelectorAll('.mari-ext-tts-header-replay,.mari-ext-tts-inline-replay-slot').forEach(e=>e.remove());
    }
    for(const el of mounted.keys())el.syncPlayback?.();
    // Hide cue text after render; do not change Game React segment.content or its regex settings.
    if(T.getMode()==='game')for(const root of document.querySelectorAll('.game-narration-prose,[data-log-anchor-key],[class*="group/logseg"],[data-tour="game-dialogue"] .animate-party-slide-in'))hideCues(root,[],false,false,T.resolveGameSegment?.(root)?.text||'');
    paintPanel();
  }
  function queueScan(){if(scheduled||stopped)return;scheduled=true;requestAnimationFrame(scan);}
  function setRpMode(value){if(!saveRoom({rpMode:value==='native'?'native':'tagged'}))return;if(T.getPlaybackKey?.()?.startsWith('dialogue-'))T.stopAudio();restoreDom();queueScan();paintPanel();}
  function setRoomControls(value){if(saveRoom({enabled:value==='enabled'})){restoreDom();queueScan();paintPanel();}}
  style.textContent+=".mari-tts-room-launcher{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid var(--border,#383946);border-radius:11px;background:var(--popover,#20212b);color:var(--popover-foreground,#e9e9f1);box-shadow:0 3px 12px #0002;cursor:pointer;touch-action:none}\n.mari-tts-room-launcher svg{width:17px;height:17px}\n#mari-tts-room-panel{--tts-accent:#a79afa;--tts-ink:var(--foreground,#eeeef5);--tts-muted:var(--muted-foreground,#a6a6b9);position:fixed;z-index:2147483000;box-sizing:border-box;max-width:calc(100vw - 24px);margin:0;padding:0;border:1px solid var(--border,#3c3c4b);border-radius:20px;background:var(--popover,#1d1e27);color:var(--popover-foreground,#eeeef5);box-shadow:0 20px 70px #0005;overflow:auto;overscroll-behavior:contain;font:13px/1.5 system-ui,sans-serif;isolation:isolate}\n#mari-tts-room-panel[hidden]{display:none!important}\n#mari-tts-room-panel *{box-sizing:border-box}\n#mari-tts-room-panel .mari-tts-room-head{display:flex;align-items:center;justify-content:space-between;padding:22px 22px 15px;gap:12px}\n#mari-tts-room-panel .mari-tts-eyebrow{display:block;font-size:9px;letter-spacing:1.8px;color:var(--tts-accent);font-weight:700}\n#mari-tts-room-panel h2{font-size:19px;letter-spacing:-.6px;line-height:1.3;font-weight:700;margin:5px 0 0;color:var(--tts-ink)}\n#mari-tts-room-panel button{font:inherit;cursor:pointer}\n#mari-tts-room-panel .mari-tts-room-close{display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid var(--border,#3c3c4b);border-radius:10px;background:transparent;color:var(--tts-muted);font-size:23px;line-height:1}\n#mari-tts-room-panel .mari-tts-room-close:hover{background:color-mix(in srgb,var(--tts-accent) 12%,transparent);color:var(--tts-ink)}\n#mari-tts-room-panel .mari-tts-room-body{padding:0 22px 18px}\n#mari-tts-room-panel fieldset{border:0;margin:0;padding:0;min-width:0}\n#mari-tts-room-panel legend{font-size:11px;font-weight:600;color:var(--tts-muted);margin:0 0 9px;padding:0}\n#mari-tts-room-panel .mari-tts-mode-card{display:flex;position:relative;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;margin:0 0 8px;border:1px solid var(--border,#393946);border-radius:13px;cursor:pointer;background:color-mix(in srgb,var(--tts-ink) 3%,transparent);transition:border-color .15s,background .15s}\n#mari-tts-room-panel .mari-tts-mode-card:has(input:checked){border-color:var(--tts-accent);background:color-mix(in srgb,var(--tts-accent) 10%,transparent)}\n#mari-tts-room-panel .mari-tts-mode-card input{position:absolute;opacity:0;width:1px;height:1px;margin:0}\n#mari-tts-room-panel strong{display:block;color:var(--tts-ink);font-size:13px;font-weight:600}\n#mari-tts-room-panel small{display:block;font-size:11px;color:var(--tts-muted);line-height:1.6;margin-top:3px;word-break:keep-all}\n#mari-tts-room-panel .mari-tts-mode-card i{width:16px;height:16px;border:1px solid var(--border,#606071);border-radius:50%;flex-shrink:0}\n#mari-tts-room-panel .mari-tts-mode-card:has(input:checked) i{border:5px solid var(--tts-accent);background:var(--popover,#1d1e27)}\n#mari-tts-room-panel .mari-tts-switch-row{display:flex;align-items:center;gap:12px;position:relative;margin:17px 0 0;padding-top:17px;border-top:1px solid var(--border,#383845);cursor:pointer}\n#mari-tts-room-panel .mari-tts-switch-row>span:first-child{flex:1}\n#mari-tts-room-panel .mari-tts-switch-row input{position:absolute;opacity:0;width:1px;height:1px;margin:0;right:0}\n#mari-tts-room-panel .mari-tts-switch{display:block;width:36px;height:21px;border-radius:20px;background:var(--muted,#484854);padding:3px;flex-shrink:0;transition:background .15s}\n#mari-tts-room-panel .mari-tts-switch:before{content:'';display:block;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:transform .15s}\n#mari-tts-room-panel .mari-tts-switch-row:has(input:checked) .mari-tts-switch{background:var(--tts-accent)}\n#mari-tts-room-panel .mari-tts-switch-row:has(input:checked) .mari-tts-switch:before{transform:translateX(15px)}\n#mari-tts-room-panel .mari-tts-mode-card:has(input:focus-visible),#mari-tts-room-panel .mari-tts-switch-row:has(input:focus-visible),#mari-tts-room-panel button:focus-visible{outline:2px solid var(--tts-accent);outline-offset:3px}\n#mari-tts-room-panel .mari-tts-room-note{font-size:11px;line-height:1.7;color:var(--tts-muted);margin:13px 0 0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--tts-ink) 4%,transparent)}\n#mari-tts-room-panel .mari-tts-room-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:13px 22px;border-top:1px solid var(--border,#383845)}\n#mari-tts-room-panel .mari-tts-injection-status{font-size:10px;color:var(--tts-muted)}\n#mari-tts-room-panel .mari-tts-injection-status:before{content:'';display:inline-block;width:5px;height:5px;background:var(--tts-muted);border-radius:50%;margin-right:6px;vertical-align:middle}\n#mari-tts-room-panel .mari-tts-injection-status[data-active=true]:before{background:#71ceae}\n#mari-tts-room-panel .mari-tts-rp-reset{font-size:10px;border:0;background:transparent;color:var(--tts-muted);padding:4px 0}\n#mari-tts-room-panel .mari-tts-rp-reset:hover{color:var(--tts-accent)}\n#mari-tts-room-panel .mari-tts-config-error{font-size:11px;margin:10px 0 0;overflow-wrap:anywhere}\n@media(prefers-reduced-motion:reduce){#mari-tts-room-panel *{transition:none!important}}\n";
  style.textContent+="#mari-tts-room-panel .mari-tts-master-row{border-top:0;margin:0 0 18px;padding:12px;border:1px solid var(--border,#383845);border-radius:12px;background:color-mix(in srgb,var(--tts-accent) 6%,transparent)}\n#mari-tts-room-panel .mari-tts-scope-tag{font-family:inherit;font-style:normal;font-weight:500;font-size:9px;line-height:1.5;color:var(--tts-muted);padding:2px 5px;border:1px solid var(--border,#454553);border-radius:5px;display:inline-block;vertical-align:middle;margin-left:5px}\n#mari-tts-room-panel .mari-tts-master-row:has(input:disabled){cursor:wait;opacity:.7}\n#mari-tts-room-panel .mari-tts-master-refresh{margin:0 0 14px;padding:5px 10px;background:transparent;color:var(--tts-muted);border:1px solid var(--border,#383845);border-radius:8px;font-size:11px}\n#mari-tts-room-panel .mari-tts-master-refresh[hidden],#mari-tts-room-panel .mari-tts-rp-options[hidden]{display:none!important}";
  function validConfig(cfg){if(!cfg||typeof cfg.enabled!=='boolean')throw new Error('TTS 설정 상태를 확인하지 못했습니다.');return cfg;}
  function updateMaster(cfg){master.enabled=validConfig(cfg).enabled;if(instructionState)instructionState={...instructionState,enabled:master.enabled};paintPanel();}
  function findQueryClient(){
    if(master.client)return master.client;
    const stack=[],seen=new Set();
    for(const el of [document.getElementById('root'),...document.body.children].filter(Boolean))for(const key of Object.keys(el))if(/^__react(Container|Fiber)\$/.test(key))stack.push(el[key]);
    while(stack.length&&seen.size<16000){
      const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);
      const candidates=[f.memoizedProps?.client,f.memoizedProps?.value];let dep=f.dependencies?.firstContext;
      for(let n=0;dep&&n<30;n++,dep=dep.next)candidates.push(dep.memoizedValue);
      const client=candidates.find(c=>c&&typeof c.getQueryData==='function'&&typeof c.setQueryData==='function'&&typeof c.getQueryCache==='function');
      if(client){master.client=client;master.unsubscribe=client.getQueryCache().subscribe(()=>{const cfg=client.getQueryData(['tts','config']);if(!stopped&&!master.busy&&typeof cfg?.enabled==='boolean')updateMaster(cfg);});return client;}
      stack.push(f.child,f.sibling,f.return,f.current,f.stateNode?.current);
    }
    return null;
  }
  async function refreshMaster(){
    if(stopped||master.busy)return;if(master.refresh)return master.refresh;
    master.refresh=(async()=>{try{const cfg=validConfig(await api('/tts/config'));if(!stopped&&!master.busy){statusError='';updateMaster(cfg);findQueryClient();}}catch(e){if(!stopped&&!master.busy){master.enabled=null;notice(e);}}finally{master.refresh=null;paintPanel();}})();
    return master.refresh;
  }
  async function setMasterTts(value){
    if(stopped||master.busy)return;clearTimeout(master.reloadTimer);master.reloadTimer=null;master.busy=true;statusError='';paintPanel();let saved=false;
    try{
      if(master.refresh)await master.refresh;
      const cfg=validConfig(await api('/tts/config'));
      const next={...cfg,enabled:!!value};
      // These flags are runtime-only; keep all persisted voice/profile fields.
      delete next.preserveEmotionIndicators;
      const client=findQueryClient();
      if(cfg.enabled!==next.enabled){await api('/tts/config','PUT',next);saved=true;}
      if(stopped)return;
      const confirmed=validConfig(await api('/tts/config'));if(stopped)return;
      providerPromise=null;updateMaster(confirmed);
      if(!confirmed.enabled)T.stopAudio();
      if(client){await client.cancelQueries?.({queryKey:['tts','config'],exact:true});if(stopped)return;client.setQueryData(['tts','config'],{...confirmed,skipBracketedText:false,preserveEmotionIndicators:true});}
      if(confirmed.enabled!==!!value)throw new Error('TTS 상태가 요청과 다릅니다. 현재 상태를 다시 확인하세요.');
      if(!client&&saved){statusError='TTS 설정 적용 · 화면을 새로고침합니다.';master.reloadTimer=setTimeout(()=>{if(!stopped)window.location.reload();},700);}
    }catch(e){if(!stopped){master.enabled=null;if(saved)void master.client?.invalidateQueries?.({queryKey:['tts','config'],exact:true});notice(new Error((saved?'설정 저장 후 상태 확인 실패: ':'TTS 변경 실패: ')+e.message));}}
    finally{master.busy=false;paintPanel();}
  }
  const refreshOpenMaster=()=>{const panel=document.getElementById('mari-tts-room-panel');if(panel&&!panel.hidden)void refreshMaster();};
  window.addEventListener('focus',refreshOpenMaster);
  function setStyle(node, values){for(const [key,value] of Object.entries(values))if(node.style[key]!==value)node.style[key]=value;}
  function closeRoomPanel(){const panel=document.getElementById('mari-tts-room-panel');if(panel)panel.hidden=true;const icon=document.querySelector('.mari-tts-rp-toolbar>button');if(icon)icon.setAttribute('aria-expanded','false');}
  function positionRoomPanel(){
    const panel=document.getElementById('mari-tts-room-panel');if(!panel||panel.hidden)return;
    const bar=document.querySelector('.mari-tts-rp-toolbar');
    const rect=bar?.getBoundingClientRect();
    const viewport=window.visualViewport;
    const width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
    const vx=viewport?.offsetLeft||0,vy=viewport?.offsetTop||0;
    const pw=Math.min(336,width-24);setStyle(panel,{width:pw+'px',maxHeight:Math.max(100,height-24)+'px'});
    const ph=Math.min(panel.offsetHeight,height-24);
    // Drawer hides the launcher; center the independently mounted panel then.
    const visible=!!rect?.width&&!!rect?.height;
    const left=visible?Math.max(vx+12,Math.min(rect.right-pw,vx+width-pw-12)):vx+(width-pw)/2;
    const top=visible?Math.max(vy+12,Math.min(rect.bottom+10,vy+height-ph-12)):vy+Math.max(12,(height-ph)/2);
    setStyle(panel,{left:Math.round(left)+'px',top:Math.round(top)+'px'});
  }
  function mountToolbar(){
    const surface=document.querySelector('[data-component="ChatArea.Roleplay"],[data-chat-mode="roleplay"]');
    const settings=document.querySelector('[data-chat-settings-button]');
    if(!C.supportedMode(T.getMode())){closeRoomPanel();document.querySelectorAll('.mari-tts-rp-toolbar,#mari-tts-room-panel').forEach(e=>e.remove());return;}
    let bar=document.querySelector('.mari-tts-rp-toolbar');
    if(!bar){
      bar=document.createElement('span');bar.className='mari-tts-rp-toolbar mari-tts-rp-corner';
      const icon=document.createElement('button');icon.type='button';icon.className='mari-tts-room-launcher';icon.title='음성 설정 · 드래그로 이동';icon.setAttribute('aria-label','음성 설정');icon.setAttribute('aria-expanded','false');icon.setAttribute('aria-controls','mari-tts-room-panel');
      icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4"/></svg>';
      const panel=document.createElement('section');panel.id='mari-tts-room-panel';panel.className='mari-tts-rp-popover';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','음성 설정');
      panel.innerHTML=`<header class="mari-tts-room-head"><div><span class="mari-tts-eyebrow">VOICE CONTROL</span><h2>음성 설정</h2></div><button type="button" class="mari-tts-room-close" aria-label="닫기">×</button></header>
        <div class="mari-tts-room-body"><label class="mari-tts-switch-row mari-tts-master-row"><span><strong>TTS 연결 <em class="mari-tts-scope-tag">전체 방</em></strong><small class="mari-tts-master-status" aria-live="polite">상태 확인 중</small></span><input class="mari-tts-master-enable" aria-label="TTS 연결" type="checkbox" role="switch" disabled><span class="mari-tts-switch" aria-hidden="true"></span></label><button type="button" class="mari-tts-master-refresh" hidden>상태 다시 확인</button><div class="mari-tts-rp-options"><fieldset class="mari-tts-mode-group"><legend>화자 구분</legend>
          <label class="mari-tts-mode-card"><input type="radio" name="mari-tts-room-mode" value="tagged"><span><strong>캐릭터 + 페르소나</strong><small>대사 태그로 화자를 구분해 각 보이스로 읽어요.</small></span><i aria-hidden="true"></i></label>
          <label class="mari-tts-mode-card"><input type="radio" name="mari-tts-room-mode" value="native"><span><strong>메시지 화자</strong><small>한 메시지의 대사를 같은 보이스로 읽어요.</small></span><i aria-hidden="true"></i></label></fieldset>
          <label class="mari-tts-switch-row"><span><strong>대사별 음성 버튼</strong><small>생성 · 재생 · 정지 버튼 표시</small></span><input class="mari-tts-rp-enable" type="checkbox" role="switch"><span class="mari-tts-switch" aria-hidden="true"></span></label>
          <p class="mari-tts-room-note">버튼을 숨겨도 감정 태그 숨김과 음성 지침은 유지돼요.</p></div>
          <p class="mari-tts-config-error" aria-live="polite" hidden></p></div>
        <footer class="mari-tts-room-foot"><span class="mari-tts-injection-status" role="status">다음 응답부터 적용</span><button type="button" class="mari-tts-rp-reset">위치 초기화</button></footer>`;
      panel.querySelector('.mari-tts-room-close').onclick=()=>{closeRoomPanel();if(icon.getClientRects().length)icon.focus();};
      icon.onclick=()=>{panel.hidden=!panel.hidden;icon.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){void refreshMaster();paintPanel();positionRoomPanel();panel.querySelector('.mari-tts-room-close').focus({preventScroll:true});}};
      for(const input of panel.querySelectorAll('[name="mari-tts-room-mode"]'))input.onchange=()=>{if(input.checked)setRpMode(input.value);};
      panel.querySelector('.mari-tts-master-enable').onchange=e=>{void setMasterTts(e.target.checked);};
      panel.querySelector('.mari-tts-master-refresh').onclick=()=>{void refreshMaster();};
      panel.querySelector('.mari-tts-rp-enable').onchange=e=>setRoomControls(e.target.checked?'enabled':'disabled');
      panel.querySelector('.mari-tts-rp-reset').onclick=()=>{saveRoom({position:null});queueScan();};
      panel.onkeydown=e=>{if(e.key==='Escape'){closeRoomPanel();if(icon.getClientRects().length)icon.focus();}};
      let drag=null,suppressClick=false;
      const click=icon.onclick;icon.onclick=event=>{if(suppressClick){suppressClick=false;return;}click(event);};
      icon.onpointerdown=event=>{
        // Drawer forwards synthetic pointerdown to its hidden source button.
        // That is activation, not a drag of the real launcher.
        if(!event.isTrusted||event.button!==0||!activeChatId())return;
        const rect=bar.getBoundingClientRect();drag={id:event.pointerId,room:activeChatId(),x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};icon.setPointerCapture?.(event.pointerId);
      };
      icon.onpointermove=event=>{if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;if(!drag.moved)return;event.preventDefault();bar.dataset.dragging='1';setStyle(bar,{left:Math.max(8,Math.min(drag.left+dx,window.innerWidth-40))+'px',top:Math.max(8,Math.min(drag.top+dy,window.innerHeight-40))+'px'});positionRoomPanel();};
      const finish=event=>{if(!drag||drag.id!==event.pointerId)return;if(drag.moved){saveRoom({position:{x:parseFloat(bar.style.left)/Math.max(1,window.innerWidth-32),y:parseFloat(bar.style.top)/Math.max(1,window.innerHeight-32)}},drag.room);suppressClick=true;}if(icon.hasPointerCapture?.(event.pointerId))icon.releasePointerCapture(event.pointerId);drag=null;delete bar.dataset.dragging;queueScan();};
      icon.onpointerup=finish;icon.onpointercancel=finish;bar.append(icon);
      // The drawer owns launcher visibility. The dialog is a separate portal,
      // excluded from drawer collection by its dialog role.
      document.body.append(bar,panel);
    }
    const rect=settings?.getBoundingClientRect(),bounds=surface?.getBoundingClientRect(),position=roomSettings().position;
    const top=position?position.y*(window.innerHeight-32):(rect?.height?rect.top:(bounds?.height?bounds.top+8:8));
    const left=position?position.x*(window.innerWidth-32):(rect?.width?rect.left-38:(bounds?.width?bounds.right-76:window.innerWidth-76));
    // Never write display: the drawer hides this root with display:none!important.
    if(!bar.dataset.dragging)setStyle(bar,{position:'fixed',top:Math.max(8,Math.min(top,window.innerHeight-42))+'px',left:Math.max(8,Math.min(left,window.innerWidth-42))+'px',right:'auto',zIndex:'75',width:'32px',height:'32px',pointerEvents:'auto'});
    const panel=document.getElementById('mari-tts-room-panel');
    panel.querySelector('.mari-tts-rp-options').hidden=T.getMode()!=='roleplay';
    for(const input of panel.querySelectorAll('[name="mari-tts-room-mode"]'))input.checked=input.value===roomSettings().rpMode;
    panel.querySelector('.mari-tts-rp-enable').checked=!!roomSettings().enabled;
    positionRoomPanel();
  }
  const dismissPopover=event=>{const bar=document.querySelector('.mari-tts-rp-toolbar'),panel=document.getElementById('mari-tts-room-panel');if(!bar?.contains(event.target)&&!panel?.contains(event.target))closeRoomPanel();};
  document.addEventListener('pointerdown',dismissPopover);
  window.addEventListener('resize',queueScan);
  window.visualViewport?.addEventListener('resize',positionRoomPanel);
  window.visualViewport?.addEventListener('scroll',positionRoomPanel);
  const syncRoomStorage=event=>{if(event.key!==ROOM_LS)return;try{roomOptions=JSON.parse(event.newValue||'{}');}catch{return;}restoreDom();queueScan();paintPanel();};
  window.addEventListener('storage',syncRoomStorage);
  function paintPanel() {
    document.querySelectorAll('.mari-tts-upgrade-panel').forEach(e=>e.remove());
    const input=document.querySelector('.mari-tts-master-enable');if(input){input.checked=master.enabled===true;input.disabled=master.busy||master.enabled===null;input.setAttribute('aria-busy',String(master.busy));const label=document.querySelector('.mari-tts-master-status');const text=master.busy?'적용 중…':master.enabled===null?'상태를 확인하세요':master.enabled?'켜짐 · 자동·수동 음성 생성':'꺼짐 · 음성 생성 중지';if(label.textContent!==text)label.textContent=text;document.querySelector('.mari-tts-master-refresh').hidden=master.enabled!==null||master.busy;}
    const badge=document.querySelector('.mari-tts-injection-status');if(badge){const label=instructionState?.chatId===activeChatId()?(instructionState.enabled?'음성 지침 적용됨':'ME TTS 꺼짐'):'다음 응답부터 적용';if(badge.textContent!==label)badge.textContent=label;badge.dataset.active=String(instructionState?.chatId===activeChatId()&&!!instructionState.enabled);}
    const error=document.querySelector('.mari-tts-config-error');if(error){if(error.textContent!==statusError)error.textContent=statusError;error.hidden=!statusError;}
  }
  function restoreDom(){for(const e of mounted.keys())e.remove();mounted.clear();for(const e of fallbackRows)e.remove();fallbackRows.clear();for(const e of hidden)if(e.isConnected)e.replaceWith(...e.childNodes);hidden.clear();clearViews();}
  const observer=new MutationObserver(queueScan);observer.observe(document.body,{childList:true,characterData:true,attributes:true,attributeFilter:['data-message-id','data-chat-mode'],subtree:true});
  const timer=setInterval(queueScan,2500);
  function dispose(options={}){if(stopped)return;stopped=true;clearTimeout(master.reloadTimer);master.unsubscribe?.();window.removeEventListener('focus',refreshOpenMaster);observer.disconnect();clearInterval(timer);document.removeEventListener('pointerdown',dismissPopover);window.removeEventListener('resize',queueScan);window.visualViewport?.removeEventListener('resize',positionRoomPanel);window.visualViewport?.removeEventListener('scroll',positionRoomPanel);window.removeEventListener('storage',syncRoomStorage);if(window.fetch===fetchWrapper)window.fetch=baseFetch;restoreDom();style.remove();document.querySelectorAll('.mari-tts-upgrade-panel,.mari-tts-rp-toolbar,#mari-tts-room-panel').forEach(e=>e.remove());if(!options.keepRules)void removeFilters().catch(e=>console.warn('[TTS 4.1] 필터 정리 실패',e));}
  globalThis.__marinaraDialogueUpgrade={dispose,parse:C.parse,prepareGeneration,restoreSpeech};
  // Display-only filtering has no persisted cross-mode regex rules.
  if(typeof marinara!=='undefined')marinara.onCleanup(()=>dispose({keepRules:true}));
  if(extensionSettings().enabled!==false)void filters().catch(notice);
  queueScan();
})();
