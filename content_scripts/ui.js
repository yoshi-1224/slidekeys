const UI = {
  // An arbitrary limit that should instead be equal to the longest key sequence that's actually
  // bound.
  maxKeyMappingLength: 6,
  // Keys which were typed recently
  keyQueue: [],
  // A map of mode -> comma-separated keys -> bool. The keys are prefixes to the user's bound key
  // mappings.
  keyMappingsPrefixes: null,
  modeToKeyToCommand: null,
  isTextEditing: false,
  editingObserver: null,
  textInputSuppressionUntil: 0,
  textInputSuppressionDocument: null,
  textInputSuppressionMs: 500,
  shortcutDebugLogKey: "slidekeysDebugLog",
  shortcutDebugLogLimit: 100,
  mainWorldShortcutConfigKey: "slidekeysMainWorldShortcutConfig",
  mainWorldConfigMessageType: "slidekeys-main-world-config",
  mainWorldShortcutMessageType: "slidekeys-main-world-shortcut",
  mainWorldTextInputSuppressionMessageType: "slidekeys-main-world-text-input-suppression",
  mainWorldTextRestoreMessageType: "slidekeys-main-world-text-restore",
  mainWorldImeClearMessageType: "slidekeys-main-world-ime-clear",
  mainWorldImeClearResultMessageType: "slidekeys-main-world-ime-clear-result",
  commandModeStateMessageType: "slidekeys-command-mode-state",
  extensionCommandMessageType: "slidekeys-extension-command",
  extensionCommandFallbacks: {
    "<C-S>": "setLineSpacing115",
  },
  commandModeActive: false,
  commandModeFocusElement: null,
  commandModeOverlayElement: null,
  commandModePreviousActiveElement: null,
  commandModeTimeoutId: null,
  commandModeTimeoutMs: 3000,
  commandModeLeaderCandidate: false,
  forwardedCommandModeSources: [],
  forwardedCommandModeWindowMs: 3500,
  recentMainWorldShortcutEvents: [],
  recentMainWorldShortcutWindowMs: 100,
  imeTextRollbackBuffer: "",
  imeTextRollbackBufferUntil: 0,
  textInputSuppressionEventTypes: [
    "keypress",
    "beforeinput",
    "textInput",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "input",
  ],

  init() {
    // Key event handlers fire on window before they do on document. Prefer window for key events so
    // the page can't set handlers to grab keys before this extension does.
    this._addShortcutEventListeners(window);
    try {
      this._setupEditingDetector();
    } catch (error) {
      console.log("Error initializing text editing detector:", error);
    }
    window.addEventListener("message", (e) => this._onWindowMessage(e), false);

    this._loadKeyMappings();
    this._publishCommandModeState();

    // If a key mapping setting is changed from another tab, update this tab's key mappings.
    chrome.runtime.onMessage.addListener((message) => {
      this._onRuntimeMessage(message);
    });
  },

  _onRuntimeMessage(message) {
    if (message == "keyMappingChange") {
      this._loadKeyMappings();
      return;
    }

    if (message && message.type === this.extensionCommandMessageType) {
      if (this._shouldForwardRuntimeMessageToTop()) {
        this._forwardRuntimeMessageToTop(message);
        return;
      }
      this._onExtensionCommand(message.commandName);
    }
  },

  _onExtensionCommand(commandName) {
    const hasLocalCommandMode = this.commandModeActive;
    if (!hasLocalCommandMode && !this._hasForwardedCommandModeSource()) {
      this.keyQueue = [];
      this._debugCommandDispatch(commandName, "chromeCommand", "ignoredCommandModeInactive");
      return;
    }
    this.keyQueue = [];
    this._invokeCommand(commandName, "chromeCommand");
    if (hasLocalCommandMode) {
      this._exitCommandMode({ reason: "command", restoreFocus: false });
    } else {
      this.forwardedCommandModeSources = [];
    }
  },

  _getExtensionCommandFallback(keyString) {
    if (!keyString) return null;
    return this.extensionCommandFallbacks[keyString] || null;
  },

  _isRightCommandEvent(e) {
    if (!e) return false;
    return e.code === "MetaRight" ||
      (e.key === "Meta" && e.location === 2) ||
      e.keyCode === 93 ||
      e.which === 93;
  },

  _isCommandModeLeaderKeydown(e) {
    if (!e || e.repeat) return false;
    if (e.altKey || e.ctrlKey || e.shiftKey) return false;
    return this._isRightCommandEvent(e);
  },

  _onCommandModeLeaderKeydown(e, keyString) {
    this.commandModeLeaderCandidate = true;
    this._debugShortcutDetection(keyString, "commandModeLeaderArmed", e);
  },

  _onKeyup(e) {
    if (!this._isRightCommandEvent(e)) return;
    if (!this.commandModeLeaderCandidate) return;

    this.commandModeLeaderCandidate = false;
    const keyString = KeyboardUtils.getKeyString(e);
    this._debugShortcutDetection(keyString, "commandModeLeader", e);
    this._enterCommandMode(e);
    this._cancelEvent(e, keyString);
  },

  _enterCommandMode(e) {
    const eventDocument = this._getEventDocument(e);
    const wasActive = this.commandModeActive;

    this.commandModeActive = true;
    this.keyQueue = [];
    if (!wasActive) {
      this.commandModePreviousActiveElement = eventDocument ? eventDocument.activeElement : null;
    }

    this._ensureCommandModeElements(eventDocument);
    this._updateCommandModeOverlay();
    this._focusCommandModeElement();
    this._resetCommandModeTimeout();
    this._publishCommandModeState();
    this._debugCommandMode("enter", e);
  },

  _ensureCommandModeElements(doc) {
    if (!doc || !doc.createElement || !doc.body) return;
    if (
      this.commandModeFocusElement && this.commandModeFocusElement.ownerDocument === doc &&
      this.commandModeFocusElement.parentNode
    ) {
      return;
    }

    const focusElement = doc.createElement("div");
    focusElement.id = "slidekeys-command-mode-focus";
    focusElement.tabIndex = -1;
    focusElement.setAttribute("aria-hidden", "true");
    this._applyCommandModeStyles(focusElement, {
      height: "1px",
      left: "-10000px",
      opacity: "0",
      outline: "none",
      overflow: "hidden",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "1px",
      zIndex: "2147483647",
    });

    const overlayElement = doc.createElement("div");
    overlayElement.id = "slidekeys-command-mode-overlay";
    overlayElement.setAttribute("role", "status");
    this._applyCommandModeStyles(overlayElement, {
      background: "rgba(32, 33, 36, 0.94)",
      borderRadius: "6px",
      bottom: "24px",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.28)",
      color: "#fff",
      display: "none",
      font: "12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      left: "50%",
      maxWidth: "260px",
      padding: "6px 10px",
      pointerEvents: "none",
      position: "fixed",
      transform: "translateX(-50%)",
      whiteSpace: "nowrap",
      zIndex: "2147483647",
    });

    doc.body.appendChild(focusElement);
    doc.body.appendChild(overlayElement);
    this.commandModeFocusElement = focusElement;
    this.commandModeOverlayElement = overlayElement;
  },

  _applyCommandModeStyles(el, styles) {
    if (!el || !el.style) return;
    for (const [name, value] of Object.entries(styles)) {
      el.style[name] = value;
    }
  },

  _focusCommandModeElement() {
    const el = this.commandModeFocusElement;
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus({ preventScroll: true });
    } catch (error) {
      el.focus();
    }
  },

  _resetCommandModeTimeout() {
    if (this.commandModeTimeoutId) {
      clearTimeout(this.commandModeTimeoutId);
      this.commandModeTimeoutId = null;
    }
    this.commandModeTimeoutId = setTimeout(() => {
      this._exitCommandMode({ reason: "timeout", restoreFocus: true });
    }, this.commandModeTimeoutMs);
  },

  _exitCommandMode(options = {}) {
    if (!this.commandModeActive) return;

    const restoreFocus = !!options.restoreFocus;
    const previousActiveElement = this.commandModePreviousActiveElement;

    this.commandModeActive = false;
    this.commandModeLeaderCandidate = false;
    this.keyQueue = [];
    if (this.commandModeTimeoutId) {
      clearTimeout(this.commandModeTimeoutId);
      this.commandModeTimeoutId = null;
    }
    if (this.commandModeOverlayElement && this.commandModeOverlayElement.style) {
      this.commandModeOverlayElement.style.display = "none";
    }
    if (
      restoreFocus && previousActiveElement && typeof previousActiveElement.focus === "function"
    ) {
      try {
        previousActiveElement.focus({ preventScroll: true });
      } catch (error) {
        previousActiveElement.focus();
      }
    }
    this.commandModePreviousActiveElement = null;
    this._publishCommandModeState();
    this._debugCommandMode(options.reason || "exit");
  },

  _updateCommandModeOverlay() {
    const overlayElement = this.commandModeOverlayElement;
    if (!overlayElement) return;
    overlayElement.textContent = this.keyQueue.length
      ? `SlideKeys: ${this.keyQueue.join(" ")}`
      : "SlideKeys";
    if (overlayElement.style) overlayElement.style.display = "block";
  },

  _publishCommandModeState() {
    const state = { active: !!this.commandModeActive };
    try {
      window.postMessage({
        type: this.commandModeStateMessageType,
        ...state,
      }, "*");
      if (window.top && window.top !== window) {
        window.top.postMessage({
          type: this.commandModeStateMessageType,
          forwardedFromSlideKeysFrame: true,
          ...state,
        }, "*");
      }
    } catch (error) {
      // Main-world command-mode gating is best effort.
    }
  },

  _shouldForwardRuntimeMessageToTop() {
    return window.top && window.top !== window;
  },

  _forwardRuntimeMessageToTop(message) {
    try {
      window.top.postMessage({
        ...message,
        forwardedFromSlideKeysFrame: true,
      }, "*");
    } catch (error) {
      // If forwarding fails, leave the command unhandled instead of running DOM actions in a frame.
    }
  },

  async _loadKeyMappings() {
    console.log("ui.js: loading key mappings");
    try {
      const mappings = await Settings.generateUserKeyMappings();
      this.modeToKeyToCommand = {};
      for (const mode of Object.keys(mappings)) {
        const m = mappings[mode];
        this.modeToKeyToCommand[mode] = Utils.invertObjectMap(m);
      }

      // // Since we don't expose in the UI the concept of mappings for insert mode commands, for
      // // commands that exist in both modes, use the mappings defined for normal mode.
      // for (const [commandName, insertKey] of Object.entries(mappings["insert"])) {
      //   const normalKey = mappings.normal[commandName];
      //   if (normalKey) {
      //     delete this.modeToKeyToCommand["insert"][insertKey];
      //     this.modeToKeyToCommand["insert"][normalKey] = commandName;
      //   }
      // }

      this.keyMappingsPrefixes = this._buildKeyMappingsPrefixes(mappings);
      this._publishMainWorldShortcutConfig();
      console.log("ui.js: key mappings loaded");
    } catch (error) {
      console.log("Error loading key mappings:", error);
      this.modeToKeyToCommand = {};
      this.keyMappingsPrefixes = {};
      this._publishMainWorldShortcutConfig();
    }
  },

  _publishMainWorldShortcutConfig() {
    const config = {
      keyMappingsPrefixes: this.keyMappingsPrefixes || {},
      maxKeyMappingLength: this.maxKeyMappingLength,
      modeToKeyToCommand: this.modeToKeyToCommand || {},
    };
    try {
      localStorage.setItem(this.mainWorldShortcutConfigKey, JSON.stringify(config));
    } catch (error) {
      // Main-world interception is a best-effort guard.
    }
    window.postMessage({
      type: this.mainWorldConfigMessageType,
      config,
    }, "*");
  },

  _onWindowMessage(event) {
    if (!event.data) return;
    if (event.data.type === this.commandModeStateMessageType) {
      this._onCommandModeStateMessage(event);
      return;
    }
    if (event.data.type === this.mainWorldShortcutMessageType) {
      if (this._shouldForwardShortcutMessageToTop(event)) {
        this._forwardShortcutMessageToTop(event.data);
        this._updateLocalCommandModeFromForwardedShortcut(event.data);
        return;
      }
      if (!this._isTrustedShortcutMessage(event)) return;
      this._onMainWorldShortcut(event.data, event.source);
      return;
    }
    if (event.data.type === this.extensionCommandMessageType) {
      if (!this._isTrustedForwardedMessage(event)) return;
      this._onExtensionCommand(event.data.commandName);
      return;
    }
    if (event.source !== window) return;
    if (event.data.type === this.mainWorldTextInputSuppressionMessageType) {
      this._debugMainWorldTextInputSuppression(event.data);
      return;
    }
    if (event.data.type === this.mainWorldTextRestoreMessageType) {
      this._debugMainWorldTextRestore(event.data);
      return;
    }
    if (event.data.type === this.mainWorldImeClearResultMessageType) {
      this._debugMainWorldImeClear(event.data);
    }
  },

  _shouldForwardShortcutMessageToTop(event) {
    return event.source === window && window.top && window.top !== window &&
      !event.data.forwardedFromSlideKeysFrame;
  },

  _forwardShortcutMessageToTop(message) {
    try {
      window.top.postMessage({
        ...message,
        forwardedFromSlideKeysFrame: true,
      }, "*");
    } catch (error) {
      // If forwarding fails, leave the shortcut unhandled instead of running DOM actions in a frame.
    }
  },

  _isTrustedShortcutMessage(event) {
    return this._isTrustedForwardedMessage(event);
  },

  _isTrustedForwardedMessage(event) {
    return event.source === window || !!event.data.forwardedFromSlideKeysFrame;
  },

  _onCommandModeStateMessage(event) {
    if (event.source === window) return;
    if (!event.data.forwardedFromSlideKeysFrame) return;
    this._rememberForwardedCommandModeSource(event.source, event.data.active);
  },

  _rememberForwardedCommandModeSource(source, active) {
    if (!source) return;
    const now = Date.now();
    this.forwardedCommandModeSources = this.forwardedCommandModeSources.filter((entry) =>
      entry.source !== source && entry.until > now
    );
    if (active) {
      this.forwardedCommandModeSources.push({
        source,
        until: now + this.forwardedCommandModeWindowMs,
      });
    }
  },

  _hasForwardedCommandModeSource(source) {
    const now = Date.now();
    this.forwardedCommandModeSources = this.forwardedCommandModeSources.filter((entry) =>
      entry.until > now
    );
    if (!source) return this.forwardedCommandModeSources.length > 0;
    return this.forwardedCommandModeSources.some((entry) => entry.source === source);
  },

  _onMainWorldShortcut(message, messageSource) {
    this._rememberMainWorldShortcutEvent(message.event);
    this._debugMainWorldShortcut(message);

    if (!this.commandModeActive && !this._hasForwardedCommandModeSource(messageSource)) {
      this.keyQueue = [];
      return;
    }

    if (message.isPrefix) {
      this.keyQueue = message.keySequence ? message.keySequence.split(Commands.KEY_SEPARATOR) : [];
      this._suppressFollowingTextInputFromMainWorld(message);
      if (this.commandModeActive) {
        this._updateCommandModeOverlay();
        this._resetCommandModeTimeout();
      }
      return;
    }

    if (message.commandName) {
      this.keyQueue = [];
      this._suppressFollowingTextInputFromMainWorld(message);
      this._invokeCommand(message.commandName, message.commandSource || "mainWorld", {
        event: message.event,
        messageSource,
      });
      if (this.commandModeActive) {
        this._exitCommandMode({ reason: "command", restoreFocus: false });
      } else {
        this._rememberForwardedCommandModeSource(messageSource, false);
      }
    }
  },

  _updateLocalCommandModeFromForwardedShortcut(message) {
    if (!this.commandModeActive) return;

    if (message.isPrefix) {
      this.keyQueue = message.keySequence ? message.keySequence.split(Commands.KEY_SEPARATOR) : [];
      this._suppressFollowingTextInputFromMainWorld(message);
      this._updateCommandModeOverlay();
      this._resetCommandModeTimeout();
      return;
    }

    if (message.commandName) {
      this.keyQueue = [];
      this._suppressFollowingTextInputFromMainWorld(message);
      this._exitCommandMode({ reason: "command", restoreFocus: false });
    }
  },

  _invokeCommand(commandName, source, metadata = {}) {
    const command = Commands.commands[commandName];
    if (!command) {
      this._debugCommandDispatch(commandName, source, "missing");
      return;
    }

    this._debugCommandDispatch(commandName, source, "start");
    try {
      const result = command.fn();
      if (result && typeof result.then === "function") {
        result.then(
          () => {
            this._debugCommandDispatch(commandName, source, "success");
            this._notifyMainWorldImeShortcutComplete(metadata);
          },
          (error) => {
            this._debugCommandDispatch(commandName, source, "error", error);
            console.log("SlideKeys command failed", commandName, error);
          },
        );
      } else {
        this._debugCommandDispatch(commandName, source, "success");
        this._notifyMainWorldImeShortcutComplete(metadata);
      }
    } catch (error) {
      this._debugCommandDispatch(commandName, source, "error", error);
      console.log("SlideKeys command failed", commandName, error);
    }
  },

  _notifyMainWorldImeShortcutComplete(metadata) {
    if (!metadata || !metadata.event || metadata.event.keyCode !== 229) return;
    const targetWindow =
      metadata.messageSource && typeof metadata.messageSource.postMessage === "function"
        ? metadata.messageSource
        : window;
    try {
      targetWindow.postMessage({
        type: this.mainWorldImeClearMessageType,
        event: metadata.event,
      }, "*");
    } catch (error) {
      // IME cleanup is best-effort after the command has already run.
    }
  },

  _rememberMainWorldShortcutEvent(eventMetadata) {
    if (!eventMetadata) return;
    this.recentMainWorldShortcutEvents.push({
      code: eventMetadata.code,
      keyCode: eventMetadata.keyCode,
      time: Date.now(),
      which: eventMetadata.which,
    });
    if (this.recentMainWorldShortcutEvents.length > 20) {
      this.recentMainWorldShortcutEvents.splice(0, this.recentMainWorldShortcutEvents.length - 20);
    }
  },

  _wasRecentlyHandledByMainWorld(e) {
    if (!e) return false;
    const now = Date.now();
    this.recentMainWorldShortcutEvents = this.recentMainWorldShortcutEvents.filter(
      (entry) => now - entry.time <= this.recentMainWorldShortcutWindowMs,
    );
    return this.recentMainWorldShortcutEvents.some((entry) =>
      entry.code === e.code && entry.keyCode === e.keyCode && entry.which === e.which
    );
  },

  _suppressFollowingTextInputFromMainWorld(message) {
    if (!message || !message.keyString || message.keyString.length !== 1) return;
    this.textInputSuppressionUntil = Date.now() + this.textInputSuppressionMs;
    this.textInputSuppressionDocument = typeof document !== "undefined" ? document : null;
    this._rememberImeShortcutTextForRollback(message.keyString);
  },

  // Returns a map of (partial keyString) => is_bound?
  // Note that the keys only include partial keystrings for mappings. So the mapping "d•a•p" will
  // add "d" and "d•a" keys to this map, but not "d•a•p".
  _buildKeyMappingsPrefixes(keyMappings) {
    const prefixes = {};
    for (const mode in keyMappings) {
      prefixes[mode] = {};
      const modeKeyMappings = keyMappings[mode];
      for (const command of Object.keys(modeKeyMappings)) {
        const keyString = modeKeyMappings[command];
        // If the bound action is null, then treat this key as unbound.
        if (!keyString) continue;
        const keys = keyString.split(Commands.KEY_SEPARATOR);
        for (let i = 0; i < keys.length - 1; i++) {
          const prefix = keys.slice(0, i + 1).join(Commands.KEY_SEPARATOR);
          prefixes[mode][prefix] = true;
        }
      }
    }
    return prefixes;
  },

  _cancelEvent(e, keyString) {
    this._suppressFollowingTextInput(e, keyString);
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  },

  _addShortcutEventListeners(eventTarget) {
    eventTarget.addEventListener("keydown", (e) => this._onKeydown(e), true);
    eventTarget.addEventListener("keyup", (e) => this._onKeyup(e), true);
    for (const eventType of this.textInputSuppressionEventTypes) {
      eventTarget.addEventListener(eventType, (e) => this._onPotentialShortcutTextInput(e), true);
    }
  },

  _suppressFollowingTextInput(e, keyString) {
    if (!this._shouldGuardConsumedKeyTextInput(e, keyString)) return;
    this.textInputSuppressionUntil = Date.now() + this.textInputSuppressionMs;
    this.textInputSuppressionDocument = this._getEventDocument(e);
    this._rememberImeShortcutTextForRollback(keyString);
    this._scheduleImeTextMutationRollback(e, keyString);
  },

  _shouldGuardConsumedKeyTextInput(e, keyString) {
    if (!e || !keyString || keyString.length !== 1) return false;
    return !e.altKey && !e.ctrlKey && !e.metaKey;
  },

  _onPotentialShortcutTextInput(e) {
    if (!this._shouldSuppressPotentialShortcutTextInput(e)) return;
    if (e.cancelable !== false && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
    this._debugShortcutTextInputSuppression(e);
  },

  _shouldSuppressPotentialShortcutTextInput(e) {
    if (!this.textInputSuppressionUntil || Date.now() > this.textInputSuppressionUntil) {
      return false;
    }
    if (!this._isPotentialShortcutTextInsertion(e)) return false;

    const eventDocument = this._getEventDocument(e);
    return !this.textInputSuppressionDocument || !eventDocument ||
      eventDocument === this.textInputSuppressionDocument;
  },

  _isPotentialShortcutTextInsertion(e) {
    if (!e) return false;
    if (e.type === "beforeinput" || e.type === "input") {
      const inputType = e.inputType || "";
      return !inputType || inputType.startsWith("insert");
    }
    return true;
  },

  _rememberImeShortcutTextForRollback(keyString) {
    if (!keyString || keyString.length !== 1) return;

    const now = Date.now();
    if (now > this.imeTextRollbackBufferUntil) {
      this.imeTextRollbackBuffer = "";
    }
    this.imeTextRollbackBuffer = (this.imeTextRollbackBuffer + keyString).slice(
      -this.maxKeyMappingLength,
    );
    this.imeTextRollbackBufferUntil = now + this.textInputSuppressionMs;
  },

  _scheduleImeTextMutationRollback(e, keyString) {
    if (!keyString || keyString.length !== 1) return;
    if (!e || !e.target || e.target.nodeType !== 1) return;
    if (typeof MutationObserver === "undefined") return;

    const target = this._getImeTextMutationRoot(e);
    if (!target) return;
    let timeoutId = null;
    const observer = new MutationObserver((mutations) => {
      let rolledBack = false;
      for (const mutation of Array.from(mutations)) {
        rolledBack = this._rollbackImeShortcutTextMutation(mutation, keyString) || rolledBack;
      }
      if (!rolledBack) return;

      this.imeTextRollbackBuffer = "";
      this.imeTextRollbackBufferUntil = 0;
      observer.disconnect();
      clearTimeout(timeoutId);
      this._debugImeTextMutationRollback(e, keyString);
    });

    try {
      observer.observe(target, {
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
      });
      this._debugImeTextMutationRollbackScheduled(e, keyString, target);
      timeoutId = setTimeout(() => observer.disconnect(), this.textInputSuppressionMs);
    } catch (error) {
      observer.disconnect();
    }
  },

  _getImeTextMutationRoot(e) {
    const eventDocument = this._getEventDocument(e);
    if (eventDocument && eventDocument.body) return eventDocument.body;
    return e && e.target && e.target.nodeType === 1 ? e.target : null;
  },

  _rollbackImeShortcutTextMutation(mutation, keyString) {
    if (!mutation) return false;

    const candidates = this._getImeTextRollbackCandidates(keyString);
    if (mutation.type === "characterData" && mutation.target) {
      for (const candidate of candidates) {
        if (
          this._isSingleInsertedShortcutText(
            mutation.target.data,
            mutation.oldValue,
            candidate,
          )
        ) {
          mutation.target.data = mutation.oldValue;
          return true;
        }
      }
    }

    if (mutation.type === "childList") {
      let rolledBack = false;
      for (const node of Array.from(mutation.addedNodes || [])) {
        for (const candidate of candidates) {
          if (this._nodeTextMatchesShortcutInsertion(node, candidate)) {
            if (node.parentNode) node.parentNode.removeChild(node);
            rolledBack = true;
            break;
          }
        }
      }
      return rolledBack;
    }

    return false;
  },

  _getImeTextRollbackCandidates(keyString) {
    const candidates = [];
    if (Date.now() <= this.imeTextRollbackBufferUntil && this.imeTextRollbackBuffer) {
      candidates.push(this.imeTextRollbackBuffer);
    }
    if (keyString && !candidates.includes(keyString)) candidates.push(keyString);
    return candidates.sort((a, b) => b.length - a.length);
  },

  _isSingleInsertedShortcutText(currentText, previousText, insertedText) {
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
  },

  _nodeTextMatchesShortcutInsertion(node, insertedText) {
    if (!node || !insertedText) return false;
    const nodeText = node.nodeType === 3 ? node.data : node.textContent;
    return nodeText === insertedText;
  },

  _setupEditingDetector(retries = 0) {
    const rulerEl = document.querySelector("#sketchy-horizontal-ruler");
    if (!rulerEl) {
      if (retries < 30) {
        setTimeout(() => this._setupEditingDetector(retries + 1), 1000);
      }
      return;
    }
    const updateEditingState = () => {
      this._updateLegacyTextEditingState(document);
    };
    updateEditingState();
    this.editingObserver = new MutationObserver(updateEditingState);
    try {
      this.editingObserver.observe(rulerEl, {
        attributes: true,
        attributeFilter: ["style", "class"],
        childList: true,
        subtree: true,
      });
    } catch (error) {
      console.log("Error setting up text editing detector:", error);
      this.editingObserver = null;
    }
  },

  _updateLegacyTextEditingState(doc) {
    const legacyMaterialEl = doc.querySelector(
      "#sketchy-horizontal-ruler > div > div.docs-material",
    );
    this.isTextEditing = legacyMaterialEl ? this._isElementVisible(legacyMaterialEl) : false;
  },

  _getShortcutSuppressionReason(e) {
    if (this.ignoreKeys) return "ignoreKeys";
    if (SlideActions.mode == "disabled") return "disabledMode";
    if (this.isTextEditing) return "legacyTextEditing";
    if (this._eventHasTextboxCaret(e)) return "textboxCaret";
    if (this._eventHasEditableTarget(e)) return "editableTarget";
    if (this._hasVisibleBlockingUi(this._getEventDocument(e))) return "blockingUi";
    return null;
  },

  _eventHasTextboxCaret(e) {
    const eventDocument = this._getEventDocument(e);
    const selection = this._getDocumentSelection(eventDocument);
    if (!selection || !selection.isCollapsed || selection.rangeCount < 1) return false;
    if (selection.type && selection.type !== "Caret") return false;

    const candidates = this._getEventPath(e);
    if (eventDocument && eventDocument.activeElement) {
      candidates.push(eventDocument.activeElement);
    }
    return candidates.some((el) => this._elementHasRole(el, "textbox"));
  },

  _eventHasEditableTarget(e) {
    const candidates = this._getEventPath(e);
    const eventDocument = this._getEventDocument(e);
    if (eventDocument && eventDocument.activeElement) {
      candidates.push(eventDocument.activeElement);
    }
    if (typeof document !== "undefined" && document.activeElement) {
      candidates.push(document.activeElement);
    }
    return candidates.some((el) =>
      this._isEditableElement(el) && !this._isIgnoredDocsTextEventTargetElement(el)
    );
  },

  _getEventPath(e) {
    if (!e) return [];
    if (typeof e.composedPath === "function") {
      try {
        return e.composedPath();
      } catch (error) {
        console.log("Error reading event composedPath:", error);
      }
    }

    const path = [];
    let el = e.target;
    while (el) {
      path.push(el);
      el = el.parentElement || el.parentNode || el.host;
    }
    return path;
  },

  _getEventDocument(e) {
    if (e && e.target && e.target.ownerDocument) return e.target.ownerDocument;
    if (typeof document !== "undefined") return document;
    return null;
  },

  _isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;

    const tagName = el.tagName ? el.tagName.toLowerCase() : "";
    if (["input", "textarea", "select"].includes(tagName)) return true;
    if (el.isContentEditable) return true;

    const contentEditable = el.getAttribute && el.getAttribute("contenteditable");
    if (contentEditable != null && contentEditable.toLowerCase() !== "false") return true;

    const role = el.getAttribute && el.getAttribute("role");
    if (role === "textbox") return true;
    if (el.getAttribute && el.getAttribute("aria-multiline") === "true") return true;

    return false;
  },

  _getDocumentSelection(doc) {
    if (!doc || typeof doc.getSelection !== "function") return null;
    try {
      return doc.getSelection();
    } catch (error) {
      return null;
    }
  },

  _elementHasRole(el, role) {
    return !!(el && el.nodeType === 1 && el.getAttribute && el.getAttribute("role") === role);
  },

  _isIgnoredDocsTextEventTargetElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (this._elementHasClass(el, "docs-texteventtarget-iframe")) return true;

    const elementDocument = el.ownerDocument;
    const frameEl = elementDocument && elementDocument.defaultView
      ? elementDocument.defaultView.frameElement
      : null;
    return this._elementHasClass(frameEl, "docs-texteventtarget-iframe");
  },

  _elementHasClass(el, className) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList && typeof el.classList.contains === "function") {
      return el.classList.contains(className);
    }
    return String(el.className || "").split(/\s+/).includes(className);
  },

  _hasVisibleBlockingUi(doc) {
    if (!doc) return false;
    const selectors = [
      "[role='dialog']",
      ".goog-modaldialog",
      ".goog-modalpopup",
      ".modal-dialog",
      "[role='menu']",
      ".goog-menu",
    ];
    return selectors.some((selector) => {
      const els = Array.from(doc.querySelectorAll(selector));
      return els.some((el) => this._isElementVisible(el));
    });
  },

  _isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;

    const elementDocument = el.ownerDocument || (typeof document !== "undefined" ? document : null);
    const elementWindow = elementDocument && elementDocument.defaultView
      ? elementDocument.defaultView
      : (typeof window !== "undefined" ? window : null);
    const style = elementWindow && elementWindow.getComputedStyle
      ? elementWindow.getComputedStyle(el)
      : (el.style || {});
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (
      style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { width: el.offsetWidth || 0, height: el.offsetHeight || 0 };
    if (rect.width > 0 || rect.height > 0) {
      if (elementWindow && elementWindow.innerWidth && elementWindow.innerHeight) {
        if (
          rect.right <= 0 || rect.bottom <= 0 || rect.left >= elementWindow.innerWidth ||
          rect.top >= elementWindow.innerHeight
        ) {
          return false;
        }
      }
      return true;
    }
    return !!(el.getClientRects && el.getClientRects().length > 0);
  },

  _debugShortcutDetection(keyString, suppressionReason, e) {
    if (!this._shortcutDebugEnabled()) return;

    const eventDocument = this._getEventDocument(e);
    if (!eventDocument) return;
    const rulerEl = eventDocument.querySelector("#sketchy-horizontal-ruler");
    const legacyMaterialEl = eventDocument.querySelector(
      "#sketchy-horizontal-ruler > div > div.docs-material",
    );
    const textEventIframes = Array.from(
      eventDocument.querySelectorAll(".docs-texteventtarget-iframe"),
    ).map((el) => ({
      className: String(el.className || ""),
      id: el.id || "",
    }));

    const debugEntry = {
      kind: "shortcutDetection",
      key: this._describeKeyForShortcutDebug(keyString),
      event: this._describeKeyboardEventForShortcutDebug(e),
      suppressionReason: suppressionReason || "none",
      target: this._describeElementForShortcutDebug(e && e.target),
      activeElement: this._describeElementForShortcutDebug(eventDocument.activeElement),
      path: this._getEventPath(e).slice(0, 8).map((el) =>
        this._describeElementForShortcutDebug(el)
      ),
      ruler: {
        exists: !!rulerEl,
        visible: this._isElementVisible(rulerEl),
        legacyMaterialExists: !!legacyMaterialEl,
        legacyMaterialVisible: this._isElementVisible(legacyMaterialEl),
      },
      textEventIframes,
      selection: this._describeSelectionForShortcutDebug(eventDocument),
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys shortcut detection", debugEntry);
  },

  _debugShortcutTextInputSuppression(e) {
    if (!this._shortcutDebugEnabled()) return;

    const eventDocument = this._getEventDocument(e);
    const debugEntry = {
      kind: "textInputSuppression",
      event: this._describeTextInputEventForShortcutDebug(e),
      target: this._describeElementForShortcutDebug(e && e.target),
      activeElement: eventDocument
        ? this._describeElementForShortcutDebug(eventDocument.activeElement)
        : null,
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys suppressed follow-up text input", debugEntry);
  },

  _debugImeTextMutationRollback(e, keyString) {
    if (!this._shortcutDebugEnabled()) return;

    const eventDocument = this._getEventDocument(e);
    const debugEntry = {
      kind: "imeTextMutationRollback",
      key: this._describeKeyForShortcutDebug(keyString),
      event: this._describeKeyboardEventForShortcutDebug(e),
      target: this._describeElementForShortcutDebug(e && e.target),
      activeElement: eventDocument
        ? this._describeElementForShortcutDebug(eventDocument.activeElement)
        : null,
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys rolled back IME shortcut text", debugEntry);
  },

  _debugImeTextMutationRollbackScheduled(e, keyString, root) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "imeTextMutationRollbackScheduled",
      key: this._describeKeyForShortcutDebug(keyString),
      event: this._describeKeyboardEventForShortcutDebug(e),
      target: this._describeElementForShortcutDebug(e && e.target),
      root: this._describeElementForShortcutDebug(root),
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys armed IME shortcut text rollback", debugEntry);
  },

  _debugMainWorldShortcut(message) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "mainWorldShortcut",
      commandName: message.commandName || null,
      dispatchDelayMs: message.dispatchDelayMs || 0,
      event: message.event || null,
      isPrefix: !!message.isPrefix,
      key: this._describeKeyForShortcutDebug(message.keyString),
      keySequenceLength: message.keySequence
        ? message.keySequence.split(Commands.KEY_SEPARATOR).length
        : 0,
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys main-world shortcut", debugEntry);
  },

  _debugMainWorldTextInputSuppression(message) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "mainWorldTextInputSuppression",
      event: message.event || null,
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys main-world text input suppression", debugEntry);
  },

  _debugMainWorldTextRestore(message) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "mainWorldTextRestore",
      metrics: message.metrics || null,
      reason: message.reason || "",
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys main-world text restore", debugEntry);
  },

  _debugMainWorldImeClear(message) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "mainWorldImeClear",
      metadata: message.metadata || null,
      reason: message.reason || "",
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys main-world IME clear", debugEntry);
  },

  _debugSlideAction(message) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "slideAction",
      actionType: message.actionType || "",
      metadata: message.metadata || null,
      step: message.step || "",
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys slide action", debugEntry);
  },

  _debugCommandDispatch(commandName, source, status, error) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "commandDispatch",
      commandName: commandName || "",
      errorName: error && error.name ? String(error.name) : "",
      source: source || "",
      status: status || "",
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys command dispatch", debugEntry);
  },

  _debugCommandMode(step, e) {
    if (!this._shortcutDebugEnabled()) return;

    const debugEntry = {
      kind: "commandMode",
      event: this._describeKeyboardEventForShortcutDebug(e),
      keyQueueLength: this.keyQueue.length,
      step: step || "",
    };
    this._recordShortcutDebugEntry(debugEntry);
    console.log("SlideKeys command mode", debugEntry);
  },

  _recordShortcutDebugEntry(entry) {
    try {
      const existingLog = JSON.parse(localStorage.getItem(this.shortcutDebugLogKey) || "[]");
      const log = Array.isArray(existingLog) ? existingLog : [];
      log.push(entry);
      if (log.length > this.shortcutDebugLogLimit) {
        log.splice(0, log.length - this.shortcutDebugLogLimit);
      }
      localStorage.setItem(this.shortcutDebugLogKey, JSON.stringify(log));
    } catch (error) {
      // Debug logging must never affect shortcut handling.
    }
  },

  _describeKeyboardEventForShortcutDebug(e) {
    if (!e) return null;
    return {
      type: e.type || "",
      code: e.code || "",
      key: e.key && e.key.length === 1 ? "" : e.key || "",
      keyCode: e.keyCode,
      location: e.location,
      which: e.which,
      rawKeyCategory: this._rawKeyCategoryForShortcutDebug(e.key),
      isComposing: !!e.isComposing,
      altKey: !!e.altKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey,
    };
  },

  _describeTextInputEventForShortcutDebug(e) {
    if (!e) return null;
    return {
      type: e.type || "",
      inputType: e.inputType || "",
      cancelable: e.cancelable,
      isComposing: !!e.isComposing,
    };
  },

  _rawKeyCategoryForShortcutDebug(key) {
    if (!key) return "empty";
    if (key === "Process") return "process";
    if (key.length === 1) return "singleCharacter";
    return "named";
  },

  _describeSelectionForShortcutDebug(doc) {
    try {
      const selection = this._getDocumentSelection(doc);
      if (!selection) return null;
      return {
        type: selection.type || "",
        isCollapsed: selection.isCollapsed,
        rangeCount: selection.rangeCount,
        anchorNode: this._describeSelectionNodeForShortcutDebug(selection.anchorNode),
        focusNode: this._describeSelectionNodeForShortcutDebug(selection.focusNode),
        anchorOffset: selection.anchorOffset,
        focusOffset: selection.focusOffset,
      };
    } catch (error) {
      return { error: String(error && error.name || error) };
    }
  },

  _describeSelectionNodeForShortcutDebug(node) {
    if (!node) return null;
    if (node.nodeType === 3) {
      return {
        nodeType: "text",
        parent: this._describeElementForShortcutDebug(node.parentElement),
      };
    }
    return this._describeElementForShortcutDebug(node);
  },

  _shortcutDebugEnabled() {
    try {
      return localStorage.getItem("slidekeysDebugShortcuts") === "1";
    } catch (error) {
      return false;
    }
  },

  _describeElementForShortcutDebug(el) {
    if (!el || el.nodeType !== 1) return null;
    return {
      tagName: el.tagName,
      id: el.id || "",
      className: String(el.className || "").slice(0, 160),
      role: el.getAttribute("role"),
      hasAriaLabel: el.hasAttribute && el.hasAttribute("aria-label"),
      contenteditable: el.getAttribute("contenteditable"),
    };
  },

  _describeKeyForShortcutDebug(keyString) {
    if (!keyString) return { category: "none" };
    if (keyString.startsWith("<") && keyString.endsWith(">")) return { category: "modified" };
    if (keyString.length === 1) return { category: "printable" };
    return { category: "named" };
  },

  _onCommandModeKeydown(e, keyString) {
    this._debugShortcutDetection(keyString, "commandMode", e);

    if (keyString === "esc") {
      this._cancelEvent(e, keyString);
      this._exitCommandMode({ reason: "escape", restoreFocus: true });
      return;
    }

    if (!keyString) {
      this._cancelEvent(e, keyString);
      this._resetCommandModeTimeout();
      return;
    }

    const handled = this._handleShortcutKeydown(e, keyString, "commandMode", {
      forceMode: "normal",
      onCommand: () => this._exitCommandMode({ reason: "command", restoreFocus: false }),
      onPrefix: () => {
        this._updateCommandModeOverlay();
        this._resetCommandModeTimeout();
      },
      skipReplaceMode: true,
    });

    if (handled) return;

    this.keyQueue = [];
    this._cancelEvent(e, keyString);
    this._exitCommandMode({ reason: "unmapped", restoreFocus: true });
  },

  _handleShortcutKeydown(e, keyString, source, options = {}) {
    if (!keyString) return false;
    if (!this.modeToKeyToCommand || !this.keyMappingsPrefixes) return false;

    if (!options.skipReplaceMode && SlideActions.mode === "replace") {
      if (keyString === "esc") {
        this._cancelEvent(e, keyString);
        SlideActions.setMode("normal");
      } else {
        SlideActions.changeCell();
        setTimeout(() => SlideActions.commitCellChanges(), 0);
      }
      return true;
    }

    this.keyQueue.push(keyString);
    // There are keymaps for two different modes: insert and normal. When we're in one of the visual
    // modes, use the normal keymap. The commands themselves may implement mode-specific behavior.
    const modeToUse = options.forceMode || (SlideActions.mode == "insert" ? "insert" : "normal");
    if (this.keyQueue.length > this.maxKeyMappingLength) this.keyQueue.shift();
    const modeMappings = this.modeToKeyToCommand[modeToUse] || [];
    const modePrefixes = this.keyMappingsPrefixes[modeToUse] || [];
    // See if a bound command matches the typed key sequence. If so, execute it.
    // Prioritize longer mappings over shorter mappings.
    for (let i = Math.min(this.maxKeyMappingLength, this.keyQueue.length); i >= 1; i--) {
      const keySequence = this.keyQueue.slice(this.keyQueue.length - i, this.keyQueue.length).join(
        Commands.KEY_SEPARATOR,
      );
      // If this key could be part of one of the bound key mapping, don't pass it through to the
      // page. Also, if some longer mapping partially matches this key sequence, then wait for more
      // keys, and don't immediately apply a shorter mapping which also matches this key sequence.
      if (modePrefixes[keySequence]) {
        this._cancelEvent(e, keyString);
        if (options.onPrefix) options.onPrefix(keySequence);
        return true;
      }

      const commandName = modeMappings[keySequence];
      if (commandName) {
        this.keyQueue = [];
        this._cancelEvent(e, keyString);
        this._invokeCommand(commandName, source);
        if (options.onCommand) options.onCommand(commandName);
        return true;
      }
    }

    return false;
  },

  _onKeydown(e) {
    if (this._wasRecentlyHandledByMainWorld(e)) return;

    const keyString = KeyboardUtils.getKeyString(e);
    if (this._isCommandModeLeaderKeydown(e)) {
      this._onCommandModeLeaderKeydown(e, keyString);
      return;
    }
    if (this.commandModeLeaderCandidate) {
      this.commandModeLeaderCandidate = false;
    }

    if (this.commandModeActive) {
      this._onCommandModeKeydown(e, keyString);
      return;
    }

    const suppressionReason = this._getShortcutSuppressionReason(e);
    const mappingsNotLoaded = !this.modeToKeyToCommand || !this.keyMappingsPrefixes;
    this._debugShortcutDetection(
      keyString,
      suppressionReason ||
        (keyString && mappingsNotLoaded ? "mappingsNotLoaded" : "commandModeInactive"),
      e,
    );
    this.keyQueue = [];
  },

  // modifiers: Optional; an object with these boolean properties: meta, shift, control.
  _simulateKeyEvent(keyCode, modifiers) {
    if (keyCode == null) throw "The keyCode provided to typeKey() is null.";
    this.ignoreKeys = true;
    if (!modifiers) modifiers = {};
    document.getElementById("sheetkeys-json-message").innerText = JSON.stringify({
      keyCode,
      mods: modifiers,
    });
    window.dispatchEvent(new CustomEvent("sheetkeys-simulate-key-event", {}));
    this.ignoreKeys = false;
  },

  simulateClick(el, x, y) {
    if (!el) {
      console.log("simulateClick: element is null/undefined; skipping.");
      return;
    }
    if (x == null) x = 0;
    if (y == null) y = 0;
    const eventSequence = ["mouseover", "mousedown", "mouseup", "click"];
    for (const eventName of eventSequence) {
      const event = document.createEvent("MouseEvents");
      event.initMouseEvent(
        eventName,
        true, // bubbles
        true, // cancelable
        window, //view
        1, // event-detail
        x, // screenX
        y, // screenY
        x, // clientX
        y, // clientY
        false, // ctrl
        false, // alt
        false, // shift
        false, // meta
        0, // button
        null, // relatedTarget
      );
      el.dispatchEvent(event);
    }
  },
};

// Don't initialize this Sheets UI if this code is being loaded from our extension's options page.
if (window.document && !document.location.pathname.endsWith("harness.html")) {
  UI.init();
}

window.UI = UI;
