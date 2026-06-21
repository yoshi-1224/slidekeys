(function () {
  const CONFIG_KEY = "slidekeysMainWorldShortcutConfig";
  const MESSAGE_CONFIG = "slidekeys-main-world-config";
  const MESSAGE_SHORTCUT = "slidekeys-main-world-shortcut";
  const MESSAGE_TEXT_INPUT_SUPPRESSION = "slidekeys-main-world-text-input-suppression";
  const MESSAGE_TEXT_RESTORE = "slidekeys-main-world-text-restore";
  const MESSAGE_IME_CLEAR = "slidekeys-main-world-ime-clear";
  const MESSAGE_IME_CLEAR_RESULT = "slidekeys-main-world-ime-clear-result";
  const MESSAGE_COMMAND_MODE_STATE = "slidekeys-command-mode-state";
  const KEY_SEPARATOR = "•";
  const TEXT_INPUT_STRICT_SUPPRESSION_MS = 700;
  const TEXT_RESTORE_WINDOW_MS = 3000;
  const TEXT_INPUT_SUPPRESSION_MS = TEXT_RESTORE_WINDOW_MS;
  const IME_CLEAR_WINDOW_MS = 2000;
  const TEXT_RESTORE_DELAYS_MS = [0, 30, 120, 350, 700, 1200, 2000, 3000];
  const textInputSuppressionEventTypes = [
    "keypress",
    "beforeinput",
    "textInput",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "input",
  ];
  const extensionCommandFallbacks = {
    "<C-S>": "setLineSpacing115",
  };
  const keyNames = new Map([
    [8, "backspace"],
    [9, "tab"],
    [10, "ctrlEnter"],
    [13, "enter"],
    [27, "esc"],
    [32, "space"],
    [33, "pageUp"],
    [34, "pageDown"],
    [35, "end"],
    [36, "home"],
    [37, "left"],
    [38, "up"],
    [39, "right"],
    [40, "down"],
    [46, "delete"],
    [112, "f1"],
    [123, "f12"],
  ]);
  const state = {
    config: null,
    commandModeActive: false,
    imeClearedBeforeCommandUntil: 0,
    imeShortcutHost: null,
    keyQueue: [],
    textRestoreSnapshot: null,
    textInputStrictSuppressionUntil: 0,
    textInputSuppressionUntil: 0,
  };

  function keyStringFromPhysicalCode(code) {
    if (!code) return null;
    if (code.startsWith("Key") && code.length === 4) return code.charAt(3).toLowerCase();
    if (code.startsWith("Digit") && code.length === 6) return code.charAt(5);
    return null;
  }

  function getKeyString(event) {
    let keyString;
    if (event.keyCode === 229) {
      keyString = keyStringFromPhysicalCode(event.code);
      if (!keyString) return null;
    } else if (keyNames.has(event.keyCode)) {
      keyString = keyNames.get(event.keyCode);
    } else if (event.altKey && event.key && event.key !== "Alt") {
      keyString = String.fromCharCode(event.keyCode).toLowerCase();
    } else if (event.key && event.key.length === 1) {
      if (!/[a-zA-Z0-9\x20-\x7e]/.test(event.key) && event.code) {
        keyString = keyStringFromPhysicalCode(event.code) || event.key;
      } else {
        keyString = event.key;
      }
    } else if (event.key && event.key.length === 2 && "F1" <= event.key && event.key <= "F9") {
      keyString = event.key.toLowerCase();
    } else if (event.key && event.key.length === 3 && "F10" <= event.key && event.key <= "F12") {
      keyString = event.key.toLowerCase();
    } else {
      return null;
    }

    const modifiers = [];
    if (event.shiftKey) keyString = keyString.toUpperCase();
    if (event.metaKey) modifiers.push("M");
    if (event.ctrlKey) modifiers.push("C");
    if (event.altKey) modifiers.push("A");
    for (const mod of modifiers) {
      keyString = mod + "-" + keyString;
    }
    return modifiers.length > 0 ? `<${keyString}>` : keyString;
  }

  function loadConfig() {
    if (state.config) return state.config;
    try {
      const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (config) state.config = config;
    } catch (error) {
      state.config = null;
    }
    return state.config;
  }

  function setCommandModeActive(active) {
    state.commandModeActive = !!active;
    if (!state.commandModeActive) {
      state.keyQueue = [];
    }
  }

  function elementHasRole(el, role) {
    return !!(el && el.nodeType === 1 && el.getAttribute && el.getAttribute("role") === role);
  }

  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tagName = el.tagName ? el.tagName.toLowerCase() : "";
    if (["input", "textarea", "select"].includes(tagName)) return true;
    if (el.isContentEditable) return true;
    const contentEditable = el.getAttribute && el.getAttribute("contenteditable");
    if (contentEditable != null && contentEditable.toLowerCase() !== "false") return true;
    if (elementHasRole(el, "textbox")) return true;
    return !!(el.getAttribute && el.getAttribute("aria-multiline") === "true");
  }

  function getEventPath(event) {
    if (event && typeof event.composedPath === "function") {
      try {
        return event.composedPath();
      } catch (error) {
        return [];
      }
    }
    const path = [];
    let el = event && event.target;
    while (el) {
      path.push(el);
      el = el.parentElement || el.parentNode || el.host;
    }
    return path;
  }

  function hasCollapsedTextboxCaret(event) {
    const selection = document.getSelection ? document.getSelection() : null;
    if (!selection || !selection.isCollapsed || selection.rangeCount < 1) return false;
    if (selection.type && selection.type !== "Caret") return false;
    return getEventPath(event).some((el) => elementHasRole(el, "textbox")) ||
      elementHasRole(document.activeElement, "textbox");
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : el.style || {};
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (
      style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" || style.opacity === "0"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { width: el.offsetWidth || 0, height: el.offsetHeight || 0 };
    return rect.width > 0 || rect.height > 0 ||
      !!(el.getClientRects && el.getClientRects().length > 0);
  }

  function hasVisibleBlockingUi() {
    const selectors = [
      "[role='dialog']",
      ".goog-modaldialog",
      ".goog-modalpopup",
      ".modal-dialog",
      "[role='menu']",
      ".goog-menu",
    ];
    return selectors.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some((el) => isElementVisible(el))
    );
  }

  function shouldSuppressShortcut(event) {
    if (hasVisibleBlockingUi()) return true;
    if (hasCollapsedTextboxCaret(event)) return true;

    const path = getEventPath(event);
    if (document.activeElement) path.push(document.activeElement);
    const hasEditableTarget = path.some((el) => isEditableElement(el));
    if (!hasEditableTarget) return false;

    const selection = document.getSelection ? document.getSelection() : null;
    const bodyRole = document.body && document.body.getAttribute("role");
    return !(bodyRole === "presentation" && selection && !selection.isCollapsed);
  }

  function describeKeyboardEvent(event) {
    return {
      type: event.type || "",
      code: event.code || "",
      keyCode: event.keyCode,
      which: event.which,
      isComposing: !!event.isComposing,
      altKey: !!event.altKey,
      ctrlKey: !!event.ctrlKey,
      metaKey: !!event.metaKey,
      shiftKey: !!event.shiftKey,
    };
  }

  function describeTextInputEvent(event) {
    const data = typeof event.data === "string" ? event.data : null;
    return {
      type: event.type || "",
      inputType: event.inputType || "",
      cancelable: event.cancelable,
      dataLength: data == null ? null : data.length,
      dataMatchesShortcutText: data == null ? null : eventDataMatchesShortcutText(event),
      isComposing: !!event.isComposing,
    };
  }

  function shouldGuardConsumedKeyTextInput(event, keyString) {
    if (!event || !keyString || keyString.length !== 1) return false;
    return !event.altKey && !event.ctrlKey && !event.metaKey;
  }

  function armTextInputSuppression(event, keyString) {
    if (!shouldGuardConsumedKeyTextInput(event, keyString)) return;
    const now = Date.now();
    state.textInputStrictSuppressionUntil = now + TEXT_INPUT_STRICT_SUPPRESSION_MS;
    state.textInputSuppressionUntil = now + TEXT_INPUT_SUPPRESSION_MS;
  }

  function getEditableHost(event) {
    return getEventPath(event).find((el) => isEditableElement(el)) || null;
  }

  function captureTextRestoreSnapshot(event, keyString) {
    const host = getEditableHost(event);
    if (!host || typeof host.innerHTML !== "string") return;

    const now = Date.now();
    const selection = document.getSelection ? document.getSelection() : null;
    if (
      !state.textRestoreSnapshot || state.textRestoreSnapshot.element !== host ||
      now > state.textRestoreSnapshot.until
    ) {
      state.textRestoreSnapshot = {
        createdAt: now,
        element: host,
        html: host.innerHTML,
        keyBuffer: "",
        reportedNoChange: false,
        reportedUnmatchedChange: false,
        selectedText: selection ? String(selection.toString() || "") : "",
        text: host.textContent || "",
        until: now + TEXT_RESTORE_WINDOW_MS,
      };
    }

    state.textRestoreSnapshot.keyBuffer = (
      state.textRestoreSnapshot.keyBuffer + keyString
    ).slice(-((state.config && state.config.maxKeyMappingLength) || 6));
    state.textRestoreSnapshot.until = now + TEXT_RESTORE_WINDOW_MS;

    if (event && event.keyCode === 229) {
      state.imeShortcutHost = {
        element: host,
        until: now + IME_CLEAR_WINDOW_MS,
      };
    }
  }

  function textRestoreMetrics(snapshot, currentText) {
    const keyBuffer = (snapshot && snapshot.keyBuffer) || "";
    return {
      currentLength: typeof currentText === "string" ? currentText.length : null,
      keyBufferLength: keyBuffer.length,
      previousLength: snapshot && typeof snapshot.text === "string" ? snapshot.text.length : null,
      snapshotAgeMs: snapshot && snapshot.createdAt ? Date.now() - snapshot.createdAt : null,
      selectedLength: snapshot && typeof snapshot.selectedText === "string"
        ? snapshot.selectedText.length
        : null,
    };
  }

  function postTextRestoreDebug(reason, snapshot, currentText) {
    window.postMessage({
      type: MESSAGE_TEXT_RESTORE,
      metrics: snapshot ? textRestoreMetrics(snapshot, currentText) : null,
      reason,
    }, "*");
  }

  function isSingleInsertedShortcutText(currentText, previousText, insertedText) {
    if (!insertedText) return false;
    if (typeof currentText !== "string" || typeof previousText !== "string") return false;
    if (currentText.length !== previousText.length + insertedText.length) return false;

    for (let i = 0; i <= previousText.length; i++) {
      if (
        currentText.slice(0, i) === previousText.slice(0, i) &&
        currentText.slice(i, i + insertedText.length) === insertedText &&
        currentText.slice(i + insertedText.length) === previousText.slice(i)
      ) {
        return true;
      }
    }
    return false;
  }

  function isShortcutReplacement(currentText, previousText, selectedText, insertedText) {
    if (!selectedText || !insertedText) return false;
    let index = previousText.indexOf(selectedText);
    while (index !== -1) {
      const candidate = previousText.slice(0, index) + insertedText +
        previousText.slice(index + selectedText.length);
      if (candidate === currentText) return true;
      index = previousText.indexOf(selectedText, index + 1);
    }
    return false;
  }

  function restoreShortcutTextIfNeeded() {
    const snapshot = state.textRestoreSnapshot;
    if (!snapshot || Date.now() > snapshot.until) return false;
    const element = snapshot.element;
    if (!element || !element.isConnected) return false;

    const currentText = element.textContent || "";
    if (currentText === snapshot.text) {
      if (!snapshot.reportedNoChange) {
        snapshot.reportedNoChange = true;
        postTextRestoreDebug("shortcutTextRestoreNoDomChange", snapshot, currentText);
      }
      return false;
    }

    const keyBuffer = snapshot.keyBuffer || "";
    const candidates = [keyBuffer, keyBuffer.slice(-1)].filter(Boolean);
    const shouldRestore = candidates.some((candidate) =>
      isSingleInsertedShortcutText(currentText, snapshot.text, candidate) ||
      isShortcutReplacement(currentText, snapshot.text, snapshot.selectedText, candidate)
    );
    if (!shouldRestore) {
      if (!snapshot.reportedUnmatchedChange) {
        snapshot.reportedUnmatchedChange = true;
        postTextRestoreDebug("shortcutTextRestoreUnmatchedDomChange", snapshot, currentText);
      }
      return false;
    }

    element.innerHTML = snapshot.html;
    state.textRestoreSnapshot = null;
    postTextRestoreDebug("shortcutTextRestored", snapshot, currentText);
    return true;
  }

  function scheduleShortcutTextRestore() {
    for (const delay of TEXT_RESTORE_DELAYS_MS) {
      setTimeout(() => restoreShortcutTextIfNeeded(), delay);
    }
    postTextRestoreDebug("shortcutTextRestoreScheduled", state.textRestoreSnapshot, null);
  }

  function postImeClearDebug(reason, metadata) {
    window.postMessage({
      type: MESSAGE_IME_CLEAR_RESULT,
      reason,
      metadata: metadata || null,
    }, "*");
  }

  function captureSelectionSnapshot(host) {
    const selection = document.getSelection ? document.getSelection() : null;
    if (!selection || !host) return null;
    const ranges = [];
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (!host.contains(range.commonAncestorContainer)) continue;
      ranges.push(range.cloneRange());
    }
    if (!ranges.length) return null;
    return {
      isCollapsed: selection.isCollapsed,
      rangeCount: ranges.length,
      ranges,
    };
  }

  function restoreSelectionSnapshot(snapshot) {
    if (!snapshot || !document.getSelection) return false;
    const selection = document.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    for (const range of snapshot.ranges) {
      selection.addRange(range);
    }
    return true;
  }

  function focusEditableHost(host) {
    if (!host || typeof host.focus !== "function") return false;
    try {
      host.focus({ preventScroll: true });
    } catch (error) {
      host.focus();
    }
    return true;
  }

  function clearTrackedImeHost(reasonPrefix, options = {}) {
    const trackedHost = state.imeShortcutHost;
    const host = trackedHost && Date.now() <= trackedHost.until ? trackedHost.element : null;
    const selectionSnapshot = options.restoreSelection ? captureSelectionSnapshot(host) : null;
    const metadata = {
      activeWasTrackedHost: !!(host && document.activeElement === host),
      hadTrackedHost: !!host,
      hostConnected: !!(host && host.isConnected),
      selectionRangeCount: selectionSnapshot ? selectionSnapshot.rangeCount : 0,
      selectionWasCollapsed: selectionSnapshot ? selectionSnapshot.isCollapsed : null,
    };

    if (!host || !host.isConnected || typeof host.blur !== "function") {
      postImeClearDebug(`${reasonPrefix}SkippedNoTrackedHost`, metadata);
      return false;
    }

    try {
      host.blur();
      if (options.restoreSelection) {
        metadata.focusedAfterBlur = focusEditableHost(host);
        metadata.selectionRestored = restoreSelectionSnapshot(selectionSnapshot);
      }
      postImeClearDebug(`${reasonPrefix}BlurredTrackedHost`, metadata);
      if (reasonPrefix === "beforeCommand") {
        state.imeClearedBeforeCommandUntil = Date.now() + IME_CLEAR_WINDOW_MS;
      }
      return true;
    } catch (error) {
      postImeClearDebug(`${reasonPrefix}Error`, metadata);
      return false;
    }
  }

  function trackedImeHostMetadata() {
    const trackedHost = state.imeShortcutHost;
    const host = trackedHost && Date.now() <= trackedHost.until ? trackedHost.element : null;
    return {
      activeWasTrackedHost: !!(host && document.activeElement === host),
      hadTrackedHost: !!host,
      hostConnected: !!(host && host.isConnected),
    };
  }

  function shortcutTextSnapshotUnchanged() {
    const snapshot = state.textRestoreSnapshot;
    if (!snapshot || Date.now() > snapshot.until) return false;
    const element = snapshot.element;
    if (!element || !element.isConnected) return false;
    return (element.textContent || "") === snapshot.text;
  }

  function clearImeComposition(message) {
    if (!message || !message.event || message.event.keyCode !== 229) {
      postImeClearDebug("afterCommandSkippedNonImeShortcut", null);
      return;
    }
    if (Date.now() <= state.imeClearedBeforeCommandUntil) {
      postImeClearDebug("afterCommandSkippedAlreadyCleared", null);
      return;
    }
    if (shortcutTextSnapshotUnchanged()) {
      postImeClearDebug(
        "afterCommandSkippedNoShortcutTextChange",
        trackedImeHostMetadata(),
      );
      state.imeShortcutHost = null;
      return;
    }

    clearTrackedImeHost("afterCommand");
  }

  function suppressEvent(event) {
    if (event.cancelable !== false && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function isPotentialShortcutTextInsertion(event) {
    if (!event) return false;
    if (event.type === "beforeinput" || event.type === "input") {
      const inputType = event.inputType || "";
      return !inputType || inputType.startsWith("insert");
    }
    return true;
  }

  function normalizeShortcutText(text) {
    return String(text || "").normalize("NFKC").toLowerCase();
  }

  function getShortcutTextCandidates() {
    const snapshot = state.textRestoreSnapshot;
    const keyBuffer = snapshot && snapshot.keyBuffer ? snapshot.keyBuffer : "";
    if (!keyBuffer) return [];
    const candidates = [keyBuffer, keyBuffer.slice(-1)].filter(Boolean);
    return Array.from(new Set(candidates.map((candidate) => normalizeShortcutText(candidate))));
  }

  function eventDataMatchesShortcutText(event) {
    if (!event || typeof event.data !== "string" || !event.data) return false;
    const eventData = normalizeShortcutText(event.data);
    return getShortcutTextCandidates().includes(eventData);
  }

  function shouldSuppressPotentialShortcutTextInput(event) {
    const now = Date.now();
    if (!state.textInputSuppressionUntil || now > state.textInputSuppressionUntil) return false;
    if (!isPotentialShortcutTextInsertion(event)) return false;
    if (now <= state.textInputStrictSuppressionUntil) return true;
    return eventDataMatchesShortcutText(event);
  }

  function onPotentialShortcutTextInput(event) {
    if (!shouldSuppressPotentialShortcutTextInput(event)) return;
    suppressEvent(event);
    window.postMessage({
      type: MESSAGE_TEXT_INPUT_SUPPRESSION,
      event: describeTextInputEvent(event),
    }, "*");
  }

  function postShortcutMessage(payload, delayMs) {
    if (delayMs > 0) {
      setTimeout(() => window.postMessage(payload, "*"), delayMs);
      return;
    }
    window.postMessage(payload, "*");
  }

  function getExtensionCommandFallback(keyString) {
    if (!keyString) return null;
    return extensionCommandFallbacks[keyString] || null;
  }

  function onKeydown(event) {
    const keyString = getKeyString(event);
    if (!keyString) return;

    if (!state.commandModeActive) {
      state.keyQueue = [];
      return;
    }

    const fallbackCommandName = getExtensionCommandFallback(keyString);
    if (fallbackCommandName) {
      state.keyQueue = [];
      suppressEvent(event);
      postShortcutMessage({
        type: MESSAGE_SHORTCUT,
        keyString,
        keySequence: keyString,
        commandName: fallbackCommandName,
        commandSource: "mainWorldExtensionCommandFallback",
        dispatchDelayMs: 0,
        isPrefix: false,
        event: describeKeyboardEvent(event),
      }, 0);
      return;
    }

    const config = loadConfig();
    if (!config || shouldSuppressShortcut(event)) {
      state.keyQueue = [];
      return;
    }

    state.keyQueue.push(keyString);
    if (state.keyQueue.length > (config.maxKeyMappingLength || 6)) {
      state.keyQueue.shift();
    }

    const modeMappings = (config.modeToKeyToCommand && config.modeToKeyToCommand.normal) || {};
    const modePrefixes = (config.keyMappingsPrefixes && config.keyMappingsPrefixes.normal) || {};
    for (let i = Math.min(config.maxKeyMappingLength || 6, state.keyQueue.length); i >= 1; i--) {
      const keySequence = state.keyQueue.slice(state.keyQueue.length - i).join(KEY_SEPARATOR);
      const commandName = modeMappings[keySequence];
      const isPrefix = !!modePrefixes[keySequence];
      if (!commandName && !isPrefix) continue;

      captureTextRestoreSnapshot(event, keyString);
      suppressEvent(event);
      armTextInputSuppression(event, keyString);

      if (commandName) state.keyQueue = [];
      if (commandName) {
        setCommandModeActive(false);
        scheduleShortcutTextRestore();
      }
      postShortcutMessage({
        type: MESSAGE_SHORTCUT,
        keyString,
        keySequence,
        commandName: commandName || null,
        dispatchDelayMs: 0,
        isPrefix,
        event: describeKeyboardEvent(event),
      }, 0);
      return;
    }
  }

  window.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === MESSAGE_IME_CLEAR) {
      clearImeComposition(event.data);
      return;
    }
    if (event.source === window && event.data.type === MESSAGE_COMMAND_MODE_STATE) {
      setCommandModeActive(event.data.active);
      return;
    }
    if (event.source !== window || event.data.type !== MESSAGE_CONFIG) return;
    state.config = event.data.config || null;
    state.keyQueue = [];
  }, false);

  loadConfig();
  window.addEventListener("keydown", onKeydown, true);
  for (const eventType of textInputSuppressionEventTypes) {
    window.addEventListener(eventType, onPotentialShortcutTextInput, true);
  }
})();
