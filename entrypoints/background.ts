export default defineBackground(() => {
  console.log("[panes] background service worker booted");

  chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL("/split.html?layout=4");
    await chrome.tabs.create({ url });
  });
});
