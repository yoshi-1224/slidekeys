// order of execution for content_script
// https://developer.chrome.com/docs/extensions/mv3/manifest/content_scripts/#js

// function used to change mapping from "command -> key mapping" to "key mapping -> command"
const Utils = {
  invertObjectMap: (o) => {
    const o2 = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      o2[v] = k;
    }
    return o2;
  },
  
  // Add an event listener which removes itself once the event is fired once.
  addOneTimeListener: function (dispatcher, eventType, listenerFn) {
    const handlerFn = function (e) {
      dispatcher.removeEventListener(eventType, handlerFn, true);
      return listenerFn(e);
    };
    return dispatcher.addEventListener(eventType, handlerFn, true);
  }
}

window.Utils = Utils;