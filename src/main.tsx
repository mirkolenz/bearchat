import "@/index.css";
import "@/lib/viewport";

// Ask the browser not to evict the chat history under storage pressure.
void navigator.storage.persist();

const root = document.getElementById("root");

if (root) {
  try {
    // Everything else is loaded dynamically, so that the startup data loads while the app downloads,
    // and so that an invalid config.json is reported instead of leaving a blank page.
    // The config is imported on its own, which requests it before the modules that use it have downloaded.
    const [{ renderApp }, startup] = await Promise.all([
      import("@/App"),
      import("@/start").then(({ start }) => start()),
      import("@/lib/config"),
    ]);
    renderApp(root, startup);
  } catch (error) {
    // loaded only here, so a normal start does not download it
    const { renderStartupFailure } = await import("@/components/startup-failure");
    renderStartupFailure(root, error);
  }
}
