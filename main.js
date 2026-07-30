const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain
} = require("electron");

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const pty = require("node-pty");

const TERMINAL_PANEL_HEIGHT = 260;
const APP_NAME = "Asher Portal";

app.setName(APP_NAME);
process.title = APP_NAME;

let mainWindow = null;
let shellProcess = null;
let previewView = null;
let previewServer = null;
let previewSocketPath = null;
let currentPreviewURL = null;
let previewFullWindow = false;
let portalShellConfigDirectory = null;

function sendToTerminal(channel, ...arguments) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...arguments);
  }
}

function sendPreviewState(status = "") {
  sendToTerminal("preview:state", {
    open: Boolean(previewView),
    url: currentPreviewURL,
    status,
    fullWindow: previewFullWindow
  });
}

function normalizeURL(rawValue) {
  const input = String(rawValue || "").trim();

  if (!input) {
    throw new Error("No webpage address was supplied.");
  }

  let candidate = input;

  if (
    input.startsWith("localhost") ||
    input.startsWith("127.0.0.1") ||
    input.startsWith("0.0.0.0")
  ) {
    candidate = `http://${input}`;
  } else if (!input.includes("://")) {
    candidate = `https://${input}`;
  }

  const parsedURL = new URL(candidate);

  const allowedProtocols = new Set([
    "http:",
    "https:",
    "file:"
  ]);

  if (!allowedProtocols.has(parsedURL.protocol)) {
    throw new Error(
      `Unsupported webpage protocol: ${parsedURL.protocol}`
    );
  }

  return parsedURL.toString();
}

function layoutPreview() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !previewView
  ) {
    return;
  }

  const bounds = mainWindow.getContentBounds();

  const previewHeight = previewFullWindow
    ? Math.max(1, bounds.height)
    : Math.max(
        1,
        bounds.height - TERMINAL_PANEL_HEIGHT
      );

  previewView.setBounds({
    x: 0,
    y: 0,
    width: Math.max(1, bounds.width),
    height: previewHeight
  });
}

function togglePreviewFullWindow() {
  if (!previewView) {
    return;
  }

  previewFullWindow = !previewFullWindow;

  layoutPreview();

  sendPreviewState(
    previewFullWindow
      ? "Full-window webpage — press ⌘⇧P to restore terminal"
      : "Live webpage"
  );
}

function restoreSplitView() {
  if (!previewView || !previewFullWindow) {
    return;
  }

  previewFullWindow = false;

  layoutPreview();
  sendPreviewState("Live webpage");
}

function installPortalShortcuts(contents) {
  contents.on(
    "before-input-event",
    (event, input) => {
      if (input.type !== "keyDown") {
        return;
      }

      const key = String(
        input.key || ""
      ).toLowerCase();

      const closeShortcut =
        input.meta &&
        !input.shift &&
        !input.alt &&
        key === "w";

      if (closeShortcut && previewView) {
        event.preventDefault();
        closePreview();
        return;
      }

      const expandShortcut =
        input.meta &&
        input.shift &&
        key === "p";

      if (expandShortcut && previewView) {
        event.preventDefault();
        togglePreviewFullWindow();
        return;
      }

      if (
        input.key === "Escape" &&
        previewView &&
        previewFullWindow
      ) {
        event.preventDefault();
        restoreSplitView();
      }
    }
  );
}

function createPreviewView() {
  if (previewView) {
    return previewView;
  }

  previewView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required"
    }
  });

  installPortalShortcuts(previewView.webContents);

  previewView.webContents.setWindowOpenHandler(({ url }) => {
    showPreview(url);
    return { action: "deny" };
  });

  previewView.webContents.on("did-start-loading", () => {
    sendPreviewState("Loading webpage…");
  });

  previewView.webContents.on("did-stop-loading", () => {
    sendPreviewState("Live webpage");
  });

  previewView.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    ) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }

      sendPreviewState(
        `Load failed: ${errorDescription}`
      );

      console.error(
        "Webpage failed to load:",
        validatedURL,
        errorCode,
        errorDescription
      );
    }
  );

  mainWindow.contentView.addChildView(previewView);

  layoutPreview();

  return previewView;
}

