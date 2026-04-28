import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "Panes — Split Tab Layouts",
    description: "Split your tab into 2 or 4 panes.",
    action: {
      default_title: "Open Panes",
    },
  },
});
