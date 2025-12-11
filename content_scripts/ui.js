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

  init() {
    // Key event handlers fire on window before they do on document. Prefer window for key events so
    // the page can't set handlers to grab keys before this extension does.
    window.addEventListener("keydown", (e) => this._onKeydown(e), true);
    this._setupEditingDetector();

    setTimeout(function () {
      // Function to add a keydown event listener to the document of an iframe
      function addKeydownListenerToIframe(iframe) {
        try {
          // Attempt to access the content document of the iframe
          var iframeDocument = iframe.contentDocument || iframe.contentWindow.document;

          // Add the event listener to the iframe's document
          iframeDocument.addEventListener('keydown', (e) => UI._onKeydown(e), true);

          console.log('Added keydown listener to iframe:', iframe.src);
        } catch (error) {
          console.log('Error accessing iframe:', error);
        }
      }

      // Get all iframes on the page
      var iframes = document.querySelectorAll('iframe');

      // Add the keydown listener to each iframe
      iframes.forEach(addKeydownListenerToIframe);
      console.log('Added keydown listeners to all iframes.');
    }, 5000);
    /////

    this._loadKeyMappings();

    // If a key mapping setting is changed from another tab, update this tab's key mappings.
    chrome.runtime.onMessage.addListener((message) => {
      if (message == "keyMappingChange") {
        this._loadKeyMappings();
      }
    });
  },

  async _loadKeyMappings() {
    console.log("ui.js: loading key mappings");
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

  _cancelEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  },

  _setupEditingDetector() {
    const materialEl = document.querySelector("#sketchy-horizontal-ruler > div > div.docs-material");
    if (!materialEl) {
      setTimeout(() => this._setupEditingDetector(), 1000);
      return;
    }
    const updateEditingState = () => {
      this.isTextEditing = materialEl.style.display !== "none";
    };
    updateEditingState();
    this.editingObserver = new MutationObserver(updateEditingState);
    this.editingObserver.observe(materialEl, { attributes: true, attributeFilter: ["style"] });
  },

  _onKeydown(e) {
    const keyString = KeyboardUtils.getKeyString(e);
    // console.log("keydown event. keyString:", keyString, e.keyCode, e.keyIdentifier, e);
    if (this.ignoreKeys || SlideActions.mode == "disabled" || this.isTextEditing) return;

    // Ignore key presses which are just modifiers.
    if (!keyString) return;

    // In replace mode, we're waiting for one character to be typed, and we will replace the cell's
    // contents with that character and then return to normal mode.
    if (SlideActions.mode === "replace") {
      if (keyString === "esc") {
        this._cancelEvent(e);
        SlideActions.setMode("normal");
      } else {
        SlideActions.changeCell();
        setTimeout(() => SlideActions.commitCellChanges(), 0);
      }
      return;
    }

    this.keyQueue.push(keyString);
    // There are keymaps for two different modes: insert and normal. When we're in one of the visual
    // modes, use the normal keymap. The commands themselves may implement mode-specific behavior.
    const modeToUse = SlideActions.mode == "insert" ? "insert" : "normal";
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
        this._cancelEvent(e);
        return;
      }

      commandName = modeMappings[keySequence];
      if (commandName) {
        this.keyQueue = [];
        this._cancelEvent(e);

        const command = Commands.commands[commandName];

        command.fn();
      }
    }
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
