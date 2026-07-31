const terminalElement =
  document.getElementById("terminal");

const terminalPanel =
  document.getElementById("terminal-panel");

const addressForm =
  document.getElementById("address-form");

const addressInput =
  document.getElementById("address-input");

const pageModeLabel =
  document.getElementById("page-mode-label");

const activePageStatus =
  document.getElementById("active-page-status");

const architectureStatus =
  document.getElementById(
    "architecture-status"
  );

const versionStatus =
  document.getElementById("version-status");

const tabsContainer =
  document.getElementById("tabs-container");

const newTabButton =
  document.getElementById("new-tab-button");

const backButton =
  document.getElementById("back-button");

const forwardButton =
  document.getElementById("forward-button");

const reloadButton =
  document.getElementById("reload-button");

const externalButton =
  document.getElementById("external-button");

const expandPreviewButton =
  document.getElementById(
    "expand-preview-button"
  );

const closePreviewButton =
  document.getElementById(
    "close-preview-button"
  );

const terminal = new Terminal({
  cursorBlink: true,
  cursorStyle: "block",
  cursorWidth: 1,
  fontFamily:
    '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 13,
  fontWeight: "400",
  fontWeightBold: "650",
  lineHeight: 1.28,
  letterSpacing: 0.1,
  scrollback: 12000,
  macOptionIsMeta: true,
  allowTransparency: false,
  theme: {
    background: "#080b11",
    foreground: "#dce5f2",
    cursor: "#70e7f7",
    cursorAccent: "#080b11",
    selectionBackground:
      "rgba(79, 140, 255, 0.32)",
    selectionForeground: "#ffffff",
    black: "#161b25",
    red: "#ff7180",
    green: "#55d99f",
    yellow: "#e7c66a",
    blue: "#6b9dff",
    magenta: "#b58aff",
    cyan: "#6fe6f5",
    white: "#dbe5f3",
    brightBlack: "#647087",
    brightRed: "#ff96a1",
    brightGreen: "#7eeab9",
    brightYellow: "#f3d98f",
    brightBlue: "#91b6ff",
    brightMagenta: "#c9a7ff",
    brightCyan: "#98f0fb",
    brightWhite: "#ffffff"
  }
});

const fitAddon =
  new FitAddon.FitAddon();

terminal.loadAddon(fitAddon);
terminal.open(terminalElement);

let latestPreviewState = {
  open: false,
  url: "",
  title: "",
  status: "",
  fullWindow: false,
  canGoBack: false,
  canGoForward: false,
  activeTabId: null,
  tabs: []
};

window.terminalAPI.onData((data) => {
  terminal.write(data);
});

window.terminalAPI.onFocusAddress(() => {
  focusAddressBar();
});

window.terminalAPI.onPreviewState((state) => {
  latestPreviewState = {
    ...latestPreviewState,
    ...(state || {})
  };

  const isOpen =
    Boolean(latestPreviewState.open);

  const isFullWindow =
    Boolean(latestPreviewState.fullWindow);

  const status =
    latestPreviewState.status || "";

  const isLoading =
    /loading/i.test(status);

  document.body.classList.toggle(
    "preview-open",
    isOpen
  );

  document.body.classList.toggle(
    "preview-full",
    isOpen && isFullWindow
  );

  document.body.classList.toggle(
    "page-loading",
    isOpen && isLoading
  );

  backButton.disabled =
    !isOpen ||
    !latestPreviewState.canGoBack;

  forwardButton.disabled =
    !isOpen ||
    !latestPreviewState.canGoForward;

  reloadButton.disabled = !isOpen;
  externalButton.disabled = !isOpen;
  expandPreviewButton.disabled = !isOpen;
  closePreviewButton.disabled =
    !latestPreviewState.activeTabId;

  expandPreviewButton.title =
    isFullWindow
      ? "Restore split view"
      : "Expand webpage";

  expandPreviewButton.setAttribute(
    "aria-label",
    expandPreviewButton.title
  );

  renderTabs();

  if (
    document.activeElement !== addressInput ||
    isLoading
  ) {
    addressInput.value =
      latestPreviewState.url || "";
  }

  if (isOpen) {
    pageModeLabel.textContent =
      isLoading ? "LOADING" : "LIVE";

    activePageStatus.textContent =
      latestPreviewState.title ||
      getDisplayHost(
        latestPreviewState.url
      ) ||
      "LIVE PAGE";

    document.title =
      latestPreviewState.title
        ? `${latestPreviewState.title} — Asher Portal`
        : "Asher Portal";
  } else {
    pageModeLabel.textContent = "READY";

    activePageStatus.textContent =
      latestPreviewState.activeTabId
        ? "NEW TAB"
        : "NO PORTAL OPEN";

    document.title = "Asher Portal";
  }

  setTimeout(() => {
    resizeTerminal();

    if (
      document.activeElement !== addressInput
    ) {
      terminal.focus();
    }
  }, 70);
});

