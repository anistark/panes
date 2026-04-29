const SPLIT_PATH = "/split.html";

const STRIPPED_RESPONSE_HEADERS = [
  "x-frame-options",
  "frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
] as const;

function splitPagePrefix(): string {
  return chrome.runtime.getURL(SPLIT_PATH);
}

function isSplitPageUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(splitPagePrefix());
}

function isFrameableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

async function addDnrRuleForTab(tabId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          responseHeaders: STRIPPED_RESPONSE_HEADERS.map((header) => ({
            header,
            operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          })),
        },
        condition: {
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
          tabIds: [tabId],
        },
      },
    ],
  });
}

async function removeDnrRuleForTab(tabId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
  });
}

async function syncRulesAcrossTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      if (isSplitPageUrl(tab.url)) {
        await addDnrRuleForTab(tab.id);
      }
    }),
  );
}

async function openSplitTab(sourceTab?: chrome.tabs.Tab): Promise<void> {
  const params = new URLSearchParams();
  if (sourceTab?.url && isFrameableUrl(sourceTab.url)) {
    params.set("pane1", sourceTab.url);
  }
  const query = params.toString();
  const url = chrome.runtime.getURL(
    `${SPLIT_PATH}${query ? `?${query}` : ""}`,
  );
  const tab = await chrome.tabs.create({ url });
  if (tab.id !== undefined) {
    await addDnrRuleForTab(tab.id);
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

export default defineBackground(() => {
  console.log("[panes] background service worker booted");

  syncRulesAcrossTabs().catch((error) =>
    console.error("[panes] sync rules failed", error),
  );

  chrome.action.onClicked.addListener((tab) => {
    void openSplitTab(tab);
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "open-split") return;
    const tab = await activeTab();
    await openSplitTab(tab);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    removeDnrRuleForTab(tabId).catch(() => {
      /* tab already gone */
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url === undefined) return;
    if (isSplitPageUrl(changeInfo.url)) {
      addDnrRuleForTab(tabId).catch(() => {});
    } else {
      removeDnrRuleForTab(tabId).catch(() => {});
    }
  });
});
