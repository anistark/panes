import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "Panes — Split Tab Layouts",
    description: "Split your tab into 2 or 4 panes.",
    action: {
      default_title: "Open Panes",
      default_icon: {
        16: "icon/icon-16.png",
        32: "icon/icon-32.png",
        48: "icon/icon-48.png",
        128: "icon/icon-128.png",
      },
    },
    icons: {
      16: "icon/icon-16.png",
      32: "icon/icon-32.png",
      48: "icon/icon-48.png",
      128: "icon/icon-128.png",
    },
    permissions: [
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
      "storage",
      "tabs",
    ],
    host_permissions: ["<all_urls>"],
    commands: {
      "open-split": {
        suggested_key: {
          default: "Ctrl+Shift+S",
          mac: "Command+Shift+S",
        },
        description: "Open a Panes split tab",
      },
    },
  },
});