function renderTabs() {
  const tabs =
    Array.isArray(latestPreviewState.tabs)
      ? latestPreviewState.tabs
      : [];

  const fragment =
    document.createDocumentFragment();

  for (const tab of tabs) {
    const tabElement =
      document.createElement("div");

    tabElement.className =
      [
        "browser-tab",
        tab.id ===
        latestPreviewState.activeTabId
          ? "active"
          : "",
        tab.loading ? "loading" : ""
      ]
        .filter(Boolean)
        .join(" ");

    tabElement.setAttribute(
      "role",
      "tab"
    );

    tabElement.setAttribute(
      "aria-selected",
      tab.id ===
        latestPreviewState.activeTabId
        ? "true"
        : "false"
    );

    const status =
      document.createElement("span");

    status.className = "tab-status";

    const title =
      document.createElement("span");

    title.className = "tab-title";
    title.textContent =
      tab.title ||
      getDisplayHost(tab.url) ||
      "New Tab";

    title.title =
      tab.title ||
      tab.url ||
      "New Tab";

    const closeButton =
      document.createElement("button");

    closeButton.type = "button";
    closeButton.className = "tab-close";
    closeButton.title = "Close tab";
    closeButton.setAttribute(
      "aria-label",
      `Close ${title.textContent}`
    );

    closeButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10"></path><path d="M17 7 7 17"></path></svg>';

    closeButton.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        window.terminalAPI.closeTab(
          tab.id
        );
      }
    );

    tabElement.addEventListener(
      "click",
      () => {
        window.terminalAPI.activateTab(
          tab.id
        );
      }
    );

    tabElement.addEventListener(
      "auxclick",
      (event) => {
        if (event.button === 1) {
          event.preventDefault();

          window.terminalAPI.closeTab(
            tab.id
          );
        }
      }
    );

    tabElement.append(
      status,
      title,
      closeButton
    );

    fragment.appendChild(tabElement);
  }

  tabsContainer.replaceChildren(fragment);

  requestAnimationFrame(() => {
    const activeElement =
      tabsContainer.querySelector(
        ".browser-tab.active"
      );

    activeElement?.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  });
}

terminal.onData((data) => {
  window.terminalAPI.sendInput(data);
});

let resizeTimer = null;

function resizeTerminal() {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    fitAddon.fit();

    window.terminalAPI.resize(
      terminal.cols,
      terminal.rows
    );
  }, 50);
}

function getDisplayHost(rawURL) {
  if (!rawURL) {
    return "";
  }

  try {
    return new URL(rawURL).hostname;
  } catch {
    return rawURL;
  }
}

function focusAddressBar() {
  addressInput.focus();
  addressInput.select();
}

const resizeObserver =
  new ResizeObserver(resizeTerminal);

resizeObserver.observe(terminalPanel);

window.addEventListener(
  "resize",
  resizeTerminal
);

addressForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    const destination =
      addressInput.value.trim();

    if (!destination) {
      return;
    }

    window.terminalAPI
      .navigatePreview(destination);

    addressInput.blur();
    terminal.focus();
  }
);

newTabButton.addEventListener(
  "click",
  () => {
    window.terminalAPI.newTab();
  }
);

backButton.addEventListener(
  "click",
  () => {
    window.terminalAPI.goBack();
  }
);

forwardButton.addEventListener(
  "click",
  () => {
    window.terminalAPI.goForward();
  }
);

reloadButton.addEventListener(
  "click",
  () => {
    window.terminalAPI.reloadPreview();
  }
);

externalButton.addEventListener(
  "click",
  () => {
    window.terminalAPI
      .openPreviewExternally();
  }
);

expandPreviewButton.addEventListener(
  "click",
  () => {
    window.terminalAPI
      .togglePreviewFullWindow();
  }
);

closePreviewButton.addEventListener(
  "click",
  () => {
    window.terminalAPI.closePreview();
  }
);

terminalPanel.addEventListener(
  "mousedown",
  () => {
    terminal.focus();
  }
);

addressInput.addEventListener(
  "focus",
  () => {
    requestAnimationFrame(() => {
      addressInput.select();
    });
  }
);

addressInput.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      event.preventDefault();

      addressInput.value =
        latestPreviewState.url || "";

      addressInput.blur();
      terminal.focus();
    }
  }
);

document.addEventListener(
  "keydown",
  (event) => {
    const key =
      String(event.key || "")
        .toLowerCase();

    if (
      event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      key === "l"
    ) {
      event.preventDefault();
      focusAddressBar();
      return;
    }

    if (
      event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      key === "t"
    ) {
      event.preventDefault();
      window.terminalAPI.newTab();
      return;
    }

    if (
      event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      key === "w" &&
      latestPreviewState.activeTabId
    ) {
      event.preventDefault();

      window.terminalAPI.closeTab(
        latestPreviewState.activeTabId
      );
    }
  }
);

window.terminalAPI
  .getAppInfo()
  .then((appInfo) => {
    if (!appInfo) {
      return;
    }

    versionStatus.textContent =
      appInfo.version
        ? `v${appInfo.version}`
        : "v—";

    const architectureLabels = {
      arm64: "APPLE SILICON",
      x64: "INTEL",
      x86_64: "INTEL"
    };

    architectureStatus.textContent =
      architectureLabels[
        appInfo.architecture
      ] ||
      String(
        appInfo.architecture || "MAC"
      ).toUpperCase();
  })
  .catch(() => {
    versionStatus.textContent = "v—";
  });

setTimeout(() => {
  resizeTerminal();
  terminal.focus();
}, 120);
