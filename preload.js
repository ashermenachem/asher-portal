const {
  contextBridge,
  ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld("terminalAPI", {
  sendInput(data) {
    ipcRenderer.send("terminal:input", data);
  },

  resize(columns, rows) {
    ipcRenderer.send(
      "terminal:resize",
      columns,
      rows
    );
  },

  navigatePreview(value) {
    ipcRenderer.send(
      "preview:navigate",
      value
    );
  },

  newTab() {
    ipcRenderer.send("preview:new-tab");
  },

  activateTab(tabId) {
    ipcRenderer.send(
      "preview:activate-tab",
      tabId
    );
  },

  closeTab(tabId) {
    ipcRenderer.send(
      "preview:close-tab",
      tabId
    );
  },

  goBack() {
    ipcRenderer.send("preview:back");
  },

  goForward() {
    ipcRenderer.send("preview:forward");
  },

  reloadPreview() {
    ipcRenderer.send("preview:reload");
  },

  openPreviewExternally() {
    ipcRenderer.send("preview:open-external");
  },

  closePreview() {
    ipcRenderer.send("preview:close");
  },

  togglePreviewFullWindow() {
    ipcRenderer.send(
      "preview:toggle-full-window"
    );
  },

  getAppInfo() {
    return ipcRenderer.invoke("app:info");
  },

  onData(callback) {
    const listener = (_event, data) => {
      callback(data);
    };

    ipcRenderer.on("terminal:data", listener);

    return () => {
      ipcRenderer.removeListener(
        "terminal:data",
        listener
      );
    };
  },

  onPreviewState(callback) {
    const listener = (_event, state) => {
      callback(state);
    };

    ipcRenderer.on("preview:state", listener);

    return () => {
      ipcRenderer.removeListener(
        "preview:state",
        listener
      );
    };
  },

  onFocusAddress(callback) {
    const listener = () => {
      callback();
    };

    ipcRenderer.on(
      "browser:focus-address",
      listener
    );

    return () => {
      ipcRenderer.removeListener(
        "browser:focus-address",
        listener
      );
    };
  }
});
