export default defineBackground(() => {
  console.log("[panes] background service worker booted");

  chrome.action.onClicked.addListener((tab) => {
    console.log("[panes] action clicked on tab", tab.id, tab.url);
  });
});
