document.addEventListener("DOMContentLoaded", function () {
  const enabledInput = document.getElementById("enabled");
  const autoLoadEnabledInput = document.getElementById("autoLoadEnabled");
  const autoLoadIntervalInput = document.getElementById("autoLoadIntervalSeconds");

  chrome.storage.local.get(
    ["enabled", "autoLoadEnabled", "autoLoadIntervalSeconds"],
    function (result) {
      const enabled =
        typeof result.enabled === "boolean" ? result.enabled : false;
      const autoLoadEnabled =
        typeof result.autoLoadEnabled === "boolean"
          ? result.autoLoadEnabled
          : false;
      const autoLoadIntervalSeconds = Number.isFinite(
        result.autoLoadIntervalSeconds
      )
        ? Math.max(1, Math.floor(result.autoLoadIntervalSeconds))
        : 60;

      enabledInput.checked = enabled;
      autoLoadEnabledInput.checked = autoLoadEnabled;
      autoLoadIntervalInput.value = autoLoadIntervalSeconds;
      autoLoadIntervalInput.disabled = !autoLoadEnabled;
    }
  );

  enabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ enabled: enabledInput.checked });
  });

  autoLoadEnabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ autoLoadEnabled: autoLoadEnabledInput.checked });
    autoLoadIntervalInput.disabled = !autoLoadEnabledInput.checked;
  });

  autoLoadIntervalInput.addEventListener("change", function () {
    let value = parseInt(autoLoadIntervalInput.value, 10);
    if (!Number.isFinite(value) || value < 1) {
      value = 1;
    }
    autoLoadIntervalInput.value = value;
    chrome.storage.local.set({ autoLoadIntervalSeconds: value });
  });
});
