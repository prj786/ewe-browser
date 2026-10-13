chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url
  if (url) document.getElementById('host').textContent = new URL(url).host || url
  document.title = `popup:${tabs.length}`
})
