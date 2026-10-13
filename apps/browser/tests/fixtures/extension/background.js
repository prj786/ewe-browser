setTimeout(() => {
  chrome.action.setBadgeText({ text: '3' })
  chrome.action.setBadgeBackgroundColor({ color: '#3b6e4a' })
}, 500)
