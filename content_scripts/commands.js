const Commands = {
  // This character is U+0095, and is used as a separator in the string representation of a sequence
  // of keys. It cannot itself appear as a key.
  KEY_SEPARATOR: "•",
  defaultMapping: null,

  // Commands will appear in the help dialog, grouped by "group", in the order that they're defined
  // in this map.
  commands: {
    showHelp: {
      fn: SlideActions.showHelpDialog,
      name: "Show help",
      group: "other",
      mode: "normal",
      defaultMapping: "?",
    },

    alignObjectsTop: {
      fn: async () => { SlideActions.runAction("alignObjectsTop") },
      name: "Align Objects Top",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•t",
    },
    
    alignObjectsMiddle: {
      fn: async () => { SlideActions.runAction("alignObjectsMiddle") },
      name: "Align Objects Middle",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•m",
    },

    alignObjectsBottom: {
      fn: async () => { SlideActions.runAction("alignObjectsBottom") },
      name: "Align Objects Bottom",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•b",
    },

    alignObjectsCenter: {
      fn: async () => { SlideActions.runAction("alignObjectsCenter") },
      name: "Align Objects Center",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•c",
    },

    alignObjectsLeft: {
      fn: async () => { SlideActions.runAction("alignObjectsLeft") },
      name: "Align Objects Left",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•l",
    },

    alignObjectsRight: {
      fn: async () => { SlideActions.runAction("alignObjectsRight") },
      name: "Align Objects Right",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•a•r",
    },

    distributeObjectsHorizontally: {
      fn: async () => { SlideActions.runAction("distributeObjectsHorizontally") },
      name: "Align Objects Right",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•d•h",
    },

    distributeObjectsVertically: {
      fn: async () => { SlideActions.runAction("distributeObjectsVertically") },
      name: "Align Objects Right",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•d•v",
    },

    alignTextTop: {
      fn: async () => { SlideActions.runAction("alignTextTop") },
      name: "Align Text Top",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•t•t",
    },

    alignTextBottom: {
      fn: async () => { SlideActions.runAction("alignTextBottom") },
      name: "Align Text Bottom",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•t•b",
    },

    alignTextRight: {
      fn: async () => { SlideActions.runAction("alignTextRight") },
      name: "Align Text Right",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•t•r",
    },

    alignTextLeft: {
      fn: async () => { SlideActions.runAction("alignTextLeft") },
      name: "Align Text Left",
      group: "arrange",
      mode: "normal",
      defaultMapping: ";•t•l",
    }
  },

  // Returns a map of groupName => [commandKey]
  getCommandsByGroup: function() {
    const groupedEntries = {};
    for (const [key, command] of Object.entries(this.commands)) {
      const group = command.group;

      if (!groupedEntries[group]) {
        groupedEntries[group] = [];
      }
      groupedEntries[group].push(key);
    }
    return groupedEntries;
  },

  // Returns a map of mode.command.shortcut
  // {
  //   "normal": {
  //     "alignTextLeft": ";•t•l",
  //   },
  // },
  getCommandsByMode: function() {
    const groupedEntries = {};
    for (const [key, command] of Object.entries(this.commands)) {
      const mode = command.mode;

      if (!groupedEntries[mode]) {
        groupedEntries[mode] =  {}
      }
      groupedEntries[mode][key] = command.defaultMapping;
    }
    return groupedEntries;
  },

  getDefaultMappings: function() {
    if (this.defaultMapping == null)
      this.defaultMapping = this.getCommandsByMode();
    return this.defaultMapping;
  }
}

window.Commands = Commands;
