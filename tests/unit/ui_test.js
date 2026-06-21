import * as shoulda from "../vendor/shoulda.js";
import { assert, context, should } from "../vendor/shoulda.js";

globalThis.window = globalThis;

await import("../../content_scripts/utils.js");
await import("../../content_scripts/slide_actions.js");
await import("../../content_scripts/commands.js");
await import("../../content_scripts/keyboard_utils.js");
await import("../../content_scripts/ui.js");

const Commands = globalThis.Commands;
const KeyboardUtils = globalThis.KeyboardUtils;
const SlideActions = globalThis.SlideActions;
const UI = globalThis.UI;
const Utils = globalThis.Utils;

function fakeElement(options = {}) {
  const attrs = options.attrs || {};
  const style = options.style || {};
  const children = [];
  const width = options.width == null ? 10 : options.width;
  const height = options.height == null ? 10 : options.height;
  const x = options.x == null ? 0 : options.x;
  const y = options.y == null ? 0 : options.y;
  return {
    children,
    nodeType: 1,
    tagName: options.tagName || "DIV",
    id: options.id || "",
    className: options.className || "",
    isContentEditable: !!options.isContentEditable,
    ownerDocument: options.ownerDocument || null,
    parentElement: options.parentElement || null,
    parentNode: options.parentNode || null,
    style: Object.assign({ display: "block", visibility: "visible" }, style),
    getAttribute(name) {
      return attrs[name] == null ? null : attrs[name];
    },
    hasAttribute(name) {
      return attrs[name] != null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    appendChild(child) {
      child.parentElement = this;
      child.parentNode = this;
      if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
      children.push(child);
      return child;
    },
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
      this.focused = true;
    },
    getBoundingClientRect() {
      return {
        bottom: y + height,
        height,
        left: x,
        right: x + width,
        top: y,
        width,
      };
    },
    getClientRects() {
      return width > 0 || height > 0 ? [{}] : [];
    },
  };
}

function fakeDocument(selectorMap = {}, activeElement = null) {
  const body = selectorMap.__body || fakeElement({ tagName: "BODY" });
  const doc = {
    activeElement,
    body,
    createElement(tagName) {
      return fakeElement({ ownerDocument: this, tagName: tagName.toUpperCase() });
    },
    defaultView: {
      innerHeight: 720,
      innerWidth: 1280,
      getComputedStyle(el) {
        return el.style || {};
      },
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return selectorMap[selector] || [];
    },
  };
  if (selectorMap.__selection) {
    doc.getSelection = () => selectorMap.__selection;
  }
  body.ownerDocument = doc;
  return doc;
}

function fakeLocalStorage() {
  const values = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
  };
}

function fakeKeyEvent(key, target) {
  return {
    key,
    keyCode: key.toUpperCase().charCodeAt(0),
    code: `Key${key.toUpperCase()}`,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target,
    prevented: false,
    stopped: false,
    immediateStopped: false,
    composedPath() {
      return [target];
    },
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    stopImmediatePropagation() {
      this.immediateStopped = true;
    },
  };
}

function rawKeyboardEvent(options = {}) {
  return Object.assign({
    key: "",
    keyCode: 0,
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }, options);
}

function eventForTarget(target) {
  return {
    target,
    composedPath() {
      return [target];
    },
  };
}

function fakeTextInputEvent(type, target, options = {}) {
  return Object.assign({
    type,
    target,
    cancelable: true,
    inputType: "insertText",
    isComposing: false,
    prevented: false,
    stopped: false,
    immediateStopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    stopImmediatePropagation() {
      this.immediateStopped = true;
    },
  }, options);
}

context("KeyboardUtils", () => {
  should("maps IME processing letters from physical key code", () => {
    assert.equal(
      "t",
      KeyboardUtils.getKeyString(rawKeyboardEvent({
        key: "t",
        code: "KeyT",
        keyCode: 229,
      })),
    );
    assert.equal(
      "s",
      KeyboardUtils.getKeyString(rawKeyboardEvent({
        key: "Process",
        code: "KeyS",
        keyCode: 229,
      })),
    );
  });

  should("maps IME processing digits from physical key code", () => {
    assert.equal(
      "1",
      KeyboardUtils.getKeyString(rawKeyboardEvent({
        key: "Process",
        code: "Digit1",
        keyCode: 229,
      })),
    );
  });

  should("maps non-Latin printable keys from physical key code", () => {
    assert.equal(
      "t",
      KeyboardUtils.getKeyString(rawKeyboardEvent({
        key: "て",
        code: "KeyT",
        keyCode: 84,
      })),
    );
  });
});

