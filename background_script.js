const EXTENSION_COMMAND_MESSAGE = "slidekeys-extension-command";

function onError(error) {
  // The error "could not establish connection. Receiving end does not exist" happens when the
  // tabs being queried are not Google Slides pages and do not have the SlideKeys content scripts
  // loaded. This is expected.
  console.log("Error sending message to tabs:", error);
}

// We want to broadcast a message to this extension's content scripts in every tab when a key
// mapping changes. However, the chrome.tabs API is only available to background scripts.
chrome.runtime.onMessage.addListener(async (request) => {
  console.log("Background page received message.", request);

  if (request == "keyMappingChange") {
    const tabs = await chrome.tabs.query({});
    for (const tab of Array.from(tabs)) {
      chrome.tabs.sendMessage(tab.id, request).catch(onError);
    }
  }
});

chrome.commands.onCommand.addListener(async (commandName) => {
  if (commandName !== "setLineSpacing115") return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) return;

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: EXTENSION_COMMAND_MESSAGE,
      commandName,
    },
    { frameId: 0 },
  ).catch(onError);
});
