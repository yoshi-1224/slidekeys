// This script gets inserted into the page by our content script.
// It receives requests from the content script to simulate keypresses.
// Messages are passed to this script via "sheetkeys-simulate-keydown" events, which are dispatched
// on the window object by the content script.

// How to simulate a keypress in Chrome: http://stackoverflow.com/a/10520017/46237
// Note that we have to do this keypress simulation in an injected script, because events dispatched
// by content scripts do not preserve overridden properties.
// - args: an object with keys keyCode, shiftKey
const _simulateKeyEvent = function (eventType, el, args) {
  // How to do this in Chrome: http://stackoverflow.com/q/10455626/46237
  const event = document.createEvent("KeyboardEvent");
  Object.defineProperty(event, "keyCode", {
    get() {
      return this.keyCodeVal;
    },
  });
  Object.defineProperty(event, "which", {
    get() {
      return this.keyCodeVal;
    },
  });
  event.initKeyboardEvent(
    eventType, // eventName
    true, // canBubble
    true, //canceleable
    document.defaultView, // view
    "", // keyIdentifier string
    false, // (not sure)
    args.mods.control, // control
    null, // (not sure)
    args.mods.shift, // shift
    args.mods.meta, // meta
    args.keyCode, // keyCode
    args.keyCode, // (not sure)
  );
  event.keyCodeVal = args.keyCode;
  // console.log "Simulating keyboard event:", args.keyCode, args, event
  el.dispatchEvent(event);
};

const jsonEl = document.createElement("div");
jsonEl.style.display = "none";
jsonEl.id = "sheetkeys-json-message";
document.body.appendChild(jsonEl);

window.addEventListener("sheetkeys-simulate-key-event", function (_event) {
  const editorEl = document.getElementById("waffle-rich-text-editor");
  const args = JSON.parse(jsonEl.innerText);
  // We simulate all three events because it's needed for some keystrokes to be recognized by Google
  // sheets (in particular, the Enter key).
  _simulateKeyEvent("keydown", editorEl, args);
  _simulateKeyEvent("keypress", editorEl, args);
  _simulateKeyEvent("keyup", editorEl, args);
});
