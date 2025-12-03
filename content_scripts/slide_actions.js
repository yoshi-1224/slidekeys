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
          if (["Horizontally", "Vertically"].includes(caption)) {
             // We want the distribute action, which has an icon.
             if (menuItem.querySelectorAll(".goog-menuitem-icon").length > 0) {
               return menuItem;
             }
             continue;
          }
          return menuItem;
        }
      }
    }
    return null;
  },

  _clickMenu(itemCaption) {
    UI.simulateClick(this._getMenuItem(itemCaption));
  },

  // Shows and then hides a submenu in the File menu system. This triggers creation of the toolbarButtons
  // in that submenu, so they can be clicked.
  _activateMenu(menuCaption) {
    try {
      this._clickMenu(menuCaption);
    } catch (error) {
      this._pregenerateArrangeMenu();
      this._clickMenu(menuCaption);
    }
    
    // Once the submenu is shown, it can only be hidden by modifying its style attribute. It's not
    // possible to identify and find the specific submenu DOM element that was created and shown as
    // a result of clicking on the menuButton, so we brute force hide all menus.
    const menus = Array.from(document.querySelectorAll(".goog-menu"));
    for (const m of menus) {
      m.style.display = "none";
    }
  },

  _pregenerateArrangeMenu() {
    // menus under Arrange will not exist in DOM before Arrange is clicked
    UI.simulateClick(document.querySelector("#sketchy-arrange-menu"));
    // click again to hide
    UI.simulateClick(document.querySelector("#sketchy-arrange-menu"));
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

  runAction(action_type) {
    console.log("slide_actions.js:", action_type);
    let action = this.actions[action_type]
    if (!action) {
      console.log("slide_actions.js->runAction: no matching action found for", action_type);
      return;
    }
    if (action.type === "menu") {
      // click parent menu first
      this._activateMenu(action.parentMenu);
      this._clickMenu(action.menuName);
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
