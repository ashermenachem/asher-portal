const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell
} = require("electron");

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const pty = require("node-pty");

const WINDOW_CHROME_HEIGHT = 120;
const OUTER_GUTTER = 14;
const TERMINAL_PANEL_HEIGHT = 296;
const PANE_GAP = 12;
const PREVIEW_INSET = 4;
const APP_NAME = "Asher Portal";

app.setName(APP_NAME);
process.title = APP_NAME;

let mainWindow = null;
let shellProcess = null;
let previewServer = null;
let previewSocketPath = null;
let previewFullWindow = false;
let portalShellConfigDirectory = null;

let tabs = [];
let activeTabId = null;
let attachedTabId = null;
let nextTabId = 1;

function sendToTerminal(channel, ...arguments) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    mainWindow.webContents.send(
      channel,
      ...arguments
    );
  }
}

function looksLikeWebAddress(value) {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?([/?#].*)?$/i.test(value) ||
    /^([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]+)?([/?#].*)?$/i.test(value)
  );
}

function normalizeURL(rawValue) {
  const value =
    String(rawValue || "").trim();

  if (!value) {
    throw new Error(
      "Enter a website or search query."
    );
  }

  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  ) {
    return value;
  }

  if (looksLikeWebAddress(value)) {
    if (
      /^(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(
        value
      )
    ) {
      return `http://${value}`;
    }

    return `https://${value}`;
  }

  return (
    "https://www.google.com/search?q=" +
    encodeURIComponent(value)
  );
}

function getTabById(tabId) {
  return (
    tabs.find(
      (tab) => tab.id === Number(tabId)
    ) || null
  );
}

function getActiveTab() {
  return getTabById(activeTabId);
}

function serializeTab(tab) {
  return {
    id: tab.id,
    title:
      tab.title ||
      (tab.url ? "Loading…" : "New Tab"),
    url: tab.url || "",
    loading: Boolean(tab.loading)
  };
}

function sendPreviewState(status = "") {
  const activeTab = getActiveTab();

  if (
    activeTab &&
    activeTab.view &&
    !activeTab.view.webContents.isDestroyed()
  ) {
    const contents =
      activeTab.view.webContents;

    const liveURL = contents.getURL();

    if (
      liveURL &&
      liveURL !== "about:blank"
    ) {
      activeTab.url = liveURL;
    }

    const liveTitle = contents.getTitle();

    if (liveTitle) {
      activeTab.title = liveTitle;
    }
  }

  const contents =
    activeTab &&
    activeTab.view &&
    !activeTab.view.webContents.isDestroyed()
      ? activeTab.view.webContents
      : null;

  sendToTerminal("preview:state", {
    open: Boolean(
      activeTab &&
      activeTab.view &&
      activeTab.url
    ),
    url:
      activeTab
        ? activeTab.url || ""
        : "",
    title:
      activeTab
        ? activeTab.title || "New Tab"
        : "",
    status:
      status ||
      (
        activeTab && activeTab.loading
          ? "Loading webpage…"
          : activeTab && activeTab.url
            ? "Live webpage"
            : ""
      ),
    fullWindow: previewFullWindow,
    canGoBack: Boolean(
      contents &&
      contents.navigationHistory.canGoBack()
    ),
    canGoForward: Boolean(
      contents &&
      contents.navigationHistory.canGoForward()
    ),
    activeTabId,
    tabs: tabs.map(serializeTab)
  });
}

function layoutPreview() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  const activeTab = getActiveTab();

  if (
    !activeTab ||
    !activeTab.view
  ) {
    return;
  }

  const bounds =
    mainWindow.getContentBounds();

  const previewX =
    OUTER_GUTTER + PREVIEW_INSET;

  const previewY =
    WINDOW_CHROME_HEIGHT +
    OUTER_GUTTER +
    PREVIEW_INSET;

  const previewWidth = Math.max(
    1,
    bounds.width -
      ((OUTER_GUTTER + PREVIEW_INSET) * 2)
  );

  const reservedBottom =
    previewFullWindow
      ? OUTER_GUTTER + PREVIEW_INSET
      : OUTER_GUTTER +
        TERMINAL_PANEL_HEIGHT +
        PANE_GAP +
        PREVIEW_INSET;

  const previewHeight = Math.max(
    1,
    bounds.height -
      previewY -
      reservedBottom
  );

  activeTab.view.setBounds({
    x: previewX,
    y: previewY,
    width: previewWidth,
    height: previewHeight
  });
}

function detachAttachedTab() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    attachedTabId === null
  ) {
    attachedTabId = null;
    return;
  }

  const attachedTab =
    getTabById(attachedTabId);

  if (attachedTab && attachedTab.view) {
    try {
      mainWindow.contentView
        .removeChildView(attachedTab.view);
    } catch (error) {
      console.error(
        "Could not detach tab view:",
        error
      );
    }
  }

  attachedTabId = null;
}

