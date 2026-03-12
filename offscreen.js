const TICK_INTERVAL_MS = 1000;
let timerId = null;

function startTimer() {
  if (timerId) return;
  timerId = setInterval(() => {
    chrome.runtime.sendMessage({ type: "precisionTick" });
  }, TICK_INTERVAL_MS);
}

startTimer();

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "shutdown") {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
});