function showPreview(rawURL) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("The application window is unavailable.");
  }

  const normalizedURL = normalizeURL(rawURL);

  currentPreviewURL = normalizedURL;

  const view = createPreviewView();

  layoutPreview();
  sendPreviewState("Loading webpage…");

  mainWindow.setTitle(
    `${APP_NAME} — ${normalizedURL}`
  );

  view.webContents.loadURL(normalizedURL).catch((error) => {
    console.error("Could not load webpage:", error);
    sendPreviewState(`Load failed: ${error.message}`);
  });
}

function closePreview() {
  if (!previewView) {
    currentPreviewURL = null;
    previewFullWindow = false;
    sendPreviewState("");
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(previewView);
  }

  if (!previewView.webContents.isDestroyed()) {
    previewView.webContents.close();
  }

  previewView = null;
  currentPreviewURL = null;
  previewFullWindow = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(APP_NAME);
  }

  sendPreviewState("");
}

function removePortalShellConfig() {
  if (!portalShellConfigDirectory) {
    return;
  }

  try {
    fs.rmSync(
      portalShellConfigDirectory,
      {
        recursive: true,
        force: true
      }
    );
  } catch (error) {
    console.error(
      "Could not remove Portal shell configuration:",
      error
    );
  }

  portalShellConfigDirectory = null;
}

function createPortalShellConfig() {
  removePortalShellConfig();

  portalShellConfigDirectory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "asher-portal-zsh-"
      )
    );

  const writeStartupFile = (
    fileName,
    contents
  ) => {
    fs.writeFileSync(
      path.join(
        portalShellConfigDirectory,
        fileName
      ),
      contents,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );
  };

  const passthroughFile = (fileName) => {
    return [
      `if [[ -f "$HOME/${fileName}" ]]; then`,
      `  source "$HOME/${fileName}"`,
      "fi",
      'export ZDOTDIR="$ASHER_PORTAL_ZDOTDIR"',
      ""
    ].join("\n");
  };

  writeStartupFile(
    ".zshenv",
    passthroughFile(".zshenv")
  );

  writeStartupFile(
    ".zprofile",
    passthroughFile(".zprofile")
  );

  writeStartupFile(
    ".zlogin",
    passthroughFile(".zlogin")
  );

  writeStartupFile(
    ".zlogout",
    passthroughFile(".zlogout")
  );

  writeStartupFile(
    ".zshrc",
    String.raw`if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

export ZDOTDIR="$ASHER_PORTAL_ZDOTDIR"

if (( $+functions[command_not_found_handler] )); then
  functions[_asher_portal_original_command_not_found_handler]=$functions[command_not_found_handler]
fi

command_not_found_handler() {
  local portal_command="$1"
  shift

  local portal_url_pattern='^(https?://)?(([[:alnum:]-]+\.)+[[:alpha:]]{2,}|localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?([/?#].*)?$'

  if [[ "$portal_command" =~ $portal_url_pattern ]]; then
    preview "$portal_command"
    return $?
  fi

  if (( $+functions[_asher_portal_original_command_not_found_handler] )); then
    _asher_portal_original_command_not_found_handler "$portal_command" "$@"
    return $?
  fi

  print -u2 "zsh: command not found: $portal_command"
  return 127
}
`
  );
}

function stopShell() {
  if (shellProcess) {
    try {
      shellProcess.kill();
    } catch (error) {
      console.error(
        "Could not stop shell:",
        error
      );
    }

    shellProcess = null;
  }

  removePortalShellConfig();
}

