'use strict';
const path = require('node:path');
const {app, BrowserWindow, dialog, session, Menu} = require('electron');

let mainWindow;
function createWindow(){
  mainWindow = new BrowserWindow({
    title: 'NES Asset Dump',
    width: 1280, height: 900, minWidth: 860, minHeight: 600,
    backgroundColor: '#141820',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.on('will-download', (_event, item) => {
    // Use a native Save As dialog for exports, rather than silently selecting a path.
    const safeName = path.basename(item.getFilename()).replace(/[\\/:*?"<>|]/g, '_');
    const chosen = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save NES asset export',
      defaultPath: path.join(app.getPath('downloads'), safeName),
      buttonLabel: 'Export'
    });
    if (chosen) item.setSavePath(chosen);
    else item.cancel();
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
