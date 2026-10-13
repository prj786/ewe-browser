import { webFrame } from 'electron'

const SHIM = `
(() => {
  const chrome = window.chrome || (window.chrome = {});
  if (chrome.runtime && chrome.app) return;
  const now = () => Date.now() / 1000;
  if (!chrome.app) {
    chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails() { return null; },
      getIsInstalled() { return false; },
      runningState() { return 'cannot_run'; },
    };
  }
  if (!chrome.runtime) chrome.runtime = {};
  if (!chrome.csi) chrome.csi = () => ({ startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 });
  if (!chrome.loadTimes) chrome.loadTimes = () => ({
    requestTime: now(), startLoadTime: now(), commitLoadTime: now(),
    finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
    navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
    wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
  });
})();
`

export function installChromeShim(): void {
  void webFrame.executeJavaScript(SHIM).catch(() => undefined)
}
