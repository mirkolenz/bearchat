// Tracks the height left by the on-screen keyboard as --viewport-height, which falls back to dvh in index.css.
// Safari ignores interactive-widget and keeps dvh at the full height while the keyboard is open.
// The scale undoes pinch zoom, which shrinks the visual viewport without leaving less room for the layout.
const viewport = window.visualViewport;

if (viewport) {
  let height = 0;
  // resizes fire on every frame while the keyboard slides in, so only actual changes restyle the app
  const update = () => {
    const next = Math.round(viewport.height * viewport.scale);

    if (next !== height) {
      height = next;
      document.documentElement.style.setProperty("--viewport-height", `${height}px`);
    }
  };
  viewport.addEventListener("resize", update);
  update();
}