context("UI", () => {
  should("invertObjectMap", () => {
    const o = { a: "b", c: "d" };
    assert.equal({ b: "a", d: "c" }, Utils.invertObjectMap(o));
  });

  should("buildKeyMappingsPrefixes", () => {
    const mappings = {
      "normal": {
        "moveUp": "a•b•c",
        "moveDown": "a•d",
        "moveLeft": "x•y",
        "moveDown": "z",
      },
    };
    const result = UI._buildKeyMappingsPrefixes(mappings);
    assert.equal({ "a": true, "a•b": true, "x": true }, result["normal"]);
  });

  should("suppress shortcuts from input targets", () => {
    const input = fakeElement({ tagName: "INPUT" });
    input.ownerDocument = fakeDocument({}, input);
    assert.equal("editableTarget", UI._getShortcutSuppressionReason(eventForTarget(input)));
  });

  should("suppress shortcuts from textarea targets", () => {
    const textarea = fakeElement({ tagName: "TEXTAREA" });
    textarea.ownerDocument = fakeDocument({}, textarea);
    assert.equal("editableTarget", UI._getShortcutSuppressionReason(eventForTarget(textarea)));
  });

  should("suppress shortcuts from contenteditable targets", () => {
    const editable = fakeElement({ attrs: { contenteditable: "true" } });
    editable.ownerDocument = fakeDocument({}, editable);
    assert.equal("editableTarget", UI._getShortcutSuppressionReason(eventForTarget(editable)));
  });

  should("suppress shortcuts from role textbox targets", () => {
    const textbox = fakeElement({ attrs: { role: "textbox" } });
    textbox.ownerDocument = fakeDocument({}, textbox);
    assert.equal("editableTarget", UI._getShortcutSuppressionReason(eventForTarget(textbox)));
  });

  should("suppress shortcuts from speaker-notes-style textbox targets", () => {
    const speakerNotes = fakeElement({
      id: "speakernotes-workspace",
      attrs: { role: "textbox", "aria-label": "Speaker notes" },
    });
    speakerNotes.ownerDocument = fakeDocument({}, speakerNotes);
    assert.equal("editableTarget", UI._getShortcutSuppressionReason(eventForTarget(speakerNotes)));
  });

  should("allows shortcuts from the hidden Google Docs text event iframe", () => {
    const frame = fakeElement({ tagName: "IFRAME", className: "docs-texteventtarget-iframe" });
    const target = fakeElement({
      tagName: "BODY",
      attrs: { contenteditable: "true" },
    });
    const doc = fakeDocument({}, target);
    doc.defaultView.frameElement = frame;
    target.ownerDocument = doc;

    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("allows shortcuts from a textbox inside the Google Docs text event iframe", () => {
    const frame = fakeElement({ tagName: "IFRAME", className: "docs-texteventtarget-iframe" });
    const target = fakeElement({
      attrs: { role: "textbox" },
    });
    const doc = fakeDocument({}, target);
    doc.defaultView.frameElement = frame;
    target.ownerDocument = doc;

    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("suppresses shortcuts from a textbox with a collapsed caret selection", () => {
    const frame = fakeElement({ tagName: "IFRAME", className: "docs-texteventtarget-iframe" });
    const target = fakeElement({ attrs: { role: "textbox" } });
    const doc = fakeDocument({
      __selection: {
        isCollapsed: true,
        rangeCount: 1,
        type: "Caret",
      },
    }, target);
    doc.defaultView.frameElement = frame;
    target.ownerDocument = doc;

    assert.equal("textboxCaret", UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("allows shortcuts from a textbox with a non-collapsed range selection", () => {
    const frame = fakeElement({ tagName: "IFRAME", className: "docs-texteventtarget-iframe" });
    const target = fakeElement({ attrs: { role: "textbox" } });
    const doc = fakeDocument({
      __selection: {
        isCollapsed: false,
        rangeCount: 1,
        type: "Range",
      },
    }, target);
    doc.defaultView.frameElement = frame;
    target.ownerDocument = doc;

    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("suppress shortcuts when a visible dialog is open", () => {
    const target = fakeElement();
    const dialog = fakeElement({ attrs: { role: "dialog" }, width: 100, height: 100 });
    target.ownerDocument = fakeDocument({ "[role='dialog']": [dialog] }, target);
    dialog.ownerDocument = target.ownerDocument;
    assert.equal("blockingUi", UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("suppress shortcuts when a visible menu is open", () => {
    const target = fakeElement();
    const menu = fakeElement({ className: "goog-menu", width: 100, height: 100 });
    target.ownerDocument = fakeDocument({ ".goog-menu": [menu] }, target);
    menu.ownerDocument = target.ownerDocument;
    assert.equal("blockingUi", UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("ignore hidden dialogs and menus", () => {
    const target = fakeElement();
    const dialog = fakeElement({
      attrs: { role: "dialog" },
      style: { display: "none" },
      width: 100,
      height: 100,
    });
    const menu = fakeElement({
      className: "goog-menu",
      style: { display: "none" },
      width: 100,
      height: 100,
    });
    target.ownerDocument = fakeDocument({
      "[role='dialog']": [dialog],
      ".goog-menu": [menu],
    }, target);
    dialog.ownerDocument = target.ownerDocument;
    menu.ownerDocument = target.ownerDocument;
    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("ignore aria-hidden blocking UI", () => {
    const target = fakeElement();
    const dialog = fakeElement({
      attrs: { role: "dialog", "aria-hidden": "true" },
      width: 100,
      height: 100,
    });
    target.ownerDocument = fakeDocument({ "[role='dialog']": [dialog] }, target);
    dialog.ownerDocument = target.ownerDocument;
    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("ignore transparent blocking UI", () => {
    const target = fakeElement();
    const menu = fakeElement({
      className: "goog-menu",
      style: { opacity: "0" },
      width: 100,
      height: 100,
    });
    target.ownerDocument = fakeDocument({ ".goog-menu": [menu] }, target);
    menu.ownerDocument = target.ownerDocument;
    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("ignore offscreen blocking UI", () => {
    const target = fakeElement();
    const menu = fakeElement({
      className: "goog-menu",
      width: 100,
      height: 100,
      x: -200,
      y: 10,
    });
    target.ownerDocument = fakeDocument({ ".goog-menu": [menu] }, target);
    menu.ownerDocument = target.ownerDocument;
    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("allow shortcuts from normal canvas-like targets", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    target.ownerDocument = fakeDocument({}, target);
    assert.equal(null, UI._getShortcutSuppressionReason(eventForTarget(target)));
  });

  should("does not treat the parent ruler as legacy text editing by itself", () => {
    const originalIsTextEditing = UI.isTextEditing;
    const ruler = fakeElement({ id: "sketchy-horizontal-ruler", width: 100, height: 10 });
    const doc = fakeDocument({
      "#sketchy-horizontal-ruler": [ruler],
    });

    try {
      UI.isTextEditing = true;
      UI._updateLegacyTextEditingState(doc);
      assert.isFalse(UI.isTextEditing);
    } finally {
      UI.isTextEditing = originalIsTextEditing;
    }
  });

  should("uses the legacy material child when it exists", () => {
    const originalIsTextEditing = UI.isTextEditing;
    const legacyMaterial = fakeElement({ width: 100, height: 10 });
    const doc = fakeDocument({
      "#sketchy-horizontal-ruler > div > div.docs-material": [legacyMaterial],
    });
    legacyMaterial.ownerDocument = doc;

    try {
      UI.isTextEditing = false;
      UI._updateLegacyTextEditingState(doc);
      assert.isTrue(UI.isTextEditing);
    } finally {
      UI.isTextEditing = originalIsTextEditing;
    }
  });

  should("does not throw if the legacy editing observer cannot attach", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalConsoleLog = console.log;
    const originalEditingObserver = UI.editingObserver;
    const ruler = fakeElement({ id: "sketchy-horizontal-ruler", width: 100, height: 10 });
    const doc = fakeDocument({
      "#sketchy-horizontal-ruler": [ruler],
    });
    ruler.ownerDocument = doc;

    try {
      globalThis.document = doc;
      globalThis.MutationObserver = function () {
        return {
          observe() {
            throw new TypeError("not a node");
          },
        };
      };
      console.log = () => {};

      UI._setupEditingDetector();
      assert.equal(null, UI.editingObserver);
    } finally {
      globalThis.document = originalDocument;
      globalThis.MutationObserver = originalMutationObserver;
      console.log = originalConsoleLog;
      UI.editingObserver = originalEditingObserver;
    }
  });

  should("does not expose literal key or aria-label text in debug metadata", () => {
    const keyMetadata = UI._describeKeyForShortcutDebug("a");
    const labeledElement = fakeElement({ attrs: { "aria-label": "Secret slide title" } });
    const elementMetadata = UI._describeElementForShortcutDebug(labeledElement);

    assert.equal({ category: "printable" }, keyMetadata);
    assert.equal(true, elementMetadata.hasAriaLabel);
    assert.equal(undefined, elementMetadata.ariaLabel);
  });

  should("records shortcut debug entries in localStorage", () => {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );

    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fakeLocalStorage(),
      });

      UI._recordShortcutDebugEntry({ kind: "shortcutDetection" });

      assert.equal(
        [{ kind: "shortcutDetection" }],
        JSON.parse(globalThis.localStorage.getItem(UI.shortcutDebugLogKey)),
      );
    } finally {
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  should("publishes shortcut config for the main-world guard", () => {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const originalPostMessage = globalThis.postMessage;
    const originalModeToKeyToCommand = UI.modeToKeyToCommand;
    const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
    let postedMessage = null;

    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fakeLocalStorage(),
      });
      globalThis.postMessage = (message) => postedMessage = message;
      UI.modeToKeyToCommand = { normal: { "t•s": "setLineSpacing115" } };
      UI.keyMappingsPrefixes = { normal: { "t": true } };

      UI._publishMainWorldShortcutConfig();

      assert.equal(UI.mainWorldConfigMessageType, postedMessage.type);
      assert.equal(
        { normal: { "t•s": "setLineSpacing115" } },
        postedMessage.config.modeToKeyToCommand,
      );
      assert.equal(
        postedMessage.config,
        JSON.parse(globalThis.localStorage.getItem(UI.mainWorldShortcutConfigKey)),
      );
    } finally {
      UI.modeToKeyToCommand = originalModeToKeyToCommand;
      UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
      globalThis.postMessage = originalPostMessage;
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  should("executes shortcuts received from the main-world guard", () => {
    const originalCommand = Commands.commands.mainWorldTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    const originalRecentMainWorldShortcutEvents = UI.recentMainWorldShortcutEvents;
    const originalSuppressionUntil = UI.textInputSuppressionUntil;
    let called = false;

    try {
      UI.commandModeActive = true;
      UI.keyQueue = ["t"];
      UI.recentMainWorldShortcutEvents = [];
      UI.textInputSuppressionUntil = 0;
      Commands.commands.mainWorldTestShortcut = { fn: () => called = true };

      UI._onMainWorldShortcut({
        commandName: "mainWorldTestShortcut",
        event: { code: "KeyS", keyCode: 229, which: 229 },
        isPrefix: false,
        keySequence: "t•s",
        keyString: "s",
      });

      assert.equal([], UI.keyQueue);
      assert.isTrue(called);
      assert.isFalse(UI.commandModeActive);
      assert.isTrue(UI.textInputSuppressionUntil > 0);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      UI.recentMainWorldShortcutEvents = originalRecentMainWorldShortcutEvents;
      UI.textInputSuppressionUntil = originalSuppressionUntil;
      if (originalCommand) {
        Commands.commands.mainWorldTestShortcut = originalCommand;
      } else {
        delete Commands.commands.mainWorldTestShortcut;
      }
    }
  });

  should("preserves command source received from the main-world guard", () => {
    const originalCommand = Commands.commands.mainWorldSourceTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalInvokeCommand = UI._invokeCommand;
    const originalKeyQueue = UI.keyQueue;
    let invokedSource = null;

    try {
      UI.commandModeActive = true;
      UI.keyQueue = ["t"];
      Commands.commands.mainWorldSourceTestShortcut = { fn: () => {} };
      UI._invokeCommand = (_commandName, source) => invokedSource = source;

      UI._onMainWorldShortcut({
        commandName: "mainWorldSourceTestShortcut",
        commandSource: "mainWorldExtensionCommandFallback",
        event: { code: "KeyS", keyCode: 83, which: 83 },
        isPrefix: false,
        keySequence: "<C-S>",
        keyString: "<C-S>",
      });

      assert.equal("mainWorldExtensionCommandFallback", invokedSource);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      UI._invokeCommand = originalInvokeCommand;
      if (originalCommand) {
        Commands.commands.mainWorldSourceTestShortcut = originalCommand;
      } else {
        delete Commands.commands.mainWorldSourceTestShortcut;
      }
    }
  });

  should("executes shortcuts received from Chrome extension commands", () => {
    const originalCommand = Commands.commands.extensionCommandTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    let called = false;

    try {
      UI.commandModeActive = true;
      UI.keyQueue = ["t"];
      Commands.commands.extensionCommandTestShortcut = { fn: () => called = true };

      UI._onRuntimeMessage({
        type: UI.extensionCommandMessageType,
        commandName: "extensionCommandTestShortcut",
      });

      assert.equal([], UI.keyQueue);
      assert.isTrue(called);
      assert.isFalse(UI.commandModeActive);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      if (originalCommand) {
        Commands.commands.extensionCommandTestShortcut = originalCommand;
      } else {
        delete Commands.commands.extensionCommandTestShortcut;
      }
    }
  });

  should("ignores Chrome extension commands when command mode is inactive", () => {
    const originalCommand = Commands.commands.inactiveExtensionCommandTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    let called = false;

    try {
      UI.commandModeActive = false;
      UI.keyQueue = ["t"];
      Commands.commands.inactiveExtensionCommandTestShortcut = { fn: () => called = true };

      UI._onRuntimeMessage({
        type: UI.extensionCommandMessageType,
        commandName: "inactiveExtensionCommandTestShortcut",
      });

      assert.equal([], UI.keyQueue);
      assert.isFalse(called);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      if (originalCommand) {
        Commands.commands.inactiveExtensionCommandTestShortcut = originalCommand;
      } else {
        delete Commands.commands.inactiveExtensionCommandTestShortcut;
      }
    }
  });

  should("executes Chrome extension commands when a child frame has command mode active", () => {
    const originalCommand = Commands.commands.forwardedSourceExtensionCommand;
    const originalCommandModeActive = UI.commandModeActive;
    const originalForwardedCommandModeSources = UI.forwardedCommandModeSources;
    const originalKeyQueue = UI.keyQueue;
    const frameSource = {};
    let called = false;

    try {
      UI.commandModeActive = false;
      UI.forwardedCommandModeSources = [];
      UI.keyQueue = ["t"];
      Commands.commands.forwardedSourceExtensionCommand = { fn: () => called = true };

      UI._onWindowMessage({
        source: frameSource,
        data: {
          type: UI.commandModeStateMessageType,
          active: true,
          forwardedFromSlideKeysFrame: true,
        },
      });

      UI._onRuntimeMessage({
        type: UI.extensionCommandMessageType,
        commandName: "forwardedSourceExtensionCommand",
      });

      assert.equal([], UI.keyQueue);
      assert.isTrue(called);
      assert.equal([], UI.forwardedCommandModeSources);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.forwardedCommandModeSources = originalForwardedCommandModeSources;
      UI.keyQueue = originalKeyQueue;
      if (originalCommand) {
        Commands.commands.forwardedSourceExtensionCommand = originalCommand;
      } else {
        delete Commands.commands.forwardedSourceExtensionCommand;
      }
    }
  });

  should("forwards Chrome extension commands from child frames to the top frame", () => {
    const originalTopDescriptor = Object.getOwnPropertyDescriptor(globalThis, "top");
    let postedMessage = null;

    try {
      Object.defineProperty(globalThis, "top", {
        configurable: true,
        value: {
          postMessage(message) {
            postedMessage = message;
          },
        },
      });

      UI._onRuntimeMessage({
        type: UI.extensionCommandMessageType,
        commandName: "setLineSpacing115",
      });

      assert.equal(UI.extensionCommandMessageType, postedMessage.type);
      assert.equal("setLineSpacing115", postedMessage.commandName);
      assert.isTrue(postedMessage.forwardedFromSlideKeysFrame);
    } finally {
      if (originalTopDescriptor) {
        Object.defineProperty(globalThis, "top", originalTopDescriptor);
      } else {
        delete globalThis.top;
      }
    }
  });

  should("executes Chrome extension commands forwarded to the top frame", () => {
    const originalCommand = Commands.commands.forwardedExtensionCommandTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    let called = false;

    try {
      UI.commandModeActive = true;
      UI.keyQueue = ["t"];
      Commands.commands.forwardedExtensionCommandTestShortcut = { fn: () => called = true };

      UI._onWindowMessage({
        source: {},
        data: {
          type: UI.extensionCommandMessageType,
          commandName: "forwardedExtensionCommandTestShortcut",
          forwardedFromSlideKeysFrame: true,
        },
      });

      assert.equal([], UI.keyQueue);
      assert.isTrue(called);
      assert.isFalse(UI.commandModeActive);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      if (originalCommand) {
        Commands.commands.forwardedExtensionCommandTestShortcut = originalCommand;
      } else {
        delete Commands.commands.forwardedExtensionCommandTestShortcut;
      }
    }
  });

  should("ignores extension command fallback when command mode is inactive", () => {
    const originalCommand = Commands.commands.setLineSpacing115;
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    const textbox = fakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      isContentEditable: true,
    });
    const doc = fakeDocument({
      __selection: {
        isCollapsed: true,
        rangeCount: 1,
        type: "Caret",
      },
    }, textbox);
    let called = false;

    try {
      UI.commandModeActive = false;
      UI.keyQueue = ["t"];
      textbox.ownerDocument = doc;
      Commands.commands.setLineSpacing115 = { fn: () => called = true };

      const event = fakeKeyEvent("s", textbox);
      event.ctrlKey = true;
      event.shiftKey = true;
      UI._onKeydown(event);

      assert.equal([], UI.keyQueue);
      assert.isFalse(called);
      assert.isFalse(event.prevented);
      assert.isFalse(event.stopped);
      assert.isFalse(event.immediateStopped);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      Commands.commands.setLineSpacing115 = originalCommand;
    }
  });

  should("enters command mode with right Command before textbox suppression", () => {
    const originalCommandModeActive = UI.commandModeActive;
    const originalCommandModeFocusElement = UI.commandModeFocusElement;
    const originalCommandModeLeaderCandidate = UI.commandModeLeaderCandidate;
    const originalCommandModeOverlayElement = UI.commandModeOverlayElement;
    const originalCommandModePreviousActiveElement = UI.commandModePreviousActiveElement;
    const originalCommandModeTimeoutId = UI.commandModeTimeoutId;
    const originalKeyQueue = UI.keyQueue;
    const textbox = fakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      isContentEditable: true,
    });
    const doc = fakeDocument({
      __selection: {
        isCollapsed: true,
        rangeCount: 1,
        type: "Caret",
      },
    }, textbox);

    try {
      UI._exitCommandMode({ reason: "testReset", restoreFocus: false });
      UI.commandModeFocusElement = null;
      UI.commandModeLeaderCandidate = false;
      UI.commandModeOverlayElement = null;
      UI.commandModePreviousActiveElement = null;
      UI.commandModeTimeoutId = null;
      UI.keyQueue = ["t"];
      textbox.ownerDocument = doc;

      const keydownEvent = fakeKeyEvent("Meta", textbox);
      keydownEvent.code = "MetaRight";
      keydownEvent.keyCode = 93;
      keydownEvent.location = 2;
      keydownEvent.metaKey = true;
      keydownEvent.which = 93;

      UI._onKeydown(keydownEvent);

      assert.isFalse(UI.commandModeActive);
      assert.isTrue(UI.commandModeLeaderCandidate);
      assert.isFalse(keydownEvent.prevented);

      const keyupEvent = fakeKeyEvent("Meta", textbox);
      keyupEvent.code = "MetaRight";
      keyupEvent.keyCode = 93;
      keyupEvent.location = 2;
      keyupEvent.which = 93;

      UI._onKeyup(keyupEvent);

      assert.isTrue(UI.commandModeActive);
      assert.isFalse(UI.commandModeLeaderCandidate);
      assert.equal([], UI.keyQueue);
      assert.equal("slidekeys-command-mode-focus", doc.activeElement.id);
      assert.equal("SlideKeys", UI.commandModeOverlayElement.textContent);
      assert.isTrue(keyupEvent.prevented);
      assert.isTrue(keyupEvent.stopped);
      assert.isTrue(keyupEvent.immediateStopped);
    } finally {
      UI._exitCommandMode({ reason: "testCleanup", restoreFocus: false });
      UI.commandModeActive = originalCommandModeActive;
      UI.commandModeFocusElement = originalCommandModeFocusElement;
      UI.commandModeLeaderCandidate = originalCommandModeLeaderCandidate;
      UI.commandModeOverlayElement = originalCommandModeOverlayElement;
      UI.commandModePreviousActiveElement = originalCommandModePreviousActiveElement;
      if (UI.commandModeTimeoutId) clearTimeout(UI.commandModeTimeoutId);
      UI.commandModeTimeoutId = originalCommandModeTimeoutId;
      UI.keyQueue = originalKeyQueue;
    }
  });

  should("does not enter command mode when right Command is used as a modifier", () => {
    const originalCommandModeActive = UI.commandModeActive;
    const originalCommandModeLeaderCandidate = UI.commandModeLeaderCandidate;
    const originalKeyQueue = UI.keyQueue;
    const target = fakeElement({ tagName: "DIV" });
    target.ownerDocument = fakeDocument({}, target);

    try {
      UI.commandModeActive = false;
      UI.commandModeLeaderCandidate = false;
      UI.keyQueue = [];

      const rightCommandDown = fakeKeyEvent("Meta", target);
      rightCommandDown.code = "MetaRight";
      rightCommandDown.keyCode = 93;
      rightCommandDown.location = 2;
      rightCommandDown.metaKey = true;
      rightCommandDown.which = 93;
      UI._onKeydown(rightCommandDown);

      const comboKeyDown = fakeKeyEvent("c", target);
      comboKeyDown.metaKey = true;
      UI._onKeydown(comboKeyDown);

      const rightCommandUp = fakeKeyEvent("Meta", target);
      rightCommandUp.code = "MetaRight";
      rightCommandUp.keyCode = 93;
      rightCommandUp.location = 2;
      rightCommandUp.which = 93;
      UI._onKeyup(rightCommandUp);

      assert.isFalse(UI.commandModeActive);
      assert.isFalse(UI.commandModeLeaderCandidate);
      assert.isFalse(rightCommandDown.prevented);
      assert.isFalse(comboKeyDown.prevented);
      assert.isFalse(rightCommandUp.prevented);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.commandModeLeaderCandidate = originalCommandModeLeaderCandidate;
      UI.keyQueue = originalKeyQueue;
    }
  });

  should("runs mapped key sequences from command mode", () => {
    const originalCommand = Commands.commands.commandModeTestShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalCommandModeFocusElement = UI.commandModeFocusElement;
    const originalCommandModeOverlayElement = UI.commandModeOverlayElement;
    const originalCommandModePreviousActiveElement = UI.commandModePreviousActiveElement;
    const originalCommandModeTimeoutId = UI.commandModeTimeoutId;
    const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
    const originalKeyQueue = UI.keyQueue;
    const originalModeToKeyToCommand = UI.modeToKeyToCommand;
    const focusElement = fakeElement({ id: "slidekeys-command-mode-focus" });
    const overlayElement = fakeElement({ id: "slidekeys-command-mode-overlay" });
    const doc = fakeDocument({}, focusElement);
    let called = false;

    try {
      focusElement.ownerDocument = doc;
      overlayElement.ownerDocument = doc;
      UI.commandModeActive = true;
      UI.commandModeFocusElement = focusElement;
      UI.commandModeOverlayElement = overlayElement;
      UI.commandModePreviousActiveElement = null;
      UI.commandModeTimeoutId = null;
      UI.keyQueue = [];
      UI.modeToKeyToCommand = { normal: { "t•s": "commandModeTestShortcut" } };
      UI.keyMappingsPrefixes = { normal: { "t": true } };
      Commands.commands.commandModeTestShortcut = { fn: () => called = true };

      const prefixEvent = fakeKeyEvent("t", focusElement);
      UI._onKeydown(prefixEvent);

      assert.isTrue(UI.commandModeActive);
      assert.equal(["t"], UI.keyQueue);
      assert.equal("SlideKeys: t", overlayElement.textContent);
      assert.isTrue(prefixEvent.prevented);

      const commandEvent = fakeKeyEvent("s", focusElement);
      commandEvent.code = "KeyS";
      commandEvent.keyCode = 229;
      commandEvent.which = 229;
      UI._onKeydown(commandEvent);

      assert.isTrue(called);
      assert.isFalse(UI.commandModeActive);
      assert.equal([], UI.keyQueue);
      assert.equal("none", overlayElement.style.display);
      assert.isTrue(commandEvent.prevented);
    } finally {
      UI._exitCommandMode({ reason: "testCleanup", restoreFocus: false });
      UI.commandModeActive = originalCommandModeActive;
      UI.commandModeFocusElement = originalCommandModeFocusElement;
      UI.commandModeOverlayElement = originalCommandModeOverlayElement;
      UI.commandModePreviousActiveElement = originalCommandModePreviousActiveElement;
      if (UI.commandModeTimeoutId) clearTimeout(UI.commandModeTimeoutId);
      UI.commandModeTimeoutId = originalCommandModeTimeoutId;
      UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
      UI.keyQueue = originalKeyQueue;
      UI.modeToKeyToCommand = originalModeToKeyToCommand;
      if (originalCommand) {
        Commands.commands.commandModeTestShortcut = originalCommand;
      } else {
        delete Commands.commands.commandModeTestShortcut;
      }
    }
  });

  should("exits command mode on escape and restores previous focus", () => {
    const originalCommandModeActive = UI.commandModeActive;
    const originalCommandModeFocusElement = UI.commandModeFocusElement;
    const originalCommandModeOverlayElement = UI.commandModeOverlayElement;
    const originalCommandModePreviousActiveElement = UI.commandModePreviousActiveElement;
    const originalCommandModeTimeoutId = UI.commandModeTimeoutId;
    const originalKeyQueue = UI.keyQueue;
    const previousActiveElement = fakeElement({ id: "previous-focus" });
    const focusElement = fakeElement({ id: "slidekeys-command-mode-focus" });
    const overlayElement = fakeElement({ id: "slidekeys-command-mode-overlay" });
    const doc = fakeDocument({}, focusElement);

    try {
      previousActiveElement.ownerDocument = doc;
      focusElement.ownerDocument = doc;
      overlayElement.ownerDocument = doc;
      UI.commandModeActive = true;
      UI.commandModeFocusElement = focusElement;
      UI.commandModeOverlayElement = overlayElement;
      UI.commandModePreviousActiveElement = previousActiveElement;
      UI.commandModeTimeoutId = null;
      UI.keyQueue = ["t"];

      const event = fakeKeyEvent("Escape", focusElement);
      event.keyCode = 27;
      event.which = 27;

      UI._onKeydown(event);

      assert.isFalse(UI.commandModeActive);
      assert.equal([], UI.keyQueue);
      assert.isTrue(previousActiveElement === doc.activeElement);
      assert.equal("none", overlayElement.style.display);
      assert.isTrue(event.prevented);
    } finally {
      UI._exitCommandMode({ reason: "testCleanup", restoreFocus: false });
      UI.commandModeActive = originalCommandModeActive;
      UI.commandModeFocusElement = originalCommandModeFocusElement;
      UI.commandModeOverlayElement = originalCommandModeOverlayElement;
      UI.commandModePreviousActiveElement = originalCommandModePreviousActiveElement;
      if (UI.commandModeTimeoutId) clearTimeout(UI.commandModeTimeoutId);
      UI.commandModeTimeoutId = originalCommandModeTimeoutId;
      UI.keyQueue = originalKeyQueue;
    }
  });

  should("forwards main-world shortcuts from child frames to the top frame", () => {
    const originalTopDescriptor = Object.getOwnPropertyDescriptor(globalThis, "top");
    const originalCommand = Commands.commands.forwardedFrameShortcut;
    let called = false;
    let postedMessage = null;

    try {
      Object.defineProperty(globalThis, "top", {
        configurable: true,
        value: {
          postMessage(message) {
            postedMessage = message;
          },
        },
      });
      Commands.commands.forwardedFrameShortcut = { fn: () => called = true };

      UI._onWindowMessage({
        source: globalThis,
        data: {
          type: UI.mainWorldShortcutMessageType,
          commandName: "forwardedFrameShortcut",
          event: { code: "KeyS", keyCode: 229, which: 229 },
          isPrefix: false,
          keySequence: "t•s",
          keyString: "s",
        },
      });

      assert.isFalse(called);
      assert.equal(UI.mainWorldShortcutMessageType, postedMessage.type);
      assert.isTrue(postedMessage.forwardedFromSlideKeysFrame);
    } finally {
      if (originalCommand) {
        Commands.commands.forwardedFrameShortcut = originalCommand;
      } else {
        delete Commands.commands.forwardedFrameShortcut;
      }
      if (originalTopDescriptor) {
        Object.defineProperty(globalThis, "top", originalTopDescriptor);
      } else {
        delete globalThis.top;
      }
    }
  });

  should(
    "executes forwarded frame shortcuts and sends IME cleanup back to the source frame",
    () => {
      const originalTopDescriptor = Object.getOwnPropertyDescriptor(globalThis, "top");
      const originalCommand = Commands.commands.forwardedImeShortcut;
      const originalCommandModeActive = UI.commandModeActive;
      const originalForwardedCommandModeSources = UI.forwardedCommandModeSources;
      let called = false;
      let cleanupMessage = null;
      const frameSource = {
        postMessage(message) {
          cleanupMessage = message;
        },
      };

      try {
        Object.defineProperty(globalThis, "top", {
          configurable: true,
          value: globalThis,
        });
        UI.commandModeActive = false;
        UI.forwardedCommandModeSources = [];
        Commands.commands.forwardedImeShortcut = { fn: () => called = true };

        UI._onWindowMessage({
          source: frameSource,
          data: {
            type: UI.commandModeStateMessageType,
            active: true,
            forwardedFromSlideKeysFrame: true,
          },
        });

        UI._onWindowMessage({
          source: frameSource,
          data: {
            type: UI.mainWorldShortcutMessageType,
            commandName: "forwardedImeShortcut",
            event: { code: "KeyS", keyCode: 229, which: 229 },
            forwardedFromSlideKeysFrame: true,
            isPrefix: false,
            keySequence: "t•s",
            keyString: "s",
          },
        });

        assert.isTrue(called);
        assert.isFalse(UI.commandModeActive);
        assert.equal(UI.mainWorldImeClearMessageType, cleanupMessage.type);
        assert.equal(229, cleanupMessage.event.keyCode);
      } finally {
        UI.commandModeActive = originalCommandModeActive;
        UI.forwardedCommandModeSources = originalForwardedCommandModeSources;
        if (originalCommand) {
          Commands.commands.forwardedImeShortcut = originalCommand;
        } else {
          delete Commands.commands.forwardedImeShortcut;
        }
        if (originalTopDescriptor) {
          Object.defineProperty(globalThis, "top", originalTopDescriptor);
        } else {
          delete globalThis.top;
        }
      }
    },
  );

  should("ignores forwarded frame shortcuts from sources without command mode", () => {
    const originalCommand = Commands.commands.untrustedForwardedShortcut;
    const originalCommandModeActive = UI.commandModeActive;
    const originalForwardedCommandModeSources = UI.forwardedCommandModeSources;
    const frameSource = {};
    let called = false;

    try {
      UI.commandModeActive = false;
      UI.forwardedCommandModeSources = [];
      Commands.commands.untrustedForwardedShortcut = { fn: () => called = true };

      UI._onWindowMessage({
        source: frameSource,
        data: {
          type: UI.mainWorldShortcutMessageType,
          commandName: "untrustedForwardedShortcut",
          commandModeActive: true,
          event: { code: "KeyS", keyCode: 229, which: 229 },
          forwardedFromSlideKeysFrame: true,
          isPrefix: false,
          keySequence: "t•s",
          keyString: "s",
        },
      });

      assert.isFalse(called);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.forwardedCommandModeSources = originalForwardedCommandModeSources;
      if (originalCommand) {
        Commands.commands.untrustedForwardedShortcut = originalCommand;
      } else {
        delete Commands.commands.untrustedForwardedShortcut;
      }
    }
  });

  should("records text input suppression received from the main-world guard", () => {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );

    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fakeLocalStorage(),
      });
      globalThis.localStorage.setItem("slidekeysDebugShortcuts", "1");

      UI._onWindowMessage({
        source: globalThis,
        data: {
          type: UI.mainWorldTextInputSuppressionMessageType,
          event: {
            cancelable: true,
            inputType: "insertText",
            isComposing: false,
            type: "beforeinput",
          },
        },
      });

      assert.equal(
        [{
          kind: "mainWorldTextInputSuppression",
          event: {
            cancelable: true,
            inputType: "insertText",
            isComposing: false,
            type: "beforeinput",
          },
        }],
        JSON.parse(globalThis.localStorage.getItem(UI.shortcutDebugLogKey)),
      );
    } finally {
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  should("records text restore received from the main-world guard", () => {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );

    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fakeLocalStorage(),
      });
      globalThis.localStorage.setItem("slidekeysDebugShortcuts", "1");

      UI._onWindowMessage({
        source: globalThis,
        data: {
          type: UI.mainWorldTextRestoreMessageType,
          reason: "shortcutTextRestored",
        },
      });

      assert.equal(
        [{
          kind: "mainWorldTextRestore",
          metrics: null,
          reason: "shortcutTextRestored",
        }],
        JSON.parse(globalThis.localStorage.getItem(UI.shortcutDebugLogKey)),
      );
    } finally {
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  should("records command dispatch lifecycle when debug is enabled", () => {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const originalCommand = Commands.commands.debugDispatchShortcut;
    let called = false;

    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fakeLocalStorage(),
      });
      globalThis.localStorage.setItem("slidekeysDebugShortcuts", "1");
      Commands.commands.debugDispatchShortcut = { fn: () => called = true };

      UI._invokeCommand("debugDispatchShortcut", "mainWorld");

      assert.isTrue(called);
      assert.equal(
        [
          {
            kind: "commandDispatch",
            commandName: "debugDispatchShortcut",
            errorName: "",
            source: "mainWorld",
            status: "start",
          },
          {
            kind: "commandDispatch",
            commandName: "debugDispatchShortcut",
            errorName: "",
            source: "mainWorld",
            status: "success",
          },
        ],
        JSON.parse(globalThis.localStorage.getItem(UI.shortcutDebugLogKey)),
      );
    } finally {
      if (originalCommand) {
        Commands.commands.debugDispatchShortcut = originalCommand;
      } else {
        delete Commands.commands.debugDispatchShortcut;
      }
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  should("updates prefixes received from the main-world guard", () => {
    const originalCommandModeActive = UI.commandModeActive;
    const originalKeyQueue = UI.keyQueue;
    const originalRecentMainWorldShortcutEvents = UI.recentMainWorldShortcutEvents;

    try {
      UI.commandModeActive = true;
      UI.keyQueue = [];
      UI.recentMainWorldShortcutEvents = [];

      UI._onMainWorldShortcut({
        commandName: null,
        event: { code: "KeyT", keyCode: 229, which: 229 },
        isPrefix: true,
        keySequence: "t",
        keyString: "t",
      });

      assert.equal(["t"], UI.keyQueue);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.keyQueue = originalKeyQueue;
      UI.recentMainWorldShortcutEvents = originalRecentMainWorldShortcutEvents;
    }
  });

  should(
    "queues prefixes and executes matching shortcuts in command mode",
    () => {
      const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
      target.ownerDocument = fakeDocument({}, target);
      const originalCommandModeActive = UI.commandModeActive;
      const originalModeToKeyToCommand = UI.modeToKeyToCommand;
      const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
      const originalKeyQueue = UI.keyQueue;
      const originalCommand = Commands.commands.testShortcut;
      let called = false;

      try {
        UI.commandModeActive = true;
        UI.keyQueue = [];
        UI.modeToKeyToCommand = { normal: { "a•t": "testShortcut" } };
        UI.keyMappingsPrefixes = { normal: { "a": true } };
        Commands.commands.testShortcut = { fn: () => called = true };

        const prefixEvent = fakeKeyEvent("a", target);
        UI._onKeydown(prefixEvent);
        assert.equal(["a"], UI.keyQueue);
        assert.isTrue(prefixEvent.prevented);
        assert.isTrue(prefixEvent.stopped);
        assert.isTrue(prefixEvent.immediateStopped);

        const commandEvent = fakeKeyEvent("t", target);
        UI._onKeydown(commandEvent);
        assert.equal([], UI.keyQueue);
        assert.isTrue(commandEvent.prevented);
        assert.isTrue(commandEvent.stopped);
        assert.isTrue(commandEvent.immediateStopped);
        assert.isTrue(called);
      } finally {
        UI.commandModeActive = originalCommandModeActive;
        UI.modeToKeyToCommand = originalModeToKeyToCommand;
        UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
        UI.keyQueue = originalKeyQueue;
        if (originalCommand) {
          Commands.commands.testShortcut = originalCommand;
        } else {
          delete Commands.commands.testShortcut;
        }
      }
    },
  );

  should("does not queue or execute matching shortcuts outside command mode", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    target.ownerDocument = fakeDocument({}, target);
    const originalCommandModeActive = UI.commandModeActive;
    const originalModeToKeyToCommand = UI.modeToKeyToCommand;
    const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
    const originalKeyQueue = UI.keyQueue;
    const originalCommand = Commands.commands.inactiveModeShortcut;
    let called = false;

    try {
      UI.commandModeActive = false;
      UI.keyQueue = [];
      UI.modeToKeyToCommand = { normal: { "a": "inactiveModeShortcut" } };
      UI.keyMappingsPrefixes = { normal: {} };
      Commands.commands.inactiveModeShortcut = { fn: () => called = true };

      const event = fakeKeyEvent("a", target);
      UI._onKeydown(event);

      assert.equal([], UI.keyQueue);
      assert.isFalse(called);
      assert.isFalse(event.prevented);
      assert.isFalse(event.stopped);
      assert.isFalse(event.immediateStopped);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      UI.modeToKeyToCommand = originalModeToKeyToCommand;
      UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
      UI.keyQueue = originalKeyQueue;
      if (originalCommand) {
        Commands.commands.inactiveModeShortcut = originalCommand;
      } else {
        delete Commands.commands.inactiveModeShortcut;
      }
    }
  });

  should("clears pending key queue when shortcuts are suppressed", () => {
    const input = fakeElement({ tagName: "INPUT" });
    input.ownerDocument = fakeDocument({}, input);
    const originalKeyQueue = UI.keyQueue;

    try {
      UI.keyQueue = ["t"];
      UI._onKeydown(fakeKeyEvent("a", input));

      assert.equal([], UI.keyQueue);
    } finally {
      UI.keyQueue = originalKeyQueue;
    }
  });

  should("suppresses IME text input after consuming a shortcut key", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    const doc = fakeDocument({}, target);
    target.ownerDocument = doc;
    const originalCommandModeActive = UI.commandModeActive;
    const originalCommandModeTimeoutId = UI.commandModeTimeoutId;
    const originalModeToKeyToCommand = UI.modeToKeyToCommand;
    const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
    const originalKeyQueue = UI.keyQueue;
    const originalRecentMainWorldShortcutEvents = UI.recentMainWorldShortcutEvents;
    const originalSuppressionUntil = UI.textInputSuppressionUntil;
    const originalSuppressionDocument = UI.textInputSuppressionDocument;
    const originalRollbackBuffer = UI.imeTextRollbackBuffer;
    const originalRollbackBufferUntil = UI.imeTextRollbackBufferUntil;

    try {
      UI.commandModeActive = true;
      UI.commandModeTimeoutId = null;
      UI.keyQueue = [];
      UI.recentMainWorldShortcutEvents = [];
      UI.modeToKeyToCommand = { normal: { "t•s": "setLineSpacing115" } };
      UI.keyMappingsPrefixes = { normal: { "t": true } };
      UI.textInputSuppressionUntil = 0;
      UI.textInputSuppressionDocument = null;
      UI.imeTextRollbackBuffer = "";
      UI.imeTextRollbackBufferUntil = 0;

      const keydownEvent = fakeKeyEvent("t", target);
      keydownEvent.keyCode = 229;
      keydownEvent.which = 229;
      keydownEvent.code = "KeyT";

      UI._onKeydown(keydownEvent);

      assert.equal(["t"], UI.keyQueue);
      assert.isTrue(keydownEvent.prevented);
      assert.isTrue(keydownEvent.stopped);
      assert.isTrue(keydownEvent.immediateStopped);

      const beforeInputEvent = fakeTextInputEvent("beforeinput", target);
      UI._onPotentialShortcutTextInput(beforeInputEvent);

      assert.isTrue(beforeInputEvent.prevented);
      assert.isTrue(beforeInputEvent.stopped);
      assert.isTrue(beforeInputEvent.immediateStopped);
    } finally {
      UI.commandModeActive = originalCommandModeActive;
      if (UI.commandModeTimeoutId) clearTimeout(UI.commandModeTimeoutId);
      UI.commandModeTimeoutId = originalCommandModeTimeoutId;
      UI.modeToKeyToCommand = originalModeToKeyToCommand;
      UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
      UI.keyQueue = originalKeyQueue;
      UI.recentMainWorldShortcutEvents = originalRecentMainWorldShortcutEvents;
      UI.textInputSuppressionUntil = originalSuppressionUntil;
      UI.textInputSuppressionDocument = originalSuppressionDocument;
      UI.imeTextRollbackBuffer = originalRollbackBuffer;
      UI.imeTextRollbackBufferUntil = originalRollbackBufferUntil;
    }
  });

  should("does not suppress delete input after consuming a shortcut key", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    const doc = fakeDocument({}, target);
    target.ownerDocument = doc;
    const originalSuppressionUntil = UI.textInputSuppressionUntil;
    const originalSuppressionDocument = UI.textInputSuppressionDocument;

    try {
      UI.textInputSuppressionUntil = Date.now() + UI.textInputSuppressionMs;
      UI.textInputSuppressionDocument = doc;

      const beforeInputEvent = fakeTextInputEvent("beforeinput", target, {
        inputType: "deleteContentBackward",
      });
      UI._onPotentialShortcutTextInput(beforeInputEvent);

      assert.isFalse(beforeInputEvent.prevented);
      assert.isFalse(beforeInputEvent.stopped);
      assert.isFalse(beforeInputEvent.immediateStopped);
    } finally {
      UI.textInputSuppressionUntil = originalSuppressionUntil;
      UI.textInputSuppressionDocument = originalSuppressionDocument;
    }
  });

  should("guards text input after consuming any plain printable shortcut key", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    target.ownerDocument = fakeDocument({}, target);
    const originalSuppressionUntil = UI.textInputSuppressionUntil;
    const originalSuppressionDocument = UI.textInputSuppressionDocument;
    const originalRollbackBuffer = UI.imeTextRollbackBuffer;
    const originalRollbackBufferUntil = UI.imeTextRollbackBufferUntil;
    const originalScheduleRollback = UI._scheduleImeTextMutationRollback;

    try {
      let scheduled = false;
      UI.textInputSuppressionUntil = 0;
      UI.textInputSuppressionDocument = null;
      UI.imeTextRollbackBuffer = "";
      UI.imeTextRollbackBufferUntil = 0;
      UI._scheduleImeTextMutationRollback = () => scheduled = true;

      UI._cancelEvent(fakeKeyEvent("t", target), "t");

      assert.isTrue(scheduled);
      assert.isTrue(UI.textInputSuppressionUntil > 0);
      assert.equal("t", UI.imeTextRollbackBuffer);
    } finally {
      UI.textInputSuppressionUntil = originalSuppressionUntil;
      UI.textInputSuppressionDocument = originalSuppressionDocument;
      UI.imeTextRollbackBuffer = originalRollbackBuffer;
      UI.imeTextRollbackBufferUntil = originalRollbackBufferUntil;
      UI._scheduleImeTextMutationRollback = originalScheduleRollback;
    }
  });

  should("does not guard text input for modified shortcut keys", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    const event = fakeKeyEvent("z", target);
    const originalScheduleRollback = UI._scheduleImeTextMutationRollback;

    try {
      let scheduled = false;
      event.metaKey = true;
      UI._scheduleImeTextMutationRollback = () => scheduled = true;

      UI._cancelEvent(event, "z");

      assert.isFalse(scheduled);
    } finally {
      UI._scheduleImeTextMutationRollback = originalScheduleRollback;
    }
  });

  should("uses the event document body as the shortcut text rollback root", () => {
    const body = fakeElement({ tagName: "BODY" });
    const target = fakeElement({ tagName: "DIV" });
    const doc = fakeDocument({}, target);
    doc.body = body;
    target.ownerDocument = doc;

    assert.equal(body, UI._getImeTextMutationRoot({ target }));
  });

  should("detects shortcut text inserted into a text node", () => {
    assert.isTrue(UI._isSingleInsertedShortcutText("abtc", "abc", "t"));
    assert.isTrue(UI._isSingleInsertedShortcutText("tsabc", "abc", "ts"));
    assert.isFalse(UI._isSingleInsertedShortcutText("axc", "abc", "x"));
    assert.isFalse(UI._isSingleInsertedShortcutText("abxyc", "abc", "x"));
  });

  should("rolls back combined IME shortcut text mutations", () => {
    const originalRollbackBuffer = UI.imeTextRollbackBuffer;
    const originalRollbackBufferUntil = UI.imeTextRollbackBufferUntil;
    const textNode = { nodeType: 3, data: "abtsc" };

    try {
      UI.imeTextRollbackBuffer = "ts";
      UI.imeTextRollbackBufferUntil = Date.now() + 1000;

      const rolledBack = UI._rollbackImeShortcutTextMutation({
        type: "characterData",
        target: textNode,
        oldValue: "abc",
      }, "s");

      assert.isTrue(rolledBack);
      assert.equal("abc", textNode.data);
    } finally {
      UI.imeTextRollbackBuffer = originalRollbackBuffer;
      UI.imeTextRollbackBufferUntil = originalRollbackBufferUntil;
    }
  });

  should("rolls back inserted shortcut text nodes", () => {
    const addedNode = {
      nodeType: 3,
      data: "t",
      parentNode: {
        removedNode: null,
        removeChild(node) {
          this.removedNode = node;
        },
      },
    };

    const rolledBack = UI._rollbackImeShortcutTextMutation({
      type: "childList",
      addedNodes: [addedNode],
    }, "t");

    assert.isTrue(rolledBack);
    assert.isTrue(addedNode.parentNode.removedNode === addedNode);
  });

  should("ignores keydown before mappings finish loading", () => {
    const target = fakeElement({ tagName: "DIV", className: "punch-viewer" });
    target.ownerDocument = fakeDocument({}, target);
    const originalModeToKeyToCommand = UI.modeToKeyToCommand;
    const originalKeyMappingsPrefixes = UI.keyMappingsPrefixes;
    const originalKeyQueue = UI.keyQueue;

    try {
      UI.keyQueue = [];
      UI.modeToKeyToCommand = null;
      UI.keyMappingsPrefixes = null;

      const event = fakeKeyEvent("a", target);
      UI._onKeydown(event);

      assert.equal([], UI.keyQueue);
      assert.isFalse(event.prevented);
      assert.isFalse(event.stopped);
    } finally {
      UI.modeToKeyToCommand = originalModeToKeyToCommand;
      UI.keyMappingsPrefixes = originalKeyMappingsPrefixes;
      UI.keyQueue = originalKeyQueue;
    }
  });
});

context("SlideActions", () => {
  should("waits for toolbar menu items before clicking them", async () => {
    const originalDocument = globalThis.document;
    const originalSimulateClick = UI.simulateClick;
    const originalSleep = SlideActions._sleep;
    const originalConsoleLog = console.log;
    const toolbarButton = fakeElement({ attrs: { "aria-label": "Line spacing" } });
    const menuItem = fakeElement({ className: "goog-menuitem" });
    const visibleMenu = fakeElement({ className: "goog-menu" });
    let toolbarClicked = false;
    let menuItemClicked = false;
    menuItem.innerText = "1.15";

    try {
      globalThis.document = {
        querySelectorAll(selector) {
          if (selector === "*[aria-label='Line spacing']") return [toolbarButton];
          if (selector === "*[aria-label='Line & paragraph spacing']") return [];
          if (selector === ".goog-menuitem") return toolbarClicked ? [menuItem] : [];
          if (selector === ".goog-menu") return [visibleMenu];
          return [];
        },
      };
      UI.simulateClick = (el) => {
        if (el === toolbarButton) toolbarClicked = true;
        if (el === menuItem) menuItemClicked = true;
      };
      SlideActions._sleep = async () => {};
      console.log = () => {};

      await SlideActions._clickToolbarMenu("Line spacing", "1.15");

      assert.isTrue(toolbarClicked);
      assert.isTrue(menuItemClicked);
      assert.equal("none", visibleMenu.style.display);
    } finally {
      globalThis.document = originalDocument;
      UI.simulateClick = originalSimulateClick;
      SlideActions._sleep = originalSleep;
      console.log = originalConsoleLog;
    }
  });
});
