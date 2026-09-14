import { ipcMain } from "electron";
import { IPC, type LicenseKey, type LicenseState } from "../../shared/types";
import { activateLicense, deactivateLicense, getCurrentLicenseState } from "../licensing/currentLicense";

export function registerLicenseIpc(): void {
  ipcMain.handle(IPC.license.getState, (): LicenseState => {
    return getCurrentLicenseState();
  });

  ipcMain.handle(IPC.license.activate, (_event, licenseKey: LicenseKey): LicenseState => {
    const state = activateLicense(licenseKey);
    if (state.validity !== "valid") {
      // Still return the state (don't throw) so the UI can show a precise
      // "invalid" / "expired" message rather than a generic IPC error.
      return state;
    }
    return state;
  });

  ipcMain.handle(IPC.license.deactivate, (): LicenseState => {
    return deactivateLicense();
  });
}
