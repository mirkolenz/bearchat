import "@/index.css";
import "@/lib/viewport";

// Ask the browser not to evict the chat history under storage pressure.
void navigator.storage.persist();

// After a deploy, an open or restored page still references the chunks of the previous build,
// so it reloads once to get the current one, the flag stops a loop if the reloaded page fails too.
const reloadFlag = "bearchat:reloaded";
window.addEventListener("vite:preloadError", () => {
  if (!sessionStorage.getItem(reloadFlag)) {
    sessionStorage.setItem(reloadFlag, "1");
    location.reload();
  }
});

// Temporal for browsers without native support, also for the startup failure, whose data section uses it.
const temporal = "Temporal" in globalThis || import("temporal-polyfill/global");
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
      temporal,
    ]);
    renderApp(root, startup);
    sessionStorage.removeItem(reloadFlag);
  } catch (error) {
    // loaded only here, so a normal start does not download it,
    // and shown even if Temporal failed to load, which only the export needs
    const [{ renderStartupFailure }] = await Promise.all([
      import("@/components/startup-failure"),
      Promise.resolve(temporal).catch(() => undefined),
    ]);
    renderStartupFailure(root, error);
  }
}