function displayActiveTab() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  const activeTab = getActiveTab();

  if (attachedTabId !== activeTabId) {
    detachAttachedTab();
  }

  if (
    activeTab &&
    activeTab.view &&
    attachedTabId !== activeTab.id
  ) {
    mainWindow.contentView.addChildView(
      activeTab.view
    );

    attachedTabId = activeTab.id;
  }

  if (
    !activeTab ||
    !activeTab.view ||
    !activeTab.url
  ) {
    previewFullWindow = false;
  }

  layoutPreview();
  sendPreviewState();
}

function togglePreviewFullWindow() {
  const activeTab = getActiveTab();

  if (
    !activeTab ||
    !activeTab.view ||
    !activeTab.url
  ) {
    return;
  }

  previewFullWindow =
    !previewFullWindow;

  layoutPreview();

  sendPreviewState(
    previewFullWindow
      ? "Full-window webpage"
      : "Live webpage"
  );
}

function restoreSplitView() {
  if (!previewFullWindow) {
    return;
  }

  previewFullWindow = false;
  layoutPreview();
  sendPreviewState("Live webpage");
}

function installPortalShortcuts(
  contents,
  tabId
) {
  contents.on(
    "before-input-event",
    (event, input) => {
      if (input.type !== "keyDown") {
        return;
      }

      const key =
        String(input.key || "")
          .toLowerCase();

      const closeShortcut =
        input.meta &&
        !input.shift &&
        !input.alt &&
        key === "w";

      if (closeShortcut) {
        event.preventDefault();
        closeTab(tabId);
        return;
      }

      const newTabShortcut =
        input.meta &&
        !input.shift &&
        !input.alt &&
        key === "t";

      if (newTabShortcut) {
        event.preventDefault();
        createTab("", true);
        sendToTerminal(
          "browser:focus-address"
        );
        return;
      }

      const addressShortcut =
        input.meta &&
        !input.shift &&
        !input.alt &&
        key === "l";

      if (addressShortcut) {
        event.preventDefault();
        sendToTerminal(
          "browser:focus-address"
        );
        return;
      }

      const expandShortcut =
        input.meta &&
        input.shift &&
        key === "p";

      if (expandShortcut) {
        event.preventDefault();
        togglePreviewFullWindow();
        return;
      }

      if (
        input.key === "Escape" &&
        previewFullWindow
      ) {
        event.preventDefault();
        restoreSplitView();
      }
    }
  );
}

