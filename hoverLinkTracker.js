(() => {
  const LINK_SELECTOR = "a[href]";
  let lastSentUrl = "";

  function resolveLinkUrl(target) {
    if (!target || !target.closest) return "";
    const link = target.closest(LINK_SELECTOR);
    if (!link) return "";
    const href = link.getAttribute("href");
    if (!href) return "";
    try {
      return new URL(href, window.location.href).href;
    } catch {
      return "";
    }
  }

  function handleEvent(event) {
    const url = resolveLinkUrl(event.target);
    if (!url || url === lastSentUrl) return;
    lastSentUrl = url;
    chrome.runtime.sendMessage({ type: "hoveredLink", url }).catch(() => {});
  }

  document.addEventListener("mouseover", handleEvent, true);
  document.addEventListener("focusin", handleEvent, true);
})();
