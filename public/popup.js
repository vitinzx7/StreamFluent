chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const statusEl = document.getElementById("status");

  if (!tab?.url) {
    statusEl.textContent = "Unable to detect page.";
    return;
  }

  const url = new URL(tab.url);
  const host = url.hostname;

  if (host.includes("netflix.com")) {
    statusEl.textContent = "Netflix detected. Open a video to start.";
  } else if (host.includes("max.com") || host.includes("hbomax.com")) {
    statusEl.textContent = "Max detected. Open a video to start.";
  } else {
    statusEl.textContent = "Navigate to Netflix or Max to use StreamFluent.";
  }
});

document.getElementById("openLibrary")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});
