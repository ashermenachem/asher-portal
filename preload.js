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

  closePreview() {
    ipcRenderer.send("preview:close");
  },

  togglePreviewFullWindow() {
    ipcRenderer.send(
      "preview:toggle-full-window"
    );
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
  }
});
