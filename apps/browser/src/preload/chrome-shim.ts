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

export const STORE_HOST = 'chromewebstore.google.com'

const BRANDS = `
(() => {
  const data = navigator.userAgentData;
  if (!data) return;
  const major = (data.brands.find((b) => b.brand === 'Chromium') || { version: '0' }).version;
  const brands = [...data.brands, { brand: 'Google Chrome', version: major }];
  const proto = Object.getPrototypeOf(data);
  const original = proto.getHighEntropyValues;
  Object.defineProperty(proto, 'brands', { get: () => brands, configurable: true });
  proto.getHighEntropyValues = function (hints) {
    return original.call(this, hints).then((values) => {
      const full = values.fullVersionList;
      if (Array.isArray(full)) {
        const chromium = full.find((b) => b.brand === 'Chromium');
        values.fullVersionList = [...full, { brand: 'Google Chrome', version: chromium ? chromium.version : major }];
      }
      values.brands = brands;
      return values;
    });
  };
})();
`

export function installChromeShim(): void {
  void webFrame.executeJavaScript(SHIM).catch(() => undefined)
  if (location.hostname === STORE_HOST)
    void webFrame.executeJavaScript(BRANDS).catch(() => undefined)
}
