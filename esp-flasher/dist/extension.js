"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const serialport_1 = require("serialport");
function activate(context) {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('espFlasherWebview', new EspFlasherViewProvider(context)));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
class EspFlasherViewProvider {
    constructor(context) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel("ESP Output");
    }
    resolveWebviewView(webviewView) {
        return __awaiter(this, void 0, void 0, function* () {
            this._view = webviewView;
            webviewView.webview.options = {
                enableScripts: true,
            };
            webviewView.webview.html = this.getHtml();
            // Send available COM ports to frontend
            const ports = yield serialport_1.SerialPort.list();
            webviewView.webview.postMessage({
                command: 'populatePorts',
                ports: ports.map(p => p.path),
            });
            webviewView.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
                const { port, board } = message;
                if (!port && message.command !== 'flashFirmware') {
                    vscode.window.showErrorMessage('COM port is required.');
                    return;
                }
                if (message.command === 'flashFirmware') {
                    const fileUri = yield vscode.window.showOpenDialog({
                        filters: { 'BIN files': ['bin'] },
                        canSelectMany: false,
                    });
                    if (!board || !fileUri) {
                        vscode.window.showErrorMessage('Board and .bin file are required.');
                        return;
                    }
                    const firmwarePath = fileUri[0].fsPath;
                    const cmd = `python -u -m esptool --port ${port} --chip ${board} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Flashing firmware...',
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
                            console.log('Command:', cmd);
                            console.log('STDOUT:', stdout);
                            console.log('STDERR:', stderr);
                            if (error) {
                                vscode.window.showErrorMessage(`Firmware flashing failed: ${stderr || error.message}`);
                                reject(error);
                            }
                            else {
                                vscode.window.showInformationMessage('Firmware flashed successfully!');
                                resolve();
                            }
                        });
                    }));
                }
                else if (message.command === 'uploadPython') {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (!activeEditor || activeEditor.document.languageId !== 'python') {
                        vscode.window.showErrorMessage('No active Python file to upload.');
                        return;
                    }
                    const filePath = activeEditor.document.fileName;
                    const uploadCmd = `mpremote connect ${port} fs cp "${filePath}" :main.py`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Uploading Python file as main.py...',
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
                            var _a;
                            if (uploadError) {
                                vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
                                reject(uploadError);
                                return;
                            }
                            vscode.window.showInformationMessage('Python file uploaded successfully as main.py!');
                            resolve();
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port: message.port });
                        });
                    }));
                }
                else if (message.command === 'listFiles') {
                    const listCmd = `mpremote connect ${port} exec "import os; print(os.listdir())"`;
                    (0, child_process_1.exec)(listCmd, (err, stdout, stderr) => {
                        var _a;
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to list files: ${stderr || err.message}`);
                            return;
                        }
                        // Clean up output to parse list
                        try {
                            const match = stdout.match(/\[.*?\]/s);
                            const files = match ? JSON.parse(match[0].replace(/'/g, '"')) : [];
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'displayFiles', files });
                        }
                        catch (e) {
                            vscode.window.showErrorMessage('Failed to parse file list.');
                        }
                    });
                }
                else if (message.command === 'uploadPythonAsIs') {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (!activeEditor || activeEditor.document.languageId !== 'python') {
                        vscode.window.showErrorMessage('No active Python file to upload.');
                        return;
                    }
                    const filePath = activeEditor.document.fileName;
                    const fileName = filePath.split(/[/\\]/).pop(); // Extract filename only
                    const uploadCmd = `mpremote connect ${message.port} fs cp "${filePath}" :"${fileName}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Uploading ${fileName} to device...`,
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
                            var _a;
                            if (uploadError) {
                                vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
                                reject(uploadError);
                                return;
                            }
                            vscode.window.showInformationMessage(`${fileName} uploaded successfully!`);
                            resolve();
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port: message.port });
                        });
                    }));
                }
                else if (message.command === 'runPythonFile') {
                    const { filename } = message;
                    if (!filename) {
                        vscode.window.showErrorMessage('Filename is required to run the script.');
                        return;
                    }
                    // Remove .py extension if present
                    const moduleName = filename.endsWith('.py') ? filename.slice(0, -3) : filename;
                    const runCmd = `mpremote connect ${port} exec "import ${moduleName}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Running ${filename}...`,
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(runCmd, (runError, runStdout, runStderr) => {
                            this.outputChannel.clear();
                            this.outputChannel.appendLine(`>>> Running ${filename} on ${port}\n`);
                            this.outputChannel.appendLine(runStdout);
                            if (runStderr)
                                this.outputChannel.appendLine(`\n[stderr]\n${runStderr}`);
                            this.outputChannel.show(true);
                            if (runError) {
                                vscode.window.showErrorMessage(`Running script failed: ${runStderr || runError.message}`);
                                reject(runError);
                            }
                            else {
                                vscode.window.showInformationMessage(`${filename} ran successfully!`);
                                resolve();
                            }
                        });
                    }));
                }
                else if (message.command === 'deleteFile') {
                    const delCmd = `mpremote connect ${port} exec "import os; os.remove('${message.filename}')"`;
                    (0, child_process_1.exec)(delCmd, (err, stdout, stderr) => {
                        var _a;
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to delete file: ${stderr || err.message}`);
                        }
                        else {
                            vscode.window.showInformationMessage(`Deleted ${message.filename} successfully.`);
                            // Re-fetch file list
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port });
                        }
                    });
                }
            }));
        });
    }
    getHtml() {
        return `
      <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      padding: 12px;
      background-color: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
    }

    h3 {
      margin-top: 0;
      font-size: 16px;
      color: var(--vscode-sideBarTitle-foreground);
    }

    form, .section {
      margin-bottom: 24px;
    }

    label {
      display: block;
      margin-bottom: 6px;
    }

    input, select {
      width: 100%;
      padding: 6px;
      margin-bottom: 12px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }

    button {
      display: block;
      width: 100%;
      padding: 10px 0;
      margin-top: 10px;
      margin-bottom: 10px;
      background-color: #5e2ca5;
      color: white;
      font-weight: bold;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s ease-in-out;
    }

    button:hover {
      background-color: #7a3fc9;
    }

    hr {
      margin: 24px 0;
      border: none;
      border-top: 1px solid var(--vscode-editorGroup-border);
    }

    .buttons-row {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }

    .buttons-row button {
      flex: 1;
      margin-top: 0;
    }
  </style>
</head>
<body>

  <hr />

  <div class="section">
    <h4>Upload & Manage Python Scripts</h4>

    <label for="portDevice">COM Port</label>
    <select id="portDevice"></select>

    <button id="uploadPythonBtn">Upload Active Python File as main.py</button>
    <button id="uploadAsIsBtn">Upload Active Python File </button>

    <div class="buttons-row">
      <button id="listFilesBtn">List Files</button>
      <button id="refreshBtn">Refresh Files</button>
    </div>

    <label for="fileSelect">Files on Device</label>
    <select id="fileSelect" size="6" style="width: 100%;"></select>

    <div class="buttons-row">
      <button id="runFileBtn">Run Selected File</button>
      <button id="deleteFileBtn">Delete Selected File</button>
    </div>
  </div>

  <div class="section">
    <h4>Flash Firmware</h4>
    <form id="firmwareForm">
      <label for="port">COM Port</label>
      <select id="port"></select>
      
      <label for="board">Board</label>
      <select id="board">
        <option value="esp32">ESP32</option>
        <option value="esp8266">ESP8266</option>
      </select>

      <button type="submit">Flash Firmware (.bin)</button>
    </form>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.command === 'populatePorts') {
        ['port', 'portDevice'].forEach(id => {
          const select = document.getElementById(id);
          select.innerHTML = '';
          message.ports.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = port;
            select.appendChild(option);
          });
        });
      }

      if (message.command === 'displayFiles') {
        const fileSelect = document.getElementById('fileSelect');
        fileSelect.innerHTML = '';
        message.files.forEach(file => {
          const option = document.createElement('option');
          option.value = file;
          option.textContent = file;
          fileSelect.appendChild(option);
        });
      }

      if (message.command === 'triggerListFiles') {
        vscode.postMessage({ command: 'listFiles', port: message.port });
      }
    });

    // Firmware flash form
    document.getElementById('firmwareForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const port = document.getElementById('port').value;
      const board = document.getElementById('board').value;
      vscode.postMessage({ command: 'flashFirmware', port, board });
    });

    // Upload Python file
    document.getElementById('uploadPythonBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before uploading.');
        return;
      }
      vscode.postMessage({ command: 'uploadPython', port });
    });

    // List files
    document.getElementById('listFilesBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before listing files.');
        return;
      }
      vscode.postMessage({ command: 'listFiles', port });
    });

    // Upload Python file as-is
    document.getElementById('uploadAsIsBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before uploading.');
        return;
      }
      vscode.postMessage({ command: 'uploadPythonAsIs', port });
    });


    // Refresh files (same as list)
    document.getElementById('refreshBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      if (!port) {
        alert('Please select the COM Port before refreshing files.');
        return;
      }
      vscode.postMessage({ command: 'listFiles', port });
    });

    // Delete selected file
    document.getElementById('deleteFileBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      const filename = document.getElementById('fileSelect').value;
      if (!port) {
        alert('Please select the COM Port before deleting a file.');
        return;
      }
      if (!filename) {
        alert('No file selected to delete.');
        return;
      }
      vscode.postMessage({ command: 'deleteFile', port, filename });
    });

    // Run selected file
    document.getElementById('runFileBtn').addEventListener('click', () => {
      const port = document.getElementById('portDevice').value;
      const filename = document.getElementById('fileSelect').value;
      if (!port) {
        alert('Please select the COM Port before running a file.');
        return;
      }
      if (!filename) {
        alert('No file selected to run.');
        return;
      }
      vscode.postMessage({ command: 'runPythonFile', port, filename });
    });
  </script>
</body>
</html>
    `;
    }
}
