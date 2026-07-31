const terminalElement =
  document.getElementById("terminal");

const terminalPanel =
  document.getElementById("terminal-panel");

const previewStatusText =
  document.getElementById("preview-status-text");

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
  fontFamily:
    'Menlo, Monaco, "SFMono-Regular", Consolas, monospace',
  fontSize: 14,
  fontWeight: "400",
  lineHeight: 1.2,
  letterSpacing: 0,
  scrollback: 10000,
  macOptionIsMeta: true,
  allowTransparency: false,
  theme: {
    background: "#101010",
    foreground: "#f1f1f1",
    cursor: "#f1f1f1",
    cursorAccent: "#101010",
    selectionBackground: "#555555"
  }
});

const fitAddon = new FitAddon.FitAddon();

terminal.loadAddon(fitAddon);
terminal.open(terminalElement);

window.terminalAPI.onData((data) => {
  terminal.write(data);
});

window.terminalAPI.onPreviewState((state) => {
  const isOpen = Boolean(state && state.open);

  document.body.classList.toggle(
    "preview-open",
    isOpen
  );

  if (isOpen) {
    const status =
      state.status || "Live webpage";

    const url =
      state.url || "";

    previewStatusText.textContent =
      url ? `${status} — ${url}` : status;
  } else {
    previewStatusText.textContent =
      "Live webpage";
  }

  setTimeout(() => {
    resizeTerminal();
    terminal.focus();
  }, 50);
});

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
  }, 40);
}

const resizeObserver =
  new ResizeObserver(resizeTerminal);

resizeObserver.observe(terminalPanel);

window.addEventListener(
  "resize",
  resizeTerminal
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

    setTimeout(() => {
      terminal.focus();
    }, 50);
  }
);

setTimeout(() => {
  resizeTerminal();
  terminal.focus();
}, 100);

document.addEventListener("mousedown", (event) => {
  if (
    event.target !== closePreviewButton &&
    event.target !== expandPreviewButton
  ) {
    terminal.focus();
  }
});
