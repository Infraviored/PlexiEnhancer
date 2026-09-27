(() => {
  const CLEAN_BUTTON_LABEL = 'Copy without Citations';
  const STRIP_MD_BUTTON_LABEL = 'Copy without citations and Markdown';
  const FORMATTED_BUTTON_LABEL = 'Copy formatted without citations';

  const CONFIG = {
    DEBUG: false,
    NATIVE_COPY_WAIT: 60,
    TEMP_STATUS_DURATION: 1200,
    DEBOUNCE_DELAY: 250,
    AUTO_SELECT_COOLDOWN: 5000,
    AUTO_ACTION_WINDOW: 60000,
    AUTO_ACTION_MAX: 3,
    MENU_RENDER_TIMEOUT: 1500,
    SELECTION_WAIT: 200,
    THINKING_TOGGLE_WAIT: 50,
    SCRAPE_MENU_WAIT: 200,
  };

  const console = {
    log: (...args) => { if (CONFIG.DEBUG) globalThis.console.log(...args); },
    warn: (...args) => { if (CONFIG.DEBUG) globalThis.console.warn(...args); },
    error: (...args) => { if (CONFIG.DEBUG) globalThis.console.error(...args); }
  };

  const BUTTON_CLASSNAMES = [
    'focus-visible:bg-subtle',
    'hover:bg-subtle',
    'text-quiet',
    'hover:text-foreground',
    'dark:hover:bg-subtle',
    'font-sans',
    'focus:outline-none',
    'outline-none',
    'outline-transparent',
    'transition',
    'duration-300',
    'ease-out',
    'select-none',
    'items-center',
    'relative',
    'group/button',
    'font-semimedium',
    'justify-center',
    'text-center',
    'rounded-full',
    'cursor-pointer',
    'active:scale-[0.97]',
    'active:duration-150',
    'active:ease-outExpo',
    'origin-center',
    'whitespace-nowrap',
    'inline-flex',
    'text-sm',
    'h-8',
    'aspect-square',
  ];

  const state = {
    observer: null,
    hideCitations: false,
    removeComputerAds: true,
    styleElement: null,
    adsStyleElement: null,
    favoriteModel: '',
    lastSelectionTime: 0,
    chatObserver: null,
    observedContainer: null,
    applyFavoriteModel: false,
    keepTabModel: true,
    enforceThinking: false,
    isSelectingModel: false,
    lastObservedModelText: '',
    autoActionLog: [],
    noThinkingModels: new Set(),
  };

  // Per-tab memory (sessionStorage survives reloads but is private to the tab).
  const TAB_MODEL_KEY = 'plexienhancer.tabModel';
  const TAB_THINKING_OFF_KEY = 'plexienhancer.tabThinkingOff';

  const tabStore = {
    get(key) {
      try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
    },
    set(key, value) {
      try {
        if (value) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      } catch (e) { }
    },
  };

  const CITATION_SELECTORS = [
    '.citation-nbsp',
    'span.inline-flex[aria-label*=".pdf"]',
    'span[data-pplx-citation]',
    'span.citation',
    'span:has(> [data-pplx-citation])',
  ];

  const CITATION_HIDE_STYLE = `
    ${CITATION_SELECTORS.join(',\n    ')} {
      display: none !important;
    }
  `;

  // Everything in a rendered answer that is UI or citation rather than content.
  const FORMATTED_REMOVE_SELECTORS = [
    ...CITATION_SELECTORS,
    'button',
    'svg',
    '[hidden]',
    '[aria-hidden="true"]',
    '.katex-mathml',
  ];

  // Attributes worth keeping when pasting into mail/office programs; everything else is dropped.
  const FORMATTED_KEEP_ATTRIBUTES = new Set(['href', 'src', 'alt', 'colspan', 'rowspan', 'start']);

  const ADS_HIDE_STYLE = `
    div.fixed.bottom-0.right-0:has(a[href*="/computer"]),
    div.fixed.bottom-0.right-0:has(a[href*="checklist"]) {
      display: none !important;
    }
  `;

  const extensionApi =
    typeof browser !== 'undefined'
      ? browser
      : typeof chrome !== 'undefined'
        ? chrome
        : null;

  const runtime = extensionApi ? extensionApi.runtime : null;

  console.log("[PlexiCopy] Content script loaded. Extension API available:", extensionApi !== null);

  function stripMarkdown(md) {
    if (!md) return '';
    return md
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images -> alt text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links -> text
      .replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, '') // fenced code blocks
      .replace(/`([^`]+)`/g, '$1') // inline code
      .replace(/^#{1,6}\s+/gm, '') // headings
      .replace(/^\s*\*\s+/gm, '- ') // normalize * bullets to -
      .replace(/^\s*\+\s+/gm, '- ') // normalize + bullets to -
      .replace(/^\s*\d+\.\s+/gm, '') // ol numbers
      .replace(/^\s*>\s?/gm, '') // blockquotes
      .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
      .replace(/__([^_]+)__/g, '$1') // bold
      .replace(/\*([^*]+)\*/g, '$1') // italics
      .replace(/_([^_]+)_/g, '$1') // italics
      .replace(/~~([^~]+)~~/g, '$1') // strikethrough
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanText(raw) {
    if (!raw) return '';

    // Remove citation markers like [1], [2], etc.
    let text = raw.replace(/\[\d+\]/g, '');

    // Remove URL sections at the bottom
    const lines = text.split('\n');
    const cleanedLines = [];
    let inUrlSection = false;

    for (const line of lines) {
      const stripped = line.trim();
      const isUrlLine =
        /^\[\d+\]\(https?:\/\//.test(stripped) ||
        /^\(https?:\/\//.test(stripped) ||
        /^https?:\/\//.test(stripped) ||
        (stripped.startsWith('[') && stripped.includes('](http')) ||
        (stripped.startsWith('(') && stripped.includes('http') && stripped.endsWith(')'));

      if (isUrlLine) {
        inUrlSection = true;
        continue;
      }

      if (inUrlSection && stripped === '') {
        continue;
      }

      if (inUrlSection && !isUrlLine) {
        inUrlSection = false;
        cleanedLines.push(line);
        continue;
      }

      if (!inUrlSection) {
        cleanedLines.push(line);
      }
    }

    let result = cleanedLines.join('\n').trim();

    // Clean up any remaining citation markers that might have been missed
    result = result.replace(/\s+\[\d+\]/g, '');
    result = result.replace(/\[\d+\]\s+/g, '');

    // Remove inline citations like [ppl-ai-file-upload.s3.amazonaws](https://...)
    result = result.replace(/\s?\[[^\]]+\]\(https?:\/\/[^\)]+\)/g, '');

    // Remove URLs in parentheses that might be inline: (https://...)
    result = result.replace(/\s?\(https?:\/\/[^\)]+\)/g, '');

    // Remove multiple consecutive blank lines
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
  }

  async function copyUsingNativeButton(copyButton) {
    if (!copyButton) return '';
    try {
      copyButton.click();
      await new Promise((resolve) => setTimeout(resolve, CONFIG.NATIVE_COPY_WAIT));
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) return text;
      }
    } catch (err) { }
    return '';
  }

  function wiggle(button) {
    if (!button?.animate) return;
    button.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-10deg)' },
        { transform: 'rotate(10deg)' },
        { transform: 'rotate(-6deg)' },
        { transform: 'rotate(6deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 280, easing: 'ease-out' },
    );
  }

  function extractAnswerText(copyButton) {
    if (!copyButton) return '';

    // Try to scope to the message/card that owns this copy button
    const candidateContainers = [
      copyButton.closest('[data-testid="answer-card"]'),
      copyButton.closest('[data-message-id]'),
      copyButton.closest('article'),
      copyButton.closest('section'),
      copyButton.closest('div'),
      document.body,
    ].filter(Boolean);

    for (const container of candidateContainers) {
      const textBlocks = container.querySelectorAll('p, li, pre, code, h1, h2, h3, h4, h5, h6');
      if (textBlocks.length) {
        const joined = Array.from(textBlocks)
          .map((el) => el.innerText.trim())
          .filter(Boolean)
          .join('\n\n');
        if (joined) return joined;
      }
    }

    return copyButton.closest('div')?.innerText || '';
  }

  function createIcon(iconPath) {
    const img = document.createElement('img');
    img.setAttribute('aria-hidden', 'true');
    img.alt = '';
    img.width = 16;
    img.height = 16;
    if (runtime) {
      img.src = runtime.getURL(iconPath || 'icons/icon.svg');
    }
    return img;
  }

  function createButton(label, iconPath) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label; // Tooltip on hover
    button.classList.add(...BUTTON_CLASSNAMES);

    const wrapper = document.createElement('div');
    wrapper.classList.add('flex', 'items-center', 'min-w-0', 'gap-two', 'justify-center');

    const iconWrapper = document.createElement('div');
    iconWrapper.classList.add('flex', 'shrink-0', 'items-center', 'justify-center', 'size-4');
    iconWrapper.appendChild(createIcon(iconPath));

    wrapper.appendChild(iconWrapper);
    button.appendChild(wrapper);
    return button;
  }

  function showTempStatus(button, label) {
    if (!button) return;
    const original = button.getAttribute('aria-label') || CLEAN_BUTTON_LABEL;
    button.setAttribute('aria-label', label);
    button.style.opacity = '0.8';
    setTimeout(() => {
      button.setAttribute('aria-label', original);
      button.style.opacity = '';
    }, CONFIG.TEMP_STATUS_DURATION);
  }

  async function writeToClipboard(text) {
    if (!text) return false;
    const execCommandCopy = () => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch (err) {
        return false;
      }
    };

    const execOk = execCommandCopy();
    if (execOk) return true;

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function copyCleanText(copyButton, cleanButton, shouldStripMarkdown = false) {
    try {
      // Chrome does not let content scripts read the clipboard; fall back to the answer's DOM text.
      const raw = (await copyUsingNativeButton(copyButton)) || extractAnswerText(copyButton);
      let cleaned = cleanText(raw);

      if (shouldStripMarkdown) {
        cleaned = stripMarkdown(cleaned);
      }

      if (!cleaned) {
        showTempStatus(cleanButton, 'Nothing to copy');
        return;
      }
      const ok = await writeToClipboard(cleaned);
      if (ok) wiggle(cleanButton);
      const successLabel = shouldStripMarkdown ? 'Copied without MD' : 'Copied without Citations';
      showTempStatus(cleanButton, ok ? successLabel : 'Copy failed');
    } catch (err) {
      showTempStatus(cleanButton, 'Copy failed');
    }
  }

  // The rendered answer body belonging to a copy button: the nearest ancestor that contains answer prose.
  function findAnswerProse(copyButton) {
    for (let el = copyButton.parentElement; el && el !== document.body; el = el.parentElement) {
      const prose = el.querySelectorAll('[data-renderer="lm"], .prose');
      if (prose.length) {
        return Array.from(prose).filter(p => !Array.from(prose).some(o => o !== p && o.contains(p)));
      }
    }
    return [];
  }

  function buildFormattedCopy(proseElements) {
    const wrapper = document.createElement('div');
    proseElements.forEach(p => wrapper.appendChild(p.cloneNode(true)));

    FORMATTED_REMOVE_SELECTORS.forEach(sel => {
      wrapper.querySelectorAll(sel).forEach(el => el.remove());
    });
    wrapper.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (!FORMATTED_KEEP_ATTRIBUTES.has(attr.name)) el.removeAttribute(attr.name);
      });
    });

    // innerText needs layout to produce line breaks, so measure it off-screen.
    wrapper.style.cssText = 'position: fixed; left: -9999px; top: 0; white-space: normal;';
    document.body.appendChild(wrapper);
    const text = cleanText(wrapper.innerText);
    wrapper.removeAttribute('style');
    wrapper.remove();

    return { html: wrapper.innerHTML.trim(), text };
  }

  async function writeHtmlToClipboard(html, text) {
    // A copy event inside the click gesture is the most widely supported way to set text/html.
    let wrote = false;
    const onCopy = (event) => {
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      wrote = true;
    };
    document.addEventListener('copy', onCopy, true);
    try {
      document.execCommand('copy');
    } catch (err) { }
    document.removeEventListener('copy', onCopy, true);
    if (wrote) return true;

    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function copyFormattedText(copyButton, formattedButton) {
    try {
      const prose = findAnswerProse(copyButton);
      const { html, text } = prose.length ? buildFormattedCopy(prose) : { html: '', text: '' };
      if (!html || !text) {
        showTempStatus(formattedButton, 'Nothing to copy');
        return;
      }
      const ok = await writeHtmlToClipboard(html, text);
      if (ok) wiggle(formattedButton);
      showTempStatus(formattedButton, ok ? 'Copied formatted' : 'Copy failed');
    } catch (err) {
      showTempStatus(formattedButton, 'Copy failed');
    }
  }

  function placeButton(nextToButton) {
    if (!nextToButton || nextToButton.dataset.cleanCopyAttached === 'true') return;

    // First button: Standard Clean Copy
    const cleanBtn = createButton(CLEAN_BUTTON_LABEL, 'icons/copy-nocite.svg');
    cleanBtn.dataset.cleanCopyButton = 'true';
    cleanBtn.dataset.cleanCopyAttached = 'true';
    cleanBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyCleanText(nextToButton, cleanBtn, false);
    });

    // Second button: Strip Markdown
    const stripBtn = createButton(STRIP_MD_BUTTON_LABEL, 'icons/copy-nomd.svg');
    stripBtn.dataset.stripMdButton = 'true';
    stripBtn.dataset.cleanCopyAttached = 'true';
    stripBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyCleanText(nextToButton, stripBtn, true);
    });

    // Third button: keep rich-text formatting (bold, headings, lists) for mail/office programs
    const formattedBtn = createButton(FORMATTED_BUTTON_LABEL, 'icons/copy-formatted.svg');
    formattedBtn.dataset.copyFormattedButton = 'true';
    formattedBtn.dataset.cleanCopyAttached = 'true';
    formattedBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyFormattedText(nextToButton, formattedBtn);
    });

    // We add them after the native copy button
    // To keep them together, we could wrap them or just insert them sequentially
    nextToButton.insertAdjacentElement('afterend', formattedBtn);
    nextToButton.insertAdjacentElement('afterend', stripBtn);
    nextToButton.insertAdjacentElement('afterend', cleanBtn);

    nextToButton.dataset.cleanCopyAttached = 'true';
  }

  function isCopyButton(button) {
    if (button.dataset.cleanCopyButton === 'true' || button.dataset.stripMdButton === 'true' ||
        button.dataset.copyFormattedButton === 'true') {
      return false;
    }
    const label = (button.getAttribute('aria-label') || button.getAttribute('title') || '').toLowerCase().trim();
    if (!label) return false;

    const hasCopy = label.includes('copy') || 
                    label.includes('kopier') || 
                    label.includes('copi') || 
                    label.includes('복사') || 
                    label.includes('复制') || 
                    label.includes('複製') || 
                    label.includes('コピー') || 
                    label.includes('копир') || 
                    label.includes('kopy');

    if (!hasCopy) return false;

    const hasExclude = label.includes('link') || 
                       label.includes('url') || 
                       label.includes('share') || 
                       label.includes('teilen') || 
                       label.includes('partager') || 
                       label.includes('compartir') || 
                       label.includes('condividi') || 
                       label.includes('dela') || 
                       label.includes('delen') || 
                       label.includes('paylaş');

    return !hasExclude;
  }

  const isMatch = (text, target) => {
    if (!text || !target) return false;
    const cleanText = text.toLowerCase().replace(/\s*thinking\s*$/, '').trim().replace(/[^a-z0-9]/g, '');
    const cleanTarget = target.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return cleanText === cleanTarget;
  };

  function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  const findTriggerButton = () => {
    const chatContainer = document.querySelector('[data-ask-input-container="true"]');
    if (chatContainer) {
      const btn = chatContainer.querySelector('.inline-flex.-mr-sm button[aria-haspopup="menu"]');
      if (btn) return btn;
    }
    return Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find(btn => btn.querySelector('.text-box-trim-both') && btn.innerText);
  };

  const isGenerating = () => {
    return document.querySelector('button[aria-label*="Stop"]') !== null ||
           document.querySelector('.animate-pplxIndicator') !== null ||
           document.querySelector('[class*="animate-pplxIndicator"]') !== null;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isThinkingLabel = (text) => /\bthinking\s*$/i.test(text || '');

  const isLockedItem = (item) =>
    item.querySelector('svg use[*|href*="lock"]') !== null ||
    item.querySelector('svg use[*|href*="pplx-icon-lock"]') !== null;

  const isThinkingItem = (item) =>
    item.getAttribute('role') === 'menuitemcheckbox' || item.querySelector('[role="switch"]') !== null;

  const primaryName = (item) => item.innerText.split('\n')[0].trim();

  const findModelItem = (items, name) =>
    items.find(item => !isLockedItem(item) && !isThinkingItem(item) &&
      (isMatch(primaryName(item), name) || isMatch(item.innerText, name)));

  const isModelMenuOpen = () => findTriggerButton()?.getAttribute('aria-expanded') === 'true';

  // Model the tab should be on: a manual pick made in this tab wins over the favorite.
  function targetModel() {
    const tabModel = tabStore.get(TAB_MODEL_KEY);
    if (tabModel) return state.keepTabModel ? tabModel : '';
    return state.applyFavoriteModel ? state.favoriteModel : '';
  }

  // Caps automatic menu sessions so we never fight Perplexity in a loop.
  function allowAutoAction(now) {
    state.autoActionLog = state.autoActionLog.filter(t => now - t < CONFIG.AUTO_ACTION_WINDOW);
    if (state.autoActionLog.length >= CONFIG.AUTO_ACTION_MAX) {
      console.warn("[PlexiCopy] Too many automatic model changes, pausing until the next manual action.");
      return false;
    }
    state.autoActionLog.push(now);
    return true;
  }

  // Remember what the user picks by hand (trusted events only; our own dispatched events are untrusted).
  function handleUserMenuAction(event) {
    if (!event.isTrusted || state.isSelectingModel) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest?.('[role="menuitemradio"], [role="menuitem"], [role="menuitemcheckbox"]');
    if (!item || item.hasAttribute('aria-haspopup') || !isModelMenuOpen()) return;

    state.autoActionLog = [];
    if (isThinkingItem(item)) {
      const wasOn = item.getAttribute('aria-checked') === 'true';
      tabStore.set(TAB_THINKING_OFF_KEY, wasOn ? '1' : '');
      console.log("[PlexiCopy] User toggled thinking manually. Now:", !wasOn);
      return;
    }
    if (isLockedItem(item)) return;
    const name = primaryName(item);
    if (name) {
      tabStore.set(TAB_MODEL_KEY, name);
      console.log("[PlexiCopy] User picked model manually:", name);
    }
  }

  function dispatchClickSequence(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      let evt;
      if (type.startsWith('pointer')) {
        evt = new PointerEvent(type, { bubbles: true, cancelable: true });
      } else if (type.startsWith('mouse')) {
        evt = new MouseEvent(type, { bubbles: true, cancelable: true });
      } else {
        evt = new Event(type, { bubbles: true, cancelable: true });
      }
      el.dispatchEvent(evt);
    });
  }

  function waitForMenuItems() {
    return new Promise((resolve, reject) => {
      const query = () => document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
      const existingItems = query();
      if (existingItems.length > 0) {
        resolve(Array.from(existingItems));
        return;
      }

      const menuObserver = new MutationObserver(() => {
        const items = query();
        if (items.length > 0) {
          menuObserver.disconnect();
          resolve(Array.from(items));
        }
      });
      menuObserver.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        menuObserver.disconnect();
        reject(new Error("Timeout waiting for menu items"));
      }, CONFIG.MENU_RENDER_TIMEOUT);
    });
  }

  function openModelMenu(trigger) {
    trigger.focus();
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
    return waitForMenuItems();
  }

  function closeModelMenu() {
    const menu = document.querySelector('[role="menu"]');
    if (menu) {
      menu.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
      }));
    }
    document.getElementById('ask-input')?.focus();
  }

  // Turns thinking on for the given model item. Returns 'unsupported' if the model has no thinking switch.
  async function ensureThinkingOn(modelItem) {
    const thinkingItem = modelItem.parentElement?.querySelector('[role="menuitemcheckbox"]');
    if (!thinkingItem) return 'unsupported';

    const isDisabled = thinkingItem.getAttribute('aria-disabled') === 'true' ||
                       thinkingItem.hasAttribute('data-disabled') ||
                       thinkingItem.querySelector('button[disabled]') !== null;
    if (isDisabled || thinkingItem.getAttribute('aria-checked') === 'true') return 'ok';

    console.log("[PlexiCopy] Turning thinking on...");
    const toggleTarget = thinkingItem.querySelector('button[role="switch"]') ||
                         thinkingItem.querySelector('button') ||
                         thinkingItem;
    dispatchClickSequence(toggleTarget);
    await sleep(CONFIG.THINKING_TOGGLE_WAIT);
    return 'ok';
  }

  const shouldEnforceThinking = () => state.enforceThinking && tabStore.get(TAB_THINKING_OFF_KEY) !== '1';

  // One automatic trip through the model menu: optionally select `selectName`, then optionally enforce thinking.
  async function runModelMenuSession(trigger, selectName, currentLabel) {
    state.isSelectingModel = true;
    state.lastSelectionTime = Date.now();
    try {
      let items = await openModelMenu(trigger);

      if (selectName) {
        const item = findModelItem(items, selectName);
        if (!item) {
          console.warn("[PlexiCopy] Model not available in menu:", selectName);
          closeModelMenu();
          return;
        }
        console.log("[PlexiCopy] Selecting model:", primaryName(item));
        dispatchClickSequence(item);
        await sleep(CONFIG.SELECTION_WAIT);

        if (!shouldEnforceThinking() || state.noThinkingModels.has(selectName)) {
          closeModelMenu();
          return;
        }
        if (!document.querySelector('[role="menu"]')) {
          const freshTrigger = findTriggerButton();
          if (!freshTrigger) return;
          items = await openModelMenu(freshTrigger);
        } else {
          items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
        }
      }

      const modelName = selectName || currentLabel;
      const activeItem = findModelItem(items, modelName) ||
        items.find(item => item.getAttribute('aria-checked') === 'true' && !isThinkingItem(item));
      if (activeItem && (await ensureThinkingOn(activeItem)) === 'unsupported') {
        state.noThinkingModels.add(modelName);
      }
      closeModelMenu();
    } catch (err) {
      console.error("[PlexiCopy] ERROR during model menu session:", err);
      closeModelMenu();
    } finally {
      // Re-check once the cooldown ends, in case Perplexity reset the model again in the meantime.
      state.lastObservedModelText = '';
      state.lastSelectionTime = Date.now();
      state.isSelectingModel = false;
      setTimeout(debouncedSyncModel, CONFIG.AUTO_SELECT_COOLDOWN + 50);
    }
  }

  async function syncModel() {
    if (state.isSelectingModel) return;

    const trigger = findTriggerButton();
    if (!trigger || trigger.getAttribute('aria-expanded') === 'true') return;

    const currentModelText = trigger.innerText.trim();

    // If the model label has not changed since our last check, avoid running any logic.
    if (currentModelText === state.lastObservedModelText) return;

    // Wait until Perplexity is done processing/generating before touching the menu.
    if (isGenerating()) return;

    const now = Date.now();
    const cooldownLeft = CONFIG.AUTO_SELECT_COOLDOWN - (now - state.lastSelectionTime);
    if (cooldownLeft > 0) {
      setTimeout(debouncedSyncModel, cooldownLeft + 50);
      return;
    }

    state.lastObservedModelText = currentModelText;

    const target = targetModel();
    const needsModel = target && !isMatch(currentModelText, target);
    const needsThinking = shouldEnforceThinking() && !isThinkingLabel(currentModelText) &&
      !state.noThinkingModels.has(target || currentModelText);

    if (!needsModel && !needsThinking) return;
    if (!allowAutoAction(now)) return;

    console.log("[PlexiCopy] Model label:", currentModelText, "target:", target || "(none)", "thinking:", needsThinking);
    await runModelMenuSession(trigger, needsModel ? target : '', currentModelText);
  }

  const debouncedSyncModel = debounce(syncModel, CONFIG.DEBOUNCE_DELAY);

  function resetModelSync({ clearTabModel = false, clearTabThinking = false }) {
    if (clearTabModel) tabStore.set(TAB_MODEL_KEY, '');
    if (clearTabThinking) tabStore.set(TAB_THINKING_OFF_KEY, '');
    state.lastSelectionTime = 0;
    state.lastObservedModelText = '';
    state.autoActionLog = [];
    debouncedSyncModel();
  }

  function initChatObserver() {
    const container = document.querySelector('[data-ask-input-container="true"]');
    if (!container) {
      if (state.chatObserver) {
        state.chatObserver.disconnect();
        state.chatObserver = null;
        state.observedContainer = null;
      }
      return;
    }

    if (state.observedContainer === container) {
      return;
    }

    if (state.chatObserver) {
      state.chatObserver.disconnect();
    }

    state.observedContainer = container;
    state.chatObserver = new MutationObserver(() => {
      debouncedSyncModel();
    });

    state.chatObserver.observe(container, { childList: true, subtree: true, characterData: true });
  }

  function scanAndAttach() {
    const buttons = document.querySelectorAll('button:not([data-clean-copy-attached="true"])');
    buttons.forEach((button) => {
      if (isCopyButton(button)) {
        placeButton(button);
      }
    });
    initChatObserver();
    debouncedSyncModel();
  }

  const debouncedScanAndAttach = debounce(scanAndAttach, CONFIG.DEBOUNCE_DELAY);

  function initObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(() => {
      debouncedScanAndAttach();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function updateHidingStyle() {
    if (state.hideCitations) {
      if (!state.styleElement) {
        state.styleElement = document.createElement('style');
        state.styleElement.id = 'plexienhancer-hide-citations';
        document.head.appendChild(state.styleElement);
      }
      state.styleElement.textContent = CITATION_HIDE_STYLE;
    } else if (state.styleElement) {
      state.styleElement.textContent = '';
    }
  }

  function updateAdsStyle() {
    if (state.removeComputerAds) {
      if (!state.adsStyleElement) {
        state.adsStyleElement = document.createElement('style');
        state.adsStyleElement.id = 'plexienhancer-hide-ads';
        document.head.appendChild(state.adsStyleElement);
      }
      state.adsStyleElement.textContent = ADS_HIDE_STYLE;
    } else if (state.adsStyleElement) {
      state.adsStyleElement.textContent = '';
    }
  }
  function showOnboardingCard() {
    if (document.getElementById('plexienhancer-onboarding')) return;
    if (!document.body) {
      setTimeout(showOnboardingCard, 100);
      return;
    }

    const card = document.createElement('div');
    card.id = 'plexienhancer-onboarding';

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      #plexienhancer-onboarding .switch {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 20px;
        flex-shrink: 0;
      }
      #plexienhancer-onboarding .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      #plexienhancer-onboarding .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #333;
        transition: .3s;
        border-radius: 20px;
      }
      #plexienhancer-onboarding .slider:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .3s;
        border-radius: 50%;
      }
      #plexienhancer-onboarding input:checked + .slider {
        background-color: #2e7d32;
      }
      #plexienhancer-onboarding input:checked + .slider:before {
        transform: translateX(14px);
      }
    `;
    card.appendChild(styleEl);
    card.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 320px;
      background: rgba(20, 20, 20, 0.9);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid #333;
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 10000;
      color: #eeeeee;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: opacity 0.3s, transform 0.3s;
      opacity: 0;
      transform: translateY(20px);
    `;

    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    `;

    const title = document.createElement('h3');
    title.innerText = 'PlexiEnhancer Setup';
    title.style.cssText = `
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      background: linear-gradient(135deg, #fff 0%, #aaa 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    `;
    closeBtn.addEventListener('click', () => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      extensionApi.storage.local.set({ onboardingDismissed: true });
      setTimeout(() => card.remove(), 300);
    });

    titleContainer.appendChild(title);
    titleContainer.appendChild(closeBtn);
    card.appendChild(titleContainer);

    const desc = document.createElement('p');
    desc.innerText = 'Pick a favorite model for new tabs. If you switch models by hand, that choice wins for the tab.';
    desc.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 13px;
      color: #aaa;
      line-height: 1.4;
    `;
    card.appendChild(desc);

    const contentDiv = document.createElement('div');
    contentDiv.id = 'plexienhancer-onboarding-content';

    const loader = document.createElement('div');
    loader.innerText = 'Searching Perplexity models...';
    loader.style.cssText = `
      font-size: 13px;
      color: #aaa;
      text-align: center;
      padding: 10px 0;
    `;
    contentDiv.appendChild(loader);

    async function loadOnboardingModels() {
      try {
        const models = await new Promise((resolve, reject) => {
          let attempts = 0;
          const attemptScrape = () => {
            const trigger = findTriggerButton();
            if (!trigger) {
              attempts++;
              if (attempts < 10) {
                setTimeout(attemptScrape, 300);
              } else {
                reject(new Error('Model selector button not found. Please start a thread or check that Perplexity is fully loaded.'));
              }
              return;
            }

            trigger.focus();
            trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            trigger.click();

            setTimeout(() => {
              const menuItems = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
              if (menuItems.length === 0) {
                reject(new Error('No menu items found.'));
                return;
              }

              const availableModels = [];
              menuItems.forEach(item => {
                const hasLock = item.querySelector('svg use[*|href*="lock"]') !== null || 
                                item.querySelector('svg use[*|href*="pplx-icon-lock"]') !== null;
                const isCheckbox = item.getAttribute('role') === 'menuitemcheckbox' ||
                                   item.querySelector('[role="switch"]') !== null;
                if (!hasLock && !isCheckbox) {
                  const lines = item.innerText.split('\n');
                  const primaryName = lines[0].trim();
                  if (primaryName && !availableModels.includes(primaryName)) {
                    availableModels.push(primaryName);
                  }
                }
              });

              const activeMenu = document.querySelector('[role="menu"]');
              if (activeMenu) {
                const escEvent = new KeyboardEvent('keydown', {
                  key: 'Escape',
                  code: 'Escape',
                  keyCode: 27,
                  which: 27,
                  bubbles: true,
                  cancelable: true
                });
                activeMenu.dispatchEvent(escEvent);
              }

              resolve(availableModels);
            }, CONFIG.SCRAPE_MENU_WAIT);
          };
          attemptScrape();
        });

        if (models.length === 0) {
          throw new Error('No models found.');
        }

        contentDiv.innerHTML = '';
        const select = document.createElement('select');
        select.style.cssText = `
          width: 100%;
          background: #111;
          border: 1px solid #333;
          color: #eee;
          padding: 8px;
          border-radius: 8px;
          margin-bottom: 12px;
          outline: none;
          font-size: 13px;
        `;
        models.forEach(model => {
          const opt = document.createElement('option');
          opt.value = model;
          opt.innerText = model;
          select.appendChild(opt);
        });

        const thinkingContainer = document.createElement('div');
        thinkingContainer.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding: 2px 4px;
        `;

        const thinkingLabel = document.createElement('span');
        thinkingLabel.innerText = 'Enforce Thinking';
        thinkingLabel.style.cssText = `
          font-size: 13px;
          color: #aaa;
        `;

        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';

        const thinkingInput = document.createElement('input');
        thinkingInput.type = 'checkbox';
        thinkingInput.checked = true;

        const sliderSpan = document.createElement('span');
        sliderSpan.className = 'slider';

        switchLabel.appendChild(thinkingInput);
        switchLabel.appendChild(sliderSpan);

        thinkingContainer.appendChild(thinkingLabel);
        thinkingContainer.appendChild(switchLabel);

        const saveBtn = document.createElement('button');
        saveBtn.innerText = 'Save Favorite Model';
        saveBtn.style.cssText = `
          width: 100%;
          background: #2e7d32;
          border: none;
          color: white;
          padding: 10px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.2s;
        `;
        saveBtn.addEventListener('mouseover', () => saveBtn.style.background = '#388e3c');
        saveBtn.addEventListener('mouseout', () => saveBtn.style.background = '#2e7d32');
        saveBtn.addEventListener('click', () => {
          const selectedModel = select.value;
          const enforceThinking = thinkingInput.checked;
          extensionApi.storage.local.set({ favoriteModel: selectedModel, availableModels: models, enforceThinking, applyFavoriteModel: true }, () => {
            state.favoriteModel = selectedModel;
            state.enforceThinking = enforceThinking;
            state.applyFavoriteModel = true;
            resetModelSync({ clearTabModel: true, clearTabThinking: true });
            
            try {
              // nobody listens while the popup is closed; swallow that rejection
              const sent = extensionApi.runtime.sendMessage({ action: 'settingsUpdatedExternally' });
              if (sent && sent.catch) sent.catch(() => {});
            } catch(e){}

            debouncedSyncModel();
            
            contentDiv.innerHTML = '<div style="color: #4caf50; font-size: 13px; font-weight: 600; text-align: center; margin-top: 8px;">✓ Favorite model saved!</div>';
            setTimeout(() => {
              card.style.opacity = '0';
              card.style.transform = 'translateY(20px)';
              setTimeout(() => card.remove(), 300);
            }, 1500);
          });
        });

        contentDiv.appendChild(select);
        contentDiv.appendChild(thinkingContainer);
        contentDiv.appendChild(saveBtn);
      } catch (err) {
        contentDiv.innerHTML = '';
        const errMsg = document.createElement('div');
        errMsg.innerText = err.message || 'Error loading models.';
        errMsg.style.cssText = `
          color: #ff5252;
          font-size: 12px;
          margin-bottom: 12px;
          line-height: 1.4;
          text-align: center;
        `;
        contentDiv.appendChild(errMsg);

        const retryBtn = document.createElement('button');
        retryBtn.innerText = 'Retry';
        retryBtn.style.cssText = `
          width: 100%;
          background: #333;
          border: 1px solid #444;
          color: white;
          padding: 8px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        `;
        retryBtn.addEventListener('click', () => {
          contentDiv.innerHTML = '';
          contentDiv.appendChild(loader);
          loadOnboardingModels();
        });
        contentDiv.appendChild(retryBtn);
      }
    }

    loadOnboardingModels();
    card.appendChild(contentDiv);
    document.body.appendChild(card);

    setTimeout(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 10);
  }

  function initSettings() {
    if (!extensionApi) {
      console.error("[PlexiCopy] ERROR: Extension API not found.");
      return;
    }
    console.log("[PlexiCopy] Reading stored settings...");
    extensionApi.storage.local.get(['hideCitations', 'removeComputerAds', 'favoriteModel', 'applyFavoriteModel', 'keepTabModel', 'enforceThinking', 'onboardingDismissed'], (result) => {
      console.log("[PlexiCopy] Retrieved settings from storage:", result);
      state.hideCitations = result.hideCitations || false;
      state.removeComputerAds = result.removeComputerAds !== false;
      state.favoriteModel = result.favoriteModel || '';
      state.applyFavoriteModel = result.applyFavoriteModel === true;
      state.keepTabModel = result.keepTabModel !== false;
      state.enforceThinking = result.enforceThinking === true;
      updateHidingStyle();
      updateAdsStyle();
      debouncedSyncModel();

      if (!state.favoriteModel && !result.onboardingDismissed) {
        showOnboardingCard();
      }
    });

    extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("[PlexiCopy] Received background/popup message:", message);
      if (message.action === 'scrapeModels') {
        (async () => {
          try {
            const trigger = findTriggerButton();
            if (!trigger) {
              sendResponse({ success: false, error: 'Model selector button not found' });
              return;
            }

            // Click dropdown to open menu
            trigger.focus();
            trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            trigger.click();

            // Wait for Radix dropdown to render
            await new Promise(resolve => setTimeout(resolve, CONFIG.SCRAPE_MENU_WAIT));

            // Scrape menu items
            const menuItems = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
            if (menuItems.length === 0) {
              sendResponse({ success: false, error: 'No menu items rendered' });
              return;
            }

            // Filter out locked items and switches/checkboxes
            const availableModels = [];
            menuItems.forEach(item => {
              const hasLock = item.querySelector('svg use[*|href*="lock"]') !== null || 
                              item.querySelector('svg use[*|href*="pplx-icon-lock"]') !== null;
              const isCheckbox = item.getAttribute('role') === 'menuitemcheckbox' ||
                                 item.querySelector('[role="switch"]') !== null;
              if (!hasLock && !isCheckbox) {
                const lines = item.innerText.split('\n');
                const primaryName = lines[0].trim();
                if (primaryName && !availableModels.includes(primaryName)) {
                  availableModels.push(primaryName);
                }
              }
            });

            // Close the menu
            const activeMenu = document.querySelector('[role="menu"]');
            if (activeMenu) {
              const escEvent = new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
              });
              activeMenu.dispatchEvent(escEvent);
            }

            // Save to storage
            extensionApi.storage.local.set({ availableModels }, () => {
              console.log("[PlexiCopy] Scraped and stored available models:", availableModels);
              sendResponse({ success: true, models: availableModels });
            });
          } catch (err) {
            console.error("[PlexiCopy] Error scraping models:", err);
            sendResponse({ success: false, error: err.message });
          }
        })();
        return true; // Keep message channel open for async response
      }

      if (message.action === 'updateSettings') {
        if ('hideCitations' in message.settings) {
          state.hideCitations = message.settings.hideCitations;
          updateHidingStyle();
        }
        if ('removeComputerAds' in message.settings) {
          state.removeComputerAds = message.settings.removeComputerAds;
          updateAdsStyle();
        }
        // Changing these in the popup is an explicit request for this tab, so it overrides the tab's manual pick.
        if ('favoriteModel' in message.settings) {
          state.favoriteModel = message.settings.favoriteModel;
          resetModelSync({ clearTabModel: true });
        }
        if ('applyFavoriteModel' in message.settings) {
          state.applyFavoriteModel = message.settings.applyFavoriteModel;
          resetModelSync({ clearTabModel: state.applyFavoriteModel });
        }
        if ('keepTabModel' in message.settings) {
          state.keepTabModel = message.settings.keepTabModel;
          resetModelSync({});
        }
        if ('enforceThinking' in message.settings) {
          state.enforceThinking = message.settings.enforceThinking;
          resetModelSync({ clearTabThinking: state.enforceThinking });
        }
      }
    });
  }

  function init() {
    console.log("[PlexiCopy] Running init sequence...");
    document.addEventListener('click', handleUserMenuAction, true);
    document.addEventListener('keydown', handleUserMenuAction, true);
    initSettings();
    scanAndAttach();
    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