function startShell() {
  stopShell();
  createPortalShellConfig();

  const shell = "/bin/zsh";

  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([, value]) => typeof value === "string"
    )
  );

  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";

  environment.WEB_TERMINAL_PREVIEW_SOCKET =
    previewSocketPath;

  environment.ASHER_PORTAL_ZDOTDIR =
    portalShellConfigDirectory;

  environment.ZDOTDIR =
    portalShellConfigDirectory;

  const portalCommandDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "bin");

  environment.PATH = [
    portalCommandDirectory,
    environment.PATH || ""
  ].join(":");

  shellProcess = pty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: os.homedir(),
    env: environment
  });

  shellProcess.onData((data) => {
    sendToTerminal("terminal:data", data);
  });

  shellProcess.onExit(({ exitCode, signal }) => {
    sendToTerminal(
      "terminal:data",
      `\r\n[Shell exited: code ${exitCode}, signal ${signal}]\r\n`
    );

    shellProcess = null;
    removePortalShellConfig();
  });
}

function processPreviewCommand(payload, socket) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("The preview command was invalid.");
    }

    if (payload.action === "close") {
      closePreview();
      socket.end();
      return;
    }

    if (payload.action !== "open") {
      throw new Error(
        `Unknown preview action: ${payload.action}`
      );
    }

    showPreview(payload.url);
    socket.end();
  } catch (error) {
    socket.end(`Preview error: ${error.message}\n`);
  }
}

function startPreviewServer() {
  previewSocketPath = path.join(
    os.tmpdir(),
    `asher-portal-${process.pid}.sock`
  );

  try {
    fs.unlinkSync(previewSocketPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  previewServer = net.createServer((socket) => {
    socket.setEncoding("utf8");

    let incomingData = "";
    let commandProcessed = false;

    socket.on("data", (chunk) => {
      if (commandProcessed) {
        return;
      }

      incomingData += chunk;

      const newlinePosition = incomingData.indexOf("\n");

      if (newlinePosition === -1) {
        return;
      }

      commandProcessed = true;

      const commandText = incomingData
        .slice(0, newlinePosition)
        .trim();

      try {
        const payload = JSON.parse(commandText);
        processPreviewCommand(payload, socket);
      } catch (error) {
        socket.end(
          `Preview error: Invalid command data.\n`
        );
      }
    });

    socket.on("error", (error) => {
      console.error("Preview socket error:", error);
    });
  });

  previewServer.listen(previewSocketPath);
}

function stopPreviewServer() {
  if (previewServer) {
    previewServer.close();
    previewServer = null;
  }

  if (previewSocketPath) {
    try {
      fs.unlinkSync(previewSocketPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(
          "Could not remove preview socket:",
          error
        );
      }
    }

    previewSocketPath = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    backgroundColor: "#101010",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile("index.html");

  installPortalShortcuts(mainWindow.webContents);

  mainWindow.webContents.once(
    "did-finish-load",
    () => {
      startShell();
      mainWindow.show();
    }
  );

  mainWindow.on("resize", () => {
    layoutPreview();
  });

  mainWindow.on("closed", () => {
    closePreview();
    stopShell();
    mainWindow = null;
  });
}

ipcMain.on("terminal:input", (_event, data) => {
  if (shellProcess && typeof data === "string") {
    shellProcess.write(data);
  }
});

ipcMain.on(
  "terminal:resize",
  (_event, rawColumns, rawRows) => {
    if (!shellProcess) {
      return;
    }

    const columns = Math.max(
      2,
      Math.floor(Number(rawColumns))
    );

    const rows = Math.max(
      1,
      Math.floor(Number(rawRows))
    );

    if (
      !Number.isFinite(columns) ||
      !Number.isFinite(rows)
    ) {
      return;
    }

    try {
      shellProcess.resize(columns, rows);
    } catch (error) {
      console.error("Could not resize shell:", error);
    }
  }
);

ipcMain.on("preview:close", () => {
  closePreview();
});

ipcMain.on(
  "preview:toggle-full-window",
  () => {
    togglePreviewFullWindow();
  }
);

app.whenReady().then(() => {
  startPreviewServer();
  createWindow();
});

app.on("before-quit", () => {
  closePreview();
  stopShell();
  stopPreviewServer();
});

app.on("window-all-closed", () => {
  app.quit();
});
