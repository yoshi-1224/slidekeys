const SlideActions = {
  // NOTE(philc): When developing, you can use this snippet to preview all available menu items:
  // Array.from(document.querySelectorAll(".goog-menuitem")).forEach((i) => console.log(i.innerText))
  // need to load these into DOM first
  actions: {
    alignObjectsTop: {
      type: "menu",
      menuName: "Top",
      parentMenu: "Align►"
    },
    alignObjectsMiddle: {
      type: "menu",
      menuName: "Middle",
      parentMenu: "Align►"
    },
    alignObjectsBottom: {
      type: "menu",
      menuName: "Bottom",
      parentMenu:"Align►"
    },
    alignObjectsLeft: {
      type: "menu",
      menuName: "Left",
      parentMenu: "Align►"
    },
    alignObjectsCenter: {
      type: "menu",
      menuName: "Center",
      parentMenu: "Align►"
    },
    alignObjectsRight: {
      type: "menu",
      menuName: "Right",
      parentMenu: "Align►"
    },
    // "Horizontally" and "Vertically" gets mixed up with Distribute and Center on Page
    distributeObjectsHorizontally: {
      type: "menu",
      menuName: "Horizontally",
      parentMenu: "Distribute►"
    },
    distributeObjectsVertically: {
      type: "menu",
      menuName: "Vertically",
      parentMenu: "Distribute►"
    },
    
    // text alignments, which is querySelectorAll(`*[aria-label='Align']`);
    // document.querySelectorAll(`*[aria-label='Top']`);
    alignTextTop: {
      type: "toolbar",
      captionList: ["Align", "Top"]
    },
    // document.querySelectorAll(`*[aria-label='Middle']`);
    alignTextMiddle: {
      type: "toolbar",
      captionList: ["Align", "Middle"]
    },
    // document.querySelectorAll(`*[aria-label='Bottom']`);
    alignTextBottom: {
      type: "toolbar",
      captionList: ["Align", "Bottom"]
    },
    // document.querySelectorAll(`*[aria-label='Bottom']`);
    alignTextRight: {
      type: "toolbar",
      captionList: ["Align", "Right"]
    },
    // document.querySelectorAll(`*[aria-label='Bottom']`);
    alignTextLeft: {
      type: "toolbar",
      captionList: ["Align", "Left"]
    },
    setLineSpacing115: {
      type: "toolbar_menu",
      toolbarName: "Line spacing",
      menuName: "1.15"
    },
    setIndentation: {
      type: "menu",
      menuName: "Indentation",
      parentMenu: "custom slide menu►",
      topMenuButtonSelector: "#docs-extensions-menu"
    },
    setShapePrimaryColor: {
      type: "menu",
      menuName: "Shape Primary Color",
      parentMenu: "custom slide menu►",
      topMenuButtonSelector: "#docs-extensions-menu"
    },
    setShapeSecondaryColor: {
      type: "menu",
      menuName: "Shape Secondary Color",
      parentMenu: "custom slide menu►",
      topMenuButtonSelector: "#docs-extensions-menu"
    },
    setTextGreen: {
      type: "menu",
      menuName: "Text Green",
      parentMenu: "custom slide menu►",
      topMenuButtonSelector: "#docs-extensions-menu"
    }
  },

  // A mapping of button-caption to DOM element.
  MappingCacheOfmenuItemToElements: {},

  // This is a function that will get assigned to by ui.js. We're not referencing ui.js directly, so
  // that we can avoid a circular dependency.
  typeKeyFn: null,

  _clickToolbarButton(captionList) {
    // Sometimes a toolbar button won't exist in the DOM until its parent has been clicked, so we
    // click all of its parents in sequence.
    for (const caption of Array.from(captionList)) {
      const els = document.querySelectorAll(`*[aria-label='${caption}']`);
      if (els.length == 0) {
        console.log(`Couldn't find the element for the button labeled ${caption}.`);
        console.log(captionList);
        return;
      }
      // Sometimes there are multiple elements that have the same label. When that happens, it's
      // ambiguous which one to click, so we log it so it's easier to debug.
      if (els.length > 1) {
        console.log(
          `Warning: there are multiple toolbarButtons with the caption ${caption}. ` +
            "We're expecting only 1.",
        );
        console.log(captionList);
      }
      UI.simulateClick(els[0]);
    }
  },

  _clickToolbarMenu(toolbarName, menuName) {
    let els = document.querySelectorAll(`*[aria-label='${toolbarName}']`);
    if (els.length == 0) {
         // Try alternative name
         els = document.querySelectorAll(`*[aria-label='Line & paragraph spacing']`);
    }
    if (els.length == 0) {
      console.log(`Couldn't find toolbar button ${toolbarName}`);
      return;
    }
    UI.simulateClick(els[0]);
    this._clickMenu(menuName);
  },

  _openMenuButton(selector) {
    const button = document.querySelector(selector);
    if (!button) {
      console.log(`Couldn't find menu button ${selector}`);
      return;
    }
    UI.simulateClick(button);
  },

  // Returns the DOM element of the menu item with the given caption. Prints a warning if a menu
  // item isn't found (since this is a common source of errors in SheetKeys) unless silenceWarning
  // is true.
  _getMenuItem(caption, silenceWarning) {
    if (silenceWarning == null) silenceWarning = false;
    let item = this.MappingCacheOfmenuItemToElements[caption];
    if (item) return item;
    item = this._findMenuItem(caption);
    if (!item) {
      if (!silenceWarning) console.log(`Error: could not find menu item with caption ${caption}`);
      return null;
    }
    return this.MappingCacheOfmenuItemToElements[caption] = item;
  },

  _findMenuItem(caption) {
    const menuItems = document.querySelectorAll(".goog-menuitem");
    for (const menuItem of Array.from(menuItems)) {
      let label = menuItem.innerText;
      if (!label) continue;
      // remove new line in label
      label = label.replace(/[\r\n]+/gm, "");
      if (caption instanceof RegExp) {
        if (caption.test(label)) {
          return menuItem;
        }
      } else {
        if (caption === label) {
          return menuItem;
        }
      }
    }
    return null;
  },

  _clickMenu(itemCaption) {
    const item = this._getMenuItem(itemCaption);
    if (!item) return;
    UI.simulateClick(item);
  },

  // Shows and then hides a submenu in the File menu system. This triggers creation of the toolbarButtons
  // in that submenu, so they can be clicked.
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Polls for a menu item to appear in the DOM, returning it when found or null on timeout.
  async _waitForMenuItem(caption, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const item = this._findMenuItem(caption);
      if (item) return item;
      await this._sleep(30);
    }
    return null;
  },

  // Opens a parent submenu so its children get created in the DOM.
  // Does NOT hide menus — caller is responsible for cleanup.
  async _activateMenu(menuCaption) {
    let item = this._getMenuItem(menuCaption, true);
    if (!item) {
      // Open Arrange menu (keep it open) to generate submenu items in the DOM.
      UI.simulateClick(document.querySelector("#sketchy-arrange-menu"));
      await this._sleep(100);
      item = this._getMenuItem(menuCaption, true);
    }
    if (item) {
      // Click the submenu item to trigger its children to be created in the DOM.
      UI.simulateClick(item);
    }
  },

  _hideAllMenus() {
    const menus = Array.from(document.querySelectorAll(".goog-menu"));
    for (const m of menus) {
      m.style.display = "none";
    }
  },


  async showHelpDialog() {
    console.log("showHelpDialog");
    UI.ignoreKeys = true;
    const h = new HelpDialog();
    h.addEventListener("hide", () => {
      UI.ignoreKeys = false;
    });
    await h.show();
  },

  async runAction(action_type) {
    console.log("slide_actions.js:", action_type);
    let action = this.actions[action_type]
    if (!action) {
      console.log("slide_actions.js->runAction: no matching action found for", action_type);
      return;
    }
    if (action.type === "menu") {
      if (action.topMenuButtonSelector) {
        this._openMenuButton(action.topMenuButtonSelector);
      }
      // Open parent submenu (keeps menus visible so children can render)
      await this._activateMenu(action.parentMenu);
      // Poll for the target menu item to appear (up to 1 second)
      const menuItem = await this._waitForMenuItem(action.menuName, 1000);
      if (menuItem) {
        UI.simulateClick(menuItem);
      } else {
        console.log(`Error: timed out waiting for menu item "${action.menuName}"`);
      }
      this._hideAllMenus();
    } else if (action.type === "toolbar") {
      this._clickToolbarButton(action.captionList);
    } else if (action.type === "toolbar_menu") {
      this._clickToolbarMenu(action.toolbarName, action.menuName);
    }
  }
};

// Logs a backtrace when an assertion fails, and also halts execution by throwing an error. We do
// both, because logged objects in console.assert are easier to read from the DevTools console
// than just the output from an error.
const assert = (expression, ...messages) => {
  console.assert.apply(console, [expression].concat(messages));
  if (!expression) {
    throw new Error(messages.join(" "));
  }
};

window.SlideActions = SlideActions;