function createTabView(tab) {
  if (tab.view) {
    return tab.view;
  }

  const view =
    new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        autoplayPolicy:
          "no-user-gesture-required"
      }
    });

  tab.view = view;

  const contents =
    view.webContents;

  installPortalShortcuts(
    contents,
    tab.id
  );

  contents.setWindowOpenHandler(
    ({ url }) => {
      createTab(url, true);
      return { action: "deny" };
    }
  );

  contents.on(
    "did-start-loading",
    () => {
      tab.loading = true;

      sendPreviewState(
        tab.id === activeTabId
          ? "Loading webpage…"
          : ""
      );
    }
  );

  contents.on(
    "did-stop-loading",
    () => {
      tab.loading = false;

      const liveURL =
        contents.getURL();

      if (
        liveURL &&
        liveURL !== "about:blank"
      ) {
        tab.url = liveURL;
      }

      const liveTitle =
        contents.getTitle();

      if (liveTitle) {
        tab.title = liveTitle;
      }

      sendPreviewState(
        tab.id === activeTabId
          ? "Live webpage"
          : ""
      );
    }
  );

  contents.on(
    "did-navigate",
    (_event, url) => {
      if (
        url &&
        url !== "about:blank"
      ) {
        tab.url = url;
      }

      sendPreviewState();
    }
  );

  contents.on(
    "did-navigate-in-page",
    (_event, url) => {
      if (url) {
        tab.url = url;
      }

      sendPreviewState();
    }
  );

  contents.on(
    "page-title-updated",
    (_event, title) => {
      tab.title =
        String(title || "") ||
        tab.title;

      sendPreviewState();
    }
  );

  contents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    ) => {
      if (
        !isMainFrame ||
        errorCode === -3
      ) {
        return;
      }

      tab.loading = false;
      tab.url =
        validatedURL ||
        tab.url;

      sendPreviewState(
        tab.id === activeTabId
          ? `Load failed: ${errorDescription}`
          : ""
      );

      console.error(
        "Webpage failed to load:",
        validatedURL,
        errorCode,
        errorDescription
      );
    }
  );

  return view;
}

function createTab(
  rawValue = "",
  activate = true
) {
  const tab = {
    id: nextTabId++,
    title: "New Tab",
    url: "",
    loading: false,
    view: null
  };

  tabs.push(tab);

  if (activate) {
    activeTabId = tab.id;
    previewFullWindow = false;
    displayActiveTab();
  } else {
    sendPreviewState();
  }

  if (
    String(rawValue || "").trim()
  ) {
    navigateTab(tab.id, rawValue);
  }

  return tab;
}

function activateTab(tabId) {
  const tab = getTabById(tabId);

  if (!tab) {
    return;
  }

  activeTabId = tab.id;
  previewFullWindow = false;
  displayActiveTab();
}

function navigateTab(
  tabId,
  rawValue
) {
  let tab = getTabById(tabId);

  if (!tab) {
    tab = createTab("", false);
  }

  const normalizedURL =
    normalizeURL(rawValue);

  tab.url = normalizedURL;
  tab.title = "Loading…";
  tab.loading = true;

  const view =
    createTabView(tab);

  activeTabId = tab.id;
  previewFullWindow = false;
  displayActiveTab();

  sendPreviewState(
    "Loading webpage…"
  );

  view.webContents
    .loadURL(normalizedURL)
    .catch((error) => {
      tab.loading = false;

      console.error(
        "Could not load webpage:",
        error
      );

      sendPreviewState(
        `Load failed: ${error.message}`
      );
    });

  return tab;
}

function showPreview(rawValue) {
  let tab = getActiveTab();

  if (!tab) {
    tab = createTab("", true);
  }

  return navigateTab(
    tab.id,
    rawValue
  );
}

function closeTab(tabId = activeTabId) {
  const numericTabId =
    tabId === undefined ||
    tabId === null
      ? activeTabId
      : Number(tabId);

  const index = tabs.findIndex(
    (tab) => tab.id === numericTabId
  );

  if (index === -1) {
    return;
  }

  const [tab] =
    tabs.splice(index, 1);

  if (tab.id === attachedTabId) {
    detachAttachedTab();
  }

  if (
    tab.view &&
    !tab.view.webContents.isDestroyed()
  ) {
    tab.view.webContents.close();
  }

  if (tab.id === activeTabId) {
    const nextTab =
      tabs[index] ||
      tabs[index - 1] ||
      null;

    activeTabId =
      nextTab ? nextTab.id : null;

    previewFullWindow = false;
  }

  if (tabs.length === 0) {
    createTab("", true);
    return;
  }

  displayActiveTab();
}

function closePreview() {
  closeTab(activeTabId);
}

function destroyAllTabs() {
  detachAttachedTab();

  for (const tab of tabs) {
    if (
      tab.view &&
      !tab.view.webContents.isDestroyed()
    ) {
      tab.view.webContents.close();
    }
  }

  tabs = [];
  activeTabId = null;
  attachedTabId = null;
  previewFullWindow = false;
}

