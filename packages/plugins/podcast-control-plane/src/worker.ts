import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup() {
    return;
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Podcast control plane plugin ready",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
