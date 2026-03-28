import { useEffect } from "react";

export default function useCommandPaletteShortcut(onToggle, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event) => {
      const isK = String(event.key || "").toLowerCase() === "k";
      if (!isK) return;

      if (!(event.ctrlKey || event.metaKey)) return;

      event.preventDefault();
      onToggle?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onToggle]);
}