function goBack() {
  const tab = getActiveTab();

  if (
    tab &&
    tab.view &&
    tab.view.webContents
      .navigationHistory
      .canGoBack()
  ) {
    tab.view.webContents
      .navigationHistory
      .goBack();
  }
}

function goForward() {
  const tab = getActiveTab();

  if (
    tab &&
    tab.view &&
    tab.view.webContents
      .navigationHistory
      .canGoForward()
  ) {
    tab.view.webContents
      .navigationHistory
      .goForward();
  }
}

function reloadActiveTab() {
  const tab = getActiveTab();

  if (tab && tab.view) {
    tab.view.webContents.reload();
  }
}

function openActiveTabExternally() {
  const tab = getActiveTab();

  if (
    !tab ||
    !tab.url ||
    !/^https?:/i.test(tab.url)
  ) {
    return;
  }

  shell
    .openExternal(tab.url)
    .catch((error) => {
      console.error(
        "Could not open webpage externally:",
        error
      );
    });
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

zle -A accept-line _asher_portal_original_accept_line 2>/dev/null || true

_asher_portal_accept_line() {
  local portal_input="$BUFFER"
  local portal_url_pattern='^[[:space:]]*(https?://)?(([[:alnum:]-]+\.)+[[:alpha:]]{2,}|localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?([/?#].*)?[[:space:]]*$'

  if [[ "$portal_input" =~ $portal_url_pattern ]]; then
    local portal_quoted
    portal_quoted="$(printf '%q' "$portal_input")"
    BUFFER="preview $portal_quoted"
  fi

  if zle -l _asher_portal_original_accept_line >/dev/null 2>&1; then
    zle _asher_portal_original_accept_line
  else
    zle .accept-line
  fi
}

zle -N accept-line _asher_portal_accept_line

_asher_portal_restore_url_widget() {
  zle -N accept-line _asher_portal_accept_line 2>/dev/null || true
}

precmd_functions+=(_asher_portal_restore_url_widget)

if (( $+functions[command_not_found_handler] )); then
  functions[_asher_portal_original_command_not_found_handler]=$functions[command_not_found_handler]
fi

command_not_found_handler() {
  local portal_query="$*"

  if [[ -n "$portal_query" ]]; then
    preview "$portal_query"
    return $?
  fi

  if (( $+functions[_asher_portal_original_command_not_found_handler] )); then
    _asher_portal_original_command_not_found_handler "$@"
    return $?
  fi

  print -u2 "zsh: command not found: $1"
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {
      x: 18,
      y: 18
    },
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

      if (tabs.length === 0) {
        createTab("", true);
      } else {
        sendPreviewState();
      }

      mainWindow.show();
    }
  );

  mainWindow.on("resize", () => {
    layoutPreview();
  });

  mainWindow.on("closed", () => {
    destroyAllTabs();
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

ipcMain.on(
  "preview:navigate",
  (_event, rawValue) => {
    try {
      showPreview(rawValue);
    } catch (error) {
      console.error(
        "Could not navigate preview:",
        error
      );

      sendPreviewState(
        `Navigation failed: ${error.message}`
      );
    }
  }
);

ipcMain.on(
  "preview:new-tab",
  () => {
    createTab("", true);

    sendToTerminal(
      "browser:focus-address"
    );
  }
);

ipcMain.on(
  "preview:activate-tab",
  (_event, tabId) => {
    activateTab(tabId);
  }
);

ipcMain.on(
  "preview:close-tab",
  (_event, tabId) => {
    closeTab(tabId);
  }
);

ipcMain.on("preview:back", () => {
  goBack();
});

ipcMain.on("preview:forward", () => {
  goForward();
});

ipcMain.on("preview:reload", () => {
  reloadActiveTab();
});

ipcMain.on(
  "preview:open-external",
  () => {
    openActiveTabExternally();
  }
);

ipcMain.handle("app:info", () => {
  return {
    version: app.getVersion(),
    architecture: process.arch,
    platform: process.platform
  };
});

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
  destroyAllTabs();
  stopShell();
  stopPreviewServer();
});

app.on("window-all-closed", () => {
  app.quit();
});
